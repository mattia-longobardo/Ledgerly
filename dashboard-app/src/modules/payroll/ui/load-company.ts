import type { MonthPoint } from "@/lib/contracts";
import { NotFoundError } from "../application/errors";
import { addMoney } from "../domain/money";
import type { SalaryWindow, WindowKey } from "./SalarySection";
import { listImports } from "../application/list-imports";
import { earningsSummary, getRecord, listRecords } from "../application/list-records";
import type { EarningsBucket, EarningsSummary } from "../domain/earnings";
import type { PayrollRecord } from "../application/ports";
import { runForPrincipal } from "./run";

/** Flat and serialisable: these cross the server/client boundary. */
export interface EarningsRow {
  id: string;
  periodStart: string;
  kind: string;
  gross: string | null;
  net: string | null;
  taxes: string | null;
}

export interface ComponentRow {
  id: string;
  code: string;
  labelRaw: string;
  kind: string;
  amount: string | null;
  quantity: string | null;
  unit: string | null;
  confidence: string | null;
  source: string;
}

export interface CompanyOverview {
  latestImport: { id: string; status: string; scanStatus: string; fileName: string } | null;
  pendingReview: number;
  /** This calendar year's bucket, or null when there is no record in it. */
  year: EarningsBucket | null;
  months: EarningsBucket[];
  salaryWindows: SalaryWindow[];
}

export interface RecordDetailData {
  record: EarningsRow;
  importId: string;
  components: ComponentRow[];
  canReadOriginal: boolean;
  /** False once the retention job has purged the object (Ruling R4-5). */
  originalAvailable: boolean;
}

/** `null`, never 0: an average of nothing is not zero (global constraint). */
function averageOf(values: readonly (string | null)[]): number | null {
  const numbers = values.filter((v): v is string => v !== null).map(Number);
  if (numbers.length === 0) return null;
  return numbers.reduce((a, b) => a + b, 0) / numbers.length;
}

/**
 * The record's tax line. A **sum**, not the first match: this phase's parser
 * produces exactly one `tax` component, but a later mapping rule may classify a
 * second, and a `find` would then under-report it silently. `null` when there is
 * no tax component at all — never `0.00`.
 */
function taxesByRecord(components: readonly ComponentRow[]): string | null {
  return components.filter((c) => c.kind === "tax").reduce<string | null>((acc, c) => addMoney(acc, c.amount), null);
}

/**
 * The three averaging windows the Salary panel switches between, computed on the
 * server for all three so the client component does no arithmetic — exactly the
 * contract `SalarySection` already documents.
 *
 * A tredicesima is excluded from the average and from the bars, matching the
 * panel's own "Tredicesima excluded" caption and the legacy `averageNet`'s
 * behaviour.
 */
function salaryWindows(records: readonly PayrollRecord[]): SalaryWindow[] {
  const ordinary = records.filter((r) => r.kind === "ordinary");
  if (ordinary.length === 0) return [];
  return (["3", "6", "12"] as const).map((key: WindowKey) => {
    const months = Number(key);
    const window = ordinary.slice(0, months);
    const series: MonthPoint[] = [...window]
      .reverse()
      .map((r) => ({ month: r.periodStart, value: r.net === null ? null : Number(r.net) }));
    return { key, avgNet: averageOf(window.map((r) => r.net)), avgTaxes: null, series };
  });
}

export async function loadCompanyOverview(): Promise<CompanyOverview> {
  return runForPrincipal(async (deps, principal) => {
    const [imports, records, summary] = await Promise.all([
      listImports(deps)(principal, { limit: 50 }),
      listRecords(deps)(principal),
      earningsSummary(deps)(principal),
    ]);
    const latest = imports[0] ?? null;
    const thisYear = String(deps.clock.now().getUTCFullYear());
    const windows = salaryWindows(records);
    // Taxes come from the summary, which already read the components once;
    // asking again per window would be a second full read for the same numbers.
    const withTaxes = windows.map((w) => {
      const keys = new Set(w.series.map((p) => p.month.slice(0, 7)));
      const buckets = summary.months.filter((m) => keys.has(m.key));
      return { ...w, avgTaxes: averageOf(buckets.map((b) => b.taxes)) };
    });
    return {
      latestImport: latest
        ? { id: latest.id, status: latest.status, scanStatus: latest.scanStatus, fileName: latest.fileName }
        : null,
      pendingReview: imports.filter((i) => i.status === "needs_review" || i.status === "needs_ocr").length,
      year: summary.years.find((y) => y.key === thisYear) ?? null,
      months: summary.months,
      salaryWindows: withTaxes,
    };
  });
}

export async function loadEarnings(
  opts: { from?: string; to?: string } = {},
): Promise<{ rows: EarningsRow[]; summary: EarningsSummary }> {
  return runForPrincipal(async (deps, principal) => {
    const records = await listRecords(deps)(principal, opts);
    const components = await deps.components.listForRecords(records.map((r) => r.id));
    const summary = await earningsSummary(deps)(principal, opts);
    const byRecord = new Map<string, ComponentRow[]>();
    for (const c of components) {
      const list = byRecord.get(c.recordId) ?? [];
      list.push({
        id: c.id, code: c.code, labelRaw: c.labelRaw, kind: c.kind,
        amount: c.amount, quantity: c.quantity, unit: c.unit, confidence: c.confidence, source: c.source,
      });
      byRecord.set(c.recordId, list);
    }
    return {
      rows: records.map((r) => ({
        id: r.id,
        periodStart: r.periodStart,
        kind: r.kind,
        gross: r.gross,
        net: r.net,
        taxes: taxesByRecord(byRecord.get(r.id) ?? []),
      })),
      summary,
    };
  });
}

export async function loadRecordDetail(recordId: string): Promise<RecordDetailData | null> {
  return runForPrincipal(async (deps, principal) => {
    // Only a missing record renders as "not found"; any other failure is a real
    // error and must surface as one.
    const detail = await getRecord(deps)(principal, recordId).catch((err: unknown) => {
      if (err instanceof NotFoundError) return null;
      throw err;
    });
    if (!detail) return null;
    const source = await deps.imports.get(principal.userId, detail.record.importId);
    const components: ComponentRow[] = detail.components.map((c) => ({
      id: c.id, code: c.code, labelRaw: c.labelRaw, kind: c.kind,
      amount: c.amount, quantity: c.quantity, unit: c.unit, confidence: c.confidence, source: c.source,
    }));
    return {
      record: {
        id: detail.record.id,
        periodStart: detail.record.periodStart,
        kind: detail.record.kind,
        gross: detail.record.gross,
        net: detail.record.net,
        taxes: taxesByRecord(components),
      },
      importId: detail.record.importId,
      components,
      canReadOriginal: principal.permissions.has("payroll.read_original"),
      originalAvailable: source?.storageKey !== null && source?.scanStatus === "clean",
    };
  });
}
