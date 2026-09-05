# Teable migration

The dashboard's balances used to live in two places: a Teable "Allocation"
table the owner typed into by hand, and a `balance_snapshots` cache the app
filled from Wallet. The accounts module replaces both with `accounts` +
`account_balances`. Two scripts carry the history across and prove the result.

Both are one-off, hand-run migrations. Neither is wired into the entrypoint, and
neither is idempotent by accident: re-running them is safe and expected.

## Order of operations

1. **Export + import** — `npm run migrate:teable`
2. **Validate** — `npm run migrate:teable:validate`
3. **Only then**, deploy the release that removes the Teable integration.

Step 3 is irreversible in practice: once the legacy series is gone there is
nothing left to reconcile against, so it must not happen while step 2 still
reports a difference.

## `npm run migrate:teable`

Reads the Allocation table, writes a verbatim JSON snapshot of it to
`docs/migration/teable-allocation-<YYYY-MM-DD>.json`, then plans and inserts:

- **Accounts** — one per hand-tracked account, fund, and Wallet account. The
  Teable `TOTAL` and `Revolut` columns are skipped: both are sums of columns
  that are themselves imported, and Revolut is imported as its three Wallet
  sub-accounts instead.
- **Balances** — a Teable cell for month `M` is stored `as_of` the last day of
  `M` with source `migration`; a Wallet snapshot is stored `as_of` its
  Europe/Rome civil day with source `provider`, keeping the last reading of each
  day. An empty Teable cell is a gap, never a zero.

The plan itself is pure and unit-tested
(`dashboard-app/src/modules/accounts/infrastructure/teable-import.ts`); the
script only reads, plans, and writes.

It is idempotent. An account whose name already exists for the owner is reused
rather than duplicated (matched case-insensitively — the names are the Wallet
account names, so the provider sync adopts these accounts instead of creating
its own), and balances upsert on `(account, day, source)`.

Add `--dry-run` to read everything, write the JSON export and print the plan
without touching a single table:

```bash
npm run migrate:teable -- --dry-run
```

Requires `TEABLE_URL`, `TEABLE_TOKEN` and `DATABASE_URL`; it refuses to start
without them.

## `npm run migrate:teable:validate`

Computes net worth over the last 24 months twice on the same database — the
legacy way from `balance_snapshots`, the new way from `account_balances` —
prints a month-by-month table, writes `docs/migration/teable-reconciliation.md`,
and **exits 1 if any month differs by so much as a cent**. That exit code is the
gate on step 3.

## Files in this directory

`teable-allocation-*.json` is a raw dump of the owner's balances and is
git-ignored. `teable-reconciliation.md` holds his real monthly net worth as
well: it is written here so it can be read next to the export, but think before
committing it.

## Running against the deployed container

The image bundles both scripts next to `migrate.mjs`, so the runbook can reach
them without a checkout:

```bash
docker compose exec -e MIGRATION_OUT_DIR=/tmp/migration dashboard-app node /app/migrate-teable.mjs --dry-run
docker compose exec -e MIGRATION_OUT_DIR=/tmp/migration dashboard-app node /app/validate-teable.mjs
```

`MIGRATION_OUT_DIR` is required there: `docs/migration/` does not exist inside
the image, and the container's filesystem is read-only apart from the `/tmp`
tmpfs — so point it at `/tmp` and copy the files back out
(`docker compose cp dashboard-app:/tmp/migration ./docs/migration`) before the
container restarts and the tmpfs is lost.

## Paperless → payroll document store

`tsx scripts/migrate-paperless.ts` pulls the original PDF of every **verified**
payslip out of Paperless while the client and its token still exist, stores it
in the payroll document store, and creates the matching `payroll_imports`,
`payroll_records` and `payroll_components` rows. `npm run migrate:paperless:validate`
then diffs every migrated record against its legacy `payslips` row — gross, net,
taxes and both Cometa halves, compared as decimal strings — and exits non-zero on
any mismatch.

Both are one-shot and idempotent: a payslip whose bytes are already in the store
is reused rather than duplicated, and a second run rewrites the same figures.

**Order matters.** The migration must run on the image built at the commit that
adds it, *before* the Paperless client and its environment variables are removed
— see `docs/deploy/phase-4-runbook.md`, which prescribes the two waves. Rows in
status `discovered`, `parsed`, `rejected` or `superseded` are deliberately left
behind: they were never confirmed by a person, and the legacy `payslips` table
stays as the frozen archive holding them.

**The script does not survive wave 2.** The Paperless-removal commit deletes
`scripts/migrate-paperless.ts` along with its `migrate:paperless` npm alias —
it can never be re-run safely once the client it depends on is gone, so on
`main` today only `migrate:paperless:validate` still exists. The invocation
above only works on the wave-1 image, run directly with `tsx` rather than
through an npm script, since that alias no longer exists to run it through.

The run writes `docs/migration/paperless-reconciliation.md`, which is the record
that outlives the script.
