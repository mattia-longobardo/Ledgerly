/**
 * The diagnosis of the measure of R6 (rewrite plan, 03-releases.md §R6): on the texts never seen
 * (the folds by text of `categories-measure.ts`), how often the right category is first or among
 * the first three — with no threshold — for the cold start, the classifier with the embeddings
 * and today's; how the labels spread over the categories; and, fold by fold, which thresholds
 * could not form and why. Pure, numbers only: no text, no id.
 */
import type { CascadeMovement, EmbeddedKnowledge, Knowledge } from "../categorize/cascade";
import { type Model, ranked, type Trial } from "../categorize/classifier";
import { memoryKey, wordsOf } from "../categorize/text";
import { type NoThreshold, whyNoSuggestionThreshold, whyNoThresholds } from "../categorize/thresholds";
import { coldStartTrials, rankedCategories } from "./cold-start";
import type { EmbeddedLabel } from "./embedded-learning";

/** How many graded labels had the right category first, or among the first three. */
export interface TopK {
  graded: number;
  top1: number;
  top3: number;
  /** Graded with no model to ask: the fold's labels were too few to train one. */
  noModel: number;
}

type Slot = "todayAutomatic" | "todaySuggestion" | "modelAutomatic" | "modelSuggestion" | "coldStart";
type Reason = NoThreshold | "examples" | "aboveAutomatic";

export interface Diagnosis {
  /** Distinct texts (memory keys) and categories among the labels, and the labels of each category. */
  texts: number;
  categories: number;
  perCategory: number[];
  folds: number;
  accuracy: { coldStart: TopK; model: TopK; today: TopK };
  /** For each threshold, in how many folds it was `null`, by reason. */
  nullThresholds: Record<Slot, Record<Reason, number>>;
}

/** What the measure learnt in one fold, as the diagnosis reads it. */
interface Fold {
  learnt: readonly EmbeddedLabel[];
  graded: readonly (EmbeddedLabel & CascadeMovement)[];
  today: Knowledge;
  embedded: EmbeddedKnowledge;
  trials: { today: readonly Trial[]; model: readonly Trial[] };
  categoryKind: ReadonlyMap<string, string>;
}

const emptyTopK = (): TopK => ({ graded: 0, top1: 0, top3: 0, noModel: 0 });
const noReasons = (): Record<Reason, number> => ({
  examples: 0,
  support: 0,
  floor: 0,
  precision: 0,
  aboveAutomatic: 0,
});

export function emptyDiagnosis(labels: readonly EmbeddedLabel[]): Diagnosis {
  const perCategory = new Map<string, number>();
  for (const label of labels) perCategory.set(label.categoryId, (perCategory.get(label.categoryId) ?? 0) + 1);
  return {
    texts: new Set(labels.map((label) => memoryKey(label))).size,
    categories: perCategory.size,
    perCategory: [...perCategory.values()].sort((left, right) => left - right),
    folds: 0,
    accuracy: { coldStart: emptyTopK(), model: emptyTopK(), today: emptyTopK() },
    nullThresholds: {
      todayAutomatic: noReasons(),
      todaySuggestion: noReasons(),
      modelAutomatic: noReasons(),
      modelSuggestion: noReasons(),
      coldStart: noReasons(),
    },
  };
}

function hit(topK: TopK, ranking: readonly string[] | null, categoryId: string): void {
  topK.graded += 1;
  if (ranking === null) {
    topK.noModel += 1;
    return;
  }
  if (ranking[0] === categoryId) topK.top1 += 1;
  if (ranking.slice(0, 3).includes(categoryId)) topK.top3 += 1;
}

function rankingOf(model: Model | null, label: EmbeddedLabel & CascadeMovement, fold: Fold): string[] | null {
  if (model === null) return null;
  const fits = (categoryId: string) => fold.categoryKind.get(categoryId) === label.kind;
  return ranked(model, label, fold.embedded.embedder).filter(fits);
}

function countNulls(diagnosis: Diagnosis, fold: Fold): void {
  const reasons = diagnosis.nullThresholds;
  const add = (slot: Slot, reason: Reason | null) => {
    if (reason !== null) reasons[slot][reason] += 1;
  };
  for (const [prefix, model, trials] of [
    ["today", fold.today.model, fold.trials.today],
    ["model", fold.embedded.model, fold.trials.model],
  ] as const) {
    const why =
      model === null
        ? { automatic: "examples" as const, suggestion: "examples" as const }
        : whyNoThresholds(trials);
    add(`${prefix}Automatic`, why.automatic);
    add(`${prefix}Suggestion`, why.suggestion);
  }
  const graded = fold.learnt.map((label) => ({
    words: wordsOf(label),
    categoryId: label.categoryId,
    kind: label.kind,
  }));
  add(
    "coldStart",
    whyNoSuggestionThreshold(
      coldStartTrials(fold.embedded.embedder, fold.embedded.prototypes, graded, fold.categoryKind),
    ),
  );
}

/** Adds one fold: the top-k of its graded labels and the reasons of its missing thresholds. */
export function diagnoseFold(diagnosis: Diagnosis, fold: Fold): void {
  diagnosis.folds += 1;
  countNulls(diagnosis, fold);
  const { embedder, prototypes } = fold.embedded;
  for (const label of fold.graded) {
    const words = wordsOf(label);
    const fits = (categoryId: string) => fold.categoryKind.get(categoryId) === label.kind;
    hit(
      diagnosis.accuracy.coldStart,
      words === "" ? [] : rankedCategories(prototypes, embedder.embed(words), fits),
      label.categoryId,
    );
    hit(diagnosis.accuracy.model, rankingOf(fold.embedded.model, label, fold), label.categoryId);
    hit(diagnosis.accuracy.today, rankingOf(fold.today.model, label, fold), label.categoryId);
  }
}
