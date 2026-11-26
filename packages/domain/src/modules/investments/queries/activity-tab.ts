// The Activity tab (docs/design/investments-ux.md §3.5, U3): a service's events and movements.
import { and, asc, count, desc, eq, exists, gte, ilike, inArray, lte, or, sql } from "drizzle-orm";
import { listAccounts } from "../../accounts";
import { escapeLike, movementsByAccount, transactionsByIds } from "../../transactions/queries";
import type { Ctx } from "../../../platform/context";
import { type CivilDate, type MonthKey } from "../../../shared/dates";
import { getDb } from "../../../platform/db/client";
import { userScoped } from "../../../platform/db/scope";
import { type Cents } from "../../../shared/money";
import { ACTIVITY_FAMILIES, type ActivityFamily, type DescribedLeg, familyOf, kindsOf } from "../activity";
import { type AdjustmentClass, type OperationKind } from "../rules";
import { investmentAssets, investmentEvents, investmentHoldings, investmentOperations } from "../schema";
import { type InvestmentEvent, listInvestmentAccounts, loadBook, transferLegs } from "../service";

// ——— The Activity tab (docs/design/investments-ux.md §3.5, U3) ————————————————————————————————————

/** Rows per page of the Activity tab (§3.5): the page of 934 eToro events goes to ≈ 2,000 px. */
/** A movement of a manual service's account, as its Activity lists it (PERS-342). */
export interface ServiceMovement {
  id: string;
  on: CivilDate;
  payee: string | null;
  cents: Cents;
}

/**
 * The Activity of a manual service (docs/design/investments.md §1.3, PERS-342): the movements of
 * its account in Accounts that the service counts as deposits and withdrawals, inside the period,
 * newest first. `null` when the account is no manual service.
 */
export async function serviceMovements(
  ctx: Pick<Ctx, "userId" | "timeZone">,
  accountId: string,
  span: { from: CivilDate; to: CivilDate },
): Promise<{ rows: ServiceMovement[]; depositsCents: Cents; withdrawalsCents: Cents } | null> {
  const investment = (await listInvestmentAccounts(ctx)).find((one) => one.accountId === accountId);
  if (!investment || investment.provider !== "manual") return null;
  const account = (await listAccounts(ctx, { includeArchived: true })).find((one) => one.id === accountId);
  if (!account) return null;
  const [book, movements] = await Promise.all([
    loadBook(ctx, investment, account.currency),
    movementsByAccount(ctx, [accountId]),
  ]);
  const counted = new Set(book.events.map((event) => event.id));
  const rows = (movements.get(accountId) ?? [])
    .filter((one) => counted.has(one.id) && one.on >= span.from && one.on <= span.to)
    .map((one) => ({ id: one.id, on: one.on, payee: one.payee, cents: one.cents }))
    .reverse();
  return {
    rows,
    depositsCents: rows.reduce<Cents>((sum, row) => (row.cents > 0n ? sum + row.cents : sum), 0n),
    withdrawalsCents: rows.reduce<Cents>((sum, row) => (row.cents < 0n ? sum + row.cents : sum), 0n),
  };
}

export const ACTIVITY_PAGE_SIZE = 50;

export interface ActivityQuery {
  /** The period's days; `from` `null` = from the first event ("All"). */
  from: CivilDate | null;
  to: CivilDate;
  family: ActivityFamily | null;
  /** Searched in the asset's name and symbol and in the note. */
  q: string | null;
  /** An asset id: a row of Positions opens the tab filtered on it (§1.1). */
  assetId: string | null;
  /** 1-based. */
  page: number;
}

export interface ActivityRow {
  id: string;
  on: CivilDate;
  origin: InvestmentEvent["origin"];
  note: string | null;
  family: ActivityFamily;
  /** The leg that says what the event is: `main`, or a trade's `base` (never shown as a leg). */
  leg: DescribedLeg & { holdingId: string | null; amountCents: Cents; validUntil: CivilDate | null };
  adjustmentClass: AdjustmentClass | null;
  transactionId: string | null;
  /** The deposit's or the withdrawal's leg in the account (PERS-651). */
  legTransactionId: string | null;
  linked: { payee: string | null; cents: Cents } | null;
  /** The other service of a transfer between the person's accounts (§4.9), if this is one leg. */
  transfer: { accountId: string; accountName: string } | null;
}

export interface ServiceActivity {
  rows: ActivityRow[];
  page: number;
  pages: number;
  /** The events of the period that the search and the chosen chip leave. */
  total: number;
  /** Every event of the service, whatever the period and the filters ("934 since the start"). */
  allTime: number;
  /** Per chip, in the period and with the search: the counts of §3.5. */
  counts: Record<ActivityFamily | "all", number>;
  /** The months of the filtered events, newest first, with how many each holds. */
  months: { month: MonthKey; count: number }[];
  /** The period's money in and out and its fees (every fee leg, also a trade's), in the account's currency. */
  sums: { depositsCents: Cents; withdrawalsCents: Cents; feesCents: Cents };
}

/** The leg that names an event: `main`, else a trade's `base`, else the first by name. */
const describingLeg = sql`case ${investmentOperations.leg} when 'main' then 0 when 'base' then 1 else 2 end`;

/**
 * One page of a service's events (§3.5) and what the tab says about them: paged in the database,
 * newest first by `occurred_at` then `id` — the same order on every page, so a row never shows
 * twice or goes missing between two of them — with the counts of every chip in the period.
 */
export async function serviceActivity(
  ctx: Pick<Ctx, "userId">,
  accountId: string,
  query: ActivityQuery,
): Promise<ServiceActivity | null> {
  const db = getDb();
  const investment = (await listInvestmentAccounts(ctx)).find((one) => one.accountId === accountId);
  if (!investment) return null;
  const events = investmentEvents;
  // Written out in full: inside a subquery Drizzle drops the table's name, and a bare "id" would
  // be the inner table's own.
  const eventId = sql.raw(`"investment_events"."id"`);
  const kindOf = sql<OperationKind>`(select o.kind from ${investmentOperations} o where o.event_id = ${eventId} and o.user_id = ${ctx.userId} order by case o.leg when 'main' then 0 when 'base' then 1 else 2 end, o.leg limit 1)`;

  const mine = and(userScoped(ctx).owns(events), eq(events.investmentAccountId, investment.id));
  const inPeriod = and(
    query.from === null ? undefined : gte(events.on, query.from),
    lte(events.on, query.to),
  );
  const term = query.q?.trim() || null;
  const searched =
    term === null
      ? undefined
      : or(
          ilike(events.note, `%${escapeLike(term)}%`),
          exists(
            db
              .select({ one: sql`1` })
              .from(investmentOperations)
              .innerJoin(investmentHoldings, eq(investmentHoldings.id, investmentOperations.holdingId))
              .innerJoin(investmentAssets, eq(investmentAssets.id, investmentHoldings.assetId))
              .where(
                and(
                  eq(investmentOperations.eventId, eventId),
                  userScoped(ctx).owns(investmentOperations),
                  or(
                    ilike(investmentAssets.name, `%${escapeLike(term)}%`),
                    ilike(investmentAssets.symbol, `%${escapeLike(term)}%`),
                  ),
                ),
              ),
          ),
        );
  const ofAsset =
    query.assetId === null
      ? undefined
      : exists(
          db
            .select({ one: sql`1` })
            .from(investmentOperations)
            .innerJoin(investmentHoldings, eq(investmentHoldings.id, investmentOperations.holdingId))
            .where(
              and(
                eq(investmentOperations.eventId, eventId),
                userScoped(ctx).owns(investmentOperations),
                eq(investmentHoldings.assetId, query.assetId),
              ),
            ),
        );
  const ofFamily = query.family === null ? undefined : inArray(kindOf, kindsOf(query.family));
  const filtered = and(mine, inPeriod, searched, ofAsset, ofFamily);

  const byKind = db
    .select({ kind: kindOf.as("kind") })
    .from(events)
    .where(and(mine, inPeriod, searched, ofAsset))
    .as("by_kind");
  const byMonth = db
    .select({ month: sql<MonthKey>`to_char(${events.on}, 'YYYY-MM')`.as("month") })
    .from(events)
    .where(filtered)
    .as("by_month");
  const [kindRows, monthRows, [{ allTime }], sumRows] = await Promise.all([
    db
      .select({ kind: byKind.kind, count: count() })
      .from(byKind)
      .groupBy(byKind.kind)
      .orderBy(asc(byKind.kind)),
    db
      .select({ month: byMonth.month, count: count() })
      .from(byMonth)
      .groupBy(byMonth.month)
      .orderBy(desc(byMonth.month)),
    db.select({ allTime: count() }).from(events).where(mine),
    db
      .select({
        kind: investmentOperations.kind,
        cents: sql<string>`coalesce(sum(${investmentOperations.amountCents}), 0)`,
      })
      .from(investmentOperations)
      .innerJoin(events, eq(events.id, investmentOperations.eventId))
      .where(
        and(
          mine,
          inPeriod,
          userScoped(ctx).owns(investmentOperations),
          inArray(investmentOperations.kind, ["deposit", "opening_cash", "withdrawal", "fee"]),
        ),
      )
      .groupBy(investmentOperations.kind)
      .orderBy(asc(investmentOperations.kind)),
  ]);

  const counts = Object.fromEntries(
    [...ACTIVITY_FAMILIES, "all"].map((key) => [key, 0]),
  ) as ServiceActivity["counts"];
  for (const row of kindRows) {
    if (row.kind === null) continue;
    counts[familyOf(row.kind)] += row.count;
    counts.all += row.count;
  }
  const total = monthRows.reduce((sum, row) => sum + row.count, 0);
  const pages = Math.max(1, Math.ceil(total / ACTIVITY_PAGE_SIZE));
  const page = Math.min(Math.max(1, Math.trunc(query.page) || 1), pages);
  const sumOf = (...kinds: string[]) =>
    sumRows
      .filter((row) => kinds.includes(row.kind))
      .reduce<Cents>((sum, row) => sum + BigInt(row.cents), 0n);

  const pageRows = await db
    .select()
    .from(events)
    .where(filtered)
    .orderBy(desc(events.occurredAt), desc(events.id))
    .limit(ACTIVITY_PAGE_SIZE)
    .offset((page - 1) * ACTIVITY_PAGE_SIZE);
  const ids = pageRows.map((row) => row.id);
  const legRows =
    ids.length === 0
      ? []
      : await db
          .select({ op: investmentOperations, holding: investmentHoldings, asset: investmentAssets })
          .from(investmentOperations)
          .leftJoin(investmentHoldings, eq(investmentHoldings.id, investmentOperations.holdingId))
          .leftJoin(investmentAssets, eq(investmentAssets.id, investmentHoldings.assetId))
          .where(and(inArray(investmentOperations.eventId, ids), userScoped(ctx).owns(investmentOperations)))
          .orderBy(asc(investmentOperations.eventId), asc(describingLeg), asc(investmentOperations.leg));
  const firstLeg = new Map<string, (typeof legRows)[number]>();
  for (const row of legRows) if (!firstLeg.has(row.op.eventId)) firstLeg.set(row.op.eventId, row);

  const transfers = pageRows.some((row) => row.transferGroupId !== null) ? await transferLegs(ctx) : [];
  const accountNames =
    transfers.length === 0
      ? new Map<string, string>()
      : new Map((await listAccounts(ctx, { includeArchived: true })).map((one) => [one.id, one.name]));
  const linked = await transactionsByIds(
    ctx,
    pageRows.flatMap((row) => (row.transactionId ? [row.transactionId] : [])),
  );

  const rows: ActivityRow[] = pageRows.flatMap((event) => {
    const found = firstLeg.get(event.id);
    if (!found) return [];
    const { op, holding, asset } = found;
    const partner =
      event.transferGroupId === null
        ? undefined
        : transfers.find((leg) => leg.transferGroupId === event.transferGroupId && leg.eventId !== event.id);
    const transaction = event.transactionId ? linked.get(event.transactionId) : undefined;
    return [
      {
        id: event.id,
        on: event.on,
        origin: event.origin,
        note: event.note,
        family: familyOf(op.kind),
        leg: {
          kind: op.kind,
          holdingId: op.holdingId,
          assetName: asset?.name ?? null,
          assetClass: asset?.class ?? null,
          product: holding?.product ?? null,
          quantity: op.quantity,
          unitPrice: op.unitPrice,
          priceCurrency: op.priceCurrency,
          amountCents: op.amountCents,
          validUntil: op.validUntil,
        },
        adjustmentClass: op.adjustmentClass,
        transactionId: event.transactionId,
        legTransactionId: event.legTransactionId,
        linked: transaction ? { payee: transaction.payee, cents: transaction.amountCents } : null,
        transfer: partner
          ? { accountId: partner.accountId, accountName: accountNames.get(partner.accountId) ?? "" }
          : null,
      },
    ];
  });

  return {
    rows,
    page,
    pages,
    total,
    allTime,
    counts,
    months: monthRows,
    sums: {
      depositsCents: sumOf("deposit", "opening_cash"),
      withdrawalsCents: sumOf("withdrawal"),
      feesCents: sumOf("fee"),
    },
  };
}
