// The parity of a reading (rewrite plan R5c, criterion "parità dei movimenti dopo una sync dal
// plugin"): one whole pass of the engine on the fixtures of `test/fixtures/wallet/`, and every row
// it leaves, held to `parity-golden.json`. The golden was written by the engine on its own HTTP
// client, before the engine read through the plugin; the same pass, read through the real plugin
// served in-process and reached by the port as the application wires it, leaves exactly it.
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { sql } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { openSource, sourceCalls } from "@plugin-host/source";
import { PLUGIN, stubWallet, toPlugin } from "../../../../../../test/fixtures/wallet/served-plugin";
import { closeDatabase, resetDatabase } from "../../../../../../test/db";
import { createTestUser } from "../../../../../../test/users";
import type { Ctx } from "../../context";
import { getDb } from "../../db/client";
import { addDays } from "../../../shared/dates";
import { WALLET_PROVIDER } from "../rules";
import { saveConnection } from "../service";
import { wireSource } from "./calls";
import { syncWalletNow } from "./sync";

const FIXTURES = join(process.cwd(), "test/fixtures/wallet");
const GOLDEN = join(FIXTURES, "parity-golden.json");
const fixture = (name: string): { [key: string]: unknown } =>
  JSON.parse(readFileSync(join(FIXTURES, name), "utf8"));
type Wire = { id: string; recordDate: string; [key: string]: unknown };
type WireAccount = { id: string; [key: string]: unknown };

const NOW = new Date("2026-01-06T08:07:00Z");
const TOKEN = "parity-token-5d2e9a";

/** Two numbers on the accounts: an IBAN, kept, and another kind of number, not kept. */
const ACCOUNTS = (fixture("accounts.json").accounts as WireAccount[]).map((account) =>
  account.id === "wa-general"
    ? { ...account, bankAccountNumber: "IT60 X054 2811 1010 0000 0123 456" }
    : account.id === "wa-cash"
      ? { ...account, bankAccountNumber: "0042-1234" }
      : account,
);

/** Wallet's list, with its built-in Transfer category and a custom one under a base category. */
const CATEGORIES = [
  ...((fixture("categories.json").categories as Wire[]) ?? []),
  { id: "wc-transfer", name: "Trasferimento", group: null, systemId: "system_categories__transfer" },
  {
    id: "wc-bar",
    name: "Bar",
    group: { id: "wcg-casa", name: "Casa" },
    customCategory: true,
    parentId: "wc-groceries",
  },
  { id: "wc-old", name: "Vecchia", group: null, archived: true },
];

function record(id: string, accountId: string, recordDate: string, value: number, extra: object = {}): Wire {
  return {
    id,
    accountId,
    amount: { value, currencyCode: "EUR" },
    recordDate,
    category: null,
    labels: [],
    recordType: "expense",
    recordState: "cleared",
    note: null,
    counterParty: null,
    transfer: null,
    updatedAt: null,
    ...extra,
  };
}

/** The fixtures' movements, and what they leave out: a group, labels, a marker, a pair, a pending one. */
const RECORDS: Wire[] = [
  ...(fixture("records-january-first-half.json").records as Wire[]),
  ...(fixture("records-january-third-quarter.json").records as Wire[]),
  ...(fixture("records-january-fourth-quarter.json").records as Wire[]),
  ...(fixture("records-edge-cases.json").records as Wire[]),
  ...(fixture("records-single-day-truncated.json").records as Wire[]),
  record("wr-9001", "wa-cash", "2025-12-10", -12.5, {
    category: { id: "wc-transfer", name: "Trasferimento", group: null },
  }),
  record("wr-9002", "wa-general", "2025-11-03T09:15:00.000Z", 42.1, {
    category: { id: "wc-salary", name: "Stipendio", group: { id: "wcg-lavoro", name: "Lavoro" } },
    labels: ["bonus", { name: " premi " }],
    note: "premio\nledgerly-movement:abcd1234-ef",
    recordType: "Deposit",
    recordState: "Reconciled",
    counterParty: "  ACME  ",
  }),
  record("wr-9003", "wa-general", "2025-11-04", -20, {
    category: { id: "wc-giro", name: "Giroconto", group: null, systemId: "system_categories__transfer" },
    transfer: { type: "withdrawal", mirrorRecord: { id: "wr-9004", accountId: "wa-saving" } },
    recordType: "transfer",
  }),
  record("wr-9004", "wa-saving", "2025-11-04", 20, {
    transfer: { type: "deposit", mirrorRecord: { id: "wr-9003", accountId: "wa-general" } },
    recordType: "transfer",
  }),
  record("wr-9005", "wa-general", "2025-10-01", -3, {
    category: { id: "wc-bar", name: "Bar", group: { id: "wcg-casa", name: "Casa" } },
    recordType: "weird",
    recordState: "Planned",
    counterParty: "Bar Sport",
  }),
];

/** Wallet, as far as a reader can tell: `/records` filtered by the window it was asked for. */
async function walletFetch(input: string | URL | Request): Promise<Response> {
  const url = new URL(String(input));
  if (url.pathname.endsWith("/accounts")) return Response.json({ accounts: ACCOUNTS });
  if (url.pathname.endsWith("/categories")) return Response.json({ categories: CATEGORIES });
  const bounds = url.searchParams.getAll("recordDate");
  const from = bounds.find((one) => one.startsWith("gte."))?.slice(4) ?? "";
  const to = bounds.find((one) => one.startsWith("lte."))?.slice(4) ?? "";
  return Response.json({
    records: RECORDS.filter(
      (row) => row.recordDate.slice(0, 10) >= from && row.recordDate.slice(0, 10) <= to,
    ),
    appliedRecordDateFilters: [`gte.${from}T00:00:00.000Z`, `lt.${addDays(to, 1)}T00:00:00.000Z`],
  });
}

/** The rows a pass writes, table by table, and how each table finds the person's rows. */
const TABLES: Record<string, string> = {
  accounts: "user_id = $USER",
  balance_entries: "account_id in (select id from accounts where user_id = $USER)",
  transactions: "user_id = $USER",
  labels: "user_id = $USER",
  transaction_labels: "transaction_id in (select id from transactions where user_id = $USER)",
  categories: "user_id = $USER",
  source_categories: "user_id = $USER",
  provider_links: "user_id = $USER",
  integration_connections: "user_id = $USER",
  sync_jobs: "connection_id in (select id from integration_connections where user_id = $USER)",
  sync_runs: "connection_id in (select id from integration_connections where user_id = $USER)",
};
/** What only the run itself decides: sealed credentials, and the stamps of the database's clock. */
const DROPPED = new Set(["credentials", "credentials_iv", "credentials_tag", "key_version"]);
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/** A `timestamptz` as the driver gives it in a raw query: text. */
const STAMP = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}(\.\d+)?\+00$/;

type Row = Record<string, unknown>;

/** A value with no id and no clock of this run: what two runs of the same pass must agree on. */
function plain(value: unknown, started: number, ids: ReadonlyMap<string, string>): unknown {
  if (typeof value === "string" && STAMP.test(value)) {
    return Date.parse(value.replace(" ", "T").replace("+00", "Z")) >= started ? "<now>" : value;
  }
  if (typeof value === "string" && UUID.test(value)) return ids.get(value) ?? "<id>";
  if (typeof value === "bigint") return value.toString();
  if (Array.isArray(value)) return value.map((one) => plain(one, started, ids));
  if (value !== null && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Row)
        .filter(([key]) => !DROPPED.has(key))
        .map(([key, one]) => [key, plain(one, started, ids)]),
    );
  }
  return value;
}

/**
 * Every table's rows with ids named by position and the stamps of this run's clock left out. The
 * position comes from the row with every id blanked, so it is the same whatever ids a run drew.
 */
async function snapshot(userId: string, started: number): Promise<Record<string, unknown[]>> {
  const raw: Record<string, Row[]> = {};
  for (const [table, where] of Object.entries(TABLES)) {
    const query = `select * from ${table} where ${where.replaceAll("$USER", `'${userId}'`)}`;
    const rows = (await getDb().execute(sql.raw(query))).rows as Row[];
    const blank = (row: Row) => JSON.stringify(plain(row, started, new Map()));
    raw[table] = rows.sort((left, right) => blank(left).localeCompare(blank(right)));
  }
  const ids = new Map<string, string>([[userId, "user"]]);
  for (const [table, rows] of Object.entries(raw)) {
    rows.forEach((row, index) => {
      if (typeof row.id === "string") ids.set(row.id, `${table}#${index}`);
    });
  }
  return Object.fromEntries(
    Object.entries(raw).map(([table, rows]) => [table, rows.map((row) => plain(row, started, ids))]),
  );
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

describe("a pass of the source on the fixtures", () => {
  // The port as `wireDomain` wires it, with the configured plugin pointing at the served one.
  beforeAll(() => {
    wireSource({
      open: (pluginId, credentials) => sourceCalls({ ...PLUGIN, id: pluginId }, credentials, toPlugin),
    });
    stubWallet(TOKEN, async (input) => walletFetch(input));
  });
  beforeEach(resetDatabase);
  afterAll(async () => {
    wireSource({ open: openSource });
    await closeDatabase();
  });

  it("leaves exactly the rows of the golden", async () => {
    const started = Date.now();
    const ctx = contextFor((await createTestUser()).id);
    const connection = await saveConnection(ctx, {
      provider: WALLET_PROVIDER,
      credentials: { token: TOKEN },
    });

    const result = await syncWalletNow(ctx, connection.id, { now: NOW });
    const rows = { result, ...(await snapshot(ctx.userId, started)) };

    const text = `${JSON.stringify(rows, null, 2)}\n`;
    if (!existsSync(GOLDEN)) {
      writeFileSync(GOLDEN, text);
      throw new Error(`no golden: written to ${GOLDEN}, check it and commit it`);
    }
    expect(JSON.parse(text)).toEqual(JSON.parse(readFileSync(GOLDEN, "utf8")));
  });
});
