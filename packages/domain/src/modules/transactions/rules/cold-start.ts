/**
 * The cold start of the automatic categories (rewrite plan R6, decision H56): the words each
 * category of a person is read by, and how close a text must be to one before it is suggested.
 * Pure: the embedding model is handed in.
 */
import { closestCategory, type Prototype } from "../categorize/cascade";
import type { Embedder } from "./embedding";
import { DEFAULT_GROUPS, type GroupKey } from "../categorize/tables";
import { suggestionThresholdFor } from "../categorize/thresholds";

/**
 * A vector for each category: its name and, for the category of a default group, the group's
 * names and examples in both languages — "Ristoranti e bar" reads closer to a pizzeria than a
 * name a person chose alone.
 */
export function prototypesOf(
  embedder: Embedder,
  categories: readonly { id: string; name: string }[],
  groupCategory: ReadonlyMap<GroupKey, string>,
): Prototype[] {
  const groupOf = new Map([...groupCategory].map(([key, categoryId]) => [categoryId, key]));
  return categories.map((category) => {
    const group = DEFAULT_GROUPS.find((one) => one.key === groupOf.get(category.id));
    const words = group
      ? [category.name, group.en, group.it, group.examples.en, group.examples.it]
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
 * The least closeness at which the cold start is right two times in three, graded on the person's
 * own confirmed labels — out of sample by nature: the categories' words learn nothing from them.
 * `null` when no closeness is good enough, or the labels are too few to say.
 */
export function coldStartThreshold(
  embedder: Embedder,
  prototypes: readonly Prototype[],
  labels: readonly ColdStartLabel[],
  categoryKind: ReadonlyMap<string, string>,
): number | null {
  const trials = labels
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
  return suggestionThresholdFor(trials);
}
