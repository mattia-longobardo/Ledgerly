// The owner's twelve payslips against the owner's spec (spec §7.8 "Accettazione", §11): skipped
// when `Payroll/` is not there. Nothing personal is written in this file — no amount, no name:
// every expected value is read from `Payroll/SPECIFICA-ESTRAZIONE-PAYROLL.md` at run time (D14).
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import { readPdfText } from "@/modules/imports/pdf/text";
import { centsToDecimal, parseCents } from "@/platform/money";
import { FIELDS } from "../fields";
import { REPLY_TEAMSYSTEM_CODES, logicalKey, parsePeriodLabel, usagePeriodOf } from "../rules";
import { type Assembled, assemble } from "./assemble";
import type { HistoryPoint } from "./checks";
import { moneyOf } from "./derive";
import type { PreviousPayslip } from "./leave";
import { type ParsedPayslip, parseReplyTeamsystem } from "./reply-teamsystem";

const FOLDER = join(process.cwd(), "Payroll");
const SPEC = join(FOLDER, "SPECIFICA-ESTRAZIONE-PAYROLL.md");
const present = existsSync(SPEC) && readdirSync(FOLDER).some((name) => name.endsWith(".pdf"));

interface Read {
  parsed: ParsedPayslip;
  assembled: Assembled;
  key: string;
}

/** "1.234,56" or "1234,56" or "20" → a decimal string. */
function italian(text: string): string {
  return text.trim().replaceAll(".", "").replace(",", ".");
}

/** The rows of the markdown table whose header row starts with `header`. */
function table(markdown: string, header: string): string[][] {
  const lines = markdown.split("\n");
  const start = lines.findIndex((line) => line.startsWith(`| ${header}`));
  const rows: string[][] = [];
  for (const line of lines.slice(start + 2)) {
    if (!line.startsWith("|")) break;
    rows.push(line.split("|").slice(1, -1).map((cell) => cell.trim()));
  }
  return rows;
}

/** A spec row's name ("Ottobre 2025", "Tredicesima 2025") as the key its payslip has. */
function periodOfRow(name: string): string {
  const identity = parsePeriodLabel(name.replace(/^Tredicesima/i, "13a MENS."));
  if (!identity) throw new Error(`Unknown row ${name}`);
  return identity.type === "ordinary" ? identity.period! : `${identity.type}-${identity.year}`;
}

const byKey = new Map<string, Read>();
let spec = "";

describe.skipIf(!present)("the owner's twelve payslips (owner's spec L184–250)", () => {
  beforeAll(async () => {
    spec = readFileSync(SPEC, "utf8");
    const codeMap = new Map(REPLY_TEAMSYSTEM_CODES.map((entry) => [entry.code, entry.role]));
    const parsed: ParsedPayslip[] = [];
    for (const name of readdirSync(FOLDER).filter((one) => one.endsWith(".pdf"))) {
      parsed.push(parseReplyTeamsystem(await readPdfText(new Uint8Array(readFileSync(join(FOLDER, name)))), codeMap));
    }
    // Oldest first, the 13th after its December: each ordinary payslip sees the one before it.
    const order = (one: ParsedPayslip) => one.identity?.period ?? `${one.identity?.year}-12-99`;
    parsed.sort((a, b) => order(a).localeCompare(order(b)));
    const history: HistoryPoint[] = [];
    let previous: PreviousPayslip | null = null;
    for (const one of parsed) {
      const identity = one.identity!;
      const values = Object.fromEntries(one.fields.map((field) => [field.field, field.value]));
      const assembled = assemble({
        type: identity.type,
        period: identity.period,
        values,
        lines: one.lines,
        previous,
        history,
      });
      const key = identity.type === "ordinary" ? identity.period! : `${identity.type}-${identity.year}`;
      byKey.set(key, { parsed: one, assembled, key });
      if (identity.type === "ordinary") {
        previous = { period: identity.period!, values: assembled.values };
        history.push({
          period: identity.period!,
          netPay: moneyOf(assembled.values, "netPay"),
          gross: moneyOf(assembled.values, "gross"),
        });
      }
    }
  }, 60_000);

  it("reads every payslip as a recognised Reply/TeamSystem payslip with its identity", () => {
    expect(byKey.size).toBe(table(spec, "Cedolino | Lordo").length - 1);
    for (const read of byKey.values()) {
      expect(read.parsed.recognised).toBe(true);
      expect(read.parsed.warnings.map((warning) => warning.code)).not.toContain("unknown_code");
      expect(read.parsed.warnings.map((warning) => warning.code)).not.toContain("missing_identity");
    }
  });

  it("matches the gross, taxes, social contributions and net of table 1, and its totals", () => {
    const rows = table(spec, "Cedolino | Lordo");
    const totals = { gross: 0n, taxes: 0n, social: 0n, net: 0n };
    for (const [name, gross, taxes, social, net] of rows) {
      if (name === "Totale") {
        expect(centsToDecimal(totals.gross)).toBe(italian(gross));
        expect(centsToDecimal(totals.taxes)).toBe(italian(taxes));
        expect(centsToDecimal(totals.social)).toBe(italian(social));
        expect(centsToDecimal(totals.net)).toBe(italian(net));
        continue;
      }
      const { values } = byKey.get(periodOfRow(name))!.assembled;
      expect({ name, gross: values.gross, taxes: values.taxesTotal, social: values.employeeSocial, net: values.netPay }).toEqual({
        name,
        gross: italian(gross),
        taxes: italian(taxes),
        social: italian(social),
        net: italian(net),
      });
      totals.gross += parseCents(values.gross!);
      totals.taxes += parseCents(values.taxesTotal!);
      totals.social += parseCents(values.employeeSocial!);
      totals.net += parseCents(values.netPay!);
    }
    // The printed total gross, welfare included, is another figure (L204).
    const printed = /totale lordo stampato[^\n]*? è ([\d.]+,\d{2})/i.exec(spec)![1];
    const sum = [...byKey.values()].reduce(
      (total, read) => total + parseCents(read.assembled.values.totalGrossPrinted!),
      0n,
    );
    expect(centsToDecimal(sum)).toBe(italian(printed));
  });

  it("matches the leave used and remaining of table 2, by the month the leave was used", () => {
    for (const [name, usageMonth, vacationUsed, rolUsed, vacationLeft, rolLeft] of table(spec, "Cedolino ordinario")) {
      const read = byKey.get(periodOfRow(name))!;
      const hours = (kind: string) =>
        read.assembled.events.filter((event) => event.kind === kind).reduce((sum, event) => sum + Number(event.hours), 0);
      expect({ name, usage: usagePeriodOf(read.key), vacation: hours("vacation"), rol: hours("rol") }).toEqual({
        name,
        usage: periodOfRow(usageMonth.replace("*", "")),
        vacation: Number(italian(vacationUsed)),
        rol: Number(italian(rolUsed)),
      });
      expect(read.assembled.values.vacationRemaining).toBe(Number(italian(vacationLeft)).toFixed(2));
      expect(read.assembled.values.rolRemaining).toBe(Number(italian(rolLeft)).toFixed(2));
    }
  });

  it("passes every blocking check: IRPEF, the net to the cent, deductions, substitute tax, leave (L10)", () => {
    for (const read of byKey.values()) {
      const failed = read.assembled.checks.filter((check) => check.status === "failed" && check.severity === "error");
      expect({ key: read.key, failed }).toEqual({ key: read.key, failed: [] });
      expect(read.assembled.checks.find((check) => check.id === "net")?.status).toBe("passed");
    }
  });

  it("skips the IRPEF identity for the 13th and the December year-end adjustment, with the reason", () => {
    const thirteenth = [...byKey.values()].find((read) => read.parsed.identity?.type === "thirteenth")!;
    expect(thirteenth.assembled.checks.find((check) => check.id === "irpef")).toMatchObject({
      status: "skipped",
      reason: "extra_month",
    });
    const adjusted = [...byKey.values()].filter((read) => read.assembled.values.yearEndAdjustment !== null);
    expect(adjusted.length).toBeGreaterThan(0);
    for (const read of adjusted) {
      expect(read.assembled.checks.find((check) => check.id === "irpef")?.reason).toBe("year_end_adjustment");
    }
  });

  it("links every printed value to its page and box (acceptance 1)", () => {
    for (const read of byKey.values()) {
      for (const field of read.parsed.fields) {
        if (field.value === null) continue;
        expect({ field: field.field, page: field.page, box: field.bbox?.length }).toEqual({
          field: field.field,
          page: 1,
          box: 4,
        });
        for (const coordinate of field.bbox!) expect(coordinate).toBeGreaterThanOrEqual(0);
      }
    }
  });

  it("keeps December and the 13th apart: two logical keys (acceptance 2)", () => {
    const keys = [...byKey.values()].map((read) =>
      logicalKey({
        employerKey: read.assembled.values.employerKey!,
        employeeKey: read.assembled.values.employeeKey!,
        year: read.parsed.identity!.year,
        type: read.parsed.identity!.type,
        period: read.parsed.identity!.period,
      }),
    );
    expect(new Set(keys).size).toBe(keys.length);
  });

  it("gives the 13th no leave events, keeps its employer fund adjustment apart, and says nothing about it (acceptance 6, L147)", () => {
    const thirteenth = [...byKey.values()].find((read) => read.parsed.identity?.type === "thirteenth")!;
    expect(thirteenth.assembled.events).toEqual([]);
    // Never summed into a month's employer contribution — and, on an extra month, never a remark
    // either: that is how a 13th is written, so there is nothing for the owner to review.
    expect(thirteenth.assembled.values.employerFundEffective).toBeNull();
    expect(thirteenth.assembled.warnings.map((warning) => warning.code)).not.toContain(
      "employer_fund_adjustment_only",
    );
    // The employee side: regular quota and adjustment, and their sum (L145).
    const regular = moneyOf(thirteenth.assembled.values, "employeeFundRegular")!;
    const adjustment = moneyOf(thirteenth.assembled.values, "employeeFundAdjustments")!;
    expect(adjustment < 0n).toBe(true);
    expect(thirteenth.assembled.values.employeeFundEffective).toBe(centsToDecimal(regular + adjustment));
  });

  it("counts leave by the month it was used and by payslip year, as acceptance 7 and L222 say", () => {
    const [usedIn, vacationUsed] = /Ferie utilizzate nel (\d{4}) documentate fin qui: \*\*(\d+) ore\*\*/.exec(spec)!.slice(1);
    const recorded = /Le (\d+) ore sono il totale degli eventi nei PDF/.exec(spec)![1];
    const rolUsed = /filtro “anno utilizzo \d{4}” mostra \d+ ore ferie e (\d+) ore ROL/.exec(spec)![1];
    const events = [...byKey.values()].flatMap((read) =>
      read.assembled.events.map((event) => ({ ...event, usage: usagePeriodOf(read.key), payroll: read.key })),
    );
    const sum = (list: typeof events) => list.reduce((total, event) => total + Number(event.hours), 0);
    const usedThatYear = events.filter((event) => event.usage.startsWith(usedIn));
    expect(sum(usedThatYear.filter((event) => event.kind === "vacation"))).toBe(Number(vacationUsed));
    expect(sum(usedThatYear.filter((event) => event.kind === "rol"))).toBe(Number(rolUsed));
    const paidThatYear = events.filter((event) => event.payroll.startsWith(usedIn) && event.kind === "vacation");
    expect(sum(paidThatYear)).toBe(Number(recorded));
  });

  it("sums the TFR once per payslip, whichever form is printed (L153–161)", () => {
    const match = /Somma degli importi TFR esposti senza duplicazioni: ([\d.,]+) € nel (\d{4}) e ([\d.,]+) € nel (\d{4})/.exec(spec)!;
    for (const [amount, year] of [
      [match[1], match[2]],
      [match[3], match[4]],
    ]) {
      const total = [...byKey.values()]
        .filter((read) => read.parsed.identity!.year === Number(year))
        .reduce((sum, read) => sum + (moneyOf(read.assembled.values, "tfrSelected") ?? 0n), 0n);
      expect(centsToDecimal(total)).toBe(italian(amount));
    }
    const partial = [...byKey.values()].find((read) => read.assembled.values.tfrSource === "month_field")!;
    expect(partial.assembled.warnings.map((warning) => warning.code)).toContain("tfr_partial_month");
  });

  it("sums the fund quotas of the year the spec names, never the statistical summary line (L149, acceptance 5)", () => {
    const match = /Totali gennaio–agosto: dipendente ([\d.,]+) €, azienda ([\d.,]+) €/.exec(spec)!;
    const ofYear = [...byKey.values()].filter(
      (read) => read.parsed.identity!.year === 2026 && read.parsed.identity!.type === "ordinary",
    );
    const sum = (field: "employeeFundEffective" | "employerFundEffective") =>
      centsToDecimal(ofYear.reduce((total, read) => total + (moneyOf(read.assembled.values, field) ?? 0n), 0n));
    expect(sum("employeeFundEffective")).toBe(italian(match[1]));
    expect(sum("employerFundEffective")).toBe(italian(match[2]));
  });

  it("keeps salary, welfare, the 730 refund, the fund and the TFR in fields of their own (acceptance 12)", () => {
    const welfare = [...byKey.values()].find((read) => read.assembled.values.welfareCash !== null)!;
    // The gross leaves the welfare reimbursement out; the printed total keeps it (L109).
    expect(moneyOf(welfare.assembled.values, "totalGrossPrinted")! - moneyOf(welfare.assembled.values, "gross")!).toBe(
      moneyOf(welfare.assembled.values, "welfareCash"),
    );
    expect(welfare.assembled.values.welfareInKind).not.toBeNull();
    const refund = [...byKey.values()].find((read) => read.assembled.values.refund730 !== null)!;
    // Taxes net of refunds may be negative: a cash balance (L128).
    expect(moneyOf(refund.assembled.values, "taxesNetOfRefunds")! < moneyOf(refund.assembled.values, "taxesTotal")!).toBe(true);
    expect(refund.assembled.values.compensatedCredit).not.toBeNull();
    for (const field of ["welfareCash", "refund730", "employeeFundEffective", "tfrSelected"] as const) {
      expect(FIELDS[field]).toBeDefined();
    }
  });
});
