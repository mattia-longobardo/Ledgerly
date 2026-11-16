/**
 * The classifier of the automatic categories (rewrite plan, 04-now.md §4.4): a multiclass logistic
 * regression over TF-IDF features, written here — no package. One model for each person, trained
 * from scratch every time, on the labels a person or a source confirmed and on nothing else.
 *
 * Everything is deterministic: the same examples in the same order give the same model, so a test
 * can hold a number and a person never sees a category change for no reason.
 */
import { FEATURE_DIMENSIONS, featureCounts, type MovementText } from "./text";

/** A confirmed label: a movement and the category a person or a source gave it. */
export interface Example extends MovementText {
  categoryId: string;
}

/** A movement as the model sees it: positions and their weights, of length one. */
interface Vector {
  indexes: Int32Array;
  values: Float32Array;
}

export interface Model {
  /** The categories the model can answer, in the order of its rows. */
  classes: string[];
  /** How rare each position is among the examples: the "IDF" of TF-IDF. */
  idf: Float32Array;
  /** One row of `FEATURE_DIMENSIONS` weights for each class, and a bias for each class. */
  weights: Float32Array;
  bias: Float32Array;
}

/** The fewest confirmed labels a model is trained from, and the fewest a category needs to be in it. */
export const MIN_EXAMPLES = 50;
export const MIN_PER_CLASS = 3;

const EPOCHS = 12;
const LEARNING_RATE = 0.5;
const REGULARISATION = 1e-5;

function idfOf(counts: readonly Map<number, number>[]): Float32Array {
  const seen = new Float32Array(FEATURE_DIMENSIONS);
  for (const one of counts) for (const index of one.keys()) seen[index] += 1;
  const idf = new Float32Array(FEATURE_DIMENSIONS);
  for (let index = 0; index < FEATURE_DIMENSIONS; index += 1) {
    idf[index] = Math.log((1 + counts.length) / (1 + seen[index])) + 1;
  }
  return idf;
}

function vectorOf(counts: Map<number, number>, idf: Float32Array): Vector {
  const indexes = new Int32Array(counts.size);
  const values = new Float32Array(counts.size);
  let at = 0;
  let norm = 0;
  for (const [index, count] of counts) {
    const value = (1 + Math.log(count)) * idf[index];
    indexes[at] = index;
    values[at] = value;
    norm += value * value;
    at += 1;
  }
  const length = Math.sqrt(norm) || 1;
  for (let i = 0; i < values.length; i += 1) values[i] /= length;
  return { indexes, values };
}

function scores(model: Model, vector: Vector): Float64Array {
  const out = new Float64Array(model.classes.length);
  for (let klass = 0; klass < out.length; klass += 1) {
    let sum = model.bias[klass];
    const row = klass * FEATURE_DIMENSIONS;
    for (let i = 0; i < vector.indexes.length; i += 1) {
      sum += model.weights[row + vector.indexes[i]] * vector.values[i];
    }
    out[klass] = sum;
  }
  return out;
}

function softmax(values: Float64Array): Float64Array {
  let max = -Infinity;
  for (const value of values) if (value > max) max = value;
  let total = 0;
  const out = new Float64Array(values.length);
  for (let i = 0; i < values.length; i += 1) {
    out[i] = Math.exp(values[i] - max);
    total += out[i];
  }
  for (let i = 0; i < out.length; i += 1) out[i] /= total;
  return out;
}

/** A fixed pseudo-random order (mulberry32): the examples are shuffled the same way every time. */
function shuffled(length: number, seed: number): Int32Array {
  const order = new Int32Array(length);
  for (let i = 0; i < length; i += 1) order[i] = i;
  let state = seed >>> 0;
  const next = () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  for (let i = length - 1; i > 0; i -= 1) {
    const j = Math.floor(next() * (i + 1));
    const kept = order[i];
    order[i] = order[j];
    order[j] = kept;
  }
  return order;
}

/** The categories with enough examples to be learnt, in a stable order. */
export function learnableClasses(examples: readonly Pick<Example, "categoryId">[]): string[] {
  const counts = new Map<string, number>();
  for (const example of examples) counts.set(example.categoryId, (counts.get(example.categoryId) ?? 0) + 1);
  return [...counts]
    .filter(([, count]) => count >= MIN_PER_CLASS)
    .map(([categoryId]) => categoryId)
    .sort();
}

/**
 * Trains a model, or answers `null` when the labels are too few to learn from (fewer than
 * `MIN_EXAMPLES` in categories that have at least `MIN_PER_CLASS` each, or one category only).
 */
export function train(examples: readonly Example[]): Model | null {
  const classes = learnableClasses(examples);
  const classOf = new Map(classes.map((categoryId, index) => [categoryId, index]));
  const usable = examples.filter((example) => classOf.has(example.categoryId));
  if (classes.length < 2 || usable.length < MIN_EXAMPLES) return null;

  const counts = usable.map(featureCounts);
  const idf = idfOf(counts);
  const vectors = counts.map((one) => vectorOf(one, idf));
  const labels = usable.map((example) => classOf.get(example.categoryId) as number);
  const model: Model = {
    classes,
    idf,
    weights: new Float32Array(classes.length * FEATURE_DIMENSIONS),
    bias: new Float32Array(classes.length),
  };

  for (let epoch = 0; epoch < EPOCHS; epoch += 1) {
    const rate = LEARNING_RATE / (1 + epoch * 0.3);
    for (const at of shuffled(vectors.length, epoch + 1)) {
      const vector = vectors[at];
      const probabilities = softmax(scores(model, vector));
      for (let klass = 0; klass < classes.length; klass += 1) {
        const error = probabilities[klass] - (klass === labels[at] ? 1 : 0);
        if (Math.abs(error) < 1e-4) continue;
        const row = klass * FEATURE_DIMENSIONS;
        for (let i = 0; i < vector.indexes.length; i += 1) {
          const position = row + vector.indexes[i];
          model.weights[position] -=
            rate * (error * vector.values[i] + REGULARISATION * model.weights[position]);
        }
        model.bias[klass] -= rate * error;
      }
    }
  }
  return model;
}

/** What the model says about one movement: its best category, and how sure it is (0 to 1). */
export interface Prediction {
  categoryId: string;
  confidence: number;
}

export function predict(model: Model, movement: MovementText): Prediction {
  const probabilities = softmax(scores(model, vectorOf(featureCounts(movement), model.idf)));
  let best = 0;
  for (let klass = 1; klass < probabilities.length; klass += 1) {
    if (probabilities[klass] > probabilities[best]) best = klass;
  }
  return { categoryId: model.classes[best], confidence: probabilities[best] };
}

/** A prediction made on an example the model did not see, and whether it was right. */
export interface Trial {
  confidence: number;
  correct: boolean;
}

const FOLDS = 5;

/**
 * Predictions out of sample (04-now.md §4.4, "Soglia"): the examples are split in folds, and each
 * fold is predicted by a model trained on the others. What the thresholds are worked out from: a
 * model graded on the examples it learnt would always look right.
 */
export function outOfSample(examples: readonly Example[]): Trial[] {
  const trials: Trial[] = [];
  const order = shuffled(examples.length, 7);
  for (let fold = 0; fold < FOLDS; fold += 1) {
    const held: Example[] = [];
    const rest: Example[] = [];
    order.forEach((at, position) => (position % FOLDS === fold ? held : rest).push(examples[at]));
    const model = train(rest);
    if (model === null) continue;
    for (const example of held) {
      const prediction = predict(model, example);
      trials.push({
        confidence: prediction.confidence,
        correct: prediction.categoryId === example.categoryId,
      });
    }
  }
  return trials;
}

/* Storage */

/** A model as it is stored: numbers as base64, so a row is one text and not a million array items. */
export interface StoredModel {
  dimensions: number;
  classes: string[];
  idf: string;
  weights: string;
  bias: string;
}

const encode = (values: Float32Array) =>
  Buffer.from(values.buffer, values.byteOffset, values.byteLength).toString("base64");

function decode(text: string): Float32Array {
  const bytes = Buffer.from(text, "base64");
  return new Float32Array(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength));
}

export function storeModel(model: Model): StoredModel {
  return {
    dimensions: FEATURE_DIMENSIONS,
    classes: model.classes,
    idf: encode(model.idf),
    weights: encode(model.weights),
    bias: encode(model.bias),
  };
}

/** `null` for a model of another shape: one stored by a release whose features were different. */
export function loadModel(stored: StoredModel): Model | null {
  if (stored.dimensions !== FEATURE_DIMENSIONS) return null;
  const model = {
    classes: stored.classes,
    idf: decode(stored.idf),
    weights: decode(stored.weights),
    bias: decode(stored.bias),
  };
  const sound =
    model.idf.length === FEATURE_DIMENSIONS &&
    model.bias.length === model.classes.length &&
    model.weights.length === model.classes.length * FEATURE_DIMENSIONS;
  return sound ? model : null;
}
