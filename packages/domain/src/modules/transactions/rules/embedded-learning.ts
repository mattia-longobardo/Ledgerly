/**
 * What a pass of the cascade learns with the embedding model (rewrite plan R6): the classifier
 * trained with the embeddings, its thresholds, the categories' words and the cold start's
 * threshold. No database here: the service hands in what it read and stores what this returns,
 * beside today's model in the same row (`category_models.model`), so no column is added.
 */
import { z } from "zod";
import type { EmbeddedKnowledge } from "../categorize/cascade";
import {
  type Example,
  loadModel,
  type Model,
  outOfSampleInTurns,
  storeModel,
  trainInTurns,
} from "../categorize/classifier";
import { coldStartThreshold, prototypesOf } from "./cold-start";
import type { Embedder } from "./embedding";
import type { GroupKey } from "../categorize/tables";
import { wordsOf } from "../categorize/text";
import { type Thresholds, thresholdsFor } from "../categorize/thresholds";

const storedEmbeddedSchema = z.object({
  /** The embedding model it was trained with: another one and it is trained again. */
  revision: z.string(),
  examples: z.number(),
  labelledThrough: z.string().nullable(),
  automatic: z.number().nullable(),
  suggestion: z.number().nullable(),
  model: z.object({
    dimensions: z.number(),
    classes: z.array(z.string()),
    idf: z.string(),
    weights: z.string(),
    bias: z.string(),
    embedder: z.string().nullable().optional(),
    dense: z.number().optional(),
  }),
});

export type StoredEmbedded = z.infer<typeof storedEmbeddedSchema>;

/** The part of a stored row this file wrote, or `null` for a row without one. */
function storedEmbeddedOf(stored: unknown): StoredEmbedded | null {
  const parsed = z.object({ embedded: storedEmbeddedSchema }).safeParse(stored);
  return parsed.success ? parsed.data.embedded : null;
}

/** A confirmed label as this file reads it: the example and the kind of its movement. */
export interface EmbeddedLabel extends Example {
  kind: "income" | "expense";
}

interface EmbeddedInput {
  embedder: Embedder;
  labels: readonly EmbeddedLabel[];
  labelledThrough: Date | null;
  own: {
    named: readonly { id: string; name: string }[];
    groupCategory: ReadonlyMap<GroupKey, string>;
    categoryKind: ReadonlyMap<string, string>;
  };
  /** The row's `model` as stored, and whether this pass may train. */
  stored: unknown;
  train: boolean;
  correctionRate: () => Promise<number>;
}

const NO_THRESHOLDS: Thresholds = { automatic: null, suggestion: null };

/** The classifier stored for this embedding model, with its thresholds, or none. */
function storedFor(input: EmbeddedInput) {
  const before = storedEmbeddedOf(input.stored);
  if (before === null || before.revision !== input.embedder.revision) return null;
  const model = loadModel(before.model);
  return model === null
    ? null
    : { before, model, thresholds: { automatic: before.automatic, suggestion: before.suggestion } };
}

/** The categories' words and the cold start's threshold: worked out again at every pass. */
function coldStartOf(input: EmbeddedInput) {
  const { embedder, labels, own } = input;
  const prototypes = prototypesOf(embedder, own.named, own.groupCategory);
  const graded = labels.map((label) => ({
    words: wordsOf(label),
    categoryId: label.categoryId,
    kind: label.kind,
  }));
  return { prototypes, coldStart: coldStartThreshold(embedder, prototypes, graded, own.categoryKind) };
}

async function trained(input: EmbeddedInput): Promise<{ model: Model | null; thresholds: Thresholds }> {
  const model = await trainInTurns(input.labels, input.embedder);
  if (model === null) return { model, thresholds: NO_THRESHOLDS };
  const trials = await outOfSampleInTurns(input.labels, input.embedder);
  return { model, thresholds: thresholdsFor(trials, await input.correctionRate()) };
}

/**
 * The embedding level of one person: the stored classifier when it was trained with this model on
 * these labels (or the pass may not train), else a new one. `fresh` with a new classifier to store.
 */
export async function learnEmbedded(
  input: EmbeddedInput,
): Promise<{ knowledge: EmbeddedKnowledge; store: StoredEmbedded | null; fresh: boolean }> {
  const through = input.labelledThrough === null ? null : input.labelledThrough.toISOString();
  const stored = storedFor(input);
  const current =
    stored?.before.examples === input.labels.length && stored.before.labelledThrough === through;
  const knowledgeOf = (model: Model | null, thresholds: Thresholds): EmbeddedKnowledge => ({
    embedder: input.embedder,
    model,
    thresholds,
    ...coldStartOf(input),
  });
  if (!input.train || current) {
    const knowledge =
      stored === null ? knowledgeOf(null, NO_THRESHOLDS) : knowledgeOf(stored.model, stored.thresholds);
    return { knowledge, store: stored?.before ?? null, fresh: false };
  }
  const { model, thresholds } = await trained(input);
  const store =
    model === null
      ? null
      : {
          revision: input.embedder.revision,
          examples: input.labels.length,
          labelledThrough: through,
          automatic: thresholds.automatic,
          suggestion: thresholds.suggestion,
          model: storeModel(model),
        };
  return { knowledge: knowledgeOf(model, thresholds), store, fresh: model !== null };
}
