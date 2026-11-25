/**
 * The cold start of the automatic categories (rewrite plan R6, decision H56): the words each
 * category of a person is read by, and how close a text must be to one before it is suggested.
 * Pure: the embedding model is handed in.
 */
import { closestCategory, type Prototype } from "../categorize/cascade";
import type { Trial } from "../categorize/classifier";
import { cosine, type Embedder } from "./embedding";
import { DEFAULT_CATEGORIES, type GroupKey } from "../categorize/tables";
import { suggestionThresholdFor } from "../categorize/thresholds";

/**
 * A vector for each category: its name and, for a category of the default tree, its names in both
 * languages and a group's examples — "Ristoranti, fast food" reads closer to a pizzeria than a
 * name a person chose alone.
 */
export function prototypesOf(
  embedder: Embedder,
  categories: readonly { id: string; name: string }[],
  groupCategory: ReadonlyMap<GroupKey, string>,
): Prototype[] {
  const groupOf = new Map([...groupCategory].map(([key, categoryId]) => [categoryId, key]));
  return categories.map((category) => {
    const known = DEFAULT_CATEGORIES.find((one) => one.key === groupOf.get(category.id));
    const words = known
      ? [category.name, known.en, known.it, known.examples?.en ?? "", known.examples?.it ?? ""]
      : [category.name];
    return { categoryId: category.id, vector: embedder.embed(words.join(" ")) };
  });
}

/** A confirmed label as the cold start is graded on it. */
interface ColdStartLabel {
  words: string;
  categoryId: string;
  kind: "income" | "expense";
}

/**
 * The cold start graded on the person's own confirmed labels — out of sample by nature: the
 * categories' words learn nothing from them. One trial for each label with words.
 */
export function coldStartTrials(
  embedder: Embedder,
  prototypes: readonly Prototype[],
  labels: readonly ColdStartLabel[],
  categoryKind: ReadonlyMap<string, string>,
): Trial[] {
  return labels
    .filter((label) => label.words !== "")
    .flatMap((label) => {
      const closest = closestCategory(
        prototypes,
        embedder.embed(label.words),
        (categoryId) => categoryKind.get(categoryId) === label.kind,
      );
      return closest === null
        ? []
        : [{ confidence: closest.confidence, correct: closest.categoryId === label.categoryId }];
    });
}

/**
 * The least closeness at which the cold start is right two times in three on those trials. `null`
 * when no closeness is good enough, or the labels are too few to say.
 */
export function coldStartThreshold(
  embedder: Embedder,
  prototypes: readonly Prototype[],
  labels: readonly ColdStartLabel[],
  categoryKind: ReadonlyMap<string, string>,
): number | null {
  return suggestionThresholdFor(coldStartTrials(embedder, prototypes, labels, categoryKind));
}

/** The categories `fits` allows, the closest to `vector` first: the cold start's ranking. */
export function rankedCategories(
  prototypes: readonly Prototype[],
  vector: Float32Array,
  fits: (categoryId: string) => boolean,
): string[] {
  return prototypes
    .filter((prototype) => fits(prototype.categoryId))
    .map((prototype) => ({ categoryId: prototype.categoryId, closeness: cosine(prototype.vector, vector) }))
    .sort((left, right) => right.closeness - left.closeness)
    .map((one) => one.categoryId);
}
