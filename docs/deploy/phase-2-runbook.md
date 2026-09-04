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

The `docker-compose.yml` checked into this phase has **already** dropped the
`WALLET_TOKEN_FILE`/`TREK_URL`/`TREK_TOKEN_FILE` environment entries and both
`./secrets/*-token` volume mounts from the `dashboard-app` service (Task 19)
— they are not "still there to be removed later." Step 4's one-off import
needs to read the files those mounts point at, so **before this deploy only**,
add the four lines back to the `dashboard-app` service in `docker-compose.yml`
(this is the exact block Task 19 removed):

```yaml
    environment:
      # ...existing entries...
      - WALLET_TOKEN_FILE=/secrets/wallet-token
      - TREK_URL=https://${TREK_HOST}
      - TREK_TOKEN_FILE=/secrets/trek-token
    volumes:
      - ./secrets/wallet-token:/secrets/wallet-token:ro
      - ./secrets/trek-token:/secrets/trek-token:ro
```

`TREK_URL` is not optional here even though the token file is present: the
import script only migrates Trek when it has both a token *and* a base URL
(`scripts/import-file-credentials.ts`). If `.env` still defines `TREK_HOST`
from before this phase, reuse it as above; if it has already been removed,
substitute Trek's real base URL directly instead of `https://${TREK_HOST}`.

With that temporary edit in place and `APP_ENCRYPTION_KEY`
(`DASHBOARD_APP_ENCRYPTION_KEY`) set, build and deploy. Migrations
`0008`–`0010` apply on boot as part of `entrypoint.sh`'s normal migrate step.

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

Once step 5 is clean, **revert step 3's temporary edit** — discard the four
lines you added back, or simply reset `docker-compose.yml` to what is
checked in (`git checkout -- docker-compose.yml`), since the committed file
already has none of them. Then:

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
# entries and the ./secrets/*-token volume mounts in docker-compose.yml —
# the same block step 3 above adds back temporarily
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

## 9. Manual exit-criteria walkthrough (operator checklist)

Task 20 (the automated Phase 2 exit-criteria check) verified everything it
could without a real provider token: typecheck, unit and integration suites,
the production build, the e2e smoke suite against a local server, and the
capability-driven navigation logic by its tests. **It did not, and could
not, drive a browser against a real Budget Makers Wallet or Trek token** —
no such token, and no authenticated browser session, exists in that
environment. This section is that missing step, written so a person holding
the real tokens can run it without reconstructing anything. Do this once,
after step 5 above, before Phase 2 counts as verified end to end. Steps 1–8
run signed in as the owner; step 9 needs a second, non-admin sign-in.

1. Open **Settings › Integrations** (`/settings/integrations`). On a fresh
   database both Wallet and Trek show **Not connected**.
2. Open the **Finance** navigation group. It has no **Expenses** and no
   **Interests** entry.
3. Open `/settings/integrations/wallet`. Under **Credentials**, paste the
   real Wallet API token into **API token** and submit (leave **Webhook
   secret** empty for now — step 10 sets it). Press **Test connection**.
   Expect **Status › State** to read **Connected** and **Last test** to
   update to just now.
4. Reload any page so the nav recomputes. **Expenses** and **Interests** now
   appear in the Finance group, between Accounts/Funds and Budgets. Open
   each: both show the **"Connect Budget Makers Wallet"** setup empty state
   with a **Go to Integrations** link back to `/settings/integrations/wallet`
   — this is correct even though Wallet is connected, because Phase 2 does
   not populate either page (Phase 3 does); the empty state is what "ready"
   means here, not a bug.
5. Back on `/settings/integrations/wallet`, press **Sync now**. Expect a
   toast reading `Sync finished: accounts (success).`, a new **success** row
   in the **Recent syncs** table with non-empty stats, and `/finance/accounts`
   reflecting whatever the sync changed.
6. Under **Credentials**, submit a deliberately wrong token, then press
   **Test connection** again. Expect **State: Error** with the provider's own
   message shown inline. Reload `/finance`: Expenses and Interests are gone
   from the nav again (an `error` connection is not a connected one).
7. Re-enter the valid token and press **Test connection** to get back to
   **Connected**. In the **Disconnect** section, select policy **keep** (read
   the helper text that appears — it names the exact effect of each of the
   three policies: `keep`, `archive`, `purge`), press **Disconnect**, then
   confirm **Yes, disconnect**. Expect **State: Not connected**. Confirm the
   credential is actually gone and nothing else moved:
   ```sql
   select credentials_ciphertext from integration_connections
     where provider_code = 'wallet' order by created_at desc limit 1;
   -- expect: null
   ```
   and that `/finance/accounts` and account balances are unchanged from
   before step 7.
8. Connect Trek at `/settings/integrations/trek` (fill **Base URL**, **API
   token**, and optionally **Webhook secret**), press **Test connection**,
   confirm **Connected**. Open the **Work** page and trigger its leave sync
   (or wait for/fire the daily tick — step 7 of section 7 above shows the
   curl form). Confirm leave data updates and no code path reads
   `TREK_TOKEN_FILE` or `TREK_URL` to do it — the stored connection is the
   only source now.
9. Sign in as a non-admin (member or viewer) principal. Confirm
   `/settings/admin` answers **404** and that the Settings navigation has no
   **Administration** entry.
10. The webhook path, end to end. With Wallet connected and a
    **Webhook secret** set on the connection (step 3's form, filled in now),
    from inside the Docker network:
    ```bash
    BODY='{"event":"accounts.changed"}'
    SIG=$(printf '%s' "$BODY" | openssl dgst -sha256 -hmac "$WEBHOOK_SECRET_FOR_THE_CONNECTION" -hex | awk '{print $2}')
    curl -s -o /dev/null -w '%{http_code}\n' -X POST http://dashboard-app:3000/api/v1/webhooks/wallet \
      -H 'content-type: application/json' -H "x-signature: sha256=$SIG" -d "$BODY"
    ```
    Expect **202**. Reload `/settings/integrations/wallet`: **Recent syncs**
    shows a new run with status **queued**. Fire the hourly tick:
    ```bash
    curl -H "X-Cron-Secret: $DASHBOARD_CRON_SECRET" -X POST http://dashboard-app:3000/api/jobs/tick?tier=hourly
    ```
    Reload again: the same run is now **success**. Confirm its audit row
    names the connection's owner, not the system:
    ```sql
    select actor_user_id, action, created_at from audit_events
      order by created_at desc limit 5;
    -- expect: the most relevant row's actor_user_id is the owner's user id,
    -- not null/system
    ```
    Then repeat the first curl with the `x-signature` header omitted (or an
    unsigned body) and confirm the response is **404**.
11. For the record, not something to click: the old Settings page's "Funds"
    list and "Accounts" pointer were **dropped**, not moved, when Settings
    split in this phase (Ruling in Task 17, Step 4). **Finance › Funds** and
    **Finance › Management** already own both — there is nothing left under
    Settings to look for.

If any step above does not match, that is a real Phase 2 defect — file it
against this runbook rather than reconciling it by hand, since the point of
this checklist is that the next person can trust it without re-deriving it.
