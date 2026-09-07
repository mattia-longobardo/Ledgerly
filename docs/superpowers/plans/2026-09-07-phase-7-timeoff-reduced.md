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

- [x] **Step 1: Schema.** Copy `timeoffTypes`, `timeoffBalances`, `timeoffEvents` verbatim from the original Phase 7 Task 1 into `schema/timeoff.ts`. Move `jobRuns` and `appSettings` into `schema/platform.ts`; delete `schema/legacy.ts`.
- [x] **Step 2: Generate** with `npm run db:generate`, answer "drop" for each legacy table, rename to `0018_timeoff_and_drop_legacy.sql`. Check the file: three `CREATE TABLE`, eight `DROP TABLE` in the R7-5' order (reorder by hand if drizzle-kit emitted them differently), then append ENABLE/FORCE + the owner policy on `user_id` for the three new tables.
- [x] **Step 3: Permissions** `timeoff.read`, `timeoff.write` (member both, viewer read) + test.
- [x] **Step 4: Delete the code** listed above. `hoursPerDay()` and `DEFAULT_HOURS_PER_DAY` from `_lib/vacation.ts` move to `src/lib/repo/settings.ts`; `settings/personal/page.tsx` imports them from there. Anything that still imports a deleted file and is not part of Tasks 2–4 gets a `// TODO(timeoff)` stub that compiles — but first check whether it is a page the redesign will replace anyway (`/company/time-off`, Home `leave` card body, `load-company.ts` balances): those are rewritten in Task 4, so leave them broken until then and run `typecheck` only at the end of Task 4. **Exception:** `trek-sync.ts`/`trek-diff.ts` are moved in Task 3, not stubbed.
- [x] **Step 5: `rls-matrix.itest.ts`.** A `describe.each` over `[{ table, insert(userId) }]` covering every user-owned table that exists today (read `schema/index.ts`; children reached through `EXISTS` policies are covered by inserting through their parent) plus the three new ones: A inserts, B reads zero, B's insert with A's `user_id` throws. Add three constraint checks: `timeoff_events_user_date_uq` (second event same user+day rejected), `timeoff_balances_type_record_uq`, `timeoff_events_fraction_ck` rejects `0.25`. Delete the per-domain `src/lib/db/*-rls.itest.ts` files this one now covers.
- [x] **Step 6: `DEFERRED.md`** with the four items above plus a header line explaining the file.
- [x] **Verify:** `npm test` (unit only; typecheck comes at the end of Task 4). **Commit:** `git add -A && git commit -m "feat(timeoff): migration 0018 — timeoff tables; drop all legacy tables and the code that served them (R7-5')"`

### Deviation (Task 1, executed 2026-09-07)

Four points where the tree differed from the plan text, or where a deletion had a consequence the list did not name:

1. **`npm test` fails in two files the controller's PF-1 list did not name.** `src/app/actions/integrations.test.ts` and `src/lib/jobs/sync-queue.test.ts` fail to collect, for exactly the reason PF-1 gives: they reach `src/lib/jobs/trek-sync.ts` (through `src/modules/integrations/infrastructure/trek-provider-adapter.ts` and the provider registry), and that file still imports the deleted `@/lib/repo/leave`. `trek-sync.ts`/`trek-diff.ts` are moved in Task 3, not stubbed, so both suites recover there. The three files PF-1 did name (`trek-diff.test.ts`, `trek-sync.test.ts`, `trek-sync-job.test.ts`) pass, because they mock `@/lib/repo/leave` or import only its type.
2. **Two files outside the Files list had to change**, because a dropped table left them reading something that no longer exists: `src/app/api/metrics/route.ts` counted `payslips WHERE status = 'parsed'` in raw SQL (re-pointed at `payroll_imports` with the review queue's own statuses), and `src/lib/contracts.ts` carried three doc-comments describing `balance_snapshots` and `src/lib/repo/balances.ts` as live (rewritten; `ACCOUNT_KEYS` itself stays, `src/lib/clients/wallet-accounts.ts` still uses it).
3. **`src/lib/repo/balances.test.ts` was deleted with `balances.ts`** (the plan named only the source file), and the eight leave-only optional fields on `PayslipLike` in `src/lib/calc/payroll.ts` (`ferieBalance`/`ferieUnit`/`rolBalance`/`rolUnit`/`ferieTaken`/`rolTaken`/`permessiBalance`/`permessiUnit`) went with the four leave functions: nothing reads them once those are gone, and every one of them named a dropped `payslips` column.
4. **`cron/crontab` does not name `wallet_refresh`** — it posts to `/api/jobs/tick?tier=daily`, so only its comment needed correcting. `scripts/import-file-credentials.ts`, its Dockerfile esbuild step and `migrate:credentials` were kept (PF-4); every other `migrate:*`/`validate:*` script, npm script and esbuild step is gone. `src/modules/accounts/infrastructure/teable-import.ts` survives its deleted caller because `src/lib/jobs/monthly-close.ts` still imports `lastDayOfMonth` from it.


---

### Task 2 ⚡: Domain, ports, Drizzle repositories, payroll sink

**Files:** `src/modules/timeoff/domain/units.ts` (+test), `events.ts` (+test); `application/ports.ts`, `deps.ts`, `errors.ts`; `infrastructure/drizzle-types-repository.ts`, `drizzle-balances-repository.ts`, `drizzle-events-repository.ts`, `trek-store.ts`, `deps.ts`, `payroll-balance-sink.ts`; modify `src/modules/payroll/application/ports.ts`, `apply-import.ts` (+test), `src/modules/payroll/infrastructure/deps.ts`.

- [x] **Step 1:** `units.ts` and `events.ts` exactly as the original Task 2 (`toDays`, `toHours`, `addQuantity`, `quantityFromFraction`; `statusAt`, `plannedByMonth`, `upcoming`) with the same unit tests. Skip `variance.ts`.
- [x] **Step 2:** `ports.ts` as the original Task 3 (`TimeoffType`, `TimeoffBalance`, `TimeoffEvent`, `TypesRepository`, `BalancesRepository`, `EventsRepository`, `TimeoffStore`, `UseCaseDeps`) minus `TypesRepository.update`. Drizzle repositories as the original Task 3 Step 2; `trek-store.ts` and `deps.ts` as Step 3. **No memory repositories.**
- [x] **Step 3: Payroll sink** as the original Task 4 Step 3: `TimeoffBalanceWrite`, `TimeoffBalanceSink` in payroll `ports.ts`; `payroll-balance-sink.ts` writes one `timeoff_balances` row per (type, record) with `remaining` from `timeoff_balance` and `used` from `timeoff_used`, `asOf = periodEnd`, deletes the superseded record's rows first, seeds the default types when missing; `apply-import.ts` calls it after the fund sink; `ApplyImportResult.timeoffBalances`. The existing `apply-import.test.ts` gets a stub sink that records calls.
- [x] **Verify:** `npm test -- modules/timeoff modules/payroll`. **Commit:** `git add -A src && git commit -m "feat(timeoff): domain, ports, Drizzle repositories; payroll apply writes timeoff_balances"`

### Deviation (Task 2, executed 2026-09-07)

Four points where the tree or the type-checker forced something the step text did not name:

1. **`ApplyImportResult` does not exist.** The apply step's result interface in `src/modules/payroll/application/apply-import.ts` is named `AppliedImport`; the new field is `AppliedImport.timeoffBalances: { written: number; skipped: string[] }`, and it is also added to the `payroll.import_applied` audit `after` alongside `fundContributions`.
2. **`application/ensure-default-types.ts` is created in Task 2, not Task 3.** The payroll sink must seed the default types (R7-1) and so needs that logic, but it must not depend on a `Principal`. The file therefore ships here with `DEFAULT_TIMEOFF_TYPES` and `seedDefaultTypes(types, userId, hoursPerDay)` — port-only, no `Principal` — and Task 3 adds the curried `ensureDefaultTypes(deps)(principal)` use case to the same file. Putting the helper in `infrastructure/payroll-balance-sink.ts` instead would have made Task 3's application-layer use case import from infrastructure.
3. **Nine payroll test files gained a `timeoff` stub, not one.** `UseCaseDeps.timeoff` is required, so every file that builds a payroll deps bag stops type-checking without it. `apply-import.test.ts` gets the recording `StubTimeoffBalanceSink` the step asks for; the other eight (`create-import`, `ingest-import`, `list-records`, `purge-expired-originals`, `read-original`, `review-import`, `ui/load-company`, `ui/load-payroll`, `src/app/actions/payroll.test.ts`) get a one-line inert stub, because none of them exercises the sink.
4. **One case was added to `apply-import.itest.ts`** (a file the step does not list). The sink is Drizzle-only by the reduced conventions, so without it nothing would prove the `onConflictDoUpdate` on the partial index `timeoff_balances_type_record_uq`, the `deleteByPayrollRecord` replacement or the lazy type seeding against real Postgres.

---

### Task 3 ⚡: Use cases and Trek sync

**Files:** `application/{ensure-default-types,get-workspace,set-event,remove-event}.ts`, `application/use-cases.itest.ts`; `git mv src/lib/jobs/trek-diff.ts src/modules/timeoff/infrastructure/trek-diff.ts` (+test), `git mv src/lib/jobs/trek-sync.ts …/trek-sync.ts` (+test); modify `src/lib/jobs/trek-sync-job.ts`, `src/modules/integrations/infrastructure/trek-provider-adapter.ts`, `src/app/api/jobs/trek-sync/route.ts`.

- [x] **Step 1: Use cases** with the signatures of the original Task 4, except `TimeoffWorkspace` loses `variance`, `flagged`, `months` (the bare page builds its own grid from `byDate`) and keeps `year`, `today`, `types`, `balances`, `byDate`, `selected`, `upcoming`, `plannedDaysYtd`, `pendingCount`, `trekConnected`, `cachedStats`. `setEvent` rejects weekends (`isWeekendBlocked`), `removeEvent` hard-deletes never-synced manual rows and stages `delete` otherwise.
- [x] **Step 2: `use-cases.itest.ts`** (real DB, `testPrincipal`): default types seeded once and idempotent; workspace balances are `null` with no rows and convert hours→days with the type's `hoursPerDay` after the sink wrote one; `setEvent` Saturday → `InvalidInputError`; `setEvent` on a Trek day stages `upsert`; `removeEvent` manual → gone, Trek → `pendingOp = 'delete'`; audit rows `timeoff.event_set`, `timeoff.event_removed`.
- [x] **Step 3: Trek** exactly as the original Task 5 (`LeaveDayRow` → `TimeoffEvent`, `RunTrekSyncInput` gains `userId` + `store`, adapter passes `drizzleTimeoffStore(db)`, network calls outside `withEvents`). Port the existing diff/sync tests. `grep -rn "repo/leave\|lib/jobs/trek-diff\|lib/jobs/trek-sync\"" src` → nothing.
- [x] **Verify:** `npm test -- modules/timeoff && npm run test:integration -- timeoff`. **Commit:** `git add -A src && git commit -m "feat(timeoff): use cases; Trek sync over timeoff_events and provider_links (R7-3)"`

### Deviation (Task 3, executed 2026-09-07)

Five points where the plan text and the tree did not line up:

1. **R7-2 needed more than "permits are excluded from the push plan".** Excluding a staged `permits` upsert from the push and stopping there leaves the row flagged forever (nothing upstream will ever settle it), and the NEXT pull then reads "Trek does not have this day" and deletes it — the owner's permits day silently disappears. Two things close that: `syncPass` settles a staged permits upsert locally before the push, and `planPull` is fed `trekEvents(...)`, the events Trek can actually hold. Staged *deletes* are still pushed whatever the local type says, because a day Trek holds must be removed there. `trek-diff.ts` therefore also exports `trekKindOf`, `typeCodeOf`, `trekEvents`, `trekFraction` and `storedFraction`, and the ported test file covers all of it.
2. **`plannedDaysByMonth` is deleted, with its four tests.** It lived in `trek-diff.ts`, its only consumer was the Company page deleted in Task 1, and `domain/events.ts` `plannedByMonth` is its replacement on the new quantities. The four tests are replaced by the R7-2 mapping and fraction-boundary tests named above, so the file's test count went from 16 to 20.
3. **`src/lib/jobs/trek-sync-job.ts` and `src/app/api/jobs/trek-sync/route.ts` needed no edit.** Neither imports `trek-sync`/`trek-diff`: the job reaches the sync through `runSyncForUser` and the provider registry, so `trek-provider-adapter.ts` was the only caller to re-point. Its test's `vi.mock` target moved with it.
4. **`TimeoffWorkspace.selected` is populated whenever `selectedDate` is given**, with `event: null` and `status: null` for a free day — not `null`, as the original Task 4's prose said. The prose contradicts its own `DayDetail` type (which declares both fields nullable), and Task 4's bare page needs a detail object to hang the booking form on for a day that has no event yet.
5. **`BalanceView.source` is `"payroll" | "manual" | null`, not `"payroll" | null`.** `timeoff_balances.source` admits `manual`; flattening a hand-entered figure to "no source" would misreport it.

### Deviation (Tasks 2-3, fix round 1, 2026-09-07)

Three Important findings from the task review of `e27c380..67c412c`, and two signature consequences:

1. **`EventsRepository` gains `unlinkProvider(userId, dates)`.** A day Trek owned, retyped to
   `permits`, needs its Trek entry REMOVED upstream (otherwise the next pull reads the surviving
   entry as new and writes the conversion back) and its `provider_links` row dropped once Trek
   confirms — while the event itself stays. No existing port method expresses "the day is no
   longer Trek's"; `deleteDates` would take the day with it. `planPush` now emits a removal for
   such a row, and `trek-diff.ts` exports `conversionRemovals` / `localOnlyUpserts` so `syncPass`
   can tell a converted day from one Trek has never held.
2. **`removeEvent` keys off the Trek link, not `origin`.** The original text said "a never-synced
   manual row is hard-deleted"; after a conversion the row is neither manual nor unsynced, yet
   Trek holds nothing for it, and staging a delete would push a removal for an entry already
   gone. The predicate is now `trekEntryId === null`, which is the question that was always being
   asked. A narrow pre-existing window is documented at the function: the link is written by the
   pull half, so a push-landed / pull-failed day has no link for an entry Trek does hold.
3. **`BalanceView.usedYtdHours` reads the LATEST balance row, not the year's sum.** The payslip's
   GOD. column is cumulative — `src/lib/payroll/teamsystem.ts` only accepts the leave grid when
   `A.P. + MAT. - GOD. = RES.` balances, which holds only for a year-to-date GOD. and a running
   RES. Summing July's 4,00 onto August's 12,01 reported 16,01 against a true 12,01. The parser's
   row-300 fallback is per-period and therefore disagrees with the grid; that asymmetry is
   recorded in the comment and left to the parser to fix, not papered over in the view.
   `BalancesRepository.listForYear` keeps its place in the port (the deferred `variance.ts` needs
   it) and is now covered by the itest.
4. **`DrizzleTypesRepository.create` uses `ON CONFLICT DO NOTHING` plus a re-read.**
   `seedDefaultTypes` is check-then-insert and two concurrent first touches of the same user (the
   hourly sync's seed and a workspace load; a payroll apply and a page render) made the loser die
   on `timeoff_types_user_code_uq`, taking its whole transaction with it. Covered by a
   `Promise.all` case in `use-cases.itest.ts`.

### Deviation (Tasks 2-3, fix round 2, 2026-09-07)

The re-review found fix round 1's Important 2 half-done: the confirmed-removal path was right, the
FAILURE branch was not. One correction and two refinements:

1. **`planPull`'s remote loop now honours `stillPending`.** The guard existed only in the loop over
   `local`, and `trekEvents()` deliberately keeps a converted `permits` day out of `local` — so a
   conversion whose removal Trek REFUSED came back through the remote loop as a day this dashboard
   had never heard of, was adopted, and wrote the staged edit back to `vacation` in the same pass
   that failed to deliver it. The guard belongs in both loops; it also covers any future
   kind-filtered row whose push fails. The file's first principle ("an unlanded push is never
   papered over by the pull") now actually holds.
2. **`unlinkProvider` takes `now` and clears `syncedAt`.** A settled conversion is no longer a
   mirror of anything upstream, so a timestamp saying when it last agreed with Trek is a claim
   about an entry that no longer exists.
3. **`conversionRemovals` / `localOnlyUpserts` collapse into `unpushableUpserts(local)`**
   returning `{ converted, localOnly }`, so `planPush`'s predicate is written once instead of
   three times.

---

### Task 4: API, bare page, consumers, phase gate

**Files:** `api/schemas.ts`, `routes.ts`, `routes.itest.ts`; `ui/run.ts`, `deps.ts`, `load-workspace.ts`; `src/app/(app)/company/time-off/page.tsx` (rewrite), `src/app/actions/timeoff.ts`; modify `src/platform/http/app.ts`, `src/app/(app)/page.tsx` (leave card), `src/modules/payroll/ui/load-company.ts`, `docs/api/README.md`.

**Routes** (tag `Time off`): `GET /timeoff/types`, `GET /timeoff/workspace?year=&date=`, `GET /timeoff/events?from=&to=`, `PUT /timeoff/events/{date}`, `DELETE /timeoff/events/{date}` (204), `GET /timeoff/balances?year=`. No `PATCH /timeoff/types/{id}`.

- [x] **Step 1: API** + `routes.itest.ts` (types seeded on first call; PUT weekday 200; PUT Saturday 422; DELETE 204; viewer PUT 403) + `npm run openapi:generate` + a short README section.
- [x] **Step 2: Bare page** `/company/time-off?year=&day=`: a server component that calls `loadWorkspace`, renders (a) one line per type: `label — remaining: X days (Y h) as of DATE` or `—`; (b) twelve `<table>`s (or the existing `MonthGrid` if it imports without changes), each day a link to `?day=`; days in `byDate` marked with the type code and `½` for half days, `*` when `pendingOp !== "none"`; (c) when `day` is set, a native `<form>` with type `<select>`, fraction radio, note, Save / Remove buttons bound to the actions; (d) a "Sync now" button when `trekConnected`; (e) the upcoming list as `<ul>`. No client component beyond what a `<form action>` needs.
- [x] **Step 3: Actions** `setTimeoffEventAction`, `removeTimeoffEventAction`, `syncTimeoffNowAction` (the old `syncLeaveNow` over `runTrekSync` with the principal's `userId`), `revalidatePath("/company/time-off")`.
- [x] **Step 4: Consumers.** `loadTimeoffSummary()` → `{ remainingDays, upcoming, pendingCount }` for the Home `leave` card and `load-company.ts`. Remove every `// TODO(timeoff)` stub from Task 1.
- [x] **Step 5: Phase gate.** `npm run typecheck && npm test && npm run test:db:up && npm run test:integration && npm run build && npm run openapi:generate && git diff --exit-code docs/api/openapi.json`; `grep -rn "leave_days\|leaveDays\|payslips\b\|balance_snapshots\|vacation_ledger\|legacy\.ts" src scripts` → nothing; `ls scripts/migrate-* scripts/validate-*` → nothing.
- [x] **Commit:** `git add -A && git commit -m "feat(timeoff): API, bare Time Off page, consumers; Phase 7 gate green"`

### Deviation (Task 4, executed 2026-09-07)

Six points where the tree or a framework constraint forced something the step text did not name:

1. **Two application files were added that the Files list does not name:**
   `application/list-events.ts` and `application/list-balances.ts`. The routes
   `GET /timeoff/events?from=&to=` and `GET /timeoff/balances?year=` have no use case
   behind them — Task 3 built only `ensureDefaultTypes`, `getWorkspace`, `setEvent` and
   `removeEvent` — and calling `deps.events.inRange` / `deps.balances.listForYear`
   straight from the route would put the `timeoff.read` check and the range validation on
   the wrong side of the API boundary, which no other module does.
2. **`src/modules/payroll/ui/load-company.ts` needed no change.** It never carried leave
   balances: `CompanyOverview` is imports, earnings buckets and salary windows only, and
   `/company/page.tsx` says in its own doc-comment that time off "joins this panel in
   Phase 7". Wiring `loadTimeoffSummary` into it would be new UI, which the reduced
   conventions cap. `loadTimeoffSummary` ships as specified and is consumed by the Home
   `leave` card; the Company panel is left for the redesign.
3. **There were no `// TODO(timeoff)` stubs to remove.** `grep -rn "TODO(timeoff)" src`
   was already empty at the start of this task — Task 1 left `/company/time-off/page.tsx`
   and the Home `leave` card broken rather than stubbed, exactly as its Step 4 allowed,
   and both are rewritten here.
4. **`MonthGrid` was not reused.** It is a `"use client"` component whose day cells are
   `<button onClick>`, not links, so it cannot render a plain `?day=` link without
   changes. The page therefore uses the twelve plain `<table>`s the step offers as the
   alternative.
5. **The Home `leave` card lost its `ProgressRing`.** The ring needs a maximum to fill
   against, and the retired `loadFerie` invented one (`remaining + takenYtd`). This module
   records what a payslip states as REMAINING, not an entitlement, so there is no honest
   denominator; the card shows the figure, the next booked day and the pending-sync count,
   and `—` when no payslip balance is on file.
6. **The Step 5 grep cannot reach zero for `leave_days`, `balance_snapshots`,
   `vacation_ledger` and `legacy.ts`, and should not.** Every remaining hit is a comment or
   a string literal, never a reference to live code:
   `src/lib/db/migrations.itest.ts` names all four in `DROPPED_LEGACY_TABLES` — that list IS
   the proof migration 0018 dropped them, and deleting it to satisfy a grep would remove the
   only assertion that they are gone; the rest are doc-comments Task 1 deliberately rewrote
   to describe those tables as retired (`lib/contracts.ts`, `lib/calc/networth.ts`,
   `lib/calc/portfolio.ts`, `lib/time.ts`, `accounts/infrastructure/teable-import.ts`,
   `lib/db/schema/timeoff.ts`, `lib/db/schema/platform.ts`,
   `payroll/infrastructure/paperless-import.ts`). `grep -rn "repo/payslips\|schema/legacy"`
   over `src scripts` returns one comment and no import; `src/lib/db/schema/legacy.ts` does
   not exist; `ls scripts/migrate-* scripts/validate-*` is empty.

