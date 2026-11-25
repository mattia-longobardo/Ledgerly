/**
 * The measure before/after of R6 (rewrite plan, 03-releases.md §R6, "Test e gate"): the cascade of
 * today and the one with the embedding model, on the same confirmed labels of one person. Pure,
 * and numbers only: no text, no id and no amount leaves this file.
 *
 * Three views of the same labels:
 * - grouped: the labels are put in `FOLDS` folds by their text (the memory's key, through a fixed
 *   hash), and each fold is graded by cascades that learnt from the other folds only — every label
 *   is graded once as a text the cascade never saw, which is what H56 is about. The cold start is
 *   also graded alone, and the cascade with the model without it, to tell what it adds;
 * - open: the movements that have no category today, read by the cascades learnt from every
 *   label. Coverage only: no category was confirmed there, so no answer can be graded;
 * - chronological: the older 80% learnt, the newer 20% graded, the unseen texts apart.
 *
 * The person's rules are not in the measure: they answer the same in every cascade.
 */
import { type CascadeMovement, decide, type EmbeddedKnowledge, type Knowledge } from "../categorize/cascade";
import { outOfSample, train } from "../categorize/classifier";
import { strictMemory } from "../categorize/memory";
import type { GroupKey } from "../categorize/tables";
import { featureIndex, memoryKey } from "../categorize/text";
import { type Thresholds, thresholdsFor } from "../categorize/thresholds";
import { type Diagnosis, diagnoseFold, emptyDiagnosis } from "./categories-diagnosis";
import { coldStartOf, type EmbeddedLabel } from "./embedded-learning";
import type { Embedder } from "./embedding";

/** How many decisions a cascade took on the graded labels, and how many were right. */
export interface Tally {
  graded: number;
  automatic: number;
  automaticRight: number;
  suggested: number;
  suggestedRight: number;
}

/** What a cascade does with movements nobody filed: how many it would file, or suggest. */
export interface Reach {
  automatic: number;
  suggested: number;
}

export interface Measure {
  labels: number;
  grouped: { today: Tally; withModel: Tally; withoutColdStart: Tally; coldStartAlone: Tally };
  open: { movements: number; today: Reach; withModel: Reach };
  chronological: { today: { all: Tally; unseen: Tally }; withModel: { all: Tally; unseen: Tally } };
  diagnosis: Diagnosis;
}

interface MeasureLabel extends EmbeddedLabel {
  at: Date;
  merchantCategoryCode: string | null;
  bankTransactionCode: string | null;
}

interface Own {
  named: readonly { id: string; name: string }[];
  groupCategory: ReadonlyMap<GroupKey, string>;
  categoryKind: ReadonlyMap<string, "income" | "expense">;
}

const FOLDS = 5;
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

function embeddedOf(learnt: readonly MeasureLabel[], own: Own, embedder: Embedder) {
  const model = train(learnt, embedder);
  const trials = model === null ? [] : outOfSample(learnt, embedder);
  const embedded: EmbeddedKnowledge = {
    embedder,
    model,
    thresholds: model === null ? NO_THRESHOLDS : thresholdsFor(trials),
    ...coldStartOf({ embedder, labels: learnt, own }),
  };
  return { embedded, trials };
}

/** The cascades, learnt from `learnt`: today's, R6's, R6's with no cold start, the cold start alone. */
function knowledgeOf(learnt: readonly MeasureLabel[], own: Own, embedder: Embedder) {
  const model = train(learnt);
  const todayTrials = model === null ? [] : outOfSample(learnt);
  const today: Knowledge = {
    memory: strictMemory(
      learnt.map((label) => ({ key: memoryKey(label), categoryId: label.categoryId, at: label.at })),
    ),
    model,
    thresholds: model === null ? NO_THRESHOLDS : thresholdsFor(todayTrials),
    groupCategory: own.groupCategory,
    categoryKind: own.categoryKind,
    embedded: null,
  };
  const { embedded, trials } = embeddedOf(learnt, own, embedder);
  return {
    trials: { today: todayTrials, model: trials },
    embedded,
    today,
    withModel: { ...today, embedded },
    withoutColdStart: { ...today, embedded: { ...embedded, coldStart: null } },
    coldStartAlone: {
      ...today,
      memory: new Map(),
      model: null,
      groupCategory: new Map(),
      embedded: { ...embedded, model: null },
    },
  };
}

/** The fold of a label: fixed by its text, so a text is never on both sides and a run is repeatable. */
const foldOf = (label: MeasureLabel) => featureIndex(`fold:${memoryKey(label)}`) % FOLDS;

function grouped(
  labels: readonly MeasureLabel[],
  own: Own,
  embedder: Embedder,
): Pick<Measure, "grouped" | "diagnosis"> {
  const diagnosis = emptyDiagnosis(labels);
  const tallies = {
    today: emptyTally(),
    withModel: emptyTally(),
    withoutColdStart: emptyTally(),
    coldStartAlone: emptyTally(),
  };
  for (let fold = 0; fold < FOLDS; fold += 1) {
    const graded = labels.filter((label) => foldOf(label) === fold);
    if (graded.length === 0) continue;
    const learnt = labels.filter((label) => foldOf(label) !== fold);
    const cascades = knowledgeOf(learnt, own, embedder);
    diagnoseFold(diagnosis, { ...cascades, learnt, graded, categoryKind: own.categoryKind });
    for (const label of graded) {
      for (const name of ["today", "withModel", "withoutColdStart", "coldStartAlone"] as const) {
        count(tallies[name], cascades[name], label);
      }
    }
  }
  return { grouped: tallies, diagnosis };
}

function reach(knowledge: Knowledge, open: readonly CascadeMovement[]): Reach {
  const decisions = open.map((movement) => decide(movement, knowledge).kind);
  return {
    automatic: decisions.filter((kind) => kind === "automatic").length,
    suggested: decisions.filter((kind) => kind === "suggestion").length,
  };
}

function chronological(
  labels: readonly MeasureLabel[],
  own: Own,
  embedder: Embedder,
): Measure["chronological"] {
  const sorted = [...labels].sort((left, right) => left.at.getTime() - right.at.getTime());
  const cut = Math.floor(sorted.length * LEARNT_SHARE);
  const learnt = sorted.slice(0, cut);
  const seen = new Set(learnt.map((label) => memoryKey(label)));
  const { today, withModel } = knowledgeOf(learnt, own, embedder);
  const result = {
    today: { all: emptyTally(), unseen: emptyTally() },
    withModel: { all: emptyTally(), unseen: emptyTally() },
  };
  for (const label of sorted.slice(cut)) {
    const unseen = !seen.has(memoryKey(label));
    count(result.today.all, today, label);
    count(result.withModel.all, withModel, label);
    if (unseen) {
      count(result.today.unseen, today, label);
      count(result.withModel.unseen, withModel, label);
    }
  }
  return result;
}

export function measureLabels(
  labels: readonly MeasureLabel[],
  own: Own,
  embedder: Embedder,
  open: readonly CascadeMovement[],
): Measure {
  const { today, withModel } = knowledgeOf(labels, own, embedder);
  return {
    labels: labels.length,
    ...grouped(labels, own, embedder),
    open: { movements: open.length, today: reach(today, open), withModel: reach(withModel, open) },
    chronological: chronological(labels, own, embedder),
  };
}
