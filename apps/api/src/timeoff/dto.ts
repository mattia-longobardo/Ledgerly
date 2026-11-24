// Time off · the one serializer of the year and of an allowance (audit API-2, TOF-7): the route
// `GET /timeoff/{year}` and the tool `get_time_off` answer through these. The provider of the
// external calendar does not reach the wire (rule M12, TOF-2): a day it brought is `external`.
//
// The types of leave are data since R5g. The fields of the two old kinds stay on the wire,
// deprecated, until R5f (decision 1 = A: the OpenAPI only grows): this file is where they are worked
// out from the types — the one place of the API that names the old kinds.
import type { z } from "zod";
import type { TIMEOFF } from "@ledgerly/api-contract";
import { LEAVE_KINDS } from "@ledgerly/api-contract/timeoff";
import type { Allowance, LeaveTypeView, timeOffView } from "@ledgerly/domain/timeoff";

type Year = z.input<typeof TIMEOFF.timeoff.getTimeOff.response>;
type WireAllowance = z.input<typeof TIMEOFF.timeoff.saveTimeOffAllowance.response>;
type View = Awaited<ReturnType<typeof timeOffView>>;
type OldKind = (typeof LEAVE_KINDS)[number];
type Counted = "vacation" | "rol";

const VACATION: OldKind = "vacation";
const ROL: OldKind = "rol";
const OTHER: OldKind = "other";

const days = (value: string | null): number | null => (value === null ? null : Number(value));
const asOld = (value: string | null): OldKind | null => LEAVE_KINDS.find((one) => one === value) ?? null;

/** The old kind a type stands for: its own, or the payslip balance it reads when that is one. */
function oldKindOf(type: Pick<LeaveTypeView, "legacyKind" | "balanceKey">): OldKind {
  return asOld(type.legacyKind) ?? asOld(type.balanceKey) ?? OTHER;
}

/** The type a client that sends an old kind means: the first of the person's with that kind. */
export function typeOfOldKind(types: readonly LeaveTypeView[], kind: string): string | null {
  return types.find((type) => oldKindOf(type) === kind)?.id ?? null;
}

/** The two old parts of a year's allowance, each with the old kind of the type it goes to. */
export function oldAllowanceParts(body: {
  vacationDays: number | null;
  rolDays: number | null;
}): ReadonlyArray<readonly [OldKind, number | null]> {
  return [
    [VACATION, body.vacationDays],
    [ROL, body.rolDays],
  ];
}

/** An allowance in days, as Time off › Settings showed it: `numeric(5,2)` "26.00" is 26. */
export function allowanceOut(allowance: Allowance): WireAllowance {
  return {
    year: allowance.year,
    vacationDays: days(allowance.vacationDays),
    rolDays: days(allowance.rolDays),
    totalDays: days(allowance.totalDays),
    note: allowance.note,
  };
}

/** The difference between the two parts and the total of the old row, when all three are stated. */
function mismatchOf(allowance: Allowance | null): number | null {
  const [total, vacation, rol] = [allowance?.totalDays, allowance?.vacationDays, allowance?.rolDays].map(
    (one) => (one == null ? null : Number(one)),
  );
  if (total === null || vacation === null || rol === null) return null;
  const difference = vacation + rol - total;
  // A tenth of a day is rounding between two units, not a disagreement worth a sentence.
  return Math.abs(difference) < 0.1 ? null : difference;
}

/** The Time off page of one year. */
export function timeOffYear(view: View, external: Year["external"]): Year {
  const { allowance, rows, balances, types, unrecorded, overdrawn, totals, months, ...rest } = view;
  const kindOf = new Map(types.map((type) => [type.id, oldKindOf(type)]));
  const oldOf = (typeId: string | null): OldKind => (typeId === null ? OTHER : (kindOf.get(typeId) ?? OTHER));
  const withKinds = <D extends { typeId: string; minutes?: number | null }>(list: readonly D[]) =>
    list.map((day) => ({ ...day, kind: oldOf(day.typeId), minutes: day.minutes ?? null }));
  const sumOf = (list: readonly { typeId: string; minutes: number }[], test: (kind: OldKind) => boolean) =>
    list.filter((one) => test(oldOf(one.typeId))).reduce((sum, one) => sum + one.minutes, 0);

  const wireBalances = balances.map((balance) => ({
    ...balance,
    residualInput: {
      ...balance.residualInput,
      today: balance.residualInput.today ?? null,
      days: withKinds(balance.residualInput.days),
    },
    forecastInput: { ...balance.forecastInput, days: withKinds(balance.forecastInput.days) },
  }));
  const balanceOf = (kind: Counted) => wireBalances.find((one) => oldOf(one.typeId) === kind);
  const kindView = (kind: Counted) => {
    const found = balanceOf(kind);
    if (found)
      return {
        residual: found.residual,
        allowanceMinutes: found.allowanceMinutes,
        carriedMinutes: found.carriedMinutes,
      };
    const residual = {
      basis: "unknown" as const,
      remainingMinutes: null,
      takenMinutes: 0,
      plannedMinutes: 0,
      snapshotPeriod: null,
      countedThrough: view.countedThrough,
    };
    return { residual, allowanceMinutes: null, carriedMinutes: 0 };
  };
  const emptyForecast = {
    rate: null,
    opening: {
      source: "year" as const,
      minutes: 0,
      accruedThrough: view.window.from,
      spentFrom: view.window.from,
    },
    days: [],
    minutesPerDay: view.minutesPerDay,
  };
  const residualInputOf = (kind: Counted) =>
    balanceOf(kind)?.residualInput ?? {
      snapshot: null,
      allowanceMinutes: null,
      carriedMinutes: 0,
      days: [],
      countedThrough: view.countedThrough,
      today: null,
      minutesPerDay: view.minutesPerDay,
    };
  const accrualOf = (kind: Counted) =>
    balanceOf(kind)?.accrual ?? { rate: null, yearEndMinutes: null, payslipPeriod: null, leads: false };
  const counted = (kind: OldKind): kind is Counted => kind === VACATION || kind === ROL;

  return {
    ...rest,
    types: types.map(({ id, name, color, unit, hasAllowance, toCalendar }) => ({
      id,
      name,
      color,
      unit,
      hasAllowance,
      toCalendar,
    })),
    balances: wireBalances,
    external,
    allowance: allowance === null ? null : allowanceOut(allowance),
    totalAllowanceMinutes:
      allowance?.totalDays == null ? null : Math.round(Number(allowance.totalDays) * view.minutesPerDay),
    allowanceMismatch: mismatchOf(allowance),
    vacation: kindView(VACATION as Counted),
    rol: kindView(ROL as Counted),
    residualInputs: { vacation: residualInputOf("vacation"), rol: residualInputOf("rol") },
    forecastInputs: {
      vacation: balanceOf("vacation")?.forecastInput ?? emptyForecast,
      rol: balanceOf("rol")?.forecastInput ?? emptyForecast,
    },
    accrual: { vacation: accrualOf("vacation"), rol: accrualOf("rol") },
    unrecordedByType: unrecorded,
    unrecorded: unrecorded.flatMap(({ typeId, ...one }) => {
      const kind = oldOf(typeId);
      return counted(kind) ? [{ ...one, kind }] : [];
    }),
    overdrawnByType: overdrawn,
    overdrawn: overdrawn.flatMap(({ typeId, ...one }) => {
      const kind = oldOf(typeId);
      return counted(kind) ? [{ ...one, kind }] : [];
    }),
    totals: {
      takenMinutes: totals.takenMinutes,
      plannedMinutes: totals.plannedMinutes,
      totalMinutes: totals.totalMinutes,
      byType: totals.byType,
      byKind: LEAVE_KINDS.map((kind) => ({
        kind,
        minutes: sumOf(totals.byType, (one) => one === kind),
      })).filter((one) => one.minutes > 0),
    },
    months: months.map(({ payroll, recorded, ...month }) => ({
      ...month,
      payroll:
        payroll === null
          ? null
          : {
              vacationMinutes: sumOf(payroll, (one) => one === VACATION),
              // As before R5g: every use a payslip counts that is not vacation is the other balance.
              rolMinutes: sumOf(payroll, (one) => one !== VACATION),
            },
      recorded: {
        vacationMinutes: sumOf(recorded, (one) => one === VACATION),
        rolMinutes: sumOf(recorded, (one) => one === ROL),
        otherMinutes: sumOf(recorded, (one) => !counted(one)),
      },
      payrollByType: payroll,
      recordedByType: recorded,
    })),
    rows: rows.map((row) => {
      if (row.source === "payroll") return row as Extract<Year["rows"][number], { source: "payroll" }>;
      const { origin, pending, kind, ...day } = row;
      return {
        ...day,
        kind: asOld(kind) ?? oldOf(row.typeId),
        origin: origin === "manual" ? "manual" : "external",
        sync: pending,
      };
    }),
  };
}
