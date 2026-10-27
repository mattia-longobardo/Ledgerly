# OAuth2 API and Paperless pull — deploy, migration, rollback

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

## Paperless migration (design §3)

| # | Step | Who | Check |
|---|---|---|---|
| 0 | Deploy above (webhook PAT still accepted, Paperless provider not linked) | agent | PAT import of an already imported PDF → `200 duplicate` |
| 1 | In Paperless: user `ledgerly-sync`, no admin, **view** permission on the `Payroll` documents (owner or group permission), and an API token for it (Profile › API Auth Token) | Mattia | `GET /api/documents/?document_type__id=48` with that token lists the payslips |
| 2 | Settings › Integrations › Paperless-ngx › Configure: URL `http://paperless-ngx:8000`, the token, type `Payroll` | Mattia | "Test connection" OK |
| 3 | "Sync now" | Mattia/agent | sync log `Documents` success; every old payslip counted as skipped (duplicate); number of documents unchanged |
| 4 | Webhook and pull both active; edit a field of a payslip in Paperless | — | webhook → `duplicate`, pull → `duplicate`, no new document |
| 5 | Disable (not delete) Paperless Workflow 1 "Ledgerly – buste paga" | Mattia | the next payslip arrives through the pull within the chosen schedule |
| 6 | After one pay cycle / 14 days without errors: revoke the Paperless PAT in Ledgerly, delete Workflow 1 | Mattia | no `legacy token used` in the log |
| 7 | T5 (separate task): remove PAT code and table | agent | — |

## Rollback

- **App** (any step): `docker tag ledgerly:pre-oauth ledgerly:latest && docker compose up -d --no-build --wait ledgerly`.
  The new tables and columns stay; the previous image ignores them. The webhook PAT keeps working
  because the previous image only knows PATs.
- **Cron**: `docker tag ledgerly-cron:pre-sync-schedule ledgerly-cron:latest && docker compose up -d --no-build ledgerly-cron`
  (the old crontab has no `quarter` line; the old app would answer it 404 anyway).
- **Paperless**: steps 1–5 are undone by deleting the user, disconnecting the integration and
  re-enabling Workflow 1. Until T5, a new PAT with scope `imports` can be re-made only from the
  database (the UI no longer creates PATs): restore the app image first if that is needed.
- **Data**: nothing is converted. A full restore is `pg_restore --clean -d ledgerly
  backups/ledgerly/pre-oauth.dump`, only if a migration had to be undone by hand.
