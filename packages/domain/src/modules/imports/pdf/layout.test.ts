import { describe, expect, it } from "vitest";
import {
  boxOf,
  cellsOf,
  labelFor,
  labelKey,
  labelRows,
  parseItalianNumber,
  tokensOf,
  valueRows,
} from "./layout";
import type { TextItem } from "./text";

function item(text: string, x0: number, baseline: number, size: number, width?: number): TextItem {
  const x1 = x0 + (width ?? text.length * size * 0.6);
  return { text, page: 1, x0, x1, top: baseline - size * 0.8, bottom: baseline + size * 0.2, baseline, size };
}

describe("tokensOf", () => {
  it("splits a fixed-pitch run into words at their own positions", () => {
    expect(
      tokensOf(item("1,00 2.345,67000", 240.5, 260, 10)).map(({ text, x0, x1 }) => [text, x0, x1]),
    ).toEqual([
      ["1,00", 240.5, 264.5],
      ["2.345,67000", 270.5, 336.5],
    ]);
  });
});

describe("labelKey", () => {
  it("compares labels whatever the spacing and the dots of the generator", () => {
    expect(labelKey("MES E RETRIBUITO")).toBe(labelKey("MESE RETRIBUITO"));
    expect(labelKey("ROL. GOD.")).toBe("ROLGOD");
    expect(labelKey("CONGUAGLIO IRPEF +/-")).toBe("CONGUAGLIOIRPEF+/-");
  });
});

describe("labelRows", () => {
  it("groups labels by baseline and joins a label's second line to it", () => {
    const rows = labelRows([
      item("COD.", 113.4, 100.3, 5, 12.5),
      item("AZIENDA", 113.4, 106, 5, 21.1),
      item("MESE RETRIBUITO", 27, 100, 5, 45.6),
      item("ARROTONDAMENTO", 428.3, 604.3, 5, 48.5),
      item("ATTUALE", 442.4, 608.6, 5, 21.6),
      item("NETTO BUSTA", 487.6, 604.5, 5, 35.3),
      item("AGOSTO", 24.5, 116, 10),
    ]);
    expect(rows.map((row) => row.labels.map((label) => label.key))).toEqual([
      ["MESERETRIBUITO", "CODAZIENDA"],
      ["ARROTONDAMENTOATTUALE", "NETTOBUSTA"],
    ]);
  });
});

describe("labelFor and cellsOf", () => {
  const labels = labelRows([
    item("TOTALE LORDO", 27, 484.3, 5, 39.6),
    item("IMPON. CONTR. SOC.", 111.3, 484.3, 5, 51.4),
    item("TOTALE CONTRIBUTI SOCIALI", 487.6, 484.5, 5, 73),
  ]);

  it("gives a value to the last label that starts before the value ends", () => {
    const [row] = valueRows([item("2.345,67", 54.5, 500, 10), item("183,80", 528.5, 500, 10)]);
    expect(row.tokens.map((token) => labelFor(labels[0].labels, token)?.key)).toEqual([
      "TOTALELORDO",
      "TOTALECONTRIBUTISOCIALI",
    ]);
  });

  it("fills only the label row a value row sits under, one line's height above", () => {
    const [row] = valueRows([item("2.345,67", 54.5, 500, 10)]);
    expect(
      cellsOf(labels, row).map((cell) => [cell.label.key, cell.tokens.map((token) => token.text)]),
    ).toEqual([["TOTALELORDO", ["2.345,67"]]]);
    const [far] = valueRows([item("2.345,67", 54.5, 540, 10)]);
    expect(cellsOf(labels, far)).toEqual([]);
  });
});

describe("boxOf", () => {
  it("is the tokens' box as fractions of the page, origin top left", () => {
    const [x0, y0, x1, y1] = boxOf([item("1.987,00", 522.5, 620, 10)], { width: 595.28, height: 841.88 });
    expect(x0).toBeCloseTo(522.5 / 595.28, 4);
    expect(x1).toBeCloseTo(570.5 / 595.28, 4);
    expect(y0).toBeCloseTo(612 / 841.88, 4);
    expect(y1).toBeCloseTo(622 / 841.88, 4);
  });
});

describe("parseItalianNumber", () => {
  it.each([
    ["2.345,67", "2345.67"],
    ["-20,40", "-20.40"],
    ["20,40-", "-20.40"],
    ["1278,42", "1278.42"],
    ["2.345,67000", "2345.67000"],
    ["-11,56069", "-11.56069"],
    ["0,00", "0.00"],
    ["-0,00", "0.00"],
    ["25", "25"],
    ["1.234.567,89", "1234567.89"],
  ])("%s → %s", (text, expected) => {
    expect(parseItalianNumber(text)).toBe(expected);
  });

  it.each(["", "1,2,3", "12.34", "+1,00-", "1.23,45", "abc", "1 000,00"])("refuses %j", (text) => {
    expect(parseItalianNumber(text)).toBeNull();
  });
});
