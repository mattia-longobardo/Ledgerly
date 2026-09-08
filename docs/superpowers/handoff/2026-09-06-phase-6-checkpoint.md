# Phase 6 checkpoint — Budgets

**Implemented, reviewed and DEPLOYED to production on 2026-09-07.** Phase 6
stacked on the deployed Phase 5 (Funds) build (`0dc939e`). The cutover ran the
sequence in `docs/deploy/phase-6-runbook.md` end to end, and that runbook
carried a "Deployment record — 2026-09-07" section with the exact counts,
image ids and the two deviations found during the cutover. The per-phase
runbooks were deleted at the close of Phase 9 and live in git history; the
standing release procedure is now
[`docs/deploy/README.md`](../../deploy/README.md). This checkpoint records the exit verification gates and what the
pre-deploy walkthrough proved and how.

**Still owed after the deploy:** a true browser walkthrough as a signed-in
user against the live application (`/finance/budgets`, `/finance/vacation`,
`/finance/accounts`). The cutover verified the routes are served and the
migrated data is correct in the database, but everything past the sign-in
redirect remains unperformed. The deploy-boundary idempotency shim must also
be deleted after 2026-09-08 15:00 UTC — see the runbook's post-cutover
cleanup.

## Behavior

Budgets have a versioned initial amount and any number of **virtual**
allocations — planning-only figures that never write to `accounts`,
`account_balances`, `funds` or `fund_contributions`. An allocation can be
sourced from a real account or fund purely so its availability can be
computed against that source's real balance (`balance − Σ allocations
against it`, recomputed on every read, never stored), or from nothing
(R6-1) for a plan with no backing account. A `monthly` allocation contributes
its amount once per calendar month over its effective range rather than a
job inserting a row every month (R6-2). Usage is derived from the caller's
own `type = 'expense'` transactions by account/category/label/fund scope and
materialised into `budget_usages` on every detail read and by an explicit
refresh action; manual usage rows are never touched by that refresh (R6-3).
The REST API exposes eleven documented operations at `/budgets*`, gated by
new `budgets.read`/`budgets.write` permissions (`member` both, `viewer`
read). The Budgets list/detail pages and a Home "active budgets" card read
the module.

The legacy Vacation fund (`vacation_ledger`, `vacation_accrual_rate`) is
migrated into a budget named "Holidays": each accrual rate becomes an
unsourced monthly allocation, each withdrawal a manual usage, each
adjustment a `once` allocation, and any month where the ledger's own accrual
rows differ from what the rate alone would produce (R6-4) gets a `once`
reconciliation allocation for the difference, so the balance series matches
the legacy figures to the cent for every historical month. The migration and
its independent validator are idempotent, keyed on `budget_events` rows
rather than on user-editable fields (a budget's name/labels, an allocation's
note) that the product lets a user change after cutover. `/finance/vacation`
is now a one-phase bookmark redirect to `/finance/budgets`; the Vacation-fund
section of Personal Settings is gone.

**Product limitation, not previously written down:** budgets are EUR-only in
practice. The `currency` column and the REST API's request/response schemas
accept any currency code, but every display path (`MoneyValue`, the figures
tiles, the chart) formats amounts as EUR, so the create-budget form is
deliberately locked to EUR (a fix applied during this phase's review,
commit `836aa84`) rather than letting a user create a budget whose figures
would then render with the wrong symbol. A non-EUR budget is not reachable
from the UI; nothing prevents one via a raw API call, and nothing would
render it correctly if one existed.

## Verification

Final full gates on the current `main` tip before this documentation commit:

```
npm run typecheck                    → clean, no errors
npm test                             → 157 files, 1356 tests, all passing
npm run test:db:up                   → dashboard-postgres-test healthy
npm run test:integration             → 47 files, 269 tests, all passing
npm run build                        → next build succeeds; route table
                                        includes /finance/budgets,
                                        /finance/budgets/[id] and
                                        /finance/vacation (redirect stub)
npm run openapi:generate             → docs/api/openapi.json written
git diff --exit-code docs/api/openapi.json → no drift
```

`grep -rn "vacation_ledger\|vacationLedger\|vacation_accrual_rate\|vacationAccrualRate" src`
returns exactly two files: `src/lib/db/schema/legacy.ts` (the frozen table
definitions) and `src/lib/db/vacation-budget-migration.itest.ts` (Task 7's
integration test, which legitimately reads the frozen tables to build its
fixture). The migration and validator scripts themselves
(`scripts/migrate-vacation-budget.ts`,
`scripts/validate-vacation-budget-migration.ts`) live outside `src/`, so the
grep's own scope does not need to special-case them.

While preparing the deployment runbook, this task also extended
`dashboard-app/Dockerfile` to bundle
`scripts/migrate-vacation-budget.ts`/`scripts/validate-vacation-budget-migration.ts`
into the production image (`migrate-vacation-budget.mjs`,
`validate-vacation-budget-migration.mjs`), mirroring the funds migration's
existing esbuild bundle steps — without this, the runbook's cutover commands
would have had no way to run against the deployed image, which has no `tsx`
runtime and does not ship the module's source `.ts` files. Verified with a
local `docker compose build dashboard-app`, which succeeded and produced both
new bundle files (~452 KB each, in line with the funds scripts' bundle
sizes). This build was **not** used to restart or replace the currently
running `dashboard-app` container (still pinned to the Phase 5 image by id);
it was a build-only check that the Dockerfile change works.

## Manual walkthrough

The brief's walkthrough — create a budget with initial 1000, allocate 200
monthly from a real account, confirm that account's balance on
`/finance/accounts` is unchanged and the allocation row shows
available-in-source = balance − 200, add a category scope and see a real
expense appear as usage, add a manual usage, end the allocation — **could
not be driven through an actual browser in this environment**: there is no
running authenticated session, no browser automation wired to a running
`dashboard-app` instance, and no isolated rehearsal copy of production data
set up for this task (Phase 5's browser walkthrough was run by that task's
own agent against such a copy; that infrastructure was not left behind as
reusable tooling and was not rebuilt here). Stating this plainly rather than
fabricating screenshots or a transcript.

**What was proved instead, and how:** an equivalent walkthrough was run
against the real REST API (`createApiApp`, the same Hono app production
serves) and a real Postgres instance (the integration test database), using
a real account row with a real `account_balances` row, a real
`transaction_categories` row and a real `transactions` row — not the memory
repositories, not a mocked balance source. The script:

1. Created an account "Checking" with a real balance row (`1500.00` as of
   `2026-09-01`, `source: manual`).
2. `POST /api/v1/budgets` with `initialAmount: "1000.00"`.
3. `POST /api/v1/budgets/{id}/allocations` with `sourceKind: "account"`,
   `sourceId` = that account, `amount: "200.00"`, `recurrence: "monthly"`.
   Read `account_balances` directly afterward — **unchanged**, byte-for-byte
   equal to the row before the allocation existed.
4. `GET /api/v1/budgets/{id}` — `figures = { initial: "1000.00", allocated:
   "200.00", used: "0.00", remaining: "1200.00" }`, and the allocation's
   `availableInSource` = `"1300.00"` (`1500.00 − 200.00`), confirming
   available-in-source = balance − 200 exactly as the brief specifies.
5. `PUT /api/v1/budgets/{id}/scopes` with a category scope on a real
   `transaction_categories` row; inserted a real `transactions` row
   (`type: "expense"`, `amount: "-45.00"`) in that category;
   `POST /api/v1/budgets/{id}/refresh` returned `{ inserted: 1, updated: 0,
   deleted: 0 }`; the budget detail's `usages` array then contained exactly
   that row as `{ amount: "45.00", matchedBy: "scope" }` — a real expense
   became usage through the scope, not a fixture.
6. `POST /api/v1/budgets/{id}/usages` (with an `Idempotency-Key`) added a
   manual usage of `30.00`; the detail's figures became `used: "75.00"`,
   `remaining: "1125.00"` (`1000 + 200 − 75`).
7. `PATCH /api/v1/budgets/{id}/allocations/{aid}` with `effectiveTo:
   "2026-09-30"` ended the allocation; the response reflected the new
   `effectiveTo`.
8. Read `account_balances` one final time, after every step above — still
   byte-for-byte equal to the original single row. **No use case in this
   module wrote to `account_balances` at any point in the flow.**

This is the exit line (spec §11 Phase 6) proved end to end through the real
API and a real database: virtual allocations are kept separate from real
balances, and availability is recalculated from the live balance rather than
stored. It is not a substitute for seeing the same flow render correctly in
the actual `/finance/budgets` and `/finance/accounts` pages in a browser —
that remains owed (see below) — but it is a real proof of the underlying
invariant the exit line is about, run against production code paths and a
real Postgres instance, not an assertion taken on faith.

The script used for this (`src/modules/budgets/walkthrough.itest.ts`) was
temporary — written, run, and its actual pass/fail output recorded in the
Task 8 report, then deleted before this commit. It is not part of the
deliverable and was never committed.

**What remains owed:** an actual browser session against `/finance/budgets`
and `/finance/accounts` (or their production-copy rehearsal equivalents),
confirming the same flow renders correctly — the allocation row's "Available
in source" column, the category-scope multi-select UI, the manual-usage form,
and the "End" action on an allocation, none of which the API-level proof
above exercises. This should happen either as part of the actual deploy
rehearsal (per the runbook) or as a follow-up task before or shortly after
that deploy.

## Decisions and remaining scope

R6-1 admits `source_kind = 'none'` for an allocation with no real backing
account (the Holidays migration's monthly accrual). R6-2 represents a
recurring allocation as a stored range rather than a job-inserted row per
month. R6-3 re-derives scope-matched usage on every read/refresh and never
touches manual rows. R6-4 reconciles the vacation ledger's actual accrual
rows against what its rate alone would produce, inserting the difference as
a dated `once` allocation so history matches to the cent. See
`docs/superpowers/plans/2026-09-06-phase-6-budgets.md` for the full ruling
text and `docs/deploy/phase-6-runbook.md` for the operational facts (the
idempotency namespace change affecting the already-deployed Funds module,
the migration's deliberate double-migration guard, the validator's known
matching/coverage limitations, and which unusual counts are correct behaviour
rather than bugs) that came out of this phase's reviews.

No threshold alerts, no per-period rollover, and no budget sharing across
users — all explicitly out of scope for this phase (see the plan's "Scope
cut"); threshold alerts and their webhook are Phase 9 work. Budgets are
EUR-only in practice, as recorded above. `graphify update .` was run from the
repository root as part of this task (the only task in this phase's plan
instructed to do so); the regenerated `graphify-out/` is committed alongside
this checkpoint. No remote push was performed.
