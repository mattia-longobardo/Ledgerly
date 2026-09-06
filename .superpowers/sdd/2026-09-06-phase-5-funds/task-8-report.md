# Task 8 report — legacy funds migration and independent validator

## Result

Implemented an idempotent, system-context-only funds migration and an independent
bigint-cents validator. Both scripts are bundled into the standalone image and
execute directly with Node. The frozen legacy tables are read only.

The migration:

- requires exactly one owner and exits 2 on zero/multiple owners;
- preserves existing funds, plans, schedules, accounts, links, and manual edits;
- creates the earliest nonzero initial-capital opening adjustment exactly once;
- migrates voluntary and split payroll rows with live ordinary-payroll links when
  present, including future quarter postings;
- creates one Cometa system fee per payroll posting plus one joining fee;
- links an unambiguous existing owner account, or creates the correct manual
  investment/pension account and imports one canonical snapshot per Rome month;
- uses the `monthlyHistoryQuery` precedence: non-`latest`, captured-at descending,
  id descending.

The validator independently rebuilds expected amounts from `legacy_funds`,
`fund_settings`, and `fund_deposits`. It imports no migration or funds calculation
helper. It verifies opening provenance, every deposit part, split sums, live
payroll links/nulls, periods, posted months, currency, fees, plans, schedules,
account ownership, and exact canonical valuation dates/values. It separately
proves the authoritative Cometa quarter-end +1 timeline and the old visible +2
timeline through the last future posting/visible month.

## RED

With the fixture loaded, `npm run migrate:funds` failed because the package alias
did not exist. After adding that alias and the initial migration, the real fixture
exposed an invalid snapshot timestamp conversion (`Invalid time value`); the
database driver returned the raw timestamp as a string. The implementation now
validates and converts that timestamp before deriving its Europe/Rome date.

Before the validator existed:

```text
npm run migrate:funds:validate
ERR_MODULE_NOT_FOUND: scripts/validate-funds-migration.ts
```

## GREEN — database fixture

Commands used the integration database only:

```text
npm run test:db:up
DATABASE_URL=postgresql://app_test:app_test@localhost:55432/dashboard_test npm run db:migrate
docker exec -i dashboard-postgres-test psql -U app_test -d dashboard_test -v ON_ERROR_STOP=1 < scripts/funds-migration-fixture.sql
```

The fixture has two funds, four effective settings, six deposits, a matched live
ordinary payroll record, split and unmatched payroll cases, one pre-existing
valuation account, one missing account, an unrelated account, and stale `latest`
plus tied corrected history rows.

First run and fixture assertion:

```json
{"funds":2,"fundLinks":2,"accounts":1,"accountBalances":2,"plans":4,"schedules":2,"contributions":14,"writes":27}
```

The assertions proved 2/4/6 frozen legacy rows remained, the opening used
`1000.00` rather than the later `9999.00`, January payroll linked to the live
record, September's unmatched payroll posted in October, three `-3.00` fees and
one `-10.32` fee existed, the stale `999.00` snapshot was not imported, and the
unrelated `42.00` account remained unchanged.

After changing the fund name, first plan amount, and account notes/version, the
immediate second run printed:

```json
{"funds":0,"fundLinks":0,"accounts":0,"accountBalances":0,"plans":0,"schedules":0,"contributions":0,"writes":0}
```

The rerun assertion proved all deliberate edits were preserved and no target row
count changed.

Validator result:

```text
CHECK fideuram: 3 legacy deposits, 2 canonical valuations, 4 migrated/system financial rows
TIMING cometa 2026-04-01: actual +1 116.68; legacy visible +2 100.00 (intentional)
TIMING cometa 2026-07-01: actual +1 173.68; legacy visible +2 116.68 (intentional)
TIMING cometa 2026-10-01: actual +1 260.68; legacy visible +2 173.68 (intentional)
CHECK cometa: 3 legacy deposits, 2 canonical valuations, 10 migrated/system financial rows
OK (2 funds, 20 months examined); 3 intentional Cometa monthly timing difference(s) proved
```

The 20 fund-months extend through October's future Q3 posting and November's old
visibility month, so a dropped future accrual cannot be hidden by September totals.

## Negative checks

- Deleting the future October employee row made validation fail:
  `fund_deposits#6 expected one row, found 0`.
- Changing the selected Cometa January valuation from `111.00` to the stale
  `999.00` made validation fail with the exact expected date/value mismatch.
- Adding a second owner made migration exit 2 with `Expected exactly one owner,
  found 2; refusing to guess`.
- Adding a second case-insensitive Fideuram account made migration exit 2 with an
  explicit ambiguous-name report.
- After each tamper, the fixture was restored; the future-row deletion was also
  repaired by rerunning migration, which reported exactly one write.

## Standalone bundle proof

Both files were bundled with the Dockerfile's esbuild flags and banner, producing
`migrate-funds.mjs` (448.1 KiB) and `validate-funds-migration.mjs` (451.5 KiB).
Running those actual `.mjs` files against the fixture produced the same 27-write
first run, zero-write second run, edit-preservation assertions, and 2-fund /
20-month validator result. This proves the Node entrypoints execute after bundling;
they do not depend on `tsx` or a `.ts` filename guard.

## Final verification

```text
npm run typecheck  # exit 0
npm test           # 137 files, 1,229 tests passed
git diff --check   # exit 0
```

No `*.itest.ts` file was added or changed. The executable SQL fixture exercises
the real Postgres schema under `dashboard_test`. The production-data rehearsal is
intentionally left to the root deployment controller against the protected
`dashboard_funds_rehearsal` clone.
