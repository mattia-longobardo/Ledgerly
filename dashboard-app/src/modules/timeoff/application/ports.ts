import type { AuditInput } from "@/platform/audit/record";
import type { EventLike } from "../domain/events";

export type TimeoffCode = "vacation" | "comp" | "permits" | "sick" | "other";

/** The order every list of types is rendered in (R7-1 seeds the first three). */
export const TIMEOFF_CODE_ORDER: readonly TimeoffCode[] = ["vacation", "permits", "comp", "sick", "other"];

export interface TimeoffType {
  id: string;
  userId: string;
  code: TimeoffCode;
  label: string;
  unit: "hours" | "days";
  /** Two-decimal string; the divisor `domain/units.ts` converts with. */
  hoursPerDay: string;
  createdAt: Date;
  updatedAt: Date;
}

export interface TimeoffBalance {
  id: string;
  userId: string;
  typeId: string;
  asOf: string;
  accrued: string | null;
  used: string | null;
  remaining: string | null;
  pending: string | null;
  unit: "hours" | "days";
  source: "payroll" | "manual";
  payrollRecordId: string | null;
  createdAt: Date;
}

export interface TimeoffEvent extends EventLike {
  userId: string;
  typeId: string;
  syncedAt: Date | null;
  /** Joined from `provider_links` (R7-3), never a column on the event row. */
  trekEntryId: number | null;
  version: number;
  createdAt: Date;
  updatedAt: Date;
}

export interface TypesRepository {
  /** `vacation, permits, comp, sick, other` — `TIMEOFF_CODE_ORDER`. */
  list(userId: string): Promise<TimeoffType[]>;
  getByCode(userId: string, code: TimeoffCode): Promise<TimeoffType | null>;
  create(input: Omit<TimeoffType, "id" | "createdAt" | "updatedAt">): Promise<TimeoffType>;
}

export interface BalancesRepository {
  /** The latest row per type, keyed by `typeId`. R7-4: absent means "—", not zero. */
  latestPerType(userId: string): Promise<Map<string, TimeoffBalance>>;
  /** Every row whose `asOf` falls in the year, `as_of asc`. */
  listForYear(userId: string, year: number): Promise<TimeoffBalance[]>;
  /** Upserts on `(typeId, payrollRecordId)`. */
  upsertForRecord(input: Omit<TimeoffBalance, "id" | "createdAt">): Promise<TimeoffBalance>;
  deleteByPayrollRecord(userId: string, payrollRecordId: string): Promise<number>;
}

export interface ProviderEventWrite {
  date: string;
  fraction: string;
  typeId: string;
  trekEntryId: number;
  note: string | null;
}

export interface EventsRepository {
  /** `date asc`, `trekEntryId` joined from `provider_links`. */
  inRange(userId: string, from: string, to: string): Promise<TimeoffEvent[]>;
  at(userId: string, date: string): Promise<TimeoffEvent | null>;
  /** Everything whose `pendingOp <> 'none'`. */
  pending(userId: string): Promise<TimeoffEvent[]>;
  /** `origin 'trek'`, `pendingOp 'none'`, `syncedAt = now`, `provider_links` upserted. */
  upsertFromProvider(userId: string, rows: readonly ProviderEventWrite[], now: Date): Promise<number>;
  /** Hard delete, links included. */
  deleteDates(userId: string, dates: readonly string[]): Promise<number>;
  /**
   * Drops the `provider_links` row for these dates and clears `syncedAt`,
   * keeping the events themselves.
   *
   * The one case that needs it: a day Trek owned, retyped to a type Trek
   * cannot hold, whose entry the sync has just removed upstream. The day stays
   * — it is the owner's — but it is no longer Trek's, and a stale link would
   * make `removeEvent` stage a delete for an entry that is already gone.
   * `syncedAt` goes with the link for the same reason: there is nothing left
   * upstream for it to be the sync time OF.
   */
  unlinkProvider(userId: string, dates: readonly string[], now: Date): Promise<number>;
  /** `pendingOp 'upsert'`; a row that came from Trek keeps `origin 'trek'`. */
  stageUpsert(
    userId: string,
    input: { date: string; fraction: string; typeId: string; note: string | null },
    now: Date,
  ): Promise<TimeoffEvent>;
  /** `pendingOp 'delete'`; the row is kept so the next pass can carry the intent upstream. */
  stageDelete(userId: string, date: string, now: Date): Promise<TimeoffEvent | null>;
  /**
   * Settles a pushed batch: rows staged `delete` are deleted (links included),
   * the rest become `none` with `syncedAt = now`, and `trekIds` (keyed by date)
   * writes the `provider_links` row for an entry Trek has just created.
   */
  clearPending(
    userId: string,
    dates: readonly string[],
    now: Date,
    trekIds?: ReadonlyMap<string, number>,
  ): Promise<number>;
}

/** Opens one short RLS context per call. Trek network calls happen outside it. */
export interface TimeoffStore {
  withEvents<T>(
    userId: string,
    fn: (events: EventsRepository, types: TypesRepository) => Promise<T>,
  ): Promise<T>;
}

export interface Clock {
  now(): Date;
}

export interface UseCaseDeps {
  types: TypesRepository;
  balances: BalancesRepository;
  events: EventsRepository;
  settings: { hoursPerDay(): Promise<string> };
  clock: Clock;
  audit: (e: AuditInput) => Promise<void>;
}
