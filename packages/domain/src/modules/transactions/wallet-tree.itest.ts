// The data migrations of the giroconti and of the default tree (0079, 0080), run again on a person
// who started from the 15 old default groups: synthetic names and amounts only. The schema of the
// test database is already migrated, so the two checks the old data breaks are lifted inside the
// test's own transaction, and put back by the migration's own statements — which proves the data
// they leave satisfies them.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { PoolClient } from "pg";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { createAccount } from "../accounts/service";
import type { Ctx } from "../../platform/context";
import { getPool } from "../../platform/db/client";
import { closeDatabase, resetDatabase } from "../../../../../test/db";
import { createTestUser } from "../../../../../test/users";

const statements = (file: string) =>
  readFileSync(join(process.cwd(), "drizzle", file), "utf8")
    .split("--> statement-breakpoint")
    .map((one) => one.trim())
    .filter((one) => one !== "");

/** From the marker `data:giroconti` of 0079 to its end: the data and the checks that follow it. */
const GIROCONTI = (() => {
  const all = statements("0079_giroconti_wallet_tree.sql");
  return all.slice(all.findIndex((one) => one.includes("data:giroconti —")));
})();
const TREE = statements("0080_wallet_category_tree.sql");

/** The 15 old defaults, as `createDefaultGroups` wrote them in Italian until this release. */
const OLD = [
  ["home", "Casa", "expense"],
  ["groceries", "Spesa alimentare", "expense"],
  ["restaurants", "Ristoranti e bar", "expense"],
  ["transport", "Trasporti", "expense"],
  ["health", "Salute", "expense"],
  ["shopping", "Shopping", "expense"],
  ["leisure", "Tempo libero", "expense"],
  ["travel", "Viaggi", "expense"],
  ["subscriptions", "Abbonamenti e servizi", "expense"],
  ["taxes_fees", "Tasse e commissioni", "expense"],
  ["other", "Altro", "expense"],
  ["income", "Lavoro", "income"],
  ["other_income", "Altre entrate", "income"],
  ["savings", "Risparmio", "transfer"],
  ["credit_card", "Carta di credito", "transfer"],
] as const;

let client: PoolClient;
let userId: string;
let accountId: string;
const ids = new Map<string, string>();

async function q<T extends Record<string, unknown>>(text: string, values: unknown[] = []): Promise<T[]> {
  return (await client.query<T>(text, values)).rows;
}

async function movement(categoryKey: string | null, type: string, amount: number, marker = false) {
  const [row] = await q<{ id: string }>(
    `insert into transactions (user_id, account_id, occurred_at, amount_cents, type, category_id, category_origin, locally_edited)
     values ($1, $2, '2026-11-20T11:00:00Z', $3, $4, $5, $6, $7) returning id`,
    [
      userId,
      accountId,
      amount,
      type,
      categoryKey === null ? null : ids.get(categoryKey),
      categoryKey === null ? null : "user",
      marker ? ["categoryId", "type"] : [],
    ],
  );
  return row.id;
}

beforeEach(async () => {
  await resetDatabase();
  userId = (await createTestUser()).id;
  const ctx: Ctx = {
    userId,
    role: "user",
    locale: "it",
    timeZone: "Europe/Rome",
    numberFormat: "it-IT",
    displayCurrency: "EUR",
  };
  accountId = (
    await createAccount(ctx, {
      name: "Conto",
      type: "checking",
      currency: "EUR",
      color: null,
      reference: "",
      iban: "",
      purpose: "",
      openedOn: null,
      notes: "",
      openingBalance: null,
    })
  ).id;
  client = await getPool().connect();
  await client.query("begin");
  // The data as the old image wrote it: categories of Transfers, giroconti filed under them.
  await client.query('alter table "categories" drop constraint "categories_type_ck"');
  await client.query('alter table "transactions" drop constraint "transactions_transfer_category_ck"');
  await client.query('alter table "transactions" drop constraint "transactions_transfer_outside_ck"');
  ids.clear();
  for (const [key, name, type] of OLD) {
    const [row] = await q<{ id: string }>(
      "insert into categories (user_id, name, type) values ($1, $2, $3) returning id",
      [userId, name, type],
    );
    ids.set(key, row.id);
    await q("insert into category_group_marks (category_id, user_id, group_key) values ($1, $2, $3)", [
      row.id,
      userId,
      key,
    ]);
  }
  // Two the person made their own: one renamed, one of their own.
  await q("update categories set name = 'Viaggetti' where id = $1", [ids.get("travel")]);
  const [mine] = await q<{ id: string }>(
    "insert into categories (user_id, name, type) values ($1, 'Mia', 'expense') returning id",
    [userId],
  );
  ids.set("mine", mine.id);
});

afterAll(async () => {
  await closeDatabase();
});

async function run(list: readonly string[]): Promise<void> {
  for (const statement of list) await client.query(statement);
}

describe("the migration of the giroconti and of the default tree (1A, 10A)", () => {
  it("moves the old defaults into the tree, keeps every category of a movement, and frees the giroconti", async () => {
    const groceries = await movement("groceries", "expense", -1_000);
    const work = await movement("income", "income", 200_000);
    const trip = await movement("travel", "expense", -30_000);
    const own = await movement("mine", "expense", -500);
    const saved = await movement("savings", "transfer", -25_100, true);
    try {
      await run(GIROCONTI);
      await run(TREE);
      const categoryOf = async (id: string) =>
        (
          await q<{ category_id: string | null; type: string; locally_edited: string[] }>(
            "select category_id, type, locally_edited from transactions where id = $1",
            [id],
          )
        )[0];
      // No movement loses its category, the giroconto excepted.
      expect((await categoryOf(groceries)).category_id).toBe(ids.get("groceries"));
      expect((await categoryOf(work)).category_id).toBe(ids.get("income"));
      expect((await categoryOf(trip)).category_id).toBe(ids.get("travel"));
      expect((await categoryOf(own)).category_id).toBe(ids.get("mine"));
      expect(await categoryOf(saved)).toMatchObject({ category_id: null, type: "transfer" });
      expect((await categoryOf(saved)).locally_edited).toContain("type");

      const treeOf = () =>
        q<{ id: string; name: string; type: string; parent: string | null; color: string | null }>(
          `select c.id, c.name, c.type, p.name as parent, c.color, c.archived_at
           from categories c left join categories p on p.id = c.parent_id
           where c.user_id = $1 order by c.name, p.name`,
          [userId],
        );
      const tree = await treeOf();
      // Nothing is archived: what is gone is deleted, what moves keeps its row.
      expect(tree.filter((one) => (one as { archived_at?: Date | null }).archived_at !== null)).toEqual([]);
      const named = (name: string, parent: string | null) =>
        tree.find((one) => one.name === name && one.parent === parent);
      // The categories of Transfers are gone.
      expect(tree.filter((one) => one.type === "transfer")).toEqual([]);
      expect(named("Risparmio", null)).toBeUndefined();
      // An old default is renamed and moved, with the same id: its movements follow it.
      expect(named("Spesa alimentare", "Cibo e bevande")?.id).toBe(ids.get("groceries"));
      expect(named("Stipendio, fatture", "Entrate")?.id).toBe(ids.get("income"));
      expect(named("Entrate", null)?.id).toBe(ids.get("other_income"));
      expect(named("Comunicazioni, PC", null)?.id).toBe(ids.get("subscriptions"));
      expect(named("Sanità, medico", "Vita e svago")?.id).toBe(ids.get("health"));
      // A group gets its colour; a group of Wallet's tree the person did not have is created.
      expect(named("Cibo e bevande", null)?.color).toBe("#ed4a49");
      expect(named("Investimenti", null)?.type).toBe("expense");
      expect(named("Risparmi", "Investimenti")).toBeDefined();
      // The two the person made their own are left as they are, and the tree is complete beside them.
      expect(named("Viaggetti", null)?.id).toBe(ids.get("travel"));
      expect(named("Mia", null)?.id).toBe(ids.get("mine"));
      expect(named("Vacanze, viaggi, hotel", "Vita e svago")).toBeDefined();
      expect(tree.filter((one) => one.parent === null).map((one) => one.name)).toHaveLength(11 + 2);
      expect(tree.filter((one) => one.parent !== null)).toHaveLength(70);

      const marks = await q<{ group_key: string; category_id: string }>(
        "select group_key, category_id from category_group_marks where user_id = $1",
        [userId],
      );
      expect(marks).toHaveLength(81);
      expect(marks.find((one) => one.category_id === ids.get("travel"))).toBeUndefined();
      expect(marks.filter((one) => one.group_key.startsWith("~old:"))).toEqual([]);

      // Run again, it changes nothing (its temporary tables go at the end of a transaction).
      const before = JSON.stringify(tree);
      await client.query("drop table wallet_tree, wallet_old, wallet_people, wallet_moves");
      await run(TREE);
      expect(JSON.stringify(await treeOf())).toBe(before);
    } finally {
      await client.query("rollback");
      client.release();
    }
  });

  it("writes the names in the language the old ones were written in", async () => {
    try {
      // The same person in English: the old names as the English image wrote them.
      for (const [key] of OLD) {
        const english: Record<string, string> = {
          groceries: "Groceries",
          income: "Work",
          other_income: "Other income",
        };
        if (english[key])
          await q("update categories set name = $2 where id = $1", [ids.get(key), english[key]]);
      }
      await q(
        "delete from category_group_marks where group_key not in ('groceries', 'income', 'other_income')",
      );
      await q("delete from categories where type = 'transfer'");
      await run(GIROCONTI);
      await run(TREE);
      const names = await q<{ name: string }>(
        "select c.name from categories c where c.user_id = $1 and c.parent_id is null order by c.name",
        [userId],
      );
      expect(names.map((one) => one.name)).toContain("Food & Drinks");
      expect(names.map((one) => one.name)).toContain("Income");
      expect(names.map((one) => one.name)).not.toContain("Cibo e bevande");
    } finally {
      await client.query("rollback");
      client.release();
    }
  });
});
