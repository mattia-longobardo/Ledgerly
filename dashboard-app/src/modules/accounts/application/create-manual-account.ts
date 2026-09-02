import { z } from "zod";
import { assertPermission, type Principal } from "@/platform/auth/principal";
import { romeDate } from "@/lib/time";
import type { Account } from "../domain/account";
import type { UseCaseDeps } from "./deps";
import { InvalidInputError } from "./errors";

export const createManualAccountSchema = z.object({
  name: z.string().trim().min(1, "Enter a name.").max(120),
  type: z.enum(["checking", "savings", "cash", "investment", "pension_fund", "crypto", "credit", "other"]),
  currency: z.string().length(3).toUpperCase().default("EUR"),
  groupId: z.string().uuid().nullable().optional(),
  includeInNetWorth: z.boolean().default(true),
  notes: z.string().max(2000).nullable().optional(),
  openingBalance: z
    .object({ asOf: z.string().regex(/^\d{4}-\d{2}-\d{2}$/), balance: z.string().regex(/^-?\d+(\.\d{1,2})?$/) })
    .optional(),
});
export type CreateManualAccountInput = z.input<typeof createManualAccountSchema>;

export function createManualAccount(deps: UseCaseDeps) {
  return async (principal: Principal, raw: CreateManualAccountInput): Promise<Account> => {
    assertPermission(principal, "accounts.write");
    const parsed = createManualAccountSchema.safeParse(raw);
    if (!parsed.success) {
      throw new InvalidInputError(parsed.error.issues[0]?.message ?? "Invalid input", parsed.error.issues);
    }
    const input = parsed.data;
    if (input.openingBalance && input.openingBalance.asOf > romeDate(deps.clock.now())) {
      throw new InvalidInputError("Balance date cannot be in the future");
    }
    const account = await deps.accounts.create({
      userId: principal.userId,
      groupId: input.groupId ?? null,
      name: input.name,
      type: input.type,
      currency: input.currency,
      origin: "manual",
      provider: null,
      status: "active",
      includeInNetWorth: input.includeInNetWorth,
      notes: input.notes ?? null,
      sortOrder: 0,
    });
    if (input.openingBalance) {
      await deps.accounts.recordBalances([
        {
          accountId: account.id,
          asOf: input.openingBalance.asOf,
          balance: input.openingBalance.balance,
          available: null,
          source: "manual",
          capturedAt: deps.clock.now(),
        },
      ]);
    }
    await deps.audit({
      actorUserId: principal.userId,
      action: "account.create",
      entityType: "account",
      entityId: account.id,
      after: account,
    });
    return account;
  };
}
