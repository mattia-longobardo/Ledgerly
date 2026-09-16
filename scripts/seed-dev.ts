// scripts/seed-dev.ts — local development data. Idempotent. Later phases add their sample data here.
import { eq } from "drizzle-orm";
import { accounts, balanceEntries } from "../src/modules/accounts/schema";
import { createAuth } from "../src/platform/auth/auth";
import { users } from "../src/platform/auth/schema";
import type { Ctx } from "../src/platform/context";
import { addMonths, lastDayOfMonth, monthKey, today } from "../src/platform/dates";
import { getDb, getPool } from "../src/platform/db/client";
import { userScoped } from "../src/platform/db/scope";
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

await getPool().end();
