/**
 * Reconciles one user's local accounts with what a provider currently reports.
 *
 * Provider-agnostic on purpose: it never sees a Wallet field, only the
 * `ProviderAccount` an adapter hands it. Three rules carry most of the weight:
 *
 *  - Adoption. An account the user (or an import) created by hand is claimed
 *    rather than duplicated when its name matches one the provider reports.
 *    This is what re-links accounts that already exist locally instead of
 *    leaving the user with two of everything.
 *  - The name rule. The provider's name is remembered on the link, and a
 *    provider rename is applied only while the local name still equals it — so
 *    a name the user chose is never overwritten.
 *  - Nothing is ever deleted. An account that vanishes upstream, or is archived
 *    there, becomes `unavailable`; its history stays.
 */

import { assertPermission, PermissionDeniedError, type Principal } from "@/platform/auth/principal";
import type { Account, AccountStatus } from "../domain/account";
import type { UseCaseDeps } from "./deps";
import type { AccountPatch, AccountsSource, NewBalance, ProviderAccount } from "./ports";

/**
 * Who may pull from a provider. The API route and the Server Action are the two
 * callers and each used to check `integrations.manage` on its own, which let an
 * admin start a sync that rewrites another household member's account graph.
 * Until Phase 2 gives connections a per-user owner, the household owner is the
 * only principal allowed to run one — the check lives here so the two callers
 * cannot drift.
 */
export function assertWalletSyncAllowed(principal: Principal): void {
  assertPermission(principal, "integrations.manage");
  if (!principal.roles.includes("owner")) throw new PermissionDeniedError("integrations.manage");
}

export interface SyncProviderAccountsResult {
  created: number;
  updated: number;
  adopted: number;
  balances: number;
  missing: number;
}

export type SyncProviderAccountsDeps = UseCaseDeps & { source: AccountsSource };

/** The provider owns availability; only the user can archive. */
function nextStatus(current: AccountStatus, incoming: ProviderAccount): AccountStatus {
  if (incoming.archived) return "unavailable";
  return current === "archived" ? "archived" : "active";
}

function sameName(a: string, b: string): boolean {
  return a.trim().toLowerCase() === b.trim().toLowerCase();
}

/**
 * Best-effort patch. Losing the version race means a person edited the account
 * while the job was running; their edit wins and the next run reconciles from
 * the newer row, so there is nothing to retry or report here.
 */
async function patch(
  deps: SyncProviderAccountsDeps,
  userId: string,
  account: Account,
  changes: AccountPatch,
): Promise<Account | null> {
  if (Object.keys(changes).length === 0) return account;
  const result = await deps.accounts.update(userId, account.id, account.version, changes);
  return result === null || result === "version_mismatch" ? null : result;
}

function balanceRow(accountId: string, incoming: ProviderAccount, capturedAt: Date): NewBalance {
  return {
    accountId,
    asOf: incoming.asOf,
    balance: incoming.balance,
    available: incoming.available,
    source: "provider",
    capturedAt,
  };
}

export function syncProviderAccounts(deps: SyncProviderAccountsDeps) {
  /**
   * `prefetched` exists so the caller can do the provider round trip *before*
   * opening the database transaction. A slow provider otherwise holds one of
   * the pool's eight connections — and, inside a job, an advisory lock — for
   * the whole conversation.
   */
  return async (
    userId: string,
    prefetched?: readonly ProviderAccount[],
  ): Promise<SyncProviderAccountsResult> => {
    const { provider } = deps.source;
    const now = deps.clock.now();
    const incoming = prefetched ?? (await deps.source.fetchAccounts());
    const externalIds = incoming.map((a) => a.externalId);
    const links = await deps.links.byExternal(userId, provider, "account", externalIds);

    // Adoption candidates, read once: accounts nothing owns yet. Claimed ones
    // are removed as we go, so two provider accounts sharing a name cannot both
    // land on the same local row.
    const candidates = (await deps.accounts.list(userId, { includeArchived: true })).filter(
      (a) => a.origin === "manual",
    );

    const result: SyncProviderAccountsResult = { created: 0, updated: 0, adopted: 0, balances: 0, missing: 0 };
    const balances: NewBalance[] = [];

    for (const account of incoming) {
      const link = links.get(account.externalId);
      // A link can outlive its account: once a link is flagged missing the
      // account is deletable, and the row is left behind pointing at nothing.
      // Such a link is treated as no link at all — the adopt/create path below
      // re-points it at the new account, which is safe precisely because that
      // account is brand new and so has no link of its own to collide with
      // under the unique index on (provider, entity).
      const current = link ? await deps.accounts.get(userId, link.entityId) : null;

      if (link && current) {
        const changes: AccountPatch = {};
        const status = nextStatus(current.status, account);
        if (status !== current.status) changes.status = status;
        const knownName = link.metadata.providerName;
        if (typeof knownName === "string" && current.name === knownName && account.name !== current.name) {
          changes.name = account.name;
        }
        await patch(deps, userId, current, changes);
        // Seeing it again also revives a link that a previous run flagged missing.
        await deps.links.upsertSeen(
          userId,
          {
            provider,
            entityType: "account",
            entityId: link.entityId,
            externalId: link.externalId,
            metadata: { ...link.metadata, providerName: account.name },
          },
          now,
        );
        result.updated += 1;
        balances.push(balanceRow(current.id, account, now));
        continue;
      }

      const index = candidates.findIndex((c) => sameName(c.name, account.name));
      let entity: Account | null;
      if (index === -1) {
        entity = await deps.accounts.create({
          userId,
          groupId: null,
          name: account.name,
          type: account.type,
          currency: account.currency,
          origin: "synced",
          provider,
          status: account.archived ? "unavailable" : "active",
          includeInNetWorth: true,
          notes: null,
          sortOrder: 0,
        });
        result.created += 1;
      } else {
        const [candidate] = candidates.splice(index, 1);
        // The local name is kept as it is: the user picked it.
        entity = await patch(deps, userId, candidate!, {
          origin: "synced",
          provider,
          status: nextStatus(candidate!.status, account),
        });
        if (entity) result.adopted += 1;
      }
      if (!entity) continue;

      await deps.links.upsertSeen(
        userId,
        {
          provider,
          entityType: "account",
          entityId: entity.id,
          externalId: account.externalId,
          metadata: { providerName: account.name },
        },
        now,
      );
      balances.push(balanceRow(entity.id, account, now));
    }

    if (balances.length > 0) await deps.accounts.recordBalances(balances);
    result.balances = balances.length;

    // Gone from the provider's list. The link is flagged and the account goes
    // dark, keeping its balances; one the user archived stays archived.
    const missing = await deps.links.markMissing(userId, provider, "account", externalIds, now);
    for (const entityId of missing) {
      const account = await deps.accounts.get(userId, entityId);
      if (!account || account.status !== "active") continue;
      await patch(deps, userId, account, { status: "unavailable" });
    }
    result.missing = missing.length;

    await deps.audit({
      actorUserId: userId,
      action: "accounts.sync",
      entityType: "provider_connection",
      entityId: provider,
      after: { ...result },
    });

    return result;
  };
}
