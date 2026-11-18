// scripts/seed-e2e/pockets.ts — the users and the data of the flow `pockets` (tests/e2e/pockets/).
import { saveBalanceEntry } from "@domain/modules/accounts/service";
import { addPlannedExpense, addToPocket, createPocket } from "@domain/modules/pockets/service";
import { upsertFromProvider } from "@domain/modules/transactions/service";
import { addDays, today } from "@domain/platform/dates";
import { USERS } from "../../tests/e2e/_shared/env";
import { contextOf, syncedAccount, thisMonthOf, walletMovement } from "./common";

/**
 * Pockets (F3): a synced savings account holding 10.000 €, a pocket with a target resting on it
 * (250 € a month + 3.850 € added − the account's 850 € expense = 3.250 €, three months to its
 * 4.000 €) with a planned expense of 400 €, and a standalone envelope with no target holding its
 * first 50 € accrual and nothing linked yet — a 30 € expense of another account waits to be linked.
 */
export async function seedPockets(): Promise<void> {
  const ctx = await contextOf(USERS.pockets.email);
  const on = today(ctx.timeZone);
  const account = await syncedAccount(ctx, "e2e-pockets-1", "Revolut Saving");
  await saveBalanceEntry(ctx, account, { on, cents: 1_000_000n });
  await upsertFromProvider(ctx, account, [
    walletMovement("e2e-pockets-tx-1", on, -85_000n, "Ischia — hotel + traghetto", null),
  ]);
  const main = await syncedAccount(ctx, "e2e-pockets-2", "Revolut Main");
  await saveBalanceEntry(ctx, main, { on, cents: 200_000n });
  await upsertFromProvider(ctx, main, [
    walletMovement("e2e-pockets-tx-2", on, -3_000n, "Libreria Feltrinelli", null),
  ]);
  const startMonth = `${thisMonthOf(ctx)}-01`;
  const holidays = await createPocket(ctx, {
    name: "Holidays",
    color: null,
    backingAccountId: account,
    targetCents: 400_000n,
    monthlyCents: 25_000n,
    startMonth,
  });
  await addToPocket(ctx, holidays.id, { cents: 385_000n, on });
  await addPlannedExpense(ctx, holidays.id, {
    cents: 40_000n,
    dueOn: addDays(on, 20),
    description: "Hotel Roma",
  });
  await createPocket(ctx, {
    name: "Gifts",
    color: null,
    backingAccountId: null,
    targetCents: null,
    monthlyCents: 5_000n,
    startMonth,
  });
}
