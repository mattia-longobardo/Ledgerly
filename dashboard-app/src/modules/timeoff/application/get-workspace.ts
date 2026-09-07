import type { CachedTrekStats } from "@/lib/repo/trek-state";
import type { Principal } from "@/platform/auth/principal";
import { assertPermission } from "@/platform/auth/principal";
import { statusAt, upcoming } from "../domain/events";
import { addQuantity, toDays } from "../domain/units";
import { seedDefaultTypes } from "./ensure-default-types";
import type { TimeoffBalance, TimeoffCode, TimeoffEvent, TimeoffType, UseCaseDeps } from "./ports";

export interface BalanceView {
  type: TimeoffType;
  asOf: string | null;
  remainingHours: string | null;
  remainingDays: string | null;
  usedYtdHours: string | null;
  /**
   * null when nothing has ever written a balance for this type (R7-4: show
   * "—"). `"manual"` is admitted by the column, so the view carries it rather
   * than flattening a hand-entered figure to "no source".
   */
  source: TimeoffBalance["source"] | null;
}

export interface DayDetail {
  date: string;
  event: TimeoffEvent | null;
  status: "planned" | "taken" | "cancelled" | null;
}

export interface WorkspaceDay {
  fraction: string;
  typeCode: TimeoffCode;
  note: string | null;
  status: string;
  pendingOp: string;
}

export interface TimeoffWorkspace {
  year: number;
  today: string;
  types: TimeoffType[];
  balances: BalanceView[];
  /** Every event of the year, keyed by date — the page builds its own grid from this. */
  byDate: Record<string, WorkspaceDay>;
  selected: DayDetail | null;
  upcoming: TimeoffEvent[];
  /** Days booked between 1 January and today inclusive, non-cancelled, as a decimal string. */
  plannedDaysYtd: string;
  pendingCount: number;
  trekConnected: boolean;
  cachedStats: CachedTrekStats | null;
}

export interface GetWorkspaceInput {
  year: number;
  selectedDate?: string | null;
  trekConnected: boolean;
  cachedStats: CachedTrekStats | null;
}

const UPCOMING_LIMIT = 10;

function isoDate(now: Date): string {
  return now.toISOString().slice(0, 10);
}

export function getWorkspace(deps: UseCaseDeps) {
  return async (principal: Principal, input: GetWorkspaceInput): Promise<TimeoffWorkspace> => {
    assertPermission(principal, "timeoff.read");
    const hoursPerDay = await deps.settings.hoursPerDay();
    const types = await seedDefaultTypes(deps.types, principal.userId, hoursPerDay);
    const today = isoDate(deps.clock.now());

    const events = await deps.events.inRange(
      principal.userId,
      `${input.year}-01-01`,
      `${input.year}-12-31`,
    );
    const latest = await deps.balances.latestPerType(principal.userId);
    const yearBalances = await deps.balances.listForYear(principal.userId, input.year);

    const usedYtd = new Map<string, string | null>();
    for (const balance of yearBalances) {
      // `used` is what one payslip reported for its own period; the year's rows
      // add up to the year to date. A type with no figure anywhere stays null
      // rather than becoming "0.00" (R7-4).
      const running = usedYtd.get(balance.typeId) ?? null;
      usedYtd.set(balance.typeId, addQuantity(running, balance.used));
    }

    const balances: BalanceView[] = types.map((type) => {
      const row = latest.get(type.id);
      return {
        type,
        asOf: row?.asOf ?? null,
        remainingHours: row?.remaining ?? null,
        remainingDays: row?.remaining == null ? null : toDays(row.remaining, type.hoursPerDay),
        usedYtdHours: usedYtd.get(type.id) ?? null,
        source: row ? row.source : null,
      };
    });

    const byDate: Record<string, WorkspaceDay> = {};
    for (const event of events) {
      byDate[event.date] = {
        fraction: event.fraction,
        typeCode: event.typeCode as TimeoffCode,
        note: event.note,
        status: statusAt(event, today),
        pendingOp: event.pendingOp,
      };
    }

    let selected: DayDetail | null = null;
    if (input.selectedDate) {
      const event = events.find((candidate) => candidate.date === input.selectedDate) ?? null;
      selected = {
        date: input.selectedDate,
        event,
        status: event ? statusAt(event, today) : null,
      };
    }

    // Planned days year-to-date, across every type — the figure a payslip's
    // "used" is comparable with. A fraction IS already a count of days, so
    // this needs no hours conversion and stays exact for a run of half days.
    let plannedDaysYtd: string | null = null;
    for (const event of events) {
      if (event.date > today || event.status === "cancelled") continue;
      plannedDaysYtd = addQuantity(plannedDaysYtd, event.fraction);
    }

    return {
      year: input.year,
      today,
      types,
      balances,
      byDate,
      selected,
      upcoming: upcoming(events, today, UPCOMING_LIMIT),
      plannedDaysYtd: plannedDaysYtd ?? "0.00",
      pendingCount: events.filter((event) => event.pendingOp !== "none").length,
      trekConnected: input.trekConnected,
      cachedStats: input.cachedStats,
    };
  };
}
