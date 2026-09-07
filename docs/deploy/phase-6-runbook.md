# Phase 6 deployment runbook — Budgets

Phase 6 stacks on the deployed Phase 5 (Funds) build. It adds migration
`0017_budgets.sql` (six new tables, no change to any existing table) and
converts the legacy Vacation fund (`vacation_ledger`, `vacation_accrual_rate`)
into a budget named "Holidays". Nothing in this phase touches `accounts`,
`account_balances`, `funds` or `fund_contributions` — budgets are strictly
virtual (spec §11 exit line).

This runbook assumes the Phase 5 runbook has already run against this
database — Phase 5's checkpoint records it deployed on 2026-09-06 at commit
`0dc939e`, image `sha256:4c490096cc1118506b55a02d9e75bdec9288dbf02268112890caaa5bc867fec5`.
Phase 6 has **not** been deployed as of this document; this runbook is
prepared for that future cutover, not a record of one that already happened.

The build for this phase adds `scripts/migrate-vacation-budget.ts` and
`scripts/validate-vacation-budget-migration.ts` to the Dockerfile's esbuild
bundle stage (`migrate-vacation-budget.mjs`, `validate-vacation-budget-migration.mjs`),
mirroring the funds migration precedent — Phase 5's Dockerfile only bundled
its own scripts, so this phase's image build was extended here (see the
Dockerfile diff in this same commit) and verified with a local
`docker compose build dashboard-app` before this runbook was written.

## Operational facts from this phase's reviews — read before running anything

**Idempotency key namespace change affects the already-deployed Funds module.**
Task 5 of this phase moved `financial-write.ts` from
`src/modules/funds/api/` to `src/platform/http/` so both Funds and Budgets
share it, and in doing so scoped the persisted idempotency row by module: the
stored key is now `${namespace}:${key}` (e.g. `funds:abc-123`), where before
it was the bare client-supplied key. Live `idempotency_keys` rows written by
the currently deployed Funds module carry the old, unprefixed keys, which the
namespaced lookup would miss — so a Funds contribution/reversal retried across
the deploy would re-execute rather than replay, creating a duplicate
contribution.

**This is mitigated in code.** `runFinancialWrite`
(`src/platform/http/financial-write.ts`) carries a deploy-boundary shim: when
the namespaced lookup misses **and** the namespace is `funds`, it falls back to
the bare key and treats a live row found there as a replay, exactly as the
former middleware would have. The fallback is scoped to `funds` alone — no
other namespace inherits a bare key it never wrote — and it is covered by
"replays a pre-cutover funds row stored under the bare key instead of
re-executing the write" in `src/platform/http/financial-write.itest.ts`.

**Post-cutover cleanup (owner: whoever runs this deploy).** Rows expire 24
hours after they are written, so once 24 hours have passed since cutover no
bare-key row can still be live and the shim is dead code. Delete
`FALLBACK_NAMESPACE` and the fallback lookup in `runFinancialWrite`, plus the
integration test named above, and commit. Until then, still watch for
duplicate contributions in the hours after deploying: the shim closes the
lookup gap, but it is the first exercise of that path in production.

**The vacation migration aborts rather than double-migrating — this is the
guard working, not a failure.** `migrate-vacation-budget.ts` resolves the
budget it is migrating into via a `budget_events` row of kind `migrated`
(`detail: { table: "vacation_budget", legacyId: "root" }`), created the first
time it runs, precisely because a budget's name and labels are user-editable
and cannot safely be trusted as an idempotency key on their own. If a second
run finds a budget named "Holidays" with the `["migrated"]` label but **no**
such event, both the migration and the validator refuse to touch it and print
a message naming the situation, exiting non-zero, instead of guessing and
possibly double-writing real money. This happens only if a database already
has a "Holidays"-labelled budget created by something other than this
script's own successful run — for a first Phase 6 deploy against a database
that has never run this migration, it will not trip. If it does trip:
investigate first, do not force past it. Check whether the existing budget's
data is already a complete, correct migration (compare its amount version,
allocations and usages against the legacy tables by hand); if it is, the
budget was very likely created by an earlier, pre-`budget_events` build of
this script, and you can unblock it by inserting the missing root event by
hand (`INSERT INTO budget_events (budget_id, kind, detail) VALUES ('<id>',
'migrated', '{"table":"vacation_budget","legacyId":"root"}')` as `system`),
then re-running to confirm it now writes zero rows. If the existing budget's
data does not look like a correct migration, or you are not sure, restore the
pre-deploy dump and start the whole sequence over on a clean database instead
of editing production data by hand under uncertainty.

**Do not re-run the validator after users start editing the Holidays
budget.** `checkRateAllocations` counts every `monthly` allocation on the
budget and compares it to the count of legacy accrual rates; `checkWithdrawalUsages`
does the same for every `manual` usage against the count of legacy
withdrawals. Both counts are budget-wide, not scoped to rows the migration
itself wrote. The moment a user adds their own monthly allocation or their
own manual usage to the Holidays budget — which the product fully supports
and expects — either check's count stops matching and the validator reports
a failure that is not a data problem. Run the validator once, right after
migrating, as a cutover check. It is not a monitor and must not be scheduled
or re-run later against a live budget.

**Validator limitations — read these before trusting a `FAIL` or a silent
`OK` for more than it proves:**

- It matches withdrawal usages and adjustment allocations to their legacy row
  by `(date, amount)`, not by a stable 1:1 row link. Two legacy rows with the
  same date and the same amount (two withdrawals of the same size on the same
  day, say) will make the validator fail even when the migration handled both
  of them correctly — it fails loud rather than passing wrongly, but the
  failure message in that specific case is confusing and does not mean data
  was lost.
- It has no reverse-direction count on `once` allocations: it confirms every
  legacy adjustment produced a matching allocation, but never confirms the
  budget has *no more* `once` allocations than that. A stray `once`
  allocation dated after the last legacy ledger month — from a bug, or from
  someone editing the budget before the validator runs — is caught by
  nothing.
- Its `cents`, `lastDayOfMonth`, `dateOf` and `buildExpectedRateAllocations`
  helpers are intentionally copy-paste identical to the migration script's
  own versions of the same functions. A date-attribution or rate-shape bug
  shared between the two files would be invisible to this validator, because
  both sides of every comparison would be wrong the same way.
- The future-dated-`accrual`-row guard (both scripts refuse to guess a
  reconciliation horizon and throw `MigrationInputError` /
  `ValidationError` instead of silently clamping it to today) is proven only
  by a manual CLI run recorded in the Task 7 report, not by an automated
  test. Nothing in the automated suite would catch this guard being
  accidentally removed or weakened in a later change.

**Data-shape results that are correct behaviour, not bugs, if you see them
in the real migration's counts:**

- A ledger with accrual *rates* but few or no matching accrual *rows* in a
  given month produces a chain of negative `migration_reconciliation`
  allocations that cancel the rate-derived accrual back down to what the
  ledger actually recorded (R6-4, literally). Do not "fix" a long run of
  negative reconciliation allocations — that is the reconciliation working.
- In that same case, running the validator in a later calendar month than
  the migration was run can report a spurious mismatch, because the
  reconciliation horizon and the validator's balance-check horizon each fall
  back independently to their own run month when there are no more accrual
  rows to anchor on. Run the validator immediately after migrating, not
  days or weeks later, to avoid this.
- Deleting a migrated usage from the UI afterward will not have it come back
  on a second migration run — this is deliberate, events-based idempotency,
  not a bug in the delete.
- The migration writes `budget_events` rows of kind `migrated` and
  `migration_reconciliation`. These will show up in the Holidays budget's
  events list in the UI with no friendly label — they display as their raw
  kind string. This is expected; no UI work in this phase gives them a
  display label.

## Cutover sequence

1. **Verify.** From `dashboard-app/`: `npm run typecheck && npm test && npm run test:db:up && npm run test:integration && npm run build && npm run openapi:generate && git diff --exit-code docs/api/openapi.json`. All must pass before building the deploy image. Confirm `npm run build`'s route table includes `/finance/budgets`, `/finance/budgets/[id]` and `/finance/vacation` (the redirect stub).

2. **Rehearse the vacation migration against a private copy first, not
   production directly.** Restore a private custom-format production dump
   into a separate database on `dashboard-postgres-test` (never
   `dashboard_test` itself — that database belongs to the integration test
   harness and gets truncated by it). Apply migration 0017, then run
   `DATABASE_URL=<rehearsal db> npm run migrate:vacation` followed by
   `DATABASE_URL=<rehearsal db> npm run migrate:vacation:validate`. Confirm
   the validator prints `OK (N months examined)` with `N` equal to the
   number of months between the earliest legacy row and today. Run the
   migration a second time against the same rehearsal database and confirm
   every count in its printed JSON is zero — this is the idempotency proof,
   not optional, and it is cheap since it is the same command run twice.

3. **Build the new image before downtime:** `docker compose build
   dashboard-app`. Confirm the build log shows both new esbuild bundle steps
   (`migrate-vacation-budget.mjs`, `validate-vacation-budget-migration.mjs`)
   succeeding — this was verified once already while writing this runbook.

4. **Stop the app**, leaving unrelated services (the Postgres container, the
   cron sidecar, any other Compose project on the host) running:
   `docker compose stop dashboard-app`. If `dashboard-cron` has since
   started ticking (it had not, as of the Phase 5 checkpoint), stop it too
   and record that it was running.

5. **Take the pre-deploy backup**, outside the temporary SDD workspace and
   never committed:

   ```bash
   umask 077
   mkdir -p "$HOME/backups/personal-dashboard/2026-09-06-phase6"
   docker exec postgres sh -c 'pg_dump -U "${POSTGRES_USER:-postgres}" -d dashboard -Fc' > "$HOME/backups/personal-dashboard/2026-09-06-phase6/pre-phase6-final.dump"
   ```

   Confirm the archive is non-empty and can be listed (`pg_restore --list
   <file>`) before proceeding. This dump is the entire rollback plan below —
   do not proceed past this step without confirming it.

6. **Confirm the image you are about to exec into actually carries this
   commit's bundled scripts — before running anything against production.**
   Step 3 built a fresh image, but nothing stops an operator from reaching
   this point with a stale or cached one (a skipped step 3, a build that
   silently reused a cache layer from before this phase, a compose file
   pointing at an older tag). Check both bundled scripts exist in the image
   that `docker compose` would actually run:

   ```bash
   docker compose run --rm --no-deps dashboard-app ls -la /app/migrate-vacation-budget.mjs /app/validate-vacation-budget-migration.mjs
   ```

   Both files must be listed. **If either is missing, stop — do not proceed
   to the next step.** Rebuild (step 3) and redeploy the image before
   touching the database; do not attempt the migration against an image that
   lacks it. Nothing has been backed up or migrated yet at this point, so
   there is nothing to unwind.

7. **Apply the schema migration and the vacation migration, in order, against
   the real production database, stopping on any failure:**

   ```bash
   docker compose run --rm --no-deps dashboard-app node /app/migrate.mjs
   docker compose run --rm --no-deps dashboard-app node /app/migrate-vacation-budget.mjs
   docker compose run --rm --no-deps dashboard-app node /app/validate-vacation-budget-migration.mjs
   ```

   (`npm run db:migrate`, `npm run migrate:vacation` and `npm run
   migrate:vacation:validate` are the equivalent source-checkout commands
   used in rehearsal and in Task 7's own verification; the deployed image has
   no `tsx` runtime, so production uses the bundled `.mjs` scripts exactly as
   Phase 5's funds migration did.) If `migrate-vacation-budget.mjs` prints
   `nothing to migrate` and exits 0, the legacy tables were already empty —
   record that rather than treating it as an error. If it aborts naming an
   existing unlabelled-by-events Holidays budget, see "The vacation migration
   aborts rather than double-migrating" above before doing anything else.

8. **Start the app:** `docker compose up -d --no-deps dashboard-app`. Wait
   for its health check. Restart `dashboard-cron` only if it was stopped in
   step 4.

9. **Verify in the running application.** Sign in and open
   `/finance/budgets`. Confirm a budget named "Holidays" is listed and that
   its remaining figure equals the old Vacation fund's balance as of today
   (cross-check against the last balance the legacy Personal Settings page
   showed, or against the rehearsal validator's own recomputation). Confirm
   `/finance/vacation` redirects to `/finance/budgets` rather than 404ing.
   Confirm the ordinary Funds pages and Home still work — this phase's own
   tests never touch `accounts`, `account_balances`, `funds` or
   `fund_contributions`, but a live check after any deploy is still owed.

## Rollback

Keep the app stopped if migration or validation fails at any point in step
7. Restore the pre-deploy backup from step 5 into the production database
using its administrative role, then start `dashboard-app` again from the
**previous** image (retag it back to `dashboard:latest` if step 3 already
overwrote that tag locally) without rebuilding. A schema-only rollback is not
enough: the new application code expects the budgets tables to exist and the
old one does not know about them, so restoring the dump and reverting the
image together is the only supported path — there is no partial rollback.
Restoring the backup also discards any writes made after it, including any
in-app budgets activity between steps 5 and the failure, which is why step 5
must happen with the app already stopped.

The legacy `vacation_ledger` and `vacation_accrual_rate` tables are left
intact by the migration (frozen, read-only, dropped only in Phase 9) and are
not a substitute for the full database backup — they cannot reconstruct any
budgets-side writes (allocations, scopes, manual usages, events) a user makes
after cutover.
