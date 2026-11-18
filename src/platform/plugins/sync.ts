/**
 * Reading a bank through its plugin and handing what was read to the domain (rewrite plan,
 * 04-now.md §4.1 and §4.2): the choice of the accounts, the first reading right after it, the
 * three automatic readings a day and "Sync now".
 *
 * The plugin is asked outside any transaction; its answer has already passed the contract's
 * schema (`callPlugin`); the writes go through the port (`ports.ts`), which the application
 * fills with the modules' own services. A failure is a code of a closed list, never a message.
 */
import "server-only";
import { z } from "zod";
import type { Ctx } from "@/platform/context";
import { addDays, type CivilDate, civilDateIn } from "@/platform/dates";
import { pluginProvider } from "@/platform/integrations/rules";
import {
  changeSourceSkippedIds,
  type Connection,
  finishRun,
  markConnection,
  readCredentials,
  readSyncJob,
  recordRun,
  savePluginConnection,
  saveSchedule,
  saveSyncJob,
} from "@/platform/integrations/service";
import { withJobLock } from "@/platform/jobs/lock";
import { callPlugin, PluginCallError } from "./client";
import {
  PLUGIN_PATHS,
  type PluginAccount,
  type SyncResponse,
  syncResponseSchema,
} from "@ledgerly/plugin-contract";
import { type AccountChoice, type BankSink, type ReadingMovement, SinkRefusal } from "./ports";
import { listPluginConnections } from "./queries";
import {
  BANK_SCHEDULE,
  movementIds,
  pickBalance,
  providerAccountIdOf,
  RATE_LIMIT_WAIT_HOURS,
  type ReadingError,
  REREAD_DAYS,
} from "./rules";
import {
  connectionBag,
  type Deps,
  markCredentialsInvalid,
  PluginActionError,
  type Presence,
  readBag,
  requireActivePlugin,
  requireUserCredentials,
} from "./service";

type Who = Pick<Ctx, "userId" | "timeZone">;

const SYNC_TIMEOUT_MS = 60_000;
/** The calls one reading makes at most: a reading that does not end is cut, not left running. */
const MAX_SYNC_CALLS = 12;
/** After this long a reading the person waits for starts no new call (a browser does not wait for ever). */
const PRESENT_BUDGET_MS = 30_000;
/** The same for an automatic reading, which nobody waits for. */
const AUTOMATIC_BUDGET_MS = 240_000;

/** What one account the bank exposes is for the person, on the step "choose the accounts". */
export interface ExposedAccount {
  providerAccountId: string;
  name: string | null;
  identifier: string | null;
  currency: string;
  kind: string | null;
  /** The account here it is already tied to, when it is. */
  linked: { id: string; name: string } | null;
}

async function requireConnection(ctx: Who, pluginId: string, connectionId: string): Promise<Connection> {
  const connection = (await listPluginConnections(ctx, pluginId)).find((one) => one.id === connectionId);
  if (!connection) throw new PluginActionError("not_found");
  return connection;
}

/** The accounts the bank exposed with the access of a connection, and what each is tied to. */
export async function exposedAccounts(
  ctx: Who,
  input: { pluginId: string; connectionId: string },
  sink: BankSink,
): Promise<{ accounts: ExposedAccount[]; chosen: boolean; skipped: string[] }> {
  const connection = await requireConnection(ctx, input.pluginId, input.connectionId);
  const bag = readBag(await readCredentials(ctx, connection.id));
  const linked = await sink.linkedAccounts(ctx, connection.provider);
  return {
    chosen: bag.chosen,
    skipped: bag.skipped,
    accounts: bag.accounts.map((account) => ({
      providerAccountId: providerAccountIdOf(account),
      name: account.name,
      identifier: account.identifier,
      currency: account.currency,
      kind: account.kind,
      linked: linked.get(providerAccountIdOf(account)) ?? null,
    })),
  };
}

/** What the person chose for one exposed account: tie it as the choice says, or leave it out. */
export type AccountDecision = AccountChoice | { providerAccountId: string; target: { kind: "skip" } };

/**
 * Applies the choice of the accounts (ux/n1-plugin-bank.md §6.4): ties each chosen account,
 * marks the connection as complete and gives it its three readings a day. At least one account
 * of the bank has to be tied when this ends. The first reading is the caller's next call.
 */
export async function chooseAccounts(
  ctx: Who,
  input: { pluginId: string; connectionId: string; decisions: readonly AccountDecision[] },
  sink: BankSink,
  now: Date = new Date(),
): Promise<void> {
  await requireActivePlugin(ctx, input.pluginId);
  const connection = await requireConnection(ctx, input.pluginId, input.connectionId);
  const bag = readBag(await readCredentials(ctx, connection.id));
  const exposed = new Map(bag.accounts.map((account) => [providerAccountIdOf(account), account]));
  const choices: AccountChoice[] = [];
  const skipped = new Set(bag.skipped);
  for (const decision of input.decisions) {
    const account = exposed.get(decision.providerAccountId);
    if (!account) throw new PluginActionError("failed");
    if (decision.target.kind === "skip") {
      skipped.add(decision.providerAccountId);
      continue;
    }
    skipped.delete(decision.providerAccountId);
    // The currency is the bank's, never the form's.
    choices.push({
      providerAccountId: decision.providerAccountId,
      currency: account.currency,
      target: decision.target,
      iban: account.identifier,
    });
  }
  const before = await sink.linkedAccounts(ctx, connection.provider);
  const tied = bag.accounts.filter((account) => before.has(providerAccountIdOf(account))).length;
  if (choices.length + tied === 0) throw new PluginActionError("no_choice");
  try {
    await sink.linkAccounts(ctx, connection.provider, choices, now);
  } catch (error) {
    if (error instanceof SinkRefusal) {
      throw new PluginActionError(error.reason === "iban_exists" ? "iban_exists" : "failed");
    }
    throw error;
  }
  await savePluginConnection(
    ctx,
    {
      provider: connection.provider,
      instanceKey: connection.instanceKey,
      credentials: connectionBag(bag.sessionId, bag.accounts, { chosen: true, skipped: [...skipped] }),
      expiresAt: connection.expiresAt,
    },
    now,
  );
  await changeSourceSkippedIds(ctx, connection.provider, {
    add: skipped,
    remove: choices.map((choice) => choice.providerAccountId),
  });
  await saveSchedule(ctx, connection.id, BANK_SCHEDULE, now);
  // An account tied after the first reading (chosen later, or deleted and chosen again) has no
  // history here: the next reading reads it alone, from the start, before the usual ones (PERS-419).
  const tiedNow = choices.map((choice) => choice.providerAccountId);
  const job = await readSyncJob(ctx, connection.id, "transactions");
  if (tiedNow.length > 0 && job?.cursor?.coveredTo !== undefined) {
    const fresh = new Set([...freshAccounts(job.cursor), ...tiedNow]);
    await saveSyncJob(ctx, connection.id, "transactions", {
      cursor: { ...job.cursor, [FRESH]: JSON.stringify([...fresh].sort()) },
    });
  }
}

/** The cursor key of the accounts to read from the start at the next reading. */
const FRESH = "fresh";

function freshAccounts(cursor: Record<string, string> | null | undefined): string[] {
  try {
    const parsed = z.array(z.string()).safeParse(JSON.parse(cursor?.[FRESH] ?? "[]"));
    return parsed.success ? parsed.data : [];
  } catch {
    return [];
  }
}

/**
 * A new access to a bank that was disconnected (§5.4): the accounts it exposes whose id is still
 * tied here go back to their accounts by themselves, and the connection is complete, so "Choose
 * the accounts" asks only for the accounts never seen. An archived account stays archived: the
 * tie comes back, the account comes back to the lists only when the person restores it. Returns
 * whether any account was tied back; the first reading is the caller's next call.
 */
export async function tieBack(
  ctx: Who,
  input: { pluginId: string; connectionId: string },
  sink: BankSink,
  now: Date = new Date(),
): Promise<boolean> {
  const connection = await requireConnection(ctx, input.pluginId, input.connectionId);
  const bag = readBag(await readCredentials(ctx, connection.id));
  if (bag.chosen) return false;
  const linked = await sink.linkedAccounts(ctx, connection.provider);
  if (!bag.accounts.some((account) => linked.has(providerAccountIdOf(account)))) return false;
  await chooseAccounts(ctx, { ...input, decisions: [] }, sink, now);
  return true;
}

/** What a reading did, or why it did nothing. */
export type ReadingOutcome =
  | { ok: true; created: number; updated: number; accountErrors: number; complete: boolean }
  | { ok: false; error: ReadingError | "busy" | "not_active" | "not_chosen"; retryAt: Date | null };

interface ReadingInput {
  pluginId: string;
  connectionId: string;
  /** The person's address and browser when they asked for this reading; `null` for an automatic one. */
  presence: Presence | null;
}

function refusal(
  error: Extract<ReadingOutcome, { ok: false }>["error"],
  retryAt: Date | null = null,
): ReadingOutcome {
  return { ok: false, error, retryAt };
}

/** A movement of the contract as the domain takes it. */
function toMovement(
  externalId: string,
  transaction: SyncResponse["transactions"][number],
): ReadingMovement | null {
  const day = transaction.bookingDate ?? transaction.valueDate;
  if (day === null) return null;
  const text = transaction.text.join(" ").trim();
  const payee = transaction.counterparty ?? transaction.text[0]?.trim() ?? null;
  return {
    externalId,
    day,
    amount: transaction.amount,
    direction: transaction.direction,
    currency: transaction.currency,
    payee: payee === "" ? null : payee,
    note: text === "" || text === payee ? null : text,
    raw: {
      text: text === "" ? null : text,
      counterparty: transaction.counterparty,
      merchantCategoryCode: transaction.merchantCategoryCode,
      bankTransactionCode: transaction.bankTransactionCode,
    },
  };
}

function readingError(code: PluginCallError["code"]): ReadingError {
  if (code === "auth" || code === "consent_expired" || code === "rate_limited") return code;
  if (code === "provider_down" || code === "invalid_data" || code === "plugin_down") return code;
  return "failed";
}

/**
 * One reading of a bank: asks the plugin for the balances and the movements of the tied accounts,
 * from a few days before the last day already covered (everything the bank gives, the first
 * time), and writes them through the port. Two readings of the same answer write nothing twice:
 * a movement is recognised by its id.
 *
 * An automatic reading respects the wait a bank asked for (six hours after a `rate_limited`);
 * a reading the person asks for does not, and tells the bank the person is there (`Psu-*`).
 */
export async function readBank(
  ctx: Who,
  input: ReadingInput,
  sink: BankSink,
  now: Date = new Date(),
  deps: Deps = {},
): Promise<ReadingOutcome> {
  const locked = await withJobLock(`plugin-sync:${input.connectionId}`, () =>
    reading(ctx, input, sink, now, deps),
  );
  return locked.ran ? locked.value : refusal("busy");
}

async function reading(
  ctx: Who,
  input: ReadingInput,
  sink: BankSink,
  now: Date,
  deps: Deps,
): Promise<ReadingOutcome> {
  let plugin;
  try {
    plugin = await requireActivePlugin(ctx, input.pluginId);
  } catch (error) {
    if (error instanceof PluginActionError) return refusal("not_active");
    throw error;
  }
  const connection = await requireConnection(ctx, input.pluginId, input.connectionId);
  const bag = readBag(await readCredentials(ctx, connection.id));
  if (!bag.chosen) return refusal("not_chosen");
  const linked = await sink.linkedAccounts(ctx, connection.provider);
  const tied = bag.accounts.filter((account) => linked.has(providerAccountIdOf(account)));
  if (tied.length === 0) return refusal("not_chosen");

  const job = await readSyncJob(ctx, connection.id, "transactions");
  // Accounts tied after the first reading are read alone, from the start; the others wait for the
  // next reading, which starts again from where the last complete one ended.
  const fresh = new Set(freshAccounts(job?.cursor));
  const freshTied = tied.filter((account) => fresh.has(providerAccountIdOf(account)));
  const accounts = freshTied.length > 0 ? freshTied : tied;
  const waitUntil = job?.cursor?.retryAfter ? new Date(job.cursor.retryAfter) : null;
  if (input.presence === null && waitUntil !== null && waitUntil.getTime() > now.getTime()) {
    return refusal("rate_limited", waitUntil);
  }
  const coveredTo = job?.cursor?.coveredTo ?? null;
  const credentials = await requireUserCredentials(ctx, input.pluginId);

  const run = await recordRun(ctx, { connectionId: connection.id, kind: "transactions" });
  const batches: SyncResponse[] = [];
  let cursor: string | null = null;
  const started = Date.now();
  const budget = input.presence === null ? AUTOMATIC_BUDGET_MS : PRESENT_BUDGET_MS;
  try {
    do {
      const batch: SyncResponse = await callPlugin(plugin.config, PLUGIN_PATHS.sync, syncResponseSchema, {
        body: {
          credentials,
          session: { id: bag.sessionId },
          accounts: accounts.map((account) => account.externalId),
          from: coveredTo === null || freshTied.length > 0 ? null : addDays(coveredTo, -REREAD_DAYS),
          cursor,
          userPresent: input.presence,
        },
        timeoutMs: SYNC_TIMEOUT_MS,
        fetchFn: deps.fetchFn,
      });
      batches.push(batch);
      cursor = batch.cursor;
    } while (cursor !== null && batches.length < MAX_SYNC_CALLS && Date.now() - started < budget);
  } catch (error) {
    if (!(error instanceof PluginCallError)) throw error;
    return failed(ctx, { connection, runId: run.id, pluginId: input.pluginId }, error, now);
  }

  // An account the bank could not read: when every account failed the same way, the reading failed.
  const errors = batches.flatMap((batch) =>
    batch.accounts.flatMap((account) => (account.error ? [account.error] : [])),
  );
  if (errors.length >= accounts.length && batches.every((batch) => batch.transactions.length === 0)) {
    const code = errors.every((one) => one === errors[0]) ? errors[0] : "failed";
    return failed(
      ctx,
      { connection, runId: run.id, pluginId: input.pluginId },
      new PluginCallError(code),
      now,
    );
  }

  const written = await write(ctx, { connection, accounts, linked, batches }, sink, now);
  // The bank gives the number of each account with the access: the domain keeps the IBANs (H39).
  await sink.saveIbans(
    ctx,
    accounts.flatMap((account) => {
      const local = linked.get(providerAccountIdOf(account));
      return local ? [{ accountId: local.id, iban: account.identifier }] : [];
    }),
  );
  const today = civilDateIn(now, ctx.timeZone);
  // The next reading starts from here only when this one read everything it asked for.
  const complete = cursor === null;
  // A reading of the fresh accounts alone moves nothing for the others: it only takes them off the
  // list, once it read everything it asked for.
  const cursorAfter: Record<string, string> | null =
    freshTied.length > 0
      ? complete
        ? coveredTo === null
          ? null
          : { coveredTo }
        : { ...(job?.cursor ?? {}) }
      : complete
        ? { coveredTo: today }
        : coveredTo === null
          ? null
          : { coveredTo };
  await saveSyncJob(ctx, connection.id, "transactions", { cursor: cursorAfter });
  const counts = {
    created: written.created,
    updated: written.updated,
    skipped: written.skipped,
    accountErrors: errors.length,
  };
  await finishRun(ctx, run.id, { counts }, now);
  return {
    ok: true,
    created: written.created,
    updated: written.updated,
    accountErrors: errors.length,
    complete,
  };
}

/** Closes a reading that failed, and records what the failure says about the access and the key. */
async function failed(
  ctx: Who,
  target: { connection: Connection; runId: string; pluginId: string },
  error: PluginCallError,
  now: Date,
): Promise<ReadingOutcome> {
  const code = readingError(error.code);
  await finishRun(ctx, target.runId, { counts: {}, error: code }, now);
  let retryAt: Date | null = null;
  if (code === "auth") await markCredentialsInvalid(ctx, target.pluginId, now);
  if (code === "consent_expired") await markConnection(ctx, target.connection.id, "revoked", code, now);
  if (code === "rate_limited") {
    const seconds = Math.max(error.retryAfterSeconds ?? 0, RATE_LIMIT_WAIT_HOURS * 3600);
    retryAt = new Date(now.getTime() + seconds * 1000);
    const job = await readSyncJob(ctx, target.connection.id, "transactions");
    await saveSyncJob(ctx, target.connection.id, "transactions", {
      cursor: { ...(job?.cursor ?? {}), retryAfter: retryAt.toISOString() },
    });
  }
  return refusal(code, retryAt);
}

async function write(
  ctx: Who,
  read: {
    connection: Connection;
    accounts: readonly PluginAccount[];
    linked: Map<string, { id: string; name: string }>;
    batches: readonly SyncResponse[];
  },
  sink: BankSink,
  now: Date,
): Promise<{ created: number; updated: number; skipped: number }> {
  const total = { created: 0, updated: 0, skipped: 0 };
  const today = civilDateIn(now, ctx.timeZone);
  const touched: string[] = [];
  for (const account of read.accounts) {
    const key = providerAccountIdOf(account);
    const local = read.linked.get(key);
    if (!local) continue;
    touched.push(local.id);
    const balance = pickBalance(
      read.batches.flatMap((batch) =>
        batch.accounts.filter((one) => one.externalId === account.externalId).flatMap((one) => one.balances),
      ),
    );
    if (balance !== null && balance.currency === account.currency) {
      // A date in the future is a bank's forecast, not a reading: the reading is of today.
      const on = balance.date !== null && balance.date <= today ? balance.date : today;
      await sink.writeBalance(ctx, local.id, { on, amount: balance.amount }, now);
    }
    const transactions = read.batches.flatMap((batch) =>
      batch.transactions.filter((one) => one.accountExternalId === account.externalId),
    );
    const movements = movementIds(key, transactions).flatMap(({ transaction, externalId }) => {
      const movement = toMovement(externalId, transaction);
      return movement !== null && movement.currency === account.currency ? [movement] : [];
    });
    const written = await sink.writeMovements(
      ctx,
      { accountId: local.id, provider: read.connection.provider },
      movements,
      now,
    );
    total.created += written.created;
    total.updated += written.updated;
    total.skipped += written.skipped;
  }
  await sink.afterReading(ctx, touched);
  return total;
}

/** For the dispatcher: the automatic reading of one due connection, as an outcome of a pass. */
export async function runBankPass(
  ctx: Who,
  due: { id: string; provider: string },
  sink: BankSink,
  now: Date,
): Promise<"answered" | "failed" | "refused" | "busy" | "absent"> {
  const pluginId = due.provider.slice(pluginProvider("").length);
  const outcome = await readBank(ctx, { pluginId, connectionId: due.id, presence: null }, sink, now);
  if (outcome.ok) return "answered";
  if (outcome.error === "busy") return "busy";
  // Turned off by the person, or not complete yet: there is nothing to read, and nothing is wrong.
  if (outcome.error === "not_active" || outcome.error === "not_chosen") return "absent";
  if (outcome.error === "auth" || outcome.error === "consent_expired" || outcome.error === "rate_limited") {
    return "refused";
  }
  return "failed";
}

/** What the bank says of one account it shares, read for the dry run of a switch (rewrite plan N4). */
export interface AccountPreview {
  /** The balance Ledgerly compares, chosen by the domain's order of the bank's codes (H43). */
  balance: { kind: string; amount: string; on: CivilDate } | null;
  movements: ReadingMovement[];
  /** The number the bank gives for the account (an IBAN when it is one). */
  identifier: string | null;
  currency: string;
}

export type PreviewOutcome =
  | { ok: true; preview: AccountPreview }
  | {
      ok: false;
      error:
        "not_active" | "not_found" | "account_gone" | "consent_expired" | "rate_limited" | "bank_unavailable";
      retryAt: Date | null;
    };

/**
 * Reads one account of a bank connection without writing anything (04-now.md §4.6.1, point 14):
 * no movement, no balance, no row of the history, no change to the connection. The account does
 * not have to be tied to an account here. A reading the person asks for: it says who asks (`Psu-*`).
 */
export async function previewBankAccount(
  ctx: Who,
  input: {
    pluginId: string;
    connectionId: string;
    providerAccountId: string;
    from: CivilDate;
    presence: Presence | null;
  },
  now: Date = new Date(),
  deps: Deps = {},
): Promise<PreviewOutcome> {
  let plugin;
  try {
    plugin = await requireActivePlugin(ctx, input.pluginId);
  } catch (error) {
    if (error instanceof PluginActionError) return { ok: false, error: "not_active", retryAt: null };
    throw error;
  }
  const connection = (await listPluginConnections(ctx, input.pluginId)).find(
    (one) => one.id === input.connectionId,
  );
  if (!connection) return { ok: false, error: "not_found", retryAt: null };
  if (connection.state === "revoked") return { ok: false, error: "consent_expired", retryAt: null };
  const bag = readBag(await readCredentials(ctx, connection.id));
  const account = bag.accounts.find((one) => providerAccountIdOf(one) === input.providerAccountId);
  if (!account) return { ok: false, error: "account_gone", retryAt: null };
  const credentials = await requireUserCredentials(ctx, input.pluginId);

  const batches: SyncResponse[] = [];
  let cursor: string | null = null;
  const started = Date.now();
  try {
    do {
      const batch: SyncResponse = await callPlugin(plugin.config, PLUGIN_PATHS.sync, syncResponseSchema, {
        body: {
          credentials,
          session: { id: bag.sessionId },
          accounts: [account.externalId],
          from: input.from,
          cursor,
          userPresent: input.presence,
        },
        timeoutMs: SYNC_TIMEOUT_MS,
        fetchFn: deps.fetchFn,
      });
      batches.push(batch);
      cursor = batch.cursor;
    } while (cursor !== null && batches.length < MAX_SYNC_CALLS && Date.now() - started < PRESENT_BUDGET_MS);
  } catch (error) {
    if (!(error instanceof PluginCallError)) throw error;
    const code = readingError(error.code);
    if (code === "consent_expired" || code === "auth")
      return { ok: false, error: "consent_expired", retryAt: null };
    if (code === "rate_limited") {
      const seconds = Math.max(error.retryAfterSeconds ?? 0, RATE_LIMIT_WAIT_HOURS * 3600);
      return { ok: false, error: "rate_limited", retryAt: new Date(now.getTime() + seconds * 1000) };
    }
    return { ok: false, error: "bank_unavailable", retryAt: null };
  }
  // A reading that did not end is not a comparison: the movements of the period would be missing.
  if (cursor !== null) return { ok: false, error: "bank_unavailable", retryAt: null };
  const answered = batches.flatMap((batch) =>
    batch.accounts.filter((one) => one.externalId === account.externalId),
  );
  if (answered.some((one) => one.error === "consent_expired")) {
    return { ok: false, error: "consent_expired", retryAt: null };
  }
  if (answered.length > 0 && answered.every((one) => one.error !== null)) {
    return { ok: false, error: "bank_unavailable", retryAt: null };
  }
  const today = civilDateIn(now, ctx.timeZone);
  const picked = pickBalance(
    answered.flatMap((one) => one.balances).filter((one) => one.currency === account.currency),
  );
  const transactions = batches.flatMap((batch) =>
    batch.transactions.filter((one) => one.accountExternalId === account.externalId),
  );
  const movements = movementIds(input.providerAccountId, transactions).flatMap(
    ({ transaction, externalId }) => {
      const movement = toMovement(externalId, transaction);
      return movement !== null && movement.currency === account.currency ? [movement] : [];
    },
  );
  return {
    ok: true,
    preview: {
      balance:
        picked === null
          ? null
          : {
              kind: picked.type,
              amount: picked.amount,
              on: picked.date !== null && picked.date <= today ? picked.date : today,
            },
      movements,
      identifier: account.identifier,
      currency: account.currency,
    },
  };
}
