/**
 * Budget Makers Wallet as an `IntegrationProvider`.
 *
 * The only file in this task that knows Wallet exists. Everything it exposes
 * is in the framework's vocabulary: a credential schema, a reachability test,
 * one sync handler per `SyncKind`, and what disconnecting should do to the
 * accounts it created.
 */

import { z } from "zod";
import { getAccounts } from "@/lib/clients/wallet";
import { errorMessage } from "@/lib/clients/http";
import { romeDate } from "@/lib/time";
import { hmacSignatureVerifier, webhookEventName } from "@/platform/integrations/webhook-signature";
import type {
  DisconnectContext,
  IntegrationProvider,
  SyncApplyContext,
  SyncFetchContext,
  SyncHandler,
  SyncRequest,
  TestResult,
} from "@/platform/integrations/types";
import { deletionDecision } from "@/modules/accounts/domain/account";
import type { ProviderAccount } from "@/modules/accounts/application/ports";
import { syncProviderAccounts } from "@/modules/accounts/application/sync-provider-accounts";
import { accountDeps } from "@/modules/accounts/infrastructure/deps";
import {
  prefetchedWalletSource,
  walletAccountsSource,
  WALLET_PROVIDER,
} from "@/modules/accounts/infrastructure/wallet-adapter";
import { expenseDeps } from "@/modules/expenses/infrastructure/deps";
import { detectRecurringPatterns } from "@/modules/expenses/application/detect-recurring-patterns";
import { syncProviderTransactions } from "@/modules/expenses/application/sync-provider-transactions";
import {
  prefetchedWalletTransactionsSource,
  walletTransactionsSource,
} from "@/modules/expenses/infrastructure/wallet-transactions-adapter";
import type { ProviderCategory, ProviderTransaction } from "@/modules/expenses/application/ports";

const credentialSchema = z.object({
  token: z.string().min(1),
  /** Optional: only a deployment that actually receives Wallet webhooks needs one. */
  webhookSecret: z.string().optional().default(""),
});

async function testConnection(credentials: Record<string, string>): Promise<TestResult> {
  try {
    const accounts = await getAccounts({ token: credentials.token!, attempts: 1 });
    return { ok: true, message: `Reached the Wallet API and read ${accounts.length} account(s).` };
  } catch (err) {
    // `errorMessage` never includes the request headers, so the token cannot
    // reach this string; the message is shown to the user verbatim.
    return { ok: false, message: errorMessage(err) };
  }
}

/**
 * The accounts sync, split where the network is.
 *
 * `fetch` is one Wallet round trip and runs with no transaction open; `apply`
 * is the whole reconciliation and runs inside one. That is the shape the
 * `SyncHandler` contract establishes for this exact call — a Wallet round trip
 * that takes twelve seconds must not hold a pool connection (and, in a job, an
 * advisory lock) for twelve seconds.
 *
 * Wallet's accounts API is a full listing with no pagination, so there is
 * nothing to carry between passes and this handler never sets a cursor.
 */
const accountsSync: SyncHandler<ProviderAccount[]> = {
  schedule: "daily",

  async fetch(ctx: SyncFetchContext): Promise<ProviderAccount[]> {
    return walletAccountsSource(ctx.clock, ctx.credentials.token!).fetchAccounts();
  },

  async apply(ctx: SyncApplyContext, incoming: ProviderAccount[]): Promise<Record<string, number>> {
    const deps = accountDeps(ctx.db);
    const source = prefetchedWalletSource(incoming);
    const result = await syncProviderAccounts({ ...deps, source })(ctx.connection.userId, incoming);
    return { ...result };
  },
};

interface TransactionsSyncPayload {
  transactions: ProviderTransaction[];
  categories: ProviderCategory[];
  nextSinceDate: string;
}

const RECORDS_LOOKBACK_DAYS = 7;

/**
 * `getRecords`'s `sinceDate` filters on `recordDate`, not `updatedAt` — so
 * re-fetching a short overlap before the last cursor only recovers a record
 * that was edited late but is still *dated* inside the re-fetched window; a
 * genuinely old record edited today is not caught by this and needs a manual
 * resync. The sync is idempotent, so the overlap never duplicates anything it
 * re-fetches.
 */
function lookback(dateStr: string, days: number): string {
  const d = new Date(`${dateStr}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() - days);
  return d.toISOString().slice(0, 10);
}

/**
 * Incremental, cursor-based, exactly like `accountsSync` splits where the
 * network is: `fetch` makes the Wallet round trips (records + categories)
 * with no transaction open, `apply` does the whole reconciliation inside one.
 * The cursor is the Rome date this pass ran; the next pass re-requests from
 * `RECORDS_LOOKBACK_DAYS` before that (see `lookback`'s own caveat on what
 * that overlap does and does not catch).
 *
 * First run (no cursor yet): `sinceDate` is `null`, so `getRecords` omits the
 * filter entirely and the Wallet API applies its own default window —
 * documented as roughly three months (`GetRecordsOptions.sinceDate` in
 * `@/lib/clients/wallet`). The cursor then jumps straight to today, so a
 * transaction older than that initial window is never imported by any later
 * run of this handler. That is a deliberate scope decision for this phase,
 * not an oversight — a full historical backfill is out of scope here.
 */
const transactionsSync: SyncHandler<TransactionsSyncPayload> = {
  schedule: "hourly",

  async fetch(ctx: SyncFetchContext): Promise<TransactionsSyncPayload> {
    const cursor = ctx.cursor as { sinceDate: string } | null;
    const sinceDate = cursor ? lookback(cursor.sinceDate, RECORDS_LOOKBACK_DAYS) : null;
    const source = walletTransactionsSource(ctx.credentials.token!);
    const [transactions, categories] = await Promise.all([source.fetchTransactions(sinceDate), source.fetchCategories()]);
    return { transactions, categories, nextSinceDate: romeDate(ctx.clock.now()) };
  },

  async apply(ctx: SyncApplyContext, payload: TransactionsSyncPayload): Promise<Record<string, number>> {
    const expenses = expenseDeps(ctx.db);
    const links = accountDeps(ctx.db).links;
    const source = prefetchedWalletTransactionsSource(payload.transactions, payload.categories);
    const result = await syncProviderTransactions({ ...expenses, links, source })(ctx.connection.userId, null);
    const patterns = await detectRecurringPatterns(expenses)(ctx.connection.userId);
    ctx.setCursor({ sinceDate: payload.nextSinceDate });
    return { ...result, patternsDetected: patterns.length };
  },
};

/**
 * Spec §5.2's `disconnect_policy`, applied to the accounts this provider owns.
 * `keep` deliberately does nothing here: the credential is destroyed by the use
 * case in every case, and "keep" means the history stays exactly as it is.
 */
async function onDisconnect(ctx: DisconnectContext): Promise<void> {
  if (ctx.policy === "keep") return;
  const deps = accountDeps(ctx.db);
  const accounts = (await deps.accounts.list(ctx.connection.userId, { includeArchived: true })).filter(
    (a) => a.provider === WALLET_PROVIDER,
  );
  const now = ctx.clock.now();
  let archived = 0;
  let deleted = 0;

  // `purge` marks every link missing FIRST, so the loop below really is looking
  // at accounts with no live provider link — which is what lets it pass
  // `hasLiveProviderLink: false` to `deletionDecision` and mean it. An empty
  // seen list marks them all.
  if (ctx.policy === "purge") {
    await deps.links.markMissing(ctx.connection.userId, WALLET_PROVIDER, "account", [], now);
  }

  for (const account of accounts) {
    if (ctx.policy === "archive") {
      if (account.status === "archived") continue;
      await deps.accounts.update(ctx.connection.userId, account.id, account.version, {
        status: "archived",
        archivedAt: now,
      });
      archived += 1;
      continue;
    }
    // `origin: "manual"` is a deliberate override, not the account's real
    // origin: `deletionDecision` otherwise refuses to hard-delete anything
    // whose origin is `"synced"` at all (it always answers "archive"), which
    // is the right default for an account that merely lost its live link in
    // passing. Here the user has explicitly asked to purge this connection,
    // so an unreferenced account it created should follow the same rule a
    // manual account would — hard-delete if nothing else references it,
    // archive otherwise — rather than being kept forever just because it was
    // once synced.
    const decision = deletionDecision(
      { ...account, origin: "manual" },
      { hasLiveProviderLink: false, hasReferences: await deps.accounts.hasReferences(account.id) },
    );
    if (decision === "hard_delete") {
      await deps.accounts.delete(ctx.connection.userId, account.id);
      deleted += 1;
    } else {
      await deps.accounts.update(ctx.connection.userId, account.id, account.version, {
        status: "archived",
        archivedAt: now,
      });
      archived += 1;
    }
  }

  // Through `ctx.audit`, not `recordAudit(ctx.db, …)`: the port exists so a
  // test can observe the line without a real database.
  await ctx.audit({
    actorUserId: ctx.connection.userId,
    action: "integration.disconnect_applied",
    entityType: "integration_connection",
    entityId: ctx.connection.id,
    after: { provider: WALLET_PROVIDER, policy: ctx.policy, archived, deleted },
  });
}

export const walletProvider: IntegrationProvider = {
  code: "wallet",
  label: "Budget Makers Wallet",
  capabilities: ["accounts", "transactions", "interest_posting"],
  credentialSchema,
  credentialFields: [
    { name: "token", label: "API token", secret: true, placeholder: "Bearer token from the BudgetBakers portal" },
    { name: "webhookSecret", label: "Webhook secret", secret: true, placeholder: "Optional" },
  ],
  testConnection: (credentials) => testConnection(credentials),
  syncs: { accounts: accountsSync, transactions: transactionsSync },
  webhook: {
    verify: hmacSignatureVerifier(),
    toSyncRequests: (payload): SyncRequest[] => [
      { kind: "accounts", event: webhookEventName(payload) },
    ],
  },
  onDisconnect,
};
