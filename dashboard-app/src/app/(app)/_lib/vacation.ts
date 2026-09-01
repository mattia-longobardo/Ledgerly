import type { PayslipExtraction, PayslipField } from "@/lib/contracts";
import {
  ferieRemaining,
  leaveTakenByMonth,
  leaveTakenYtd,
  type FerieRemaining,
  type LeaveTakenMonth,
} from "@/lib/calc/payroll";
import type { Payslip } from "@/lib/db/schema";
import { latestVerified, verifiedPayslips } from "@/lib/repo/payslips";
import { SETTING_KEYS, getSetting } from "@/lib/repo/settings";

export const DEFAULT_HOURS_PER_DAY = 8;

export function extractionOf(raw: unknown): PayslipExtraction | null {
  if (raw === null || typeof raw !== "object") return null;
  const candidate = raw as Partial<PayslipExtraction>;
  return typeof candidate.fields === "object" && candidate.fields !== null
    ? (candidate as PayslipExtraction)
    : null;
}

export function extractedField(
  extraction: PayslipExtraction | null,
  field: PayslipField,
): number | null {
  return extraction?.fields[field]?.value ?? null;
}

export async function hoursPerDay(): Promise<number> {
  const raw = await getSetting<unknown>(SETTING_KEYS.hoursPerDay, DEFAULT_HOURS_PER_DAY);
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? n : DEFAULT_HOURS_PER_DAY;
}

export interface FerieView {
  hoursPerDay: number;
  latest: Payslip | null;
  remaining: FerieRemaining;
  /** Leave used, one row per month, derived from the verified payslips. */
  takenByMonth: LeaveTakenMonth[];
  takenDaysYtd: number;
  year: number;
}

/**
 * Ferie/ROL is PAYSLIP-AUTHORITATIVE end to end: the residuals come from the
 * latest verified payslip and the days used come from the `ferie_taken` /
 * `rol_taken` columns of every verified payslip. Nothing here is hand-entered.
 *
 * `permessi` is read from the raw extraction so it can be shown beside the
 * headline — never folded into it.
 */
export async function loadFerie(year = new Date().getFullYear()): Promise<FerieView> {
  const [latest, verified, perDay] = await Promise.all([
    latestVerified(),
    verifiedPayslips(),
    hoursPerDay(),
  ]);

  const permessi = extractedField(extractionOf(latest?.rawExtraction), "permessiBalance");
  const remaining = ferieRemaining(
    latest === null
      ? null
      : {
          month: latest.month,
          isThirteenth: latest.isThirteenth,
          ferieBalance: latest.ferieBalance,
          ferieUnit: latest.ferieUnit,
          rolBalance: latest.rolBalance,
          rolUnit: latest.rolUnit,
          permessiBalance: permessi,
          permessiUnit: "hours",
        },
    perDay,
  );

  return {
    hoursPerDay: perDay,
    latest,
    remaining,
    takenByMonth: leaveTakenByMonth(verified, perDay),
    takenDaysYtd: leaveTakenYtd(verified, year, perDay).totalDays,
    year,
  };
}
