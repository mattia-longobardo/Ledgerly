import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { applyProviderAccounts } from "../../accounts/service";
import { listAccounts } from "../../accounts/queries";
import type { Ctx } from "../../../platform/context";
import { getDb } from "../../../platform/db/client";
import { closeDatabase, resetDatabase } from "../../../../../../test/db";
import { createTestUser } from "../../../../../../test/users";
import { getTransaction, listTransactions } from "../queries";
import type { IncomingTransaction } from "../rules";
import { categoryLabels, categoryModels } from "../schema";
import { chooseTransferSide, setCategory, upsertFromProvider } from "../service";
import { listCategories } from "../taxonomy";
import { createDefaultGroups } from "./review";
import { importCategoryLabels } from "../service/category-labels";
import { categorise, suggestionsFor, suggestionsForMovement } from "./service";
import { DEFAULT_GROUPS } from "./tables";

// PERS-634: the labels of an export, and the cascade learning from every correction — the memory
// and the classifier — in the same process, with nothing restarted. The texts are invented.

const ctxOf = (userId: string): Ctx => ({
  userId,
  role: "user",
  locale: "en",
  timeZone: "Europe/Rome",
  numberFormat: "it-IT",
  displayCurrency: "EUR",
});

const BANK = "plugin:testbank";
const HEADER =
  "account;category;currency;amount;ref_currency_amount;type;payment_type;note;date;transfer;payee;labels";

/** One row of an export, as the app the person used before writes it. */
const row = (
  category: string,
  note: string,
  day: number,
  amount = "10.00",
  type = "Expense",
  transfer = "false",
) =>
  `Cash;${category};EUR;${amount};${amount};${type};Transfer;${note};2026-03-${String(day).padStart(2, "0")}T10:00:00.000Z;${transfer};;`;

/** Enough labelled history for the classifier: five shops in each of four categories, three times each. */
function history(): string {
  const shops: Record<string, string[]> = {
    Groceries: ["Mercato Alfa", "Superstore Beta", "Alimentari Gamma", "Bottega Delta", "Emporio Phi"],
    "Restaurant, fast-food": [
      "Trattoria Zeta",
      "Pizzeria Eta",
      "Osteria Het",
      "Bistrot Kaf",
      "Taverna Lamed",
    ],
    Fuel: ["Carburanti Kappa", "Benzina Mem", "Stazione Nun", "Gasolio Samekh", "Distributore Ayin"],
    "Bar, cafe": ["Bar Epsilon", "Caffe Pe", "Bar Tsadi", "Caffetteria Qof", "Bar Resh"],
  };
  const rows: string[] = [];
  let day = 1;
  for (const [category, names] of Object.entries(shops)) {
    for (const name of names) {
      for (let time = 0; time < 3; time += 1) {
        rows.push(
          row(category, `PAGAMENTO POS ${name.toUpperCase()} CARTA XXXX ${1000 + day}`, (day % 27) + 1),
        );
        day += 1;
      }
    }
  }
  return [HEADER, ...rows].join("\n");
}

const file = (text: string) => new TextEncoder().encode(text);

let serial = 0;
function incoming(payee: string, day: number): IncomingTransaction {
  serial += 1;
  return {
    externalId: `ext-${serial}`,
    counterpartExternalId: null,
    occurredAt: new Date(Date.UTC(2026, 9, day, 11)),
    amountCents: -1_234n,
    currency: "EUR",
    type: "expense",
    state: "cleared",
    payee,
    note: null,
    categoryExternalId: null,
    categoryName: null,
    categoryGroupExternalId: null,
    categoryGroupName: null,
    labels: [],
  };
}

async function person() {
  const ctx = ctxOf((await createTestUser()).id);
  await createDefaultGroups(
    ctx,
    DEFAULT_GROUPS.map((group) => group.key),
    "en",
  );
  await applyProviderAccounts(ctx, BANK, [
    { provider: BANK, providerAccountId: "zeta-1", name: "Zeta current", type: "checking", currency: "EUR" },
  ]);
  const bank = (await listAccounts(ctx)).find((one) => one.name === "Zeta current")!.id;
  const named = new Map((await listCategories(ctx)).map((category) => [category.name, category.id]));
  return { ctx, bank, id: (name: string) => named.get(name)! };
}

/** A new movement of the bank, read by a pass of the cascade as the worker runs it. */
async function arrives(ctx: Ctx, bank: string, payee: string, day: number) {
  await upsertFromProvider(ctx, bank, [incoming(payee, day)], { provider: BANK });
  await categorise(ctx, [bank]);
  const [row] = (await listTransactions(ctx, { includeHidden: true })).filter((one) => one.payee === payee);
  return (await getTransaction(ctx, row.id))!;
}

/** A row of the export of 12.34 spent at a grocer's, as `incoming` spends it. */
const payment = (date: string) =>
  `Cash;Groceries;EUR;12.34;12.34;Expense;Transfer;MERCATO ALFA;${date};false;;`;

/** The person's one movement with this payee. */
async function movement(ctx: Ctx, payee: string) {
  const [row] = (await listTransactions(ctx, { includeHidden: true })).filter((one) => one.payee === payee);
  return (await getTransaction(ctx, row.id))!;
}

beforeEach(resetDatabase);
afterAll(closeDatabase);

describe("the labels of an export", () => {
  it("are learnt from with no movement made, and a new import replaces the last", async () => {
    const { ctx, bank, id } = await person();
    const outcome = await importCategoryLabels(
      ctx,
      file(
        [
          history(),
          row("Fuel", "GIROCONTO", 2, "50.00", "Expense", "true"),
          row("Unknown", "NOTHING", 3),
          row("Not a category here", "SOMETHING", 4),
          row("Wage, invoices", "DATORE VAV", 5, "100.00", "Income"),
        ].join("\n"),
      ),
    );
    expect(outcome).toEqual({
      imported: 61,
      categorised: 0,
      keptByHand: 0,
      ambiguous: 0,
      transfers: 1,
      unknown: 1,
      unreadable: 0,
      unmapped: 1,
    });
    expect(await listTransactions(ctx, { includeHidden: true })).toEqual([]);

    // Learnt: a shop of the export is filed by itself the first time the bank shows it.
    const given = await arrives(ctx, bank, "PAGAMENTO POS MERCATO ALFA MILANO", 10);
    expect(given).toMatchObject({ categoryId: id("Groceries"), categoryOrigin: "memory" });

    const again = await importCategoryLabels(ctx, file([HEADER, row("Fuel", "BENZINA MEM", 1)].join("\n")));
    expect(again?.imported).toBe(1);
    expect(
      await getDb().select().from(categoryLabels).where(eq(categoryLabels.userId, ctx.userId)),
    ).toHaveLength(1);
  });

  it("gives a row's category to its one movement here, as the person's, and keeps the label", async () => {
    const { ctx, bank, id } = await person();
    await upsertFromProvider(ctx, bank, [incoming("Mercato Alfa", 3)], { provider: BANK });
    const other = await person();
    await upsertFromProvider(other.ctx, other.bank, [incoming("Mercato Alfa", 3)], { provider: BANK });
    // Same sign and amount, a day apart: one payment.
    const outcome = await importCategoryLabels(
      ctx,
      file([HEADER, payment("2026-10-04T08:00:00.000Z")].join("\n")),
    );
    expect(outcome).toMatchObject({ imported: 1, categorised: 1, keptByHand: 0, ambiguous: 0 });
    expect(await movement(ctx, "Mercato Alfa")).toMatchObject({
      categoryId: id("Groceries"),
      categoryOrigin: "user",
    });
    // Another person's movement of the same amount and day is never theirs to file.
    expect((await movement(other.ctx, "Mercato Alfa")).categoryId).toBeNull();
    expect(await importCategoryLabels(ctx, file("date;amount\n2026-01-01;1"))).toBeNull();
  });

  it("never changes a category chosen by hand, nor a giroconto", async () => {
    const { ctx, bank, id } = await person();
    await upsertFromProvider(ctx, bank, [incoming("Chosen", 3), incoming("Giro", 20)], { provider: BANK });
    await setCategory(ctx, [(await movement(ctx, "Chosen")).id], id("Bar, cafe"));
    await chooseTransferSide(ctx, (await movement(ctx, "Giro")).id, { kind: "outside" });
    const outcome = await importCategoryLabels(
      ctx,
      file([HEADER, payment("2026-10-04T08:00:00.000Z"), payment("2026-10-20T08:00:00.000Z")].join("\n")),
    );
    expect(outcome).toMatchObject({ imported: 2, categorised: 0, keptByHand: 1, ambiguous: 0 });
    expect(await movement(ctx, "Chosen")).toMatchObject({
      categoryId: id("Bar, cafe"),
      categoryOrigin: "user",
    });
    expect(await movement(ctx, "Giro")).toMatchObject({ type: "transfer", categoryId: null });
  });

  it("gives no category when the match is not the only one, on either side", async () => {
    const { ctx, bank } = await person();
    await upsertFromProvider(ctx, bank, [incoming("One", 3), incoming("Two", 4), incoming("Three", 20)], {
      provider: BANK,
    });
    const outcome = await importCategoryLabels(
      ctx,
      file(
        [
          HEADER,
          // Two movements near one row; then two rows near one movement.
          payment("2026-10-04T08:00:00.000Z"),
          payment("2026-10-19T08:00:00.000Z"),
          payment("2026-10-21T08:00:00.000Z"),
        ].join("\n"),
      ),
    );
    expect(outcome).toMatchObject({ imported: 3, categorised: 0, keptByHand: 0, ambiguous: 3 });
    for (const payee of ["One", "Two", "Three"]) expect((await movement(ctx, payee)).categoryId).toBeNull();
  });

  it("are one person's only", async () => {
    const one = await person();
    const other = await person();
    await importCategoryLabels(one.ctx, file(history()));
    const given = await arrives(other.ctx, other.bank, "PAGAMENTO POS MERCATO ALFA MILANO", 10);
    expect(given.categoryId).toBeNull();
    expect(given.categoryOrigin).toBeNull();
  });
});

describe("a correction (PERS-634, Mattia's condition on 15A)", () => {
  it("changes what the memory gives the next similar movement, at the next pass", async () => {
    const { ctx, bank, id } = await person();
    await importCategoryLabels(ctx, file(history()));
    const first = await arrives(ctx, bank, "PAGAMENTO POS BOTTEGA DELTA MILANO", 10);
    expect(first).toMatchObject({ categoryId: id("Groceries"), categoryOrigin: "memory" });

    // One correction: the last three at this merchant no longer agree, the memory gives nothing.
    await setCategory(ctx, [first.id], id("Restaurant, fast-food"));
    const second = await arrives(ctx, bank, "PAGAMENTO POS BOTTEGA DELTA ROMA", 11);
    expect(second.categoryOrigin).not.toBe("memory");
    expect(second.categoryId).not.toBe(id("Groceries"));

    // Three in a row: the memory gives the new category by itself.
    await setCategory(ctx, [second.id], id("Restaurant, fast-food"));
    const third = await arrives(ctx, bank, "PAGAMENTO POS BOTTEGA DELTA TORINO", 12);
    await setCategory(ctx, [third.id], id("Restaurant, fast-food"));
    const fourth = await arrives(ctx, bank, "PAGAMENTO POS BOTTEGA DELTA NAPOLI", 13);
    expect(fourth).toMatchObject({ categoryId: id("Restaurant, fast-food"), categoryOrigin: "memory" });
  });

  it("trains the classifier again: the next similar text is predicted from the correction", async () => {
    const { ctx, bank, id } = await person();
    await importCategoryLabels(ctx, file(history()));
    await categorise(ctx, [bank]);
    const before = (
      await getDb().select().from(categoryModels).where(eq(categoryModels.userId, ctx.userId))
    )[0];
    const probe = {
      payee: "DROGHERIA OMEGA",
      counterparty: null,
      rawText: null,
      note: null,
      accountId: bank,
      amountCents: -1_234n,
      kind: "expense" as const,
      merchantCategoryCode: null,
      bankTransactionCode: null,
    };
    const unseen = await suggestionsFor(ctx, probe);
    expect(unseen.top[0]).not.toBe(id("Fuel"));

    // A shop never seen, filed by the person under Fuel once.
    const first = await arrives(ctx, bank, "DROGHERIA OMEGA", 10);
    await setCategory(ctx, [first.id], id("Fuel"));
    await categorise(ctx, [bank]);

    const after = (
      await getDb().select().from(categoryModels).where(eq(categoryModels.userId, ctx.userId))
    )[0];
    expect(after.version).toBe(before.version + 1);
    expect(after.examples).toBe(before.examples + 1);
    const learnt = await suggestionsFor(ctx, probe);
    expect(learnt.top[0]).toBe(id("Fuel"));
    // The selector of the movement reads the same.
    expect((await suggestionsForMovement(ctx, first.id))?.top[0]).toBe(id("Fuel"));
  });
});
