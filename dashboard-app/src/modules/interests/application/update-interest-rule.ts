import { z } from "zod";
import type { Principal } from "@/platform/auth/principal";
import { assertPermission } from "@/platform/auth/principal";
import type { InterestRule, InterestRulePatch, UseCaseDeps } from "./ports";
import { InvalidInputError, NotFoundError, VersionMismatchError } from "./errors";
import { DATE_RE, isValidDateOnly, RATE_RE } from "./rule-validation";

/** Same rate/tax bounds as `createInterestRuleSchema` — see that file's comment for why. */
const updateInterestRulePatchSchema = z.object({
  annualRate: z.string().regex(RATE_RE, "Enter a non-negative annual rate with at most 6 decimals.").optional(),
  taxRate: z
    .string()
    .regex(RATE_RE, "Enter a tax rate with at most 6 decimals.")
    .refine((v) => Number(v) <= 1, "Tax rate must be between 0 and 1.")
    .optional(),
  dayCount: z.union([z.literal(360), z.literal(365), z.literal("actual")]).optional(),
  compounding: z.enum(["simple_daily", "monthly", "none"]).optional(),
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

export function updateInterestRule(deps: UseCaseDeps) {
  return async (
    principal: Principal,
    id: string,
    expectedVersion: number,
    patch: InterestRulePatch,
  ): Promise<InterestRule> => {
    assertPermission(principal, "interests.write");
    const parsed = updateInterestRulePatchSchema.safeParse(patch);
    if (!parsed.success) {
      throw new InvalidInputError(parsed.error.issues[0]?.message ?? "Invalid input", parsed.error.issues);
    }
    const result = await deps.rules.update(principal.userId, id, expectedVersion, parsed.data);
    if (result === null) throw new NotFoundError();
    if (result === "version_mismatch") throw new VersionMismatchError();
    await deps.audit({
      actorUserId: principal.userId,
      action: "interests.rule_updated",
      entityType: "interest_rule",
      entityId: id,
      after: parsed.data,
    });
    return result;
  };
}
