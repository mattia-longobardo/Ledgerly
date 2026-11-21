// The ledger of a rule's days (spec §7.6): the accrual of each day, the settlement of each period and
// the one sum of the accrued interest every reader uses (audit INT-4).
import { and, desc, eq, gte, inArray, isNull, lte, sql } from "drizzle-orm";
import { reconstructedBalances } from "../../accounts";
import type { Ctx } from "../../../platform/context";
import { addDays, type CivilDate, today } from "../../../shared/dates";
import { getDb, type Tx } from "../../../platform/db/client";
import { userScoped } from "../../../platform/db/scope";
import type { Cents } from "../../../shared/money";
import {
  accrueDay,
  type Fixed,
  fixedFromDecimal,
  fixedToDecimal,
  periodOf,
  roundToCents,
  settlementPeriods,
} from "../rules";
import { interestAccruals, interestEntries, interestRules } from "../schema";
import { type InterestRule, requireRule, tiersOf } from "./records";

/** Which accruals a sum reads: of some rules or accounts, between two days (both included). */
interface AccrualWindow {
  ruleIds?: readonly string[];
  accountIds?: readonly string[];
  from?: CivilDate;
  to?: CivilDate;
}

/** What a rule (or an account's rules) accrued in the window, and what waits for its settlement. */
export interface AccrualSum {
  netCents: Cents;
  /** Rounded once, half-up, from the fixed gross of the days. */
  grossCents: Cents;
  /** Net accrued and not settled yet, on any day. */
  pendingCents: Cents;
  /** Gross of the same unsettled days, rounded once, half-up. */
  pendingGrossCents: Cents;
}

/**
 * The one sum of the accrued interest (audit INT-4), by rule or by account: every rule of the window,
 * or every account with a rule, is in the map — at zero when nothing accrued — and an account with
 * no rule is not (no data, not zero). One query, in the caller's transaction when it has one.
 */
export async function sumAccruals(
  ctx: Pick<Ctx, "userId">,
  per: "rule" | "account",
  window: AccrualWindow,
  reader: Pick<Tx, "select"> = getDb(),
): Promise<Map<string, AccrualSum>> {
  const key = per === "rule" ? interestRules.id : interestRules.accountId;
  const inWindow = and(
    window.from === undefined ? undefined : gte(interestAccruals.on, window.from),
    window.to === undefined ? undefined : lte(interestAccruals.on, window.to),
  );
  const rows = await reader
    .select({
      key,
      net: sql<string>`coalesce(sum(${interestAccruals.netCents}) filter (where ${inWindow ?? sql`true`}), 0)`,
      gross: sql<string>`coalesce(sum(${interestAccruals.gross}) filter (where ${inWindow ?? sql`true`}), 0)`,
      pending: sql<string>`coalesce(sum(${interestAccruals.netCents}) filter (where ${isNull(interestAccruals.entryId)}), 0)`,
      pendingGross: sql<string>`coalesce(sum(${interestAccruals.gross}) filter (where ${isNull(interestAccruals.entryId)}), 0)`,
    })
    .from(interestRules)
    .leftJoin(
      interestAccruals,
      and(
        eq(interestAccruals.ruleId, interestRules.id),
        userScoped(ctx).owns(interestAccruals),
        // The days of the window, and the unsettled ones wherever they fall: never the whole ledger.
        sql`(${inWindow ?? sql`true`} or ${isNull(interestAccruals.entryId)})`,
      ),
    )
    .where(
      and(
        userScoped(ctx).owns(interestRules),
        window.ruleIds === undefined ? undefined : inArray(interestRules.id, [...window.ruleIds]),
        window.accountIds === undefined
          ? undefined
          : inArray(interestRules.accountId, [...window.accountIds]),
      ),
    )
    .groupBy(key);
  return new Map(
    rows.map((row) => [
      row.key,
      {
        netCents: BigInt(row.net),
        grossCents: roundToCents(fixedFromDecimal(row.gross)),
        pendingCents: BigInt(row.pending),
        pendingGrossCents: roundToCents(fixedFromDecimal(row.pendingGross)),
      },
    ]),
  );
}

/** What one account's rules accrued, net, between two days; `null` when it has no rule at all. */
export async function accruedInterest(
  ctx: Pick<Ctx, "userId">,
  accountId: string,
  from: CivilDate,
  to: CivilDate,
): Promise<Cents | null> {
  return (await accruedInterestByAccount(ctx, [accountId], from, to)).get(accountId) ?? null;
}

/**
 * What an account's rules accrued, net, between two days (spec §7.4: the pockets' share of the
 * backing account's interest), several accounts in one query (audit POC-3, POC-5). An account with
 * no rule is absent from the map; one with rules and no accrual has zero.
 */
export async function accruedInterestByAccount(
  ctx: Pick<Ctx, "userId">,
  accountIds: readonly string[],
  from: CivilDate,
  to: CivilDate,
): Promise<Map<string, Cents>> {
  if (accountIds.length === 0) return new Map();
  const sums = await sumAccruals(ctx, "account", { accountIds, from, to });
  return new Map([...sums].map(([accountId, sum]) => [accountId, sum.netCents]));
}

/** Accrued to yesterday and settled to today: what a pass of the accrual job does, for one rule. */
export async function bringUpToDate(
  ctx: Pick<Ctx, "userId" | "timeZone">,
  id: string,
  now: Date = new Date(),
) {
  const todayOn = today(ctx.timeZone, now);
  await accrueRule(ctx, id, addDays(todayOn, -1));
  await settleDue(ctx, todayOn, [id]);
}

/**
 * The days of a rule accrued up to `through` (spec §7.6): from the day after the last accrual, or
 * from `valid_from`, to `through` or `valid_to`. A missed day is caught up — in order, so the
 * remainder stays right — and running it twice writes nothing twice (one row per rule and day).
 * The remainder is read strictly before each day, and used only when the day before was accrued.
 * Reads first, then one transaction; no network.
 */
async function accrueRule(
  ctx: Pick<Ctx, "userId" | "timeZone">,
  id: string,
  through: CivilDate,
): Promise<{ written: number }> {
  const rule = await requireRule(ctx, id);
  if (rule.state !== "active") return { written: 0 };
  const [last] = await getDb()
    .select()
    .from(interestAccruals)
    .where(and(eq(interestAccruals.ruleId, id), userScoped(ctx).owns(interestAccruals)))
    .orderBy(desc(interestAccruals.on))
    .limit(1);
  const start = last ? addDays(last.on, 1) : rule.validFrom;
  const end = rule.validTo !== null && rule.validTo < through ? rule.validTo : through;
  if (start > end) return { written: 0 };
  // The remainder of the day before, when that day was accrued.
  const carry =
    last?.on === addDays(start, -1) && last.status === "accrued" ? fixedFromDecimal(last.carry) : null;
  const rows = await accruedDays(ctx, rule, { start, end, carry });
  await getDb().transaction(async (tx) => {
    for (let first = 0; first < rows.length; first += 500) {
      await tx
        .insert(interestAccruals)
        .values(rows.slice(first, first + 500))
        .onConflictDoNothing({ target: [interestAccruals.ruleId, interestAccruals.on] });
    }
  });
  return { written: rows.length };
}

/** The rows of a rule's days from `start` to `end`, each on the balance the accounts module rebuilds. */
async function accruedDays(
  ctx: Pick<Ctx, "userId" | "timeZone">,
  rule: InterestRule,
  range: { start: CivilDate; end: CivilDate; carry: Fixed | null },
) {
  const tiers = (await tiersOf(ctx, [rule.id])).get(rule.id) ?? [];
  const { days, series } = await reconstructedBalances(ctx, [rule.accountId], {
    from: range.start,
    to: range.end,
  });
  const values = series.get(rule.accountId)?.values ?? days.map(() => null);
  let carry = range.carry;
  return days.map((day, index) => {
    const accrual = accrueDay({
      balanceCents: values[index],
      tiers,
      basis: rule.dayBasis === "360" ? 360 : 365,
      taxRate: rule.taxRate,
      carryBefore: carry,
    });
    carry = accrual.status === "accrued" ? accrual.carryAfter : null;
    return userScoped(ctx).stamp({
      ruleId: rule.id,
      on: day,
      balanceCents: values[index],
      gross: fixedToDecimal(accrual.grossFixed),
      netCents: accrual.netCents,
      carry: fixedToDecimal(accrual.carryAfter),
      status: accrual.status,
    });
  });
}

type Period = ReturnType<typeof settlementPeriods>[number];

/**
 * The periods of a rule to settle today: closed, not settled yet, and with every day accrued.
 * Periods are cut by the rule's own end only: the one under way ends on its calendar day, not
 * yesterday, and is settled the day after that — never while it is still running.
 */
function duePeriods(
  rule: InterestRule,
  todayOn: CivilDate,
  reached: CivilDate | null,
  settled: ReadonlySet<CivilDate>,
): Period[] {
  const current = periodOf(rule.settlement, todayOn).to;
  const end = rule.validTo !== null && rule.validTo < current ? rule.validTo : current;
  if (rule.validFrom > end || reached === null) return [];
  return settlementPeriods(rule.settlement, rule.validFrom, end).filter(
    (period) => period.settleOn <= todayOn && !settled.has(period.from) && reached >= period.to,
  );
}

/** One period of a rule as one `interest_entries` row with its days' sums; its days point at it. */
async function settlePeriod(ctx: Pick<Ctx, "userId">, ruleId: string, period: Period): Promise<boolean> {
  return getDb().transaction(async (tx) => {
    const window = { ruleIds: [ruleId], from: period.from, to: period.to };
    const sum = (await sumAccruals(ctx, "rule", window, tx)).get(ruleId);
    const net = sum?.netCents ?? 0n;
    const gross = sum?.grossCents ?? 0n;
    const [entry] = await tx
      .insert(interestEntries)
      .values(
        userScoped(ctx).stamp({
          ruleId,
          periodFrom: period.from,
          periodTo: period.to,
          settleOn: period.settleOn,
          grossCents: gross,
          taxCents: gross > net ? gross - net : 0n,
          netCents: net,
          posting: "none" as const,
        }),
      )
      .onConflictDoNothing({ target: [interestEntries.ruleId, interestEntries.periodFrom] })
      .returning({ id: interestEntries.id });
    if (!entry) return false;
    await tx
      .update(interestAccruals)
      .set({ entryId: entry.id })
      .where(
        and(
          eq(interestAccruals.ruleId, ruleId),
          userScoped(ctx).owns(interestAccruals),
          gte(interestAccruals.on, period.from),
          lte(interestAccruals.on, period.to),
        ),
      );
    return true;
  });
}

/**
 * The settlements of spec §7.6: every period that has closed by `today` and whose days are all
 * accrued becomes one `interest_entries` row with the period's nets added up, and its days point
 * at it. Idempotent (one settlement per rule and period). Two reads for all the rules (INT-7), then
 * one transaction per period.
 */
async function settleDue(
  ctx: Pick<Ctx, "userId">,
  todayOn: CivilDate,
  ruleIds?: readonly string[],
): Promise<{ written: number }> {
  const owned = (table: typeof interestAccruals | typeof interestEntries) =>
    and(userScoped(ctx).owns(table), ruleIds === undefined ? undefined : inArray(table.ruleId, [...ruleIds]));
  const [rules, reached, entries] = await Promise.all([
    getDb()
      .select()
      .from(interestRules)
      .where(
        and(
          userScoped(ctx).owns(interestRules),
          ruleIds === undefined ? undefined : inArray(interestRules.id, [...ruleIds]),
        ),
      ),
    getDb()
      .select({ ruleId: interestAccruals.ruleId, on: sql<string>`max(${interestAccruals.on})` })
      .from(interestAccruals)
      .where(owned(interestAccruals))
      .groupBy(interestAccruals.ruleId),
    getDb()
      .select({ ruleId: interestEntries.ruleId, periodFrom: interestEntries.periodFrom })
      .from(interestEntries)
      .where(owned(interestEntries)),
  ]);
  const reachedOf = new Map(reached.map((row) => [row.ruleId, row.on]));
  let written = 0;
  for (const rule of rules) {
    const settled = new Set(entries.filter((row) => row.ruleId === rule.id).map((row) => row.periodFrom));
    for (const period of duePeriods(rule, todayOn, reachedOf.get(rule.id) ?? null, settled)) {
      if (await settlePeriod(ctx, rule.id, period)) written += 1;
    }
  }
  return { written };
}
