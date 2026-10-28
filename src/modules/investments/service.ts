import "server-only";
import { randomUUID } from "node:crypto";
import { and, asc, eq, inArray, isNull } from "drizzle-orm";
import { z } from "zod";
import { balancesOn, getAccount, listAccounts } from "@/modules/accounts/queries";
import { createAccount, replacePortfolioPoints, takeOverEntries } from "@/modules/accounts/service";
import { valuationAccountIds } from "@/modules/funds/queries";
import { getTransaction } from "@/modules/transactions/queries";
import type { Ctx } from "@/platform/context";
import { type CivilDate, isCivilDate, today } from "@/platform/dates";
import { getDb, type Tx } from "@/platform/db/client";
import { hasPgError, UNIQUE_VIOLATION } from "@/platform/db/errors";
import { userScoped } from "@/platform/db/scope";
import { eurPerUnitOn, type RateTable } from "@/platform/fx/rules";
import { ratesOn } from "@/platform/fx/service";
import type { Cents } from "@/platform/money";
import { accountTypeOf, ASSET_SEED, MANUAL_PROVIDER } from "./catalog";
import {
  ASSET_CLASSES,
  atRate,
  type Book,
  divRound,
  computePoints,
  type EventLike,
  type EventOrigin,
  formatDecimal,
  INVESTMENT_CATEGORIES,
  type Leg,
  MODES,
  type Mode,
  oldestDay,
  TRANSFER_WINDOW_DAYS,
  type TransferLeg,
  type OperationKind,
  type OperationLike,
  openingCashFor,
  parseDecimal,
  PRICE_SCALE,
  PRODUCT_PATTERN,
  positionCents,
  missingPricesOf,
  QUANTITY_SCALE,
  RATE_SCALE,
  READING_STATUSES,
  RECONCILIATION_KINDS,
  valueOn,
} from "./rules";
import {
  investmentAccountPeriods,
  investmentAccounts,
  investmentAssets,
  investmentEvents,
  investmentHoldings,
  investmentOperationRevisions,
  investmentOperations,
  investmentReadingPositions,
  investmentReadings,
  investmentReadingScopes,
  investmentReconciliations,
  investmentSupersededEntries,
} from "./schema";

export type InvestmentAccount = typeof investmentAccounts.$inferSelect;
export type InvestmentAsset = typeof investmentAssets.$inferSelect;
export type InvestmentHolding = typeof investmentHoldings.$inferSelect;
export type InvestmentEvent = typeof investmentEvents.$inferSelect;
export type InvestmentOperation = typeof investmentOperations.$inferSelect;
export type InvestmentPeriod = typeof investmentAccountPeriods.$inferSelect;
export type InvestmentReading = typeof investmentReadings.$inferSelect;

export type InvestmentErrorCode =
  | "not_found"
  | "future_date"
  | "not_eligible"
  | "wrong_mode"
  | "negative_cash"
  | "no_value"
  | "duplicate_asset"
  | "duplicate_holding"
  | "invalid_transaction"
  | "already_linked"
  | "not_editable"
  | "before_period"
  | "not_a_transfer";

export class InvestmentError extends Error {
  constructor(readonly code: InvestmentErrorCode) {
    super(code);
    this.name = "InvestmentError";
  }
}

export type WriteCtx = Pick<Ctx, "userId" | "timeZone">;

export function translated<T>(write: Promise<T>): Promise<T> {
  return write.catch((error: unknown) => {
    if (hasPgError(error, UNIQUE_VIOLATION, "investment_events_transaction_uq")) {
      throw new InvestmentError("already_linked");
    }
    if (
      hasPgError(error, UNIQUE_VIOLATION, "investment_assets_isin_uq") ||
      hasPgError(error, UNIQUE_VIOLATION, "investment_assets_symbol_uq")
    ) {
      throw new InvestmentError("duplicate_asset");
    }
    if (hasPgError(error, UNIQUE_VIOLATION, "investment_holdings_uq")) {
      throw new InvestmentError("duplicate_holding");
    }
    throw error;
  });
}

function notFuture(ctx: WriteCtx, on: CivilDate): void {
  if (!isCivilDate(on)) throw new RangeError(`Not a civil date: "${on}"`);
  if (on > today(ctx.timeZone)) throw new InvestmentError("future_date");
}

const decimal = (value: bigint | null, scale: number) =>
  value === null ? null : formatDecimal(value, scale);
const fromNumeric = (value: string | null, scale: number) =>
  value === null ? null : parseDecimal(value, scale);

// ——— Reading an account's book ——————————————————————————————————————————————————————————————

export async function requireInvestmentAccount(
  ctx: Pick<Ctx, "userId">,
  accountId: string,
  tx?: Tx,
): Promise<InvestmentAccount> {
  const [row] = await (tx ?? getDb())
    .select()
    .from(investmentAccounts)
    .where(and(eq(investmentAccounts.accountId, accountId), userScoped(ctx).owns(investmentAccounts)));
  if (!row) throw new InvestmentError("not_found");
  return row;
}

/** Takes the account's row lock: two writes to one account rebuild its points one after the other. */
export async function lockInvestmentAccount(ctx: Pick<Ctx, "userId">, accountId: string, tx: Tx) {
  const [row] = await tx
    .select()
    .from(investmentAccounts)
    .where(and(eq(investmentAccounts.accountId, accountId), userScoped(ctx).owns(investmentAccounts)))
    .for("update");
  if (!row) throw new InvestmentError("not_found");
  return row;
}

/** Awaits lazy query builders one at a time, keeping the tuple's types. */
async function inOrder<T extends readonly unknown[]>(
  queries: T,
): Promise<{ -readonly [K in keyof T]: Awaited<T[K]> }> {
  const results: unknown[] = [];
  for (const query of queries) results.push(await query);
  return results as { -readonly [K in keyof T]: Awaited<T[K]> };
}

export interface LoadedBook extends Book {
  periodRows: InvestmentPeriod[];
  eventRows: InvestmentEvent[];
  operationRows: InvestmentOperation[];
  holdingRows: (InvestmentHolding & { asset: InvestmentAsset })[];
  readingRows: InvestmentReading[];
}

/** Everything the engine needs about one account, read in one go (inside `tx` when given). */
export async function loadBook(
  ctx: Pick<Ctx, "userId">,
  investment: InvestmentAccount,
  currency: string,
  tx?: Tx,
): Promise<LoadedBook> {
  const db = tx ?? getDb();
  const id = investment.id;
  // One after the other: inside a transaction they share one connection, and a query builder only
  // runs when awaited, so a `Promise.all` would pile them onto the same client at once.
  const [
    periodRows,
    eventRows,
    operationRows,
    holdingJoin,
    readingRows,
    positionRows,
    scopeRows,
    reconciliations,
  ] = await inOrder([
    db
      .select()
      .from(investmentAccountPeriods)
      .where(
        and(
          userScoped(ctx).owns(investmentAccountPeriods),
          eq(investmentAccountPeriods.investmentAccountId, id),
        ),
      )
      .orderBy(asc(investmentAccountPeriods.fromOn), asc(investmentAccountPeriods.startsAt)),
    db
      .select()
      .from(investmentEvents)
      .where(and(userScoped(ctx).owns(investmentEvents), eq(investmentEvents.investmentAccountId, id)))
      .orderBy(asc(investmentEvents.on), asc(investmentEvents.occurredAt), asc(investmentEvents.seq)),
    db
      .select({ operation: investmentOperations })
      .from(investmentOperations)
      .innerJoin(investmentEvents, eq(investmentEvents.id, investmentOperations.eventId))
      .where(and(userScoped(ctx).owns(investmentOperations), eq(investmentEvents.investmentAccountId, id)))
      .orderBy(asc(investmentOperations.eventId), asc(investmentOperations.leg)),
    db
      .select({ holding: investmentHoldings, asset: investmentAssets })
      .from(investmentHoldings)
      .innerJoin(investmentAssets, eq(investmentAssets.id, investmentHoldings.assetId))
      .where(and(userScoped(ctx).owns(investmentHoldings), eq(investmentHoldings.investmentAccountId, id)))
      .orderBy(asc(investmentAssets.name), asc(investmentHoldings.id)),
    db
      .select()
      .from(investmentReadings)
      .where(and(userScoped(ctx).owns(investmentReadings), eq(investmentReadings.investmentAccountId, id)))
      .orderBy(asc(investmentReadings.on)),
    db
      .select({ position: investmentReadingPositions })
      .from(investmentReadingPositions)
      .innerJoin(investmentReadings, eq(investmentReadings.id, investmentReadingPositions.readingId))
      .where(
        and(userScoped(ctx).owns(investmentReadingPositions), eq(investmentReadings.investmentAccountId, id)),
      )
      .orderBy(asc(investmentReadingPositions.id)),
    db
      .select({ scope: investmentReadingScopes })
      .from(investmentReadingScopes)
      .innerJoin(investmentReadings, eq(investmentReadings.id, investmentReadingScopes.readingId))
      .where(
        and(userScoped(ctx).owns(investmentReadingScopes), eq(investmentReadings.investmentAccountId, id)),
      )
      .orderBy(asc(investmentReadingScopes.id)),
    db
      .select({ reconciliation: investmentReconciliations })
      .from(investmentReconciliations)
      .innerJoin(investmentHoldings, eq(investmentHoldings.id, investmentReconciliations.holdingId))
      .where(
        and(userScoped(ctx).owns(investmentReconciliations), eq(investmentHoldings.investmentAccountId, id)),
      )
      .orderBy(asc(investmentReconciliations.effectiveOn), asc(investmentReconciliations.decidedAt)),
  ]);
  const operations = operationRows.map((row) => row.operation);
  const opsByEvent = new Map<string, OperationLike[]>();
  for (const op of operations) {
    const list = opsByEvent.get(op.eventId) ?? [];
    list.push({
      leg: op.leg,
      holdingId: op.holdingId,
      kind: op.kind,
      quantity: fromNumeric(op.quantity, QUANTITY_SCALE),
      unitPrice: fromNumeric(op.unitPrice, PRICE_SCALE),
      priceCurrency: op.priceCurrency,
      amountCents: op.amountCents,
      fxRate: fromNumeric(op.fxRate, RATE_SCALE),
      validUntil: op.validUntil,
    });
    opsByEvent.set(op.eventId, list);
  }
  const events: EventLike[] = eventRows.map((event) => ({
    id: event.id,
    on: event.on,
    occurredAt: event.occurredAt,
    seq: event.seq,
    origin: event.origin,
    transferGroupId: event.transferGroupId,
    operations: opsByEvent.get(event.id) ?? [],
  }));
  const holdingRows = holdingJoin.map((row) => ({ ...row.holding, asset: row.asset }));
  return {
    currency,
    periods: periodRows.map((period) => ({
      fromOn: period.fromOn,
      startsAt: period.startsAt,
      mode: period.mode,
      origin: period.origin,
    })),
    events,
    holdings: holdingRows.map((holding) => ({
      id: holding.id,
      assetId: holding.assetId,
      origin: holding.origin,
      product: holding.product,
      currency: holding.asset.currency,
    })),
    readings: readingRows.map((reading) => ({
      id: reading.id,
      on: reading.on,
      status: reading.status,
      totalCents: reading.totalCents,
      positions: positionRows
        .filter((row) => row.position.readingId === reading.id)
        .map((row) => ({
          assetId: row.position.assetId,
          product: row.position.product,
          valueCents: row.position.valueCents,
          quantity: fromNumeric(row.position.quantity, QUANTITY_SCALE),
        })),
      scopes: scopeRows
        .filter((row) => row.scope.readingId === reading.id)
        .map((row) => ({ product: row.scope.product, complete: row.scope.complete })),
    })),
    reconciliations: reconciliations.map(({ reconciliation }) => ({
      holdingId: reconciliation.holdingId,
      effectiveOn: reconciliation.effectiveOn,
      kind: reconciliation.kind,
      quantity: fromNumeric(reconciliation.quantity, QUANTITY_SCALE),
      decidedAt: reconciliation.decidedAt,
    })),
    periodRows,
    eventRows,
    operationRows: operations,
    holdingRows,
    readingRows,
  };
}

/** The rates a book's values need: its account currency and every asset's quote currency. */
export async function ratesFor(book: Book, to: CivilDate): Promise<RateTable> {
  const from = book.periods.reduce<CivilDate>(
    (min, period) => (period.fromOn < min ? period.fromOn : min),
    to,
  );
  const currencies = new Set([book.currency, ...book.holdings.map((holding) => holding.currency)]);
  return currencies.size === 1 ? new Map() : ratesOn(currencies, from, to);
}

/**
 * Rewrites the account's `portfolio` points from `from` on (§1.7), inside the transaction that
 * changed its data: the engine on the book as the transaction now sees it.
 */
export async function rebuild(
  ctx: WriteCtx,
  investment: InvestmentAccount,
  currency: string,
  from: CivilDate,
  tx: Tx,
): Promise<void> {
  const book = await loadBook(ctx, investment, currency, tx);
  const todayOn = today(ctx.timeZone);
  const rates = await ratesFor(book, todayOn);
  const points = computePoints(book, rates, todayOn, from);
  await replacePortfolioPoints(ctx, investment.accountId, from, points, tx);
}

export async function currencyOf(ctx: Pick<Ctx, "userId">, accountId: string): Promise<string> {
  const account = await getAccount(ctx, accountId);
  if (!account) throw new InvestmentError("not_found");
  return account.currency;
}

/** Rewrites every point of an account from its first period: the repair the itests also run. */
export async function rebuildAll(ctx: WriteCtx, accountId: string): Promise<void> {
  const account = await getAccount(ctx, accountId);
  if (!account) throw new InvestmentError("not_found");
  await getDb().transaction(async (tx) => {
    const investment = await lockInvestmentAccount(ctx, accountId, tx);
    const [first] = await tx
      .select({ fromOn: investmentAccountPeriods.fromOn })
      .from(investmentAccountPeriods)
      .where(
        and(
          userScoped(ctx).owns(investmentAccountPeriods),
          eq(investmentAccountPeriods.investmentAccountId, investment.id),
        ),
      )
      .orderBy(asc(investmentAccountPeriods.fromOn))
      .limit(1);
    if (first) await rebuild(ctx, investment, account.currency, first.fromOn, tx);
  });
}

// ——— Services —————————————————————————————————————————————————————————————————————————————

const url = z
  .string()
  .trim()
  .max(500)
  .transform((value) => (value === "" || /^[a-z][a-z0-9+.-]*:/i.test(value) ? value : `https://${value}`))
  .refine((value) => {
    if (value === "") return true;
    try {
      const parsed = new URL(value);
      return (parsed.protocol === "https:" || parsed.protocol === "http:") && parsed.hostname.includes(".");
    } catch {
      return false;
    }
  }, "Not a web address")
  .transform((value) => (value === "" ? null : value));

export const manualServiceSchema = z.discriminatedUnion("target", [
  z.object({
    target: z.literal("new"),
    name: z.string().trim().min(1).max(80),
    category: z.enum(INVESTMENT_CATEGORIES),
    currency: z.string().regex(/^[A-Z]{3}$/),
    mode: z.enum(MODES),
    url: url.nullable().default(null),
  }),
  z.object({
    target: z.literal("existing"),
    accountId: z.uuid(),
    category: z.enum(INVESTMENT_CATEGORIES),
    mode: z.enum(MODES),
    url: url.nullable().default(null),
  }),
]);
export type ManualServiceInput = z.input<typeof manualServiceSchema>;

/**
 * The accounts "Use the existing account" may offer (§1.3): manual, open accounts of type
 * investment or crypto that no other module writes — not a fund's valuation account, not already
 * a service. A synced account is fed by its connection, so it is never one.
 */
export async function eligibleAccounts(ctx: Pick<Ctx, "userId">) {
  const [all, funded, managed] = await Promise.all([
    listAccounts(ctx),
    valuationAccountIds(ctx),
    getDb()
      .select({ accountId: investmentAccounts.accountId })
      .from(investmentAccounts)
      .where(userScoped(ctx).owns(investmentAccounts)),
  ]);
  const taken = new Set([...funded, ...managed.map((row) => row.accountId)]);
  return all.map((account) => ({
    account,
    reason:
      account.type !== "investment" && account.type !== "crypto"
        ? ("type" as const)
        : account.origin !== "manual"
          ? ("synced" as const)
          : taken.has(account.id)
            ? funded.has(account.id)
              ? ("fund" as const)
              : ("managed" as const)
            : null,
  }));
}

/**
 * A manual service (§4.2): a new account, or an existing one handed over (§1.3, A4). Either way
 * one transaction: the account, its service row, its first period, the handover's archive and the
 * first points — so no moment exists in which the account has two writers or none.
 */
export async function createManualService(
  ctx: Ctx,
  input: ManualServiceInput,
): Promise<{ accountId: string }> {
  const parsed = manualServiceSchema.parse(input);
  const todayOn = today(ctx.timeZone);
  const now = new Date();

  if (parsed.target === "new") {
    return getDb().transaction(async (tx) => {
      const account = await createAccount(
        ctx,
        {
          name: parsed.name,
          type: accountTypeOf(parsed.category),
          currency: parsed.currency,
          openedOn: todayOn,
        },
        tx,
      );
      const [investment] = await tx
        .insert(investmentAccounts)
        .values(
          userScoped(ctx).stamp({
            accountId: account.id,
            category: parsed.category,
            provider: MANUAL_PROVIDER,
            managedSince: todayOn,
            url: parsed.url,
            openedOn: todayOn,
          }),
        )
        .returning();
      await tx.insert(investmentAccountPeriods).values(
        userScoped(ctx).stamp({
          investmentAccountId: investment.id,
          fromOn: todayOn,
          startsAt: now,
          mode: parsed.mode,
          origin: "manual" as const,
          reason: "opening" as const,
        }),
      );
      await rebuild(ctx, investment, account.currency, todayOn, tx);
      return { accountId: account.id };
    });
  }

  const eligible = (await eligibleAccounts(ctx)).find((one) => one.account.id === parsed.accountId);
  if (!eligible || eligible.reason !== null) throw new InvestmentError("not_eligible");
  // The balance at T, read before the handover removes the entries it is made of.
  const opening = (await balancesOn(ctx, [parsed.accountId], todayOn)).get(parsed.accountId) ?? null;
  return getDb().transaction(async (tx) => {
    const [investment] = await tx
      .insert(investmentAccounts)
      .values(
        userScoped(ctx).stamp({
          accountId: parsed.accountId,
          category: parsed.category,
          provider: MANUAL_PROVIDER,
          managedSince: todayOn,
          url: parsed.url,
          openedOn: eligible.account.openedOn ?? todayOn,
        }),
      )
      .returning();
    await tx.insert(investmentAccountPeriods).values(
      userScoped(ctx).stamp({
        investmentAccountId: investment.id,
        fromOn: todayOn,
        startsAt: now,
        mode: parsed.mode,
        origin: "manual" as const,
        reason: "handover" as const,
      }),
    );
    if (opening !== null) {
      await insertEvent(ctx, tx, investment.id, {
        on: todayOn,
        occurredAt: now,
        origin: "conversion",
        legs: [
          {
            leg: "main",
            kind: parsed.mode === "total" ? "account_valuation" : "opening_cash",
            amountCents: opening,
          },
        ],
      });
    }
    const removed = await takeOverEntries(ctx, parsed.accountId, todayOn, tx);
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
    await rebuild(ctx, investment, eligible.account.currency, todayOn, tx);
    return { accountId: parsed.accountId };
  });
}

export async function updateServiceUrl(
  ctx: Pick<Ctx, "userId">,
  accountId: string,
  value: string,
): Promise<void> {
  const parsed = url.parse(value);
  const investment = await requireInvestmentAccount(ctx, accountId);
  await getDb()
    .update(investmentAccounts)
    .set({ url: parsed })
    .where(and(eq(investmentAccounts.id, investment.id), userScoped(ctx).owns(investmentAccounts)));
}

// ——— Assets —————————————————————————————————————————————————————————————————————————————

export const assetInputSchema = z.object({
  class: z.enum(ASSET_CLASSES),
  name: z.string().trim().min(1).max(120),
  isin: z
    .string()
    .trim()
    .toUpperCase()
    .regex(/^([A-Z]{2}[A-Z0-9]{9}[0-9])?$/)
    .transform((value) => (value === "" ? null : value))
    .nullable()
    .default(null),
  symbol: z
    .string()
    .trim()
    .toUpperCase()
    .max(20)
    .transform((value) => (value === "" ? null : value))
    .nullable()
    .default(null),
  currency: z.string().regex(/^[A-Z]{3}$/),
});
export type AssetInput = z.input<typeof assetInputSchema>;

/** The seed of the asset catalog (§1.4), written once for a person who has none yet. */
export async function ensureAssetSeed(ctx: Pick<Ctx, "userId">): Promise<void> {
  const [existing] = await getDb()
    .select({ id: investmentAssets.id })
    .from(investmentAssets)
    .where(userScoped(ctx).owns(investmentAssets))
    .limit(1);
  if (existing) return;
  await getDb()
    .insert(investmentAssets)
    .values(ASSET_SEED.map((asset) => userScoped(ctx).stamp({ ...asset })))
    .onConflictDoNothing();
}

export async function createAsset(
  ctx: Pick<Ctx, "userId">,
  input: AssetInput,
  tx?: Tx,
): Promise<InvestmentAsset> {
  const parsed = assetInputSchema.parse(input);
  const [row] = await translated(
    (tx ?? getDb()).insert(investmentAssets).values(userScoped(ctx).stamp(parsed)).returning(),
  );
  return row;
}

async function requireAsset(ctx: Pick<Ctx, "userId">, id: string, tx: Tx): Promise<InvestmentAsset> {
  const [row] = await tx
    .select()
    .from(investmentAssets)
    .where(and(eq(investmentAssets.id, id), userScoped(ctx).owns(investmentAssets)));
  if (!row) throw new InvestmentError("not_found");
  return row;
}

async function holdingFor(
  ctx: Pick<Ctx, "userId">,
  tx: Tx,
  investmentAccountId: string,
  assetId: string,
  product: string,
  on: CivilDate,
): Promise<InvestmentHolding> {
  const [found] = await tx
    .select()
    .from(investmentHoldings)
    .where(
      and(
        userScoped(ctx).owns(investmentHoldings),
        eq(investmentHoldings.investmentAccountId, investmentAccountId),
        eq(investmentHoldings.assetId, assetId),
        eq(investmentHoldings.origin, "manual"),
        eq(investmentHoldings.product, product),
      ),
    );
  if (found) return found;
  const [row] = await tx
    .insert(investmentHoldings)
    .values(
      userScoped(ctx).stamp({
        investmentAccountId,
        assetId,
        origin: "manual" as const,
        product,
        openedOn: on,
      }),
    )
    .returning();
  return row;
}

// ——— Events ———————————————————————————————————————————————————————————————————————————————

export interface LegInput {
  leg: Leg;
  kind: OperationKind;
  holdingId?: string | null;
  quantity?: bigint | null;
  unitPrice?: bigint | null;
  priceCurrency?: string | null;
  nativeAmount?: bigint | null;
  nativeCurrency?: string | null;
  fxRate?: bigint | null;
  fxSource?: string | null;
  amountCents: Cents;
  validUntil?: CivilDate | null;
  /** `inferred` for the opening a provider's history implies (A6); `reported` otherwise. */
  quantityBasis?: "reported" | "reconstructed" | "inferred";
}

export async function insertEvent(
  ctx: Pick<Ctx, "userId">,
  tx: Tx,
  investmentAccountId: string,
  input: {
    on: CivilDate;
    occurredAt: Date;
    origin: EventOrigin;
    note?: string | null;
    transactionId?: string | null;
    legs: readonly LegInput[];
  },
): Promise<InvestmentEvent> {
  const [event] = await translated(
    tx
      .insert(investmentEvents)
      .values(
        userScoped(ctx).stamp({
          investmentAccountId,
          on: input.on,
          occurredAt: input.occurredAt,
          origin: input.origin,
          note: input.note ?? null,
          transactionId: input.transactionId ?? null,
        }),
      )
      .returning(),
  );
  await insertLegs(ctx, tx, event.id, input.legs);
  return event;
}

async function insertLegs(ctx: Pick<Ctx, "userId">, tx: Tx, eventId: string, legs: readonly LegInput[]) {
  if (legs.length === 0) return;
  await tx.insert(investmentOperations).values(
    legs.map((leg) =>
      userScoped(ctx).stamp({
        eventId,
        leg: leg.leg,
        kind: leg.kind,
        holdingId: leg.holdingId ?? null,
        quantity: decimal(leg.quantity ?? null, QUANTITY_SCALE),
        unitPrice: decimal(leg.unitPrice ?? null, PRICE_SCALE),
        priceCurrency: leg.priceCurrency ?? null,
        nativeAmount: decimal(leg.nativeAmount ?? null, PRICE_SCALE),
        nativeCurrency: leg.nativeCurrency ?? null,
        fxRate: decimal(leg.fxRate ?? null, RATE_SCALE),
        fxSource: leg.fxSource ?? null,
        amountCents: leg.amountCents,
        validUntil: leg.validUntil ?? null,
        quantityBasis: leg.quantityBasis ?? "reported",
      }),
    ),
  );
}

/** The period in force at the end of `on` (the book's), or `null` before the first one. */
export function periodOn(book: LoadedBook, on: CivilDate): InvestmentPeriod | null {
  let found: InvestmentPeriod | null = null;
  for (const period of book.periodRows) if (period.fromOn <= on) found = period;
  return found;
}

/**
 * The rate from an asset's quote currency to the account's on a day (§1.8): the one typed, or the
 * ECB one, saved with its source on the operation (A5). `null` when neither exists.
 */
async function rateOf(
  from: string,
  to: string,
  on: CivilDate,
  typed: bigint | null,
): Promise<{ fxRate: bigint | null; fxSource: string | null }> {
  if (from === to) return { fxRate: null, fxSource: null };
  if (typed !== null) return { fxRate: typed, fxSource: "manual" };
  const rates = await ratesOn([from, to], on, on);
  const source = eurPerUnitOn(rates, from, on);
  const target = eurPerUnitOn(rates, to, on);
  if (source === null || target === null) return { fxRate: null, fxSource: null };
  return { fxRate: divRound(source * 10n ** BigInt(RATE_SCALE), target), fxSource: `ecb:${on}` };
}

/** A price typed in the asset's currency, in cents of the account's (rounded once). */
function inAccount(cents: Cents, fxRate: bigint | null): Cents {
  return fxRate === null ? cents : atRate(cents, fxRate);
}

const optionalNote = z
  .string()
  .trim()
  .max(200)
  .transform((value) => (value === "" ? null : value))
  .nullable()
  .default(null);

const civil = z.string().refine(isCivilDate, "Not a civil date");
const positive = z.bigint().positive();

export const buyInputSchema = z.object({
  asset: z.union([z.object({ id: z.uuid() }), z.object({ create: assetInputSchema })]),
  product: z.string().regex(new RegExp(PRODUCT_PATTERN)).default("custody"),
  on: civil,
  /** Quantity and unit price, or only the total (a BTP, a fund bought for an amount, A3). */
  quantity: positive.nullable().default(null),
  unitPrice: z.bigint().nonnegative().nullable().default(null),
  /** The total in the asset's currency, when no quantity is typed. */
  totalCents: positive.nullable().default(null),
  feeCents: z.bigint().nonnegative().default(0n),
  fxRate: positive.nullable().default(null),
  note: optionalNote,
});
export type BuyInput = z.input<typeof buyInputSchema>;

/**
 * "Add asset" (§4.4): a `buy` event with its legs — the position, and the fee as its own leg — and
 * the points rewritten from its day. Only where the period of that day keeps assets.
 */
export async function addAsset(
  ctx: WriteCtx,
  accountId: string,
  input: BuyInput,
): Promise<{ eventId: string }> {
  const parsed = buyInputSchema.parse(input);
  notFuture(ctx, parsed.on);
  if (parsed.quantity === null ? parsed.totalCents === null : parsed.unitPrice === null) {
    throw new RangeError("A buy needs a quantity and a price, or a total");
  }
  const account = await getAccount(ctx, accountId);
  if (!account) throw new InvestmentError("not_found");
  return getDb().transaction(async (tx) => {
    const investment = await lockInvestmentAccount(ctx, accountId, tx);
    const book = await loadBook(ctx, investment, account.currency, tx);
    const period = periodOn(book, parsed.on);
    if (period === null) throw new InvestmentError("before_period");
    if (period.mode !== "assets") throw new InvestmentError("wrong_mode");
    const asset =
      "id" in parsed.asset
        ? await requireAsset(ctx, parsed.asset.id, tx)
        : await createAsset(ctx, parsed.asset.create, tx);
    const holding = await holdingFor(ctx, tx, investment.id, asset.id, parsed.product, parsed.on);
    const { fxRate, fxSource } = await rateOf(asset.currency, account.currency, parsed.on, parsed.fxRate);
    const native =
      parsed.quantity !== null && parsed.unitPrice !== null
        ? positionCents(parsed.quantity, parsed.unitPrice)
        : (parsed.totalCents as Cents);
    const legs: LegInput[] = [
      {
        leg: "main",
        kind: "buy",
        holdingId: holding.id,
        quantity: parsed.quantity,
        unitPrice: parsed.quantity === null ? null : parsed.unitPrice,
        priceCurrency: asset.currency,
        nativeAmount: native * 10n ** BigInt(PRICE_SCALE - 2),
        nativeCurrency: asset.currency,
        fxRate,
        fxSource,
        amountCents: -inAccount(native, fxRate),
      },
    ];
    if (parsed.feeCents > 0n)
      legs.push({ leg: "fee", kind: "fee", amountCents: -inAccount(parsed.feeCents, fxRate) });
    const event = await insertEvent(ctx, tx, investment.id, {
      on: parsed.on,
      occurredAt: new Date(),
      origin: "manual",
      note: parsed.note,
      legs,
    });
    await rebuild(ctx, investment, account.currency, parsed.on, tx);
    return { eventId: event.id };
  });
}

export const operationInputSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.enum(["deposit", "withdrawal"]),
    on: civil,
    amountCents: positive,
    transactionId: z.uuid().nullable().default(null),
    note: optionalNote,
  }),
  z.object({
    kind: z.literal("account_valuation"),
    on: civil,
    amountCents: z.bigint().nonnegative(),
    note: optionalNote,
  }),
  z.object({
    kind: z.literal("valuation"),
    holdingId: z.uuid(),
    on: civil,
    unitPrice: z.bigint().nonnegative().nullable().default(null),
    amountCents: z.bigint().nonnegative().nullable().default(null),
    note: optionalNote,
  }),
  z.object({
    kind: z.enum(["sell", "close"]),
    holdingId: z.uuid(),
    on: civil,
    quantity: positive.nullable().default(null),
    unitPrice: z.bigint().nonnegative().nullable().default(null),
    /** The proceeds in the asset's currency, when no price is typed. */
    amountCents: z.bigint().nonnegative().nullable().default(null),
    feeCents: z.bigint().nonnegative().default(0n),
    note: optionalNote,
  }),
  z.object({
    kind: z.literal("income"),
    holdingId: z.uuid().nullable().default(null),
    on: civil,
    amountCents: positive,
    note: optionalNote,
  }),
  z.object({
    kind: z.literal("adjustment"),
    on: civil,
    amountCents: z.bigint().refine((value) => value !== 0n, "An adjustment moves the value"),
    validUntil: civil.nullable().default(null),
    note: z.string().trim().min(1).max(200),
  }),
]);
export type OperationInput = z.input<typeof operationInputSchema>;

/**
 * A bank movement may document a deposit or a withdrawal only when it is the person's own and goes
 * the same way: money out of the account for a deposit, into it for a withdrawal.
 */
async function requireLinkable(
  ctx: Pick<Ctx, "userId">,
  transactionId: string | null,
  kind: "deposit" | "withdrawal",
): Promise<void> {
  if (transactionId === null) return;
  const transaction = await getTransaction(ctx, transactionId);
  if (!transaction || transaction.amountCents === 0n) throw new InvestmentError("invalid_transaction");
  if ((kind === "deposit") !== transaction.amountCents < 0n) throw new InvestmentError("invalid_transaction");
}

/** The legs of an operation the person typed, checked against the book of its day. */
async function legsOf(
  ctx: Pick<Ctx, "userId">,
  tx: Tx,
  book: LoadedBook,
  input: z.output<typeof operationInputSchema>,
  account: { currency: string },
): Promise<{ legs: LegInput[]; transactionId: string | null }> {
  const period = periodOn(book, input.on);
  if (period === null) throw new InvestmentError("before_period");
  switch (input.kind) {
    case "deposit":
    case "withdrawal":
      await requireLinkable(ctx, input.transactionId, input.kind);
      return {
        legs: [
          {
            leg: "main",
            kind: input.kind,
            amountCents: input.kind === "deposit" ? input.amountCents : -input.amountCents,
          },
        ],
        transactionId: input.transactionId,
      };
    case "account_valuation":
      if (period.mode !== "total" || period.origin !== "manual") throw new InvestmentError("wrong_mode");
      return {
        legs: [{ leg: "main", kind: "account_valuation", amountCents: input.amountCents }],
        transactionId: null,
      };
    case "adjustment":
      if (input.validUntil !== null && input.validUntil < input.on)
        throw new RangeError("Ends before it starts");
      return {
        legs: [
          { leg: "main", kind: "adjustment", amountCents: input.amountCents, validUntil: input.validUntil },
        ],
        transactionId: null,
      };
    case "income":
      return {
        legs: [{ leg: "main", kind: "income", holdingId: input.holdingId, amountCents: input.amountCents }],
        transactionId: null,
      };
    default: {
      if (period.mode !== "assets") throw new InvestmentError("wrong_mode");
      const holding = book.holdingRows.find((one) => one.id === input.holdingId && one.origin === "manual");
      if (!holding) throw new InvestmentError("not_found");
      const currency = holding.asset.currency;
      const { fxRate, fxSource } = await rateOf(currency, account.currency, input.on, null);
      if (input.kind === "valuation") {
        if ((input.unitPrice === null) === (input.amountCents === null))
          throw new RangeError("A price or a value");
        return {
          legs: [
            {
              leg: "main",
              kind: "valuation",
              holdingId: holding.id,
              unitPrice: input.unitPrice,
              priceCurrency: currency,
              fxRate,
              fxSource,
              amountCents: input.amountCents === null ? 0n : inAccount(input.amountCents, fxRate),
            },
          ],
          transactionId: null,
        };
      }
      const proceeds =
        input.quantity !== null && input.unitPrice !== null
          ? positionCents(input.quantity, input.unitPrice)
          : input.amountCents;
      if (proceeds === null) throw new RangeError("A sale needs a price or its proceeds");
      const legs: LegInput[] = [
        {
          leg: "main",
          kind: input.kind,
          holdingId: holding.id,
          quantity: input.quantity,
          unitPrice: input.quantity === null ? null : input.unitPrice,
          priceCurrency: currency,
          fxRate,
          fxSource,
          amountCents: inAccount(proceeds, fxRate),
        },
      ];
      if (input.feeCents > 0n)
        legs.push({ leg: "fee", kind: "fee", amountCents: -inAccount(input.feeCents, fxRate) });
      return { legs, transactionId: null };
    }
  }
}

/**
 * A deposit, a withdrawal, a valuation of the account or of a position, a sale, a closing, an
 * income or an adjustment: one event with its legs, and the points rewritten from its day.
 */
export async function recordOperation(
  ctx: WriteCtx,
  accountId: string,
  input: OperationInput,
): Promise<{ eventId: string }> {
  const parsed = operationInputSchema.parse(input);
  notFuture(ctx, parsed.on);
  const account = await getAccount(ctx, accountId);
  if (!account) throw new InvestmentError("not_found");
  return getDb().transaction(async (tx) => {
    const investment = await lockInvestmentAccount(ctx, accountId, tx);
    const book = await loadBook(ctx, investment, account.currency, tx);
    const { legs, transactionId } = await legsOf(ctx, tx, book, parsed, account);
    const event = await insertEvent(ctx, tx, investment.id, {
      on: parsed.on,
      occurredAt: new Date(),
      origin: "manual",
      note: parsed.note,
      transactionId,
      legs,
    });
    await rebuild(ctx, investment, account.currency, parsed.on, tx);
    return { eventId: event.id };
  });
}

async function requireEvent(ctx: Pick<Ctx, "userId">, eventId: string, tx: Tx) {
  const [row] = await tx
    .select({ event: investmentEvents, accountId: investmentAccounts.accountId })
    .from(investmentEvents)
    .innerJoin(investmentAccounts, eq(investmentAccounts.id, investmentEvents.investmentAccountId))
    .where(and(eq(investmentEvents.id, eventId), userScoped(ctx).owns(investmentEvents)));
  if (!row) throw new InvestmentError("not_found");
  return row;
}

/** Saves every leg of an event as it was (A2): an operation is never overwritten silently. */
async function keepRevisions(
  ctx: Pick<Ctx, "userId">,
  tx: Tx,
  event: InvestmentEvent,
  reason: "edited" | "deleted",
): Promise<void> {
  const legs = await tx
    .select()
    .from(investmentOperations)
    .where(and(eq(investmentOperations.eventId, event.id), userScoped(ctx).owns(investmentOperations)));
  if (legs.length === 0) return;
  await tx.insert(investmentOperationRevisions).values(
    legs.map((leg) =>
      userScoped(ctx).stamp({
        investmentAccountId: event.investmentAccountId,
        eventId: event.id,
        operationId: leg.id,
        reason,
        before: {
          on: event.on,
          note: event.note,
          transactionId: event.transactionId,
          leg: leg.leg,
          kind: leg.kind,
          holdingId: leg.holdingId,
          quantity: leg.quantity,
          unitPrice: leg.unitPrice,
          priceCurrency: leg.priceCurrency,
          fxRate: leg.fxRate,
          fxSource: leg.fxSource,
          amountCents: leg.amountCents.toString(),
          validUntil: leg.validUntil,
        },
      }),
    ),
  );
}

/**
 * A manual event changed (A2): the legs before go to the revisions, the new ones take their place,
 * and the points are rewritten from the older of the two days. A buy keeps its asset and product;
 * an event a conversion or a provider wrote is not the person's to edit.
 */
export async function updateOperation(ctx: WriteCtx, eventId: string, input: OperationInput): Promise<void> {
  const parsed = operationInputSchema.parse(input);
  notFuture(ctx, parsed.on);
  await getDb().transaction(async (tx) => {
    const { event, accountId } = await requireEvent(ctx, eventId, tx);
    if (event.origin !== "manual") throw new InvestmentError("not_editable");
    const account = await getAccount(ctx, accountId);
    if (!account) throw new InvestmentError("not_found");
    const investment = await lockInvestmentAccount(ctx, accountId, tx);
    const [main] = await tx
      .select({ kind: investmentOperations.kind })
      .from(investmentOperations)
      .where(and(eq(investmentOperations.eventId, eventId), eq(investmentOperations.leg, "main")));
    if (!main || main.kind !== parsed.kind) throw new InvestmentError("not_editable");
    await keepRevisions(ctx, tx, event, "edited");
    await tx
      .delete(investmentOperations)
      .where(and(eq(investmentOperations.eventId, eventId), userScoped(ctx).owns(investmentOperations)));
    const book = await loadBook(ctx, investment, account.currency, tx);
    const { legs, transactionId } = await legsOf(ctx, tx, book, parsed, account);
    await translated(
      tx
        .update(investmentEvents)
        .set({ on: parsed.on, note: parsed.note, transactionId })
        .where(and(eq(investmentEvents.id, eventId), userScoped(ctx).owns(investmentEvents))),
    );
    await insertLegs(ctx, tx, eventId, legs);
    await rebuild(ctx, investment, account.currency, oldestDay(event.on, parsed.on) as CivilDate, tx);
  });
}

/** A manual event deleted, its legs kept in the revisions, the points rewritten from its day. */
export async function deleteOperation(ctx: WriteCtx, eventId: string): Promise<void> {
  await getDb().transaction(async (tx) => {
    const { event, accountId } = await requireEvent(ctx, eventId, tx);
    if (event.origin !== "manual") throw new InvestmentError("not_editable");
    const investment = await lockInvestmentAccount(ctx, accountId, tx);
    await keepRevisions(ctx, tx, event, "deleted");
    const legs = await tx
      .delete(investmentOperations)
      .where(and(eq(investmentOperations.eventId, eventId), userScoped(ctx).owns(investmentOperations)))
      .returning({ holdingId: investmentOperations.holdingId });
    await tx
      .delete(investmentEvents)
      .where(and(eq(investmentEvents.id, eventId), userScoped(ctx).owns(investmentEvents)));
    // The other leg of a transfer is a plain flow again: its partner is gone (§2.4).
    if (event.transferGroupId) await clearTransferGroup(ctx, tx, event.transferGroupId);
    // A position nothing refers to any more goes with its last operation.
    const holdingIds = [...new Set(legs.flatMap((leg) => (leg.holdingId ? [leg.holdingId] : [])))];
    for (const holdingId of holdingIds) {
      const [used] = await tx
        .select({ id: investmentOperations.id })
        .from(investmentOperations)
        .where(eq(investmentOperations.holdingId, holdingId))
        .limit(1);
      if (!used) {
        await tx
          .delete(investmentHoldings)
          .where(and(eq(investmentHoldings.id, holdingId), userScoped(ctx).owns(investmentHoldings)));
      }
    }
    await rebuild(ctx, investment, await currencyOf(ctx, accountId), event.on, tx);
  });
}

// ——— Conversions (§2.5) ———————————————————————————————————————————————————————————————————

export const conversionInputSchema = z.discriminatedUnion("to", [
  z.object({
    to: z.literal("assets"),
    positions: z
      .array(
        z.object({
          asset: z.union([z.object({ id: z.uuid() }), z.object({ create: assetInputSchema })]),
          product: z.string().regex(new RegExp(PRODUCT_PATTERN)).default("custody"),
          quantity: positive.nullable().default(null),
          unitPrice: z.bigint().nonnegative().nullable().default(null),
          totalCents: positive.nullable().default(null),
        }),
      )
      .max(50),
    /** The person saw that the opening cash comes out negative, and keeps it. */
    acceptNegativeCash: z.boolean().default(false),
  }),
  z.object({ to: z.literal("total") }),
]);
export type ConversionInput = z.input<typeof conversionInputSchema>;

/**
 * A change of mode at T = today (§2.5): a new period and its opening events in one transaction,
 * with V(T) the same before and after. `total` → `assets` opens with the positions declared and the
 * cash that keeps V; `assets` → `total` opens with an account valuation equal to V(T).
 */
export async function convertMode(
  ctx: WriteCtx,
  accountId: string,
  input: ConversionInput,
): Promise<{ openingCashCents: Cents | null }> {
  const parsed = conversionInputSchema.parse(input);
  const account = await getAccount(ctx, accountId);
  if (!account) throw new InvestmentError("not_found");
  const todayOn = today(ctx.timeZone);
  return getDb().transaction(async (tx) => {
    const investment = await lockInvestmentAccount(ctx, accountId, tx);
    const book = await loadBook(ctx, investment, account.currency, tx);
    const current = periodOn(book, todayOn);
    if (current === null || current.origin !== "manual") throw new InvestmentError("wrong_mode");
    if (current.mode === parsed.to) throw new InvestmentError("wrong_mode");
    const rates = await ratesFor(book, todayOn);
    const before = valueOn(book, todayOn, rates).valueCents;
    if (before === null) throw new InvestmentError("no_value");
    const now = new Date();
    // A second conversion on the same day starts after the first, never at the same instant.
    const startsAt =
      current.startsAt.getTime() >= now.getTime() ? new Date(current.startsAt.getTime() + 1) : now;
    await tx.insert(investmentAccountPeriods).values(
      userScoped(ctx).stamp({
        investmentAccountId: investment.id,
        fromOn: todayOn,
        startsAt,
        mode: parsed.to as Mode,
        origin: "manual" as const,
        reason: "conversion" as const,
      }),
    );
    let openingCashCents: Cents | null = null;
    if (parsed.to === "total") {
      await insertEvent(ctx, tx, investment.id, {
        on: todayOn,
        occurredAt: startsAt,
        origin: "conversion",
        legs: [{ leg: "main", kind: "account_valuation", amountCents: before }],
      });
    } else {
      const declared: { holdingId: string; legs: LegInput[]; valueCents: Cents }[] = [];
      for (const position of parsed.positions) {
        if (position.quantity === null ? position.totalCents === null : position.unitPrice === null) {
          throw new RangeError("A position needs a quantity and a price, or a value");
        }
        const asset =
          "id" in position.asset
            ? await requireAsset(ctx, position.asset.id, tx)
            : await createAsset(ctx, position.asset.create, tx);
        const holding = await holdingFor(ctx, tx, investment.id, asset.id, position.product, todayOn);
        const { fxRate, fxSource } = await rateOf(asset.currency, account.currency, todayOn, null);
        const native =
          position.quantity !== null && position.unitPrice !== null
            ? positionCents(position.quantity, position.unitPrice)
            : (position.totalCents as Cents);
        const valueCents = inAccount(native, fxRate);
        declared.push({
          holdingId: holding.id,
          valueCents,
          legs: [
            {
              leg: "main",
              kind: "opening_position",
              holdingId: holding.id,
              quantity: position.quantity,
              unitPrice: position.quantity === null ? null : position.unitPrice,
              priceCurrency: asset.currency,
              fxRate,
              fxSource,
              amountCents: -valueCents,
            },
          ],
        });
      }
      openingCashCents = openingCashFor(
        before,
        declared.map((one) => ({
          holdingId: one.holdingId,
          quantity: null,
          unitPrice: null,
          valueCents: one.valueCents,
        })),
      );
      if (openingCashCents < 0n && !parsed.acceptNegativeCash) throw new InvestmentError("negative_cash");
      await insertEvent(ctx, tx, investment.id, {
        on: todayOn,
        occurredAt: startsAt,
        origin: "conversion",
        legs: [{ leg: "main", kind: "opening_cash", amountCents: openingCashCents }],
      });
      for (const one of declared) {
        await insertEvent(ctx, tx, investment.id, {
          on: todayOn,
          occurredAt: startsAt,
          origin: "conversion",
          legs: one.legs,
        });
      }
    }
    await rebuild(ctx, investment, account.currency, todayOn, tx);
    return { openingCashCents };
  });
}

// ——— Readings and reconciliation (§1.6, R4, R5) ——————————————————————————————————————————————

export interface ReadingInput {
  on: CivilDate;
  observedAt: Date;
  status: (typeof READING_STATUSES)[number];
  totalCents: Cents;
  cashCents?: Cents | null;
  missingPrices?: number;
  positions: readonly {
    assetId: string;
    product: string;
    quantity: bigint;
    price: bigint | null;
    priceCurrency: string | null;
    priceSource: string | null;
    valueCents: Cents | null;
  }[];
  scopes: readonly { externalAccountId: string; product: string; complete: boolean }[];
}

/**
 * A provider's reading of a day (§1.6): the last of the day replaces the earlier ones, with its
 * positions and its scope, and the points are rewritten from that day (R6). The provider adapters
 * of phases 3 and 4 call it; phase 2 has none, so only the seed and the tests do.
 */
export async function saveReading(
  ctx: WriteCtx,
  accountId: string,
  input: ReadingInput,
): Promise<{ readingId: string }> {
  return getDb().transaction(async (tx) => {
    const investment = await lockInvestmentAccount(ctx, accountId, tx);
    await tx
      .delete(investmentReadings)
      .where(
        and(
          userScoped(ctx).owns(investmentReadings),
          eq(investmentReadings.investmentAccountId, investment.id),
          eq(investmentReadings.on, input.on),
        ),
      );
    const [reading] = await tx
      .insert(investmentReadings)
      .values(
        userScoped(ctx).stamp({
          investmentAccountId: investment.id,
          on: input.on,
          observedAt: input.observedAt,
          status: input.status,
          totalCents: input.totalCents,
          cashCents: input.cashCents ?? null,
          missingPrices: input.missingPrices ?? missingPricesOf(input.positions),
        }),
      )
      .returning();
    if (input.positions.length > 0) {
      await tx.insert(investmentReadingPositions).values(
        input.positions.map((position) =>
          userScoped(ctx).stamp({
            readingId: reading.id,
            assetId: position.assetId,
            product: position.product,
            quantity: formatDecimal(position.quantity, QUANTITY_SCALE),
            price: decimal(position.price, PRICE_SCALE),
            priceCurrency: position.priceCurrency,
            priceAt: input.observedAt,
            priceSource: position.priceSource,
            valueCents: position.valueCents,
          }),
        ),
      );
    }
    if (input.scopes.length > 0) {
      await tx
        .insert(investmentReadingScopes)
        .values(input.scopes.map((scope) => userScoped(ctx).stamp({ readingId: reading.id, ...scope })));
    }
    await rebuild(ctx, investment, await currencyOf(ctx, accountId), input.on, tx);
    return { readingId: reading.id };
  });
}

/** "The account was emptied" (R5): a `pending_zero` reading counts from its day. */
export async function confirmZeroReading(ctx: WriteCtx, readingId: string): Promise<void> {
  await getDb().transaction(async (tx) => {
    const [row] = await tx
      .select({ reading: investmentReadings, accountId: investmentAccounts.accountId })
      .from(investmentReadings)
      .innerJoin(investmentAccounts, eq(investmentAccounts.id, investmentReadings.investmentAccountId))
      .where(and(eq(investmentReadings.id, readingId), userScoped(ctx).owns(investmentReadings)));
    if (!row || row.reading.status !== "pending_zero") throw new InvestmentError("not_found");
    const investment = await lockInvestmentAccount(ctx, row.accountId, tx);
    await tx
      .update(investmentReadings)
      .set({ status: "confirmed_zero" })
      .where(and(eq(investmentReadings.id, readingId), userScoped(ctx).owns(investmentReadings)));
    await rebuild(ctx, investment, await currencyOf(ctx, row.accountId), row.reading.on, tx);
  });
}

export const reconciliationInputSchema = z.object({
  holdingId: z.uuid(),
  kind: z.enum(RECONCILIATION_KINDS),
  effectiveOn: civil,
  /** For `partial`: how much of the position the provider covers. */
  quantity: positive.nullable().default(null),
  /** For `outside_scope`: the product the manual position really is in. */
  product: z.string().regex(new RegExp(PRODUCT_PATTERN)).nullable().default(null),
  readingId: z.uuid().nullable().default(null),
  note: optionalNote,
});
export type ReconciliationInput = z.input<typeof reconciliationInputSchema>;

/**
 * "Reconcile" (R4): a dated decision on a manual position the provider's reading may cover. The
 * points are rewritten from its decorrenza; "outside the scope" moves the position to the product
 * it really is in.
 */
export async function reconcileHolding(ctx: WriteCtx, input: ReconciliationInput): Promise<void> {
  const parsed = reconciliationInputSchema.parse(input);
  notFuture(ctx, parsed.effectiveOn);
  if ((parsed.kind === "partial") !== (parsed.quantity !== null))
    throw new RangeError("Partial needs a quantity");
  if (parsed.kind === "outside_scope" && parsed.product === null)
    throw new RangeError("Outside needs a product");
  await getDb().transaction(async (tx) => {
    const [row] = await tx
      .select({ holding: investmentHoldings, accountId: investmentAccounts.accountId })
      .from(investmentHoldings)
      .innerJoin(investmentAccounts, eq(investmentAccounts.id, investmentHoldings.investmentAccountId))
      .where(and(eq(investmentHoldings.id, parsed.holdingId), userScoped(ctx).owns(investmentHoldings)));
    if (!row || row.holding.origin !== "manual") throw new InvestmentError("not_found");
    const investment = await lockInvestmentAccount(ctx, row.accountId, tx);
    if (
      parsed.kind === "outside_scope" &&
      parsed.product !== null &&
      parsed.product !== row.holding.product
    ) {
      await translated(
        tx
          .update(investmentHoldings)
          .set({ product: parsed.product })
          .where(and(eq(investmentHoldings.id, row.holding.id), userScoped(ctx).owns(investmentHoldings))),
      );
    }
    await tx.insert(investmentReconciliations).values(
      userScoped(ctx).stamp({
        holdingId: parsed.holdingId,
        kind: parsed.kind,
        effectiveOn: parsed.effectiveOn,
        quantity: decimal(parsed.quantity, QUANTITY_SCALE),
        readingId: parsed.readingId,
        note: parsed.note,
      }),
    );
    await rebuild(ctx, investment, await currencyOf(ctx, row.accountId), parsed.effectiveOn, tx);
  });
}

// ——— Transfers between the person's accounts (§2.4, A10) ————————————————————————————————————

/**
 * The main legs of every deposit and withdrawal of the person's services, as the transfer
 * proposal compares them: the asset and its quantity, or the cash amount and its currency.
 */
export async function transferLegs(ctx: Pick<Ctx, "userId">): Promise<TransferLeg[]> {
  const rows = await getDb()
    .select({
      eventId: investmentEvents.id,
      accountId: investmentAccounts.accountId,
      on: investmentEvents.on,
      transferGroupId: investmentEvents.transferGroupId,
      kind: investmentOperations.kind,
      assetId: investmentHoldings.assetId,
      quantity: investmentOperations.quantity,
      nativeAmount: investmentOperations.nativeAmount,
      nativeCurrency: investmentOperations.nativeCurrency,
      amountCents: investmentOperations.amountCents,
    })
    .from(investmentOperations)
    .innerJoin(investmentEvents, eq(investmentEvents.id, investmentOperations.eventId))
    .innerJoin(investmentAccounts, eq(investmentAccounts.id, investmentEvents.investmentAccountId))
    .leftJoin(investmentHoldings, eq(investmentHoldings.id, investmentOperations.holdingId))
    .where(
      and(
        userScoped(ctx).owns(investmentOperations),
        eq(investmentOperations.leg, "main"),
        inArray(investmentOperations.kind, ["deposit", "withdrawal"]),
      ),
    )
    .orderBy(asc(investmentEvents.on), asc(investmentEvents.id));
  if (rows.length === 0) return [];
  const currencies = new Map(
    (await listAccounts(ctx, { includeArchived: true })).map((account) => [account.id, account.currency]),
  );
  const abs = (value: bigint) => (value < 0n ? -value : value);
  return rows.map((row) => {
    const asset = row.assetId !== null && row.quantity !== null;
    const cash =
      row.nativeAmount !== null && row.nativeCurrency !== null
        ? { amount: parseDecimal(row.nativeAmount, PRICE_SCALE), currency: row.nativeCurrency }
        : {
            amount: row.amountCents * 10n ** BigInt(PRICE_SCALE - 2),
            currency: currencies.get(row.accountId) ?? null,
          };
    return {
      eventId: row.eventId,
      accountId: row.accountId,
      on: row.on,
      kind: row.kind as TransferLeg["kind"],
      assetId: asset ? row.assetId : null,
      amount: abs(asset ? parseDecimal(row.quantity as string, QUANTITY_SCALE) : cash.amount),
      currency: asset ? null : cash.currency,
      transferGroupId: row.transferGroupId,
    };
  });
}

async function clearTransferGroup(ctx: Pick<Ctx, "userId">, tx: Tx, groupId: string): Promise<void> {
  await tx
    .update(investmentEvents)
    .set({ transferGroupId: null })
    .where(and(eq(investmentEvents.transferGroupId, groupId), userScoped(ctx).owns(investmentEvents)));
}

export const transferInputSchema = z.object({ withdrawalId: z.uuid(), depositId: z.uuid() });
export type TransferInput = z.input<typeof transferInputSchema>;

/**
 * Links a withdrawal and a deposit of two of the person's services as one transfer (§2.4): both
 * events get the same `transfer_group_id`. Each account keeps it as a flow, the portfolio leaves
 * it out. Only a pair the proposal would make is accepted — different accounts, same asset and
 * quantity or same cash amount, at most {@link TRANSFER_WINDOW_DAYS} apart, neither linked yet —
 * so no value of either account changes and no point is rewritten.
 */
export async function linkTransfer(ctx: WriteCtx, input: TransferInput): Promise<string> {
  const parsed = transferInputSchema.parse(input);
  const legs = await transferLegs(ctx);
  const withdrawal = legs.find((leg) => leg.eventId === parsed.withdrawalId);
  const deposit = legs.find((leg) => leg.eventId === parsed.depositId);
  if (!withdrawal || !deposit) throw new InvestmentError("not_found");
  const apart =
    Math.abs(Date.parse(`${withdrawal.on}T00:00:00Z`) - Date.parse(`${deposit.on}T00:00:00Z`)) / 86_400_000;
  if (
    withdrawal.kind !== "withdrawal" ||
    deposit.kind !== "deposit" ||
    withdrawal.accountId === deposit.accountId ||
    withdrawal.assetId !== deposit.assetId ||
    withdrawal.currency !== deposit.currency ||
    withdrawal.amount !== deposit.amount ||
    apart > TRANSFER_WINDOW_DAYS
  ) {
    throw new InvestmentError("not_a_transfer");
  }
  const groupId = randomUUID();
  await getDb().transaction(async (tx) => {
    // Both rows locked and checked again: a concurrent link of either leg loses here.
    const locked = await tx
      .select({ id: investmentEvents.id, transferGroupId: investmentEvents.transferGroupId })
      .from(investmentEvents)
      .where(
        and(
          inArray(investmentEvents.id, [withdrawal.eventId, deposit.eventId]),
          userScoped(ctx).owns(investmentEvents),
        ),
      )
      .for("update");
    if (locked.length !== 2) throw new InvestmentError("not_found");
    if (locked.some((row) => row.transferGroupId !== null)) throw new InvestmentError("not_a_transfer");
    await tx
      .update(investmentEvents)
      .set({ transferGroupId: groupId })
      .where(
        and(
          inArray(investmentEvents.id, [withdrawal.eventId, deposit.eventId]),
          userScoped(ctx).owns(investmentEvents),
        ),
      );
  });
  return groupId;
}

/** Undoes a transfer: both legs are plain deposits and withdrawals again (§2.4). */
export async function unlinkTransfer(ctx: WriteCtx, eventId: string): Promise<void> {
  if (!z.uuid().safeParse(eventId).success) throw new InvestmentError("not_found");
  await getDb().transaction(async (tx) => {
    const { event } = await requireEvent(ctx, eventId, tx);
    if (!event.transferGroupId) throw new InvestmentError("not_a_transfer");
    await clearTransferGroup(ctx, tx, event.transferGroupId);
  });
}

// ——— Reads other modules ask for ——————————————————————————————————————————————————————————

/** The services of a person, oldest first, with their account ids. */
export async function listInvestmentAccounts(ctx: Pick<Ctx, "userId">): Promise<InvestmentAccount[]> {
  return getDb()
    .select()
    .from(investmentAccounts)
    .where(userScoped(ctx).owns(investmentAccounts))
    .orderBy(asc(investmentAccounts.createdAt), asc(investmentAccounts.id));
}

/** The asset catalog for the dialogs: active assets by name. */
export async function listAssets(ctx: Pick<Ctx, "userId">): Promise<InvestmentAsset[]> {
  return getDb()
    .select()
    .from(investmentAssets)
    .where(and(userScoped(ctx).owns(investmentAssets), isNull(investmentAssets.archivedAt)))
    .orderBy(asc(investmentAssets.name), asc(investmentAssets.id));
}
