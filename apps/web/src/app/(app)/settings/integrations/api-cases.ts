// src/app/(app)/settings/integrations/api-cases.ts — the use cases of the connections and the
// banks that the web process lends `/api/v1` (rewrite plan R2), as it lends its guard: they need
// the web's registry of providers and its bank sink until E5 and R4. The Server Actions of these
// pages call the same functions; the providers of the core by their cards (`core-cases.ts`).
import "server-only";
import type { ConnectionCases } from "@ledgerly/api";
import type { Ctx } from "@ledgerly/domain/platform/context";
import { exposedAccounts } from "@ledgerly/plugin-host";
import { presenceOf } from "../../banks/presence";
import { bankSink } from "../../banks/sink";
import {
  cancelBankConnection,
  importBankAccounts,
  listBanks,
  renewBankAccess,
  retryBankReading,
  startBankAccess,
} from "../../banks/connect/cases";
import { connectionList } from "./connection-list";
import { runConnection } from "./connection-cases";
import { chooseCoreAccounts, connectCore, coreAccounts, disconnectCore, runCore } from "./core-cases";
import { bringBackAccount, deactivationCountsOf, turnOffSource } from "./deactivate-cases";

const pluginIdOf = (provider: string) => provider.slice("plugin:".length);

/** "Test" and "history" of a provider of the core: its card, for the person of the call. */
const coreOf = (ctx: Ctx) => (provider: string, kind: "update" | "test" | "history", months?: number) =>
  runCore(ctx, provider, kind, months);

export const connectionCases: ConnectionCases = {
  list: connectionList,
  async run(ctx, connectionId, kind, { months, headers }) {
    const outcome = await runConnection(ctx, connectionId, kind, {
      months,
      presence: presenceOf(headers),
      core: coreOf(ctx),
    });
    return outcome.ok
      ? { ok: true }
      : { ok: false, refusal: outcome.refusal, found: outcome.connection !== null };
  },
  async exposedAccounts(ctx, connection) {
    const exposed = await exposedAccounts(
      ctx,
      { pluginId: pluginIdOf(connection.provider), connectionId: connection.id },
      bankSink,
    );
    return {
      ok: true,
      accounts: exposed.accounts.map((account) => ({
        providerAccountId: account.providerAccountId,
        name: account.name ?? account.identifier ?? account.providerAccountId,
        currency: account.currency,
        here: account.linked?.name ?? null,
        chosen: exposed.chosen && !exposed.skipped.includes(account.providerAccountId),
      })),
    };
  },
  async importAccounts(ctx, connection, decisions, headers) {
    const exposed = await exposedAccounts(
      ctx,
      { pluginId: pluginIdOf(connection.provider), connectionId: connection.id },
      bankSink,
    );
    const currencyOf = new Map(
      exposed.accounts.map((account) => [account.providerAccountId, account.currency]),
    );
    if (decisions.some((one) => !currencyOf.has(one.providerAccountId)))
      return { ok: false, error: "invalid_data" };
    const choices = decisions.map((one) =>
      one.target.kind === "skip"
        ? { providerAccountId: one.providerAccountId, target: one.target }
        : { ...one, target: one.target, currency: currencyOf.get(one.providerAccountId) ?? "" },
    );
    return importBankAccounts(ctx, connection.id, choices, presenceOf(headers));
  },
  listBanks,
  readBankNow: (ctx, connectionId, headers) => retryBankReading(ctx, connectionId, presenceOf(headers)),
  cancelBank: cancelBankConnection,
  deactivation: deactivationCountsOf,
  turnOff: (ctx, slug, headers) =>
    turnOffSource(ctx, slug, { presence: presenceOf(headers), core: coreOf(ctx) }),
  bringBack: (ctx, slug, externalId, headers) =>
    bringBackAccount(ctx, slug, externalId, { presence: presenceOf(headers), core: coreOf(ctx) }),
  startBankAccess,
  renewBankAccess,
  connectCore,
  coreAccounts: (ctx, connection) => coreAccounts(ctx, connection.provider),
  chooseCoreAccounts: (ctx, connection, chosen) => chooseCoreAccounts(ctx, connection.provider, chosen),
  disconnectCore: (ctx, connection) => disconnectCore(ctx, connection.provider),
};
