# Phase 1 deployment runbook — accounts and Teable retirement

This is the exact, copy-pasteable sequence for shipping Phase 1: the
`accounts` module, the Wallet adapter, the Teable → Postgres migration, and
migration `0007_retire_teable` which drops the legacy tables. Read it
end-to-end once before running anything — the ordering matters and is not
obvious from the individual scripts.

Run every command from the repository root
(`/home/mattia/docker/projects/personal-dashboard`) unless noted otherwise.
All of it targets the production stack; there is no staging environment.

## Why the migrations are split into two waves

`dashboard-app/drizzle/` ships migrations `0004`–`0007` in this deploy.
`0004`–`0006` are purely additive (new tables: identity, platform,
accounts). `0007_retire_teable` **drops** `tracked_accounts`,
`monthly_snapshots`, the `balance_snapshots_source_ck` check, and
`funds.teable_column` — it is the point of no return, because the code that
reads those tables (the pre-Phase-1 app, and the migration/validation
scripts' legacy comparison) stops working the moment they are gone.

The image being deployed here (`dashboard:latest`, built from the current
checkout) contains all four migrations at once, and `entrypoint.sh` runs
`node /app/migrate.mjs` on every boot, which applies *every* pending
migration in one pass — there is no flag to stop it partway. To get the
safety property the spec calls for (§10.1: "migrations are additive until
Phase 1 is accepted; the old tables stay until a later drop"), this runbook
applies `0004`–`0006` by hand first, with `0007` temporarily hidden from the
migrator's journal, runs the Teable import and validation against that
schema, and only lets the image's normal boot apply `0007` once validation
is clean. **If validation fails, the running production database still has
the pre-Phase-1 tables intact and the previous image can be redeployed with
zero data loss.**

The alternative considered — making `migrate.mjs` accept a "stop before"
argument, or hand-writing the `0004`–`0006` SQL via `psql` and manually
seeding drizzle's internal migrations-tracking table — was rejected: hiding
one journal entry from Drizzle's own migrator and letting Drizzle apply and
record the rest itself is less error-prone than re-deriving its tracking-row
hashes by hand, and it needs no change to the shipped scripts. Separately,
`scripts/migrate-teable.ts` (`migrate-teable.mjs` in the image) turned out to
already be tolerant of `0007`: it reads `funds.slug`/`funds.name` and
`balance_snapshots` (source `wallet`), never `tracked_accounts` or
`funds.teable_column`, and the hand-tracked columns come from the JSON export
itself, not a live registry table. So the two-wave split below exists purely
for **rollback safety while validating**, not because the import script would
otherwise fail — but it is still required for that reason.

## Pre-checks

1. **Note the current Home net-worth total.** Open the dashboard in a
   browser, go to Home, and write down the total shown on the net-worth card
   (and the date). This is the number step 8 below must reproduce.

2. **Back up the database:**

   ```bash
   set -a; source /home/mattia/docker/db/.env; set +a   # for DB_USERNAME
   docker exec postgres pg_dump -U "$DB_USERNAME" dashboard \
     > "backup-$(date +%F).sql"
   ```

3. **Load the app's own secrets** (needed by the one-off containers below):

   ```bash
   set -a; source .env; set +a   # DB_DASHBOARD_PASSWORD, DASHBOARD_AUTHORIZED_SUB, ...
   export DATABASE_URL="postgresql://dashboard:${DB_DASHBOARD_PASSWORD}@postgres:5432/dashboard"
   ```

4. **Preserve the currently-running image for rollback**, since the build in
   step 5 overwrites the `dashboard:latest` tag:

   ```bash
   docker tag dashboard:latest dashboard:pre-phase1
   ```

## Step 1 — build the new image

```bash
docker compose build dashboard-app
```

This produces the new `dashboard:latest`, containing migrations
`0004`–`0007`, `migrate.mjs`, `migrate-teable.mjs`, and `validate-teable.mjs`
(see `dashboard-app/Dockerfile`). It does **not** touch the running
containers.

## Step 2 — apply migrations 0004–0006 only

Extract the image's journal and drop the `0007_retire_teable` entry from a
copy of it:

```bash
docker create --name dashboard-extract dashboard:latest >/dev/null
docker cp dashboard-extract:/app/drizzle/meta/_journal.json ./journal-full.json
docker rm dashboard-extract >/dev/null

node -e "
const fs = require('fs');
const j = JSON.parse(fs.readFileSync('./journal-full.json', 'utf8'));
j.entries = j.entries.filter((e) => e.tag !== '0007_retire_teable');
fs.writeFileSync('./journal-0006.json', JSON.stringify(j, null, 2));
"
```

Stop the currently-running app (brief downtime starts here) and apply
`0004`–`0006` with the trimmed journal mounted over the image's own copy:

```bash
docker compose stop dashboard-app dashboard-cron

docker run --rm --network db_internal \
  -e DATABASE_URL="$DATABASE_URL" \
  -e AUTHORIZED_SUB="$DASHBOARD_AUTHORIZED_SUB" \
  -v "$(pwd)/journal-0006.json:/app/drizzle/meta/_journal.json:ro" \
  dashboard:latest node /app/migrate.mjs
```

This creates `accounts`, `account_groups`, `account_balances`,
`provider_links`, the identity tables, `idempotency_keys`,
`rate_limit_windows`, seeds the `funds` registry, and bootstraps the owner
row from `AUTHORIZED_SUB` (idempotent — a no-op if the owner already exists).
`0000`–`0003` are already applied and are no-ops here. `0007` is **not**
applied yet: `tracked_accounts`, `monthly_snapshots`,
`balance_snapshots_source_ck` and `funds.teable_column` are all still there.

Clean up the scratch files:

```bash
rm -f journal-full.json journal-0006.json
```

**Rehearsal finding (2026-09-03):** the migrator's fund-registry seed used a
single `INSERT ... ON CONFLICT DO UPDATE`, and Postgres checks `NOT NULL` on
the proposed row before it resolves the conflict. In this two-wave window
`funds.teable_column NOT NULL` still exists, so the seed crashed after
`0004`–`0006` had committed and before the owner row was bootstrapped. The
seed is now update-then-insert (`src/lib/db/migrate.ts`); if you see
`null value in column "teable_column"` here, you are running an image built
before commit `33bf33b`. Rehearse this step on a restored dump before running
it against production.

## Step 3 — import the legacy history

`scripts/migrate-teable.ts` (`migrate-teable.mjs` in the image) builds its
own database client straight from `DATABASE_URL` — it deliberately does not
import the app's shared `db` module, which would pull in the full
`env()` validation (`AUTH_*`, `OIDC_*`, `PAPERLESS_*`, `CRON_SECRET`, ...).
The only environment this script needs is `DATABASE_URL`, `MIGRATION_OUT_DIR`,
and (live-fetch only) `TEABLE_URL`/`TEABLE_TOKEN` — nothing else from the
app's own configuration is required or read.

`docs/migration/` does not exist inside the image, so mount it directly as
the script's output (and input, for `--from`) directory:

```bash
mkdir -p docs/migration

# Preferred: replay a JSON export already captured earlier (docs/migration/
# is git-ignored, so check locally for teable-allocation-*.json first).
docker run --rm --network db_internal \
  -e DATABASE_URL="$DATABASE_URL" \
  -e MIGRATION_OUT_DIR=/out \
  -v "$(pwd)/docs/migration:/out" \
  dashboard:latest node /app/migrate-teable.mjs --from /out/teable-allocation-<DATE>.json

# Fallback: live read from Teable itself. TEABLE_URL/TEABLE_TOKEN are no
# longer part of the app's own environment (they were removed with the
# client), so pass them explicitly for this one-off run only.
docker run --rm --network db_internal \
  -e DATABASE_URL="$DATABASE_URL" \
  -e MIGRATION_OUT_DIR=/out \
  -e TEABLE_URL="https://<teable-host>" \
  -e TEABLE_TOKEN="<teable-token>" \
  -v "$(pwd)/docs/migration:/out" \
  dashboard:latest node /app/migrate-teable.mjs
```

Either way this is idempotent: accounts are matched by name (reused, not
duplicated) and balances upsert on `(account, day, source)` — re-running it is
safe. It prints a plan (accounts created/reused, balances written, skipped
keys) and, in live mode, writes the JSON snapshot to
`docs/migration/teable-allocation-<date>.json`.

## Step 4 — validate

Same story as step 3: `scripts/validate-teable-migration.ts`
(`validate-teable.mjs`) builds its own client from `DATABASE_URL` alone and
needs no other application environment variable.

```bash
docker run --rm --network db_internal \
  -e DATABASE_URL="$DATABASE_URL" \
  -e MIGRATION_OUT_DIR=/out \
  -v "$(pwd)/docs/migration:/out" \
  dashboard:latest node /app/validate-teable.mjs
echo "exit code: $?"
```

This recomputes 24 months of net worth twice — once from the legacy
`balance_snapshots`, once from the new `account_balances` — and writes
`docs/migration/teable-reconciliation.md`. Every differing month carries a
note: two kinds of difference are expected by construction and do not fail
the run — a month where the legacy sweep cached an *empty* hand-tracked
Teable cell as `0.00` (the migrated series carries the previous value forward
instead, as the spec requires and as the legacy headline already did), and the
current month (see below). Any month marked `DEFECT` makes the script exit
`1`; **do not proceed past a nonzero exit code.**

Rehearsal on 2026-09-03 also found that a cell of the *current* month was
pinned to the month's last day, a date in the future that would have
outranked live provider readings until the next month. The import now pins a
cell to `min(last day of its month, today)`.

Inspect the report:

```bash
cat docs/migration/teable-reconciliation.md
```

**One expected, investigate-don't-ignore case:** for a month where the import
wrote *both* a `migration`-sourced row (a Teable cell, pinned to that month's
last calendar day) and a `provider`-sourced row (a cached Wallet snapshot,
dated its actual civil day) — which happens for any month Wallet was already
being tracked before the cutover — the migrated series
(`account_balances`, via `monthlySeries` in
`src/modules/accounts/domain/net-worth.ts`) keeps only the row with the
latest `(as_of, captured_at)` for that month: the later calendar day wins, and
on an exact same-day tie the row captured later in the day wins. The legacy
series (`balance_snapshots`, computed by `legacySeriesFromSnapshots` in
`scripts/validate-teable-migration.ts`) has its own, separate rule for its
own most recent month: it always overrides that month with the *newest*
snapshot regardless of day. The two rules agree in the common case but are
not the same rule, so a month where both a migration- and a provider-sourced
balance exist — in practice, the most recent one or two months before the
cutover — can legitimately show a difference. A mismatch anywhere else (an
older, closed month with only one source) is a real defect and must be
root-caused before continuing — do not redeploy over it.

## Step 5 — deploy (applies migration 0007)

Only once the report is clean (or the single expected current-month case is
understood and accepted):

```bash
docker compose up -d --force-recreate dashboard-app dashboard-cron
```

`--force-recreate` is load-bearing for the sidecar: the crontab is a bind
mount, so Compose sees no change to `dashboard-cron` and would leave the
running container alone — and supercronic reads `/etc/crontab` once, at
start. Without the flag the sidecar keeps running the schedules it was
started with. Confirm the new ones took with the log check in step 6.

This starts the container from the unmodified image: `entrypoint.sh` runs
the real `/app/migrate.mjs` with its own, untouched journal. `0000`–`0006`
are already recorded (by hash) from step 2 and are skipped; only `0007`
applies, dropping `tracked_accounts`, `monthly_snapshots`, the
`balance_snapshots_source_ck` check, and `funds.teable_column`. Then the
Next.js server starts.

Wait for the healthcheck:

```bash
docker compose ps dashboard-app   # wait for "healthy"
```

## Step 6 — reconcile provider balances and verify

Trigger a Wallet sync immediately rather than waiting for the daily tick:

```bash
curl -X POST "https://$DASHBOARD_HOST/api/v1/integrations/wallet/sync" \
  -H "Cookie: __Host-authjs.session-token=<your session cookie>" \
  -H "X-Requested-With: curl"
```

`X-Requested-With` is required on every cookie-authenticated write (spec
§8.3); without it the call answers `403 csrf_required`. The value is not
checked — only its presence.

Sign in via the browser first and copy the `__Host-authjs.session-token`
cookie; the endpoint is the owner's alone (it requires `integrations.manage`
*and* the `owner` role) and there is no machine-auth path for it in Phase 1. No `Idempotency-Key` header is needed:
only `POST /accounts` and `POST /accounts/{id}/balances` require one (see
`registerAccountRoutes` in `src/modules/accounts/api/routes.ts`) — the wallet
sync route isn't wrapped with that middleware. Or just wait —
`wallet_accounts_sync` runs daily at local noon via the `dashboard-cron`
sidecar (see the three tick schedules below).

Then:

1. Open the dashboard's Home page and compare the net-worth total against
   the figure noted in the pre-checks. It should match, modulo the
   current-month caveat above and whatever the Wallet sync above just moved.
2. Confirm the three tick schedules are wired (`cron/crontab`, mounted
   read-only into `dashboard-cron`):
   - **hourly**, at `:07` — `tier=hourly` (sweep, Trek sync)
   - **daily**, at local noon (`0 12 * * *`) — `tier=daily` (Wallet refresh,
     `wallet_accounts_sync`)
   - **monthly**, `59 23 1 * *` — `tier=monthly` (`monthly_close`)

   ```bash
   docker compose logs dashboard-cron --tail 50
   docker exec dashboard-cron pgrep supercronic   # sidecar is alive
   ```
3. `docker exec dashboard-app node -e "require('http').get('http://localhost:3000/api/health', r => r.on('data', d => process.stdout.write(d)))"`
   or simply `curl https://$DASHBOARD_HOST/api/health` — expect `"status":"ok"`.

## Rollback

**Before step 5 (0007 not yet applied):** the running database only has the
additive `0004`–`0006` changes, which the old app image ignores entirely (it
never queries `accounts`/`account_balances`/etc.). Just redeploy the previous
image:

```bash
docker tag dashboard:pre-phase1 dashboard:latest
docker compose up -d --force-recreate dashboard-app dashboard-cron
```

No data is lost; the imported accounts/balances stay in the database, unused
by the old code, and can be picked up again on the next attempt.

**After step 5 (0007 already applied):** the old image's code depends on
`tracked_accounts`, `monthly_snapshots` and `funds.teable_column`, which are
now gone — redeploying it will break immediately. Restore from the backup
taken in the pre-checks instead, then redeploy the old image:

```bash
docker compose stop dashboard-app dashboard-cron
set -a; source /home/mattia/docker/db/.env; set +a
docker exec -i postgres psql -U "$DB_USERNAME" -d dashboard -c "DROP SCHEMA public CASCADE; CREATE SCHEMA public;"
docker exec -i postgres psql -U "$DB_USERNAME" -d dashboard < "backup-<DATE>.sql"
docker tag dashboard:pre-phase1 dashboard:latest
docker compose up -d --force-recreate dashboard-app dashboard-cron
```

Treat this as a last resort — it discards everything written since the
backup, including anything unrelated to this migration.

## Cleanup after a successful deploy

- `docker rmi dashboard:pre-phase1` once the deploy has been running cleanly
  for a while and rollback is no longer a realistic option.
- `docs/migration/teable-allocation-*.json` is git-ignored (real balances) —
  keep it locally as long as you might want to re-run the import, delete it
  once you're done.
- `docs/migration/teable-reconciliation.md` is also git-ignored (it embeds
  real net-worth figures) — do not commit it.
- The Teable instance itself is untouched by any of this; stopping it is a
  separate, manual decision for later.
