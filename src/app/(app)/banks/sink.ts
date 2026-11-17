// src/app/(app)/banks/sink.ts — the adapter that joins the plugin runtime's port to the modules
// (rewrite plan, rule M8: only the application joins a port and its adapter). The runtime asks
// for "tie these accounts", "write this balance", "write these movements"; this file answers
// with the accounts' and the transactions' own services, and holds no rule of its own beyond
// turning one shape into the other.
import "server-only";
import { ACCOUNT_TYPES } from "@/modules/accounts/rules";
import {
  AccountError,
  accountsOfProvider,
  accountsOpenToProvider,
  linkProviderAccounts,
  rebuildDerivedBalances,
  ibanOwnersOf,
  saveProviderBalance,
  saveSourceIbans,
} from "@/modules/accounts/service";
import type { IncomingTransaction } from "@/modules/transactions/rules";
import { categorise } from "@/modules/transactions/categorize/service";
import { categorisableAccountIds, upsertFromProvider } from "@/modules/transactions/service";
import { addSwitchCounts, openSwitches, openSwitchOf } from "@/modules/accounts/switching";
import { planTransfers } from "@/modules/transactions/switch-rules";
import { transferCandidates, writeTransferPairs } from "@/modules/transactions/switching";
import type { Ctx } from "@/platform/context";
import { type CivilDate, civilDateIn, wallClockIn } from "@/platform/dates";
import { getDb } from "@/platform/db/client";
import { isPluginProvider, pluginProvider } from "@/platform/integrations/rules";
import { connectionSharing } from "@/platform/plugins/service";
import { exposedAccounts } from "@/platform/plugins/sync";
import { parseCents } from "@/platform/money";
import { type BankSink, type ReadingMovement, SinkRefusal } from "@/platform/plugins/ports";

type AccountType = (typeof ACCOUNT_TYPES)[number];

function accountType(value: string): AccountType {
  const type = ACCOUNT_TYPES.find((one) => one === value);
  if (type === undefined) throw new SinkRefusal();
  return type;
}

/** Noon of the booking day in the person's zone: a movement of a bank has a day and no hour. */
const NOON_MINUTES = 12 * 60;

/** A movement of a bank as the transactions module takes one from any provider. */
function toIncoming(movement: ReadingMovement, timeZone: string): IncomingTransaction {
  const cents = parseCents(movement.amount);
  const credit = movement.direction === "credit";
  return {
    externalId: movement.externalId,
    counterpartExternalId: null,
    occurredAt: wallClockIn(movement.day, NOON_MINUTES, timeZone),
    amountCents: credit ? cents : -cents,
    currency: movement.currency,
    type: credit ? "income" : "expense",
    state: "cleared",
    payee: movement.payee,
    note: movement.note,
    // A bank gives no category: the cascade gives one after the reading (`afterReading`).
    categoryExternalId: null,
    categoryName: null,
    categoryGroupExternalId: null,
    categoryGroupName: null,
    labels: [],
    raw: movement.raw,
  };
}

export const bankSink: BankSink = {
  async openAccounts(ctx) {
    return (await accountsOpenToProvider(ctx)).map(({ id, name, currency }) => ({ id, name, currency }));
  },

  async linkAccounts(ctx, provider, choices, now) {
    try {
      return await linkProviderAccounts(
        ctx,
        provider,
        choices.map((choice) => ({
          providerAccountId: choice.providerAccountId,
          currency: choice.currency,
          target:
            choice.target.kind === "new"
              ? { kind: "new", name: choice.target.name, type: accountType(choice.target.type) }
              : choice.target,
          iban: choice.iban ?? null,
        })),
        now,
      );
    } catch (error) {
      if (error instanceof AccountError) {
        throw new SinkRefusal(error.code === "iban_exists" ? "iban_exists" : "refused");
      }
      throw error;
    }
  },

  async ibanOwners(ctx, numbers) {
    return ibanOwnersOf(ctx, numbers);
  },

  async saveIbans(ctx, given) {
    await saveSourceIbans(ctx, given);
  },

  async linkedAccounts(ctx, provider) {
    const linked = await accountsOfProvider(ctx, provider);
    return new Map([...linked].map(([key, account]) => [key, { id: account.id, name: account.name }]));
  },

  async writeBalance(ctx, accountId, reading, now) {
    await saveProviderBalance(ctx, accountId, { on: reading.on, cents: parseCents(reading.amount) }, now);
  },

  async writeMovements(ctx, target, movements, now) {
    // An account moved here from another source keeps that source's history up to the cut: the
    // bank's movements of those days are not written, or "only in the bank" and "to check" would
    // become doubles (rewrite plan N4, 04-now.md §4.6.1 point 12).
    const open = await openSwitchOf(ctx, target.accountId);
    const cut = open !== null && open.toProvider === target.provider ? (open.cutDate as CivilDate) : null;
    const kept = cut === null ? movements : movements.filter((movement) => movement.day > cut);
    const outcome = await upsertFromProvider(
      ctx,
      target.accountId,
      kept.map((movement) => toIncoming(movement, ctx.timeZone)),
      { provider: target.provider, now },
    );
    return { created: outcome.created, updated: outcome.updated, skipped: outcome.skipped };
  },

  async afterReading(ctx, accountIds) {
    await rebuildDerivedBalances(ctx, accountIds);
    // A bank gives no category: the cascade reads what the reading brought (rewrite plan N3). It
    // reads only the accounts whose source gives none, so a movement that came with its own
    // category is never touched.
    await categorise(ctx, await categorisableAccountIds(ctx));
    await laterTransfers(ctx, accountIds);
  },
};

/**
 * After every reading of a bank: the transfers between a switched account and the other accounts of
 * its bank that arrived after the switch (H40, "also for the movements to come"). They belong to
 * the switch: "Undo switch" puts them back too.
 */
async function laterTransfers(
  ctx: Pick<Ctx, "userId" | "timeZone">,
  accountIds: readonly string[],
): Promise<void> {
  for (const open of await openSwitches(ctx)) {
    if (!accountIds.includes(open.accountId) || !isPluginProvider(open.toProvider)) continue;
    const pluginId = open.toProvider.slice(pluginProvider("").length);
    // The bank's connection of today, not the one of the switch: a bank disconnected and connected
    // again has a new connection, and the switch stays open across it.
    const sharing = await connectionSharing(ctx, pluginId, open.toProviderAccountId);
    if (sharing === null) continue;
    const exposed = await exposedAccounts(
      ctx,
      { pluginId, connectionId: sharing.connection.id },
      bankSink,
    ).catch(() => null);
    if (exposed === null) continue;
    const others = exposed.accounts.flatMap((one) =>
      one.linked && one.linked.id !== open.accountId ? [one.linked.id] : [],
    );
    const since = civilDateIn(open.appliedAt, ctx.timeZone);
    const candidates = await transferCandidates(ctx, [open.accountId, ...others], since);
    const plan = planTransfers(open.accountId, others, candidates);
    if (plan.pairs.length === 0) continue;
    const count = await getDb().transaction((tx) => writeTransferPairs(tx, ctx, open.id, plan.pairs));
    await addSwitchCounts(ctx, open.id, { transfers: count });
  }
}
