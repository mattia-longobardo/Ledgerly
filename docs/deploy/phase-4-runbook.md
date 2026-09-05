# Phase 4 deployment runbook — Payroll upload pipeline and Company

Phase 4 deploys in **two waves**. Wave 1 carries the migration and still has
Paperless; wave 2 removes Paperless. Running them out of order loses the twelve
original payslips, because the client that downloads them is deleted in wave 2.

**Phase 4 is not deployable standalone.** Neither Phase 2 nor Phase 3 has been
deployed yet, and Phase 4 stacks on both. Deploy in this order:

1. **Phase 2 first** (`docs/deploy/phase-2-runbook.md`), end to end. Its two
   hard prerequisites: `APP_ENCRYPTION_KEY` generated and set in `.env` before
   the new image boots, and the file-mounted Wallet/Trek credentials imported
   exactly once via `scripts/import-file-credentials.ts`.
2. **Phase 2's §9 manual browser walkthrough**, which is still owed as of the
   Phase 3 checkpoint and has never been run.
3. **Then Phase 3** (`docs/deploy/phase-3-runbook.md`).
4. **Only then Phase 4** — the two waves below.

## 1. Pre-checks

- Confirm Phases 2 and 3 are deployed and Phase 2's §9 walkthrough has been run
  at least once (`docs/deploy/phase-2-runbook.md`, `docs/deploy/phase-3-runbook.md`).
  Phase 4 stacks on both.
- Back up the database: `pg_dump dashboard > backup-pre-phase4-$(date +%F).sql`.
- Decide the document store. The default is the existing `silo` container in the
  `db` stack. Have its endpoint, bucket, access key id and secret access key to
  hand — they are entered in the app, not in `.env`.
- **`DOCUMENT_STORE_DRIVER=local` is not usable in production.** The
  `dashboard-app` container runs `read_only: true` with tmpfs on `/tmp` only, so
  a local store would either refuse to write or lose every original on restart.
  The resolver refuses it outright when `NODE_ENV=production`.

## 2. Wave 1 — deploy the migration image

1. Build and deploy the image at the commit titled
   `feat(payroll): add the Paperless migration and validation scripts`. It adds
   migration `0015_payroll.sql` and **keeps** `PAPERLESS_URL`/`PAPERLESS_TOKEN`,
   so `docker-compose.yml` needs no change yet. The entrypoint applies the
   migration on boot.
2. Sign in and go to **Settings › Integrations › Payroll document store**.
   Enter the endpoint, bucket, region and credentials and press Test. The test
   writes, reads and deletes a probe object; a green result means the credential
   can actually store a payslip, not merely reach the bucket.
3. Run the migration from inside the container, with the silo credentials in the
   environment for this one run. The container is `read_only: true` with tmpfs
   only on `/tmp` and `/app/.next/cache`, and the script's default `--out`
   directory (`docs/migration/`, relative to the repo root) does not exist
   inside the image — every database write for the run would already have
   committed by the time a default-path write hit `EROFS`, so always pass
   `--out /tmp/migration` explicitly:
   ```bash
   docker compose exec dashboard-app sh -lc '
     SILO_ENDPOINT=… SILO_BUCKET=… SILO_ACCESS_KEY_ID=… SILO_SECRET_ACCESS_KEY=… \
     npm run migrate:paperless -- --dry-run --out /tmp/migration
   '
   ```
   Read the printed counts, then drop `--dry-run` and re-run the same command
   (still with `--out /tmp/migration`) to write for real. `npm run
   migrate:paperless` only exists on this wave-1 image — wave 2 deletes both the
   script and the npm alias, so this step cannot be repeated after wave 2.
   Copy the report out of the container before it restarts and the tmpfs is
   lost:
   ```bash
   docker compose cp dashboard-app:/tmp/migration ./docs/migration
   ```
4. Run the validation: `npm run migrate:paperless:validate`. It exits non-zero on
   any mismatch between a verified legacy `payslips` row and its migrated
   `payroll_records` row, comparing decimal strings rather than numbers; it also
   fails if it examines zero legacy payslips, and its success message states how
   many it verified.
5. Read `docs/migration/paperless-reconciliation.md` (copied out of the
   container in step 3). It is the record that survives wave 2, because wave 2
   deletes the migration script.
6. Visit `/company/earnings` and confirm the twelve migrated months are there
   with the same figures the old Work page showed.

**Do not continue to wave 2 until steps 3–6 have all passed.**

## 3. Wave 2 — deploy the removal image

1. Build and deploy the image at the commit titled
   `refactor: retire Paperless, its client, its routes and its environment`.
2. Edit `docker-compose.yml`: remove `PAPERLESS_URL` and `PAPERLESS_TOKEN` from
   the `dashboard-app` service, and optionally add
   `DOCUMENT_STORE_DRIVER=${DASHBOARD_DOCUMENT_STORE_DRIVER:-silo}` and
   `MALWARE_SCANNER=${DASHBOARD_MALWARE_SCANNER:-none}`. Both have defaults, so
   neither is required.
3. Remove `PAPERLESS_HOST` and `DASHBOARD_PAPERLESS_TOKEN` from `.env`.
4. `docker compose up -d dashboard-app` and confirm `/api/health` returns 200.

Note the asymmetry: the wave-2 image **cannot** boot with the old variables
missing *before* it is deployed, and the wave-1 image **cannot** boot with them
removed. Change the image first, then the variables.

## 4. Verify

1. `curl -s https://$DASHBOARD_HOST/api/v1/openapi.json | jq '.paths | keys' | grep payroll`
   — confirms the eleven `/payroll/*` routes are live.
2. Sign in and visit `/company`, `/company/earnings`, `/company/time-off` and
   `/company/payroll`. `/work` must 404.
3. Upload a payslip PDF from `/company/payroll`. Within the hour (or after
   triggering the hourly tick by hand) it should move `scanning → extracting →
   needs_review` and appear at the top of the imports list.
4. Open it, confirm the figures, press **Apply**, and confirm the month appears
   on `/company/earnings` with the same net.
5. Upload the *same* file again and confirm the app says it is already there
   rather than creating a second import.
6. Confirm the Settings › Administration Scheduled-jobs panel lists
   `payroll_ingest` and `payroll_retention`, both `success`.

## 5. Scanning

`MALWARE_SCANNER` defaults to `none` (spec §13.3): the boundary exists and
records `scanner: "none"` on every import it clears, so "nothing scanned this"
is a fact on the row rather than an assumption. To enable clamd, add a clamd
container reachable on the app's network and set `MALWARE_SCANNER=clamd`,
`CLAMD_HOST` and `CLAMD_PORT`. A clamd that is down does **not** reject uploads:
the import parks in `scanning` with `scan_unavailable` and the hourly job retries
it, so a scanner outage delays payslips rather than losing them.

## 6. Retention

Originals are purged ten years after upload (spec §13.5), configurable by setting
`payroll_retention_years` in `app_settings`. The daily `payroll_retention` job
deletes at most 100 objects a run and never touches a row, a payroll record, or
an import in a live status — so a misconfigured window gives a human a day to
notice. Purging is one-way; there is no undelete.

## 7. Rollback

Migration `0015_payroll.sql` is additive: no existing table or column changes.

- **From wave 2 back to wave 1:** revert the image tag *and* put
  `PAPERLESS_URL`/`PAPERLESS_TOKEN` back in `docker-compose.yml`, or the older
  image will refuse to boot.
- **From wave 1 back to Phase 3:** revert the image tag. The four new tables are
  simply unused by the older image. Objects already written to the silo stay
  there; re-running wave 1 later reuses them by sha256 rather than duplicating.
