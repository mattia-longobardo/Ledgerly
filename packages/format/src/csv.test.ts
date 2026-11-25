import { describe, expect, it } from "vitest";
import { csvDocument, csvField, csvRow, csvText } from "./csv";

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

describe("a text that would start a formula (SEC-07)", () => {
  it("gets a leading quote, so a spreadsheet shows it as text", () => {
    expect(csvField('=HYPERLINK("http://x","y")')).toBe(`"'=HYPERLINK(""http://x"",""y"")"`);
    expect(csvField("+A1*2")).toBe("'+A1*2");
    expect(csvField("-cmd")).toBe("'-cmd");
    expect(csvField("@SUM(A1)")).toBe("'@SUM(A1)");
    expect(csvField("\tTab")).toBe("'\tTab");
    expect(csvField("\rReturn")).toBe(`"'\rReturn"`);
  });

  it("leaves a number alone, negative or written in a locale's format", () => {
    expect(csvField(-12.5)).toBe("-12.5");
    expect(csvField("-12.50")).toBe("-12.50");
    expect(csvField("-1.234,56")).toBe("-1.234,56");
    expect(csvField("+5")).toBe("+5");
    expect(csvField("2026-11-25")).toBe("2026-11-25");
    expect(csvField("Esselunga - Milano")).toBe("Esselunga - Milano");
  });

  it("comes back as it left when read as text", () => {
    for (const text of ["=1+1", "-cmd", "@x", "plain", "'quoted", "-12.50"])
      expect(csvText(csvField(text))).toBe(text);
  });
});
