# Operations

How Ledgerly runs on the homelab, how to configure it, and the admin tasks.

## Architecture

`docker-compose.yml` starts two containers. Both read `.env.homelab`.

| Container       | Role                                                                          |
| --------------- | ----------------------------------------------------------------------------- |
| `ledgerly`      | The app (Next.js). Applies pending migrations at start, then serves on 3000.  |
| `ledgerly-cron` | Calls `http://ledgerly:3000/api/jobs/tick` every minute, hour, day and month. |

- The app is on `proxy_public` (Traefik) and `db_internal` (Postgres, S3). The cron container is on
  `db_internal` only.
- At start, the app checks every environment variable (`src/platform/env.ts`). If a check fails,
  the app does not start.
- The cron container sends `CRON_SECRET` in the `X-Cron-Secret` header. The value must be the same
  in both containers.
- `projects/stack.sh` finds both containers, so `./stack.sh up` starts them with the other projects.

### Network access

`dash.longobardo.me` is public through the Cloudflare tunnel only. Traefik has two routers:

- `ledgerly-router` (entrypoint `web`): the target of the Cloudflare tunnel.
- `ledgerly-secure-router` (entrypoint `websecure`, port 443): LAN only (`lan-only@file`).

Port 80 is not forwarded, so the tunnel is the only public entrance. Never publish port 3000 on the
host.

## Background jobs

The jobs are in `src/platform/jobs/registry.ts`. Details on the sync schedule:
[`scheduler.md`](scheduler.md).

Times are Europe/Rome (`cron/crontab`).

| When                     | Jobs                                                                                                                                                                     |
| ------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Every minute             | `integrations-sync` (only for links that are due)                                                                                                                       |
| Every hour, at :30       | `interests-accrual`, `payslips-sweep`, `cometa-sweep`                                                                                                                    |
| Every day, at 12:00      | `housekeeping`, `accounts-alerts`, `subscriptions-check`, `interests-rematch`, `pockets-planned-cleanup`, `documents-retention`, `holidays-refresh`, `fx-rates-refresh`, `database-backup` |
| The 1st of each month    | `accounts-snapshot`, `pockets-accrual`, `monthly-summary`                                                                                                                |
| After a sync with changes | `recurrences-refresh`, `subscriptions-check`, `budgets-alerts`, `funds-deposits`                                                                                         |
| Only by hand             | `export-all`                                                                                                                                                             |

An admin can see each job with its last run in **Settings → Integrations**, and start it with
**Run now**. A job that is already running is skipped.

## Deploy

Full procedure, with lock, health check and rollback: the repo's `AGENTS.md` (local, not in Git)
and [`RELEASE.md`](RELEASE.md). In short:

```bash
docker compose build ledgerly && docker compose up -d --wait ledgerly
curl -s https://dash.longobardo.me/api/health    # {"status":"ok","db":"up",…}
npm run e2e
```

Rebuild `ledgerly-cron` only when `cron/` changes.

## Configuration

All settings are in `.env.homelab` (template: `.env.example`). Do not commit this file.

- **No `$` in any value.** Compose reads `$` as a variable, and the value reaches the container cut.
- **Generate every secret:** `BETTER_AUTH_SECRET`, `CRON_SECRET` (32+ characters), `METRICS_TOKEN`,
  `APP_ENCRYPTION_KEY`, the OIDC client secret, the S3 keys. The app refuses the placeholder values
  of `.env.example`.
- `BETTER_AUTH_URL` and `OIDC_DISCOVERY_URL` must use `https`.
- If `SMTP_USER` is set, `SMTP_SECURE` or `SMTP_REQUIRE_TLS` must be on.
- `TWO_FACTOR_POLICY`: `required` (default) or `optional`. Restart the container after a change.
- `TRUSTED_PROXY_IPS`: the address of Traefik on the Docker network. The app trusts
  `X-Forwarded-For` from that address only, for the sign-in rate limit (5 attempts per minute per
  client). If Traefik's address changes, update this value.
- `GOTIFY_URL`, `GOTIFY_TOKEN` (optional): failed jobs send a notification to the admins.
- Authentik and mail settings saved in **Admin → Server** override `.env.homelab`.

### `APP_ENCRYPTION_KEY`

Keep a copy of this key outside the server.

- It encrypts the provider tokens and keys (for example the Wallet token). All other data is not
  encrypted. If you lose the key, paste the tokens again in **Settings → Integrations**.
- **To rotate the key**, put the new key first and keep the old one:
  `APP_ENCRYPTION_KEY=k2:<new>,k1:<old>`. If you replace the old key instead, the app starts, but
  each sync fails with "Unknown key id".

## Homelab services

Ledgerly uses the shared homelab services (`/home/mattia/docker`, conventions in its `AGENTS.md`).

| Service    | Use                                                                                     |
| ---------- | --------------------------------------------------------------------------------------- |
| Postgres   | Database `ledgerly`, role `ledgerly`. Tests use `ledgerly_test`.                        |
| Silo (S3)  | Bucket `ledgerly`, one folder per area: `payslips/`, `cometa/`, `exports/`, `backups/`. |
| Authentik  | OIDC application `ledgerly`. Members of `OIDC_ADMIN_GROUP` become admins at sign-in.    |
| Stalwart   | Mail from `no-reply@longobardo.me`, implicit TLS on port 465.                           |
| Prometheus | Scrapes `GET /api/metrics` on `ledgerly:3000`, with `METRICS_TOKEN` as bearer token.    |

Create the database once:

```sql
CREATE ROLE ledgerly LOGIN PASSWORD '<the DATABASE_URL password>';
CREATE DATABASE ledgerly OWNER ledgerly;
```

**Authentik redirect URI:** `<BETTER_AUTH_URL>/api/auth/callback/authentik`. Use this path, not
`/api/auth/oauth2/callback/…`: with the wrong one, Authentik answers `redirect_uri_no_match`. The
`profile` scope mapping puts `groups` in the token; the admin role depends on it.

## Backups

`database-backup` runs every day. It uploads a `pg_dump -Fc` of the database to `backups/` in the
bucket and keeps the last 30. The dump is not encrypted, so you can restore it without the app's key.

## Admin tasks

### Create the first admin

Do this before anybody else can reach the app. Use one of the two ways:

- Run `ADMIN_PASSWORD=<12-128 characters> npm run user:create-admin -- <email> "<name>"` on the
  homelab host.
- Sign in with **Continue with Authentik**.

Sign-up is closed. The first user created becomes admin automatically.

### Manage users

Use **Admin → Users**. Removing someone from the Authentik admin group does not remove the admin
role in Ledgerly: demote the user there.

### Lost two-factor authentication

- **A user:** an admin uses **Reset 2FA** in **Admin → Users**.
- **The only admin:** run this on the `ledgerly` database, then sign in again.

  ```sql
  UPDATE users SET two_factor_enabled = false WHERE email = '…';
  DELETE FROM two_factors WHERE user_id = (SELECT id FROM users WHERE email = '…');
  ```

### Password reset

The reset email goes only to accounts with a password. An SSO-only account signs in with
**Continue with Authentik**.

### Export all data

**Admin → Server → Export all data** writes one archive per user under `exports/<userId>/` in the
bucket.
