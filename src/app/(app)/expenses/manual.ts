// src/app/(app)/expenses/manual.ts — the manual movement as one use case (rewrite plan, 04-now.md
// §4.5 and 12-account-modes.md). The movement is the transactions module's, the mode of an account
// and its balance are the accounts module's, and what a source can do is the integrations': only
// the application joins them (rule M8), so the order is here and in no module — which account
// takes a manual movement, the write, then the balance after it.
import "server-only";
import { z } from "zod";
import { getAccount, listAccounts, movementBasis } from "@/modules/accounts/queries";
import {
  type AccountMode,
  accountMode,
  MANUAL_MOVEMENT_MODES,
  type MovementEffect,
  movementEffect,
} from "@/modules/accounts/rules";
import { rebuildDerivedBalances } from "@/modules/accounts/service";
import {
  createManualTransaction,
  deleteManualTransaction,
  updateManualTransaction,
} from "@/modules/transactions/manual";
import { type ManualKind, signedAmount } from "@/modules/transactions/manual-rules";
import {
  manualMovementsByAccount,
  type Transaction,
  transactionsByIds,
} from "@/modules/transactions/queries";
import {
  deleteHiddenTransactions,
  hideTransactions,
  restoreTransactions,
  TransactionError,
} from "@/modules/transactions/service";
import type { Ctx } from "@/platform/context";
import { type CivilDate, today } from "@/platform/dates";
import type { UiLocale } from "@/platform/format";
import { labelOf } from "@/platform/integrations/registry";
import { coreCreatesRecords, isPluginProvider, pluginProvider } from "@/platform/integrations/rules";
import { listConnections } from "@/platform/integrations/service";
import type { Cents } from "@/platform/money";
import { hasCapability } from "@/platform/plugins/contract/manifest";
import { listInstancePlugins } from "@/platform/plugins/queries";

type ManualCtx = Pick<Ctx, "userId" | "timeZone">;

interface SourcedAccount {
  type: Parameters<typeof accountMode>[0]["type"];
  origin: Parameters<typeof accountMode>[0]["origin"];
  provider: string | null;
}

/**
 * The mode of each account, from what its source says it can do: a plugin in its manifest, a
 * provider of the core in the integrations' own rules. The manifests are read only when an account
 * comes from a plugin.
 */
async function modesOf<T extends SourcedAccount>(
  accounts: readonly T[],
): Promise<Map<T, AccountMode | null>> {
  const fromPlugin = accounts.some(
    (account) => account.provider !== null && isPluginProvider(account.provider),
  );
  const plugins = fromPlugin ? await listInstancePlugins() : [];
  const creates = (provider: string): boolean => {
    if (!isPluginProvider(provider)) return coreCreatesRecords(provider);
    const plugin = plugins.find((one) => provider === pluginProvider(one.manifest.id));
    return plugin !== undefined && hasCapability(plugin.manifest, "createRecord");
  };
  return new Map(
    accounts.map((account) => [
      account,
      accountMode(account, account.provider === null ? null : { createsRecords: creates(account.provider) }),
    ]),
  );
}

/** An account the dialog offers, with the mode that decides the notes under it. */
export interface ManualAccount {
  id: string;
  name: string;
  currency: string;
  mode: AccountMode;
  /**
   * For a "read and write" account: the name of the source the movement is sent to, and whether
   * its connection is not updated now (paused, or waiting for the person): the movement then goes
   * when the connection resumes.
   */
  source?: { name: string; waiting: boolean };
}

/**
 * The sources that take the movements written here, by provider: the name a person reads, and
 * whether the connection is not updated now. Read only for the providers named.
 */
async function sourcesOf(
  ctx: Pick<Ctx, "userId">,
  locale: UiLocale,
  providers: readonly string[],
): Promise<Map<string, { name: string; waiting: boolean }>> {
  const wanted = [...new Set(providers)];
  if (wanted.length === 0) return new Map();
  const connections = await listConnections(ctx);
  const sources = new Map<string, { name: string; waiting: boolean }>();
  for (const provider of wanted) {
    const connection = connections.find((one) => one.provider === provider);
    const label = await labelOf({ provider, instanceKey: connection?.instanceKey ?? "" }, locale);
    sources.set(provider, {
      name: label.provider,
      waiting:
        connection === undefined || connection.state === "revoked" || connection.schedule.rules.length === 0,
    });
  }
  return sources;
}

/** The accounts a person may write a movement on by hand, in the order of Accounts. */
export async function manualAccounts(ctx: Pick<Ctx, "userId" | "locale">): Promise<ManualAccount[]> {
  const accounts = await listAccounts(ctx);
  const modes = await modesOf(accounts);
  const sources = await sourcesOf(
    ctx,
    ctx.locale,
    accounts.flatMap((account) =>
      modes.get(account) === "two_way" && account.provider !== null ? [account.provider] : [],
    ),
  );
  return accounts.flatMap((account) => {
    const mode = modes.get(account) ?? null;
    return mode !== null && MANUAL_MOVEMENT_MODES.includes(mode)
      ? [
          {
            id: account.id,
            name: account.name,
            currency: account.currency,
            mode,
            ...(mode === "two_way" && sources.has(account.provider ?? "")
              ? { source: sources.get(account.provider ?? "") }
              : {}),
          },
        ]
      : [];
  });
}

/**
 * The name of the source each of these accounts sends its manual movements to, for the rows that
 * wait: "Not sent to {source}". Asked only when a row on the screen waits.
 */
export async function sendSourceNames(
  ctx: Pick<Ctx, "userId" | "locale">,
  accountIds: readonly string[],
): Promise<Map<string, string>> {
  const wanted = new Set(accountIds);
  if (wanted.size === 0) return new Map();
  const accounts = (await listAccounts(ctx, { includeArchived: true })).filter(
    (account) => wanted.has(account.id) && account.provider !== null,
  );
  const sources = await sourcesOf(
    ctx,
    ctx.locale,
    accounts.map((account) => account.provider as string),
  );
  return new Map(
    accounts.flatMap((account) => {
      const source = sources.get(account.provider as string);
      return source ? [[account.id, source.name] as const] : [];
    }),
  );
}

/**
 * "Retry sending": an update of the source of the movement's account, now — the same pass a
 * scheduled update makes, so the movement is sent and the balance read after it. `start` is how
 * the application starts a pass of a provider. Says whether the movement went.
 */
export async function retrySend(
  ctx: ManualCtx,
  id: string,
  start: (provider: string) => Promise<unknown>,
): Promise<{ sent: boolean }> {
  if (!z.uuid().safeParse(id).success) throw new TransactionError("invalid");
  const waiting = (await transactionsByIds(ctx, [id])).get(id);
  if (!waiting) throw new TransactionError("not_found");
  if (waiting.origin !== "manual" || waiting.sendState === null) return { sent: waiting.origin !== "manual" };
  const account = await getAccount(ctx, waiting.accountId);
  if (!account || account.provider === null) throw new TransactionError("account_unavailable");
  await start(account.provider);
  const after = (await transactionsByIds(ctx, [id])).get(id);
  return { sent: after !== undefined && after.origin !== "manual" };
}

const accountIdOf = z.object({ accountId: z.uuid() });

/**
 * Refuses an account that is not the person's, is archived, or takes no manual movement. Says
 * whether the account's source takes the movement: then it waits for the next update.
 */
async function requireManualAccount(
  ctx: Pick<Ctx, "userId">,
  input: unknown,
): Promise<{ id: string; toSend: boolean }> {
  const named = accountIdOf.safeParse(input);
  if (!named.success) throw new TransactionError("invalid");
  const account = await getAccount(ctx, named.data.accountId);
  if (!account || account.state === "archived") throw new TransactionError("account_unavailable");
  const mode = (await modesOf([account])).get(account) ?? null;
  if (mode === null || !MANUAL_MOVEMENT_MODES.includes(mode)) {
    throw new TransactionError("account_unavailable");
  }
  return { id: account.id, toSend: mode === "two_way" };
}

/**
 * Writes a manual movement and the balance after it. The same key sent twice writes once. On a
 * "read and write" account the movement waits for the next update of its source (N3.1).
 */
export async function createManual(
  ctx: ManualCtx,
  input: unknown,
  idempotencyKey?: string,
): Promise<{ transaction: Transaction; created: boolean }> {
  const account = await requireManualAccount(ctx, input);
  const result = await createManualTransaction(ctx, input, idempotencyKey, { toSend: account.toSend });
  if (result.created) await rebuildDerivedBalances(ctx, [account.id], { manualChanged: true });
  return result;
}

/** Changes a manual movement and corrects the balance of the account, and of the one it left. */
export async function updateManual(ctx: ManualCtx, id: string, input: unknown): Promise<Transaction> {
  const account = await requireManualAccount(ctx, input);
  const { transaction, previousAccountId } = await updateManualTransaction(ctx, id, input, {
    toSend: account.toSend,
  });
  await rebuildDerivedBalances(ctx, [...new Set([account.id, previousAccountId])], { manualChanged: true });
  return transaction;
}

/** Deletes a manual movement and takes it out of the balance. */
export async function deleteManual(ctx: ManualCtx, id: string): Promise<void> {
  const { accountId } = await deleteManualTransaction(ctx, id);
  await rebuildDerivedBalances(ctx, [accountId], { manualChanged: true });
}

/**
 * Hide, restore and delete over a selection, with the balances kept right: a hidden manual
 * movement is out of the balance as it is out of the totals. The provider's rows change no balance.
 */
export async function changeVisibility(
  ctx: ManualCtx,
  ids: readonly string[],
  change: "hide" | "restore" | "delete",
): Promise<number> {
  const rows = await transactionsByIds(ctx, [...ids]);
  const accounts = [
    ...new Set([...rows.values()].filter((row) => row.origin === "manual").map((row) => row.accountId)),
  ];
  const count =
    change === "hide"
      ? await hideTransactions(ctx, ids)
      : change === "restore"
        ? await restoreTransactions(ctx, ids)
        : await deleteHiddenTransactions(ctx, ids);
  if (count > 0 && accounts.length > 0) await rebuildDerivedBalances(ctx, accounts, { manualChanged: true });
  return count;
}

/** What the dialog asks about before it saves. */
export interface ManualPreviewInput {
  accountId: string;
  kind: ManualKind;
  amountCents: Cents;
  on: CivilDate;
  /** The movement being changed, left out of the balance it is compared with. */
  editingId?: string;
}

/**
 * Today's balance of the account before and after the movement, from the rule that writes the
 * balance (`movementEffect`). `null` for an account that is not the person's.
 */
export async function previewManual(
  ctx: ManualCtx,
  input: ManualPreviewInput,
): Promise<{ account: string; effect: MovementEffect } | null> {
  const account = await getAccount(ctx, input.accountId);
  if (!account) return null;
  const [basis, manual] = await Promise.all([
    movementBasis(ctx, [account.id]),
    manualMovementsByAccount(ctx, [account.id]),
  ]);
  const all = manual.get(account.id) ?? [];
  const editing = all.find((movement) => movement.id === input.editingId);
  const effect = movementEffect(
    basis.get(account.id)?.readings ?? [],
    all,
    {
      on: input.on,
      cents: signedAmount(input.kind, input.amountCents),
      // A movement being changed keeps the moment it was written; a new one is written now.
      writtenAt: editing?.writtenAt ?? new Date(),
    },
    today(ctx.timeZone),
    editing,
  );
  return { account: account.name, effect };
}
