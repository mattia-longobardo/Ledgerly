import { z } from "zod";
import { assertPermission, type Principal } from "@/platform/auth/principal";
import { romeDate } from "@/lib/time";
import type { UseCaseDeps } from "./deps";
import { InvalidInputError, NotFoundError } from "./errors";

export const recordManualBalanceSchema = z.object({
  asOf: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Enter a date as YYYY-MM-DD."),
  balance: z.string().regex(/^-?\d+(\.\d{1,2})?$/, "Enter an amount with at most two decimals."),
  available: z
    .string()
    .regex(/^-?\d+(\.\d{1,2})?$/, "Enter an amount with at most two decimals.")
    .nullable()
    .optional(),
});
export type RecordManualBalanceInput = z.input<typeof recordManualBalanceSchema>;

export function recordManualBalance(deps: UseCaseDeps) {
  return async (principal: Principal, id: string, raw: RecordManualBalanceInput): Promise<void> => {
    assertPermission(principal, "accounts.write");
    const parsed = recordManualBalanceSchema.safeParse(raw);
    if (!parsed.success) {
      throw new InvalidInputError(parsed.error.issues[0]?.message ?? "Invalid input", parsed.error.issues);
    }
    const input = parsed.data;
    const account = await deps.accounts.get(principal.userId, id);
    if (!account) throw new NotFoundError();
    if (account.origin !== "manual") {
      throw new InvalidInputError("Balances of a synced account come from the provider");
    }
    if (input.asOf > romeDate(deps.clock.now())) {
      throw new InvalidInputError("Balance date cannot be in the future");
    }
    await deps.accounts.recordBalances([
      {
        accountId: account.id,
        asOf: input.asOf,
        balance: input.balance,
        available: input.available ?? null,
        source: "manual",
        capturedAt: deps.clock.now(),
      },
    ]);
    await deps.audit({
      actorUserId: principal.userId,
      action: "account.balance",
      entityType: "account",
      entityId: account.id,
      after: { asOf: input.asOf, balance: input.balance, available: input.available ?? null },
    });
  };
}
