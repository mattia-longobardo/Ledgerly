// src/app/(app)/settings/plugins/core-cases.ts — what the card of a provider of the core does, for
// the person of `ctx` and by the provider's id (rewrite plan R5c anticipated): the Server Actions of
// the cards and `/api/v1/connections` call the same steps. Each provider's part is its card, in its own
// folder of the domain (`CoreCard`); what joins modules — the accounts kept by hand that come back, the
// removals of days that go with the link, the checks after a reading — is here, by the kinds the
// provider reads (`KINDS_OF`), so no provider is named (rule M12).
import "server-only";
import { restoreSourceAccounts } from "@ledgerly/domain/accounts";
import type { Ctx } from "@ledgerly/domain/platform/context";
import {
  type CardAccount,
  type CardError,
  type CardResult,
  type Connection,
  type CoreCard,
  deleteConnection,
  IntegrationError,
  isKnownProvider,
  KINDS_OF,
  listConnections,
  type SyncKind,
} from "@ledgerly/domain/platform/integrations";
import { calendarCard } from "@ledgerly/domain/platform/integrations/calendar";
import { enqueue } from "@ledgerly/domain/platform/jobs";
import { sourceCard } from "@ledgerly/domain/platform/integrations/source";
import { closePendingDeletes } from "@ledgerly/domain/timeoff";
import { tasks } from "@/platform/jobs/queue";

const CARDS: readonly CoreCard[] = [sourceCard, calendarCard];

/** The card of a provider of the core; `null` for a plugin, an investment service or nobody. */
export const coreCardOf = (provider: string): CoreCard | null =>
  CARDS.find((card) => card.provider === provider) ?? null;

const reads = (provider: string, kind: SyncKind): boolean =>
  isKnownProvider(provider) && KINDS_OF[provider].some((one: SyncKind) => one === kind);

const NOT_CONNECTED = { ok: false, error: "notConnected" } as const;

/** The person's connection of `provider`, or `null` when nothing has ever been saved. */
async function connectionOf(ctx: Ctx, provider: string): Promise<Connection | null> {
  return (await listConnections(ctx)).find((connection) => connection.provider === provider) ?? null;
}

/**
 * Stores the credential, the first one or a replacement, without asking the provider: a provider that is
 * down must not stop a correct credential being kept, and «Test connection» is the button that asks.
 * The accounts kept by hand come back to the source before it can be read, so no reading makes them twice.
 */
export async function connectCore(
  ctx: Ctx,
  provider: string,
  input: Readonly<Record<string, string>>,
): Promise<{ ok: true; id: string; back: number } | { ok: false; error: CardError; input: boolean }> {
  const card = coreCardOf(provider);
  // Nobody's card: a plugin or a service of Investments connects another way.
  if (!card) return { ...NOT_CONNECTED, input: false };
  const checked = card.credentials(input);
  if (!checked.ok) return { ...checked, input: true };
  const back = await restoreSourceAccounts(ctx, provider);
  try {
    const saved = await card.save(ctx, checked.credentials);
    return { ok: true, id: saved.id, back };
  } catch (error) {
    // `IntegrationError` carries a code, never the value it rejected: nothing here prints a credential.
    if (error instanceof IntegrationError) return { ok: false, error: card.saveRefused, input: false };
    throw error;
  }
}

/** «Sync now»: a reading that brings movements is followed by the checks of a sync (docs/scheduler.md). */
async function syncNow(ctx: Ctx, card: CoreCard, connection: Connection): Promise<CardResult> {
  const outcome = await card.sync(ctx, connection);
  if (outcome.ok && reads(card.provider, "transactions")) await enqueue(tasks.afterSync("manual"));
  return outcome;
}

/** «Update now», «Test the connection», «Download the history again» of the person's own connection. */
export async function runCore(
  ctx: Ctx,
  provider: string,
  kind: "update" | "test" | "history",
  months?: number,
): Promise<CardResult> {
  const card = coreCardOf(provider);
  const connection = card && (await connectionOf(ctx, provider));
  if (!card || !connection) return NOT_CONNECTED;
  if (kind === "test") return card.test(ctx, connection);
  if (kind === "history") {
    if (!card.history) return NOT_CONNECTED;
    const asked = await card.history(ctx, connection, months ?? 0);
    if (!asked.ok) return asked;
  }
  return syncNow(ctx, card, connection);
}

/** «Choose the accounts»: the accounts the source has now. */
export async function coreAccounts(
  ctx: Ctx,
  provider: string,
): Promise<{ ok: true; accounts: CardAccount[] } | { ok: false; error: CardError }> {
  const card = coreCardOf(provider);
  const connection = card?.accounts && (await connectionOf(ctx, provider));
  if (!card?.accounts || !connection) return NOT_CONNECTED;
  return card.accounts(ctx, connection);
}

/**
 * Saves which accounts of the source arrive here. When one comes back, the history is read again and
 * the pass runs now: the account and its movements are here when the dialog closes.
 */
export async function chooseCoreAccounts(
  ctx: Ctx,
  provider: string,
  chosen: readonly string[],
): Promise<{ ok: true; added: number } | { ok: false; error: CardError }> {
  const card = coreCardOf(provider);
  const connection = card?.choose && (await connectionOf(ctx, provider));
  if (!card?.choose || !connection) return NOT_CONNECTED;
  const outcome = await card.choose(ctx, connection, chosen);
  if (!outcome.ok || outcome.added === 0) return outcome;
  const read = await syncNow(ctx, card, connection);
  return read.ok ? outcome : read;
}

/**
 * Drops the credential and the connection's own history; the accounts and movements stay. A source of
 * days takes with it every removal still waiting to be sent: nobody is left to tell (plan F7 §3.4.10).
 */
export async function disconnectCore(ctx: Ctx, provider: string): Promise<CardResult> {
  const connection = coreCardOf(provider) && (await connectionOf(ctx, provider));
  if (!connection) return NOT_CONNECTED;
  try {
    await deleteConnection(ctx, connection.id);
    if (reads(provider, "leave")) await closePendingDeletes(ctx);
  } catch (error) {
    if (error instanceof IntegrationError) {
      return { ok: false, error: error.code === "not_found" ? "notConnected" : "failed" };
    }
    throw error;
  }
  return { ok: true };
}
