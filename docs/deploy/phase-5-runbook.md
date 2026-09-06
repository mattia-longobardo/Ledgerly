# Phase 5 deployment runbook — Funds

Phase 5 builds on the deployed Phase 4 schema and replaces legacy fund pages,
calculations and payroll writes. Migration 0016 renames the legacy `funds`
table, so the old application must stop before schema migration begins.

## Verified starting point

Read-only production inspection on 2026-09-06 found migrations 0000–0015,
12 payroll imports and 12 payroll records. The Phase 4 checkpoint's earlier
undeployed status is historical; do not repeat its retired Paperless import.
Payroll Silo and Trek were connected; Wallet already reported an error.
No dashboard cron container was running. The Compose project shares other
applications: target `dashboard-app` explicitly in every service command.

The original app image is preserved as `dashboard:pre-phase5-20260906`
(`sha256:148d11c75c22cd1a803c482a777ef263725fe55f1396458c65d7234b9db6d50c`).

## Rehearsal and value checks

Restore a private custom-format production dump into a separate test database,
`dashboard_funds_rehearsal`, on `dashboard-postgres-test`. Integration tests
own `dashboard_test`; never run their reset helper against the rehearsal DB.
Apply the schema, run the fund migration twice, and run the validator. The
second migration must write nothing. Validate every historical month with
exact decimal arithmetic and compare linked account history with the legacy
monthly snapshot selection.

Expected production snapshot:

| Fund | Deposited through September 2026 | Latest value |
|---|---:|---:|
| Fideuram | 5000.00 EUR | 5174.54 EUR |
| Cometa | 2173.74 EUR | 2228.13 EUR |

Fideuram includes a 3000.00 opening adjustment and 2000.00 of actual deposits.
Cometa includes the 10.32 joining fee and three posted quarterly fees;
it has 2754.26 accrued gross; Q3 has not posted in September. Values sum
to 7402.67 EUR. There are nine canonical monthly valuations per fund,
January–September 2026.

Posting follows spec §7.4: March accrual posts in April. The legacy display
showed it in May. The validator must prove both the old display calculation
and the new posting calculation and explicitly report these intentional
historical timing differences. Current totals alone are insufficient.
Missing valuation accounts are created from existing actual snapshots;
ambiguous account names fail migration rather than choosing arbitrarily.
Snapshot-derived account provenance is stored in an audit event, including the
independently verified legacy snapshot key. Existing valued accounts can be
linked without legacy snapshots. Canonical histories remain checked after
editable account notes change.

## Cutover

1. Complete type checking, unit/integration tests, production build, OpenAPI
   drift check and the isolated data rehearsal. Build the new Docker image
   before downtime: `docker compose build dashboard-app`.
2. Stop `dashboard-app` with `docker compose stop dashboard-app`. If a
   dashboard cron has since started, stop that service too and record its
   prior state. Leave unrelated services running.
3. Take a final private database backup outside the temporary SDD workspace:

   ```bash
   umask 077
   mkdir -p "$HOME/backups/personal-dashboard/2026-09-06-phase5"
   docker exec postgres sh -c 'pg_dump -U "${POSTGRES_USER:-postgres}" -d dashboard -Fc' > "$HOME/backups/personal-dashboard/2026-09-06-phase5/pre-phase5-final.dump"
   ```

   Ensure the backup succeeded and its archive can be listed before proceeding.
   Do not commit database backups or credentials.
4. Run the new image's bundled scripts in order:

   ```bash
   docker compose run --rm --no-deps dashboard-app node /app/migrate.mjs
   docker compose run --rm --no-deps dashboard-app node /app/migrate-funds.mjs
   docker compose run --rm --no-deps dashboard-app node /app/validate-funds-migration.mjs
   ```

   These scripts execute with the container's configured database connection.
   The standalone image has no `tsx` migration runner. Stop on any failure.
5. Start only the app: `docker compose up -d --no-deps dashboard-app`.
   Wait for its health check. Restore a previously running dashboard scheduler
   only if one was stopped. Check health, sign-in redirection and API auth
   gating at `https://fin.longobardo.me`.
6. Check the authenticated Funds list, both values, Cometa's next posting month,
   and Home. Record whether this used real OIDC or an isolated local session.
   Run mutation walkthroughs on the rehearsal copy to avoid test entries in
   production: manual fund/plan/contribution, reversal, reconciliation, and
   payroll contribution posting. Preserve the distinction between browser
   checks and integration test evidence.

## Rollback

Keep the app stopped if migration or validation fails. Restore the final
backup into the production database using its administrative database role,
then retag the saved original image as `dashboard:latest` and start only
`dashboard-app` without rebuilding. A schema-only rollback is insufficient:
old and new applications write different fund tables. Restoring the final
backup also removes any post-cutover writes, so do this before reopening the
app after a failed cutover. Confirm health and the pre-cutover data totals.

The migration leaves legacy fund tables intact, but they are a migration
source, not a substitute for the complete pre-cutover database backup.
