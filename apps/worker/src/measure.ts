/**
 * `node /app/worker.mjs --measure-categories` (rewrite plan R6, "Misura prima/dopo"): the cascade
 * of today and the one with the embedding model, graded on every person's confirmed labels, read
 * only. It prints the sums and nothing else: no text, id or amount of a movement, no person.
 */
import {
  categorisableAccountIds,
  type Diagnosis,
  type Embedder,
  type Measure,
  measureCategories,
  type Reach,
  type Tally,
  type TopK,
} from "@ledgerly/domain/transactions";
import { forEachUser } from "@ledgerly/domain/users";

const tally = (): Tally => ({ graded: 0, automatic: 0, automaticRight: 0, suggested: 0, suggestedRight: 0 });

function addTally(into: Tally, from: Tally): void {
  into.graded += from.graded;
  into.automatic += from.automatic;
  into.automaticRight += from.automaticRight;
  into.suggested += from.suggested;
  into.suggestedRight += from.suggestedRight;
}

function addReach(into: Reach, from: Reach): void {
  into.automatic += from.automatic;
  into.suggested += from.suggested;
}

function emptyMeasure(): Measure {
  return {
    labels: 0,
    grouped: { today: tally(), withModel: tally(), withoutColdStart: tally(), coldStartAlone: tally() },
    open: { movements: 0, today: { automatic: 0, suggested: 0 }, withModel: { automatic: 0, suggested: 0 } },
    chronological: { today: { all: tally(), unseen: tally() }, withModel: { all: tally(), unseen: tally() } },
    diagnosis: emptyDiagnosis(),
  };
}

const topK = (): TopK => ({ graded: 0, top1: 0, top3: 0, noModel: 0 });
const reasons = () => ({ examples: 0, support: 0, floor: 0, precision: 0, aboveAutomatic: 0 });

function emptyDiagnosis(): Diagnosis {
  return {
    texts: 0,
    categories: 0,
    perCategory: [],
    folds: 0,
    accuracy: { coldStart: topK(), model: topK(), today: topK() },
    nullThresholds: {
      todayAutomatic: reasons(),
      todaySuggestion: reasons(),
      modelAutomatic: reasons(),
      modelSuggestion: reasons(),
      coldStart: reasons(),
    },
  };
}

const SLOTS = [
  "todayAutomatic",
  "todaySuggestion",
  "modelAutomatic",
  "modelSuggestion",
  "coldStart",
] as const;
const REASONS = ["examples", "support", "floor", "precision", "aboveAutomatic"] as const;

function addDiagnosis(sum: Diagnosis, one: Diagnosis): void {
  sum.texts += one.texts;
  sum.categories += one.categories;
  sum.perCategory.push(...one.perCategory);
  sum.folds += one.folds;
  for (const name of ["coldStart", "model", "today"] as const) {
    sum.accuracy[name].graded += one.accuracy[name].graded;
    sum.accuracy[name].top1 += one.accuracy[name].top1;
    sum.accuracy[name].top3 += one.accuracy[name].top3;
    sum.accuracy[name].noModel += one.accuracy[name].noModel;
  }
  for (const slot of SLOTS) {
    for (const reason of REASONS) sum.nullThresholds[slot][reason] += one.nullThresholds[slot][reason];
  }
}

/** The accuracy with no threshold: the right category first, or among the first three. */
const accuracy = (one: TopK) => ({
  ...one,
  top1Share: share(one.top1, one.graded),
  top3Share: share(one.top3, one.graded),
});

function spread(counts: readonly number[]) {
  const sorted = [...counts].sort((left, right) => left - right);
  const middle = Math.floor(sorted.length / 2);
  const median =
    sorted.length === 0
      ? null
      : sorted.length % 2
        ? sorted[middle]
        : (sorted[middle - 1] + sorted[middle]) / 2;
  return { min: sorted[0] ?? null, median, max: sorted.at(-1) ?? null };
}

function diagnosisOut(one: Diagnosis) {
  return {
    texts: one.texts,
    categories: one.categories,
    labelsPerCategory: spread(one.perCategory),
    folds: one.folds,
    accuracyWithoutThreshold: {
      coldStart: accuracy(one.accuracy.coldStart),
      classifierWithModel: accuracy(one.accuracy.model),
      classifierToday: accuracy(one.accuracy.today),
    },
    nullThresholdsByReason: one.nullThresholds,
  };
}

function addMeasure(sum: Measure, one: Measure): void {
  sum.labels += one.labels;
  for (const name of ["today", "withModel", "withoutColdStart", "coldStartAlone"] as const) {
    addTally(sum.grouped[name], one.grouped[name]);
  }
  sum.open.movements += one.open.movements;
  addReach(sum.open.today, one.open.today);
  addReach(sum.open.withModel, one.open.withModel);
  for (const side of ["today", "withModel"] as const) {
    addTally(sum.chronological[side].all, one.chronological[side].all);
    addTally(sum.chronological[side].unseen, one.chronological[side].unseen);
  }
  addDiagnosis(sum.diagnosis, one.diagnosis);
}

const share = (part: number, whole: number) =>
  whole === 0 ? null : Math.round((part / whole) * 1000) / 1000;

/** Coverage and precision of a tally, rounded: what the acceptance of R6 reads. */
function rates(one: Tally) {
  return {
    ...one,
    automaticCoverage: share(one.automatic, one.graded),
    automaticPrecision: share(one.automaticRight, one.automatic),
    suggestedCoverage: share(one.suggested, one.graded),
    suggestedPrecision: share(one.suggestedRight, one.suggested),
  };
}

/** Coverage only: a movement nobody filed has no right answer to grade against. */
function coverage(one: Reach, movements: number) {
  return {
    ...one,
    automaticCoverage: share(one.automatic, movements),
    suggestedCoverage: share(one.suggested, movements),
  };
}

/** The sums over every person, as one JSON document. */
export async function measureAll(embedder: Embedder): Promise<string> {
  const sum = emptyMeasure();
  let measured = 0;
  const { users, failed } = await forEachUser("measure-categories", async (_person, ctx) => {
    addMeasure(sum, await measureCategories(ctx, embedder, await categorisableAccountIds(ctx)));
    measured += 1;
  });
  const { grouped, open, chronological } = sum;
  return JSON.stringify(
    {
      model: embedder.revision,
      users,
      measured,
      failed,
      labels: sum.labels,
      groupedByText: {
        today: rates(grouped.today),
        withModel: rates(grouped.withModel),
        withModelWithoutColdStart: rates(grouped.withoutColdStart),
        coldStartAlone: rates(grouped.coldStartAlone),
      },
      withoutCategoryToday: {
        movements: open.movements,
        precision: "not measurable: no confirmed category",
        today: coverage(open.today, open.movements),
        withModel: coverage(open.withModel, open.movements),
      },
      diagnosisOfTextsNeverSeen: diagnosisOut(sum.diagnosis),
      chronological: {
        today: { all: rates(chronological.today.all), unseen: rates(chronological.today.unseen) },
        withModel: { all: rates(chronological.withModel.all), unseen: rates(chronological.withModel.unseen) },
      },
    },
    null,
    2,
  );
}
