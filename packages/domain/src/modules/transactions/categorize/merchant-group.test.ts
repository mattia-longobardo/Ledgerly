import { describe, expect, it } from "vitest";
import { type CascadeMovement, decide, type Knowledge, topCategories } from "./cascade";
import { outOfSample, predictGroup, train } from "./classifier";
import { categoryForName, exportLabels } from "../rules/export-labels";
import { merchantKey } from "./text";
import { groupThresholdFor } from "./thresholds";

// PERS-634: the memory keyed by the merchant, the group when the sub-category is uncertain, the
// selector's top three, and the labels of an export. Invented texts only.

const movement = (payee: string): CascadeMovement => ({
  payee,
  counterparty: null,
  rawText: null,
  note: null,
  accountId: "acc",
  amountCents: -1_000n,
  kind: "expense",
  merchantCategoryCode: null,
  bankTransactionCode: null,
});

describe("the key of the memory", () => {
  it("is the merchant, whatever the bank wrote around it", () => {
    const key = merchantKey(
      movement("PAGAMENTO POS 12,50 EUR DEL 03.11 ORE 12:30 CARTA XXXX 1234 PRESSO MERCATO ALFA MILANO"),
    );
    expect(key).toBe("mercato alfa");
    expect(merchantKey(movement("Pagamento tramite POS Mercato Alfa di Roma carta n. XXXX"))).toBe(key);
    expect(merchantKey(movement("Mercato Alfa"))).toBe(key);
  });

  it("keeps the whole text when it has nothing but the bank's words", () => {
    expect(merchantKey(movement("PAGAMENTO POS"))).toBe("pagamento pos");
    expect(merchantKey(movement(""))).toBe("");
  });
});

/** Two sub-categories of one group that the texts cannot tell apart, and one of another group. */
function ambiguous() {
  const examples = [
    ...Array.from({ length: 25 }, (_, at) => ({ ...movement(`Locale Comune ${at}`), categoryId: "bar" })),
    ...Array.from({ length: 25 }, (_, at) => ({
      ...movement(`Locale Comune ${at}`),
      categoryId: "restaurant",
    })),
    ...Array.from({ length: 25 }, (_, at) => ({ ...movement(`Benzina Uno ${at}`), categoryId: "fuel" })),
  ];
  const group = new Map([
    ["bar", "food"],
    ["restaurant", "food"],
    ["food", "food"],
    ["fuel", "car"],
    ["car", "car"],
  ]);
  const model = train(examples);
  const knowledge: Knowledge = {
    memory: new Map(),
    model,
    thresholds: { automatic: 0.9, suggestion: 0.8 },
    groupCategory: new Map(),
    categoryKind: new Map([...group.keys()].map((id) => [id, "expense"])),
    categoryGroup: group,
    groupThreshold: 0.8,
  };
  return { examples, group, model, knowledge };
}

describe("the group, when the sub-category is uncertain (decision 14A)", () => {
  it("sums the probabilities of a group's categories", () => {
    const { model, group } = ambiguous();
    const found = predictGroup(model!, movement("Locale Comune"), (id) => group.get(id));
    expect(found?.categoryId).toBe("food");
    expect(found?.confidence).toBeGreaterThan(0.9);
  });

  it("is suggested, and the selector's top three are what to choose inside it", () => {
    const { knowledge } = ambiguous();
    expect(decide(movement("Locale Comune"), knowledge)).toEqual({
      kind: "suggestion",
      categoryId: "food",
      reason: "group",
      params: {},
    });
    expect(topCategories(movement("Locale Comune"), knowledge).slice(0, 2).sort()).toEqual([
      "bar",
      "restaurant",
    ]);
  });

  it("is never suggested without its threshold, and the top three keep to the movement's kind", () => {
    const { knowledge } = ambiguous();
    expect(decide(movement("Locale Comune"), { ...knowledge, groupThreshold: null }).kind).toBe("none");
    const income = { ...movement("Locale Comune"), kind: "income" as const };
    expect(topCategories(income, knowledge)).toEqual([]);
  });

  it("has its threshold from the same trials out of sample, read by group", () => {
    const { examples, group } = ambiguous();
    const trials = outOfSample(examples, null, (id) => group.get(id));
    expect(trials).toHaveLength(75);
    expect(trials.every((trial) => trial.group !== undefined)).toBe(true);
    expect(groupThresholdFor(trials)).not.toBeNull();
    expect(groupThresholdFor(trials.map(({ confidence, correct }) => ({ confidence, correct })))).toBeNull();
  });
});

const HEADER =
  "account;category;currency;amount;ref_currency_amount;type;payment_type;note;date;transfer;payee;labels";

describe("the labels of an export", () => {
  it("reads a categorised row as a signed label, and counts what it leaves out", () => {
    const rows = [
      HEADER,
      "Cash;Groceries;EUR;12.50;12.50;Expense;Cash;MERCATO ALFA;2026-03-01T10:00:00.000Z;false;Mercato Alfa;",
      "Cash;Wage, invoices;EUR;100;100;Income;Transfer;DATORE VAV;2026-03-02T10:00:00.000Z;false;;",
      "Cash;Fuel;EUR;50;50;Expense;Transfer;GIROCONTO;2026-03-03T10:00:00.000Z;true;;",
      "Cash;Unknown expense;EUR;5;5;Expense;Cash;X;2026-03-04T10:00:00.000Z;false;;",
      "Cash;Groceries;EUR;abc;abc;Expense;Cash;X;2026-03-05T10:00:00.000Z;false;;",
      "",
    ].map((line) => line.split(";"));
    expect(exportLabels(rows)).toEqual({
      labels: [
        {
          kind: "expense",
          category: "Groceries",
          payee: "Mercato Alfa",
          note: "MERCATO ALFA",
          amountCents: -1250n,
          at: new Date("2026-03-01T10:00:00.000Z"),
        },
        {
          kind: "income",
          category: "Wage, invoices",
          payee: null,
          note: "DATORE VAV",
          amountCents: 10000n,
          at: new Date("2026-03-02T10:00:00.000Z"),
        },
      ],
      transfers: 1,
      unknown: 1,
      unreadable: 1,
    });
  });

  it("reads a date only as ISO 8601 with its zone, or a day alone", () => {
    const at = (date: string) =>
      exportLabels(
        [HEADER, `Cash;Groceries;EUR;1;1;Expense;Cash;X;${date};false;;`].map((line) => line.split(";")),
      );
    expect(at("2026-03-01T10:00:00.000Z")!.labels[0].at).toEqual(new Date("2026-03-01T10:00:00.000Z"));
    expect(at("2026-03-01T11:00:00+01:00")!.labels[0].at).toEqual(new Date("2026-03-01T10:00:00.000Z"));
    expect(at("2026-03-01")!.labels[0].at).toEqual(new Date("2026-03-01T00:00:00.000Z"));
    // A day first would be another day; a time with no zone depends on the server's; 30/02 is no day.
    for (const date of ["05/03/2026", "2026-03-05T10:00:00", "2026-02-30", "2026-13-01", ""]) {
      expect(at(date)).toMatchObject({ labels: [], unreadable: 1 });
    }
  });

  it("is not read from a file whose header lacks a column", () => {
    expect(exportLabels([["date", "amount"]])).toBeNull();
    expect(exportLabels([])).toBeNull();
  });

  it("files a name under the default tree's category of its sign, else the person's only one of that name", () => {
    const tree = new Map([["food_drinks.groceries", "g-1"]]);
    const own = [
      { id: "own-1", name: "Hobby", type: "expense" },
      { id: "own-2", name: "Twice", type: "expense" },
      { id: "own-3", name: "twice", type: "expense" },
    ];
    expect(categoryForName("groceries", "expense", tree, own)).toBe("g-1");
    expect(categoryForName("Spesa alimentare", "expense", tree, own)).toBe("g-1");
    expect(categoryForName("Groceries", "income", tree, own)).toBeNull();
    expect(categoryForName("Hobby", "expense", tree, own)).toBe("own-1");
    expect(categoryForName("Twice", "expense", tree, own)).toBeNull();
  });
});
