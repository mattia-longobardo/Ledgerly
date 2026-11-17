// scripts/seed-e2e/interests.ts — the users and the data of the flow `interests` (tests/e2e/interests/).
import { createAccount } from "../../src/modules/accounts/service";
import { addDays, addMonths, monthKey, today } from "../../src/platform/dates";
import { USERS } from "../../tests/e2e/_shared/env";
import { contextOf } from "./common";

/**
 * Interests (F4): a savings account that has held 10.000,00 € since before last month, so a 3,65 %
 * rule on 365 days earns exactly 1,00 € a day and last month's payout is its number of days.
 */
export async function seedInterests(): Promise<void> {
  const ctx = await contextOf(USERS.interests.email);
  await createAccount(ctx, {
    name: "Revolut Saving",
    type: "savings",
    currency: "EUR",
    color: null,
    reference: "",
    purpose: "",
    openedOn: null,
    notes: "",
    openingBalance: { on: addDays(addMonths(monthKey(today(ctx.timeZone)), -1), -1), cents: 1_000_000n },
  });
}
