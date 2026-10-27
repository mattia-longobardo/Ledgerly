# OAuth2 API and Paperless webhook on OAuth2 — deploy, migration, rollback

Runbook for T2 + T3 of `docs/auth-design.md` (§3 and §4): OAuth2 on `/api/v1`, the per-connection
sync schedule (D7) and the Paperless provider (D5). Secrets are never written here: only where they
live.

## What the deploy changes

| Area | Change | Data |
|---|---|---|
| Schema | `0030_oauth_provider`: `oauth_*` tables and `jwks` | additive |
| Schema | `0031_sync_schedule`: `integration_connections.schedule`, `next_sync_at`; `documents` sync kind; `quarter` job tier | additive; existing connections get `next_sync_at` = next top of the hour |
| Jobs | `integrations-sync` replaces `wallet-sync` and `trek-sync`; `recurrences-refresh` keeps the rest of `wallet-sync` | — |
| Cron | `cron/crontab` adds `22,37,52 * * * *` → `tier=quarter` (sidecar rebuilt) | — |
| API | `/api/v1` accepts OAuth2 JWT (aud `/api/v1`) **and** the legacy PAT (D4) | — |

No new environment variable. The JWKS signing keys are generated on the first token and stored in
`jwks`, the private half encrypted with `BETTER_AUTH_SECRET`.

## Deploy

1. `git -C projects/Ledgerly log origin/main..main` is empty, or the extra commits are in the branch.
2. Dump: `docker exec postgres pg_dump -U postgres -Fc ledgerly > backups/ledgerly/pre-oauth.dump`.
3. Rollback images: `docker tag ledgerly:latest ledgerly:pre-oauth` and
   `docker tag ledgerly-cron:latest ledgerly-cron:pre-sync-schedule` (same id as `ledgerly:pre-sync-schedule`
   for the app).
4. `docker compose build && docker compose up -d --wait` (migrations run on boot).
5. Check: `/api/health`, `GET /api/v1/summary` without a token → 401 with `WWW-Authenticate`, the
   `.well-known` documents, a PAT call → 200 and `[api] legacy token used` in the log, the next
   `integrations-sync` run in Admin › Jobs.

## Paperless webhook on OAuth2 (done, PERS-47)

Mattia asked to keep the existing webhook, without a static token. Done on 2026-10-27:

1. `npm run user:create-api-client -- <owner email> "Paperless webhook" imports /app/.paperless-oauth.env PAPERLESS_WEBHOOK_OAUTH2`,
   then the two lines appended to `storage/.env` (never printed).
2. Paperless image: `storage/paperless-ngx/homelab/Dockerfile.homelab` overlays
   `src/documents/workflows/webhooks.py`: for URLs under `PAPERLESS_WEBHOOK_OAUTH2_URL_PREFIX` it
   gets a client_credentials token (`resource` = `/api/v1`, scope `imports`), caches it until
   60 s before expiry, replaces any static `Authorization`, and drops the cache on a 401.
3. `Authorization` removed from the headers of Workflow 1's webhook.
4. Check: the real `send_webhook` with an already imported payslip → `200 duplicate`, Bearer, no
   `legacy token used` in Ledgerly's log.

Rollback: `docker tag paperless-ngx-homelab:pre-oauth-webhook paperless-ngx-homelab:3.2.1-responses`
and `docker compose up -d --no-build paperless-ngx`, then put an `Authorization: Bearer pat_…`
header back on the webhook. There is no PAT fallback any more: the PATs were removed in T5 (below).

## Paperless pull (design §3) — cancelled

**Not the target any more.** Mattia chose option A on 2026-10-27 (PERS-44, PERS-57): the webhook of
Workflow 1 on OAuth2 `client_credentials` (section above) is the final path. The fork patch, the
`PAPERLESS_WEBHOOK_OAUTH2_*` variables in `storage/` and the Client API "Paperless webhook" stay.
There is no `ledgerly-sync` user. The pull provider stays in the code, not linked. The table below
is kept only as the procedure for a future switch.

| # | Step | Who | Check |
|---|---|---|---|
| 0 | Deploy above (webhook PAT still accepted, Paperless provider not linked) | agent | PAT import of an already imported PDF → `200 duplicate` |
| 1 | In Paperless: user `ledgerly-sync`, no admin, **view** permission on the `Payroll` documents (owner or group permission), and an API token for it (Profile › API Auth Token) | Mattia | `GET /api/documents/?document_type__id=48` with that token lists the payslips |
| 2 | Settings › Integrations › Paperless-ngx › Configure: URL `http://paperless-ngx:8000`, the token, type `Payroll`. The first pass starts at the link time (not 90 days back: hand-uploaded payslips have a different sha256) | Mattia | "Test connection" OK |
| 3 | "Sync now" | Mattia/agent | sync log `Documents` success; nothing imported; number of documents unchanged |
| 4 | Webhook and pull both active; edit a field of a payslip in Paperless | — | webhook → `duplicate`, pull → `duplicate`, no new document |
| 5 | Disable (not delete) Paperless Workflow 1 "Ledgerly – buste paga" | Mattia | the next payslip arrives through the pull within the chosen schedule |
| 6 | After one pay cycle / 14 days without errors: revoke the Paperless PAT in Ledgerly, delete Workflow 1 | Mattia | no `legacy token used` in the log |
| 7 | T5: remove PAT code and table (done, PERS-59, see below) | agent | `pat_…` on `/api/v1` → 401 |

## Rollback

- **App** (any step): `docker tag ledgerly:pre-oauth ledgerly:latest && docker compose up -d --no-build --wait ledgerly`.
  The new tables and columns stay; the previous image ignores them. The webhook PAT keeps working
  because the previous image only knows PATs.
- **Cron**: `docker tag ledgerly-cron:pre-sync-schedule ledgerly-cron:latest && docker compose up -d --no-build ledgerly-cron`
  (the old crontab has no `quarter` line; the old app would answer it 404 anyway).
- **Paperless**: steps 1–5 are undone by deleting the user, disconnecting the integration and
  re-enabling Workflow 1. PATs no longer exist (T5): a fallback for the webhook is a Client API.
- **Data**: nothing is converted. A full restore is `pg_restore --clean -d ledgerly
  backups/ledgerly/pre-oauth.dump`, only if a migration had to be undone by hand.

## T5: PAT removal (done, PERS-59)

`/api/v1` accepts only OAuth2 access tokens; a `pat_…` value is a `401 invalid_token`. The PAT code,
the legacy section of Settings › Security and the `personal_access_tokens` table are gone
(migration `0033_drop_personal_access_tokens`). Before: one PAT, revoked in PERS-57, last used on
2026-10-11; no `legacy token used` in the log.

1. Dump: `docker exec postgres pg_dump -U <admin> -Fc ledgerly > backups/ledgerly/pre-pat-removal.dump`.
2. Rollback image: `docker tag ledgerly:latest ledgerly:pre-pat-removal`.
3. `docker compose up -d --build --wait ledgerly` (the migration runs on boot).
4. Check: `/api/health`; `pat_…` on `/api/v1/summary` → 401; a Client API token → 200; the
   Paperless webhook → `200 duplicate`.

Rollback: `docker tag ledgerly:pre-pat-removal ledgerly:latest && docker compose up -d --no-build --wait ledgerly`.
The previous image needs the table: restore it first with
`pg_restore -d ledgerly -t personal_access_tokens backups/ledgerly/pre-pat-removal.dump` and remove the `0033` row from
`drizzle.__drizzle_migrations`, otherwise the next deploy does not drop it again.
