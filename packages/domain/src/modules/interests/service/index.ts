// The writes of interests (spec §7.6): the rules and what rests on an account. The ledger of the days
// is `accruals.ts`, what is left of the publication on the source `posting.ts`.
import { and, asc, eq, inArray, isNull } from "drizzle-orm";
import { requireOpenAccount } from "../../accounts";
import { listCategories } from "../../transactions/taxonomy";
import type { Ctx } from "../../../platform/context";
import { getDb, type Tx } from "../../../platform/db/client";
import { userScoped } from "../../../platform/db/scope";
import { type RuleInput, ruleInputSchema, validateTiers } from "../rules";
import { interestAccruals, interestRules } from "../schema";
import { bringUpToDate } from "./accruals";
import { InterestError, type InterestRule, replaceTiers, requireRule } from "./records";

export { accruedInterest, accruedInterestByAccount, bringUpToDate, sumAccruals } from "./accruals";
export type { AccrualSum } from "./accruals";
export { InterestError, tiersOf } from "./records";
export type { InterestAccrual, InterestEntry, InterestRule } from "./records";

/**
 * The account a rule is on: one of this user's, not archived. A rule no longer publishes on its
 * source (decision H37, ST-14): `post_to_provider` is refused, for a new rule and a changed one.
 */
async function checkAccount(ctx: Pick<Ctx, "userId">, accountId: string, mode: string): Promise<void> {
  if (mode === "post_to_provider") throw new InterestError("mode_retired");
  await requireOpenAccount(ctx, accountId, () => new InterestError("invalid_account"));
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
    await replaceTiers(tx, ctx, created.id, tiers);
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
  if (rule.accountId !== current.accountId || rule.mode !== "analyze_only") {
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
    await replaceTiers(tx, ctx, id, tiers);
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

// ——— What rests on an account (PERS-419) ——————————————————————————————————————————————————————
// The deletion of an account lists these and moves each to another account first: the foreign key
// is `on delete no action`, so one left behind makes the deletion refuse.

/** The interest rules on an account, oldest first. */
export async function rulesToMove(
  ctx: Pick<Ctx, "userId">,
  accountId: string,
): Promise<{ id: string; validFrom: string }[]> {
  return getDb()
    .select({ id: interestRules.id, validFrom: interestRules.validFrom })
    .from(interestRules)
    .where(and(userScoped(ctx).owns(interestRules), eq(interestRules.accountId, accountId)))
    .orderBy(asc(interestRules.validFrom), asc(interestRules.id));
}

/** A rule on another account: the same check as the rule's own form. */
export async function moveRuleAccount(
  ctx: Pick<Ctx, "userId">,
  id: string,
  accountId: string,
): Promise<void> {
  const [rule] = await getDb()
    .select({ mode: interestRules.mode })
    .from(interestRules)
    .where(and(eq(interestRules.id, id), userScoped(ctx).owns(interestRules)));
  if (!rule) throw new InterestError("not_found");
  await checkAccount(ctx, accountId, rule.mode);
  await getDb()
    .update(interestRules)
    .set({ accountId })
    .where(and(eq(interestRules.id, id), userScoped(ctx).owns(interestRules)));
}

/** Whether an interest rule files its settlements under one of some categories (§3.5). */
export async function postsUnderAny(
  ctx: Pick<Ctx, "userId">,
  categoryIds: readonly string[],
): Promise<boolean> {
  if (categoryIds.length === 0) return false;
  const [row] = await getDb()
    .select({ id: interestRules.id })
    .from(interestRules)
    .where(
      and(userScoped(ctx).owns(interestRules), inArray(interestRules.postingCategoryId, [...categoryIds])),
    )
    .limit(1);
  return row !== undefined;
}

/** The rules that publish to the source of these accounts: what "Turn off" stops (§3.3). */
export async function publishingRuleCount(
  ctx: Pick<Ctx, "userId">,
  accountIds: readonly string[],
): Promise<number> {
  if (accountIds.length === 0) return 0;
  const rows = await getDb()
    .select({ id: interestRules.id })
    .from(interestRules)
    .where(
      and(
        userScoped(ctx).owns(interestRules),
        inArray(interestRules.accountId, [...accountIds]),
        eq(interestRules.mode, "post_to_provider"),
      ),
    );
  return rows.length;
}

/**
 * "Turn off" a source (plugin-settings.md §3.2), inside the caller's transaction: a rule that
 * published to it only computes from now on. Its accruals and settlements stay, a settlement not
 * published yet stays "not published", and turning the source on again does not publish (Q6).
 */
export async function stopPublishingOnAccounts(
  tx: Tx,
  ctx: Pick<Ctx, "userId">,
  accountIds: readonly string[],
): Promise<number> {
  if (accountIds.length === 0) return 0;
  const rows = await tx
    .update(interestRules)
    .set({ mode: "analyze_only" })
    .where(
      and(
        userScoped(ctx).owns(interestRules),
        inArray(interestRules.accountId, [...accountIds]),
        eq(interestRules.mode, "post_to_provider"),
      ),
    )
    .returning({ id: interestRules.id });
  return rows.length;
}
