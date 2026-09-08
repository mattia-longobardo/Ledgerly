import type { PayrollComponent, PayrollRecord } from "../application/ports";
import { addMoney } from "./money";

/**
 * One figure per bucket carries this. `true` means at least one of the
 * records folded into this bucket had no value for that specific figure —
 * `addMoney(x, null) === x`, so the number above is the sum of whichever
 * records *did* report it, not a confirmed total for every record the
 * bucket counts. A caller must not present the figure as complete without
 * checking this (Finding 4, B2 whole-branch review): "never invent
 * financial data" applies at the aggregate level, not only per record.
 */
export interface EarningsBucketPartial {
  gross: boolean;
  net: boolean;
  taxes: boolean;
  contributions: boolean;
}

export interface EarningsBucket {
  /** `2026-08`, `2026-Q3` or `2026`. */
  key: string;
  gross: string | null;
  net: string | null;
  taxes: string | null;
  contributions: string | null;
  recordCount: number;
  /** Per-figure caveat: true if any of the `recordCount` records had no value for that figure. */
  partial: EarningsBucketPartial;
}

export interface EarningsSummary {
  months: EarningsBucket[];
  quarters: EarningsBucket[];
  years: EarningsBucket[];
}

const TAX_KINDS = new Set<PayrollComponent["kind"]>(["tax"]);
const CONTRIBUTION_KINDS = new Set<PayrollComponent["kind"]>(["employee_contribution", "employer_contribution"]);

interface Accumulator {
  gross: string | null;
  net: string | null;
  taxes: string | null;
  contributions: string | null;
  recordCount: number;
  partial: EarningsBucketPartial;
}

function empty(): Accumulator {
  return {
    gross: null,
    net: null,
    taxes: null,
    contributions: null,
    recordCount: 0,
    partial: { gross: false, net: false, taxes: false, contributions: false },
  };
}

function bucketsOf(map: Map<string, Accumulator>): EarningsBucket[] {
  return [...map.entries()]
    // Newest first: every key in each family is lexicographically ordered
    // (`2026-08`, `2026-Q3`, `2026`), so one comparator serves all three.
    .sort((a, b) => b[0].localeCompare(a[0]))
    .map(([key, acc]) => ({ key, ...acc }));
}

/**
 * Ruling R4-12: Earnings is computed from records and components, never from
 * imports. The caller passes only live records (`superseded_at IS NULL`), so a
 * corrected month appears exactly once, at its corrected value.
 *
 * Every sum uses `addMoney`, which is `BigInt` cents — never a float. And every
 * figure starts at `null`, not `0.00`: a month whose payslip stated no tax line
 * reports "—", because a zero there would be a claim this system cannot make.
 */
export function summariseEarnings(
  records: readonly PayrollRecord[],
  components: readonly PayrollComponent[],
): EarningsSummary {
  const byRecord = new Map<string, PayrollComponent[]>();
  for (const component of components) {
    const list = byRecord.get(component.recordId) ?? [];
    list.push(component);
    byRecord.set(component.recordId, list);
  }

  const months = new Map<string, Accumulator>();
  const quarters = new Map<string, Accumulator>();
  const years = new Map<string, Accumulator>();

  for (const record of records) {
    const year = record.periodStart.slice(0, 4);
    const month = record.periodStart.slice(0, 7);
    const quarter = `${year}-Q${Math.floor((Number(record.periodStart.slice(5, 7)) - 1) / 3) + 1}`;

    let taxes: string | null = null;
    let contributions: string | null = null;
    for (const component of byRecord.get(record.id) ?? []) {
      if (TAX_KINDS.has(component.kind)) taxes = addMoney(taxes, component.amount);
      else if (CONTRIBUTION_KINDS.has(component.kind)) contributions = addMoney(contributions, component.amount);
    }

    for (const [map, key] of [
      [months, month],
      [quarters, quarter],
      [years, year],
    ] as const) {
      const acc = map.get(key) ?? empty();
      map.set(key, {
        gross: addMoney(acc.gross, record.gross),
        net: addMoney(acc.net, record.net),
        taxes: addMoney(acc.taxes, taxes),
        contributions: addMoney(acc.contributions, contributions),
        recordCount: acc.recordCount + 1,
        partial: {
          gross: acc.partial.gross || record.gross === null,
          net: acc.partial.net || record.net === null,
          taxes: acc.partial.taxes || taxes === null,
          contributions: acc.partial.contributions || contributions === null,
        },
      });
    }
  }

  return { months: bucketsOf(months), quarters: bucketsOf(quarters), years: bucketsOf(years) };
}
