import "server-only";
import { and, asc, desc, eq, inArray, isNotNull, isNull, ne, notInArray } from "drizzle-orm";
import { z } from "zod";
import { getAccount } from "@/modules/accounts/queries";
import { createAccount, openedNoLaterThan, takeOverEntries } from "@/modules/accounts/service";
import type { Person } from "@/modules/users/jobs";
import { alertAdmins } from "@/platform/alerts/gotify";
import type { Ctx } from "@/platform/context";
import { addDays, type CivilDate, civilDateIn, today } from "@/platform/dates";
import { getDb, type Tx } from "@/platform/db/client";
import { userScoped } from "@/platform/db/scope";
import { eurPerUnitOn, type RateTable } from "@/platform/fx/rules";
import { ratesOn, saveRates, storedRange } from "@/platform/fx/service";
import { fetchEcbRates } from "@/platform/fx/sources";
import { BINANCE_PROVIDER } from "@/platform/integrations/ccxt/binance";
import { binanceSource } from "@/platform/integrations/ccxt/source";
import { etoroSource } from "@/platform/integrations/etoro/source";
import {
  type AssetRef,
  type CoverageWindow,
  type FlowsRead,
  type FxLookup,
  type HoldingsSnapshot,
  type InvestmentSource,
  type KeyCheck,
  type ProviderEvent,
  SourceError,
  sourceErrorLog,
  sourceErrorText,
} from "@/platform/integrations/investments/source";
import type { DueConnection } from "@/platform/integrations/service";
import {
  type Connection,
  deleteConnection,
  finishRun,
  linkExternal,
  listConnections,
  listRuns,
  markConnection,
  readCredentials,
  readSyncJob,
  recordRun,
  resolveExternal,
  saveConnection,
  saveSchedule,
  saveSyncJob,
  skipRun,
  unlinkEntities,
} from "@/platform/integrations/service";
import { withJobLock } from "@/platform/jobs/lock";
import type { Cents } from "@/platform/money";
import { accountTypeOf, connectableProvider, credentialSchemaOf, type InvestmentProvider } from "./catalog";
import { estimateHistory, HISTORY_RATE_SCALE, type HistoryLeg, historyMoves } from "./history";
import {
  divRound,
  emptyReadingStatus,
  formatDecimal,
  type KeyCheckOrigin,
  missingPricesOf,
  type OperationKind,
  parseDecimal,
  PRICE_SCALE,
  QUANTITY_SCALE,
  RATE_SCALE,
  type ReadingStatus,
  valueOn,
} from "./rules";
import {
  investmentAccountPeriods,
  investmentAccounts,
  investmentAssets,
  investmentEvents,
  investmentHoldings,
  investmentKeyChecks,
  investmentOperations,
  investmentReadingPositions,
  investmentReadings,
  investmentReadingScopes,
  investmentSupersededEntries,
  investmentSyncCoverage,
} from "./schema";
import {
  eligibleAccounts,
  type InvestmentAccount,
  insertEvent,
  type LegInput,
  loadBook,
  lockInvestmentAccount,
  periodOn,
  ratesFor,
  rebuild,
  requireInvestmentAccount,
  translated,
  type WriteCtx,
} from "./service";

/**
 * The sync of the connected services (docs/design/investments.md §3.1, §5): the one place a key is
 * saved (`connectInvestmentProvider`, SEC-05), the pass the dispatcher makes, the key's checks,
 * replacement and revocation (§5.2, §5.3), and the conversion back to manual on disconnection
 * (§2.5). Network first, then short transactions (V6): no provider call inside a transaction.
 */

export type SyncErrorCode =
  | "unknown_provider"
  | "invalid_credentials"
  | "not_read_only"
  | "provider_auth"
  | "provider_unavailable"
  | "rate_limited"
  | "unsupported_currency"
  | "already_connected"
  | "not_connected"
  | "not_eligible"
  | "cooldown"
  | "different_account";

export class SyncError extends Error {
  constructor(readonly code: SyncErrorCode) {
    super(code);
    this.name = "SyncError";
  }
}

// ——— Sources ———————————————————————————————————————————————————————————————————————————————

const SOURCES: Record<string, () => InvestmentSource> = {
  etoro: () => etoroSource(),
  [BINANCE_PROVIDER]: () => binanceSource(),
};
let sourceOverride: ((provider: string) => InvestmentSource | null) | null = null;

/** The tests' way in: a fake source per provider, `null` to restore the real ones. */
export function setSourcesForTests(override: ((provider: string) => InvestmentSource | null) | null): void {
  sourceOverride = override;
}

function sourceOf(provider: string): InvestmentSource {
  const source = sourceOverride?.(provider) ?? SOURCES[provider]?.() ?? null;
  if (!source) throw new SyncError("unknown_provider");
  return source;
}

/** "Sync now" and "Verify" wait this long between two calls of one connection (SEC-09). */
export const COOLDOWN_MS = 60_000;
/**
 * "Connect" and "Replace key" together, per person and provider (PERS-87 SEC-01): each attempt is
 * three to six calls to the provider, and Binance counts their weight per IP — the homelab's.
 */
export const KEY_ATTEMPTS = { max: 5, windowMs: 10 * 60_000 } as const;
/** Two readings a day are enough for an end-of-day value and far from the rate limits (§3.1). */
export const PROVIDER_SCHEDULE = {
  rules: [{ kind: "times" as const, times: ["07:30", "22:30"], days: { kind: "every" as const } }],
};
/** Without a `Retry-After`, a refused pass waits this long before the next call. */
const DEFAULT_BACKOFF_SECONDS = 300;
const BACKOFF_KEY = "backoff_until";
/** The version of the dialog's text the person saw when connecting (§1.2), per provider. */
const ATTESTATION_TEXT_VERSIONS: Record<string, string> = {
  etoro: "etoro-2026-10-28",
  [BINANCE_PROVIDER]: "binance-2026-10-28",
};
/** Permissions that only read, never named as the reason a key was refused (B1). */
const READ_PERMISSIONS = new Set(["enableReading", "enableFixReadOnly"]);
/** Runs work after the answer has gone (Next's `after`): slow first flows never hold a form. */
export type Defer = (work: () => Promise<unknown>) => void;

/**
 * The attempts of {@link KEY_ATTEMPTS}, held in memory like the API's rate limit
 * (`platform/api/rate-limit.ts`): a guard against a loop, not a boundary, and a restart forgets it.
 */
const keyAttempts = new Map<string, number[]>();

function takeKeyAttempt(ctx: Pick<Ctx, "userId">, provider: string, now: Date): void {
  const key = `${ctx.userId}:${provider}`;
  const from = now.getTime() - KEY_ATTEMPTS.windowMs;
  const recent = (keyAttempts.get(key) ?? []).filter((at) => at > from);
  if (recent.length >= KEY_ATTEMPTS.max) {
    keyAttempts.set(key, recent);
    throw new SyncError("cooldown");
  }
  recent.push(now.getTime());
  keyAttempts.set(key, recent);
}

/** A source failure as the code a form shows (§5.1): never the provider's text. */
function codeOf(error: unknown): SyncErrorCode {
  if (error instanceof SyncError) return error.code;
  if (!(error instanceof SourceError)) return "provider_unavailable";
  if (error.errorClass === "auth" || error.errorClass === "permission") return "provider_auth";
  if (error.errorClass === "rate_limited") return "rate_limited";
  if (error.errorClass === "unsupported_currency") return "unsupported_currency";
  return "provider_unavailable";
}

// ——— Writing what a source read ————————————————————————————————————————————————————————————

/** The asset a provider names, found by class and symbol or created (§1.4). */
async function assetFor(ctx: Pick<Ctx, "userId">, tx: Tx, ref: AssetRef): Promise<string> {
  const find = async () =>
    (
      await tx
        .select({ id: investmentAssets.id })
        .from(investmentAssets)
        .where(
          and(
            userScoped(ctx).owns(investmentAssets),
            eq(investmentAssets.class, ref.class),
            eq(investmentAssets.symbol, ref.symbol),
            isNull(investmentAssets.mic),
          ),
        )
        .limit(1)
    )[0]?.id ?? null;
  const found = await find();
  if (found) return found;
  const [row] = await tx
    .insert(investmentAssets)
    .values(
      userScoped(ctx).stamp({
        class: ref.class,
        name: ref.name,
        symbol: ref.symbol,
        currency: ref.currency,
        priceSource: "provider" as const,
      }),
    )
    .onConflictDoNothing()
    .returning({ id: investmentAssets.id });
  return row?.id ?? (await find()) ?? "";
}

/** The provider's position of an asset in a product (§1.4), for the legs of its events. */
async function providerHoldingFor(
  ctx: Pick<Ctx, "userId">,
  tx: Tx,
  investmentAccountId: string,
  assetId: string,
  product: string,
  on: CivilDate,
): Promise<string> {
  const where = and(
    userScoped(ctx).owns(investmentHoldings),
    eq(investmentHoldings.investmentAccountId, investmentAccountId),
    eq(investmentHoldings.assetId, assetId),
    eq(investmentHoldings.origin, "provider"),
    eq(investmentHoldings.product, product),
  );
  const [found] = await tx.select({ id: investmentHoldings.id }).from(investmentHoldings).where(where);
  if (found) return found.id;
  const [row] = await tx
    .insert(investmentHoldings)
    .values(
      userScoped(ctx).stamp({
        investmentAccountId,
        assetId,
        origin: "provider" as const,
        product,
        openedOn: on,
      }),
    )
    .returning({ id: investmentHoldings.id });
  return row.id;
}

interface ReadingWrite {
  on: CivilDate;
  observedAt: Date;
  status: ReadingStatus;
  totalCents: Cents;
  cashCents: Cents | null;
  externalAccountId: string;
  snapshot: HoldingsSnapshot | null;
  scopes: readonly { product: string; complete: boolean }[];
}

/** A reading of a day (§1.6): the last of the day replaces the earlier one, with its positions. */
async function writeReading(
  ctx: Pick<Ctx, "userId">,
  tx: Tx,
  investment: InvestmentAccount,
  input: ReadingWrite,
) {
  await tx
    .delete(investmentReadings)
    .where(
      and(
        userScoped(ctx).owns(investmentReadings),
        eq(investmentReadings.investmentAccountId, investment.id),
        eq(investmentReadings.on, input.on),
      ),
    );
  const positions = input.snapshot?.positions ?? [];
  const [reading] = await tx
    .insert(investmentReadings)
    .values(
      userScoped(ctx).stamp({
        investmentAccountId: investment.id,
        on: input.on,
        observedAt: input.observedAt,
        status: input.status,
        totalCents: input.totalCents,
        cashCents: input.cashCents,
        missingPrices: missingPricesOf(
          positions.map((one) => ({
            valueCents: one.valueCents,
            quantity: parseDecimal(one.quantity, QUANTITY_SCALE),
          })),
        ),
      }),
    )
    .returning({ id: investmentReadings.id });
  for (const position of positions) {
    const assetId = await assetFor(ctx, tx, position.asset);
    await tx.insert(investmentReadingPositions).values(
      userScoped(ctx).stamp({
        readingId: reading.id,
        assetId,
        product: position.product,
        quantity: formatDecimal(parseDecimal(position.quantity, QUANTITY_SCALE), QUANTITY_SCALE),
        price:
          position.price === null
            ? null
            : formatDecimal(parseDecimal(position.price, PRICE_SCALE), PRICE_SCALE),
        priceCurrency: position.priceCurrency,
        priceAt: position.priceAt ?? input.observedAt,
        priceSource: position.priceSource,
        fxRate:
          position.fxRate === null || position.fxRate === undefined
            ? null
            : formatDecimal(parseDecimal(position.fxRate, RATE_SCALE), RATE_SCALE),
        fxSource: position.fxSource ?? null,
        valueCents: position.valueCents,
        costCents: position.costCents ?? null,
      }),
    );
  }
  if (input.scopes.length > 0) {
    await tx.insert(investmentReadingScopes).values(
      input.scopes.map((scope) =>
        userScoped(ctx).stamp({
          readingId: reading.id,
          externalAccountId: input.externalAccountId,
          product: scope.product,
          complete: scope.complete,
        }),
      ),
    );
  }
  return reading.id;
}

/** R5: a complete answer, a partial one, or an empty one that counts only when it is believable. */
async function statusOf(
  ctx: Pick<Ctx, "userId">,
  tx: Tx,
  investment: InvestmentAccount,
  snapshot: HoldingsSnapshot,
  on: CivilDate,
): Promise<ReadingStatus> {
  if (!snapshot.empty) return snapshot.complete ? "complete" : "partial";
  const [previous] = await tx
    .select({ totalCents: investmentReadings.totalCents, status: investmentReadings.status })
    .from(investmentReadings)
    .where(
      and(
        userScoped(ctx).owns(investmentReadings),
        eq(investmentReadings.investmentAccountId, investment.id),
        ne(investmentReadings.status, "pending_zero"),
      ),
    )
    .orderBy(desc(investmentReadings.on))
    .limit(1);
  const since = addDays(on, -7);
  const withdrawals = await tx
    .select({ on: investmentEvents.on })
    .from(investmentOperations)
    .innerJoin(investmentEvents, eq(investmentEvents.id, investmentOperations.eventId))
    .where(
      and(
        userScoped(ctx).owns(investmentOperations),
        eq(investmentEvents.investmentAccountId, investment.id),
        eq(investmentOperations.kind, "withdrawal"),
      ),
    );
  return emptyReadingStatus({
    previousCents: previous?.totalCents ?? null,
    withdrawalWithin7Days: withdrawals.some((row) => row.on >= since && row.on <= on),
  });
}

async function writeCoverage(
  ctx: Pick<Ctx, "userId">,
  tx: Tx,
  connectionId: string,
  kind: "holdings" | "flows",
  windows: readonly CoverageWindow[],
) {
  const streams = [...new Set(windows.map((window) => window.stream))];
  for (const stream of streams) {
    await tx
      .delete(investmentSyncCoverage)
      .where(
        and(
          userScoped(ctx).owns(investmentSyncCoverage),
          eq(investmentSyncCoverage.connectionId, connectionId),
          eq(investmentSyncCoverage.stream, stream),
        ),
      );
  }
  if (windows.length === 0) return;
  await tx.insert(investmentSyncCoverage).values(
    windows.map((window) =>
      userScoped(ctx).stamp({
        connectionId,
        kind,
        stream: window.stream,
        fromAt: window.fromAt,
        toAt: window.toAt,
        status: window.status,
        reason: window.reason,
      }),
    ),
  );
}

async function insertKeyCheck(
  ctx: Pick<Ctx, "userId">,
  db: Tx | ReturnType<typeof getDb>,
  input: {
    investmentAccountId: string;
    connectionId: string | null;
    provider: string;
    origin: KeyCheckOrigin;
    check: KeyCheck | null;
    now: Date;
  },
) {
  await db.insert(investmentKeyChecks).values(
    userScoped(ctx).stamp({
      investmentAccountId: input.investmentAccountId,
      connectionId: input.connectionId,
      provider: input.provider,
      origin: input.origin,
      checkedAt: input.now,
      result: input.check?.result ?? ("error" as const),
      permissions: input.check?.permissions ?? {},
      ipRestricted: input.check?.ipRestricted ?? null,
      attestationTextVersion:
        input.origin === "connect" || input.origin === "replace"
          ? (ATTESTATION_TEXT_VERSIONS[input.provider] ?? null)
          : null,
    }),
  );
}

/** The key is no longer the connection's (replaced, disconnected, refused): ask to revoke it (SEC-07). */
async function retireKeys(
  ctx: Pick<Ctx, "userId">,
  db: Tx | ReturnType<typeof getDb>,
  investmentAccountId: string,
  now: Date,
) {
  await db
    .update(investmentKeyChecks)
    .set({ retiredAt: now })
    .where(
      and(
        userScoped(ctx).owns(investmentKeyChecks),
        eq(investmentKeyChecks.investmentAccountId, investmentAccountId),
        isNull(investmentKeyChecks.retiredAt),
      ),
    );
}

/**
 * The ECB rates the events of a window need, fetched once when `fx_rates` starts after them: a
 * trade of 2021 is converted at the rate of its own day (§1.8), never at today's.
 */
async function ensureRatesFrom(day: CivilDate, todayOn: CivilDate): Promise<void> {
  const stored = await storedRange();
  if (stored.earliest !== null && stored.earliest <= day) return;
  const to = stored.earliest === null ? todayOn : addDays(stored.earliest, -1);
  if (to < day) return;
  await saveRates(await fetchEcbRates({ from: day, to }));
}

/** Account units per unit of `from` on `on`, scaled; `null` without a rate. */
function rateBetween(rates: RateTable, from: string, to: string, on: CivilDate): bigint | null {
  if (from === to) return null;
  const source = eurPerUnitOn(rates, from, on);
  const target = eurPerUnitOn(rates, to, on);
  if (source === null || target === null) return null;
  return divRound(source * 10n ** BigInt(RATE_SCALE), target);
}

/** A rate a source gives, read at the precision of a coin's quantity before it is rounded. */
const SOURCE_RATE_SCALE = 18;

const SIGN: Record<string, 1n | -1n> = {
  deposit: 1n,
  withdrawal: -1n,
  buy: -1n,
  sell: 1n,
  close: 1n,
  income: 1n,
  fee: -1n,
};

/**
 * The provider's events as events of the account (A6): new ones only — an id already linked is the
 * same event — each with its legs and its link in the same transaction, the amounts converted to
 * the account's currency at the ECB rate of their day. Returns the oldest day written.
 */
async function writeEvents(
  ctx: WriteCtx,
  tx: Tx,
  investment: InvestmentAccount,
  currency: string,
  events: readonly ProviderEvent[],
  known: ReadonlySet<string>,
  rates: RateTable,
  now: Date,
): Promise<{ created: number; oldest: CivilDate | null }> {
  let created = 0;
  let oldest: CivilDate | null = null;
  for (const event of events) {
    if (known.has(event.externalId)) continue;
    const on = civilDateIn(event.occurredAt, ctx.timeZone);
    const legs: LegInput[] = [];
    for (const leg of event.legs) {
      const native = parseDecimal(leg.nativeAmount, PRICE_SCALE);
      const nativeCents = divRound(native, 10n ** BigInt(PRICE_SCALE - 2));
      // A leg the source priced itself (a coin at the exchange's close, §1.8): its own rate, at
      // full precision — a fee of 0.0001 BNB is cents, not zero; "unpriced" counts no amount.
      const sourced = leg.fxSource !== undefined && leg.fxSource !== null;
      const sourcedRate =
        sourced && leg.fxRate !== null && leg.fxRate !== undefined
          ? parseDecimal(leg.fxRate, SOURCE_RATE_SCALE)
          : null;
      const fxRate = sourced
        ? sourcedRate === null
          ? null
          : divRound(sourcedRate, 10n ** BigInt(SOURCE_RATE_SCALE - RATE_SCALE))
        : rateBetween(rates, leg.nativeCurrency, currency, on);
      if (!sourced && leg.nativeCurrency !== currency && fxRate === null)
        throw new SyncError("provider_unavailable");
      const amount = sourced
        ? sourcedRate === null
          ? 0n
          : divRound(native * sourcedRate, 10n ** BigInt(PRICE_SCALE + SOURCE_RATE_SCALE - 2))
        : fxRate === null
          ? nativeCents
          : divRound(nativeCents * fxRate, 10n ** BigInt(RATE_SCALE));
      const holdingId =
        leg.asset === null || leg.product === null
          ? null
          : await providerHoldingFor(
              ctx,
              tx,
              investment.id,
              await assetFor(ctx, tx, leg.asset),
              leg.product,
              on,
            );
      legs.push({
        leg: leg.leg,
        kind: leg.kind as OperationKind,
        holdingId,
        quantity: leg.quantity === null ? null : parseDecimal(leg.quantity, QUANTITY_SCALE),
        unitPrice: leg.unitPrice === null ? null : parseDecimal(leg.unitPrice, PRICE_SCALE),
        priceCurrency: leg.priceCurrency,
        nativeAmount: native,
        nativeCurrency: leg.nativeCurrency,
        fxRate,
        fxSource: sourced ? leg.fxSource : fxRate === null ? null : `ecb:${on}`,
        amountCents: SIGN[leg.kind] * (amount < 0n ? -amount : amount),
      });
    }
    const written = await insertEvent(ctx, tx, investment.id, {
      on,
      occurredAt: event.occurredAt,
      origin: "provider",
      note: event.note,
      legs,
    });
    await linkExternal(
      ctx,
      {
        provider: investment.provider,
        entityType: "investment_event",
        entityId: written.id,
        externalId: event.externalId,
      },
      now,
      tx,
    );
    created += 1;
    if (oldest === null || on < oldest) oldest = on;
  }
  return { created, oldest };
}

// ——— Connecting (§4.2, §5.1) ————————————————————————————————————————————————————————————————

export const connectTargetSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("new"),
    name: z.string().trim().min(1).max(80),
    currency: z.string().regex(/^[A-Z]{3}$/),
  }),
  z.object({ kind: z.literal("existing"), accountId: z.uuid() }),
]);
export type ConnectTarget = z.input<typeof connectTargetSchema>;

async function connectionOf(ctx: Pick<Ctx, "userId">, provider: string): Promise<Connection | null> {
  return (await listConnections(ctx)).find((one) => one.provider === provider) ?? null;
}

/** The account a key may be connected to (§1.3): a manual account no one else writes, or a manual service. */
async function targetOf(
  ctx: Ctx,
  provider: InvestmentProvider,
  target: z.output<typeof connectTargetSchema>,
) {
  const allowed = (currency: string) =>
    provider.currencies === null || provider.currencies.includes(currency);
  if (target.kind === "new") {
    if (!allowed(target.currency)) throw new SyncError("unsupported_currency");
    return { kind: "new" as const, currency: target.currency, name: target.name };
  }
  const account = await getAccount(ctx, target.accountId);
  if (!account || account.state === "archived") throw new SyncError("not_eligible");
  if (!allowed(account.currency)) throw new SyncError("unsupported_currency");
  if (account.type !== accountTypeOf(provider.category)) throw new SyncError("not_eligible");
  const investment = await requireInvestmentAccount(ctx, account.id).catch(() => null);
  if (investment) {
    if (investment.provider !== "manual") throw new SyncError("not_eligible");
    return { kind: "service" as const, currency: account.currency, investment, accountId: account.id };
  }
  const eligible = (await eligibleAccounts(ctx)).find((one) => one.account.id === account.id);
  if (!eligible || eligible.reason !== null) throw new SyncError("not_eligible");
  return { kind: "handover" as const, currency: account.currency, accountId: account.id };
}

/**
 * The only way a key of an investment provider is saved (SEC-05, §5.1): the strict schema of the
 * provider (SEC-03), the read-only check (§5.2) and a test reading, then `saveConnection`, the key
 * check, the account (new, handed over, or a manual service converted, §2.5) with its first
 * reading and the 12 months of history (D11). If the provider does not answer, nothing is saved.
 */
export async function connectInvestmentProvider(
  ctx: Ctx,
  providerId: string,
  credentials: Readonly<Record<string, string>>,
  input: ConnectTarget,
  now: Date = new Date(),
  /** The first flows after the answer (Binance reads 24 months: minutes, §3.2); inline by default. */
  defer?: Defer,
): Promise<{ accountId: string; ipRestricted: boolean | null }> {
  const provider = connectableProvider(providerId);
  if (!provider) throw new SyncError("unknown_provider");
  const parsedCredentials = credentialSchemaOf(provider).safeParse(credentials);
  if (!parsedCredentials.success) throw new SyncError("invalid_credentials");
  const keys = parsedCredentials.data as Record<string, string>;
  const parsedTarget = connectTargetSchema.safeParse(input);
  if (!parsedTarget.success) throw new SyncError("not_eligible");
  if (await connectionOf(ctx, provider.id)) throw new SyncError("already_connected");
  const target = await targetOf(ctx, provider, parsedTarget.data);
  takeKeyAttempt(ctx, provider.id, now);

  // The network, outside any transaction: the check, the test reading, the history.
  const source = sourceOf(provider.id);
  let check: KeyCheck;
  let snapshot: HoldingsSnapshot;
  try {
    check = await source.verifyReadOnly(keys);
    if (check.result !== "read-only") throw new SyncError("not_read_only");
    snapshot = await source.fetchHoldings(
      keys,
      target.currency,
      now,
      await todayLookup(ctx, target.currency, now),
    );
  } catch (error) {
    if (!(error instanceof SyncError))
      console.error("[investments] connect failed", sourceErrorLog(provider.id, error));
    throw new SyncError(codeOf(error));
  }
  const history = await source.fetchHistory(keys, target.currency, now).catch((error: unknown) => {
    console.error("[investments] history not read", sourceErrorLog(provider.id, error));
    return null;
  });

  const todayOn = today(ctx.timeZone, now);
  const historyStart = history?.points[0]?.on ?? null;

  const connection = await saveConnection(ctx, { provider: provider.id, credentials: keys });
  try {
    await saveSchedule(ctx, connection.id, PROVIDER_SCHEDULE, now);
    const accountId = await getDb().transaction(async (tx) => {
      let investment: InvestmentAccount;
      let from: CivilDate;
      if (target.kind === "new") {
        from = historyStart ?? todayOn;
        const account = await createAccount(
          ctx,
          {
            name: target.name,
            type: accountTypeOf(provider.category),
            currency: target.currency,
            openedOn: from,
          },
          tx,
        );
        [investment] = await tx
          .insert(investmentAccounts)
          .values(
            userScoped(ctx).stamp({
              accountId: account.id,
              category: provider.category,
              provider: provider.id,
              managedSince: from,
              openedOn: from,
            }),
          )
          .returning();
      } else if (target.kind === "handover") {
        from = todayOn;
        [investment] = await tx
          .insert(investmentAccounts)
          .values(
            userScoped(ctx).stamp({
              accountId: target.accountId,
              category: provider.category,
              provider: provider.id,
              managedSince: from,
              openedOn: from,
            }),
          )
          .returning();
        const removed = await takeOverEntries(ctx, target.accountId, from, tx);
        if (removed.length > 0) {
          await tx.insert(investmentSupersededEntries).values(
            removed.map((entry) =>
              userScoped(ctx).stamp({
                accountId: entry.accountId,
                balanceEntryId: entry.id,
                on: entry.on,
                balanceCents: entry.balanceCents,
                availableCents: entry.availableCents,
                source: entry.source,
                note: entry.note,
                capturedAt: entry.capturedAt,
                reason: "handover",
              }),
            ),
          );
        }
      } else {
        // Manual → synced (§2.5): from the latest of its own periods, or of the history if later.
        investment = await lockInvestmentAccount(ctx, target.accountId, tx);
        const book = await loadBook(ctx, investment, target.currency, tx);
        const last = book.periodRows.at(-1)?.fromOn ?? todayOn;
        from = historyStart !== null && historyStart > last ? historyStart : last;
        [investment] = await tx
          .update(investmentAccounts)
          .set({ provider: provider.id, updatedAt: now })
          .where(and(eq(investmentAccounts.id, investment.id), userScoped(ctx).owns(investmentAccounts)))
          .returning();
      }
      await tx.insert(investmentAccountPeriods).values(
        userScoped(ctx).stamp({
          investmentAccountId: investment.id,
          fromOn: from,
          startsAt: target.kind === "new" ? new Date(`${from}T00:00:00Z`) : now,
          mode: "assets" as const,
          origin: "synced" as const,
          reason:
            target.kind === "new"
              ? ("opening" as const)
              : target.kind === "handover"
                ? ("handover" as const)
                : ("conversion" as const),
        }),
      );
      await insertKeyCheck(ctx, tx, {
        investmentAccountId: investment.id,
        connectionId: connection.id,
        provider: provider.id,
        origin: "connect",
        check,
        now,
      });
      const scopes = snapshot.scopes;
      for (const point of history?.points ?? []) {
        if (point.on < from || point.on >= todayOn) continue;
        await writeReading(ctx, tx, investment, {
          on: point.on,
          observedAt: new Date(`${point.on}T23:59:59Z`),
          status: point.totalCents === 0n ? "confirmed_zero" : "complete",
          totalCents: point.totalCents,
          cashCents: null,
          externalAccountId: snapshot.externalAccountId,
          snapshot: null,
          scopes: scopes.map((scope) => ({ product: scope.product, complete: true })),
        });
      }
      if (history) await writeCoverage(ctx, tx, connection.id, "holdings", history.coverage);
      await writeReading(ctx, tx, investment, {
        on: todayOn,
        observedAt: snapshot.observedAt,
        status: await statusOf(ctx, tx, investment, snapshot, todayOn),
        totalCents: snapshot.totalCents,
        cashCents: snapshot.cashCents,
        externalAccountId: snapshot.externalAccountId,
        snapshot,
        scopes,
      });
      await rebuild(ctx, investment, target.currency, from, tx);
      return investment.accountId;
    });
    // The first flows now, so the page has its history at once; a failure waits for the next pass.
    const firstFlows = () =>
      withJobLock(`investments-sync:${connection.id}`, async () => {
        await syncFlows(ctx, connection, accountId, now);
        // The estimated history at once (PERS-100); a failure waits for the next pass.
        const linked = await linkedOf(ctx, connection);
        if (linked) {
          await estimateHistoryOf(ctx, linked, now).catch((error: unknown) => {
            console.error("[investments] history not estimated", sourceErrorLog(provider.id, error));
          });
        }
      }).catch((error: unknown) => {
        console.error("[investments] first flows not read", sourceErrorLog(provider.id, error));
      });
    if (defer) defer(firstFlows);
    else await firstFlows();
    return { accountId, ipRestricted: check.ipRestricted };
  } catch (error) {
    // Nothing half done: without its account a key stays nowhere.
    await deleteConnection(ctx, connection.id).catch(() => undefined);
    throw error;
  }
}

// ——— The pass (§3.1) —————————————————————————————————————————————————————————————————————————

interface Linked {
  connection: Connection;
  investment: InvestmentAccount;
  currency: string;
}

async function linkedOf(ctx: Pick<Ctx, "userId">, connection: Connection): Promise<Linked | null> {
  const [investment] = await getDb()
    .select()
    .from(investmentAccounts)
    .where(
      and(userScoped(ctx).owns(investmentAccounts), eq(investmentAccounts.provider, connection.provider)),
    )
    .orderBy(asc(investmentAccounts.createdAt))
    .limit(1);
  if (!investment) return null;
  const account = await getAccount(ctx, investment.accountId);
  if (!account) return null;
  return { connection, investment, currency: account.currency };
}

/**
 * A 401, or a 403 of the key check itself (eToro `/me`, Binance `apiRestrictions`), revokes the
 * connection; a 403 of any other call is only a failed reading (PERS-87 SEC-06). A 429 waits as
 * long as the provider asked (SEC-09).
 */
async function noteFailure(
  ctx: WriteCtx,
  linked: Linked,
  error: unknown,
  now: Date,
  step: "check" | "read",
): Promise<"failed" | "refused"> {
  const text = sourceErrorText(linked.connection.provider, error);
  console.error("[investments] pass failed", sourceErrorLog(linked.connection.provider, error));
  if (
    error instanceof SourceError &&
    (error.errorClass === "auth" || (error.errorClass === "permission" && step === "check"))
  ) {
    await markConnection(ctx, linked.connection.id, "revoked", text, now);
    await retireKeys(ctx, getDb(), linked.investment.id, now);
    return "refused";
  }
  if (error instanceof SourceError && error.errorClass === "rate_limited") {
    const until = new Date(now.getTime() + (error.retryAfterSeconds ?? DEFAULT_BACKOFF_SECONDS) * 1000);
    await saveSyncJob(
      ctx,
      linked.connection.id,
      "holdings",
      { cursor: { [BACKOFF_KEY]: until.toISOString() } },
      now,
    );
    return "refused";
  }
  return "failed";
}

/** The ECB rates of `rates` as a source asks for them (§1.8): account units per unit, as a decimal. */
function fxLookupOf(rates: RateTable): FxLookup {
  return (from, to, on) => {
    if (from === to) return "1";
    const rate = rateBetween(rates, from, to, on);
    return rate === null ? null : formatDecimal(rate, RATE_SCALE);
  };
}

/** The fiat a source may need in a rate: USD for a stablecoin's path (§1.8), the usual cash. */
const LOOKUP_CURRENCIES = ["USD", "EUR", "GBP", "CHF"];

/** The latest ECB rates for a reading of today (§1.8 step 3–4): a week back covers any weekend. */
async function todayLookup(ctx: Pick<Ctx, "timeZone">, currency: string, now: Date): Promise<FxLookup> {
  const todayOn = today(ctx.timeZone, now);
  return fxLookupOf(await ratesOn(new Set([...LOOKUP_CURRENCIES, currency]), addDays(todayOn, -10), todayOn));
}

/** How a leg moves its coin's quantity (A6): in for buy, deposit, income, opening; out otherwise. */
const QUANTITY_SIGN: Record<string, 1n | -1n | 0n> = {
  opening_position: 1n,
  deposit: 1n,
  buy: 1n,
  income: 1n,
  sell: -1n,
  withdrawal: -1n,
  fee: -1n,
  close: -1n,
};

/** A difference this small is dust (B5): under a cent at the reading's price, or 0.001 unpriced. */
function isDust(quantity: bigint, valueCents: Cents | null, reported: bigint): boolean {
  const abs = quantity < 0n ? -quantity : quantity;
  if (valueCents !== null && reported > 0n) {
    return divRound((valueCents < 0n ? -valueCents : valueCents) * abs * 100n, reported) < 100n;
  }
  return abs < 10n ** BigInt(QUANTITY_SCALE - 3);
}

/**
 * A rebase (PERS-141): the source reads more of the same history than when it started, so what was
 * inferred from the old reading goes — the provider's inferred openings, with their links, and the
 * estimated readings, with the opening period back on the first real reading. `checkQuantities`
 * infers the openings again and `estimateHistoryOf` estimates the history again, on this pass.
 */
async function undoInferred(ctx: WriteCtx, tx: Tx, investment: InvestmentAccount, provider: string) {
  const openings = await tx
    .selectDistinct({ eventId: investmentOperations.eventId })
    .from(investmentOperations)
    .innerJoin(investmentEvents, eq(investmentEvents.id, investmentOperations.eventId))
    .where(
      and(
        userScoped(ctx).owns(investmentOperations),
        eq(investmentEvents.investmentAccountId, investment.id),
        eq(investmentEvents.origin, "provider"),
        eq(investmentOperations.kind, "opening_position"),
        eq(investmentOperations.quantityBasis, "inferred"),
      ),
    )
    .orderBy(asc(investmentOperations.eventId));
  const eventIds = openings.map((one) => one.eventId);
  if (eventIds.length > 0) {
    await tx
      .delete(investmentOperations)
      .where(
        and(inArray(investmentOperations.eventId, eventIds), userScoped(ctx).owns(investmentOperations)),
      );
    await tx
      .delete(investmentEvents)
      .where(and(inArray(investmentEvents.id, eventIds), userScoped(ctx).owns(investmentEvents)));
    await unlinkEntities(ctx, provider, "investment_event", eventIds, tx);
  }
  const periods = await tx
    .select()
    .from(investmentAccountPeriods)
    .where(
      and(
        userScoped(ctx).owns(investmentAccountPeriods),
        eq(investmentAccountPeriods.investmentAccountId, investment.id),
      ),
    )
    .orderBy(asc(investmentAccountPeriods.fromOn));
  // Only the history `estimateHistoryOf` wrote: one opening period of a service connected new.
  if (periods.length !== 1 || periods[0].reason !== "opening" || periods[0].origin !== "synced") return;
  const [real] = await tx
    .select({ on: investmentReadings.on })
    .from(investmentReadings)
    .where(
      and(
        userScoped(ctx).owns(investmentReadings),
        eq(investmentReadings.investmentAccountId, investment.id),
        notInArray(investmentReadings.status, ["pending_zero", "estimated"]),
      ),
    )
    .orderBy(asc(investmentReadings.on))
    .limit(1);
  if (!real || periods[0].fromOn >= real.on) return;
  await tx
    .delete(investmentReadings)
    .where(
      and(
        userScoped(ctx).owns(investmentReadings),
        eq(investmentReadings.investmentAccountId, investment.id),
        eq(investmentReadings.status, "estimated"),
      ),
    );
  await tx
    .update(investmentAccountPeriods)
    .set({ fromOn: real.on, startsAt: new Date(`${real.on}T00:00:00Z`) })
    .where(
      and(eq(investmentAccountPeriods.id, periods[0].id), userScoped(ctx).owns(investmentAccountPeriods)),
    );
}

/**
 * The quantities of a source that reads a window of history (A6, §3.2): on the first pass, one
 * `opening_position` per coin held, `inferred` = reported today − net flows of the window; on every
 * pass, opening + Σ legs against the reading, per coin. A difference over dust is a declared gap of
 * the stream `quantities`, never a silent one.
 */
async function checkQuantities(
  ctx: WriteCtx,
  tx: Tx,
  investment: InvestmentAccount,
  connectionId: string,
  read: FlowsRead,
  now: Date,
): Promise<CivilDate | null> {
  const from = read.historyFrom!;
  const [reading] = await tx
    .select({ id: investmentReadings.id })
    .from(investmentReadings)
    .where(
      and(
        userScoped(ctx).owns(investmentReadings),
        eq(investmentReadings.investmentAccountId, investment.id),
        ne(investmentReadings.status, "pending_zero"),
      ),
    )
    .orderBy(desc(investmentReadings.on))
    .limit(1);
  if (!reading) return null;
  const positions = await tx
    .select({
      assetId: investmentReadingPositions.assetId,
      quantity: investmentReadingPositions.quantity,
      valueCents: investmentReadingPositions.valueCents,
      class: investmentAssets.class,
      symbol: investmentAssets.symbol,
    })
    .from(investmentReadingPositions)
    .innerJoin(investmentAssets, eq(investmentAssets.id, investmentReadingPositions.assetId))
    .where(
      and(
        userScoped(ctx).owns(investmentReadingPositions),
        eq(investmentReadingPositions.readingId, reading.id),
      ),
    )
    .orderBy(asc(investmentReadingPositions.id));
  const legs = await tx
    .select({
      assetId: investmentHoldings.assetId,
      kind: investmentOperations.kind,
      quantity: investmentOperations.quantity,
      class: investmentAssets.class,
      symbol: investmentAssets.symbol,
    })
    .from(investmentOperations)
    .innerJoin(investmentEvents, eq(investmentEvents.id, investmentOperations.eventId))
    .innerJoin(investmentHoldings, eq(investmentHoldings.id, investmentOperations.holdingId))
    .innerJoin(investmentAssets, eq(investmentAssets.id, investmentHoldings.assetId))
    .where(
      and(
        userScoped(ctx).owns(investmentOperations),
        eq(investmentEvents.investmentAccountId, investment.id),
        eq(investmentHoldings.origin, "provider"),
      ),
    )
    .orderBy(asc(investmentOperations.id));

  // Coins only: cash is not a position whose quantity a flow carries.
  const reported = new Map<string, { quantity: bigint; valueCents: Cents | null; symbol: string }>();
  for (const one of positions) {
    if (one.class === "cash") continue;
    const before = reported.get(one.assetId);
    const quantity = parseDecimal(one.quantity, QUANTITY_SCALE);
    reported.set(one.assetId, {
      quantity: (before?.quantity ?? 0n) + quantity,
      valueCents:
        before === undefined
          ? one.valueCents
          : before.valueCents === null || one.valueCents === null
            ? null
            : before.valueCents + one.valueCents,
      symbol: one.symbol ?? "",
    });
  }
  const net = new Map<string, bigint>();
  const symbols = new Map([...reported].map(([assetId, held]) => [assetId, held.symbol]));
  let opened = false;
  for (const one of legs) {
    if (one.class === "cash" || one.quantity === null) continue;
    if (one.kind === "opening_position") opened = true;
    symbols.set(one.assetId, one.symbol ?? "");
    const sign = QUANTITY_SIGN[one.kind] ?? 0n;
    net.set(one.assetId, (net.get(one.assetId) ?? 0n) + sign * parseDecimal(one.quantity, QUANTITY_SCALE));
  }

  const fromOn = civilDateIn(from, ctx.timeZone);
  let negative = false;
  let written: CivilDate | null = null;
  if (!opened && read.openingRates !== undefined) {
    // Every coin held or moved: one sold out within the window started with what it sold (A6).
    for (const [assetId, symbol] of symbols) {
      const held = reported.get(assetId) ?? { quantity: 0n, valueCents: null, symbol };
      const opening = held.quantity - (net.get(assetId) ?? 0n);
      if (isDust(opening, held.valueCents, held.quantity)) continue;
      if (opening < 0n) {
        negative = true;
        continue;
      }
      const rate = read.openingRates[held.symbol] ?? null;
      const rateUnits = rate === null ? null : parseDecimal(rate.rate, SOURCE_RATE_SCALE);
      const valueCents =
        rateUnits === null
          ? 0n
          : divRound(opening * rateUnits, 10n ** BigInt(QUANTITY_SCALE + SOURCE_RATE_SCALE - 2));
      const holdingId = await providerHoldingFor(ctx, tx, investment.id, assetId, "spot", fromOn);
      const event = await insertEvent(ctx, tx, investment.id, {
        on: fromOn,
        occurredAt: from,
        origin: "provider",
        note: "Opening inferred from the history",
        legs: [
          {
            leg: "main",
            kind: "opening_position",
            holdingId,
            quantity: opening,
            fxRate:
              rateUnits === null ? null : divRound(rateUnits, 10n ** BigInt(SOURCE_RATE_SCALE - RATE_SCALE)),
            fxSource: rate?.source ?? "unpriced",
            amountCents: -valueCents,
            quantityBasis: "inferred",
          },
        ],
      });
      await linkExternal(
        ctx,
        {
          provider: investment.provider,
          entityType: "investment_event",
          entityId: event.id,
          externalId: `opening:${held.symbol}`,
        },
        now,
        tx,
      );
      net.set(assetId, (net.get(assetId) ?? 0n) + opening);
      written = fromOn;
    }
  }
  const assets = new Set([...reported.keys(), ...net.keys()]);
  let mismatch = false;
  for (const assetId of assets) {
    const held = reported.get(assetId);
    const difference = (held?.quantity ?? 0n) - (net.get(assetId) ?? 0n);
    if (!isDust(difference, held?.valueCents ?? null, held?.quantity ?? 0n)) mismatch = true;
  }
  await writeCoverage(ctx, tx, connectionId, "flows", [
    {
      stream: "quantities",
      fromAt: from,
      toAt: now,
      status: negative || mismatch ? "partial" : "complete",
      reason: negative ? "negative_opening" : mismatch ? "quantity_mismatch" : null,
    },
  ]);
  return written;
}

/**
 * The flows of a connection (§3.1 step 3): events, links, coverage and the cursor in one
 * transaction (A7), so a failed write never moves the cursor past what it did not save.
 */
async function syncFlows(
  ctx: WriteCtx,
  connection: Connection,
  accountId: string,
  now: Date,
): Promise<number> {
  const linked = await linkedOf(ctx, connection);
  if (!linked || linked.investment.accountId !== accountId) throw new SyncError("not_connected");
  const credentials = await readCredentials(ctx, connection.id);
  const todayOn = today(ctx.timeZone, now);
  const cursor = (await readSyncJob(ctx, connection.id, "flows"))?.cursor ?? null;
  // The rates a source may ask for (a stablecoin through USD, §1.8): those already kept.
  const lookupFrom = addDays(todayOn, -761);
  const lookupRates = await ratesOn(new Set([...LOOKUP_CURRENCIES, linked.currency]), lookupFrom, todayOn);
  const read = await sourceOf(connection.provider).fetchFlows(credentials, now, {
    currency: linked.currency,
    cursor,
    fx: fxLookupOf(lookupRates),
  });
  const days = read.events.map((event) => civilDateIn(event.occurredAt, ctx.timeZone));
  const first = days.reduce<CivilDate | null>((min, day) => (min === null || day < min ? day : min), null);
  const currencies = new Set([
    linked.currency,
    ...read.events.flatMap((event) =>
      event.legs
        .filter((leg) => leg.fxSource === undefined || leg.fxSource === null)
        .map((leg) => leg.nativeCurrency),
    ),
  ]);
  if (first !== null && currencies.size > 1) await ensureRatesFrom(first, todayOn);
  const rates =
    first === null || currencies.size === 1 ? new Map() : await ratesOn(currencies, first, todayOn);
  const known = new Set(
    (
      await resolveExternal(
        ctx,
        connection.provider,
        "investment_event",
        read.events.map((event) => event.externalId),
      )
    ).keys(),
  );
  return getDb().transaction(async (tx) => {
    const investment = await lockInvestmentAccount(ctx, linked.investment.accountId, tx);
    const { created, oldest } = await translated(
      writeEvents(ctx, tx, investment, linked.currency, read.events, known, rates, now),
    );
    await writeCoverage(ctx, tx, connection.id, "flows", read.coverage);
    if (read.rebase && read.historyFrom !== undefined) {
      await undoInferred(ctx, tx, investment, connection.provider);
    }
    const opened =
      read.historyFrom === undefined
        ? null
        : await translated(checkQuantities(ctx, tx, investment, connection.id, read, now));
    if (read.cursor !== undefined) {
      await saveSyncJob(ctx, connection.id, "flows", { cursor: read.cursor }, now, tx);
    }
    const from = [oldest, opened].filter((day): day is CivilDate => day !== null).sort()[0] ?? null;
    if (from !== null) await rebuild(ctx, investment, linked.currency, from, tx);
    return created;
  });
}

/**
 * The estimated history of a service whose provider has no history of its value (PERS-100,
 * Binance): once, after the flows have reached back past the connection, every day from the first
 * flow to the day before the first reading gets an `estimated` reading — the quantities rebuilt
 * backwards from that reading, at the exchange's daily closes — and the opening period moves back
 * to the first flow, so the chart and the net worth have the 24 months. Network first, then one
 * transaction (V6). Returns the days written.
 */
async function estimateHistoryOf(ctx: WriteCtx, linked: Linked, now: Date): Promise<number> {
  const source = sourceOf(linked.connection.provider);
  if (!source.fetchDailyRates) return 0;
  const { investment, currency } = linked;
  const periodsOf = (db: Pick<Tx, "select">) =>
    db
      .select()
      .from(investmentAccountPeriods)
      .where(
        and(
          userScoped(ctx).owns(investmentAccountPeriods),
          eq(investmentAccountPeriods.investmentAccountId, investment.id),
        ),
      )
      .orderBy(asc(investmentAccountPeriods.fromOn));
  const periods = await periodsOf(getDb());
  // Only a service connected new: a handover or a conversion has a history of its own before.
  if (periods.length !== 1 || periods[0].reason !== "opening" || periods[0].origin !== "synced") return 0;
  const opening = periods[0];
  const [anchor] = await getDb()
    .select({ id: investmentReadings.id, on: investmentReadings.on })
    .from(investmentReadings)
    .where(
      and(
        userScoped(ctx).owns(investmentReadings),
        eq(investmentReadings.investmentAccountId, investment.id),
        notInArray(investmentReadings.status, ["pending_zero", "estimated"]),
      ),
    )
    .orderBy(asc(investmentReadings.on))
    .limit(1);
  if (!anchor) return 0;
  const legRows = await getDb()
    .select({
      on: investmentEvents.on,
      kind: investmentOperations.kind,
      quantity: investmentOperations.quantity,
      nativeCurrency: investmentOperations.nativeCurrency,
      amountCents: investmentOperations.amountCents,
      symbol: investmentAssets.symbol,
      class: investmentAssets.class,
    })
    .from(investmentOperations)
    .innerJoin(investmentEvents, eq(investmentEvents.id, investmentOperations.eventId))
    .leftJoin(investmentHoldings, eq(investmentHoldings.id, investmentOperations.holdingId))
    .leftJoin(investmentAssets, eq(investmentAssets.id, investmentHoldings.assetId))
    .where(
      and(
        userScoped(ctx).owns(investmentOperations),
        eq(investmentEvents.investmentAccountId, investment.id),
      ),
    )
    .orderBy(asc(investmentEvents.on), asc(investmentOperations.id));
  const first = legRows[0]?.on ?? null;
  if (first === null || first >= opening.fromOn || first >= anchor.on) return 0;
  const positions = await getDb()
    .select({
      quantity: investmentReadingPositions.quantity,
      valueCents: investmentReadingPositions.valueCents,
      symbol: investmentAssets.symbol,
      class: investmentAssets.class,
    })
    .from(investmentReadingPositions)
    .innerJoin(investmentAssets, eq(investmentAssets.id, investmentReadingPositions.assetId))
    .where(
      and(
        userScoped(ctx).owns(investmentReadingPositions),
        eq(investmentReadingPositions.readingId, anchor.id),
      ),
    )
    .orderBy(asc(investmentReadingPositions.id));

  // The account's own cash is cents; every other asset, fiat included, a quantity to price.
  const isCash = (row: { class: string | null; symbol: string | null }) =>
    row.class === "cash" && row.symbol === currency;
  const quantities = new Map<string, bigint>();
  let cashCents = 0n;
  for (const row of positions) {
    if (isCash(row)) cashCents += row.valueCents ?? 0n;
    else if (row.symbol)
      quantities.set(
        row.symbol,
        (quantities.get(row.symbol) ?? 0n) + parseDecimal(row.quantity, QUANTITY_SCALE),
      );
  }
  const legs: HistoryLeg[] = legRows.map((row) => ({
    on: row.on,
    kind: row.kind,
    symbol: row.symbol === null || isCash(row) ? null : row.symbol,
    quantity: row.quantity === null ? null : parseDecimal(row.quantity, QUANTITY_SCALE),
    nativeCurrency: row.nativeCurrency,
    amountCents: row.amountCents,
  }));
  const coins = [
    ...new Set([...quantities.keys(), ...legs.flatMap((leg) => (leg.symbol ? [leg.symbol] : []))]),
  ];
  const todayOn = today(ctx.timeZone, now);
  const lookup = await ratesOn(new Set([...LOOKUP_CURRENCIES, currency]), addDays(first, -7), todayOn);
  const fx = fxLookupOf(lookup);
  const credentials = await readCredentials(ctx, linked.connection.id);
  const daily = await source.fetchDailyRates(
    credentials,
    coins,
    currency,
    new Date(`${first}T00:00:00Z`),
    now,
    fx,
  );
  const days: CivilDate[] = [];
  for (let day = first; day < anchor.on; day = addDays(day, 1)) days.push(day);
  const estimated = estimateHistory({
    days,
    anchor: { on: anchor.on, quantities, cashCents },
    moves: historyMoves(legs, currency),
    rate: (symbol, on) => {
      const text = daily[symbol]?.[on];
      if (text) return parseDecimal(text, HISTORY_RATE_SCALE);
      // Fiat other than the account's own: the ECB rate of the day (§1.8).
      const ecb = /^[A-Z]{3}$/.test(symbol) ? fx(symbol, currency, on) : null;
      return ecb === null ? null : parseDecimal(ecb, HISTORY_RATE_SCALE);
    },
  });
  if (estimated.length === 0) return 0;

  return getDb().transaction(async (tx) => {
    const locked = await lockInvestmentAccount(ctx, investment.accountId, tx);
    const again = await periodsOf(tx);
    // Someone else moved the period meanwhile (a conversion, a second pass): nothing to do.
    if (again.length !== 1 || again[0].id !== opening.id || again[0].fromOn !== opening.fromOn) return 0;
    for (let index = 0; index < estimated.length; index += 500) {
      await tx
        .insert(investmentReadings)
        .values(
          estimated.slice(index, index + 500).map((day) =>
            userScoped(ctx).stamp({
              investmentAccountId: locked.id,
              on: day.on,
              observedAt: new Date(`${day.on}T23:59:59Z`),
              status: "estimated" as const,
              totalCents: day.totalCents,
              cashCents: null,
              missingPrices: day.missingPrices,
            }),
          ),
        )
        .onConflictDoNothing({ target: [investmentReadings.investmentAccountId, investmentReadings.on] });
    }
    await tx
      .update(investmentAccountPeriods)
      .set({ fromOn: first, startsAt: new Date(`${first}T00:00:00Z`) })
      .where(
        and(eq(investmentAccountPeriods.id, opening.id), userScoped(ctx).owns(investmentAccountPeriods)),
      );
    await tx
      .update(investmentAccounts)
      .set({ managedSince: first, openedOn: first, updatedAt: now })
      .where(and(eq(investmentAccounts.id, locked.id), userScoped(ctx).owns(investmentAccounts)));
    await openedNoLaterThan(ctx, locked.accountId, first, tx);
    await writeCoverage(ctx, tx, linked.connection.id, "holdings", [
      {
        stream: "balance_history",
        fromAt: new Date(`${first}T00:00:00Z`),
        toAt: new Date(`${anchor.on}T00:00:00Z`),
        status: "partial",
        reason: "estimated",
      },
    ]);
    await rebuild(ctx, { ...locked, managedSince: first, openedOn: first }, currency, first, tx);
    return estimated.length;
  });
}

async function runFlows(ctx: WriteCtx, linked: Linked, now: Date): Promise<boolean> {
  const run = await recordRun(ctx, { connectionId: linked.connection.id, kind: "flows" });
  try {
    const created = await syncFlows(ctx, linked.connection, linked.investment.accountId, now);
    // The estimated history, once the flows are in (PERS-100): a failure waits for the next pass.
    const estimated = await estimateHistoryOf(ctx, linked, now).catch((error: unknown) => {
      console.error("[investments] history not estimated", sourceErrorLog(linked.connection.provider, error));
      return 0;
    });
    await finishRun(ctx, run.id, { counts: estimated > 0 ? { created, estimated } : { created } }, now);
    return true;
  } catch (error) {
    await finishRun(
      ctx,
      run.id,
      { counts: {}, error: sourceErrorText(linked.connection.provider, error) },
      now,
    );
    console.error("[investments] flows failed", sourceErrorLog(linked.connection.provider, error));
    return false;
  }
}

/** The holdings of a pass: the key checked again (SEC-01), then the reading of the day (R5). */
async function runHoldings(
  ctx: WriteCtx,
  linked: Linked,
  now: Date,
): Promise<"answered" | "failed" | "refused"> {
  const { connection, investment } = linked;
  const run = await recordRun(ctx, { connectionId: connection.id, kind: "holdings" });
  const source = sourceOf(connection.provider);
  let credentials: Record<string, string>;
  let check: KeyCheck;
  let snapshot: HoldingsSnapshot;
  try {
    credentials = await readCredentials(ctx, connection.id);
    check = await source.verifyReadOnly(credentials);
  } catch (error) {
    await insertKeyCheck(ctx, getDb(), {
      investmentAccountId: investment.id,
      connectionId: connection.id,
      provider: connection.provider,
      origin: "pass",
      check: null,
      now,
    });
    await finishRun(ctx, run.id, { counts: {}, error: sourceErrorText(connection.provider, error) }, now);
    return noteFailure(ctx, linked, error, now, "check");
  }
  await insertKeyCheck(ctx, getDb(), {
    investmentAccountId: investment.id,
    connectionId: connection.id,
    provider: connection.provider,
    origin: "pass",
    check,
    now,
  });
  if (check.result !== "read-only") {
    // §5.2: refused, nothing read, the administrator told which permission was found.
    const text = `${connection.provider} · key_${check.result.replace("-", "_")}`;
    await finishRun(ctx, run.id, { counts: {}, error: text }, now);
    await markConnection(ctx, connection.id, "error", text, now);
    // What the key may do beyond reading: eToro's scopes, Binance's flags that are on (§5.2).
    const found = Object.entries(check.permissions)
      .filter(([name, on]) => on && !name.endsWith(":read") && !READ_PERMISSIONS.has(name))
      .map(([name]) => name)
      .slice(0, 10);
    await alertAdmins({
      title: "Ledgerly: investment key refused",
      message: `The ${connection.provider} key is not read only (${found.join(", ") || check.result}). Ledgerly stopped reading it until a key that only reads is saved.`,
      priority: 8,
    });
    return "refused";
  }
  try {
    snapshot = await source.fetchHoldings(
      credentials,
      linked.currency,
      now,
      await todayLookup(ctx, linked.currency, now),
    );
  } catch (error) {
    await finishRun(ctx, run.id, { counts: {}, error: sourceErrorText(connection.provider, error) }, now);
    return noteFailure(ctx, linked, error, now, "read");
  }
  const todayOn = today(ctx.timeZone, now);
  await getDb().transaction(async (tx) => {
    const locked = await lockInvestmentAccount(ctx, investment.accountId, tx);
    await writeReading(ctx, tx, locked, {
      on: todayOn,
      observedAt: snapshot.observedAt,
      status: await statusOf(ctx, tx, locked, snapshot, todayOn),
      totalCents: snapshot.totalCents,
      cashCents: snapshot.cashCents,
      externalAccountId: snapshot.externalAccountId,
      snapshot,
      scopes: snapshot.scopes,
    });
    await rebuild(ctx, locked, linked.currency, todayOn, tx);
  });
  await finishRun(ctx, run.id, { counts: { updated: 1, created: snapshot.positions.length } }, now);
  return "answered";
}

async function backoffUntil(ctx: Pick<Ctx, "userId">, connectionId: string): Promise<Date | null> {
  const job = await readSyncJob(ctx, connectionId, "holdings");
  const value = job?.cursor?.[BACKOFF_KEY];
  if (!value) return null;
  const until = new Date(value);
  return Number.isNaN(until.getTime()) ? null : until;
}

/** One pass of a connection, with its lock (V9) and separate outcomes for holdings and flows (A8). */
async function passOf(
  ctx: WriteCtx,
  linked: Linked,
  now: Date,
  defer?: Defer,
): Promise<"answered" | "failed" | "refused"> {
  const { connection } = linked;
  const until = await backoffUntil(ctx, connection.id);
  if (connection.state === "revoked" || (until !== null && until > now)) {
    const reason =
      connection.state === "revoked"
        ? `${connection.provider} · revoked`
        : `${connection.provider} · rate_limited`;
    for (const kind of ["holdings", "flows"] as const) {
      const run = await recordRun(ctx, { connectionId: connection.id, kind });
      await skipRun(ctx, run.id, reason, now);
    }
    return "refused";
  }
  const holdings = await runHoldings(ctx, linked, now);
  if (holdings === "refused") return "refused";
  if (defer) {
    // "Sync now" answers with the value; the flows follow under the same lock (A8: apart anyway).
    defer(() => withJobLock(`investments-sync:${linked.connection.id}`, () => runFlows(ctx, linked, now)));
    return holdings;
  }
  const flows = await runFlows(ctx, linked, now);
  return holdings === "answered" && flows ? "answered" : "failed";
}

async function lockedPass(ctx: WriteCtx, linked: Linked, now: Date, defer?: Defer) {
  const result = await withJobLock(`investments-sync:${linked.connection.id}`, () =>
    passOf(ctx, linked, now, defer),
  );
  return result.ran ? result.value : ("busy" as const);
}

/** The dispatcher's pass of an investment connection (`platform/integrations/registry.ts`). */
export async function runInvestmentPass(
  _person: Person,
  ctx: Ctx,
  due: DueConnection,
  now: Date = new Date(),
): Promise<"answered" | "failed" | "refused" | "busy" | "absent"> {
  const connection = (await listConnections(ctx)).find((one) => one.id === due.id);
  if (!connection) return "absent";
  const linked = await linkedOf(ctx, connection);
  if (!linked) return "absent";
  return lockedPass(ctx, linked, now);
}

async function linkedAccount(ctx: Pick<Ctx, "userId">, accountId: string): Promise<Linked> {
  const investment = await requireInvestmentAccount(ctx, accountId);
  const connection = await connectionOf(ctx, investment.provider);
  if (!connection) throw new SyncError("not_connected");
  const linked = await linkedOf(ctx, connection);
  if (!linked || linked.investment.id !== investment.id) throw new SyncError("not_connected");
  return linked;
}

/** "Sync now" (§4.3): the same pass, at most once a minute per connection (SEC-09). */
export async function syncNow(
  ctx: WriteCtx,
  accountId: string,
  now: Date = new Date(),
  /** The flows after the answer (the action passes Next's `after`); inline by default. */
  defer?: Defer,
) {
  const linked = await linkedAccount(ctx, accountId);
  const [last] = await listRuns(ctx, { connectionId: linked.connection.id, limit: 1 });
  if (last && now.getTime() - last.startedAt.getTime() < COOLDOWN_MS) throw new SyncError("cooldown");
  const outcome = await lockedPass(ctx, linked, now, defer);
  if (outcome === "busy") throw new SyncError("cooldown");
  return outcome;
}

/** "Verify" (§4.3): the key's permissions again, with the same cooldown; nothing else is read. */
export async function verifyKey(
  ctx: WriteCtx,
  accountId: string,
  now: Date = new Date(),
): Promise<KeyCheck["result"]> {
  const linked = await linkedAccount(ctx, accountId);
  const [last] = await getDb()
    .select({ checkedAt: investmentKeyChecks.checkedAt })
    .from(investmentKeyChecks)
    .where(
      and(
        userScoped(ctx).owns(investmentKeyChecks),
        eq(investmentKeyChecks.investmentAccountId, linked.investment.id),
      ),
    )
    .orderBy(desc(investmentKeyChecks.checkedAt))
    .limit(1);
  if (last && now.getTime() - last.checkedAt.getTime() < COOLDOWN_MS) throw new SyncError("cooldown");
  let check: KeyCheck | null = null;
  try {
    check = await sourceOf(linked.connection.provider).verifyReadOnly(
      await readCredentials(ctx, linked.connection.id),
    );
  } catch (error) {
    await insertKeyCheck(ctx, getDb(), {
      investmentAccountId: linked.investment.id,
      connectionId: linked.connection.id,
      provider: linked.connection.provider,
      origin: "verify",
      check: null,
      now,
    });
    await noteFailure(ctx, linked, error, now, "check");
    throw new SyncError(codeOf(error));
  }
  await insertKeyCheck(ctx, getDb(), {
    investmentAccountId: linked.investment.id,
    connectionId: linked.connection.id,
    provider: linked.connection.provider,
    origin: "verify",
    check,
    now,
  });
  if (check.result === "read-only" && linked.connection.state !== "active") {
    await markConnection(ctx, linked.connection.id, "active", undefined, now);
  } else if (check.result !== "read-only") {
    await markConnection(
      ctx,
      linked.connection.id,
      "error",
      `${linked.connection.provider} · key_${check.result.replace("-", "_")}`,
      now,
    );
  }
  return check.result;
}

/** The provider's id of the account (eToro `gcid`, Binance `uid`) the latest reading came from. */
async function lastExternalAccountOf(ctx: Pick<Ctx, "userId">, investmentAccountId: string) {
  const [row] = await getDb()
    .select({ externalAccountId: investmentReadingScopes.externalAccountId })
    .from(investmentReadingScopes)
    .innerJoin(investmentReadings, eq(investmentReadings.id, investmentReadingScopes.readingId))
    .where(
      and(
        userScoped(ctx).owns(investmentReadings),
        userScoped(ctx).owns(investmentReadingScopes),
        eq(investmentReadings.investmentAccountId, investmentAccountId),
      ),
    )
    .orderBy(
      desc(investmentReadings.on),
      desc(investmentReadings.observedAt),
      asc(investmentReadingScopes.externalAccountId),
    )
    .limit(1);
  return row?.externalAccountId ?? null;
}

/**
 * "Replace key" (§5.3): through the same checks as a connection; on any failure the old key stays.
 * The new key must read the same external account as the latest reading (PERS-87 SEC-03). The old
 * key is retired, and the page asks for it to be revoked at the provider (SEC-07).
 */
export async function replaceKey(
  ctx: WriteCtx,
  accountId: string,
  credentials: Readonly<Record<string, string>>,
  now: Date = new Date(),
): Promise<void> {
  const linked = await linkedAccount(ctx, accountId);
  const provider = connectableProvider(linked.connection.provider);
  if (!provider) throw new SyncError("unknown_provider");
  const parsed = credentialSchemaOf(provider).safeParse(credentials);
  if (!parsed.success) throw new SyncError("invalid_credentials");
  const keys = parsed.data as Record<string, string>;
  takeKeyAttempt(ctx, provider.id, now);
  const source = sourceOf(provider.id);
  let check: KeyCheck;
  let snapshot: HoldingsSnapshot;
  try {
    check = await source.verifyReadOnly(keys);
    if (check.result !== "read-only") throw new SyncError("not_read_only");
    snapshot = await source.fetchHoldings(
      keys,
      linked.currency,
      now,
      await todayLookup(ctx, linked.currency, now),
    );
  } catch (error) {
    if (!(error instanceof SyncError))
      console.error("[investments] key not replaced", sourceErrorLog(provider.id, error));
    throw new SyncError(codeOf(error));
  }
  const previous = await lastExternalAccountOf(ctx, linked.investment.id);
  if (previous !== null && previous !== snapshot.externalAccountId) throw new SyncError("different_account");
  await saveConnection(ctx, { provider: provider.id, credentials: keys });
  await getDb().transaction(async (tx) => {
    await retireKeys(ctx, tx, linked.investment.id, now);
    await insertKeyCheck(ctx, tx, {
      investmentAccountId: linked.investment.id,
      connectionId: linked.connection.id,
      provider: provider.id,
      origin: "replace",
      check,
      now,
    });
  });
  await saveSyncJob(ctx, linked.connection.id, "holdings", { cursor: null }, now);
}

/**
 * "Disconnect" (§2.5, §5.3): synced → manual at today, V before = V after — the last counting
 * reading's positions become manual positions and the rest opening cash — then the key goes. The
 * page then shows the steps to revoke it at the provider.
 */
export async function disconnectProvider(
  ctx: WriteCtx,
  accountId: string,
  now: Date = new Date(),
): Promise<void> {
  const linked = await linkedAccount(ctx, accountId);
  const todayOn = today(ctx.timeZone, now);
  await getDb().transaction(async (tx) => {
    const investment = await lockInvestmentAccount(ctx, accountId, tx);
    const book = await loadBook(ctx, investment, linked.currency, tx);
    const current = periodOn(book, todayOn);
    if (current === null || current.origin !== "synced") throw new SyncError("not_connected");
    const rates = await ratesFor(book, todayOn);
    const value = valueOn(book, todayOn, rates).valueCents;
    const startsAt =
      current.startsAt.getTime() >= now.getTime() ? new Date(current.startsAt.getTime() + 1) : now;
    await tx.insert(investmentAccountPeriods).values(
      userScoped(ctx).stamp({
        investmentAccountId: investment.id,
        fromOn: todayOn,
        startsAt,
        mode: value === null ? ("total" as const) : ("assets" as const),
        origin: "manual" as const,
        reason: "conversion" as const,
      }),
    );
    if (value !== null) {
      const reading = [...book.readingRows]
        .filter((one) => one.status !== "pending_zero")
        .sort((a, b) => (a.on < b.on ? 1 : -1))[0];
      const positions = reading
        ? await tx
            .select()
            .from(investmentReadingPositions)
            .where(
              and(
                userScoped(ctx).owns(investmentReadingPositions),
                eq(investmentReadingPositions.readingId, reading.id),
              ),
            )
            .orderBy(asc(investmentReadingPositions.id))
        : [];
      let positionsCents = 0n;
      const opened: { holdingId: string; quantity: bigint; valueCents: Cents }[] = [];
      for (const position of positions) {
        if (position.valueCents === null) continue;
        const quantity = parseDecimal(position.quantity, QUANTITY_SCALE);
        if (quantity <= 0n) continue;
        const [holding] = await tx
          .insert(investmentHoldings)
          .values(
            userScoped(ctx).stamp({
              investmentAccountId: investment.id,
              assetId: position.assetId,
              origin: "manual" as const,
              product: position.product,
              openedOn: todayOn,
            }),
          )
          .onConflictDoUpdate({
            target: [
              investmentHoldings.investmentAccountId,
              investmentHoldings.assetId,
              investmentHoldings.origin,
              investmentHoldings.product,
            ],
            set: { openedOn: todayOn },
          })
          .returning({ id: investmentHoldings.id });
        opened.push({ holdingId: holding.id, quantity, valueCents: position.valueCents });
        positionsCents += position.valueCents;
      }
      await insertEvent(ctx, tx, investment.id, {
        on: todayOn,
        occurredAt: startsAt,
        origin: "conversion",
        legs: [{ leg: "main", kind: "opening_cash", amountCents: value - positionsCents }],
      });
      for (const one of opened) {
        await insertEvent(ctx, tx, investment.id, {
          on: todayOn,
          occurredAt: startsAt,
          origin: "conversion",
          legs: [
            {
              leg: "main",
              kind: "opening_position",
              holdingId: one.holdingId,
              quantity: one.quantity,
              unitPrice: divRound(
                one.valueCents * 10n ** BigInt(QUANTITY_SCALE + PRICE_SCALE - 2),
                one.quantity,
              ),
              priceCurrency: linked.currency,
              amountCents: -one.valueCents,
            },
          ],
        });
      }
    }
    await retireKeys(ctx, tx, investment.id, now);
    await tx
      .update(investmentAccounts)
      .set({ provider: "manual", updatedAt: now })
      .where(and(eq(investmentAccounts.id, investment.id), userScoped(ctx).owns(investmentAccounts)));
    await rebuild(ctx, investment, linked.currency, todayOn, tx);
  });
  await deleteConnection(ctx, linked.connection.id);
}

/** "I revoked it" (SEC-07): the retired keys of a service are confirmed revoked at the provider. */
export async function confirmKeyRevoked(ctx: Pick<Ctx, "userId">, accountId: string, now: Date = new Date()) {
  const investment = await requireInvestmentAccount(ctx, accountId);
  await getDb()
    .update(investmentKeyChecks)
    .set({ revokedAtProviderAt: now })
    .where(
      and(
        userScoped(ctx).owns(investmentKeyChecks),
        eq(investmentKeyChecks.investmentAccountId, investment.id),
        isNull(investmentKeyChecks.revokedAtProviderAt),
        // Only keys that stopped being used: the current one is not revoked.
        isNotNull(investmentKeyChecks.retiredAt),
      ),
    );
}

// ——— What the service page shows (§4.3) ——————————————————————————————————————————————————————

export interface SyncStatus {
  provider: string;
  connected: boolean;
  state: Connection["state"] | null;
  lastOkAt: Date | null;
  lastError: string | null;
  nextSyncAt: Date | null;
  lastCheck: { result: string; checkedAt: Date; ipRestricted: boolean | null } | null;
  keySetAt: Date | null;
  /** Retired keys not yet confirmed revoked at the provider (SEC-07). */
  revokePending: boolean;
  /** 90 days after the key was set: time to rotate it (§5.3). */
  rotateDue: boolean;
  coverage: {
    kind: string;
    stream: string;
    fromAt: Date;
    toAt: Date;
    status: string;
    reason: string | null;
  }[];
  /** The first day from which every flow is covered (§2.4); `null` while one never is. */
  reliableFrom: Date | null;
  complete: boolean;
}

const ROTATE_AFTER_MS = 90 * 86_400_000;

export async function syncStatus(
  ctx: Pick<Ctx, "userId">,
  investment: InvestmentAccount,
  now: Date = new Date(),
): Promise<SyncStatus | null> {
  const checks = await getDb()
    .select()
    .from(investmentKeyChecks)
    .where(
      and(
        userScoped(ctx).owns(investmentKeyChecks),
        eq(investmentKeyChecks.investmentAccountId, investment.id),
      ),
    )
    .orderBy(desc(investmentKeyChecks.checkedAt), desc(investmentKeyChecks.id));
  const connection = investment.provider === "manual" ? null : await connectionOf(ctx, investment.provider);
  if (!connection && checks.length === 0) return null;
  const coverage = connection
    ? await getDb()
        .select()
        .from(investmentSyncCoverage)
        .where(
          and(
            userScoped(ctx).owns(investmentSyncCoverage),
            eq(investmentSyncCoverage.connectionId, connection.id),
          ),
        )
        .orderBy(asc(investmentSyncCoverage.stream), asc(investmentSyncCoverage.fromAt))
    : [];
  const flows = coverage.filter((row) => row.kind === "flows");
  const streams = [...new Set(flows.map((row) => row.stream))];
  let reliableFrom: Date | null = null;
  let complete = streams.length > 0;
  for (const stream of streams) {
    const rows = flows.filter((row) => row.stream === stream);
    const last = rows.at(-1);
    if (!last || last.status !== "complete") {
      complete = false;
      reliableFrom = null;
      break;
    }
    if (rows.some((row) => row.status !== "complete")) complete = false;
    if (reliableFrom === null || last.fromAt > reliableFrom) reliableFrom = last.fromAt;
  }
  const active = checks.filter((check) => check.retiredAt === null);
  const set =
    active.filter((check) => check.origin === "connect" || check.origin === "replace").at(0) ?? null;
  const last = active[0] ?? null;
  return {
    provider: investment.provider === "manual" ? (checks[0]?.provider ?? "manual") : investment.provider,
    connected: connection !== null,
    state: connection?.state ?? null,
    lastOkAt: connection?.lastOkAt ?? null,
    lastError: connection?.lastError ?? null,
    nextSyncAt: connection?.nextSyncAt ?? null,
    lastCheck: last
      ? { result: last.result, checkedAt: last.checkedAt, ipRestricted: last.ipRestricted }
      : null,
    keySetAt: set?.checkedAt ?? null,
    revokePending: checks.some((check) => check.retiredAt !== null && check.revokedAtProviderAt === null),
    rotateDue: set !== null && now.getTime() - set.checkedAt.getTime() >= ROTATE_AFTER_MS,
    coverage: coverage.map((row) => ({
      kind: row.kind,
      stream: row.stream,
      fromAt: row.fromAt,
      toAt: row.toAt,
      status: row.status,
      reason: row.reason,
    })),
    reliableFrom: complete ? null : reliableFrom,
    complete,
  };
}
