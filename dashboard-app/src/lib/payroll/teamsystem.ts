import { parseItalianNumber } from "@/lib/format";
import { splitLines } from "@/lib/payroll/text";

/**
 * Extractor for the employer's actual "Mod. Cedolino TS" layout, verified
 * against a real payslip (Paperless doc 142, August 2026) (historical: the
 * sample predates the upload pipeline) and against the owner's own reading of
 * it.
 *
 * It exists alongside the generic anchor engine because the real PDF is a form:
 * the labels are emitted in one block and the values in another, so
 * "label followed by a number on the same line" — which the generic anchors
 * assume — only works for the body rows. The summary figures have to be located
 * structurally instead.
 *
 * Corrections to PLAN.md §4, per the owner:
 *  - the Cometa contribution is the sum of THREE rows, not `FONDO C/DIPE` alone;
 *  - taxes are `TOTALE TRATTENUTE`, not a composite of IRPEF + addizionali;
 *  - gross is net + taxes, NOT the printed `TOTALE LORDO` (2.093,00 + 623,96 =
 *    2.716,96, while `TOTALE LORDO` reads 2.615,39);
 *  - leave taken is the grid's `FERIE GOD.` / `ROL. GOD.` column. The owner
 *    confirmed 12,01 h for August 2026, which is that column — not the 8,00 h
 *    of body row 300.
 */

export interface TeamSystemReading {
  net: number | null;
  taxes: number | null;
  /** net + taxes, per the owner's definition of "lordo effettivo". */
  gross: number | null;
  fundEmployee: number | null;
  fundEmployer: number | null;
  fundTotal: number | null;
  ferieResidualHours: number | null;
  rolResidualHours: number | null;
  /**
   * Hours of leave taken, from the grid's `FERIE GOD.` / `ROL. GOD.` column.
   * Body row 300 only fills in for ferie when the grid cannot be read.
   */
  ferieTakenHours: number | null;
  rolTakenHours: number | null;
  /** Which figures were located; anything absent stays null and low-confidence. */
  found: string[];
}

const EMPTY: TeamSystemReading = {
  net: null, taxes: null, gross: null,
  fundEmployee: null, fundEmployer: null, fundTotal: null,
  ferieResidualHours: null, rolResidualHours: null,
  ferieTakenHours: null, rolTakenHours: null,
  found: [],
};

/**
 * A body row's figure. Money rows carry the amount last
 * (`9110 COMUNICAZIONE DIPENDENTE 30,66`), while quantity rows carry the hours
 * first (`300 ASSENZA X FERIE A.C.(hh) 8,00 -15,11786 -120,94`, where the
 * trailing values are the rate and the amount).
 */
function bodyRow(
  lines: string[],
  code: string,
  label: RegExp,
  pick: "first" | "last" = "last",
): number | null {
  const re = new RegExp(`^\\s*${code}\\b`);
  for (const line of lines) {
    if (!re.test(line) || !label.test(line.toUpperCase())) continue;
    const nums = line.match(/-?[\d.]+,\d{2}\b/g);
    if (nums?.length) {
      return parseItalianNumber(pick === "first" ? nums[0]! : nums[nums.length - 1]!);
    }
  }
  return null;
}

function numbersOf(line: string): number[] {
  const raw = line.match(/-?[\d.]+,\d{2}\b/g) ?? [];
  return raw.map((n) => parseItalianNumber(n)).filter((n): n is number => n !== null);
}

/** A line that is nothing but numbers — the summary rows are unlabelled. */
function isNumericOnly(line: string): boolean {
  const t = line.trim();
  return t.length > 0 && /^[\d.,\s-]+$/.test(t) && /\d,\d{2}/.test(t);
}

const TOL = 0.02;

/**
 * Plausibility bounds. Anything outside them is treated as "not found" rather
 * than reported: a wrong number that looks right is far worse than a blank the
 * verification screen asks a human to fill in (PLAN.md §4, "Failure handling").
 */
const MAX_LEAVE_HOURS = 500; // a full year of accrual is ~200h
/**
 * Every cell of the leave grid is an hours figure — the largest across the
 * twelve real payslips is 106,68. The euro rows share the grid's "numbers only,
 * no label" shape, and the first such row of every payslip is retribution
 * (`2.615,39 2.515,00 154,43 154,43`), which the shape checks below reject only
 * by the accident of 2.615,39 differing from 2.515,00. Requiring every cell to
 * be small enough to be hours rejects the wage rows deliberately instead.
 */
const MAX_GRID_HOURS = 300;
const MIN_NET = 50;
/**
 * Withholdings above this share of net pay mean the anchor picked up the wrong
 * row. Across the twelve real payslips the ratio sits between 0.16 and 0.38;
 * the October 2025 layout put a different figure where TOTALE TRATTENUTE
 * normally sits, yielding 0.86 and a gross of 2.755,72 for a first, partial
 * month whose annual progressive reads 1.710,00 — impossible.
 */
const MAX_TAX_TO_NET = 0.6;
const MAX_NET = 20_000;

function plausibleHours(n: number): boolean {
  return n >= 0 && n <= MAX_LEAVE_HOURS;
}

/**
 * Money and hours must not carry float noise: 193,73 + 56,21 + 30,66 is 280,60
 * exactly, and a grid cell read back is 12,01 and not 12,009999999999.
 */
function round2(n: number): number {
  return Number(n.toFixed(2));
}

interface Triple {
  /** Hours used, i.e. the GOD. column — 0 when that column is blank. */
  taken: number;
  /** Hours left, i.e. the RES. column — always the last value of the triple. */
  residual: number;
}

/**
 * A ferie/ROL triple, read without relying on column positions.
 *
 * The text omits blank columns entirely, so the same three numbers mean two
 * different things depending on whether anything was taken that month:
 *   `7,99 + 80,02 = 88,01`   -> A.P. + MAT. = RES., nothing taken (GOD. blank)
 *   `106,68 - 12,01 = 94,67` -> MAT. - GOD. = RES., 12,01 hours taken
 * The residual is the last value either way, which is the figure that matters.
 */
function readTriple(n: number[]): Triple | null {
  if (n.length !== 3) return null;
  const [a, b, c] = n as [number, number, number];
  if (Math.abs(a + b - c) < TOL) return { taken: 0, residual: c };
  if (Math.abs(a - b - c) < TOL) return { taken: b, residual: c };
  return null;
}

/** With all four columns filled: A.P. + MAT. - GOD. = RES. */
function readQuad(n: number[]): Triple | null {
  if (n.length !== 4) return null;
  const [a, b, g, r] = n as [number, number, number, number];
  return Math.abs(a + b - g - r) < TOL ? { taken: g, residual: r } : null;
}

function readHalf(n: number[]): Triple | null {
  return readTriple(n) ?? readQuad(n);
}

/**
 * The vacation grid is located by its arithmetic rather than its position, so
 * an omitted blank column cannot shift every value by one — the failure mode
 * PLAN.md §4 warned about. Both halves (ferie, then ROL) must balance.
 */
function findGrid(
  lines: string[],
): { index: number; ferie: Triple; rol: Triple } | null {
  for (let i = 0; i < lines.length; i++) {
    if (!isNumericOnly(lines[i]!)) continue;
    const n = numbersOf(lines[i]!);
    if (n.length !== 4 && n.length !== 6 && n.length !== 8) continue;
    if (!n.every((v) => v >= 0 && v <= MAX_GRID_HOURS)) continue;

    if (n.length === 4) {
      // Only MAT. and RES. are printed when both A.P. and GOD. are blank, which
      // is the shape of the first months of an employment: `13,33 13,33 8,67
      // 8,67`. Requiring each pair to be equal is what keeps this from matching
      // the statistics row (`... 120,00 17,00 120,00 ...`), which is not a grid.
      const [a, b, c, d] = n as [number, number, number, number];
      if (
        Math.abs(a - b) < TOL &&
        Math.abs(c - d) < TOL &&
        plausibleHours(b) &&
        plausibleHours(d)
      ) {
        return { index: i, ferie: { taken: 0, residual: b }, rol: { taken: 0, residual: d } };
      }
      continue;
    }

    const half = n.length / 2;
    const ferie = readHalf(n.slice(0, half));
    const rol = readHalf(n.slice(half));
    if (ferie && rol && plausibleHours(ferie.residual) && plausibleHours(rol.residual)) {
      return { index: i, ferie, rol };
    }
  }
  return null;
}

export function extractTeamSystem(text: string): TeamSystemReading {
  const lines = splitLines(text);
  if (lines.length === 0) return EMPTY;

  const found: string[] = [];
  const out: TeamSystemReading = { ...EMPTY, found };

  const employee = bodyRow(lines, "9110", /COMUNICAZIONE\s+DIPENDENTE/);
  const tfr = bodyRow(lines, "8003", /CONTRIBUZIONE\s+TFR/);
  const azienda = bodyRow(lines, "9109", /FONDO\s+C\/AZIENDA/);

  if (employee !== null) { out.fundEmployee = employee; found.push("fundEmployee"); }
  // TFR is employer-funded deferred pay, so it lands on the employer side.
  if (tfr !== null || azienda !== null) {
    out.fundEmployer = round2((tfr ?? 0) + (azienda ?? 0));
    found.push("fundEmployer");
  }
  if (employee !== null || tfr !== null || azienda !== null) {
    out.fundTotal = round2((employee ?? 0) + (tfr ?? 0) + (azienda ?? 0));
    found.push("fundTotal");
  }

  // Leave taken comes from the grid's GOD. column. The owner checked the August
  // 2026 payslip and reports 12,01 h, which is the grid figure; body row 300
  // reads 8,00 there, so preferring the row — as this did before — returned a
  // number the owner rejects. Row 300 also has no ROL counterpart at all, and
  // the grid carries both halves, so the grid is the one source that answers
  // the whole question.
  const grid = findGrid(lines);
  if (grid) {
    out.ferieTakenHours = round2(grid.ferie.taken);
    out.rolTakenHours = round2(grid.rol.taken);
    out.ferieResidualHours = round2(grid.ferie.residual);
    out.rolResidualHours = round2(grid.rol.residual);
    found.push("ferieTakenHours", "rolTakenHours", "ferieResidualHours", "rolResidualHours");

    // The two unlabelled numeric rows immediately above the grid carry
    // TOTALE TRATTENUTE and NETTO BUSTA as their last value.
    const prior = [];
    for (let i = grid.index - 1; i >= 0 && prior.length < 2; i--) {
      if (isNumericOnly(lines[i]!)) prior.push(numbersOf(lines[i]!));
    }
    const [netRow, taxRow] = prior;
    const net = netRow?.length ? netRow[netRow.length - 1]! : null;
    const taxes = taxRow?.length ? taxRow[taxRow.length - 1]! : null;
    // `net === taxes` means both rows resolved to the same figure, i.e. the
    // anchor landed on the wrong lines — seen on the December 2025 payslip.
    const netOk = net !== null && net >= MIN_NET && net <= MAX_NET;
    const taxOk = taxes !== null && taxes > 0 && taxes <= MAX_NET;
    const distinct = !(netOk && taxOk && Math.abs(net! - taxes!) < TOL);
    const ratioOk = !(netOk && taxOk) || taxes! / net! <= MAX_TAX_TO_NET;
    if (netOk && distinct && ratioOk) { out.net = net; found.push("net"); }
    if (taxOk && distinct && ratioOk) { out.taxes = taxes; found.push("taxes"); }
    if (out.net !== null && out.taxes !== null) {
      out.gross = round2(out.net + out.taxes);
      found.push("gross");
    }
  }

  // Fallback only: a layout whose grid does not balance still has the body row,
  // which at least covers ferie. ROL has no such row and stays null.
  if (out.ferieTakenHours === null) {
    const taken300 = bodyRow(lines, "300", /ASSENZA\s+X\s+FERIE/, "first");
    if (taken300 !== null && plausibleHours(taken300)) {
      out.ferieTakenHours = round2(taken300);
      found.push("ferieTakenHours");
    }
  }

  return out;
}
