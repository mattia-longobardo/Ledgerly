import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { extractTeamSystem } from "./teamsystem";

const real = readFileSync(
  new URL("./__fixtures__/teamsystem-august-2026.txt", import.meta.url),
  "utf8",
);

/**
 * Expected values are the owner's own reading of the August 2026 payslip,
 * not the parser's output — this test exists to pin that mapping down.
 */
describe("TeamSystem payslip, real August 2026 layout", () => {
  const r = extractTeamSystem(real);

  it("reads NETTO BUSTA", () => expect(r.net).toBe(2093.0));
  it("reads TOTALE TRATTENUTE as the tax figure", () => expect(r.taxes).toBe(623.96));

  it("derives gross as net + taxes, not the printed TOTALE LORDO", () => {
    expect(r.gross).toBe(2716.96);
    expect(r.gross).not.toBe(2615.39); // the printed TOTALE LORDO
  });

  it("sums the three Cometa rows: 9110 + 8003 + 9109", () => {
    expect(r.fundEmployee).toBe(30.66); // 9110 COMUNICAZIONE DIPENDENTE
    expect(r.fundEmployer).toBe(249.94); // 8003 CONTRIBUZIONE TFR + 9109 FONDO C/AZIENDA
    expect(r.fundTotal).toBeCloseTo(280.6, 2);
  });

  it("reads the residuals from the flattened grid", () => {
    expect(r.ferieResidualHours).toBe(94.67); // FERIE RES.
    expect(r.rolResidualHours).toBe(91.33); // ROL. RES.
  });

  it("reads hours taken from the grid's GOD. columns", () => {
    expect(r.ferieTakenHours).toBe(12.01); // FERIE GOD.
    expect(r.rolTakenHours).toBe(0); // ROL. GOD., blank on this payslip
  });

  it("prefers the grid's FERIE GOD. over body row 300", () => {
    // This assertion used to read 8 — body row 300 `ASSENZA X FERIE A.C.(hh)`.
    // The owner checked the August 2026 payslip and reports 12,01, which is the
    // grid's FERIE GOD. column, so the grid is the source and row 300 is only a
    // fallback for layouts whose grid cannot be read.
    expect(r.ferieTakenHours).toBe(12.01);
    expect(r.ferieTakenHours).not.toBe(8);
  });

  it("falls back to body row 300 when no grid can be located", () => {
    const r = extractTeamSystem("300 ASSENZA X FERIE A.C.(hh) 8,00 -15,11786 -120,94");
    expect(r.ferieTakenHours).toBe(8);
    expect(r.rolTakenHours).toBeNull(); // row 300 has no ROL counterpart
  });

  it("ignores the retribution row, whose four numbers are euro, not hours", () => {
    // `2.615,39 2.515,00 154,43 154,43` is the first numbers-only line of every
    // real payslip and has the grid's exact shape.
    const r = extractTeamSystem("2.615,39 2.515,00 154,43 154,43");
    expect(r.ferieResidualHours).toBeNull();
    expect(r.rolResidualHours).toBeNull();
  });

  it("degrades to nulls on unrelated text instead of guessing", () => {
    const junk = extractTeamSystem("qualche riga\nsenza numeri utili\n1,00 2,00");
    expect(junk.net).toBeNull();
    expect(junk.fundTotal).toBeNull();
    expect(junk.found).toEqual([]);
  });

  it("reads the early-employment grid, where only MAT. and RES. are printed", () => {
    // First months of a contract: no A.P. carry-over, nothing taken yet.
    const r = extractTeamSystem(
      ["0,28 36,41 478,69", "0,30 2.137,00", "13,33 13,33 8,67 8,67"].join("\n"),
    );
    expect(r.ferieResidualHours).toBe(13.33);
    expect(r.rolResidualHours).toBe(8.67);
    expect(r.net).toBe(2137);
    expect(r.taxes).toBe(478.69);
  });

  it("ignores the statistics row, which also has four numbers", () => {
    const r = extractTeamSystem("5 3 120,00 17,00 120,00 17 193,73");
    expect(r.ferieResidualHours).toBeNull();
  });

  it("rejects impossible leave balances instead of reporting them", () => {
    // 2716 hours is ~1.5 years of accrual: the anchor landed on the wrong row.
    const r = extractTeamSystem("1,00 2,00\n3,00 4,00\n2716,00 2716,00 166,76 166,76");
    expect(r.ferieResidualHours).toBeNull();
    expect(r.net).toBeNull();
  });

  it("rejects a net that equals the tax figure, which means both rows misresolved", () => {
    const r = extractTeamSystem(
      ["0,10 254,86", "0,20 254,86", "13,33 13,33 8,67 8,67"].join("\n"),
    );
    expect(r.net).toBeNull();
    expect(r.taxes).toBeNull();
    expect(r.ferieResidualHours).toBe(13.33); // the grid itself is still fine
  });

  it("rejects withholdings that dwarf net pay, rather than inventing a gross", () => {
    // The October 2025 layout puts another figure where TOTALE TRATTENUTE sits:
    // 1.277,72 against 1.478,00 net is 86%, and would imply a 2.755,72 gross in
    // a first partial month whose annual progressive reads 1.710,00.
    const r = extractTeamSystem(
      ["905,33 1.277,72", "0,83 1.478,00", "13,33 13,33 8,67 8,67"].join("\n"),
    );
    expect(r.net).toBeNull();
    expect(r.taxes).toBeNull();
    expect(r.gross).toBeNull();
    expect(r.ferieResidualHours).toBe(13.33); // leave balances are still trusted
  });
});

/**
 * Every payslip the owner has, checked against the GOD. columns he read off
 * each grid by hand. A blank GOD. column is omitted from the text and means 0.
 */
const REAL: readonly { file: string; month: string; ferie: number; rol: number }[] = [
  { file: "d14", month: "Ott 2025", ferie: 0, rol: 0 },
  { file: "d12", month: "Nov 2025", ferie: 0, rol: 0 },
  { file: "d10", month: "Dic 2025", ferie: 0, rol: 0 },
  { file: "d13", month: "13ma 2025", ferie: 0, rol: 0 },
  { file: "d11", month: "Gen 2026", ferie: 0, rol: 0 },
  { file: "d15", month: "Feb 2026", ferie: 0, rol: 0 },
  { file: "d96", month: "Mar 2026", ferie: 0, rol: 0 },
  { file: "d101", month: "Apr 2026", ferie: 0, rol: 0 },
  { file: "d102", month: "Mag 2026", ferie: 0, rol: 0 },
  { file: "d103", month: "Giu 2026", ferie: 0, rol: 0 },
  { file: "d104", month: "Lug 2026", ferie: 4.01, rol: 0 },
  { file: "ago2026", month: "Ago 2026", ferie: 12.01, rol: 0 },
];

describe("FERIE GOD. / ROL. GOD. across all twelve real payslips", () => {
  it.each(REAL)("$file ($month)", ({ file, ferie, rol }) => {
    const text = readFileSync(
      new URL(`./__fixtures__/real/${file}.txt`, import.meta.url),
      "utf8",
    );
    const r = extractTeamSystem(text);
    expect(r.ferieTakenHours).toBe(ferie);
    expect(r.rolTakenHours).toBe(rol);
  });
});
