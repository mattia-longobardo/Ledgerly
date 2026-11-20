// scripts/seed-e2e/subscriptions.ts — the users and the data of the flow `subscriptions` (tests/e2e/subscriptions/).
import { saveBalanceEntry } from "@domain/modules/accounts/service";
import { createSubscription } from "@domain/modules/subscriptions/service";
import { refreshRecurrences } from "../../apps/web/src/modules/transactions/jobs";
import { upsertFromProvider } from "@domain/modules/transactions/service";
import { listCategories } from "@domain/modules/transactions/taxonomy";
import { addDays, today } from "@domain/shared/dates";
import { USERS } from "../../tests/e2e/_shared/env";
import { contextOf, syncedAccount, walletMovement } from "./common";
import { WALLET_PROVIDER } from "@domain/platform/integrations/rules";

/**
 * Subscriptions (F3): three plans paid from one synced account holding 1.500 € — Netflix found at
 * its price today, Spotify found at 12,99 € against a plan of 10,99 € (amount differs), Amazon
 * Prime due in three days and not found yet — and a gym charged monthly for three months that no
 * subscription covers, for "Suggest from recurring payments".
 */
export async function seedSubscriptions(): Promise<void> {
  const ctx = await contextOf(USERS.subscriptions.email);
  const accountId = await syncedAccount(ctx, "e2e-sub-1", "Revolut Main");
  const on = today(ctx.timeZone);
  await saveBalanceEntry(ctx, accountId, { on, cents: 150_000n });
  await upsertFromProvider(
    ctx,
    accountId,
    [
      walletMovement("e2e-sub-tx-1", on, -1299n, "NETFLIX.COM", "Streaming"),
      walletMovement("e2e-sub-tx-2", on, -1299n, "Spotify AB", "Streaming"),
      walletMovement("e2e-sub-tx-3", addDays(on, -90), -2990n, "FitActive", "Sport"),
      walletMovement("e2e-sub-tx-4", addDays(on, -60), -2990n, "FitActive", "Sport"),
      walletMovement("e2e-sub-tx-5", addDays(on, -30), -2990n, "FitActive", "Sport"),
    ],
    { provider: WALLET_PROVIDER },
  );
  await refreshRecurrences(ctx);
  // The two streaming ones carry the category the movements created, so the table has a category
  // tag with a colour in it to check (F8.1); Amazon Prime deliberately keeps none.
  const streaming = (await listCategories(ctx)).find((one) => one.name === "Streaming");
  const base = { categoryId: null, paymentAccountId: accountId, tolerance: "0.05" };
  await createSubscription(ctx, {
    ...base,
    categoryId: streaming?.id ?? null,
    name: "Netflix",
    utility: 8,
    priceCents: 1299n,
    cycle: "monthly",
    nextChargeOn: on,
    payeeMatch: "netflix",
  });
  await createSubscription(ctx, {
    ...base,
    categoryId: streaming?.id ?? null,
    name: "Spotify",
    utility: 9,
    priceCents: 1099n,
    cycle: "monthly",
    nextChargeOn: on,
    payeeMatch: "spotify",
  });
  await createSubscription(ctx, {
    ...base,
    name: "Amazon Prime",
    utility: 4,
    priceCents: 4990n,
    cycle: "yearly",
    nextChargeOn: addDays(on, 3),
    payeeMatch: "amazon",
  });
}
