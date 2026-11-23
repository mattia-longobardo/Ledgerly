// The data of release R5c, step P3a (06-data.md row R5c, decisions H30, H37): Wallet and Trek are
// plugins. The rows are written as the image before the release leaves them — the old names, a day of
// `trek`, a rule that publishes — and the migration's own statements run on them.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { getPool } from "../db/client";
import { closeDatabase, resetDatabase } from "../../../../../test/db";
import { createTestUser } from "../../../../../test/users";

/** The statements of the migration, as the file has them. */
function migration(): string[] {
  const text = readFileSync(join(process.cwd(), "drizzle/0071_plugin_providers.sql"), "utf8");
  return text
    .split("--> statement-breakpoint")
    .map((statement) => statement.trim())
    .filter((statement) => statement !== "");
}

const TABLES = [
  "integration_connections",
  "provider_links",
  "source_categories",
  "source_settings",
  "source_skipped_accounts",
  "accounts",
  "account_switches",
  "leave_days",
  "interest_rules",
] as const;

async function query<T>(sql: string, values: unknown[] = []): Promise<T[]> {
  return (await getPool().query(sql, values)).rows as T[];
}

async function counts(): Promise<Record<string, number>> {
  const entries = await Promise.all(
    TABLES.map(async (table) => {
      const [row] = await query<{ n: number }>(`select count(*)::int as n from ${table}`);
      return [table, row.n] as const;
    }),
  );
  return Object.fromEntries(entries);
}

/** The values of a column, sorted: what the assertions compare. */
async function values(table: string, column: string): Promise<string[]> {
  const rows = await query<{ value: string }>(`select ${column} as value from ${table} order by 1`);
  return rows.map((row) => row.value);
}

/** One person with Wallet and Trek connected, a bank's account, and what each source left. */
async function seedBefore(userId: string, other: string): Promise<void> {
  const connection = async (who: string, provider: string) =>
    (
      await query<{ id: string }>(
        `insert into integration_connections (user_id, provider, credentials) values ($1, $2, '\\x00') returning id`,
        [who, provider],
      )
    )[0].id;
  const wallet = await connection(userId, "wallet");
  await connection(userId, "trek");
  await connection(other, "plugin:enablebanking");
  const account = async (provider: string, external: string) =>
    (
      await query<{ id: string }>(
        `insert into accounts (user_id, name, type, origin, provider, provider_account_id)
         values ($1, $2, 'checking', 'synced', $3, $2) returning id`,
        [userId, external, provider],
      )
    )[0].id;
  const general = await account("wallet", "wa-general");
  await account("plugin:enablebanking", "eb-1");
  await query(
    `insert into provider_links (user_id, provider, entity_type, entity_id, external_id)
     values ($1, 'wallet', 'account', $2, 'wa-general'), ($1, 'wallet', 'transaction', $2, 'wr-1')`,
    [userId, general],
  );
  await query(
    `insert into source_categories (user_id, provider, external_id, name) values ($1, 'wallet', 'wc-1', 'Food')`,
    [userId],
  );
  await query(`insert into source_settings (user_id, provider, schedule) values ($1, 'trek', '{}')`, [
    userId,
  ]);
  await query(
    `insert into source_skipped_accounts (user_id, provider, external_id) values ($1, 'wallet', 'wa-cash')`,
    [userId],
  );
  await query(
    `insert into account_switches (user_id, account_id, from_provider, from_provider_account_id, to_provider,
       to_provider_account_id, connection_id, cut_date)
     values ($1, $2, 'wallet', 'wa-general', 'plugin:enablebanking', 'eb-1', $3, '2026-11-01')`,
    [userId, general, wallet],
  );
  await query(
    `insert into leave_days (user_id, "on", kind, fraction, origin)
     values ($1, '2026-08-10', 'vacation', 1.0, 'trek'), ($1, '2026-08-11', 'vacation', 1.0, 'manual')`,
    [userId],
  );
  await query(
    `insert into interest_rules (user_id, account_id, valid_from, mode)
     values ($1, $2, '2026-01-01', 'post_to_provider'), ($1, $2, '2025-01-01', 'analyze_only')`,
    [userId, general],
  );
}

let alice: string;
let bob: string;

beforeEach(async () => {
  await resetDatabase();
  alice = (await createTestUser()).id;
  bob = (await createTestUser()).id;
  await seedBefore(alice, bob);
});

afterAll(closeDatabase);

describe("the data of R5c P3a (06-data.md, H30, H37)", () => {
  it("renames the providers, turns the plugins on for who has a connection, and keeps every row", async () => {
    const before = await counts();
    for (const statement of migration()) await query(statement);

    expect(await counts()).toEqual(before);
    expect(await values("integration_connections", "provider")).toEqual([
      "plugin:enablebanking",
      "plugin:trek",
      "plugin:wallet",
    ]);
    expect(await values("accounts", "provider")).toEqual(["plugin:enablebanking", "plugin:wallet"]);
    expect(await values("provider_links", "provider")).toEqual(["plugin:wallet", "plugin:wallet"]);
    expect(await values("source_categories", "provider")).toEqual(["plugin:wallet"]);
    expect(await values("source_settings", "provider")).toEqual(["plugin:trek"]);
    expect(await values("source_skipped_accounts", "provider")).toEqual(["plugin:wallet"]);
    expect(await values("account_switches", "from_provider || ' > ' || to_provider")).toEqual([
      "plugin:wallet > plugin:enablebanking",
    ]);
    expect(await values("leave_days", "origin")).toEqual(["external", "manual"]);
    expect(await values("interest_rules", "mode")).toEqual(["analyze_only", "analyze_only"]);
    // H30: on for the person who has a connection, and for nobody else; a bank's plugin is not touched.
    expect(
      await query("select user_id, plugin_id, active from plugin_activations order by plugin_id"),
    ).toEqual([
      { user_id: alice, plugin_id: "trek", active: true },
      { user_id: alice, plugin_id: "wallet", active: true },
    ]);

    // Run twice, it changes nothing more.
    const once = await query("select * from plugin_activations order by plugin_id");
    for (const statement of migration()) await query(statement);
    expect(await query("select * from plugin_activations order by plugin_id")).toEqual(once);
    expect(await counts()).toEqual(before);
  });

  it("leaves a plugin the person already turned off as it is", async () => {
    await query(
      `insert into plugin_activations (user_id, plugin_id, active, deactivated_at) values ($1, 'wallet', false, now())`,
      [alice],
    );
    for (const statement of migration()) await query(statement);
    expect(await query("select plugin_id, active from plugin_activations order by plugin_id")).toEqual([
      { plugin_id: "trek", active: true },
      { plugin_id: "wallet", active: false },
    ]);
  });
});
