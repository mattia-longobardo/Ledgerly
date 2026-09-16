# Finance Dashboard

Personal finance and household-admin dashboard. Version 0.1 is a from-scratch rebuild; the design is in
[`docs/specs/2026-09-13-dev-0.1-design.md`](docs/specs/2026-09-13-dev-0.1-design.md) and each phase has its
plan in [`docs/plans/`](docs/plans/).

## Develop

Prerequisites: Node.js `^22.13.0 || >=24` and Docker.

```bash
npm install
cp .env.example .env
npm run dev:services   # Postgres, MinIO, Mailpit, mock OIDC (compose.dev.yml)
npm run db:migrate
npm run dev:seed       # owner account (DEV_OWNER_EMAIL / DEV_OWNER_PASSWORD, below) + sample accounts
npm run dev            # binds to 127.0.0.1 — http://127.0.0.1:3000
```

Open `http://127.0.0.1:3000` — use `127.0.0.1`, not `localhost`. This must match `BETTER_AUTH_URL`
in `.env.example`, which Better Auth checks against `trustedOrigins` and the OAuth state
cookie/redirect_uri on every sign-in; `npm run dev` also binds to `127.0.0.1` (`next dev -H
127.0.0.1`) so Next 16's dev-origin check accepts the browser's requests.

Sign in as `owner@example.test` / `owner-password-123` — override with `DEV_OWNER_EMAIL` /
`DEV_OWNER_PASSWORD` before running `npm run dev:seed` — or with **Continue with Authentik** as
`admin@example.test` (admin) or any other address (user) on the mock provider.

Mailpit (outgoing mail): `http://127.0.0.1:58025`. MinIO console: `http://127.0.0.1:59001`. Users
change their own password from **Settings → Profile**, under **Sign-in** (accounts with no
password — SSO-only — do not see that form).

## Accounts and Overview (F1)

**Overview** is the net worth over time; **Accounts** lists the accounts behind it and each one has
its own page with Overview, Transactions (from F2), Balance entries and Settings tabs.

- **Balances are dated observations.** An account's worth on a day is its last balance on or before
  it, held forward; a month before an account's first balance is unknown (`—`), never zero, and a
  total that is missing an account says so rather than passing itself off as complete. An account
  set to **interpolate** has a straight line drawn between its known months in its own charts only —
  totals are always held.
- **Manual and synced accounts.** Balances are added, corrected and deleted by hand from the
  Balance entries tab. From F2 an account can also come from a provider; a balance typed here then
  counts as a correction and wins for that date. A synced account keeps the provider's type and
  currency, follows its renames only until the name is changed here, and becomes `unavailable`
  rather than disappearing when the provider stops sending it.
- **Monthly snapshot.** On the 1st at 00:05 (`accounts-snapshot`) every account included in it gets
  a `system` balance dated the last day of the month just ended, copied from the last balance
  actually observed up to that day. Accounts with no data are skipped, running it again changes
  nothing, and each run is listed under **Settings → Data**, where it can also be run at once.
- **Alerts.** Daily at 12:00 (`accounts-alerts`) a balance under its account's threshold and a sync
  older than its account's limit (36 h by default) send one email a week while the condition lasts;
  an account that recovers is reported again straight away.

## Check

```bash
npm run format:check && npm run lint && npm run typecheck && npm test && npm run test:integration && npm run e2e
```

## Docker

```bash
docker build -t finance-dashboard:dev .
docker build -t finance-dashboard-cron:dev cron
```

The app image applies pending migrations on boot, then serves the standalone Next.js server; it
also validates every environment variable at startup (`src/instrumentation.ts`) and refuses to
start if any check fails, so a misconfigured deployment fails loudly instead of on the first
request. The cron image runs `supercronic` against `cron/crontab`, which `curl`s
`http://dashboard-app:3000/api/jobs/tick?tier=<hourly|daily|monthly>` with `CRON_SECRET` as the
`X-Cron-Secret` header — the cron container needs `CRON_SECRET` set to the same value as the app,
and reaches the app by its compose service name, `dashboard-app`, on the internal network. Each
tick runs every job in `JOBS` (`src/platform/jobs/registry.ts`: `housekeeping` and
`accounts-alerts` daily, `accounts-snapshot` monthly) for that tier; touching the heartbeat file is
a side effect of every tick, not a job of its own.

## Operations

- **Bootstrap the owner account**, before the app is reachable by anyone else, either by:
  - running `ADMIN_PASSWORD=<12-128 chars> npm run user:create-admin -- <email> "<name>"`
    (`scripts/create-admin.ts`) — it is not built into the Docker image, so run it from a checkout
    whose `.env` points at the target database and has every other variable the app needs (the
    script loads the same environment schema as the app); or
  - binding the Authentik application to a group and letting the first person sign in with
    **Continue with Authentik**. Sign-up is closed, so nobody can create a password account by
    signing in — the first user _created_ by either path is granted the admin role automatically
    (the `user.create` database hook in `src/platform/auth/auth.ts`).
- **SSO never demotes admins:** removing someone from the Authentik admin group stops new sign-ins
  from granting the admin role, but does not revoke an admin role already held in the app. F0 has
  no Admin › Users screen (it arrives in a later phase); demote a user by calling Better Auth's
  admin API as a signed-in admin:
  ```bash
  curl -X POST https://dash.longobardo.me/api/auth/admin/set-role \
    -H "Content-Type: application/json" \
    -H "Cookie: <the admin's session cookie>" \
    -d '{"userId": "<user id>", "role": "user"}'
  ```
- **Password reset only reaches password accounts:** an SSO-only account (no stored password) never
  gets a reset-link email — creating one would be a way around Authentik's own sign-in policy (such
  as 2FA). That account signs in with **Continue with Authentik** instead.
- **Reverse proxy:** set `TRUSTED_PROXY_IPS` to the address of the Traefik (or tunnel) hop in front
  of the app on its Docker network, **and** configure Traefik with
  `--entrypoints.web.forwardedHeaders.trustedIPs=<the same address>` — an owner action outside this
  repo, so Traefik itself discards any `X-Forwarded-For` a client tries to inject before setting
  its own. Only with both set does the app trust `X-Forwarded-For` from that one hop and give each
  client its own sign-in rate-limit bucket; left unset, `TRUSTED_PROXY_IPS` defaults to empty and
  every request shares one bucket. Never publish port 3000 on the host: the app is reached only
  over LAN/NetBird (spec §13).
- **Prometheus:** scrape `GET /api/metrics` with `METRICS_TOKEN` as a bearer credential, from
  inside the same Docker network as the app (its compose service name, `dashboard-app`), for
  example:
  ```yaml
  scrape_configs:
    - job_name: finance-dashboard
      metrics_path: /api/metrics
      authorization:
        credentials: <METRICS_TOKEN>
      static_configs:
        - targets: ["dashboard-app:3000"]
  ```
- **Production requirements** (`src/platform/env.ts`, checked at boot by
  `src/instrumentation.ts` — the process refuses to start if any check fails): `BETTER_AUTH_URL`
  and `OIDC_DISCOVERY_URL` must be `https` (loopback `http` is accepted in production too — nothing
  here is checked outside production); generate every secret — `BETTER_AUTH_SECRET`, `CRON_SECRET`
  (32+ characters), `METRICS_TOKEN`, the OIDC client secret, and the S3 access/secret key — the
  `.env.example` placeholder values for `BETTER_AUTH_SECRET`, `CRON_SECRET` and `METRICS_TOKEN` are
  rejected outright; and when `SMTP_USER` is set, `SMTP_SECURE` or `SMTP_REQUIRE_TLS` must be
  enabled so credentials never travel in plaintext.

## Documentation

The full design and every binding decision: [`docs/specs/2026-09-13-dev-0.1-design.md`](docs/specs/2026-09-13-dev-0.1-design.md).
Phase-by-phase implementation plans: [`docs/plans/`](docs/plans/).
