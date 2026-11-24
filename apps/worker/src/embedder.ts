/**
 * The embedding model of the automatic categories (rewrite plan R6, decision H56): static
 * embeddings, a vector for each token of a WordPiece vocabulary, read from one file in the image.
 * The worker is the one process that loads it; the cascade gets it through `setEmbedder`.
 *
 * Security Gatekeeper verdict on the model: the file is the one `scripts/convert-embeddings.ts`
 * wrote at build time from the approved revision, its sha256 is fixed here, its path is fixed
 * too. No network, no other process: nothing in this file opens a connection or runs a program
 * (`tools/architecture.test.ts`). A file that is missing or not the one approved turns the level
 * off — the cascade of before R6 — and the log says why, with no text of any movement.
 */
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import type { Embedder } from "@ledgerly/domain/transactions";

/** Under the worker's directory (`/app` in the image). Fixed: never from the environment or a request. */
const MODEL_FILE = "models/categories-embeddings.bin";
/** The sha256 of the file the approved revision converts to (`scripts/convert-embeddings.ts`). */
const MODEL_SHA256 = "f2820ba7de92e15fc810dc598a1a7ca6a4643de1926237d452267d45f687f0e1";

const MAGIC = "LDGEMB01";
const UNKNOWN = "[UNK]";
const CONTINUATION = "##";
/** As the approved tokenizer: a longer word is unknown. */
const MAX_WORD = 100;

interface Header {
  revision: string;
  dimensions: number;
  rows: number;
  vocab: string[];
}

/** Lower case, no accents (BERT "uncased"), words of letters and digits only. */
export function wordsOfText(text: string): string[] {
  return text
    .normalize("NFKD")
    .replace(/\p{Mn}/gu, "")
    .toLowerCase()
    .split(/[^\p{L}\p{N}]+/u)
    .filter((word) => word !== "");
}

/**
 * The tokens of one word: the longest piece of the vocabulary from its start, then the longest
 * `##` piece from where that one ends, and so on. A word that cannot be cut so is unknown: none.
 */
export function piecesOf(word: string, vocab: ReadonlyMap<string, number>): number[] {
  if (word.length > MAX_WORD) return [];
  const pieces: number[] = [];
  let start = 0;
  while (start < word.length) {
    let end = word.length;
    let found: number | undefined;
    while (end > start && found === undefined) {
      found = vocab.get((start > 0 ? CONTINUATION : "") + word.slice(start, end));
      if (found === undefined) end -= 1;
    }
    if (found === undefined) return [];
    pieces.push(found);
    start = end;
  }
  return pieces;
}

/** The tokens of a text, the unknown ones left out: they say nothing of what the text is about. */
export function tokensOf(text: string, vocab: ReadonlyMap<string, number>): number[] {
  return wordsOfText(text).flatMap((word) => piecesOf(word, vocab));
}

/** The header of a converted file and where its matrix starts. Throws on any other file. */
function headerOf(bytes: Buffer): { header: Header; offset: number } {
  if (bytes.subarray(0, MAGIC.length).toString("latin1") !== MAGIC) throw new Error("not a converted model");
  const length = bytes.readUInt32LE(MAGIC.length);
  const start = MAGIC.length + 4;
  const header: unknown = JSON.parse(bytes.subarray(start, start + length).toString("utf8"));
  if (!isHeader(header)) throw new Error("the header is not the expected one");
  const offset = start + length + ((start + length) % 2);
  if (bytes.length !== offset + header.rows * header.dimensions * 2)
    throw new Error("the matrix is not whole");
  if (header.vocab.length !== header.rows) throw new Error("rows and vocabulary differ");
  return { header, offset };
}

function isHeader(value: unknown): value is Header {
  return (
    typeof value === "object" &&
    value !== null &&
    "revision" in value &&
    typeof value.revision === "string" &&
    "dimensions" in value &&
    Number.isInteger(value.dimensions) &&
    "rows" in value &&
    Number.isInteger(value.rows) &&
    "vocab" in value &&
    Array.isArray(value.vocab) &&
    value.vocab.every((token) => typeof token === "string")
  );
}

/** The model in a converted file, when its sha256 is `sha256`. Throws otherwise. */
export function embedderFrom(bytes: Buffer, sha256: string): Embedder {
  const actual = createHash("sha256").update(bytes).digest("hex");
  if (actual !== sha256) throw new Error("the file is not the approved one (sha256)");
  const { header, offset } = headerOf(bytes);
  const matrix = new Float16Array(
    bytes.buffer.slice(bytes.byteOffset + offset, bytes.byteOffset + bytes.length),
  );
  const vocab = new Map(header.vocab.map((token, index) => [token, index]));
  vocab.delete(UNKNOWN);
  const { dimensions } = header;
  return {
    revision: `${header.revision}:${sha256.slice(0, 12)}`,
    dimensions,
    embed(text: string): Float32Array {
      const vector = new Float32Array(dimensions);
      for (const token of tokensOf(text, vocab)) {
        const row = token * dimensions;
        for (let slot = 0; slot < dimensions; slot += 1) vector[slot] += matrix[row + slot];
      }
      let norm = 0;
      for (const value of vector) norm += value * value;
      const length = Math.sqrt(norm) || 1;
      for (let slot = 0; slot < dimensions; slot += 1) vector[slot] /= length;
      return vector;
    },
  };
}

/** The approved model from its fixed place, or `null` (and why, for the log) when it cannot be used. */
export function loadEmbedder(): { embedder: Embedder | null; reason: string } {
  try {
    const embedder = embedderFrom(readFileSync(resolve(MODEL_FILE)), MODEL_SHA256);
    return { embedder, reason: `loaded ${embedder.revision}` };
  } catch (error) {
    return { embedder: null, reason: error instanceof Error ? error.message : "unreadable" };
  }
}
