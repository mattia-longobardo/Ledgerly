// scripts/seed-dev.ts — local development data. Idempotent. Later phases add their sample data here.
import { eq } from "drizzle-orm";
import { accounts, balanceEntries } from "../src/modules/accounts/schema";
import {
  applyProviderAccounts,
  rebuildDerivedBalances,
  saveProviderBalance,
} from "../src/modules/accounts/service";
import type { IncomingTransaction } from "../src/modules/transactions/rules";
import { upsertFromProvider } from "../src/modules/transactions/service";
import { createAuth } from "../src/platform/auth/auth";
import { users } from "../src/platform/auth/schema";
import type { Ctx } from "../src/platform/context";
import { addMonths, lastDayOfMonth, monthKey, today } from "../src/platform/dates";
import { getDb, getPool } from "../src/platform/db/client";
import { userScoped } from "../src/platform/db/scope";
import { WALLET_PROVIDER } from "../src/platform/integrations/rules";
import { saveConnection } from "../src/platform/integrations/service";
import { ensureBucket } from "../src/platform/storage";

const email = (process.env.DEV_OWNER_EMAIL ?? "owner@example.test").toLowerCase();
const password = process.env.DEV_OWNER_PASSWORD ?? "owner-password-123";

await ensureBucket();
let [owner] = await getDb().select({ id: users.id }).from(users).where(eq(users.email, email));
if (!owner) {
  await createAuth({ withNextCookies: false }).api.createUser({
    body: { email, password, name: "Owner", role: "admin" },
  });
  [owner] = await getDb().select({ id: users.id }).from(users).where(eq(users.email, email));
  console.log(`[seed] created ${email} (password: ${password})`);
} else {
  console.log(`[seed] ${email} already exists`);
}

// Invented figures in the shape of the design's sample accounts: one balance per month-end for the
// last twelve months, so Overview and Accounts have a history to draw.
const SAMPLE = [
  {
    name: "ING Conto Arancio",
    type: "checking",
    liquid: true,
    history: [5400, 5120, 5680, 4950, 5210, 4870, 5330, 5010, 4760, 5180, 5132.95, 4820.55],
  },
  {
    name: "Revolut Main",
    type: "checking",
    liquid: true,
    history: [1800, 2100, 1650, 2300, 1900, 2250, 2050, 1980, 2400, 2120, 2135.15, 2315.4],
  },
  {
    name: "Revolut Saving",
    type: "savings",
    liquid: true,
    history: [13000, 13500, 14000, 14500, 15000, 15500, 16000, 16500, 17000, 17500, 18000, 18500],
  },
  {
    name: "Revolut Holidays",
    type: "savings",
    liquid: true,
    history: [2250, 2500, 2750, 3000, 2050, 2300, 2550, 2800, 3050, 2450, 3000, 3250],
  },
  {
    name: "Fideuram Piano Accumulo",
    type: "investment",
    liquid: false,
    history: [23900, 24050, 24700, 25010, 24880, 25540, 26350, 26720, 27210, 27260, 27527.82, 27940.12],
  },
  {
    name: "Fondo Cometa",
    type: "pension",
    liquid: false,
    history: [0, 0, 0, 540.44, 548.1, 555.2, 1378.6, 1391.9, 1401.3, 2236.4, 2251.05, 2251.05],
  },
] as const;

const ctx: Pick<Ctx, "userId"> = { userId: owner.id };
const [already] = await getDb()
  .select({ id: accounts.id })
  .from(accounts)
  .where(userScoped(ctx).owns(accounts));

if (already) {
  console.log("[seed] accounts already present");
} else {
  const now = today("Europe/Rome");
  const thisMonth = monthKey(now);
  // The current month is still running: its balance is dated today, not at a month end that has
  // not happened yet.
  const dateOf = (month: number, length: number) =>
    month === length - 1 ? now : lastDayOfMonth(addMonths(thisMonth, month - (length - 1)));
  for (const [index, sample] of SAMPLE.entries()) {
    const [account] = await getDb()
      .insert(accounts)
      .values(
        userScoped(ctx).stamp({
          name: sample.name,
          type: sample.type,
          countsAsLiquid: sample.liquid,
          sortOrder: index,
        }),
      )
      .returning({ id: accounts.id });
    await getDb()
      .insert(balanceEntries)
      .values(
        sample.history.map((amount, month) =>
          userScoped(ctx).stamp({
            accountId: account.id,
            on: dateOf(month, sample.history.length),
            balanceCents: BigInt(Math.round(amount * 100)),
            source: "manual" as const,
          }),
        ),
      );
  }
  console.log(`[seed] created ${SAMPLE.length} accounts with twelve months of balances`);
}

/**
 * F2's sample data. Seeded through the services the hourly job uses — a connection, a synced
 * account through `applyProviderAccounts`, movements through `upsertFromProvider` — so the dev
 * instance shows what a real sync produces, provider links included, rather than rows that look
 * right and behave differently. Idempotent: the provider ids are fixed, so running the seed twice
 * updates instead of duplicating.
 */
async function seedExpenses(ctx: Pick<Ctx, "userId">): Promise<void> {
  // The seed has no request behind it, so there is no user preference to read: the sample is
  // written in the zone the app defaults to (spec §4.3).
  const zoned = { ...ctx, timeZone: "Europe/Rome" };
  await saveConnection(ctx, { provider: WALLET_PROVIDER, credentials: { token: "dev-sample-token" } });
  await applyProviderAccounts(ctx, WALLET_PROVIDER, [
    {
      provider: WALLET_PROVIDER,
      providerAccountId: "dev-acc-1",
      name: "ING Conto Arancio",
      type: "checking",
      currency: "EUR",
    },
  ]);
  const [synced] = await getDb()
    .select({ id: accounts.id })
    .from(accounts)
    .where(eq(accounts.providerAccountId, "dev-acc-1"));
  if (!synced) throw new Error("the provider account was not adopted");

  const month = monthKey(today(zoned.timeZone)).slice(0, 7);
  const before = addMonths(monthKey(today(zoned.timeZone)), -1).slice(0, 7);
  const DEV_GROUPS: Record<string, string> = { Abbonamenti: "Svago", Spesa: "Casa", Trasporti: "Mobilità" };
  const movement = (
    id: string,
    on: string,
    cents: bigint,
    payee: string,
    category: string | null,
    counterpart: string | null = null,
  ): IncomingTransaction => ({
    externalId: id,
    counterpartExternalId: counterpart,
    occurredAt: new Date(`${on}T10:00:00Z`),
    amountCents: cents,
    currency: "EUR",
    type: counterpart !== null ? "transfer" : cents < 0n ? "expense" : "income",
    state: "cleared",
    payee,
    note: null,
    categoryExternalId: category === null ? null : `dev-cat-${category.toLowerCase()}`,
    categoryName: category,
    // Wallet's category groups become parents (F2.5), so development shows the two levels.
    categoryGroupExternalId: category === null ? null : `dev-group-${DEV_GROUPS[category].toLowerCase()}`,
    categoryGroupName: category === null ? null : DEV_GROUPS[category],
    labels: [],
  });

  // Invented figures. Netflix three times a month apart is enough for the recurrence rule of §7.2
  // (three occurrences, one interval band, amounts within 10% of the median) to have something to
  // find, and the two transfer legs name each other so the pairing has something to pair.
  const outcome = await upsertFromProvider(zoned, synced.id, [
    movement("dev-tx-1", `${month}-02`, -1299n, "Netflix", "Abbonamenti"),
    movement("dev-tx-2", `${month}-04`, -4550n, "Esselunga", "Spesa"),
    movement("dev-tx-3", `${month}-09`, -2100n, "Trenitalia", "Trasporti"),
    movement("dev-tx-4", `${month}-11`, 210000n, "Stipendio", null),
    movement("dev-tx-5", `${month}-12`, -50000n, "Giroconto", null, "dev-tx-6"),
    movement("dev-tx-6", `${month}-12`, 50000n, "Giroconto", null, "dev-tx-5"),
    movement("dev-tx-7", `${before}-02`, -1299n, "Netflix", "Abbonamenti"),
    movement("dev-tx-8", `${before}-06`, -3890n, "Esselunga", "Spesa"),
  ]);
  console.log(`[seed] ${outcome.created} movements, ${outcome.updated} updated on the synced account`);

  // One reading today, as the hourly sync would take, and the month ends before it rebuilt from the
  // movements (spec §7.1, F2.5): the Overview chart shows them dashed.
  await saveProviderBalance(zoned, synced.id, { on: today(zoned.timeZone), cents: 1_250_000n });
  const rebuilt = await rebuildDerivedBalances(zoned);
  console.log(`[seed] ${rebuilt.written} month ends rebuilt from the movements`);
}

await seedExpenses(ctx);

await getPool().end();
