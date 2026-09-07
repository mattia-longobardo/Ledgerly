# Phase 7 (reduced): Time Off

> **For agentic workers:** read `2026-09-07-phases-7-9-reduced-conventions.md` first, then the shared conventions. Tasks marked ⚡ run in one session. Steps use `- [ ]` syntax.

**Goal:** Replace `leave_days` and the `ferie_*`/`rol_*` payslip columns with a `timeoff` module (types, payroll-derived balances, events), re-point the Trek sync at it, drop **every** legacy table in the same migration, and give the owner one bare page to book days and see balances. No data is migrated.

**Architecture:** as in the original Phase 7 plan (`2026-09-06-phase-7-timeoff.md`): module `src/modules/timeoff/`, Trek algorithm kept and given a user-scoped `TimeoffStore`, balances written by the payroll apply step through a `TimeoffBalanceSink`. Consult the original plan for the schema, port and function signatures — they are unchanged; this plan only says what is built and what is not.

**Rulings kept:** R7-1 (types seeded lazily per user), R7-2 (Trek code ↔ type code, `permits` never pushed), R7-3 (Trek entry id in `provider_links`), R7-4 (balances from payroll only; no rows → "—", never zeros).
**Ruling dropped:** R7-5 (migrate then freeze `leave_days`) → replaced by **R7-5' drop everything now**.

- **R7-5' Legacy drop in `0018`.** The migration creates `timeoff_types`, `timeoff_balances`, `timeoff_events` and drops, in this order: `fund_deposits`, `fund_settings`, `legacy_funds`, `payslips`, `vacation_ledger`, `vacation_accrual_rate`, `leave_days`, `balance_snapshots`. `job_runs` and `app_settings` move from `schema/legacy.ts` to `schema/platform.ts` unchanged. All code that only served those tables is deleted in the same task (list in Task 1). This absorbs original Phase 9 Task 6 and R9-7.

## Deferred (append to `docs/superpowers/DEFERRED.md`)

- Time Off workspace UI per spec §7.8 (two-pane, URL-driven day detail, variance table, upcoming list, Home card body) — original Phase 7 Task 6. Built bare here; redesign later.
- `domain/variance.ts` (planned vs used per month) — original Task 2; keep `src/lib/calc/leave-variance.ts` deleted with its consumers, rebuild on the new balances when the UI needs it.
- `updateType` use case and `PATCH /timeoff/types/{id}` — types are seeded with `hours_per_day` from settings; editing them can wait.
- `scripts/migrate-timeoff.ts` + validator — original Task 7. Never.

## File structure

```
drizzle/0018_timeoff_and_drop_legacy.sql
src/lib/db/schema/timeoff.ts, schema/platform.ts (+jobRuns, appSettings), schema/legacy.ts (deleted)
src/lib/db/rls-matrix.itest.ts (new, parametric)
src/modules/timeoff/domain/units.ts (+test), events.ts (+test)
src/modules/timeoff/application/ports.ts, deps.ts, errors.ts, {ensure-default-types,get-workspace,set-event,remove-event}.ts, use-cases.itest.ts
src/modules/timeoff/infrastructure/drizzle-types-repository.ts, drizzle-balances-repository.ts, drizzle-events-repository.ts, trek-store.ts, deps.ts, payroll-balance-sink.ts, trek-diff.ts (+test, moved), trek-sync.ts (+test, moved)
src/modules/timeoff/api/schemas.ts, routes.ts, routes.itest.ts
src/modules/timeoff/ui/run.ts, deps.ts, load-workspace.ts
src/app/(app)/company/time-off/page.tsx (rewrite, bare), src/app/actions/timeoff.ts
docs/superpowers/DEFERRED.md (new)
```

---

### Task 1 ⚡: Migration 0018 — timeoff tables, drop legacy, delete legacy code

**Files:** Create `drizzle/0018_timeoff_and_drop_legacy.sql`, `src/lib/db/schema/timeoff.ts`, `src/lib/db/rls-matrix.itest.ts`, `docs/superpowers/DEFERRED.md`. Modify `schema/index.ts`, `schema/platform.ts`, `src/platform/auth/permissions.ts` (+test), `src/lib/contracts.ts` (`JobName` loses `wallet_refresh`), `src/platform/jobs/register-all.ts`, `src/app/(app)/settings/admin/page.tsx` (`JOBS`/`JOB_LABEL`), `src/lib/db/migrate.ts` (remove the legacy funds seed), `package.json` (remove `migrate:*`/`validate:*` scripts), `cron/crontab` if it names `wallet_refresh`, `dashboard-app/Dockerfile` (remove the esbuild steps for migration scripts). Delete `schema/legacy.ts`, `src/lib/repo/balances.ts`, `src/lib/repo/leave.ts`, `src/lib/repo/payslips.ts`, `src/lib/repo/vacation.ts` (if still present), `src/lib/jobs/wallet-refresh.ts` (+test), `scripts/migrate-*.ts`, `scripts/validate-*.ts`, `scripts/import-file-credentials.ts` if its env vars are gone, `src/app/(app)/_lib/vacation.ts`, `src/app/(app)/company/_lib/leave.ts` (+test), `company/_components/LeaveCalendar.tsx`, `LeaveByMonth.tsx`, `src/app/actions/leave.ts` (+test), `src/lib/calc/leave-variance.ts` (+test), the leave functions in `src/lib/calc/payroll.ts` (`ferieRemaining`, `leaveTakenByMonth`, `leaveTakenYtd`, `LeaveTakenMonth` and their tests — salary functions stay).

- [ ] **Step 1: Schema.** Copy `timeoffTypes`, `timeoffBalances`, `timeoffEvents` verbatim from the original Phase 7 Task 1 into `schema/timeoff.ts`. Move `jobRuns` and `appSettings` into `schema/platform.ts`; delete `schema/legacy.ts`.
- [ ] **Step 2: Generate** with `npm run db:generate`, answer "drop" for each legacy table, rename to `0018_timeoff_and_drop_legacy.sql`. Check the file: three `CREATE TABLE`, eight `DROP TABLE` in the R7-5' order (reorder by hand if drizzle-kit emitted them differently), then append ENABLE/FORCE + the owner policy on `user_id` for the three new tables.
- [ ] **Step 3: Permissions** `timeoff.read`, `timeoff.write` (member both, viewer read) + test.
- [ ] **Step 4: Delete the code** listed above. `hoursPerDay()` and `DEFAULT_HOURS_PER_DAY` from `_lib/vacation.ts` move to `src/lib/repo/settings.ts`; `settings/personal/page.tsx` imports them from there. Anything that still imports a deleted file and is not part of Tasks 2–4 gets a `// TODO(timeoff)` stub that compiles — but first check whether it is a page the redesign will replace anyway (`/company/time-off`, Home `leave` card body, `load-company.ts` balances): those are rewritten in Task 4, so leave them broken until then and run `typecheck` only at the end of Task 4. **Exception:** `trek-sync.ts`/`trek-diff.ts` are moved in Task 3, not stubbed.
- [ ] **Step 5: `rls-matrix.itest.ts`.** A `describe.each` over `[{ table, insert(userId) }]` covering every user-owned table that exists today (read `schema/index.ts`; children reached through `EXISTS` policies are covered by inserting through their parent) plus the three new ones: A inserts, B reads zero, B's insert with A's `user_id` throws. Add three constraint checks: `timeoff_events_user_date_uq` (second event same user+day rejected), `timeoff_balances_type_record_uq`, `timeoff_events_fraction_ck` rejects `0.25`. Delete the per-domain `src/lib/db/*-rls.itest.ts` files this one now covers.
- [ ] **Step 6: `DEFERRED.md`** with the four items above plus a header line explaining the file.
- [ ] **Verify:** `npm test` (unit only; typecheck comes at the end of Task 4). **Commit:** `git add -A && git commit -m "feat(timeoff): migration 0018 — timeoff tables; drop all legacy tables and the code that served them (R7-5')"`

---

### Task 2 ⚡: Domain, ports, Drizzle repositories, payroll sink

**Files:** `src/modules/timeoff/domain/units.ts` (+test), `events.ts` (+test); `application/ports.ts`, `deps.ts`, `errors.ts`; `infrastructure/drizzle-types-repository.ts`, `drizzle-balances-repository.ts`, `drizzle-events-repository.ts`, `trek-store.ts`, `deps.ts`, `payroll-balance-sink.ts`; modify `src/modules/payroll/application/ports.ts`, `apply-import.ts` (+test), `src/modules/payroll/infrastructure/deps.ts`.

- [ ] **Step 1:** `units.ts` and `events.ts` exactly as the original Task 2 (`toDays`, `toHours`, `addQuantity`, `quantityFromFraction`; `statusAt`, `plannedByMonth`, `upcoming`) with the same unit tests. Skip `variance.ts`.
- [ ] **Step 2:** `ports.ts` as the original Task 3 (`TimeoffType`, `TimeoffBalance`, `TimeoffEvent`, `TypesRepository`, `BalancesRepository`, `EventsRepository`, `TimeoffStore`, `UseCaseDeps`) minus `TypesRepository.update`. Drizzle repositories as the original Task 3 Step 2; `trek-store.ts` and `deps.ts` as Step 3. **No memory repositories.**
- [ ] **Step 3: Payroll sink** as the original Task 4 Step 3: `TimeoffBalanceWrite`, `TimeoffBalanceSink` in payroll `ports.ts`; `payroll-balance-sink.ts` writes one `timeoff_balances` row per (type, record) with `remaining` from `timeoff_balance` and `used` from `timeoff_used`, `asOf = periodEnd`, deletes the superseded record's rows first, seeds the default types when missing; `apply-import.ts` calls it after the fund sink; `ApplyImportResult.timeoffBalances`. The existing `apply-import.test.ts` gets a stub sink that records calls.
- [ ] **Verify:** `npm test -- modules/timeoff modules/payroll`. **Commit:** `git add -A src && git commit -m "feat(timeoff): domain, ports, Drizzle repositories; payroll apply writes timeoff_balances"`

---

### Task 3 ⚡: Use cases and Trek sync

**Files:** `application/{ensure-default-types,get-workspace,set-event,remove-event}.ts`, `application/use-cases.itest.ts`; `git mv src/lib/jobs/trek-diff.ts src/modules/timeoff/infrastructure/trek-diff.ts` (+test), `git mv src/lib/jobs/trek-sync.ts …/trek-sync.ts` (+test); modify `src/lib/jobs/trek-sync-job.ts`, `src/modules/integrations/infrastructure/trek-provider-adapter.ts`, `src/app/api/jobs/trek-sync/route.ts`.

- [ ] **Step 1: Use cases** with the signatures of the original Task 4, except `TimeoffWorkspace` loses `variance`, `flagged`, `months` (the bare page builds its own grid from `byDate`) and keeps `year`, `today`, `types`, `balances`, `byDate`, `selected`, `upcoming`, `plannedDaysYtd`, `pendingCount`, `trekConnected`, `cachedStats`. `setEvent` rejects weekends (`isWeekendBlocked`), `removeEvent` hard-deletes never-synced manual rows and stages `delete` otherwise.
- [ ] **Step 2: `use-cases.itest.ts`** (real DB, `testPrincipal`): default types seeded once and idempotent; workspace balances are `null` with no rows and convert hours→days with the type's `hoursPerDay` after the sink wrote one; `setEvent` Saturday → `InvalidInputError`; `setEvent` on a Trek day stages `upsert`; `removeEvent` manual → gone, Trek → `pendingOp = 'delete'`; audit rows `timeoff.event_set`, `timeoff.event_removed`.
- [ ] **Step 3: Trek** exactly as the original Task 5 (`LeaveDayRow` → `TimeoffEvent`, `RunTrekSyncInput` gains `userId` + `store`, adapter passes `drizzleTimeoffStore(db)`, network calls outside `withEvents`). Port the existing diff/sync tests. `grep -rn "repo/leave\|lib/jobs/trek-diff\|lib/jobs/trek-sync\"" src` → nothing.
- [ ] **Verify:** `npm test -- modules/timeoff && npm run test:integration -- timeoff`. **Commit:** `git add -A src && git commit -m "feat(timeoff): use cases; Trek sync over timeoff_events and provider_links (R7-3)"`

---

### Task 4: API, bare page, consumers, phase gate

**Files:** `api/schemas.ts`, `routes.ts`, `routes.itest.ts`; `ui/run.ts`, `deps.ts`, `load-workspace.ts`; `src/app/(app)/company/time-off/page.tsx` (rewrite), `src/app/actions/timeoff.ts`; modify `src/platform/http/app.ts`, `src/app/(app)/page.tsx` (leave card), `src/modules/payroll/ui/load-company.ts`, `docs/api/README.md`.

**Routes** (tag `Time off`): `GET /timeoff/types`, `GET /timeoff/workspace?year=&date=`, `GET /timeoff/events?from=&to=`, `PUT /timeoff/events/{date}`, `DELETE /timeoff/events/{date}` (204), `GET /timeoff/balances?year=`. No `PATCH /timeoff/types/{id}`.

- [ ] **Step 1: API** + `routes.itest.ts` (types seeded on first call; PUT weekday 200; PUT Saturday 422; DELETE 204; viewer PUT 403) + `npm run openapi:generate` + a short README section.
- [ ] **Step 2: Bare page** `/company/time-off?year=&day=`: a server component that calls `loadWorkspace`, renders (a) one line per type: `label — remaining: X days (Y h) as of DATE` or `—`; (b) twelve `<table>`s (or the existing `MonthGrid` if it imports without changes), each day a link to `?day=`; days in `byDate` marked with the type code and `½` for half days, `*` when `pendingOp !== "none"`; (c) when `day` is set, a native `<form>` with type `<select>`, fraction radio, note, Save / Remove buttons bound to the actions; (d) a "Sync now" button when `trekConnected`; (e) the upcoming list as `<ul>`. No client component beyond what a `<form action>` needs.
- [ ] **Step 3: Actions** `setTimeoffEventAction`, `removeTimeoffEventAction`, `syncTimeoffNowAction` (the old `syncLeaveNow` over `runTrekSync` with the principal's `userId`), `revalidatePath("/company/time-off")`.
- [ ] **Step 4: Consumers.** `loadTimeoffSummary()` → `{ remainingDays, upcoming, pendingCount }` for the Home `leave` card and `load-company.ts`. Remove every `// TODO(timeoff)` stub from Task 1.
- [ ] **Step 5: Phase gate.** `npm run typecheck && npm test && npm run test:db:up && npm run test:integration && npm run build && npm run openapi:generate && git diff --exit-code docs/api/openapi.json`; `grep -rn "leave_days\|leaveDays\|payslips\b\|balance_snapshots\|vacation_ledger\|legacy\.ts" src scripts` → nothing; `ls scripts/migrate-* scripts/validate-*` → nothing.
- [ ] **Commit:** `git add -A && git commit -m "feat(timeoff): API, bare Time Off page, consumers; Phase 7 gate green"`
