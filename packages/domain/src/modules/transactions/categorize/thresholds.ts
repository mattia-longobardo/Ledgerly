/**
 * The two thresholds of the classifier (rewrite plan, 04-now.md §4.4, "Soglia"), worked out at
 * every training from the predictions out of sample. Above the high one a category is given
 * automatically; between the two it is only suggested. Pure.
 */
import type { Trial } from "./classifier";

/** The precision an automatic category has to have: of 20 given, 19 right (decision K2). */
const AUTOMATIC_PRECISION = 0.95;
/** The precision asked when a person corrected more than one automatic category in ten. */
const STRICT_PRECISION = 0.98;
/** The share of recent automatic categories corrected, past which the threshold rises. */
const CORRECTIONS_LIMIT = 0.1;
/** A suggestion is a help, not a count: right two times in three is worth showing. */
const SUGGESTION_PRECISION = 0.66;
/** Fewer predictions than this above a threshold prove nothing about its precision. */
export const MIN_SUPPORT = 20;
/** No category is given or suggested by a model that prefers it to the others by less than this. */
const FLOOR = 0.34;

export interface Thresholds {
  /** At or above: automatic. `null`: this model gives no category by itself. */
  automatic: number | null;
  /** At or above, and under `automatic`: a suggestion. `null`: this model suggests nothing. */
  suggestion: number | null;
}

/** How far under the precision asked one band of predictions may fall before the threshold stops. */
const BAND_SLACK = 0.05;

/**
 * The lowest confidence at which the predictions out of sample still reach `precision`, walking
 * from the surest down in bands of at least `MIN_SUPPORT`. The walk stops at the first band that
 * is not good enough by itself: a hundred sure predictions must not carry twenty doubtful ones
 * over the line — a shop a person files now here and now there stays under the threshold even
 * when the average of everything above it is fine. `null` when not even the surest band passes.
 */
export function thresholdFor(trials: readonly Trial[], precision: number): number | null {
  const sorted = [...trials].sort((a, b) => b.confidence - a.confidence);
  let found: number | null = null;
  let total = 0;
  let correct = 0;
  let band = 0;
  let bandCorrect = 0;
  for (let index = 0; index < sorted.length; index += 1) {
    const trial = sorted[index];
    band += 1;
    if (trial.correct) bandCorrect += 1;
    // A band ends between two different confidences: every prediction as sure as this one is in
    // it or none is. The last band may be short; it is judged like the others.
    const last = index === sorted.length - 1;
    if (!last && (band < MIN_SUPPORT || sorted[index + 1].confidence === trial.confidence)) continue;
    total += band;
    correct += bandCorrect;
    const good =
      total >= MIN_SUPPORT &&
      trial.confidence >= FLOOR &&
      bandCorrect / band >= precision - BAND_SLACK &&
      correct / total >= precision;
    if (!good) break;
    found = trial.confidence;
    band = 0;
    bandCorrect = 0;
  }
  return found;
}

/**
 * Both thresholds. `correctionRate` is the share of the automatic categories of the last 30 days
 * that a person corrected: past `CORRECTIONS_LIMIT` the model is trusted less.
 */
export function thresholdsFor(trials: readonly Trial[], correctionRate = 0): Thresholds {
  const target = correctionRate > CORRECTIONS_LIMIT ? STRICT_PRECISION : AUTOMATIC_PRECISION;
  const automatic = thresholdFor(trials, target);
  const suggestion = thresholdFor(trials, SUGGESTION_PRECISION);
  return {
    automatic,
    suggestion: suggestion !== null && automatic !== null && suggestion >= automatic ? null : suggestion,
  };
}

/** Precision and coverage of a set of trials at a threshold, for the report of a training. */
export function measure(
  trials: readonly Trial[],
  threshold: number | null,
): { precision: number | null; coverage: number } {
  if (threshold === null || trials.length === 0) return { precision: null, coverage: 0 };
  const taken = trials.filter((trial) => trial.confidence >= threshold);
  if (taken.length === 0) return { precision: null, coverage: 0 };
  return {
    precision: taken.filter((trial) => trial.correct).length / taken.length,
    coverage: taken.length / trials.length,
  };
}
