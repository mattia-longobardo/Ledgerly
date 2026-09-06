import { z } from "zod";
import type { Principal } from "@/platform/auth/principal";
import { assertPermission } from "@/platform/auth/principal";
import { InvalidInputError } from "./errors";
import type { Fund, FundKind, UseCaseDeps } from "./ports";
import { currencySchema, FUND_KINDS, isUniqueViolation, parseInput } from "./validation";

const schema = z.object({
  slug: z.string().regex(/^[a-z0-9-]{2,40}$/, "Invalid fund slug."),
  name: z.string().trim().min(1, "Invalid fund name."),
  kind: z.enum(FUND_KINDS),
  currency: currencySchema.optional(),
  accountId: z.string().min(1).nullable().optional(),
}).strict();

export interface CreateFundInput { slug: string; name: string; kind: FundKind; currency?: string; accountId?: string | null }

export function createFund(deps: UseCaseDeps) {
  return async (principal: Principal, input: CreateFundInput): Promise<Fund> => {
    assertPermission(principal, "funds.write");
    const value = parseInput(schema, input);
    const currency = value.currency ?? "EUR";
    const accountId = value.accountId ?? null;
    if (accountId !== null) {
      const account = await deps.accountLinks.get(principal.userId, accountId);
      if (!account) throw new InvalidInputError("Choose an account you own.");
      if (account.currency !== currency) throw new InvalidInputError("Fund and account currency must match.");
    }
    if (await deps.funds.getBySlug(principal.userId, value.slug)) {
      throw new InvalidInputError("A fund with this slug already exists.");
    }
    let fund: Fund;
    try {
      fund = await deps.funds.create({ userId: principal.userId, slug: value.slug, name: value.name, kind: value.kind, currency, accountId });
    } catch (error) {
      if (isUniqueViolation(error, "funds_user_slug_uq")) throw new InvalidInputError("A fund with this slug already exists.");
      throw error;
    }
    await deps.audit({ actorUserId: principal.userId, action: "funds.fund_created", entityType: "fund", entityId: fund.id, after: fund });
    return fund;
  };
}
