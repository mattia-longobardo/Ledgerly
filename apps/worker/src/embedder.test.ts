import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { convert } from "../../../scripts/convert-embeddings";
import {
  TINY_SHAPE,
  TINY_VOCAB,
  tinySafetensors,
  tinyTokenizer,
} from "../../../test/fixtures/embeddings/tiny";
import { embedderFrom, piecesOf, tokensOf, wordsOfText } from "./embedder";

// The worker's reader of the embedding model (R6): the tokenizer the approved model was trained
// with (BERT uncased WordPiece: lower case, accents off) and the file the conversion writes.
const vocab = new Map(TINY_VOCAB.map((token, id) => [token, id]));
const file = convert(tinySafetensors(), tinyTokenizer(), TINY_SHAPE);
const sha256 = createHash("sha256").update(file).digest("hex");

describe("the tokenizer of the embedding model", () => {
  it("takes the accents off, like the approved normalizer: è, à, ò", () => {
    expect(wordsOfText("CAFFÈ Città PERÒ")).toEqual(["caffe", "citta", "pero"]);
    expect(wordsOfText("à è é ì ò ù")).toEqual(["a", "e", "e", "i", "o", "u"]);
  });

  it("cuts words at what is not a letter or a digit", () => {
    expect(wordsOfText("bar,sole  -- 12/11")).toEqual(["bar", "sole", "12", "11"]);
  });

  it("finds the longest piece first, then the ## pieces", () => {
    expect(piecesOf("farmacia", vocab)).toEqual([vocab.get("farm"), vocab.get("##acia")]);
    expect(piecesOf("bara", vocab)).toEqual([vocab.get("bar"), vocab.get("##a")]);
  });

  it("leaves out a word it cannot cut, and one too long", () => {
    expect(piecesOf("zzz", vocab)).toEqual([]);
    expect(piecesOf("bar".repeat(34), vocab)).toEqual([]);
    expect(tokensOf("Caffè zzz città", vocab)).toEqual([vocab.get("caffe"), vocab.get("citta")]);
  });
});

describe("the converted file", () => {
  it("is read only with the approved sha256", () => {
    expect(() => embedderFrom(file, "0".repeat(64))).toThrow("sha256");
    expect(embedderFrom(file, sha256).revision).toMatch(/^b68f4122.*:[0-9a-f]{12}$/);
  });

  it("refuses a file that is not a converted model, even with its own hash", () => {
    const other = Buffer.from("not a model");
    expect(() => embedderFrom(other, createHash("sha256").update(other).digest("hex"))).toThrow();
  });

  it("gives a vector of length one, the mean of the tokens' rows, the same every time", () => {
    const embedder = embedderFrom(file, sha256);
    const vector = embedder.embed("Caffè");
    expect(vector).toHaveLength(TINY_SHAPE.columns);
    expect(Math.hypot(...vector)).toBeCloseTo(1, 5);
    expect(embedder.embed("Caffè")).toEqual(vector);
    expect(embedder.embed("CAFFE")).toEqual(vector);
    const row = [2, 2.1, 2.2, 2.3];
    const length = Math.hypot(...row);
    row.forEach((value, at) => expect(vector[at]).toBeCloseTo(value / length, 2));
  });

  it("gives zeros to a text with no known word", () => {
    expect([...embedderFrom(file, sha256).embed("zzz 123")]).toEqual([0, 0, 0, 0]);
  });
});
