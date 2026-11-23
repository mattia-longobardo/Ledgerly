// src/app/(app)/settings/plugins/connection-cases.ts — what can be done to one of the person's
// connections, by id: "Update now", "Turn on again", "Turn on", "Test the connection", "Download
// the history again" (ux/n2-connection-status.md §2.4). The answer is a code: `/api/v1/connections`
// turns it into a code of the contract, which the row translates.
import "server-only";
// "Update now" can start the sync of a plugin's connection: the plugins' passes have to be registered.
import "@/app/plugin-wiring";
import { AccountError } from "@ledgerly/domain/accounts";
import {
  checkSyncNow,
  InvestmentError,
  listInvestmentAccounts,
  providerOf,
  SyncError,
} from "@ledgerly/domain/investments";
import type { Ctx } from "@ledgerly/domain/platform/context";
import {
  type Connection,
  findConnection,
  IntegrationError,
  isPluginProvider,
  makeDueNow,
  saveSchedule,
} from "@ledgerly/domain/platform/integrations";
import { enqueue } from "@ledgerly/domain/platform/jobs";
import { BANK_SCHEDULE, isBankPluginProvider } from "@ledgerly/domain/platform/plugins";
import { historyOf, PluginActionError, type Presence, setPluginActive } from "@ledgerly/plugin-host";
import { tasks } from "@/platform/jobs/queue";
import { answered, CODE_OF_ANSWER, type Refusal } from "./connection-codes";
import { recommendedSchedule } from "./recommended-schedule";

type ConnectionKind = "update" | "resume" | "enable" | "test" | "history";

type ConnectionOutcome =
  { ok: true; connection: Connection } | { ok: false; refusal: Refusal; connection: Connection | null };

const pluginIdOf = (provider: string) => provider.slice("plugin:".length);

/** The code of an Investments refusal, as `syncNowAction` gave it. */
function investmentCode(error: unknown): string {
  if (error instanceof InvestmentError || error instanceof SyncError || error instanceof AccountError)
    return error.code;
  if (error instanceof Error && (error.name === "ZodError" || error instanceof RangeError)) return "invalid";
  throw error;
}

/**
 * "Update now": a reading the person asked for, put in the worker's queue (rewrite plan R1). The
 * answer does not wait for the provider: the reading's outcome is in the row, as after a scheduled
 * pass. An investment service is checked here first (connected, a minute since its last run).
 */
async function update(ctx: Ctx, connection: Connection, presence: Presence | null): Promise<Refusal | null> {
  if (providerOf(connection.provider) !== null) {
    const service = (await listInvestmentAccounts(ctx)).find((one) => one.provider === connection.provider);
    if (!service) return "failed";
    try {
      const checked = await checkSyncNow(ctx, service.accountId);
      await enqueue(tasks.updateConnection(ctx.userId, checked.connection.id, null));
      return null;
    } catch (error) {
      return CODE_OF_ANSWER[investmentCode(error)] ?? "failed";
    }
  }
  await enqueue(
    tasks.updateConnection(
      ctx.userId,
      connection.id,
      (await isBankPluginProvider(connection.provider)) ? presence : null,
    ),
  );
  return null;
}

/** What the card of a plugin read by the core answers to "test" or "history" (`core-cases.ts`). */
export type CoreConnection = (
  provider: string,
  kind: "test" | "history",
  months?: number,
) => Promise<{ ok: true } | { ok: false; error: string }>;

type Options = { months?: number; presence: Presence | null; core: CoreConnection };

/** One function per kind; each answers `null` when it went through, or the refusal. */
const ACTIONS: Record<
  ConnectionKind,
  (ctx: Ctx, connection: Connection, options: Options) => Promise<Refusal | null>
> = {
  update: (ctx, connection, options) => update(ctx, connection, options.presence),
  async resume(ctx, connection) {
    const schedule = (await isBankPluginProvider(connection.provider))
      ? BANK_SCHEDULE
      : recommendedSchedule(connection.provider);
    await saveSchedule(ctx, connection.id, schedule);
    return null;
  },
  async enable(ctx, connection) {
    if (!isPluginProvider(connection.provider)) return "failed";
    await setPluginActive(ctx, { pluginId: pluginIdOf(connection.provider), active: true });
    // A reading for each of its connections: they are due now, and the next tick reads them.
    await makeDueNow(ctx, connection.provider);
    return null;
  },
  test: async (_ctx, connection, options) => answered(await options.core(connection.provider, "test")),
  async history(_ctx, connection, options) {
    // "Download the history again": only for a provider that reads a chosen depth.
    const choices = (await historyOf(connection.provider))?.choices ?? [];
    if (options.months === undefined || !choices.includes(options.months)) return "failed";
    return answered(await options.core(connection.provider, "history", options.months));
  },
};

/** Does one thing to one of the person's connections; another person's id is not found. */
export async function runConnection(
  ctx: Ctx,
  connectionId: string,
  kind: ConnectionKind,
  options: Options,
): Promise<ConnectionOutcome> {
  const connection = await findConnection(ctx, connectionId);
  if (!connection) return { ok: false, refusal: "failed", connection: null };
  try {
    const refusal = await ACTIONS[kind](ctx, connection, options);
    return refusal === null ? { ok: true, connection } : { ok: false, refusal, connection };
  } catch (error) {
    if (error instanceof PluginActionError)
      return { ok: false, refusal: CODE_OF_ANSWER[error.code] ?? error.code, connection };
    if (error instanceof IntegrationError) return { ok: false, refusal: "failed", connection };
    throw error;
  }
}
