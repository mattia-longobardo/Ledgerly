# Phase 2 deployment runbook — integration framework and encrypted credentials

This is the exact, copy-pasteable sequence for shipping Phase 2: the
integration framework, encrypted `integration_connections`, the Wallet and
Trek adapters ported onto it, the inbound webhook endpoint, and migrations
`0008`–`0010`. Read it end-to-end once before running anything.

Run every command from the repository root
(`/home/mattia/docker/projects/personal-dashboard`) unless noted otherwise.
All of it targets the production stack; there is no staging environment.

The phase deploys as a unit. Every commit from Task 4 onward requires
`APP_ENCRYPTION_KEY` to boot, so there is no intermediate commit that can be
deployed on its own — this runbook is the only supported path from the
Phase 1 stack to Phase 2.

## 1. Pre-checks

Back up the database and preserve the currently-running image:

```bash
docker exec postgres pg_dump -U dashboard dashboard > .work/backups/pre-phase2-$(date +%F-%H%M).sql
docker tag dashboard:latest dashboard:pre-phase2
```

## 2. Generate the encryption key

```bash
printf 'k1:%s' "$(openssl rand -base64 32)"
```

Put the output in `.env` as `DASHBOARD_APP_ENCRYPTION_KEY`.

**Back this value up** — in the password manager or wherever `.env`'s other
secrets live, not just on the host. Without it, every credential this phase
encrypts is unrecoverable: there is no bulk re-seal path and no way to
decrypt `integration_connections.credentials_ciphertext` without the exact
key that sealed it.

## 3. Deploy the new image with the token files still mounted

Build and deploy `docker-compose.yml` from this phase with `APP_ENCRYPTION_KEY`
set, but **do not yet remove** the `WALLET_TOKEN_FILE`/`TREK_URL`/
`TREK_TOKEN_FILE` environment entries or the `./secrets/*-token` volume
mounts from the running configuration — step 4's import needs to read the
files those mounts and variables point at. Migrations `0008`–`0010` apply on
boot as part of `entrypoint.sh`'s normal migrate step.

```bash
docker compose up -d --force-recreate dashboard-app
```

## 4. Import the file-mounted credentials

```bash
docker exec dashboard-app node /app/import-file-credentials.mjs
```

Expect:

```json
{"imported":["wallet","trek"],"skipped":[]}
```

`imported` names every provider whose token file was present and readable;
`skipped` names providers with no file to import (not an error — nothing to
do). Anything else — a non-empty `skipped` where a file should have existed,
or an exception — means a token file could not be read, and the import must
be fixed before continuing; do not proceed with a partially-imported
credential set.

## 5. Verify in the UI

1. Sign in and open Settings › Integrations. Both Wallet and Trek should
   show **Connected**.
2. Press **Test** on each. Both should report success against the live
   provider.
3. Press **Sync now** on Wallet and confirm the run finishes `success` with
   stats matching what a normal daily sync produces (account count, balance
   totals — compare against the last Phase 1 `wallet_accounts_sync` run in
   the job log).

## 6. Remove the token files

Once step 5 is clean, edit `docker-compose.yml` to drop the
`WALLET_TOKEN_FILE`, `TREK_URL` and `TREK_TOKEN_FILE` environment entries and
both `./secrets/*-token` volume mounts (this is the state the checked-in
`docker-compose.yml` already carries after this task), then:

```bash
docker compose up -d --force-recreate dashboard-app
```

Confirm the next hourly tick still syncs — see step 7.

## 7. Verify the tick

From inside the Docker network:

```bash
curl -H "X-Cron-Secret: $DASHBOARD_CRON_SECRET" -X POST http://dashboard-app:3000/api/jobs/tick?tier=daily
```

Expect `wallet_accounts_sync: success`.

```bash
curl -H "X-Cron-Secret: $DASHBOARD_CRON_SECRET" -X POST http://dashboard-app:3000/api/jobs/tick?tier=hourly
```

Expect `sync_queue: already_done` with `{"reason":"queue_empty"}` on an
install that has received no webhooks yet — **that is the healthy state, not
a fault.** A webhook-triggered `sync_runs` row is what gives `sync_queue`
something to drain; until Wallet or Trek sends one, an empty queue on every
hourly tick is exactly correct.

## 8. Rollback

Redeploy `dashboard:pre-phase2` with the volume mounts restored:

```bash
docker tag dashboard:pre-phase2 dashboard:latest
# restore the WALLET_TOKEN_FILE / TREK_URL / TREK_TOKEN_FILE environment
# entries and the ./secrets/*-token volume mounts in docker-compose.yml
docker compose up -d --force-recreate dashboard-app
```

Migrations `0008`–`0010` are additive — the old image never queries
`integration_connections`, `sync_jobs`, `sync_runs` or `webhook_deliveries`,
so no schema change here blocks a rollback.

**Except:** the old image still reads the token files directly
(`WALLET_TOKEN_FILE`, `TREK_TOKEN_FILE`, `TREK_URL`). Do not delete
`./secrets/wallet-token` or `./secrets/trek-token`, and do not proceed past
step 6, until step 6 has been running cleanly for a full day — a rollback
attempted after the files are gone leaves the old image with no credential
at all.
