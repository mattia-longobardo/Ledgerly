import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { createAccount } from "../accounts/service";
import type { Ctx } from "../../platform/context";
import { closeDatabase, resetDatabase } from "../../../../../test/db";
import { newContext } from "../../../../../test/fixtures";
import { csvMapOf, importCsv, saveCsvMap } from "./service/csv";
import { listTransactions } from "./queries";
import { TransactionError } from "./service";
import { createCategory } from "./taxonomy";

// The import of a CSV file on the test database (decision ST-8): the rows become manual movements
// with the key of the file, a category the file names is the person's, and a map is the person's.

const MAP = {
  columns: { date: 0, amount: 2, debit: null, credit: null, payee: 1, note: 3, category: 4 },
  delimiter: ",",
  decimalSeparator: ".",
  dateFormat: "YYYY-MM-DD",
  skipRows: 0,
  header: false,
};

const bytes = (text: string) => new TextEncoder().encode(text);

let alice: Ctx;
let bob: Ctx;

beforeEach(async () => {
  await resetDatabase();
  alice = await newContext();
  bob = await newContext();
});

afterAll(closeDatabase);

describe("the import of a CSV file", () => {
  it("writes manual movements with the file's key, and the person's category of the name written", async () => {
    const account = await createAccount(alice, { name: "Cash", type: "cash" });
    const food = await createCategory(alice, { name: "Food", type: "expense", parentId: null });
    const file =
      '2026-02-10,"Bar, corner",-4.50,coffee,food\n2026-02-11,Shop,-10,,Unknown\n2026-02-12,Pay,20,,Food\n';
    const done = await importCsv(alice, account.id, bytes(file), MAP);
    expect(done).toEqual({ created: 3, duplicates: 0, refused: [] });
    const rows = await listTransactions(alice, { accountIds: [account.id] });
    const byPayee = new Map(rows.map((row) => [row.payee, row]));
    expect(byPayee.get("Bar, corner")).toMatchObject({
      origin: "manual",
      amountCents: -450n,
      note: "coffee",
      categoryId: food.id,
    });
    // An unknown name, and a name of a category of the other type, leave the movement to the cascade.
    expect(byPayee.get("Shop")?.categoryId).toBeNull();
    expect(byPayee.get("Pay")?.categoryId).toBeNull();
    expect((await importCsv(alice, account.id, bytes(file), MAP)).created).toBe(0);
  });

  it("keeps a map per person: another person's account is not theirs to map", async () => {
    const account = await createAccount(alice, { name: "Cash", type: "cash" });
    await saveCsvMap(alice, account.id, MAP);
    expect(await csvMapOf(alice, account.id)).toEqual(MAP);
    expect(await csvMapOf(bob, account.id)).toBeNull();
    await expect(saveCsvMap(bob, account.id, MAP)).rejects.toThrow(TransactionError);
    await expect(importCsv(bob, account.id, bytes("2026-02-10,x,-1\n"), MAP)).rejects.toThrow(
      TransactionError,
    );
    expect(await csvMapOf(alice, account.id)).toEqual(MAP);
  });
});
