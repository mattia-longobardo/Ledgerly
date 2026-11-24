// scripts/convert-embeddings.ts — `node scripts/convert-embeddings.ts <model.safetensors>
// <tokenizer.json> <out>`, run by the `models` stage of the Dockerfile only (rewrite plan R6).
//
// Reads the approved static embeddings (sentence-transformers/static-similarity-mrl-multilingual-v1
// at the revision below, sha256 fixed by `ADD --checksum`), refuses anything that is not exactly
// that shape, and writes the one file the image keeps: the WordPiece vocabulary and the first
// `DIMENSIONS` columns of each row (the model is trained Matryoshka: a prefix is a smaller model),
// as float16. The worker reads it with `apps/worker/src/embedder.ts`, which checks its sha256.
//
// Plain Node (type stripping), no import but Node's: it runs in a build stage with no dependency.
import { readFileSync, writeFileSync } from "node:fs";

export const REVISION = "b68f4122911bcffcd6e1f695f2d99cd6788972d8";
export const MAGIC = "LDGEMB01";
const DIMENSIONS = 256;
/** Security Gatekeeper: a header larger than this is not the approved file. */
const MAX_HEADER = 1024 * 1024;
const TENSOR = "embedding.weight";

export interface Shape {
  rows: number;
  columns: number;
}

/** The approved model's shape: its vocabulary of 105 879 tokens, 1024 values each. */
const APPROVED: Shape = { rows: 105_879, columns: 1024 };

/** The matrix of a safetensors file with one F32 tensor `embedding.weight` of `shape`. Throws otherwise. */
export function matrixOf(bytes: Buffer, shape: Shape): Float32Array {
  if (bytes.length < 8) throw new Error("safetensors: too short");
  const length = Number(bytes.readBigUInt64LE(0));
  if (length > MAX_HEADER) throw new Error("safetensors: header larger than 1 MB");
  if (bytes.length < 8 + length) throw new Error("safetensors: header past the end");
  const header: unknown = JSON.parse(bytes.subarray(8, 8 + length).toString("utf8"));
  if (typeof header !== "object" || header === null || Object.keys(header).join() !== TENSOR) {
    throw new Error(`safetensors: tensors other than ${TENSOR}`);
  }
  const tensor: unknown = Object.values(header)[0];
  const size = shape.rows * shape.columns * 4;
  const expected = JSON.stringify({
    dtype: "F32",
    shape: [shape.rows, shape.columns],
    data_offsets: [0, size],
  });
  if (JSON.stringify(tensor) !== expected)
    throw new Error("safetensors: dtype, shape or offsets not the approved ones");
  if (bytes.length !== 8 + length + size) throw new Error("safetensors: offsets do not match the file size");
  const start = bytes.byteOffset + 8 + length;
  const matrix = new Float32Array(bytes.buffer.slice(start, start + size));
  for (const value of matrix) if (!Number.isFinite(value)) throw new Error("safetensors: NaN or Infinity");
  return matrix;
}

/**
 * The vocabulary of the approved tokenizer: token by id, ids 0..n-1. Read with `JSON.parse` only.
 * Throws on a tokenizer the worker's WordPiece would read differently.
 */
export function vocabularyOf(text: string): string[] {
  const parsed: unknown = JSON.parse(text);
  const tokenizer = parsed !== null && typeof parsed === "object" ? parsed : {};
  const normalizer = "normalizer" in tokenizer ? JSON.stringify(tokenizer.normalizer) : "";
  const model =
    "model" in tokenizer && tokenizer.model !== null && typeof tokenizer.model === "object"
      ? tokenizer.model
      : {};
  const expectedNormalizer = JSON.stringify({
    type: "BertNormalizer",
    clean_text: true,
    handle_chinese_chars: true,
    strip_accents: null,
    lowercase: true,
  });
  const wordPiece =
    "type" in model &&
    model.type === "WordPiece" &&
    "unk_token" in model &&
    model.unk_token === "[UNK]" &&
    "continuing_subword_prefix" in model &&
    model.continuing_subword_prefix === "##";
  const vocab = "vocab" in model ? model.vocab : null;
  if (normalizer !== expectedNormalizer || !wordPiece || typeof vocab !== "object" || vocab === null) {
    throw new Error("tokenizer: not the approved WordPiece of BERT uncased");
  }
  const entries = Object.entries(vocab);
  const vocabulary: string[] = new Array(entries.length);
  for (const [token, id] of entries) {
    if (
      typeof id !== "number" ||
      !Number.isInteger(id) ||
      id < 0 ||
      id >= entries.length ||
      vocabulary[id] !== undefined
    ) {
      throw new Error("tokenizer: ids are not 0..n-1");
    }
    vocabulary[id] = token;
  }
  return vocabulary;
}

/** The converted file: magic, header length, header (JSON), padding to two bytes, float16 matrix. */
export function convert(safetensors: Buffer, tokenizer: string, shape: Shape = APPROVED): Buffer {
  const matrix = matrixOf(safetensors, shape);
  const vocab = vocabularyOf(tokenizer);
  if (vocab.length !== shape.rows) throw new Error("rows and vocabulary differ");
  const dimensions = Math.min(DIMENSIONS, shape.columns);
  const header = Buffer.from(
    JSON.stringify({ revision: REVISION, dimensions, rows: shape.rows, vocab }),
    "utf8",
  );
  const prefix = Buffer.alloc(MAGIC.length + 4 + header.length + ((MAGIC.length + 4 + header.length) % 2));
  prefix.write(MAGIC, 0, "latin1");
  prefix.writeUInt32LE(header.length, MAGIC.length);
  header.copy(prefix, MAGIC.length + 4);
  const out = new Float16Array(shape.rows * dimensions);
  for (let row = 0; row < shape.rows; row += 1) {
    out.set(matrix.subarray(row * shape.columns, row * shape.columns + dimensions), row * dimensions);
  }
  return Buffer.concat([prefix, Buffer.from(out.buffer)]);
}

if (process.argv[1]?.endsWith("convert-embeddings.ts")) {
  const [source, tokenizer, target] = process.argv.slice(2);
  writeFileSync(target, convert(readFileSync(source), readFileSync(tokenizer, "utf8")));
}
