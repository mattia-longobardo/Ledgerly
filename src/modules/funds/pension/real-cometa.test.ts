// The owner's own Cometa case (spec §7.7 "Accettazione", §11; GC §8, §13): the twelve payslips and
// the two Cometa documents through the very code the app runs, skipped when the support folders are
// not there. Nothing personal is written in this file — no amount, no name, no date: every expected
// value is read from `Fondo Cometa/COMETA-guida-e-specifiche-financial-dashboard.md` at run time (D14).
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import { readPdfText } from "@/modules/imports/pdf/text";
import { assemble } from "@/modules/payroll/parse/assemble";
import { moneyOf } from "@/modules/payroll/parse/derive";
import { parseReplyTeamsystem } from "@/modules/payroll/parse/reply-teamsystem";
import { pensionCompetenceOf } from "@/modules/payroll/pension";
import { REPLY_TEAMSYSTEM_CODES } from "@/modules/payroll/rules";
import { type Cents, centsToDecimal, parseCents } from "@/platform/money";
import { parseCometaPosition } from "../parse/cometa-position";
import { parseCometaOperations } from "../parse/export";
import type { ParsedOperation } from "../parse/cometa-operations";
import { bridge, type MovementLike, pensionMetrics, sumUnits } from "./metrics";
import { accruedTotal, type CompetenceLike, type OperationLike, reconcile } from "./reconcile";
import { COMETA_SCHEDULE, DEFAULT_TOLERANCE_DAYS, type Quarter } from "./rules";

const PAYROLL = join(process.cwd(), "Payroll");
const COMETA = join(process.cwd(), "Fondo Cometa");
const GUIDE = join(COMETA, "COMETA-guida-e-specifiche-financial-dashboard.md");
const present =
  existsSync(GUIDE) &&
  existsSync(PAYROLL) &&
  readdirSync(COMETA).some((name) => name.endsWith(".xls")) &&
  readdirSync(COMETA).some((name) => name.endsWith(".pdf")) &&
  readdirSync(PAYROLL).some((name) => name.endsWith(".pdf"));

/**
 * The first Italian number of a cell as a decimal string: "1.234,56 €" → "1234.56", "+2,16%
 * arrotondato, non annualizzato" → "2.16". `null` when the cell carries none.
 */
function italian(text: string): string | null {
  const match = /([+-]?)(\d{1,3}(?:\.\d{3})+|\d+)(?:,(\d+))?/.exec(text.replace(/\*\*/g, ""));
  if (!match) return null;
  const [, sign, whole, fraction] = match;
  return `${sign === "-" ? "-" : ""}${whole.replaceAll(".", "")}${fraction ? `.${fraction}` : ""}`;
}

/** The rows of the guide's markdown table whose header starts with `header`. */
function table(markdown: string, header: string): string[][] {
  const lines = markdown.split("\n");
  const start = lines.findIndex((line) => line.startsWith(`| ${header}`));
  if (start < 0) throw new Error(`No table for ${header}`);
  const rows: string[][] = [];
  for (const line of lines.slice(start + 2)) {
    if (!line.startsWith("|")) break;
    rows.push(
      line
        .split("|")
        .slice(1, -1)
        .map((cell) => cell.trim()),
    );
  }
  return rows;
}

/** A case of the guide's §13 table by the beginning of its name. */
function expected(markdown: string, name: string): string {
  const row = table(markdown, "Caso").find((cells) => cells[0].toLowerCase().startsWith(name.toLowerCase()));
  if (!row) throw new Error(`No case ${name}`);
  return row[1];
}

interface Payslip {
  key: string;
  competence: ReturnType<typeof pensionCompetenceOf>;
}

let guide = "";
let competences: CompetenceLike[] = [];
let byRow = new Map<string, CompetenceLike[]>();
let operations: ParsedOperation[] = [];
let movements: MovementLike[] = [];
let position = new Map<string, string | null>();

/** The guide's §8.2 row a payslip belongs to ("Dicembre + tredicesima 2025" holds two). */
const MONTHS = [
  "gennaio",
  "febbraio",
  "marzo",
  "aprile",
  "maggio",
  "giugno",
  "luglio",
  "agosto",
  "settembre",
  "ottobre",
  "novembre",
  "dicembre",
];

function rowNameOf(competence: NonNullable<Payslip["competence"]>): string {
  if (competence.payrollPeriod === null) return `dicembre + tredicesima ${competence.year}`;
  const month = MONTHS[Number(competence.payrollPeriod.slice(5, 7)) - 1];
  return month === "dicembre" ? `dicembre + tredicesima ${competence.year}` : `${month} ${competence.year}`;
}

describe.skipIf(!present)("the owner's Cometa fund (GC §8, §13)", () => {
  beforeAll(async () => {
    guide = readFileSync(GUIDE, "utf8");
    const codeMap = new Map(REPLY_TEAMSYSTEM_CODES.map((entry) => [entry.code, entry.role]));
    const read: Payslip[] = [];
    for (const name of readdirSync(PAYROLL).filter((one) => one.endsWith(".pdf"))) {
      const parsed = parseReplyTeamsystem(
        await readPdfText(new Uint8Array(readFileSync(join(PAYROLL, name)))),
        codeMap,
      );
      const identity = parsed.identity!;
      const assembled = assemble({
        type: identity.type,
        period: identity.period,
        values: Object.fromEntries(parsed.fields.map((field) => [field.field, field.value])),
        lines: parsed.lines,
        previous: null,
        history: [],
      });
      const money = (field: Parameters<typeof moneyOf>[1]) => moneyOf(assembled.values, field);
      const key = identity.type === "ordinary" ? identity.period! : `${identity.type}-${identity.year}`;
      read.push({
        key,
        competence: pensionCompetenceOf(
          {
            id: key,
            period: identity.period,
            type: identity.type,
            year: identity.year,
            printedOn: null,
            employeeFundEffective: money("employeeFundEffective"),
            employerFundPrinted: money("employerFundPrinted"),
            tfrContributionLine: money("tfrContributionLine"),
            employeeFundEnrollment: money("employeeFundEnrollment"),
            employerFundEnrollment: money("employerFundEnrollment"),
            employeeFundAdjustments: money("employeeFundAdjustments"),
            employerFundAdjustments: money("employerFundAdjustments"),
          },
          [],
        ),
      });
    }
    competences = read
      .flatMap((one) => (one.competence ? [one.competence] : []))
      .map((one) => ({
        id: one.payslipId,
        year: one.year,
        quarter: one.quarter,
        payrollPeriod: one.payrollPeriod,
        workerCents: one.workerCents,
        employerCents: one.employerCents,
        tfrCents: one.tfrCents,
        workerEnrollmentCents: one.workerEnrollmentCents,
        employerEnrollmentCents: one.employerEnrollmentCents,
      }));
    byRow = new Map();
    for (const one of read) {
      if (!one.competence) continue;
      const name = rowNameOf(one.competence);
      const row = competences.find((competence) => competence.id === one.competence!.payslipId)!;
      byRow.set(name, [...(byRow.get(name) ?? []), row]);
    }

    const exportName = readdirSync(COMETA).find((name) => name.endsWith(".xls"))!;
    operations = parseCometaOperations(new Uint8Array(readFileSync(join(COMETA, exportName)))).operations;
    movements = operations.flatMap((operation) =>
      operation.movements.map((movement) => ({
        operationId: operation.originKey,
        compartment: movement.compartment,
        units: movement.units,
        unitPrice: movement.unitPrice,
        unitPriceDate: movement.unitPriceDate,
      })),
    );
    const pdfName = readdirSync(COMETA).find((name) => name.endsWith(".pdf"))!;
    const parsed = parseCometaPosition(
      await readPdfText(new Uint8Array(readFileSync(join(COMETA, pdfName)))),
    );
    position = new Map(parsed.fields.map((field) => [field.field, field.value]));
  }, 120_000);

  const asOperations = (): OperationLike[] =>
    operations.map((operation) => ({
      id: operation.originKey,
      classification: operation.classification,
      competenceYear: operation.competenceYear,
      competenceQuarter: operation.competenceQuarter,
      operationDate: operation.operationDate,
      workerCents: operation.workerCents,
      employerCents: operation.employerCents,
      tfrCents: operation.tfrCents,
      otherCents: operation.otherCents,
      feesCents: operation.feesCents,
      netCents: operation.netCents,
      units: sumUnits(operation.movements.map((movement) => movement.units)) ?? "0",
    }));

  /** The quarters as the app computes them, with the day the guide was written as "today". */
  const quartersOn = (today: string, freshness: string | null) =>
    reconcile({
      competences,
      operations: asOperations(),
      decisions: [],
      schedule: COMETA_SCHEDULE,
      toleranceDays: DEFAULT_TOLERANCE_DAYS,
      freshness,
      today,
    });

  const metricsOn = (today: string) => {
    const quarters = quartersOn(today, position.get("valuationDate") ?? null);
    const value = position.get("value");
    const on = position.get("valuationDate");
    return pensionMetrics({
      value: value && on ? { cents: parseCents(value), on, source: "statement" } : null,
      operations: asOperations(),
      movements,
      quarters,
    });
  };

  it("reads each payslip's competence as the guide's table has it (GC §8.2)", () => {
    const rows = table(guide, "Competenza | Lavoratore").filter((cells) => italian(cells[1]) !== null);
    expect(rows.length).toBeGreaterThan(10);
    for (const [name, worker, employer, tfr, total] of rows) {
      const key = name.replace(/\*\*/g, "").toLowerCase();
      const group = key.startsWith("totale") ? competences : (byRow.get(key) ?? []);
      expect(group.length, `no payslip for ${key}`).toBeGreaterThan(0);
      const sum = (pick: (one: CompetenceLike) => Cents | null) =>
        group.reduce<Cents>((amount, one) => amount + (pick(one) ?? 0n), 0n);
      expect(centsToDecimal(sum((one) => one.workerCents)), `${key} worker`).toBe(italian(worker));
      expect(centsToDecimal(sum((one) => one.employerCents)), `${key} employer`).toBe(italian(employer));
      expect(centsToDecimal(sum((one) => one.tfrCents)), `${key} TFR`).toBe(italian(tfr));
      const totalCents =
        sum((one) => one.workerCents) + sum((one) => one.employerCents) + sum((one) => one.tfrCents);
      expect(centsToDecimal(totalCents), `${key} total`).toBe(italian(total));
    }
  });

  it("keeps the month with no contribution at zero and the enrolment apart (GC §8.2)", () => {
    const october = (byRow.get("ottobre 2025") ?? [])[0];
    // The payslip shows TFR accrued, not conferred: no fund line, so nothing is added (GC §8.2).
    expect([october.workerCents, october.employerCents, october.tfrCents]).toEqual([null, null, null]);
    const enrolled = competences.filter((one) => (one.workerEnrollmentCents ?? 0n) > 0n);
    expect(enrolled).toHaveLength(1);
    expect(enrolled[0].workerEnrollmentCents).toBe(enrolled[0].employerEnrollmentCents);
  });

  it("adds the 13th to December once, as the guide's case says (GC §13)", () => {
    const december = byRow.get("dicembre + tredicesima 2025") ?? [];
    expect(december).toHaveLength(2);
    const worker = december.reduce<Cents>((sum, one) => sum + (one.workerCents ?? 0n), 0n);
    expect(centsToDecimal(worker)).toBe(italian(expected(guide, "Tredicesima + dicembre")!));
    // The 13th brings no employer quota of its own; its adjustment is kept, never added.
    const thirteenth = december.find((one) => one.payrollPeriod === null)!;
    expect(thirteenth.employerCents).toBeNull();
  });

  it("reads the export exactly as the guide's operations table (GC §8.4)", () => {
    const rows = table(guide, "Competenza / tipo").filter((cells) => italian(cells[2]) !== null);
    // One row per operation, plus the total row.
    expect(rows).toHaveLength(operations.length + 1);
    for (const [label, date, worker, employer, tfr, fees, net, units, price] of rows) {
      if (label.includes("Totale")) {
        const total = (pick: (one: ParsedOperation) => Cents) =>
          operations.reduce<Cents>((sum, one) => sum + pick(one), 0n);
        expect(centsToDecimal(total((one) => one.workerCents))).toBe(italian(worker));
        expect(centsToDecimal(total((one) => one.employerCents))).toBe(italian(employer));
        expect(centsToDecimal(total((one) => one.tfrCents))).toBe(italian(tfr));
        expect(centsToDecimal(total((one) => one.feesCents))).toBe(italian(fees));
        expect(centsToDecimal(total((one) => one.netCents))).toBe(italian(net));
        expect(sumUnits(movements.map((movement) => movement.units))).toBe(italian(units));
        continue;
      }
      const [day, month, year] = date.split("/");
      const on = `${year}-${month}-${day}`;
      const matching = operations.filter(
        (operation) =>
          operation.operationDate === on && centsToDecimal(operation.workerCents) === italian(worker),
      );
      expect(matching, `${label} ${date}`).toHaveLength(1);
      const operation = matching[0];
      expect(centsToDecimal(operation.employerCents)).toBe(italian(employer));
      expect(centsToDecimal(operation.tfrCents)).toBe(italian(tfr));
      expect(centsToDecimal(operation.feesCents)).toBe(italian(fees));
      expect(centsToDecimal(operation.netCents)).toBe(italian(net));
      expect(sumUnits(operation.movements.map((movement) => movement.units))).toBe(italian(units));
      expect(operation.movements[0].unitPrice).toBe(italian(price));
      // "Iscrizione" in the guide is the row the export itself calls "Contributo" (GC §8.4).
      expect(operation.classification).toBe(
        label.toLowerCase().includes("iscrizione") ? "enrollment" : "contribution",
      );
    }
  });

  it("reads the statement as the guide's position table (GC §8.5)", () => {
    const fields: Record<string, string> = {
      TFR: "tfr",
      Aderente: "worker",
      Azienda: "employer",
      Trasferimenti: "transfersIn",
      "Totale entrate": "inflows",
      "Rendimento riportato": "reportedGain",
      "Valore posizione": "value",
    };
    for (const [label, value] of table(guide, "Campo nel PDF")) {
      const field = fields[label];
      if (!field) continue;
      expect(position.get(field), label).toBe(italian(value));
    }
    expect(position.get("valuationDate")).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    for (const field of ["advances", "redemptions", "rita", "outflows"]) {
      expect(parseCents(position.get(field)!)).toBe(0n);
    }
  });

  it("reconciles every quarter the documents cover, to the cent (GC §13)", () => {
    const quarters = quartersOn("2026-09-13", position.get("valuationDate") ?? null);
    const credited = quarters.filter((quarter) => quarter.operationDates.length > 0);
    expect(credited.length).toBeGreaterThanOrEqual(3);
    for (const quarter of credited) {
      expect(quarter.status, `${quarter.year} Q${quarter.quarter}`).toBe("reconciled");
      for (const component of quarter.components) expect(component.differenceCents).toBe(0n);
    }
    const totals: Record<string, string> = {
      "IV trimestre 2025": expected(guide, "IV trimestre 2025"),
      "I trimestre 2026": expected(guide, "I trimestre 2026"),
      "II trimestre 2026": expected(guide, "II trimestre 2026"),
    };
    const labelOf = (year: number, quarter: Quarter) =>
      `${["I", "II", "III", "IV"][quarter - 1]} trimestre ${year}`;
    for (const quarter of credited) {
      const wanted = totals[labelOf(quarter.year, quarter.quarter)];
      if (!wanted) continue;
      expect(centsToDecimal(accruedTotal(quarter)!), labelOf(quarter.year, quarter.quarter)).toBe(
        italian(wanted),
      );
    }
  });

  it("leaves the months past the last credit waiting, with their deadline (GC §4, §13)", () => {
    const quarters = quartersOn("2026-09-13", position.get("valuationDate") ?? null);
    const waiting = quarters.filter((quarter) => quarter.operationDates.length === 0);
    expect(waiting).toHaveLength(1);
    expect(waiting[0]).toMatchObject({ status: "accrued_not_due" });
    expect(waiting[0].due).toBe(`${waiting[0].year}-10-20`);
    expect(centsToDecimal(accruedTotal(waiting[0])!)).toBe(italian(expected(guide, "Luglio + agosto")));
  });

  it("does not call a missing credit late while the export is older than the deadline (GC §13)", () => {
    // Long after the deadline, with the same old export: the data are dated, nobody is accused.
    const quarters = quartersOn("2027-03-01", position.get("valuationDate") ?? null);
    const waiting = quarters.filter((quarter) => quarter.operationDates.length === 0);
    expect(waiting.map((quarter) => quarter.status)).not.toContain("to_verify");
    // The data are dated — a payslip of the quarter is missing too — and nobody is accused.
    expect(waiting.every((quarter) => quarter.status === "incomplete")).toBe(true);
    expect(
      waiting.every((quarter) => quarter.reason === "missing_payslip" || quarter.reason === "stale_export"),
    ).toBe(true);
  });

  it("computes the summary of the guide, figure by figure (GC §9, §12, §13)", () => {
    const metrics = metricsOn("2026-09-13");
    expect(centsToDecimal(metrics.accruedCents)).toBe(italian(expected(guide, "Totale cedolini")));
    expect(centsToDecimal(metrics.pendingCents)).toBe(italian(expected(guide, "Luglio + agosto")));
    expect(centsToDecimal(metrics.paidInCents)).toBe(italian(expected(guide, "Entrate fondo")));
    expect(centsToDecimal(metrics.feesCents)).toBe(italian(expected(guide, "Spese esplicite")));
    expect(centsToDecimal(metrics.investedCents)).toBe(italian(expected(guide, "Netto investito")));
    expect(centsToDecimal(metrics.gainCents!)).toBe(italian(expected(guide, "Saldo finale")));
    expect(metrics.units).toBe(italian(expected(guide, "Quote documentate")));
    // The simple ratio, not annualised, rounded as the guide rounds it.
    const ratio = (metrics.gainFraction! * 100).toFixed(2);
    expect(ratio).toBe(italian(expected(guide, "Rapporto semplice")));
    expect(metrics.value?.cents).toBe(parseCents(position.get("value")!));
    expect(metrics.coveredUntil).not.toBeNull();
  });

  it("reconciles the numbers that differ, as the guide's panel does (GC §12)", () => {
    const lines = bridge(metricsOn("2026-09-13"))!;
    const line = (key: string) => lines.find((one) => one.key === key)!;
    expect(centsToDecimal(line("accrued").cents)).toBe(italian(expected(guide, "Totale cedolini")));
    expect(centsToDecimal(-line("pending").cents)).toBe(italian(expected(guide, "Luglio + agosto")));
    expect(centsToDecimal(line("paidIn").cents)).toBe(italian(expected(guide, "Entrate fondo")));
    expect(centsToDecimal(line("invested").cents)).toBe(italian(expected(guide, "Netto investito")));
    expect(centsToDecimal(line("value").cents)).toBe(position.get("value"));
    // Nothing unexplained: the payslips and the fund account for every cent.
    expect(lines.some((one) => one.key === "other")).toBe(false);
  });

  it("keeps the enrolment's zero net and its fee, with no units bought (GC §13)", () => {
    const enrollment = operations.filter((operation) => operation.classification === "enrollment");
    expect(enrollment).toHaveLength(1);
    expect(enrollment[0].netCents).toBe(0n);
    expect(enrollment[0].feesCents).toBe(enrollment[0].workerCents + enrollment[0].employerCents);
    expect(sumUnits(enrollment[0].movements.map((movement) => movement.units))).toBe("0.000");
  });

  it("reads the same export twice into the same operations (GC §13)", () => {
    const exportName = readdirSync(COMETA).find((name) => name.endsWith(".xls"))!;
    const again = parseCometaOperations(new Uint8Array(readFileSync(join(COMETA, exportName)))).operations;
    expect(again.map((operation) => operation.originKey)).toEqual(
      operations.map((operation) => operation.originKey),
    );
    expect(new Set(again.map((operation) => operation.originKey)).size).toBe(again.length);
  });

  it("does not take the indirect management fee off the value a second time (GC §13)", () => {
    const metrics = metricsOn("2026-09-13");
    // The gain is the value minus what went in: the fees are already in the fund's own figures.
    expect(metrics.gainCents).toBe(metrics.value!.cents - metrics.paidInCents - metrics.transfersInCents);
    expect(centsToDecimal(metrics.value!.cents - metrics.investedCents)).toBe(
      centsToDecimal(metrics.gainCents! + metrics.feesCents),
    );
  });

  it("finds a missing document as unknown, never as zero (GC §13)", () => {
    // The quarter the export does not cover has no credited amount at all — not a zero.
    const quarters = quartersOn("2026-09-13", position.get("valuationDate") ?? null);
    const waiting = quarters.filter((quarter) => quarter.operationDates.length === 0);
    for (const component of waiting[0].components) expect(component.creditedCents).toBeNull();
  });

  it("verifies the payslip codes the guide names, with no double counting (GC §13)", () => {
    // 7101 + 9110: the statistical line never adds a second contribution — the worker's quota of
    // a month equals the effective one, and the summary line changes nothing.
    const monthly = competences.filter((one) => one.payrollPeriod !== null && (one.workerCents ?? 0n) > 0n);
    expect(monthly.length).toBeGreaterThan(5);
    const distinct = new Set(monthly.map((one) => centsToDecimal(one.workerCents!)));
    expect(distinct.size).toBeLessThanOrEqual(3);
  });
});
