import { describe, expect, it } from "vitest";
import {
  HISTORY_ACCOUNT,
  history,
  historyCategoryKinds,
} from "../../../../../../test/fixtures/categories/history";
import { type CascadeMovement, decide, groupCategories, type Knowledge } from "./cascade";
import {
  type Example,
  HOLD_OUT_FROM,
  learnableClasses,
  loadModel,
  MIN_EXAMPLES,
  outOfSample,
  predict,
  storeModel,
  train,
  type Trial,
} from "./classifier";
import { strictMemory } from "./memory";
import { brandGroup, DEFAULT_GROUPS, merchantTypeGroup, structureOf } from "./tables";
import { amountBand, FEATURE_DIMENSIONS, featureCounts, featureIndex, memoryKey, normalise } from "./text";
import { measure, MIN_SUPPORT, thresholdFor, thresholdsFor } from "./thresholds";

const text = (payee: string, amountCents = -1000n) => ({
  payee,
  counterparty: null,
  rawText: null,
  note: null,
  accountId: HISTORY_ACCOUNT,
  amountCents,
});

describe("the text of a movement", () => {
  it("is normalised the same way whatever the case, the accents and the punctuation", () => {
    expect(normalise("  CAFFÈ   «Roma» S.r.l. ")).toBe("caffe roma s r l");
  });

  it("gives one key to a shop written with different numbers", () => {
    expect(memoryKey(text("MERCATO ALFA 0042 12/11"))).toBe(memoryKey(text("Mercato Alfa 17")));
  });

  it("takes the first text a movement has: the payee, then what the bank wrote", () => {
    expect(memoryKey({ payee: " ", counterparty: "Datore Vav", rawText: "x", note: null })).toBe(
      "datore vav",
    );
    expect(memoryKey({ payee: null, counterparty: null, rawText: null, note: null })).toBe("");
  });

  it("puts an amount in a band by its size, whatever its sign", () => {
    expect([100n, -100n, 700n, 4_999n, 5_000n, 200_000n].map(amountBand)).toEqual([0, 0, 1, 2, 3, 6]);
  });

  it("folds every feature into a fixed number of positions, the same at every run", () => {
    expect(featureIndex("w:mercato")).toBe(featureIndex("w:mercato"));
    expect(featureIndex("w:mercato")).toBeLessThan(FEATURE_DIMENSIONS);
    expect(featureCounts(text("aaaa")).size).toBeGreaterThan(3);
  });
});

describe("the strict memory", () => {
  const at = (day: number) => new Date(Date.UTC(2026, 0, day));

  it("remembers a text after three confirmations in a row for one category", () => {
    const memory = strictMemory([
      { key: "bar", categoryId: "a", at: at(1) },
      { key: "bar", categoryId: "a", at: at(2) },
      { key: "bar", categoryId: "a", at: at(3) },
      { key: "shop", categoryId: "a", at: at(1) },
      { key: "shop", categoryId: "a", at: at(2) },
    ]);
    expect([...memory]).toEqual([["bar", "a"]]);
  });

  it("forgets a text whose last three do not agree, and follows a person who changed their mind", () => {
    const mixed = [
      { key: "bar", categoryId: "a", at: at(1) },
      { key: "bar", categoryId: "a", at: at(2) },
      { key: "bar", categoryId: "a", at: at(3) },
      { key: "bar", categoryId: "b", at: at(4) },
    ];
    expect(strictMemory(mixed).has("bar")).toBe(false);
    const changed = [
      ...mixed,
      { key: "bar", categoryId: "b", at: at(5) },
      { key: "bar", categoryId: "b", at: at(6) },
    ];
    expect(strictMemory(changed).get("bar")).toBe("b");
  });

  it("never remembers a movement with no text", () => {
    expect(strictMemory([1, 2, 3].map((day) => ({ key: "", categoryId: "a", at: at(day) }))).size).toBe(0);
  });
});

describe("the thresholds", () => {
  const trials = (right: number, wrong: number, confidence: number): Trial[] => [
    ...Array.from({ length: right }, () => ({ confidence, correct: true })),
    ...Array.from({ length: wrong }, () => ({ confidence, correct: false })),
  ];

  it("is the lowest confidence that still gives the precision asked", () => {
    const all = [...trials(40, 0, 0.9), ...trials(38, 2, 0.7), ...trials(17, 3, 0.5)];
    // 78 right of 80 at 0.7 and above (97.5%); 95 of 100 at 0.5 and above, but that band alone
    // is 85%: good enough for 85%, not for 95%.
    expect(thresholdFor(all, 0.95)).toBe(0.7);
    expect(thresholdFor(all, 0.85)).toBe(0.5);
  });

  it("stops at a doubtful band even when everything above it carries the average", () => {
    // 300 sure and right, then 30 that are right 6 times in 10: 318 of 330 is 96%.
    const all = [...trials(300, 0, 0.99), ...trials(18, 12, 0.6)];
    expect(thresholdFor(all, 0.95)).toBe(0.99);
  });

  it("gives no threshold with too few predictions to prove anything, or with none good enough", () => {
    expect(thresholdFor(trials(MIN_SUPPORT - 1, 0, 0.9), 0.95)).toBeNull();
    expect(thresholdFor(trials(10, 10, 0.9), 0.95)).toBeNull();
  });

  it("rises when a person corrected more than one automatic category in ten", () => {
    const all = [...trials(60, 0, 0.9), ...trials(57, 3, 0.7)];
    expect(thresholdsFor(all, 0.05).automatic).toBe(0.7);
    expect(thresholdsFor(all, 0.2).automatic).toBe(0.9);
  });

  it("suggests only under the automatic threshold", () => {
    const all = [...trials(40, 0, 0.9), ...trials(30, 10, 0.6)];
    expect(thresholdsFor(all)).toEqual({ automatic: 0.9, suggestion: 0.6 });
    expect(thresholdsFor(trials(40, 0, 0.9))).toEqual({ automatic: 0.9, suggestion: null });
  });

  it("measures precision and coverage at a threshold", () => {
    const all = [...trials(45, 5, 0.9), ...trials(0, 50, 0.4)];
    expect(measure(all, 0.9)).toEqual({ precision: 0.9, coverage: 0.5 });
    expect(measure(all, null)).toEqual({ precision: null, coverage: 0 });
  });
});

describe("the static tables", () => {
  it("answers for a merchant type, the narrower range first, and for nothing it does not know", () => {
    expect(merchantTypeGroup("5411")).toEqual({ group: "groceries", ambiguous: false });
    expect(merchantTypeGroup("5942")).toEqual({ group: "leisure", ambiguous: false });
    expect(merchantTypeGroup("5945")).toEqual({ group: "leisure", ambiguous: true });
    expect(merchantTypeGroup("0001")).toBeNull();
    expect(merchantTypeGroup("54x1")).toBeNull();
    expect(merchantTypeGroup(null)).toBeNull();
  });

  it("finds a brand on whole words only", () => {
    expect(brandGroup("COOP LOMBARDIA 221")?.group).toBe("groceries");
    expect(brandGroup("Cooperativa Sociale")).toBeNull();
    expect(brandGroup("AMZN Mktp")).toMatchObject({ brand: "Amazon", ambiguous: true });
  });

  it("reads a salary and a fee from the bank's code, on whole words", () => {
    expect(structureOf("PMNT · SALA")).toBe("salary");
    expect(structureOf("ACMT · CHRG · Charges")).toBe("fee");
    expect(structureOf("SALAD BAR")).toBeNull();
    expect(structureOf(null)).toBeNull();
  });

  // QC7 (categories-and-rules.md §11): 11 of Expenses, 2 of Income, 2 categories of Transfers.
  it("has fifteen default groups, each with a name and examples in both languages", () => {
    expect(DEFAULT_GROUPS).toHaveLength(15);
    expect(DEFAULT_GROUPS.filter((group) => group.type === "expense")).toHaveLength(11);
    expect(DEFAULT_GROUPS.filter((group) => group.type === "income").map((group) => group.key)).toEqual([
      "income",
      "other_income",
    ]);
    expect(DEFAULT_GROUPS.filter((group) => group.type === "transfer").map((group) => group.key)).toEqual([
      "savings",
      "credit_card",
    ]);
    for (const group of DEFAULT_GROUPS) {
      expect([group.en, group.it, group.examples.en, group.examples.it].every((one) => one.length > 0)).toBe(
        true,
      );
    }
  });

  it("finds a person's category for a group: the one made from it, then one with its name", () => {
    const categories = [
      { id: "c1", name: "Food", type: "expense" },
      { id: "c2", name: "spesa alimentare", type: "expense" },
      { id: "c3", name: "Trasporti", type: "expense" },
      { id: "c4", name: "Entrate", type: "expense" },
    ];
    const found = groupCategories(DEFAULT_GROUPS, categories, new Map([["c1", "groceries"]]));
    expect(found.get("groceries")).toBe("c1");
    expect(found.get("transport")).toBe("c3");
    // A category with the group's name and another kind is not that group.
    expect(found.has("income")).toBe(false);
  });
});

describe("the classifier", () => {
  const rows = history();
  const examples: Example[] = rows.slice(0, 600);

  it("learns nothing from too few labels, or from one category only", () => {
    expect(train(examples.slice(0, MIN_EXAMPLES - 1))).toBeNull();
    expect(train(examples.filter((one) => one.categoryId === "groceries"))).toBeNull();
  });

  it("leaves out a category with fewer than three examples", () => {
    const classes = learnableClasses([
      ...examples,
      { ...examples[0], categoryId: "rare" },
      { ...examples[1], categoryId: "rare" },
    ]);
    expect(classes).not.toContain("rare");
    expect(classes).toContain("groceries");
  });

  it("gives the same model for the same examples, and the same answers after it is stored", () => {
    const first = train(examples);
    const second = train(examples);
    expect(first).not.toBeNull();
    expect(Buffer.from(first!.weights.buffer).equals(Buffer.from(second!.weights.buffer))).toBe(true);

    const loaded = loadModel(JSON.parse(JSON.stringify(storeModel(first!))));
    expect(loaded).not.toBeNull();
    for (const row of rows.slice(600, 640)) expect(predict(loaded!, row)).toEqual(predict(first!, row));
  });

  it("refuses a stored model of another shape", () => {
    const stored = storeModel(train(examples)!);
    expect(loadModel({ ...stored, dimensions: 8 })).toBeNull();
    expect(loadModel({ ...stored, classes: [...stored.classes, "extra"] })).toBeNull();
  });

  it("recognises a shop it has seen, written another way", () => {
    const model = train(examples)!;
    const seen = predict(model, text("MERCATO ALFA 9981 TORINO", -4800n));
    expect(seen.categoryId).toBe("groceries");
    expect(seen.confidence).toBeGreaterThan(0.5);
  });
});

/**
 * The cascade as the service runs it, on labels in the order they were made (rewrite plan N3,
 * criterion 3): what is known comes from the first `known` rows only, and the answer is graded on
 * the rows after them.
 */
function inOrderOfTime(known: number) {
  const rows = history();
  const past = rows.slice(0, known);
  const model = train(past);
  const knowledge: Knowledge = {
    memory: strictMemory(
      past.map((row) => ({ key: memoryKey(row), categoryId: row.categoryId, at: row.at })),
    ),
    model,
    thresholds: thresholdsFor(outOfSample(past)),
    groupCategory: new Map(),
    categoryKind: historyCategoryKinds(),
  };
  const future = rows.slice(known);
  let automatic = 0;
  let right = 0;
  let suggested = 0;
  for (const row of future) {
    const movement: CascadeMovement = { ...row, merchantCategoryCode: null, bankTransactionCode: null };
    const decision = decide(movement, knowledge);
    if (decision.kind === "automatic") {
      automatic += 1;
      if (decision.categoryId === row.categoryId) right += 1;
    } else if (decision.kind === "suggestion") {
      suggested += 1;
    }
  }
  return {
    total: future.length,
    automatic,
    precision: automatic === 0 ? null : right / automatic,
    coverage: automatic / future.length,
    suggested: suggested / future.length,
    knowledge,
  };
}

describe("the cascade on a history in order of time (criterion 3 of N3)", () => {
  it("is right at least 95 times in 100 when it gives a category by itself", () => {
    const rows = history();
    const result = inOrderOfTime(Math.floor(rows.length * 0.67));
    // Coverage is measured and reported, with no threshold of its own (plan, 04-now.md §4.4).
    console.info(
      `automatic categories on ${result.total} later movements: precision ${(100 * (result.precision ?? 0)).toFixed(1)}%, ` +
        `coverage ${(100 * result.coverage).toFixed(1)}%, suggested ${(100 * result.suggested).toFixed(1)}%`,
    );
    expect(result.precision).not.toBeNull();
    expect(result.precision!).toBeGreaterThanOrEqual(0.95);
    // Something is covered: a cascade that gives nothing is always "precise".
    expect(result.coverage).toBeGreaterThan(0.3);
  });

  it("gives nothing by itself while the labels are too few to learn from, memory apart", () => {
    const result = inOrderOfTime(30);
    expect(result.knowledge.model).toBeNull();
    if (result.precision !== null) expect(result.precision).toBeGreaterThanOrEqual(0.95);
  });

  it("never gives a category the person no longer has", () => {
    const rows = history();
    const result = inOrderOfTime(Math.floor(rows.length * 0.67));
    const kinds = new Map(result.knowledge.categoryKind);
    kinds.delete("groceries");
    const without: Knowledge = { ...result.knowledge, categoryKind: kinds };
    for (const row of rows.slice(-200)) {
      const decision = decide({ ...row, merchantCategoryCode: null, bankTransactionCode: null }, without);
      if (decision.kind !== "none") expect(decision.categoryId).not.toBe("groceries");
    }
  });
});

describe("the predictions out of sample", () => {
  it("makes every example a trial while they are few, and holds a fifth out when they are many", () => {
    const few = history().slice(0, 300);
    expect(outOfSample(few)).toHaveLength(few.length);
    const many = [...history(1), ...history(2)];
    expect(many.length).toBeGreaterThanOrEqual(HOLD_OUT_FROM);
    const trials = outOfSample(many);
    expect(trials.length).toBeGreaterThan(many.length * 0.15);
    expect(trials.length).toBeLessThan(many.length * 0.25);
    // A fifth of a large history is still enough to find where the model can be trusted.
    expect(thresholdsFor(trials).automatic).not.toBeNull();
  });
});

describe("training within the memory of the container (criterion 4 of N3)", () => {
  it("trains on twenty thousand labels in a small share of the container's 1 GB", () => {
    const base = history();
    const many: Example[] = Array.from({ length: 20_000 }, (_, index) => {
      const row = base[index % base.length];
      return { ...row, payee: `${row.payee} ${index % 97}` };
    });
    global.gc?.();
    const before = process.memoryUsage();
    const model = train(many);
    const after = process.memoryUsage();
    expect(model).not.toBeNull();
    const grown = after.heapUsed + after.arrayBuffers - (before.heapUsed + before.arrayBuffers);
    // The model itself is classes × positions × 4 bytes; the examples as vectors are the rest.
    expect(grown).toBeLessThan(300 * 1024 * 1024);
  }, 120_000);
});
