import { z } from "zod";
import type { Principal } from "@/platform/auth/principal";
import { assertPermission } from "@/platform/auth/principal";
import type { Compounding, DayCount, InterestRule, PostingMode, UseCaseDeps } from "./ports";
import { InvalidInputError } from "./errors";

/**
 * At most 6 decimals, matching `interest_rules.annual_rate`/`tax_rate`'s
 * `numeric(10, 6)` columns; no leading "-" — a negative rate is never valid
 * (see `dailyInterest`'s own doc comment for why).
 */
const RATE_RE = /^\d+(\.\d{1,6})?$/;
const DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;

/**
 * The regex alone accepts calendar-impossible strings like "2026-13-45";
 * this rejects those by round-tripping through `Date.UTC` and checking the
 * components survived unchanged (an overflowing month/day silently rolls
 * into the next month/year instead of throwing, so a value mismatch is the
 * only signal).
 */
function isValidDateOnly(value: string): boolean {
  const match = DATE_RE.exec(value);
  if (!match) return false;
  const [, y, m, d] = match as unknown as [string, string, string, string];
  const year = Number(y);
  const month = Number(m);
  const day = Number(d);
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
}

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
