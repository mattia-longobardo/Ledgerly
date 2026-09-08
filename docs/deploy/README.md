# Deploying

One document for every release. It replaces the six per-phase runbooks
(`phase-1-runbook.md` … `phase-6-runbook.md`), which were deleted once the
rebuild finished: each described a one-off cutover with its own data migration,
and none of them describes how to ship the next change. Their content — the
Phase 2 credential import, the Teable retirement, the funds and vacation
migrations, the Phase 6 deployment record — is in git history, reachable with
`git log --diff-filter=D -- docs/deploy/`.

The procedure below is the same for every release. Anything specific to one
release goes in **[Release notes](#release-notes)** at the bottom, newest
first, and is deleted once it has been deployed and a checkpoint records it.

## The stack

`docker-compose.yml` at the repository root, two services:

- **`dashboard-app`** — image `dashboard:latest`, built from `./dashboard-app`.
  Read-only root filesystem, all capabilities dropped, 512 MB / 1 CPU, behind
  Traefik on `proxy_public`, reaching Postgres on `db_internal`. Its
  `entrypoint.sh` **applies Drizzle migrations at boot** (`node /app/migrate.mjs`)
  and then starts the Next.js standalone server. Health: `GET /api/health`.
- **`dashboard-cron`** — a supercronic sidecar that posts to
  `/api/jobs/tick?tier=…` on three schedules (`cron/crontab`), authenticated
  with `X-Cron-Secret`. It waits for `dashboard-app` to be healthy.

Postgres 18 runs in a shared `postgres` container; the application connects as
the `dashboard` role to the `dashboard` database.

## Standing procedure

Run every step, in order, from a clean checkout of the commit being deployed.

### 1. Green gate

From `dashboard-app/`:

```bash
npm run typecheck && npm test \
  && npm run test:db:up && npm run test:integration \
  && npm run build \
  && npm run openapi:generate && git diff --exit-code docs/api/openapi.json
```

All of it passes before an image is built. Nothing below is worth doing on a
tree whose tests do not pass.

### 2. Check the database role is `NOSUPERUSER`

Row-level security is the tenancy boundary, and **a superuser bypasses even
`FORCE ROW LEVEL SECURITY`**. If the application's role is a superuser, every
policy in the schema is decoration.

```bash
docker exec postgres psql -U postgres -d dashboard \
  -c "SELECT rolname, rolsuper, rolbypassrls FROM pg_roles WHERE rolname = 'dashboard'"
```

`rolsuper` and `rolbypassrls` must both be `f`. If either is `t`, fix it
(`ALTER ROLE dashboard NOSUPERUSER NOBYPASSRLS`) before deploying — this has
never been verified against production from inside this repository, so treat
the first check as a real one, not a formality.

### 3. Build the image before any downtime

```bash
docker compose build dashboard-app
```

### 4. Stop the app, leave everything else running

```bash
docker compose stop dashboard-cron dashboard-app
```

Stopping the sidecar first means no tick can fire against a half-migrated
schema.

### 5. Back up

Always, including for an additive migration. The dump is the entire rollback
plan.

```bash
umask 077
mkdir -p "$HOME/backups/personal-dashboard/$(date +%F)"
docker exec postgres sh -c 'pg_dump -U "${POSTGRES_USER:-postgres}" -d dashboard -Fc' \
  > "$HOME/backups/personal-dashboard/$(date +%F)/pre-deploy.dump"
pg_restore --list "$HOME/backups/personal-dashboard/$(date +%F)/pre-deploy.dump" | head
```

Do not go further until `pg_restore --list` prints a table of contents. Take
it with the app already stopped, so nothing is written between the dump and the
migration.

### 6. Migrate

```bash
docker compose run --rm --no-deps dashboard-app node /app/migrate.mjs
```

(`npm run db:migrate` is the equivalent from a source checkout; the deployed
image carries no `tsx` runtime.) The entrypoint would apply the same migrations
on start — running them explicitly here means a failure surfaces before the
app is up rather than in a crash loop.

### 7. Start

```bash
docker compose up -d --no-deps dashboard-app
docker compose up -d --no-deps dashboard-cron
```

Wait for `docker compose ps` to show `dashboard-app` healthy — up to about a
minute.

### 8. Verify

1. `curl -fsS https://<host>/api/health`.
2. Sign in and open **Settings › Administration**. The scheduled-jobs panel
   lists every registered job and its recent runs; confirm nothing is in
   `failed` and that the tiers are ticking (the hourly tier runs at `:07`).
3. Open the sections this release touched and confirm they render for a
   signed-in user. The automated suites never sign in — the browser walkthrough
   is the deploy's job.
4. Optionally run the API smoke against the deployment with a personal access
   token: see `dashboard-app/tests/e2e/README.md`. **It writes rows**, so do it
   against a rehearsal copy unless you are willing to delete the account,
   budget and fund it leaves behind.

## Rollback

There is no partial rollback. Restore the pre-deploy dump **and** revert the
image together:

```bash
docker compose stop dashboard-cron dashboard-app
docker exec -i postgres pg_restore -U postgres -d dashboard --clean --if-exists \
  < "$HOME/backups/personal-dashboard/<date>/pre-deploy.dump"
# retag the previous image back to dashboard:latest, then:
docker compose up -d --no-deps dashboard-app dashboard-cron
```

Restoring discards every write made after the dump. The new code expects the
new schema and the old code does not know about it, so reverting one without
the other leaves a broken deployment either way.

## Environment

Validated at boot by `dashboard-app/src/lib/env.ts`; the process refuses to
start if a required variable is missing or malformed. Compose always defines a
listed variable, so "unset" arrives as `""` — several entries are
blank-tolerant for exactly that reason.

### Required

| Variable | Shape | What it is |
|---|---|---|
| `DATABASE_URL` | connection string | Postgres, as the non-superuser `dashboard` role |
| `AUTH_URL` | URL | The app's own public origin |
| `AUTH_SECRET` | ≥ 32 chars | Auth.js JWT signing secret |
| `OIDC_ISSUER` | URL | Authentik issuer, e.g. `https://<authentik>/application/o/dashboard/` |
| `OIDC_CLIENT_ID` | string | Authentik client |
| `OIDC_CLIENT_SECRET` | string | Authentik client secret |
| `AUTHORIZED_SUB` | string | The bootstrap owner's OIDC subject. Read only while the `users` table is empty; after that the table governs access |
| `APP_ENCRYPTION_KEY` | `keyId:base64key[,…]` | Integration credential encryption, active key first. **Losing it makes every stored credential unreadable** |
| `CRON_SECRET` | ≥ 16 chars | `X-Cron-Secret` on `/api/jobs/*`; shared with the cron sidecar |
| `WEBHOOK_SECRET` | ≥ 16 chars | Fallback HMAC secret for inbound webhooks |

### Optional, with defaults

| Variable | Default | What it does |
|---|---|---|
| `NODE_ENV` | `production` | |
| `TZ` | `Europe/Rome` | Also the cron sidecar's timezone |
| `AUTHORIZED_EMAIL` | — | Email stamped on the bootstrapped owner |
| `WALLET_API_URL` | BudgetBakers production | Wallet API base |
| `DOCUMENT_STORE_DRIVER` | `silo` | Where payslip originals live. `silo` reads endpoint, bucket and credentials from the `payroll_silo` connection — no secret in the environment. `local` is a development driver only: the production container is read-only |
| `DOCUMENT_STORE_LOCAL_PATH` | — | Only with `local` |
| `MALWARE_SCANNER` | `none` | `none` records `scanner: "none"` on every import it clears; `clamd` needs a reachable daemon |
| `CLAMD_HOST` / `CLAMD_PORT` | `clamav` / `3310` | Only with `clamd` |
| `GOTIFY_URL` / `GOTIFY_TOKEN` | — | Job-failure alerts |
| `OPENAI_API_KEY` / `OPENAI_BASE_URL` / `LLM_MODEL` | — / — / `gpt-4.1-mini` | The payslip extraction pass. With no key the pass is skipped and the deterministic rules stand alone. Settings › "Payslip AI" overrides these per field at runtime |
| `HEARTBEAT_FILE` | `/tmp/dashboard-sweep-heartbeat` | Written by `sweep` |
| `SNAPSHOT_GRACE_DAYS` | `3` | Staleness threshold for balances |
| `HOURS_PER_DAY` | `8` | Default working day, seeded onto new time-off types |

## Job tiers

`src/platform/jobs/register-all.ts` is the list; `cron/crontab` is the
schedule. A failing job does not stop the others in its tier, and each run
lands in `job_runs` with its own status and detail — the Administration page
reads exactly that.

| Tier | When | Jobs |
|---|---|---|
| hourly | `:07` | `sweep`, `trek_sync`, `wallet_transactions_sync`, `sync_queue`, `payroll_ingest` |
| daily | 12:00 local | `wallet_accounts_sync`, `interest_accrual`, `payroll_retention`, `housekeeping` |
| monthly | 23:59 on the 1st | `monthly_close` |

`housekeeping` is the retention sweep: audit events older than 730 days, job /
sync / webhook history older than 90, expired idempotency keys, stale rate-limit
windows — at most 5,000 rows per table per run, counted in `job_runs.detail`.
It never touches domain data.

Every job takes a session-level advisory lock (`withJobLock`) so two ticks
cannot run the same job concurrently; the second returns immediately rather
than queueing.

## Release notes

### Phases 7–9 (Time off, personal access tokens, hardening) — not yet deployed

The production deployment is still the Phase 6 image. This release carries
migrations `0018` and `0019`.

**`0018` is destructive and irreversible.** It creates `timeoff_types`,
`timeoff_balances` and `timeoff_events`, and **drops eight tables**:
`fund_deposits`, `fund_settings`, `legacy_funds`, `payslips`,
`vacation_ledger`, `vacation_accrual_rate`, `leave_days`, `balance_snapshots`.
No data is migrated out of them first — the owner's decision is that this data
is disposable (Ruling R7-5'). There is no down migration and no partial
rollback: **the dump from step 5 is the only way back**. Take it even though
the data is disposable, and keep it until the repopulation below is done and
checked.

**After deploying, the owner must repopulate by hand:**

1. Re-upload the payslips that matter through **Company › Payroll**. Applying
   an import is what writes `timeoff_balances`, so time-off balances stay `—`
   until at least one payslip is applied.
2. Re-enter booked time off on **Company › Time off** (or let the Trek sync
   pull it, if Trek holds it).
3. If the **Holidays** budget came from the Phase 6 vacation migration, check
   it survived — `0018` drops the legacy vacation tables the migration read
   *from*, not the budget it wrote; but if the budget was itself never created,
   it must be re-created by hand, because the migration script no longer
   exists.

**`0019` is additive**: it creates `personal_access_tokens` only.

Also in this release, and worth knowing before the first tick after cutover:

- `wallet_refresh` is retired. It is gone from the job registry, the admin
  panel and `/api/jobs/`; nothing schedules it and `cron/crontab` never named
  it directly.
- `housekeeping` is new and daily. Its **first** run will delete the whole
  backlog of expired idempotency keys and old rate-limit windows, capped at
  5,000 rows per table — a backlog larger than that simply drains over the
  following days. Check its `job_runs.detail` on the Administration page after
  the first daily tick.
- Inbound webhooks now refuse a replayed `(connection, payload_hash)` within 24
  hours and rate-limit each connection to 60 deliveries a minute. A provider
  that legitimately re-sends the identical body gets `202` with `queued: 0`.
- The API accepts `Authorization: Bearer pat_…`. Mint tokens at
  **Settings › Security**; they are shown once. `/security/tokens` is
  session-only, so a token cannot mint or revoke another.
- The migration scripts and their validators (`migrate-*`, `validate-*`) were
  deleted along with the legacy tables, and their esbuild steps are out of the
  `Dockerfile`. `scripts/import-file-credentials.ts` (`npm run
  migrate:credentials`) stays.
