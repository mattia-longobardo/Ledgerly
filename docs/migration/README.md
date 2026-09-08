# Migrations out of the legacy app — the record

**Nothing here is runnable.** Every migration script this directory used to
document (`migrate-teable`, `migrate-funds`, `migrate-vacation-budget`,
`migrate-paperless` and their validators) was deleted in migration `0018`'s
commit, together with the legacy tables they read: `payslips`,
`balance_snapshots`, `vacation_ledger`, `vacation_accrual_rate`, `leave_days`,
`legacy_funds`, `fund_deposits`, `fund_settings`. The owner's decision (Ruling
R7-5') is that legacy data is disposable and production is repopulated by hand,
so there is nothing left for these scripts to read and no reason to keep them.

This file stays as the record of what each migration did while it existed, so a
figure that looks odd in a historical month can be traced to the rule that
produced it. The scripts themselves are in git history; `npm run
migrate:credentials` (`scripts/import-file-credentials.ts`) is the only
migration script that survives, and it imports file-based Wallet/Trek tokens
into the encrypted credential store.

What outlived the scripts is their *output*: the reconciliation reports those
validators wrote, kept here as evidence. They hold real personal figures — see
the note at the bottom of this file.

## Teable → `accounts` + `account_balances`

Balances used to live in a Teable "Allocation" table the owner typed into by
hand and in a `balance_snapshots` cache the app filled from Wallet. The
accounts module replaced both.

- **Accounts** — one per hand-tracked account, fund and Wallet account. The
  Teable `TOTAL` and `Revolut` columns were skipped: both were sums of columns
  that were themselves imported, and Revolut came in as its three Wallet
  sub-accounts.
- **Balances** — a Teable cell for month `M` was stored `as_of` the last day of
  `M` with source `migration`; a Wallet snapshot `as_of` its Europe/Rome civil
  day with source `provider`, keeping the last reading of each day. An empty
  Teable cell was a gap, never a zero.

The planning half of that import is still live code and still unit-tested:
`dashboard-app/src/modules/accounts/infrastructure/teable-import.ts`. It is
kept because `src/lib/jobs/monthly-close.ts` imports `lastDayOfMonth` from it.

The validator computed net worth over 24 months twice on the same database —
the legacy way from `balance_snapshots`, the new way from `account_balances` —
and exited non-zero if any month differed by a cent. Its output is
[`teable-reconciliation.md`](./teable-reconciliation.md).

## Paperless → the payroll document store

The migration pulled the original PDF of every **verified** payslip out of
Paperless while the client and its token still existed, stored it in the
payroll document store, and created the matching `payroll_imports`,
`payroll_records` and `payroll_components` rows. Its validator diffed every
migrated record against its legacy `payslips` row — gross, net, taxes and both
Cometa halves, compared as decimal strings.

Rows in status `discovered`, `parsed`, `rejected` or `superseded` were
deliberately left behind: they were never confirmed by a person. They lived on
in the `payslips` archive until `0018` dropped it.

Output: [`paperless-reconciliation.md`](./paperless-reconciliation.md).

## Legacy funds and the vacation ledger

Phase 5 imported opening capital, contributions, schedules and plans out of
`legacy_funds`/`fund_deposits`/`fund_settings`. Phase 6 turned
`vacation_ledger` + `vacation_accrual_rate` into a budget named **Holidays**:
each accrual rate became an unsourced `monthly` allocation, each withdrawal a
manual usage, each adjustment a `once` allocation, and each month where the
ledger's own accrual rows differed from what the rate alone would produce
(Ruling R6-4) got a `once` reconciliation allocation for the difference — so
the balance series matched the legacy figures to the cent for every historical
month.

Both migrations were idempotent, keyed on event rows rather than on
user-editable fields. Both are gone; the funds and the Holidays budget they
produced are ordinary data now.

## Files in this directory

`teable-allocation-*.json` is a raw dump of the owner's balances and is
git-ignored. [`teable-reconciliation.md`](./teable-reconciliation.md) and
[`paperless-reconciliation.md`](./paperless-reconciliation.md) are committed
and hold real personal figures — they live here so they can be read next to
the export, but think before sharing them.
