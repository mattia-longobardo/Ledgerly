# Phases 7–9 (reduced): conventions addendum

This file **overrides** `2026-09-06-phases-5-9-shared-conventions.md` where the two disagree. Everything not mentioned here (module shape, money as strings, RLS policy shape, API conventions, `withUserContext` rules, permissions, jobs registration, commit style) stays as written there.

Read this file and the shared conventions once per session, before the task you are executing.

## Why the plans got shorter

The owner has decided (2026-09-07):

1. **Legacy data is disposable.** No migration scripts, no validators, no runbooks with dump/rollback, no "frozen table, dropped later" two-step. Legacy tables are dropped in the same migration that creates their replacement. Production is repopulated by hand (re-upload payslips, re-enter time off).
2. **The current UI will be redesigned.** Nothing built now under `src/components/ui/` or `BRAND.md` survives, so UI effort is capped at "functional": a page exists when the owner needs to use the feature by hand before the redesign; otherwise the feature is API + server action only, and the page comes with the redesign.

## Rules that replace the shared conventions

- **Drizzle repositories only.** No `memory-repositories.ts`, no `repositories.itest.ts` proving memory and Drizzle agree. Use cases are tested in `*.itest.ts` against the real test database (`src/test/db.ts`, `resetDb`, `testPrincipal`). Unit tests (`*.test.ts`) only for pure domain functions.
- **One RLS proof per phase, not per table.** Add the new tables to the parametric list in `src/lib/db/rls-matrix.itest.ts` (created in Phase 7 Task 1: for each `(table, insertRow)` entry it inserts as user A, reads as user B, expects zero rows, and expects B's insert with A's `user_id` to be rejected). Constraint-specific checks (CHECKs, partial unique indexes) go in the same file only when the constraint carries business meaning.
- **UI is "bare":** native `<form>` elements + server actions, plain `<table>`, no `Panel`/`Sheet`/`StatTile`/`ProgressRing`/`EmptyState`, no `BRAND.md` compliance, no loading skeletons, no mobile layout. Existing components may be reused only when it costs nothing (import and go). A missing value renders as `—`, never `0.00` (that rule stays).
- **No closing ceremony per phase.** No `docs/deploy/phase-N-runbook.md`, no `docs/superpowers/handoff/…-checkpoint.md`, no `graphify update`, no MASTER-LEDGER edit, no `docs/architecture/overview.md` edit until the single docs task at the end of Phase 9.
- **Verify is per phase, not per task.** Each task runs only `npm run typecheck && npm test` (plus the one itest file it touched, via `npm run test:integration -- <name>`). The full gate (`test:db:up && test:integration && build && openapi:generate && git diff --exit-code docs/api/openapi.json`) runs once, in each phase's last task.
- **Batch tasks.** A Codex/Claude run executes **all the tasks of a phase whose steps are marked ⚡** in one go (they are small and share files); the ones without ⚡ get their own run. Prompt shape: *"Implement Tasks 1–3 of `<plan>` exactly as written. Read `2026-09-07-phases-7-9-reduced-conventions.md` and then `2026-09-06-phases-5-9-shared-conventions.md` first. Commit after each task with the given message."*
- **Deferred list is a file.** `docs/superpowers/DEFERRED.md` is created in Phase 7 Task 1 and appended to by every task that drops scope. One line per item: what, why, which original plan/task describes it. This is the list to reopen with the redesign.
- **Deviation rule unchanged:** if a named file or signature differs, stop, write `### Deviation` in the plan, fix the plan, continue.

## Migration numbers (verify with `ls drizzle/*.sql` before generating)

- `0018_timeoff_and_drop_legacy.sql` — Phase 7
- `0019_personal_access_tokens.sql` — Phase 8
- Phase 9 has **no migration** (webhooks deferred; housekeeping and management use existing tables).
