import { describe, expect, it } from "vitest";
import { csvDocument, csvField, csvRow } from "./csv";

describe("csvField", () => {
  it("leaves a plain value alone", () => {
    expect(csvField("Esselunga")).toBe("Esselunga");
    expect(csvField(42)).toBe("42");
  });

  it("writes nothing for an unknown value", () => {
    expect(csvField(null)).toBe("");
    expect(csvField(undefined)).toBe("");
  });

  it("quotes a value holding the separator, a quote or a line break, and doubles the quotes", () => {
    expect(csvField("Milano; Roma")).toBe('"Milano; Roma"');
    expect(csvField('He said "yes"')).toBe('"He said ""yes"""');
    expect(csvField("two\nlines")).toBe('"two\nlines"');
    expect(csvField("carriage\rreturn")).toBe('"carriage\rreturn"');
  });

  it("does not quote a comma: the separator here is the semicolon", () => {
    expect(csvField("Milano, Roma")).toBe("Milano, Roma");
  });
});

describe("csvRow", () => {
  it("joins with semicolons", () => {
    expect(csvRow(["a", 1, null])).toBe("a;1;");
  });
});

describe("csvDocument", () => {
  it("opens with a BOM, separates rows with CRLF and ends with one", () => {
    const document = csvDocument(["name", "amount"], [["Netflix", "12.99"]]);
    expect(document).toBe("﻿name;amount\r\nNetflix;12.99\r\n");
  });

  it("writes a header alone when there are no rows", () => {
    expect(csvDocument(["name"], [])).toBe("﻿name\r\n");
  });
});
