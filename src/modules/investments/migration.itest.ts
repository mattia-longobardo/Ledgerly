// Migration 0037 (docs/design/investments.md §2.3, §7 phase 2): the data part replayed on legacy
// rows — platforms become accounts with their history as events, existing investment accounts are
// handed over, a fund's account stays in `funds` — and the `portfolio` points the SQL writes are the
// ones the engine rebuilds. Then the legacy tables refuse every write.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { listBalanceEntries } from "@/modules/accounts/queries";
import { createAccount, saveBalanceEntry } from "@/modules/accounts/service";
import { createFund } from "@/modules/funds/service";
import type { Ctx } from "@/platform/context";
import { addDays, today } from "@/platform/dates";
import { getPool } from "@/platform/db/client";
import { closeDatabase, resetDatabase } from "../../../test/db";
import { createTestUser } from "../../../test/users";
import { rebuildAll } from "./service";

const LEGACY = ["investment_platforms", "investment_movements", "investment_valuations"];

/** The statements of 0037 from the data marker to the trigger, as the migrator runs them. */
function dataStatements(): string[] {
  const file = readFileSync(join(process.cwd(), "drizzle/0037_investments_v2.sql"), "utf8");
  const start = file.indexOf("-- ——— Data");
  const end = file.indexOf('CREATE FUNCTION "investments_legacy_read_only"');
  return file
    .slice(start, end)
    .split("--> statement-breakpoint")
    .map((statement) => statement.trim())
    .filter((statement) => statement.replace(/--.*$/gm, "").trim() !== "");
}

function contextFor(userId: string): Ctx {
  return {
    userId,
    role: "user",
    locale: "en",
    timeZone: "Europe/Rome",
    numberFormat: "it-IT",
    displayCurrency: "EUR",
  };
}

let ctx: Ctx;
let todayOn: string;

beforeEach(async () => {
  await resetDatabase();
  ctx = contextFor((await createTestUser()).id);
  todayOn = today(ctx.timeZone);
});

afterAll(closeDatabase);

async function seedLegacy(): Promise<void> {
  const client = await getPool().connect();
  try {
    for (const table of LEGACY) await client.query(`ALTER TABLE ${table} DISABLE TRIGGER USER`);
    const platform = async (name: string, url: string) =>
      (
        await client.query<{ id: string }>(
          "INSERT INTO investment_platforms (user_id, name, url, created_at) VALUES ($1, $2, $3, '2026-10-01') RETURNING id",
          [ctx.userId, name, url],
        )
      ).rows[0].id;
    const movement = (
      platformId: string,
      kind: string,
      cents: number,
      on: string,
      note: string | null = null,
    ) =>
      client.query(
        'INSERT INTO investment_movements (user_id, platform_id, kind, amount_cents, "on", note) VALUES ($1, $2, $3, $4, $5, $6)',
        [ctx.userId, platformId, kind, cents, on, note],
      );
    const valuation = (platformId: string, cents: number, on: string) =>
      client.query(
        'INSERT INTO investment_valuations (user_id, platform_id, value_cents, "on") VALUES ($1, $2, $3, $4)',
        [ctx.userId, platformId, cents, on],
      );
    const binance = await platform("Binance", "https://www.binance.com/en");
    await movement(binance, "deposit", 280000, "2025-12-24");
    await movement(binance, "deposit", 70000, "2026-01-03");
    await movement(binance, "withdrawal", 186110, "2026-05-19", "back to the bank");
    await valuation(binance, 0, "2026-09-23");
    const etoro = await platform("eToro", "https://www.etoro.com/login");
    await movement(etoro, "deposit", 200000, "2026-06-11");
    await movement(etoro, "withdrawal", 240158, "2026-06-16");
    await valuation(etoro, 50000, "2026-07-01");
    await movement(etoro, "deposit", 10000, "2026-07-01");
    await movement(etoro, "deposit", 10000, "2026-08-01");
  } finally {
    for (const table of LEGACY) await client.query(`ALTER TABLE ${table} ENABLE TRIGGER USER`);
    client.release();
  }
}

async function runDataPart(): Promise<void> {
  const client = await getPool().connect();
  try {
    await client.query("BEGIN");
    for (const statement of dataStatements()) await client.query(statement);
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

async function portfolio(accountId: string) {
  return (await listBalanceEntries(ctx, accountId, 1000))
    .filter((row) => row.source === "portfolio")
    .map((row) => [row.on, row.balanceCents] as const)
    .sort((a, b) => (a[0] < b[0] ? -1 : 1));
}

const query = async <T extends object>(text: string, values: unknown[] = []) =>
  (await getPool().query<T & Record<string, unknown>>(text, values)).rows;

describe("0037 data part", () => {
  it("turns platforms into accounts, hands over investment accounts and leaves funds alone", async () => {
    await seedLegacy();
    const fund = await createFund(ctx, {
      name: "Fideuram",
      provider: null,
      isin: null,
      compartment: null,
      debitAccountId: null,
      debitDay: null,
      ter: null,
      startOn: "2026-01-01",
      monthlyCents: null,
      depositFeeCents: null,
      valuationAccountId: null,
    });
    const fineco = await createAccount(ctx, {
      name: "Fineco",
      type: "investment",
      currency: "EUR",
      color: null,
      reference: "",
      purpose: "",
      openedOn: null,
      notes: "",
      openingBalance: null,
    });
    await saveBalanceEntry(ctx, fineco.id, { on: addDays(todayOn, -20), cents: 400000n });
    await saveBalanceEntry(ctx, fineco.id, { on: todayOn, cents: 450000n });

    await runDataPart();

    const services = await query<{
      account_id: string;
      name: string;
      type: string;
      category: string;
      managed_since: string;
      url: string | null;
      legacy: boolean;
    }>(
      `SELECT ia.account_id, a.name, a.type, ia.category, to_char(ia.managed_since, 'YYYY-MM-DD') AS managed_since,
              ia.url, ia.legacy_platform_id IS NOT NULL AS legacy
       FROM investment_accounts ia JOIN accounts a ON a.id = ia.account_id ORDER BY a.name`,
    );
    expect(
      services.map(({ name, type, category, managed_since, url, legacy }) => ({
        name,
        type,
        category,
        managed_since,
        url,
        legacy,
      })),
    ).toEqual([
      {
        name: "Binance",
        type: "crypto",
        category: "crypto",
        managed_since: "2025-12-24",
        url: "https://www.binance.com/en",
        legacy: true,
      },
      {
        name: "eToro",
        type: "investment",
        category: "broker",
        managed_since: "2026-06-11",
        url: "https://www.etoro.com/login",
        legacy: true,
      },
      {
        name: "Fineco",
        type: "investment",
        category: "broker",
        managed_since: todayOn,
        url: null,
        legacy: false,
      },
    ]);
    expect(services.some((one) => one.account_id === fund.valuationAccountId)).toBe(false);

    const events = await query<{ name: string; kinds: string }>(
      `SELECT a.name, string_agg(o.kind || ':' || o.amount_cents, ',' ORDER BY e.on, e.occurred_at, e.seq) AS kinds
       FROM investment_events e JOIN investment_operations o ON o.event_id = e.id
       JOIN investment_accounts ia ON ia.id = e.investment_account_id JOIN accounts a ON a.id = ia.account_id
       GROUP BY a.name ORDER BY a.name`,
    );
    expect(events).toEqual([
      { name: "Binance", kinds: "deposit:280000,deposit:70000,withdrawal:-186110,account_valuation:0" },
      {
        name: "eToro",
        kinds: "deposit:200000,withdrawal:-240158,deposit:10000,account_valuation:50000,deposit:10000",
      },
      { name: "Fineco", kinds: "account_valuation:450000" },
    ]);

    // The handover archived the entry of T and kept the one before.
    const archived = await query<{ on: string; cents: string }>(
      `SELECT to_char("on", 'YYYY-MM-DD') AS on, balance_cents::text AS cents FROM investment_superseded_entries WHERE account_id = $1`,
      [fineco.id],
    );
    expect(archived).toEqual([{ on: todayOn, cents: "450000" }]);

    const byName = new Map(services.map((one) => [one.name, one.account_id]));
    const etoro = new Map(await portfolio(byName.get("eToro") as string));
    // Unknown before the first valuation; a valuation is the end of its day; never below zero.
    expect(etoro.has("2026-06-11")).toBe(false);
    expect(etoro.has("2026-06-30")).toBe(false);
    expect(etoro.get("2026-07-01")).toBe(50000n);
    expect(etoro.get("2026-08-01")).toBe(60000n);
    expect(new Map(await portfolio(byName.get("Binance") as string)).get("2026-09-23")).toBe(0n);
    expect(new Map(await portfolio(fineco.id)).get(todayOn)).toBe(450000n);

    // The fund's valuation account kept its own entries and has no portfolio point.
    expect(await portfolio(fund.valuationAccountId)).toEqual([]);

    // SQL == engine: a full rebuild leaves every point as the migration wrote it.
    for (const accountId of byName.values()) {
      const written = await portfolio(accountId);
      await rebuildAll(ctx, accountId);
      expect(await portfolio(accountId)).toEqual(written);
    }
  });

  it("the legacy tables refuse every write", async () => {
    await seedLegacy();
    const [platform] = await query<{ id: string }>("SELECT id FROM investment_platforms LIMIT 1");
    await expect(
      getPool().query("INSERT INTO investment_platforms (user_id, name) VALUES ($1, 'New')", [ctx.userId]),
    ).rejects.toThrow(/read only/);
    await expect(
      getPool().query("UPDATE investment_platforms SET name = 'X' WHERE id = $1", [platform.id]),
    ).rejects.toThrow(/read only/);
    await expect(getPool().query("DELETE FROM investment_movements")).rejects.toThrow(/read only/);
    await expect(getPool().query("DELETE FROM investment_valuations")).rejects.toThrow(/read only/);
  });
});
