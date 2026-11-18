// scripts/seed-e2e/budgets.ts — the users and the data of the flow `budgets` (tests/e2e/budgets/).
import { setLimit } from "@domain/modules/budgets/service";
import { upsertFromProvider } from "@domain/modules/transactions/service";
import { listCategories } from "@domain/modules/transactions/taxonomy";
import { USERS } from "../../tests/e2e/_shared/env";
import { contextOf, syncedAccount, thisMonthOf, walletMovement } from "./common";

/**
 * Budgets (F3): this month's spending in four categories, three of them with a limit from this
 * month — one on track, one near its limit, one over it — and a giroconto that must count in none.
 */
export async function seedBudgets(): Promise<void> {
  const ctx = await contextOf(USERS.budgets.email);
  const accountId = await syncedAccount(ctx, "e2e-bud-1", "ING Conto Arancio");
  const thisMonth = thisMonthOf(ctx);
  await upsertFromProvider(ctx, accountId, [
    walletMovement("e2e-bud-tx-1", `${thisMonth}-01`, -4550n, "Esselunga", "Spesa"),
    walletMovement("e2e-bud-tx-2", `${thisMonth}-01`, -4800n, "Da Mario", "Ristoranti"),
    walletMovement("e2e-bud-tx-3", `${thisMonth}-01`, -2100n, "Trenitalia", "Trasporti"),
    walletMovement("e2e-bud-tx-4", `${thisMonth}-01`, -1299n, "Netflix", "Abbonamenti"),
    walletMovement("e2e-bud-tx-5", `${thisMonth}-01`, -30000n, "Revolut", "Trasporti", "e2e-bud-tx-6"),
  ]);
  const byName = new Map((await listCategories(ctx)).map((category) => [category.name, category.id]));
  const month = `${thisMonth}-01`;
  for (const [name, cents] of [
    ["Spesa", 10000n],
    ["Ristoranti", 5000n],
    ["Trasporti", 2000n],
  ] as const) {
    await setLimit(ctx, { categoryId: byName.get(name)!, accountId: null, month, cents });
  }
}
