# Deferred

Scope the reduced Phases 7–9 plans dropped on purpose, one line per item: what it is, why it went, and which original plan and task describes it in full. This is the list to reopen with the UI redesign — nothing here is lost, only postponed.

- **Time Off workspace UI** (spec §7.8: two-pane layout, URL-driven day detail, variance table, upcoming list, Home card body) — the redesign replaces every component it would use, so Phase 7 ships a bare page instead. Original `2026-09-06-phase-7-time-off.md`, Task 6.
- **`src/modules/timeoff/domain/variance.ts`** (planned vs used per month, from `src/lib/calc/leave-variance.ts`) — its only consumer was the variance table above. `leave-variance.ts` was deleted with its consumers in Phase 7 Task 1; rebuild it on `timeoff_balances.used` when the UI needs it. Original `2026-09-06-phase-7-time-off.md`, Task 2.
- **`updateType` use case and `PATCH /timeoff/types/{id}`** — types are seeded lazily per user (R7-1) with `hours_per_day` from settings, so nothing needs to edit them yet. Original `2026-09-06-phase-7-time-off.md`, Tasks 4 and 6.
- **`scripts/migrate-timeoff.ts` and its validator** — never: R7-5' makes legacy data disposable, so `leave_days` is dropped rather than migrated and production is repopulated by hand. Original `2026-09-06-phase-7-time-off.md`, Task 7.
