/**
 * The embedding model of the automatic categories (rewrite plan R6, decision H56): what the cascade
 * knows of it. The model itself is loaded by the worker only (`apps/worker/src/embedder.ts`) and
 * handed to `setEmbedder` (`categorize/service.ts`) at its start; every other process — the API, a
 * reading run inline — has none, and the cascade there is the one of before R6.
 */

/** A model that turns a text into a vector of length one. Local, on the CPU, deterministic. */
export interface Embedder {
  /** Which model and which conversion: a classifier trained on another one is not used. */
  revision: string;
  dimensions: number;
  embed(text: string): Float32Array;
}

/** Cosine of two vectors of length one. */
export function cosine(left: Float32Array, right: Float32Array): number {
  let sum = 0;
  for (let slot = 0; slot < left.length; slot += 1) sum += left[slot] * right[slot];
  return sum;
}
