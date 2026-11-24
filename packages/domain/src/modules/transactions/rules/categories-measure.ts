/**
 * The measure before/after of R6 (rewrite plan, 03-releases.md §R6, "Test e gate"): the cascade of
 * today and the one with the embedding model, on the same confirmed labels of one person. Pure,
 * and numbers only: no text, no id and no amount leaves this file.
 *
 * The labels are split by time: the older 80% is what both cascades learn from (memory, classifier,
 * thresholds), the newer 20% is what they are graded on. A label of the newer part whose text the
 * older part never had is "unseen": the cold start H56 is about. The person's rules are not in the
 * measure: they answer the same in both cascades.
 */
import { type CascadeMovement, decide, type Knowledge } from "../categorize/cascade";
import { outOfSample, train } from "../categorize/classifier";
import { coldStartThreshold, prototypesOf } from "./cold-start";
import type { EmbeddedLabel } from "./embedded-learning";
import type { Embedder } from "./embedding";
import { strictMemory } from "../categorize/memory";
import type { GroupKey } from "../categorize/tables";
import { memoryKey, wordsOf } from "../categorize/text";
import { type Thresholds, thresholdsFor } from "../categorize/thresholds";

/** How many decisions a cascade took on the graded labels, and how many were right. */
export interface Tally {
  graded: number;
  automatic: number;
  automaticRight: number;
  suggested: number;
  suggestedRight: number;
}

export interface Measure {
  labels: number;
  today: { all: Tally; unseen: Tally };
  withModel: { all: Tally; unseen: Tally };
}

interface MeasureLabel extends EmbeddedLabel {
  at: Date;
  merchantCategoryCode: string | null;
  bankTransactionCode: string | null;
}

interface Own {
  named: readonly { id: string; name: string }[];
  groupCategory: ReadonlyMap<GroupKey, string>;
  categoryKind: ReadonlyMap<string, "income" | "expense" | "transfer">;
}

const LEARNT_SHARE = 0.8;
const NO_THRESHOLDS: Thresholds = { automatic: null, suggestion: null };

const emptyTally = (): Tally => ({
  graded: 0,
  automatic: 0,
  automaticRight: 0,
  suggested: 0,
  suggestedRight: 0,
});

function count(tally: Tally, knowledge: Knowledge, label: MeasureLabel): void {
  const movement: CascadeMovement = { ...label };
  const decision = decide(movement, knowledge);
  tally.graded += 1;
  if (decision.kind === "none") return;
  const right = decision.categoryId === label.categoryId ? 1 : 0;
  if (decision.kind === "automatic") {
    tally.automatic += 1;
    tally.automaticRight += right;
  } else {
    tally.suggested += 1;
    tally.suggestedRight += right;
  }
}

/** Both cascades, learnt from the older labels. */
function knowledgeOf(learnt: readonly MeasureLabel[], own: Own, embedder: Embedder) {
  const memory = strictMemory(
    learnt.map((label) => ({ key: memoryKey(label), categoryId: label.categoryId, at: label.at })),
  );
  const model = train(learnt);
  const today: Knowledge = {
    memory,
    model,
    thresholds: model === null ? NO_THRESHOLDS : thresholdsFor(outOfSample(learnt)),
    groupCategory: own.groupCategory,
    categoryKind: own.categoryKind,
    embedded: null,
  };
  const embeddedModel = train(learnt, embedder);
  const prototypes = prototypesOf(embedder, own.named, own.groupCategory);
  const embedded = {
    embedder,
    model: embeddedModel,
    thresholds: embeddedModel === null ? NO_THRESHOLDS : thresholdsFor(outOfSample(learnt, embedder)),
    prototypes,
    coldStart: coldStartThreshold(
      embedder,
      prototypes,
      learnt.map((label) => ({ words: wordsOf(label), categoryId: label.categoryId, kind: label.kind })),
      own.categoryKind,
    ),
  };
  return { today, withModel: { ...today, embedded } };
}

export function measureLabels(labels: readonly MeasureLabel[], own: Own, embedder: Embedder): Measure {
  const sorted = [...labels].sort((left, right) => left.at.getTime() - right.at.getTime());
  const cut = Math.floor(sorted.length * LEARNT_SHARE);
  const learnt = sorted.slice(0, cut);
  const graded = sorted.slice(cut);
  const seen = new Set(learnt.map((label) => memoryKey(label)));
  const { today, withModel } = knowledgeOf(learnt, own, embedder);
  const measure: Measure = {
    labels: labels.length,
    today: { all: emptyTally(), unseen: emptyTally() },
    withModel: { all: emptyTally(), unseen: emptyTally() },
  };
  for (const label of graded) {
    const unseen = !seen.has(memoryKey(label));
    count(measure.today.all, today, label);
    count(measure.withModel.all, withModel, label);
    if (unseen) {
      count(measure.today.unseen, today, label);
      count(measure.withModel.unseen, withModel, label);
    }
  }
  return measure;
}
