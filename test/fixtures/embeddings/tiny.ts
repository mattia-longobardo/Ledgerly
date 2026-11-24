// test/fixtures/embeddings/tiny.ts — a tiny model in the approved format (R6): a safetensors file
// with one F32 tensor `embedding.weight` and a WordPiece tokenizer of BERT uncased, both made up
// here, so the conversion and the worker's reader are tested without the real 434 MB file.

export const TINY_VOCAB = [
  "[PAD]",
  "[UNK]",
  "caffe",
  "citta",
  "pero",
  "##a",
  "bar",
  "farm",
  "##acia",
  "sole",
];
export const TINY_SHAPE = { rows: TINY_VOCAB.length, columns: 4 };

/** A tokenizer.json with the approved normalizer and model, and `vocab`. */
export function tinyTokenizer(
  vocab: readonly string[] = TINY_VOCAB,
  overrides: Record<string, unknown> = {},
): string {
  return JSON.stringify({
    normalizer: {
      type: "BertNormalizer",
      clean_text: true,
      handle_chinese_chars: true,
      strip_accents: null,
      lowercase: true,
    },
    pre_tokenizer: { type: "BertPreTokenizer" },
    model: {
      type: "WordPiece",
      unk_token: "[UNK]",
      continuing_subword_prefix: "##",
      max_input_chars_per_word: 100,
      vocab: Object.fromEntries(vocab.map((token, id) => [token, id])),
    },
    ...overrides,
  });
}

/** A safetensors file: 8 bytes of header length, the JSON header, the raw little-endian data. */
export function safetensors(header: unknown, data: Float32Array, headerPadding = 0): Buffer {
  const json = Buffer.from(JSON.stringify(header) + " ".repeat(headerPadding), "utf8");
  const length = Buffer.alloc(8);
  length.writeBigUInt64LE(BigInt(json.length));
  return Buffer.concat([length, json, Buffer.from(data.buffer, data.byteOffset, data.byteLength)]);
}

/** The values of row `row`: distinct per row, so a test can tell which tokens were read. */
export function tinyMatrix(shape = TINY_SHAPE): Float32Array {
  const matrix = new Float32Array(shape.rows * shape.columns);
  for (let row = 0; row < shape.rows; row += 1) {
    for (let column = 0; column < shape.columns; column += 1)
      matrix[row * shape.columns + column] = row + column / 10;
  }
  return matrix;
}

export function tinySafetensors(shape = TINY_SHAPE, matrix = tinyMatrix(shape)): Buffer {
  const size = shape.rows * shape.columns * 4;
  return safetensors(
    { "embedding.weight": { dtype: "F32", shape: [shape.rows, shape.columns], data_offsets: [0, size] } },
    matrix,
  );
}
