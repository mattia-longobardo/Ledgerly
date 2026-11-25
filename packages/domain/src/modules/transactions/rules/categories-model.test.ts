import { describe, expect, it } from "vitest";
import { history, historyCategoryKinds } from "../../../../../../test/fixtures/categories/history";
import { type CascadeMovement, decide, type EmbeddedKnowledge, type Knowledge } from "../categorize/cascade";
import { loadModel, predict, storeModel, train } from "../categorize/classifier";
import { coldStartThreshold, prototypesOf } from "./cold-start";
import { learnEmbedded } from "./embedded-learning";
import type { Embedder } from "./embedding";
import { measureLabels } from "./categories-measure";
import { wordsOf } from "../categorize/text";

// A stand-in for the embedding model: each word lights one of 64 positions, so two texts are close
// when they share words. Deterministic, like the real one; the real one is tested in the worker.
const DIMENSIONS = 64;
function fakeEmbedder(revision = "fake:1"): Embedder {
  return {
    revision,
    dimensions: DIMENSIONS,
    embed(text: string) {
      const vector = new Float32Array(DIMENSIONS);
      for (const word of text
        .toLowerCase()
        .split(/[^a-z]+/)
        .filter(Boolean)) {
        let hash = 7;
        for (const char of word) hash = (hash * 31 + char.charCodeAt(0)) % 1_000_003;
        vector[hash % DIMENSIONS] += 1;
      }
      const length = Math.hypot(...vector) || 1;
      return vector.map((value) => value / length);
    },
  };
}

const kinds = historyCategoryKinds();
const labels = () =>
  history().map((row) => ({
    ...row,
    kind: kinds.get(row.categoryId) === "income" ? ("income" as const) : ("expense" as const),
    merchantCategoryCode: null,
    bankTransactionCode: null,
  }));

/** Categories named after the words of their shops: what the cold start reads. */
const NAMED = [
  { id: "restaurants", name: "Pizzeria Trattoria Bar Osteria" },
  { id: "groceries", name: "Mercato Superstore Alimentari" },
  { id: "transport", name: "Ferrovie Metro Carburanti Pedaggi" },
  { id: "health", name: "Farmacia Studio Medico" },
  { id: "income", name: "Datore Rimborsi" },
];

const movement = (payee: string, amountCents = -2000n): CascadeMovement => ({
  payee,
  counterparty: null,
  rawText: null,
  note: null,
  accountId: "account",
  amountCents,
  kind: amountCents < 0n ? "expense" : "income",
  merchantCategoryCode: null,
  bankTransactionCode: null,
});

const baseKnowledge = (embedded: EmbeddedKnowledge | null): Knowledge => ({
  memory: new Map(),
  model: null,
  thresholds: { automatic: null, suggestion: null },
  groupCategory: new Map(),
  categoryKind: kinds,
  embedded,
});

describe("the classifier with the embeddings as features (R6)", () => {
  const embedder = fakeEmbedder();
  const examples = labels().slice(0, 600);

  it("is the same model at every training, and the same after storing and loading", () => {
    const first = train(examples, embedder);
    const second = train(examples, embedder);
    expect(first?.dense).toBe(DIMENSIONS);
    expect(first?.embedder).toBe("fake:1");
    expect(Buffer.from(first!.weights.buffer).equals(Buffer.from(second!.weights.buffer))).toBe(true);
    const loaded = loadModel(JSON.parse(JSON.stringify(storeModel(first!))));
    for (const row of examples.slice(0, 40)) {
      expect(predict(loaded!, row, embedder)).toEqual(predict(first!, row, embedder));
    }
  });

  it("refuses a stored model whose dense part does not match its width", () => {
    const stored = storeModel(train(examples, embedder)!);
    expect(loadModel({ ...stored, dense: 0 })).toBeNull();
    expect(loadModel({ ...stored, embedder: null })).toBeNull();
  });

  it("leaves today's model as it was: no embedder, no dense part", () => {
    const plain = train(examples)!;
    expect(plain.dense).toBe(0);
    expect(plain.embedder).toBeNull();
    expect(loadModel(JSON.parse(JSON.stringify(storeModel(plain))))?.dense).toBe(0);
  });

  it("answers what a person corrected, at the next training", () => {
    const text = movement("Pizzeria Eta 12 MILANO");
    const before = predict(train(examples, embedder)!, text, embedder);
    expect(before.categoryId).toBe("restaurants");
    const corrected = examples.map((row) =>
      wordsOf(row).startsWith("pizzeria eta") ? { ...row, categoryId: "leisure" } : row,
    );
    expect(predict(train(corrected, embedder)!, text, embedder).categoryId).toBe("leisure");
  });
});

describe("the cold start (R6)", () => {
  const embedder = fakeEmbedder();
  const prototypes = prototypesOf(embedder, NAMED, new Map());
  const embedded = (coldStart: number | null): EmbeddedKnowledge => ({
    embedder,
    model: null,
    thresholds: { automatic: null, suggestion: null },
    prototypes,
    coldStart,
  });

  it("suggests the category a text never seen reads closest to, and never gives it", () => {
    const decision = decide(movement("Farmacia Nuova"), baseKnowledge(embedded(0.5)));
    expect(decision).toEqual({ kind: "suggestion", categoryId: "health", reason: "similar", params: {} });
  });

  it("suggests nothing under its threshold, without a threshold, or for a text with no words", () => {
    expect(decide(movement("Farmacia Nuova"), baseKnowledge(embedded(0.99))).kind).toBe("none");
    expect(decide(movement("Farmacia Nuova"), baseKnowledge(embedded(null))).kind).toBe("none");
    expect(decide(movement("12345"), baseKnowledge(embedded(0))).kind).toBe("none");
  });

  it("never files an income under a spending category", () => {
    const decision = decide(movement("Farmacia Nuova", 5000n), baseKnowledge(embedded(0)));
    expect(decision.kind === "suggestion" && decision.categoryId).toBe("income");
  });

  it("is off where the cascade has no embedding model: today's cascade", () => {
    expect(decide(movement("Farmacia Nuova"), baseKnowledge(null)).kind).toBe("none");
  });

  it("finds its threshold on the person's labels, and none when they are too few", () => {
    const graded = labels().map((label) => ({
      words: wordsOf(label),
      categoryId: label.categoryId,
      kind: label.kind,
    }));
    const threshold = coldStartThreshold(embedder, prototypes, graded, kinds);
    expect(threshold).not.toBeNull();
    expect(threshold!).toBeGreaterThan(0.5);
    expect(coldStartThreshold(embedder, prototypes, graded.slice(0, 5), kinds)).toBeNull();
  });

  it("reads a category of the default tree by its names too", () => {
    const [prototype] = prototypesOf(
      embedder,
      [{ id: "food", name: "Cibo" }],
      new Map([["food_drinks.groceries", "food"]]),
    );
    const [alone] = prototypesOf(embedder, [{ id: "food", name: "Cibo" }], new Map());
    expect(prototype.vector).not.toEqual(alone.vector);
  });
});

describe("what a pass learns with the embedding model (R6)", () => {
  const embedder = fakeEmbedder();
  const all = labels();
  const input = (stored: unknown, train = true, model = embedder) => ({
    embedder: model,
    labels: all,
    labelledThrough: new Date(Date.UTC(2026, 0, 1)),
    own: { named: NAMED, groupCategory: new Map<string, string>(), categoryKind: kinds },
    stored,
    train,
    correctionRate: async () => 0,
  });

  it("trains the first time, then keeps the stored classifier while the labels stay the same", async () => {
    const first = await learnEmbedded(input(null));
    expect(first.fresh).toBe(true);
    expect(first.knowledge.model?.embedder).toBe("fake:1");
    expect(first.store?.examples).toBe(all.length);
    const again = await learnEmbedded(input({ embedded: first.store }));
    expect(again.fresh).toBe(false);
    expect(again.store).toEqual(first.store);
  });

  it("trains again for another embedding model, and never when the pass may not train", async () => {
    const first = await learnEmbedded(input(null));
    expect((await learnEmbedded(input({ embedded: first.store }, true, fakeEmbedder("fake:2")))).fresh).toBe(
      true,
    );
    const idle = await learnEmbedded(input({ embedded: first.store }, false, fakeEmbedder("fake:2")));
    expect(idle.fresh).toBe(false);
    expect(idle.knowledge.model).toBeNull();
  });

  it("reads a stored row of before R6 as one with no embedding part", async () => {
    expect((await learnEmbedded(input({ dimensions: 1, classes: [] }, false))).knowledge.model).toBeNull();
  });
});

describe("the measure before/after (R6)", () => {
  const all = labels();
  const open = [movement("Farmacia Nuova"), movement("Pizzeria Eta 9"), movement("zzz")];
  const measure = measureLabels(
    all,
    { named: NAMED, groupCategory: new Map(), categoryKind: kinds },
    fakeEmbedder(),
    open,
  );

  it("grades every label once as a text never seen, in folds fixed by the text", () => {
    const { grouped } = measure;
    for (const tally of Object.values(grouped)) expect(tally.graded).toBe(all.length);
  });

  it("tells what the cold start adds: the model without it never covers more", () => {
    const { withModel, withoutColdStart, coldStartAlone } = measure.grouped;
    expect(withModel.automatic).toBe(withoutColdStart.automatic);
    expect(withModel.suggested).toBeGreaterThanOrEqual(withoutColdStart.suggested);
    expect(coldStartAlone.automatic).toBe(0);
    expect(coldStartAlone.suggested).toBeGreaterThan(0);
  });

  it("counts what the cascades would do with the movements nobody filed: coverage only", () => {
    expect(measure.open.movements).toBe(3);
    expect(measure.open.withModel.automatic + measure.open.withModel.suggested).toBeGreaterThanOrEqual(
      measure.open.today.automatic + measure.open.today.suggested,
    );
    expect(measure.open.withModel.automatic + measure.open.withModel.suggested).toBeLessThanOrEqual(3);
  });

  it("keeps the chronological split: the older 80% learnt, the newer 20% graded, unseen apart", () => {
    const { today, withModel } = measure.chronological;
    expect(today.all.graded).toBe(withModel.all.graded);
    expect(today.all.graded).toBe(all.length - Math.floor(all.length * 0.8));
    expect(today.unseen.graded).toBeGreaterThan(0);
    expect(withModel.all.automaticRight / withModel.all.automatic).toBeGreaterThanOrEqual(0.95);
  });

  it("diagnoses the texts never seen: accuracy with no threshold, the spread, the missing thresholds", () => {
    const { diagnosis } = measure;
    expect(diagnosis.folds).toBe(5);
    expect(diagnosis.categories).toBe(new Set(all.map((label) => label.categoryId)).size);
    expect(diagnosis.perCategory.reduce((sum, one) => sum + one, 0)).toBe(all.length);
    expect(diagnosis.texts).toBeGreaterThan(diagnosis.categories);
    for (const topK of Object.values(diagnosis.accuracy)) {
      expect(topK.graded).toBe(all.length);
      expect(topK.top3).toBeGreaterThanOrEqual(topK.top1);
    }
    // The shops share their words with their categories' names: the cold start ranks them well.
    expect(diagnosis.accuracy.coldStart.top3).toBeGreaterThan(all.length / 3);
    for (const reasons of Object.values(diagnosis.nullThresholds)) {
      expect(Object.values(reasons).reduce((sum, one) => sum + one, 0)).toBeLessThanOrEqual(5);
    }
  });

  it("holds numbers only: no text and no id of a movement", () => {
    expect(JSON.stringify(measure)).not.toMatch(/[a-z]{3,} [a-z]|[0-9a-f]{8}-/i);
    expect(Object.values(measure.grouped.today).every((value) => typeof value === "number")).toBe(true);
  });
});
