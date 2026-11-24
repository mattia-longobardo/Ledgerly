import { describe, expect, it } from "vitest";
import { convert, matrixOf, vocabularyOf } from "../scripts/convert-embeddings";
import {
  safetensors,
  TINY_SHAPE,
  TINY_VOCAB,
  tinyMatrix,
  tinySafetensors,
  tinyTokenizer,
} from "../test/fixtures/embeddings/tiny";

// The conversion of the embedding model (R6), as the Security Gatekeeper asked it (condition 2):
// anything but the approved shape is refused before a byte is written.
const SIZE = TINY_SHAPE.rows * TINY_SHAPE.columns * 4;
const tensor = (overrides: Record<string, unknown> = {}) => ({
  dtype: "F32",
  shape: [TINY_SHAPE.rows, TINY_SHAPE.columns],
  data_offsets: [0, SIZE],
  ...overrides,
});

describe("the conversion of the embedding model", () => {
  it("reads the approved shape", () => {
    expect(matrixOf(tinySafetensors(), TINY_SHAPE)).toEqual(tinyMatrix());
    expect(vocabularyOf(tinyTokenizer())).toEqual(TINY_VOCAB);
  });

  it("refuses a header larger than 1 MB", () => {
    const big = safetensors({ "embedding.weight": tensor() }, tinyMatrix(), 1024 * 1024);
    expect(() => matrixOf(big, TINY_SHAPE)).toThrow("header larger than 1 MB");
  });

  it("refuses any tensor but one F32 embedding.weight of the approved shape", () => {
    const cases = [
      { other: tensor() },
      { "embedding.weight": tensor(), other: tensor() },
      { "embedding.weight": tensor({ dtype: "F16" }) },
      { "embedding.weight": tensor({ shape: [TINY_SHAPE.rows + 1, TINY_SHAPE.columns] }) },
    ];
    for (const header of cases)
      expect(() => matrixOf(safetensors(header, tinyMatrix()), TINY_SHAPE)).toThrow();
  });

  it("refuses offsets that are not the size of the data, and data past or short of them", () => {
    const shifted = safetensors(
      { "embedding.weight": tensor({ data_offsets: [4, SIZE + 4] }) },
      tinyMatrix(),
    );
    expect(() => matrixOf(shifted, TINY_SHAPE)).toThrow("offsets");
    const longer = Buffer.concat([tinySafetensors(), Buffer.alloc(4)]);
    expect(() => matrixOf(longer, TINY_SHAPE)).toThrow("offsets do not match the file size");
    expect(() => matrixOf(tinySafetensors().subarray(0, 100), TINY_SHAPE)).toThrow();
  });

  it("refuses a NaN or an infinity anywhere in the matrix", () => {
    for (const bad of [Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY]) {
      const matrix = tinyMatrix();
      matrix[matrix.length - 1] = bad;
      expect(() => matrixOf(tinySafetensors(TINY_SHAPE, matrix), TINY_SHAPE)).toThrow("NaN or Infinity");
    }
  });

  it("refuses rows that are not the vocabulary", () => {
    expect(() => convert(tinySafetensors(), tinyTokenizer(TINY_VOCAB.slice(1)), TINY_SHAPE)).toThrow(
      "rows and vocabulary differ",
    );
  });

  it("refuses a tokenizer that is not the approved WordPiece, or whose ids have holes", () => {
    expect(() => vocabularyOf(tinyTokenizer(TINY_VOCAB, { normalizer: { type: "NFC" } }))).toThrow(
      "WordPiece",
    );
    expect(() => vocabularyOf(tinyTokenizer(TINY_VOCAB, { model: { type: "BPE", vocab: {} } }))).toThrow(
      "WordPiece",
    );
    const holes = tinyTokenizer().replace('"sole":9', '"sole":12');
    expect(() => vocabularyOf(holes)).toThrow("0..n-1");
    expect(() => vocabularyOf("{")).toThrow();
  });

  it("writes the same bytes for the same input", () => {
    const first = convert(tinySafetensors(), tinyTokenizer(), TINY_SHAPE);
    expect(convert(tinySafetensors(), tinyTokenizer(), TINY_SHAPE).equals(first)).toBe(true);
  });
});
