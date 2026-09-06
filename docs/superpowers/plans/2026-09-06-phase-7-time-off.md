# Phase 7: Time Off workspace

> **For agentic workers:** Codex — one task per run, see "How to execute a plan with Codex" in `2026-09-06-phases-5-9-shared-conventions.md`. Claude Code — `superpowers:subagent-driven-development`, one task per subagent. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the last legacy island — `leave_days` plus the `ferie_*`/`rol_*` columns of the frozen `payslips` table — with a `timeoff` module: `timeoff_types`, `timeoff_balances` derived from applied payroll records, `timeoff_events` generalising `leave_days`, the Trek sync re-pointed at those tables with the Trek entry id in `provider_links`, and one unified Time Off workspace (calendar + balances by type + in-place day detail driven by a URL search param).

**Architecture:** New module `src/modules/timeoff/`. The Trek algorithm (`planPush`/`planPull` in `src/lib/jobs/trek-diff.ts`, the pass in `trek-sync.ts`) is kept and given a user-scoped events store instead of the module-level `db`; every database step runs inside `withUserContext` and every network step outside it. Balances are written by the payroll apply step through a `TimeoffBalanceSink` port (the same pattern as Phase 5's fund sink) and never typed by hand. The workspace page reads one `TimeoffWorkspace` view model.

**Tech stack:** as in the shared conventions. No new npm dependency.

**Spec:** §5.8 (`timeoff_types`, `timeoff_balances`, `timeoff_events`; `provider_links` holds the Trek entry id), §7.8 (Time Off: one workspace, URL search param, two-pane), §4 (`/company/time-off` visible when payroll or Trek available), §6 feature matrix ("Time Off calendar sync requires Trek connected; the calendar works manually without it"), §11 Phase 7 (exit: "earnings and time off clear in a unified experience"). Predecessors: Phase 4 Rulings R4-10/R4-11 (targets recorded, workspace deferred), Phase 6 checkpoint.

**Global Constraints:** see the shared conventions. Phase-specific:

- Migration **`0018`** (`0018_timeoff.sql`).
- New permissions `timeoff.read`, `timeoff.write`; `member` both, `viewer` read.
- Quantities (hours/days) are `numeric(8,2)` strings in the database and ports; conversions hours↔days use the type's `hours_per_day` and happen in `domain/units.ts` only.
- One event per `(user_id, date)` — the same invariant Trek enforces (`leave_days.date` was the primary key for that reason).
- Network I/O (Trek) never runs inside `withUserContext`. The sync is structured read → push (network) → write → pull (network) → write, each database step in its own short context.

## Scope cut

- No `sick`/`other` types seeded (the CHECK admits them; they can be added through the API).
- No approval workflow: `status` is stored as `planned` (or `cancelled`); "taken" is derived at read time from the date. `approved` stays in the CHECK, unused.
- No half-day granularity beyond Trek's `1 | 0.5`.
- No redesign of Company Overview beyond swapping its data source.

## Rulings

- **R7-1 Types are per user and seeded lazily.** `ensureDefaultTypes` creates `vacation` ("Ferie", hours), `permits` ("ROL / permessi", hours) and `comp` ("Recupero", hours), all with `hours_per_day` from the `hours_per_day` app setting (`src/lib/repo/settings.ts`, default 8). It runs at the start of every timeoff use case and is idempotent.
- **R7-2 Trek codes map to type codes.** Trek `vacation` ↔ type `vacation`; Trek `comp` ↔ type `comp`. Payroll mapping targets (`DEFAULT_MAPPING_RULES` in `src/modules/payroll/domain/mapping.ts`) already name `vacation` (ferie) and `permits` (ROL). `permits` events are never pushed to Trek.
- **R7-3 The Trek entry id lives in `provider_links`** (`provider = 'trek'`, `entity_type = 'timeoff_event'`, `entity_id = timeoff_events.id`, `external_id = String(trekEntryId)`). `pending_op` and `synced_at` stay on the event row: they are local sync state, not provider identity.
- **R7-4 Balances come from payroll only.** A `timeoff_balances` row is written per (type, payroll record) by the apply step: `remaining` from the `timeoff_balance` component, `used` from the `timeoff_used` component, `as_of = period_end`, `source = 'payroll'`. The workspace shows the latest row per type; with no rows it shows "No payslip applied yet", never zeros.
- **R7-5 `leave_days` is migrated, then frozen.** `scripts/migrate-timeoff.ts` copies every `leave_days` row into `timeoff_events` (+ `provider_links` for `trek_entry_id`) and backfills balances from existing `payroll_components`. The legacy table is dropped in Phase 9.

## What already exists, and what happens to it

| File | Fate |
|---|---|
| `src/lib/db/schema/legacy.ts` `leaveDays` | Frozen after Task 7's migration; dropped in Phase 9. |
| `src/lib/repo/leave.ts` (`daysInRange`, `pendingDays`, `upsertFromTrek`, `deleteDates`, `stageUpsert`, `stageDelete`, `clearPending`, `LeaveDayRow`) | Replaced by `EventsRepository` (Task 3) with the same operations, user-scoped. Deleted in Task 5. |
| `src/lib/jobs/trek-diff.ts` (+test) | Moved to `src/modules/timeoff/infrastructure/trek-diff.ts`; `LeaveDayRow` becomes `TimeoffEvent` (+ `trekEntryId` joined from `provider_links`). Task 5. |
| `src/lib/jobs/trek-sync.ts` (+test), `trek-sync-job.ts` | `runTrekSync` moves to `src/modules/timeoff/infrastructure/trek-sync.ts` and takes `{ userId, store: TimeoffStore }`. The job and `trek-provider-adapter.ts` call it with the connection owner's `userId`. Task 5. |
| `src/lib/repo/trek-state.ts` (`getCachedTrekStats`) | Kept as is (cached Trek stats are provider state, not domain data). |
| `src/app/(app)/company/time-off/page.tsx`, `company/_lib/leave.ts` (+test), `company/_components/LeaveCalendar.tsx`, `LeaveByMonth.tsx` | Replaced by the workspace (Task 6). `LeaveCalendar`'s `MonthGrid` usage is reused inside `TimeoffCalendar.tsx`. |
| `src/app/(app)/_lib/vacation.ts` (`loadFerie`, `hoursPerDay`, `DEFAULT_HOURS_PER_DAY`) | Deleted in Task 6. `hoursPerDay()` and `DEFAULT_HOURS_PER_DAY` move to `src/lib/repo/settings.ts`; `settings/personal/page.tsx` imports them from there. |
| `src/lib/repo/payslips.ts` | Loses its last consumers in Task 6 → deleted. The `payslips` table stays frozen. |
| `src/lib/calc/payroll.ts` (`ferieRemaining`, `leaveTakenByMonth`, `leaveTakenYtd`, `LeaveTakenMonth`) and `src/lib/calc/leave-variance.ts` (+test) | Leave functions deleted from `calc/payroll.ts` in Task 6 (salary functions stay: `averageNet`, `averageTaxes`, `ral`, `netPerMonthSeries`, `annualTotals`, `isThirteenthCandidate`). `leave-variance.ts` moves to `src/modules/timeoff/domain/variance.ts` (Task 2), its input now built from `timeoff_balances.used` and events. |
| `src/lib/calc/leave-day.ts` (`isWeekendBlocked`, `LeaveFraction`, `LeaveKind`) | Kept; imported by the domain. |
| `src/app/actions/leave.ts` (+test) | Rewritten as `src/app/actions/timeoff.ts` over the new use cases. Task 6. |
| `src/modules/payroll/application/ports.ts`, `apply-import.ts` | Gain `TimeoffBalanceSink` (Task 4), mirroring Phase 5's `FundContributionSink`. |
| `src/platform/capabilities/resolve.ts` `features.timeoff` | Unchanged (payroll or Trek). |
| `src/modules/home/cards.ts` `leave` card, `src/app/(app)/page.tsx`, `src/modules/payroll/ui/load-company.ts` | Read the workspace summary (Task 6). |

## File structure

```
drizzle/0018_timeoff.sql
src/lib/db/schema/timeoff.ts                    timeoffTypes, timeoffBalances, timeoffEvents
src/lib/db/timeoff-rls.itest.ts
src/modules/timeoff/domain/units.ts (+test)     toDays, toHours, addQuantity, quantityFromFraction
src/modules/timeoff/domain/events.ts (+test)    statusAt, plannedByMonth, upcoming
src/modules/timeoff/domain/variance.ts (+test)  moved leave-variance
src/modules/timeoff/application/ports.ts, deps.ts, errors.ts
src/modules/timeoff/application/{ensure-default-types,list-types,update-type,get-workspace,set-event,remove-event}.ts (+tests)
src/modules/timeoff/infrastructure/drizzle-types-repository.ts, drizzle-balances-repository.ts, drizzle-events-repository.ts, memory-repositories.ts (+test), deps.ts, repositories.itest.ts
src/modules/timeoff/infrastructure/payroll-balance-sink.ts (+test), memory-balance-sink.ts
src/modules/timeoff/infrastructure/trek-diff.ts (+test), trek-sync.ts (+test), trek-store.ts
src/modules/timeoff/api/schemas.ts, routes.ts, routes.itest.ts
src/modules/timeoff/ui/run.ts, deps.ts, load-workspace.ts (+test), TimeoffCalendar.tsx, DayDetailPanel.tsx, BalancesByType.tsx, VarianceTable.tsx, UpcomingList.tsx
src/app/(app)/company/time-off/page.tsx (rewrite), src/app/actions/timeoff.ts (+test)
scripts/migrate-timeoff.ts, scripts/validate-timeoff-migration.ts
docs/deploy/phase-7-runbook.md, docs/superpowers/handoff/2026-09-06-phase-7-checkpoint.md
```

---

### Task 1: Migration 0018 — time-off tables and RLS

**Files:** Create `drizzle/0018_timeoff.sql`, `src/lib/db/schema/timeoff.ts`, `src/lib/db/timeoff-rls.itest.ts`; modify `src/lib/db/schema/index.ts`, `src/platform/auth/permissions.ts` (+test).

- [ ] **Step 1: Schema**

```ts
// src/lib/db/schema/timeoff.ts
import { check, date, index, integer, numeric, pgTable, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { users } from "./identity";
import { payrollRecords } from "./payroll";

const tz = (n: string) => timestamp(n, { withTimezone: true, mode: "date" });
const id = () => uuid("id").primaryKey().default(sql`uuidv7()`);
const qty = (n: string) => numeric(n, { precision: 8, scale: 2 });

export const timeoffTypes = pgTable("timeoff_types", {
  id: id(),
  userId: uuid("user_id").notNull().references(() => users.id),
  code: text("code").notNull(),
  label: text("label").notNull(),
  unit: text("unit").notNull().default("hours"),
  hoursPerDay: numeric("hours_per_day", { precision: 4, scale: 2 }).notNull().default("8.00"),
  createdAt: tz("created_at").notNull().defaultNow(),
  updatedAt: tz("updated_at").notNull().defaultNow(),
}, (t) => [
  check("timeoff_types_code_ck", sql`${t.code} IN ('vacation','comp','permits','sick','other')`),
  check("timeoff_types_unit_ck", sql`${t.unit} IN ('hours','days')`),
  uniqueIndex("timeoff_types_user_code_uq").on(t.userId, t.code),
]);

/** One row per (type, payroll record) — spec §5.8 "one per payroll period". R7-4. */
export const timeoffBalances = pgTable("timeoff_balances", {
  id: id(),
  userId: uuid("user_id").notNull().references(() => users.id),
  typeId: uuid("type_id").notNull().references(() => timeoffTypes.id, { onDelete: "cascade" }),
  asOf: date("as_of").notNull(),
  accrued: qty("accrued"),
  used: qty("used"),
  remaining: qty("remaining"),
  pending: qty("pending"),
  unit: text("unit").notNull().default("hours"),
  source: text("source").notNull().default("payroll"),
  payrollRecordId: uuid("payroll_record_id").references(() => payrollRecords.id, { onDelete: "cascade" }),
  createdAt: tz("created_at").notNull().defaultNow(),
}, (t) => [
  check("timeoff_balances_source_ck", sql`${t.source} IN ('payroll','manual')`),
  check("timeoff_balances_unit_ck", sql`${t.unit} IN ('hours','days')`),
  uniqueIndex("timeoff_balances_type_record_uq").on(t.typeId, t.payrollRecordId).where(sql`payroll_record_id IS NOT NULL`),
  index("timeoff_balances_user_asof_idx").on(t.userId, t.asOf.desc()),
]);

/** Generalises `leave_days` (spec §5.8). Trek's entry id is in provider_links (R7-3). */
export const timeoffEvents = pgTable("timeoff_events", {
  id: id(),
  userId: uuid("user_id").notNull().references(() => users.id),
  typeId: uuid("type_id").notNull().references(() => timeoffTypes.id),
  date: date("date").notNull(),
  fraction: numeric("fraction", { precision: 3, scale: 2 }).notNull().default("1.00"),
  status: text("status").notNull().default("planned"),
  origin: text("origin").notNull().default("manual"),
  note: text("note"),
  pendingOp: text("pending_op").notNull().default("none"),
  syncedAt: tz("synced_at"),
  version: integer("version").notNull().default(1),
  createdAt: tz("created_at").notNull().defaultNow(),
  updatedAt: tz("updated_at").notNull().defaultNow(),
}, (t) => [
  check("timeoff_events_fraction_ck", sql`${t.fraction} IN (0.5, 1)`),
  check("timeoff_events_status_ck", sql`${t.status} IN ('planned','approved','taken','cancelled')`),
  check("timeoff_events_origin_ck", sql`${t.origin} IN ('manual','trek','payroll')`),
  check("timeoff_events_pending_ck", sql`${t.pendingOp} IN ('none','upsert','delete')`),
  uniqueIndex("timeoff_events_user_date_uq").on(t.userId, t.date),
  index("timeoff_events_pending_idx").on(t.userId, t.pendingOp).where(sql`pending_op <> 'none'`),
]);

export type TimeoffTypeRow = typeof timeoffTypes.$inferSelect;
export type TimeoffBalanceRow = typeof timeoffBalances.$inferSelect;
export type TimeoffEventRow = typeof timeoffEvents.$inferSelect;
```

- [ ] **Step 2: Generate** → `0018_timeoff.sql`; append ENABLE/FORCE and the owner policy on `user_id` for all three tables (no `EXISTS` join needed).
- [ ] **Step 3: Permissions** `timeoff.read`, `timeoff.write` (member both, viewer read) + test.
- [ ] **Step 4: `timeoff-rls.itest.ts`:** isolation on each table; `timeoff_events_user_date_uq` rejects a second event on the same day for the same user and accepts the same day for another user; `timeoff_balances_type_record_uq` rejects a second balance for the same (type, record); `timeoff_events_fraction_ck` rejects `0.25`.
- [ ] **Verify / Commit:** `npm run typecheck && npm test && npm run test:db:up && npm run test:integration -- timeoff-rls`; `git add drizzle src/lib/db src/platform/auth && git commit -m "feat(timeoff): migration 0018 — types, balances, events"`

---

### Task 2: Domain — units, event status, variance

**Files:** `src/modules/timeoff/domain/units.ts` (+test), `events.ts` (+test), `variance.ts` (+test — `git mv src/lib/calc/leave-variance.ts` and its test, then adapt the input type).

**Interfaces — Produces:**
```ts
// units.ts (quantities are decimal strings with 2 dp)
export function toDays(hours: string, hoursPerDay: string): string;   // "16.00","8.00" → "2.00"
export function toHours(days: string, hoursPerDay: string): string;
export function addQuantity(a: string | null, b: string | null): string | null; // null + null = null
export function quantityFromFraction(fraction: "1.00" | "0.50", hoursPerDay: string): string; // hours for one event
// events.ts
export interface EventLike { id: string; date: string; fraction: string; typeCode: string; status: string; origin: string; pendingOp: string; note: string | null }
export function statusAt(event: EventLike, today: string): "planned" | "taken" | "cancelled"; // cancelled stays; date < today → taken; else planned
export function plannedByMonth(events: readonly EventLike[], typeCode: string, hoursPerDay: string): Map<string, string>; // "YYYY-MM" → hours; cancelled excluded
export function upcoming(events: readonly EventLike[], today: string, limit?: number): EventLike[];  // date >= today, not cancelled, ascending
// variance.ts — same exports as leave-variance.ts (`leaveVariance`, `flaggedMonths`, `VARIANCE_TOLERANCE_DAYS`, `LeaveMonthVariance`, `LeaveVarianceStatus`); the input becomes
export interface VarianceInput { year: number; hoursPerDay: string; usedByMonth: ReadonlyMap<string, string> /* "YYYY-MM" → hours, from timeoff_balances.used */; plannedByMonth: ReadonlyMap<string, string>; today: string }
```

- [ ] **Step 1: Tests first.** `units.test.ts`: `toDays("16.00","8.00")` → `"2.00"`, `toDays("12.00","8.00")` → `"1.50"`, `addQuantity(null, null)` → `null`, `quantityFromFraction("0.50","8.00")` → `"4.00"`. `events.test.ts`: `statusAt` for yesterday / today / tomorrow / cancelled; `plannedByMonth` sums two half days into `"8.00"` for `"2026-03"` and skips a cancelled one; `upcoming` sorts and limits. `variance.test.ts`: port every existing `leave-variance.test.ts` case to the new input with the same expected statuses.
- [ ] **Step 2:** `npm test -- modules/timeoff/domain` → fails. **Step 3:** implement (two-decimal string arithmetic via `BigInt`; copy the helper from `src/modules/funds/domain/totals.ts`).
- [ ] **Verify / Commit:** `npm test -- modules/timeoff/domain && npm run typecheck`; `git add -A src/modules/timeoff/domain src/lib/calc && git commit -m "feat(timeoff): domain — units, event status, variance"`

---

### Task 3: Ports, repositories, Trek store

**Files:** `src/modules/timeoff/application/ports.ts`, `deps.ts`, `errors.ts`; `infrastructure/memory-repositories.ts` (+test), `drizzle-types-repository.ts`, `drizzle-balances-repository.ts`, `drizzle-events-repository.ts`, `trek-store.ts`, `deps.ts`, `repositories.itest.ts`.

**Interfaces — Produces** (`ports.ts`; ids and dates are strings):
```ts
export type TimeoffCode = "vacation" | "comp" | "permits" | "sick" | "other";
export interface TimeoffType { id; userId; code: TimeoffCode; label: string; unit: "hours" | "days"; hoursPerDay: string; createdAt: Date; updatedAt: Date }
export interface TimeoffBalance { id; userId; typeId; asOf: string; accrued: string | null; used: string | null; remaining: string | null; pending: string | null; unit: "hours" | "days"; source: "payroll" | "manual"; payrollRecordId: string | null; createdAt: Date }
export interface TimeoffEvent extends EventLike { userId; typeId; syncedAt: Date | null; trekEntryId: number | null /* joined from provider_links */; version: number; createdAt: Date; updatedAt: Date }

export interface TypesRepository { list(userId): Promise<TimeoffType[]> /* order: vacation, permits, comp, sick, other */; getByCode(userId, code: TimeoffCode): Promise<TimeoffType | null>; create(input: Omit<TimeoffType, "id" | "createdAt" | "updatedAt">): Promise<TimeoffType>; update(userId, id, patch: Partial<Pick<TimeoffType, "label" | "unit" | "hoursPerDay">>): Promise<TimeoffType | null> }
export interface BalancesRepository { latestPerType(userId): Promise<Map<string /* typeId */, TimeoffBalance>>; listForYear(userId, year: number): Promise<TimeoffBalance[]> /* asOf asc */; upsertForRecord(input: Omit<TimeoffBalance, "id" | "createdAt">): Promise<TimeoffBalance> /* on (typeId, payrollRecordId) */; deleteByPayrollRecord(userId, payrollRecordId): Promise<number> }
export interface EventsRepository {
  inRange(userId, from: string, to: string): Promise<TimeoffEvent[]>;   // date asc, trekEntryId joined
  at(userId, date: string): Promise<TimeoffEvent | null>;
  pending(userId): Promise<TimeoffEvent[]>;                              // pendingOp <> 'none'
  upsertFromProvider(userId, rows: readonly { date: string; fraction: string; typeId: string; trekEntryId: number; note: string | null }[], now: Date): Promise<number>; // origin 'trek', pendingOp 'none', syncedAt = now, provider_links upserted
  deleteDates(userId, dates: readonly string[]): Promise<number>;         // hard delete + links
  stageUpsert(userId, input: { date: string; fraction: string; typeId: string; note: string | null }, now: Date): Promise<TimeoffEvent>; // origin 'manual' (keeps 'trek' if the row came from Trek), pendingOp 'upsert'
  stageDelete(userId, date: string, now: Date): Promise<TimeoffEvent | null>;  // pendingOp 'delete' (row kept — see the leave_days comment in legacy.ts)
  clearPending(userId, dates: readonly string[], now: Date, trekIds?: ReadonlyMap<string, number>): Promise<number>; // rows staged 'delete' are deleted; the rest become 'none' with syncedAt = now and links for new ids
}
/** Opens one short RLS context per call. Trek network calls happen outside it. */
export interface TimeoffStore { withEvents<T>(userId: string, fn: (events: EventsRepository, types: TypesRepository) => Promise<T>): Promise<T> }
export interface Clock { now(): Date }
export interface UseCaseDeps { types: TypesRepository; balances: BalancesRepository; events: EventsRepository; settings: { hoursPerDay(): Promise<string> }; clock: Clock; audit: (e: AuditInput) => Promise<void> }
```

- [ ] **Step 1: Memory repositories + test**, with the `provider_links` behaviour modelled as a `Map<eventId, trekEntryId>` inside `MemoryEventsRepository`.
- [ ] **Step 2: Drizzle repositories.** `inRange` left-joins `provider_links` on `(user_id, provider = 'trek', entity_type = 'timeoff_event', entity_id = timeoff_events.id)`. `upsertFromProvider` upserts events on `timeoff_events_user_date_uq` and links on `provider_links_entity_uq`. `clearPending` deletes rows whose `pendingOp = 'delete'` (and their links), sets the rest to `none`.
- [ ] **Step 3: `trek-store.ts`** — `drizzleTimeoffStore(db: DbClient): TimeoffStore` = `withUserContext(db, { userId }, tx => fn(new DrizzleEventsRepository(tx), new DrizzleTypesRepository(tx)))`. **`deps.ts`** — `timeoffDeps(tx, requestId?)`; `settings.hoursPerDay` reads `SETTING_KEYS.hoursPerDay` via `getSetting` from `src/lib/repo/settings.ts` (`app_settings` has no RLS, so the pool-bound read is fine) and returns it as a two-decimal string.
- [ ] **Step 4: `repositories.itest.ts`** with `describe.each` over memory/Drizzle for types, balances and events (ordering, `at`, `pending`, `upsertFromProvider` twice is idempotent, `stageDelete` keeps the row, `clearPending` removes it, links survive an upsert, `latestPerType` picks the latest `asOf`).
- [ ] **Verify / Commit:** `npm run typecheck && npm test -- modules/timeoff && npm run test:integration -- modules/timeoff`; `git add src/modules/timeoff && git commit -m "feat(timeoff): ports, repositories, Trek store"`

---

### Task 4: Use cases and the payroll balance sink

**Files:** `src/modules/timeoff/application/{ensure-default-types,list-types,update-type,get-workspace,set-event,remove-event}.ts` (+tests); `src/modules/timeoff/infrastructure/payroll-balance-sink.ts` (+test), `memory-balance-sink.ts`; modify `src/modules/payroll/application/ports.ts`, `apply-import.ts` (+test), `src/modules/payroll/infrastructure/deps.ts`, `src/modules/payroll/infrastructure/ingest.itest.ts`.

**Interfaces — Produces:**
```ts
ensureDefaultTypes(deps)(principal): Promise<TimeoffType[]>          // R7-1; timeoff.read
listTypes(deps)(principal): Promise<TimeoffType[]>
updateType(deps)(principal, id: string, patch: Partial<Pick<TimeoffType, "label" | "unit" | "hoursPerDay">>): Promise<TimeoffType>   // timeoff.write
export interface BalanceView { type: TimeoffType; asOf: string | null; remainingHours: string | null; remainingDays: string | null; usedYtdHours: string | null; source: "payroll" | null }
export interface DayDetail { date: string; event: TimeoffEvent | null; status: "planned" | "taken" | "cancelled" | null }
export interface TimeoffWorkspace { year: number; today: string; types: TimeoffType[]; balances: BalanceView[]; months: { month: string; days: MonthGridDay[] }[]; byDate: Record<string, { fraction: string; typeCode: TimeoffCode; note: string | null; status: string; pendingOp: string }>; selected: DayDetail | null; upcoming: TimeoffEvent[]; variance: LeaveMonthVariance[]; flagged: LeaveMonthVariance[]; plannedDaysYtd: string; pendingCount: number; trekConnected: boolean; cachedStats: CachedTrekStats | null }
getWorkspace(deps)(principal, input: { year: number; selectedDate?: string | null; trekConnected: boolean; cachedStats: CachedTrekStats | null }): Promise<TimeoffWorkspace>   // timeoff.read
setEvent(deps)(principal, input: { date: string; fraction: "1.00" | "0.50"; typeCode: TimeoffCode; note?: string | null }): Promise<TimeoffEvent>   // timeoff.write; weekend → InvalidInputError (isWeekendBlocked from src/lib/calc/leave-day.ts); stages 'upsert'
removeEvent(deps)(principal, date: string): Promise<void>            // timeoff.write; a never-synced manual row (trekEntryId null) is hard-deleted; otherwise staged 'delete'
// payroll ports.ts
export interface TimeoffBalanceWrite { timeoffCode: string; kind: "balance" | "used"; quantity: string | null; unit: "hours" | "days" }
export interface TimeoffBalanceSink { writeForRecord(input: { userId: string; payrollRecordId: string; supersededRecordId: string | null; asOf: string; rows: readonly TimeoffBalanceWrite[] }): Promise<{ written: number; skipped: string[] }> }
```
`UseCaseDeps.timeoff: TimeoffBalanceSink` in payroll. `ApplyImportResult` gains `timeoffBalances: { written: number; skipped: string[] }`.

- [ ] **Step 1: Tests.** `ensureDefaultTypes` creates three types once and is idempotent; `getWorkspace` returns `balances[i].remainingHours = null` and `source = null` with no balance rows, and converts hours to days with the type's `hoursPerDay`; `selected` is null for a date without an event and populated otherwise; `setEvent` on a Saturday → `InvalidInputError`; `setEvent` on an existing Trek day updates it and stages `upsert`; `removeEvent` on a manual never-synced row hard-deletes, on a Trek row stages `delete`; audit actions `timeoff.type_updated`, `timeoff.event_set`, `timeoff.event_removed`. Sink test: a record with `timeoff_balance vacation 120.00 hours` and `timeoff_used vacation 16.00` writes one balance row `{ remaining: "120.00", used: "16.00", asOf }`; `supersededRecordId` deletes the old rows first; an unknown code lands in `skipped`; the sink calls `ensureDefaultTypes` logic (types repository) so a fresh user gets rows.
- [ ] **Step 2: Implement.** `getWorkspace` builds `months` in the `MonthGridDay` shape `src/app/(app)/company/_lib/leave.ts` builds today (copy `monthsOf` and the day mapping before that file is deleted in Task 6); `variance` from `balances.listForYear` (`used` keyed by the `as_of` month) versus `plannedByMonth(events, "vacation", hoursPerDay)`.
- [ ] **Step 3: Payroll wiring.** In `apply-import.ts` collect components whose `mappedTo.kind` is `timeoff_balance` / `timeoff_used` into `TimeoffBalanceWrite[]` (`quantity = component.quantity ?? component.amount`, `unit = component.unit === "days" ? "days" : "hours"`) and call `deps.timeoff.writeForRecord({ asOf: period.periodEnd, … })` after the fund sink. Wire `timeoff: payrollBalanceSink(tx)` in payroll `deps.ts`; the memory sink in tests.
- [ ] **Verify / Commit:** `npm run typecheck && npm test && npm run test:integration -- payroll`; `git add -A src && git commit -m "feat(timeoff): use cases; payroll apply writes timeoff_balances (R4-10 closed)"`

---

### Task 5: Trek sync on the new store

**Files:** `git mv src/lib/jobs/trek-diff.ts src/modules/timeoff/infrastructure/trek-diff.ts` (+test), `git mv src/lib/jobs/trek-sync.ts src/modules/timeoff/infrastructure/trek-sync.ts` (+test); modify `src/lib/jobs/trek-sync-job.ts`, `src/modules/integrations/infrastructure/trek-provider-adapter.ts`, `src/app/api/jobs/trek-sync/route.ts`; delete `src/lib/repo/leave.ts`.

- [ ] **Step 1: `trek-diff.ts`.** Replace `LeaveDayRow` with `TimeoffEvent`; `planPush`/`planPull` read `event.trekEntryId`, `event.pendingOp`, `event.fraction` (string → Trek's numeric `LeaveFraction` at the boundary), and map `typeCode` ↔ Trek `kind` per R7-2 (`permits` events are excluded from the push plan). Port the existing tests.
- [ ] **Step 2: `trek-sync.ts`.** `RunTrekSyncInput` gains `userId: string` and `store: TimeoffStore`. Shape: `const { pending, typeIds } = await store.withEvents(userId, async (e, t) => ({ pending: await e.pending(userId), typeIds: … }))` → push (network) → `store.withEvents(… clearPending …)` → pull (network) → `store.withEvents(… upsertFromProvider / deleteDates …)`. `withJobLock` stays where it is until Phase 9 Task 1.
- [ ] **Step 3: Callers.** `trek-provider-adapter.ts` `fetch` passes `userId: ctx.connection.userId` and `store: drizzleTimeoffStore(db)` (`db` from `@/lib/db` — the adapter is infrastructure). `trek-sync-job.ts` and `src/app/api/jobs/trek-sync/route.ts` change imports only.
- [ ] **Step 4: Delete `src/lib/repo/leave.ts`**; `grep -rn "repo/leave\|lib/jobs/trek-diff\|lib/jobs/trek-sync\"" src` → nothing.
- [ ] **Verify / Commit:** `npm run typecheck && npm test`; `git add -A src && git commit -m "feat(timeoff): Trek sync over timeoff_events and provider_links (R7-3)"`

---

### Task 6: API, workspace UI, legacy removal

**Files:** Create `src/modules/timeoff/api/schemas.ts`, `routes.ts`, `routes.itest.ts`; `src/modules/timeoff/ui/run.ts`, `deps.ts`, `load-workspace.ts` (+test), `TimeoffCalendar.tsx`, `DayDetailPanel.tsx`, `BalancesByType.tsx`, `VarianceTable.tsx`, `UpcomingList.tsx`; `src/app/(app)/company/time-off/page.tsx` (rewrite); `src/app/actions/timeoff.ts` (+test). Modify `src/platform/http/app.ts`, `docs/api/openapi.json`, `docs/api/README.md`, `src/lib/repo/settings.ts` (`hoursPerDay()`, `DEFAULT_HOURS_PER_DAY`), `src/app/(app)/settings/personal/page.tsx` (import path), `src/app/(app)/page.tsx` (leave card from `loadTimeoffSummary`), `src/modules/payroll/ui/load-company.ts` (Company Overview balances from `loadTimeoffSummary`), `src/lib/calc/payroll.ts` (remove the leave functions and their tests). Delete `src/app/(app)/company/_lib/leave.ts` (+test), `company/_components/LeaveCalendar.tsx`, `LeaveByMonth.tsx`, `src/app/(app)/_lib/vacation.ts`, `src/app/actions/leave.ts` (+test), `src/lib/repo/payslips.ts`.

**Routes** (tag `Time off`): `GET /timeoff/types`, `PATCH /timeoff/types/{id}` (`label`, `unit`, `hoursPerDay`), `GET /timeoff/workspace?year=&date=`, `GET /timeoff/events?from=&to=`, `PUT /timeoff/events/{date}` (`setEvent`), `DELETE /timeoff/events/{date}` (204), `GET /timeoff/balances?year=`.

- [ ] **Step 1: API** + `routes.itest.ts` (types seeded on first call; PUT a weekday → 200; PUT a Saturday → 422; DELETE → 204; viewer PUT → 403) + `npm run openapi:generate` + README section.
- [ ] **Step 2: Page.** `/company/time-off?year=2026&day=2026-03-16`. The server component reads `year`/`day` from `searchParams`, `trekConnected` via `isProviderConnectedForPrincipal("trek")` (`@/modules/integrations/ui/principal-connection`), `cachedStats` via `getCachedTrekStats()`, then `loadWorkspace({ year, selectedDate, trekConnected, cachedStats })`. Layout in `PageGrid`: left `Panel span={8}` with `BalancesByType` (one `StatTile` per type — remaining in days, hours in the caption; "No payslip applied yet" when null) and `TimeoffCalendar` (twelve `MonthGrid`s; clicking a day calls `router.replace` with `?day=` and no navigation); right `Panel span={4}` with `DayDetailPanel` (type select, full/half, note; Save / Remove; a "Pending sync" badge when `pendingOp !== "none"`; "Sync now" when Trek is connected) and `UpcomingList`; below, `VarianceTable` (planned vs used per month, flagged rows first). Stacked on mobile. Setup state: neither payroll nor Trek → `EmptyState` linking to `/settings/integrations` (spec §4).
- [ ] **Step 3: Actions** `setTimeoffEventAction`, `removeTimeoffEventAction`, `syncTimeoffNowAction` (the `syncLeaveNow` logic from `actions/leave.ts`, over `runTrekSync` with the principal's `userId` and `drizzleTimeoffStore(db)`), `updateTimeoffTypeAction`. Port `actions/leave.test.ts`.
- [ ] **Step 4: Consumers.** `loadTimeoffSummary()` in `load-workspace.ts` → `{ remainingDays: string | null; upcoming: TimeoffEvent[]; pendingCount: number }` for the Home `leave` card and `load-company.ts`. `settings/personal/page.tsx` imports `hoursPerDay`/`DEFAULT_HOURS_PER_DAY` from `@/lib/repo/settings`.
- [ ] **Step 5: Delete** the legacy files; `grep -rn "repo/payslips\|_lib/vacation\|_lib/leave\|LeaveCalendar\|LeaveByMonth\|actions/leave\|ferieRemaining\|leaveTakenByMonth" src` → nothing.
- [ ] **Verify / Commit:** `npm run typecheck && npm test && npm run test:integration -- timeoff && npm run build`; `git add -A src docs/api && git commit -m "feat(timeoff): API and the unified Time Off workspace; retire the legacy leave pages"`

---

### Task 7: Migration script, validator, exit criteria

**Files:** `scripts/migrate-timeoff.ts`, `scripts/validate-timeoff-migration.ts`, `package.json` scripts `migrate:timeoff`, `migrate:timeoff:validate`; `docs/deploy/phase-7-runbook.md`, `docs/superpowers/handoff/2026-09-06-phase-7-checkpoint.md`, `docs/architecture/overview.md`, `.superpowers/sdd/MASTER-LEDGER.md`.

- [ ] **Step 1: `migrate-timeoff.ts`** (idempotent; legacy reads under `withSystemContext`, writes under `withUserContext(owner)` so RLS `WITH CHECK` is exercised):
  1. Owner resolution as in `scripts/migrate-funds.ts`; seed the owner's default types with the same logic as `ensureDefaultTypes`.
  2. `leave_days` → `timeoff_events` (`typeId` by kind: `vacation` → vacation, `comp` → comp; `fraction` `"1.00"`/`"0.50"`; `origin` `trek` → `trek`, `dashboard` → `manual`; `pendingOp`, `syncedAt`, `note` copied) upserting on `(user_id, date)`; `trek_entry_id` → `provider_links` upsert.
  3. Balances backfill: for every live `payroll_records` row, read its `payroll_components` with `mapped_to->>'kind' IN ('timeoff_balance','timeoff_used')` and call the same `payrollBalanceSink(tx).writeForRecord` the apply step uses.
  4. Print counts.
- [ ] **Step 2: Validator:** every `leave_days.date` has a `timeoff_events` row with the same fraction and mapped type and, when `trek_entry_id` is set, a matching `provider_links` row; every live payroll record with a `timeoff_balance` component has a balance row; the latest `vacation` balance `remaining` equals the latest verified legacy `payslips.ferie_balance` (unit-converted with the type's `hours_per_day` when the legacy unit is days) when that row exists — string comparison in hundredths; rows examined > 0; exit 1 on mismatch.
- [ ] **Step 3: Exit gate.** `npm run typecheck && npm test && npm run test:db:up && npm run test:integration && npm run build && npm run openapi:generate && git diff --exit-code docs/api/openapi.json`; `grep -rn "leave_days\|leaveDays" src` → only `schema/legacy.ts` and `scripts/`.
- [ ] **Step 4: Runbook** (dump, deploy, `npm run db:migrate`, `npm run migrate:timeoff`, validate, verify `/company/time-off` shows the same booked days and the latest payslip balances; rollback = restore the dump). **Manual walkthrough:** open `/company/time-off`, click a day, save a half day, see "Pending sync", press Sync now (Trek connected) and see it clear; apply a payslip and see the balance tile move; confirm `/company` shows earnings and the time-off balance side by side. **Exit line (spec §11 Phase 7): earnings and time off are clear in a unified experience.**
- [ ] **Step 5:** `graphify update .`; checkpoint (rulings R7-1…R7-5; what remains: approval workflow, sick/other seeding, Company Overview redesign); architecture doc; master ledger.
- [ ] **Commit:** `git add -A scripts package.json ../docs ../graphify-out ../.superpowers && git commit -m "feat(timeoff): leave_days migration; docs(handoff): Phase 7 checkpoint and runbook"`

---

## Self-review against the spec

- §5.8 `timeoff_types` ✔, `timeoff_balances` ✔ (one per payroll period, R7-4), `timeoff_events` ✔ (generalises `leave_days`; `provider_links` holds the Trek id, R7-3). Index `timeoff_events (user_id, date)` ✔ (the unique index covers it).
- §7.8 Time Off: one workspace ✔; calendar + balances + list/details ✔; day selection via URL search param without navigation ✔; two-pane desktop / stacked mobile ✔ (Task 6).
- §6 feature matrix: calendar works without Trek ✔ (manual events, never pushed); Trek sync on the framework ✔ (Task 5, same `SyncHandler`).
- §11 exit ✔ (Task 7). Payroll-derived balances ✔ (Task 4).
- Type consistency: `EventLike` (domain) is the base of `TimeoffEvent` (port); `fraction` is the two-decimal string `"1.00" | "0.50"` everywhere in this module and becomes Trek's numeric `LeaveFraction` only inside `trek-diff.ts`; `TimeoffBalanceWrite` in payroll ports matches the sink; `TimeoffStore.withEvents` is the only place the Trek sync touches the database.
