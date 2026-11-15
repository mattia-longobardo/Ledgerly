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
  releaseProviderAccounts,
  saveProviderBalance,
} from "@/modules/accounts/service";
import type { IncomingTransaction } from "@/modules/transactions/rules";
import { upsertFromProvider } from "@/modules/transactions/service";
import { wallClockIn } from "@/platform/dates";
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
    // A bank gives no category: the automatic categories are a later release (N3).
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
        })),
        now,
      );
    } catch (error) {
      if (error instanceof AccountError) throw new SinkRefusal();
      throw error;
    }
  },

  async linkedAccounts(ctx, provider) {
    const linked = await accountsOfProvider(ctx, provider);
    return new Map([...linked].map(([key, account]) => [key, { id: account.id, name: account.name }]));
  },

  async releaseAccounts(ctx, provider, providerAccountIds) {
    await releaseProviderAccounts(ctx, provider, providerAccountIds);
  },

  async writeBalance(ctx, accountId, reading, now) {
    await saveProviderBalance(ctx, accountId, { on: reading.on, cents: parseCents(reading.amount) }, now);
  },

  async writeMovements(ctx, target, movements, now) {
    const outcome = await upsertFromProvider(
      ctx,
      target.accountId,
      movements.map((movement) => toIncoming(movement, ctx.timeZone)),
      { provider: target.provider, now },
    );
    return { created: outcome.created, updated: outcome.updated, skipped: outcome.skipped };
  },

  async afterReading(ctx, accountIds) {
    await rebuildDerivedBalances(ctx, accountIds);
  },
};
