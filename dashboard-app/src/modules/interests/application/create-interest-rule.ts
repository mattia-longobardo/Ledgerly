import { z } from "zod";
import type { Principal } from "@/platform/auth/principal";
import { assertPermission } from "@/platform/auth/principal";
import type { Compounding, DayCount, InterestRule, PostingMode, UseCaseDeps } from "./ports";
import { InvalidInputError } from "./errors";
import { DATE_RE, isValidDateOnly, RATE_RE } from "./rule-validation";

/**
 * Rejects a negative `annualRate` or a `taxRate` outside [0, 1] at the door,
 * before either is ever persisted — the contract `dailyInterest` (Task 14's
 * review) now enforces by throwing instead of silently flooring to zero.
 * Catching it here, rather than at accrual time, means `runInterestAccrual`
 * and `getInterestRuleDetail` never have to guess what a thrown decimal
 * error means for a rule this application itself wrote.
 */
const createInterestRuleSchema = z.object({
  accountId: z.string().min(1, "Choose an account."),
  annualRate: z.string().regex(RATE_RE, "Enter a non-negative annual rate with at most 6 decimals."),
  taxRate: z
    .string()
    .regex(RATE_RE, "Enter a tax rate with at most 6 decimals.")
    .refine((v) => Number(v) <= 1, "Tax rate must be between 0 and 1."),
  dayCount: z.union([z.literal(360), z.literal(365), z.literal("actual")]),
  compounding: z.enum(["simple_daily", "monthly", "none"]).optional(),
  effectiveFrom: z
    .string()
    .regex(DATE_RE, "Enter a date as YYYY-MM-DD.")
    .refine(isValidDateOnly, "Enter a real calendar date."),
  effectiveTo: z
    .string()
    .regex(DATE_RE, "Enter a date as YYYY-MM-DD.")
    .refine(isValidDateOnly, "Enter a real calendar date.")
    .nullable()
    .optional(),
  postingMode: z.enum(["analyze_only", "post_to_provider"]).optional(),
  providerCategoryRef: z.string().nullable().optional(),
  noteMarker: z.string().min(1).optional(),
});

export interface CreateInterestRuleInput {
  accountId: string;
  annualRate: string;
  taxRate: string;
  dayCount: DayCount;
  compounding?: Compounding;
  effectiveFrom: string;
  effectiveTo?: string | null;
  postingMode?: PostingMode;
  providerCategoryRef?: string | null;
  noteMarker?: string;
}

export function createInterestRule(deps: UseCaseDeps) {
  return async (principal: Principal, input: CreateInterestRuleInput): Promise<InterestRule> => {
    assertPermission(principal, "interests.write");
    const parsed = createInterestRuleSchema.safeParse(input);
    if (!parsed.success) {
      throw new InvalidInputError(parsed.error.issues[0]?.message ?? "Invalid input", parsed.error.issues);
    }
    const value = parsed.data;
    // Ruling P3-C42 (B7): the only thing that used to stand between
    // `value.accountId` and an account belonging to someone else entirely
    // was an incidental filter three layers away, in the accrual job's own
    // balance lookup. `interest-accrual.ts` later resolves the *posting*
    // Wallet credential from `rule.userId` and pairs it with
    // `links.liveFor("account", rule.accountId)` under a system context that
    // bypasses RLS — happily pairing this user's token with a foreign
    // account's link if this check did not exist. Checked explicitly here,
    // before the rule is ever persisted; `interest_rules_owner`'s `WITH
    // CHECK` (migration 0014) enforces the same fact at the database layer
    // as defense-in-depth against any future write path that bypasses this
    // use case.
    if (!(await deps.accounts.ownedByUser(principal.userId, value.accountId))) {
      throw new InvalidInputError("Choose an account you own.");
    }
    const rule = await deps.rules.create({
      userId: principal.userId,
      accountId: value.accountId,
      annualRate: value.annualRate,
      taxRate: value.taxRate,
      dayCount: value.dayCount,
      compounding: value.compounding ?? "simple_daily",
      effectiveFrom: value.effectiveFrom,
      effectiveTo: value.effectiveTo ?? null,
      postingMode: value.postingMode ?? "analyze_only",
      providerCategoryRef: value.providerCategoryRef ?? null,
      noteMarker: value.noteMarker ?? "auto-interest",
    });
    await deps.audit({
      actorUserId: principal.userId,
      action: "interests.rule_created",
      entityType: "interest_rule",
      entityId: rule.id,
      after: rule,
    });
    return rule;
  };
}
