import "server-only";
import { and, asc, desc, eq, gte, inArray, isNull, lt, sql } from "drizzle-orm";
import { z } from "zod";
import { getAccount } from "@/modules/accounts/queries";
import { dailyBalancesOf } from "@/modules/accounts/service";
import { listCategories } from "@/modules/transactions/taxonomy";
import type { Ctx } from "@/platform/context";
import { addDays, type CivilDate, isCivilDate, today } from "@/platform/dates";
import { getDb } from "@/platform/db/client";
import { userScoped } from "@/platform/db/scope";
import type { Cents } from "@/platform/money";
import {
  accrueDay,
  DAY_BASES,
  type Fixed,
  FIXED_SCALE,
  fixedFromDecimal,
  fixedToDecimal,
  RULE_MODES,
  RULE_STATES,
  roundToCents,
  SETTLEMENTS,
  periodOf,
  settlementPeriods,
  type Tier,
  validateTiers,
} from "./rules";
import { interestAccruals, interestEntries, interestRules, interestRuleTiers } from "./schema";

export type InterestRule = typeof interestRules.$inferSelect;
export type InterestEntry = typeof interestEntries.$inferSelect;
export type InterestAccrual = typeof interestAccruals.$inferSelect;

export type InterestErrorCode =
  "not_found" | "invalid_account" | "invalid_tiers" | "not_synced" | "invalid_category";

export class InterestError extends Error {
  constructor(readonly code: InterestErrorCode) {
    super(code);
    this.name = "InterestError";
  }
}

const civilDate = z.string().refine(isCivilDate, "Not a civil date");
const fraction = z
  .string()
  .regex(/^\d+(\.\d{1,6})?$/)
  .refine((value) => fixedFromDecimal(value) <= FIXED_SCALE, "Above 1");

export const ruleInputSchema = z
  .object({
    accountId: z.uuid(),
    taxRate: fraction,
    dayBasis: z.enum(DAY_BASES),
    settlement: z.enum(SETTLEMENTS),
    validFrom: civilDate,
    validTo: civilDate.nullable().default(null),
    runHour: z.int().min(0).max(23).nullable().default(null),
    mode: z.enum(RULE_MODES).default("analyze_only"),
    /** The local category a published settlement is filed under in Wallet (spec §7.6). */
    postingCategoryId: z.uuid().nullable().default(null),
    state: z.enum(RULE_STATES).default("active"),
    payeeMatch: z
      .string()
      .trim()
      .max(80)
      .transform((value) => (value === "" ? null : value))
      .nullable()
      .default(null),
    tiers: z.array(z.object({ upToCents: z.bigint().positive().nullable(), annualRate: fraction })).min(1),
  })
  .refine((rule) => rule.validTo === null || rule.validTo >= rule.validFrom, "Ends before it starts");

export type RuleInput = z.input<typeof ruleInputSchema>;

async function requireRule(ctx: Pick<Ctx, "userId">, id: string): Promise<InterestRule> {
  const [row] = await getDb()
    .select()
    .from(interestRules)
    .where(and(eq(interestRules.id, id), userScoped(ctx).owns(interestRules)));
  if (!row) throw new InterestError("not_found");
  return row;
}

/**
 * The account a rule is on: one of this user's, not archived; and a synced one when the rule
 * publishes to Wallet, because the posting needs the provider's id of the account (spec §7.6).
 */
async function checkAccount(ctx: Pick<Ctx, "userId">, accountId: string, mode: string): Promise<void> {
  const account = await getAccount(ctx, accountId);
  if (!account || account.state === "archived") throw new InterestError("invalid_account");
  if (mode === "post_to_provider" && (account.origin !== "synced" || account.providerAccountId === null)) {
    throw new InterestError("not_synced");
  }
}

/**
 * The category a rule publishes under: one of this user's open categories, read through the
 * module that owns them (spec §4.3 — no table of another module is touched here). An archived one
 * is refused rather than kept: it would not be in the picker to take back out.
 */
async function checkCategory(ctx: Pick<Ctx, "userId">, categoryId: string | null): Promise<void> {
  if (categoryId === null) return;
  const known = (await listCategories(ctx)).some((category) => category.id === categoryId);
  if (!known) throw new InterestError("invalid_category");
}

export async function tiersOf(
  ctx: Pick<Ctx, "userId">,
  ruleIds: readonly string[],
): Promise<Map<string, Tier[]>> {
  if (ruleIds.length === 0) return new Map();
  const rows = await getDb()
    .select()
    .from(interestRuleTiers)
    .where(and(userScoped(ctx).owns(interestRuleTiers), inArray(interestRuleTiers.ruleId, [...ruleIds])))
    .orderBy(asc(interestRuleTiers.ruleId), asc(interestRuleTiers.position));
  const byRule = new Map<string, Tier[]>();
  for (const row of rows) {
    byRule.set(row.ruleId, [
      ...(byRule.get(row.ruleId) ?? []),
      { upToCents: row.upToCents, annualRate: row.annualRate },
    ]);
  }
  return byRule;
}

function parse(input: RuleInput) {
  const parsed = ruleInputSchema.parse(input);
  if (!validateTiers(parsed.tiers)) throw new InterestError("invalid_tiers");
  return parsed;
}

/** A new rule, accrued at once up to yesterday and settled where its periods have closed. */
export async function createRule(
  ctx: Pick<Ctx, "userId" | "timeZone">,
  input: RuleInput,
): Promise<InterestRule> {
  const { tiers, ...rule } = parse(input);
  await checkAccount(ctx, rule.accountId, rule.mode);
  await checkCategory(ctx, rule.postingCategoryId);
  const row = await getDb().transaction(async (tx) => {
    const [created] = await tx.insert(interestRules).values(userScoped(ctx).stamp(rule)).returning();
    await tx
      .insert(interestRuleTiers)
      .values(
        tiers.map((tier, position) => userScoped(ctx).stamp({ ruleId: created.id, position, ...tier })),
      );
    return created;
  });
  await bringUpToDate(ctx, row.id);
  return row;
}

/**
 * A changed rule. What has been settled stays as it was — a settlement may already be on Wallet —
 * and every day after the last settled period is accrued again with the new terms (plan F4
 * §3.4.3, §3.6.9).
 */
export async function updateRule(
  ctx: Pick<Ctx, "userId" | "timeZone">,
  id: string,
  input: RuleInput,
): Promise<InterestRule> {
  const current = await requireRule(ctx, id);
  const { tiers, ...rule } = parse(input);
  if (rule.accountId !== current.accountId || rule.mode !== current.mode) {
    await checkAccount(ctx, rule.accountId, rule.mode);
  }
  if (rule.postingCategoryId !== current.postingCategoryId) {
    await checkCategory(ctx, rule.postingCategoryId);
  }
  const row = await getDb().transaction(async (tx) => {
    const [updated] = await tx
      .update(interestRules)
      .set(rule)
      .where(and(eq(interestRules.id, id), userScoped(ctx).owns(interestRules)))
      .returning();
    await tx
      .delete(interestRuleTiers)
      .where(and(eq(interestRuleTiers.ruleId, id), userScoped(ctx).owns(interestRuleTiers)));
    await tx
      .insert(interestRuleTiers)
      .values(tiers.map((tier, position) => userScoped(ctx).stamp({ ruleId: id, position, ...tier })));
    await tx
      .delete(interestAccruals)
      .where(
        and(
          eq(interestAccruals.ruleId, id),
          userScoped(ctx).owns(interestAccruals),
          isNull(interestAccruals.entryId),
        ),
      );
    return updated;
  });
  await bringUpToDate(ctx, id);
  return row;
}

/** Pause or resume. A paused rule accrues nothing; resuming catches its days up. */
export async function setRuleState(
  ctx: Pick<Ctx, "userId" | "timeZone">,
  id: string,
  state: "active" | "paused",
): Promise<void> {
  await requireRule(ctx, id);
  await getDb()
    .update(interestRules)
    .set({ state })
    .where(and(eq(interestRules.id, id), userScoped(ctx).owns(interestRules)));
  await bringUpToDate(ctx, id);
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
export async function accrueRule(
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

  const tiers = (await tiersOf(ctx, [id])).get(id) ?? [];
  const { days, series } = await dailyBalancesOf(ctx, [rule.accountId], { from: start, to: end });
  const values = series.get(rule.accountId)?.values ?? days.map(() => null);
  let carry: Fixed | null =
    last && last.on === addDays(start, -1) && last.status === "accrued" ? fixedFromDecimal(last.carry) : null;
  const rows = days.map((on, index) => {
    const day = accrueDay({
      balanceCents: values[index],
      tiers,
      basis: rule.dayBasis === "360" ? 360 : 365,
      taxRate: rule.taxRate,
      carryBefore: carry,
    });
    carry = day.status === "accrued" ? day.carryAfter : null;
    return userScoped(ctx).stamp({
      ruleId: id,
      on,
      balanceCents: values[index],
      gross: fixedToDecimal(day.grossFixed),
      netCents: day.netCents,
      carry: fixedToDecimal(day.carryAfter),
      status: day.status,
    });
  });
  if (rows.length === 0) return { written: 0 };
  await getDb().transaction(async (tx) => {
    for (let i = 0; i < rows.length; i += 500) {
      await tx
        .insert(interestAccruals)
        .values(rows.slice(i, i + 500))
        .onConflictDoNothing({ target: [interestAccruals.ruleId, interestAccruals.on] });
    }
  });
  return { written: rows.length };
}

/** Gross cents of a period: its fixed gross rounded once, half-up. */
function grossCents(values: readonly string[]): Cents {
  return roundToCents(values.reduce<Fixed>((sum, value) => sum + fixedFromDecimal(value), 0n));
}

/**
 * The settlements of spec §7.6: every period that has closed by `today` and whose days are all
 * accrued becomes one `interest_entries` row with the period's nets added up, and its days point
 * at it. Idempotent (one settlement per rule and period).
 */
export async function settleDue(
  ctx: Pick<Ctx, "userId">,
  todayOn: CivilDate,
  ruleIds?: readonly string[],
): Promise<{ written: number }> {
  const rules = await getDb()
    .select()
    .from(interestRules)
    .where(
      and(
        userScoped(ctx).owns(interestRules),
        ruleIds === undefined ? undefined : inArray(interestRules.id, [...ruleIds]),
      ),
    );
  let written = 0;
  for (const rule of rules) {
    // Periods are cut by the rule's own end only: the one under way ends on its calendar day, not
    // yesterday, and is settled the day after that — never while it is still running.
    const current = periodOf(rule.settlement, todayOn).to;
    const end = rule.validTo !== null && rule.validTo < current ? rule.validTo : current;
    if (rule.validFrom > end) continue;
    const [reached] = await getDb()
      .select({ on: sql<string | null>`max(${interestAccruals.on})` })
      .from(interestAccruals)
      .where(and(eq(interestAccruals.ruleId, rule.id), userScoped(ctx).owns(interestAccruals)));
    const settled = new Set(
      (
        await getDb()
          .select({ periodFrom: interestEntries.periodFrom })
          .from(interestEntries)
          .where(and(eq(interestEntries.ruleId, rule.id), userScoped(ctx).owns(interestEntries)))
      ).map((row) => row.periodFrom),
    );
    const due = settlementPeriods(rule.settlement, rule.validFrom, end).filter(
      (period) =>
        period.settleOn <= todayOn &&
        !settled.has(period.from) &&
        reached?.on != null &&
        reached.on >= period.to,
    );
    for (const period of due) {
      await getDb().transaction(async (tx) => {
        const days = await tx
          .select({ gross: interestAccruals.gross, netCents: interestAccruals.netCents })
          .from(interestAccruals)
          .where(
            and(
              eq(interestAccruals.ruleId, rule.id),
              userScoped(ctx).owns(interestAccruals),
              gte(interestAccruals.on, period.from),
              lt(interestAccruals.on, period.settleOn),
            ),
          );
        const net = days.reduce<Cents>((sum, day) => sum + day.netCents, 0n);
        const gross = grossCents(days.map((day) => day.gross));
        const [entry] = await tx
          .insert(interestEntries)
          .values(
            userScoped(ctx).stamp({
              ruleId: rule.id,
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
        if (!entry) return;
        await tx
          .update(interestAccruals)
          .set({ entryId: entry.id })
          .where(
            and(
              eq(interestAccruals.ruleId, rule.id),
              userScoped(ctx).owns(interestAccruals),
              gte(interestAccruals.on, period.from),
              lt(interestAccruals.on, period.settleOn),
            ),
          );
        written += 1;
      });
    }
  }
  return { written };
}

/**
 * What an account's rules accrued, net, between two days (spec §7.4: the pockets' share of the
 * backing account's interest). `null` when the account has no rule at all — no data, not zero.
 */
export async function accruedInterest(
  ctx: Pick<Ctx, "userId">,
  accountId: string,
  from: CivilDate,
  to: CivilDate,
): Promise<Cents | null> {
  const rules = await getDb()
    .select({ id: interestRules.id })
    .from(interestRules)
    .where(and(userScoped(ctx).owns(interestRules), eq(interestRules.accountId, accountId)));
  if (rules.length === 0) return null;
  const [row] = await getDb()
    .select({ net: sql<string | null>`sum(${interestAccruals.netCents})` })
    .from(interestAccruals)
    .where(
      and(
        userScoped(ctx).owns(interestAccruals),
        inArray(
          interestAccruals.ruleId,
          rules.map((rule) => rule.id),
        ),
        gte(interestAccruals.on, from),
        lt(interestAccruals.on, addDays(to, 1)),
      ),
    );
  return BigInt(row?.net ?? "0");
}
