# Ledgerly

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

## Integrations, Wallet and Expenses (F2)

**Settings → Integrations** links a Budget Makers Wallet account; **Expenses** is what the sync
brings in.

- **The token is sealed, not stored.** A credential is encrypted with AES-256-GCM under
  `APP_ENCRYPTION_KEY` (`id:base64[,older…]`, the first key seals and every key still opens, so a
  key can be rotated by prepending a new one) before it is ever written, and it is never returned
  to the browser afterwards: the field on the card only ever _replaces_ it.
- **What a sync does.** Hourly at minute 07 (`wallet-sync`), per user: accounts and balances first,
  then transactions. The first pass after linking fetches **12 months** in monthly windows; every
  pass after that re-reads the **last 7 days**. A page that comes back full splits its window
  instead of failing, reads are retried five times honouring `Retry-After`, and a 401 or 403 stops
  at once, marks the link revoked and says the token was rejected. Every attempt is a row in the
  sync log on that page, skipped ones included.
- **Local edits win.** Payee, amount and date belong to the provider; category, labels, note and
  visibility belong to you, and each field you actually change is recorded so no later sync
  overwrites it — submitting the provider's own value claims nothing. **Hide** (the design's
  "Delete") keeps a movement out of the totals and can be undone; a movement the provider stops
  returning inside the re-read window is marked as gone and treated the same way.
- **Transfers and recurrences.** Two movements are paired only by the reference Wallet gives them,
  never by amount and date, so a pair forms whichever sync each leg arrives in. A payee becomes a
  recurrence after three occurrences whose gaps all fall in one band (weekly through yearly) and
  whose amounts are all within 10% of the median.
- **Categories and labels** live under **Settings → Data**. A synced category is matched to an
  existing link, then to a local name exactly, and only then created. Categories are archived,
  never deleted.
- **Without a token** the client and the engine run against the synthetic fixtures in
  `tests/fixtures/wallet/`; the first real link and its 12-month backfill still have to be done by
  hand.

## Check

```bash
npm run format:check && npm run lint && npm run typecheck && npm test && npm run test:integration && npm run e2e
```

## Docker

`docker-compose.yml` is the homelab deployment: the `ledgerly` app behind Traefik on
`proxy_public`, and the `ledgerly-cron` sidecar beside it on `db_internal`. Both read
`.env.homelab` — never `.env`, which is the local-development one — and both are discovered by
`projects/stack.sh`, so `./stack.sh up` starts them along with the other projects.

```bash
docker compose build          # or: docker compose up -d --build
```

Being on `db_internal` is what lets the app reach `postgres:5432` and `silo:9000` by name; those
are internal-only and unreachable from a workstation, which is why `npm run dev` uses
`compose.dev.yml` instead. `dash.longobardo.me` is reachable from the public internet, but through one door only (spec D20).
Two Traefik routers serve it and they are not interchangeable: `ledgerly-router` on the `web`
entrypoint is what the Cloudflare tunnel hits, and it carries no IP filter; `ledgerly-secure-router`
on `websecure` is the direct 443 — the only port the home router forwards — and it keeps
`lan-only@file`, so nobody reaches the app from the internet without passing Cloudflare. Port 80 is
not forwarded, which is what makes the tunnel the sole public entrance. Nothing guards that entrance
except the app's own sign-in (Better Auth, sign-up disabled), so the blackbox probes in
`db/prometheus/prometheus.yml` still leave it alone: a probe would only ever see the login page.

The app image applies pending migrations on boot, then serves the standalone Next.js server; it
also validates every environment variable at startup (`src/instrumentation.ts`) and refuses to
start if any check fails, so a misconfigured deployment fails loudly instead of on the first
request. The cron image runs `supercronic` against `cron/crontab`, which `curl`s
`http://ledgerly:3000/api/jobs/tick?tier=<hourly|daily|monthly>` with `CRON_SECRET` as the
`X-Cron-Secret` header — the cron container needs `CRON_SECRET` set to the same value as the app,
and reaches the app by its compose service name, `ledgerly`, on the internal network. Each
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
  every request shares one bucket. Never publish port 3000 on the host: Traefik must stay the only
  way in (spec D20). Note that Traefik's `web` entrypoint currently sets no
  `forwardedHeaders.trustedIPs`, so it overwrites `X-Forwarded-For` with the tunnel hop's address
  and every visitor arriving from the internet lands in the **same** sign-in rate-limit bucket
  (5 attempts per minute on `/sign-in/email`) — one bot hammering the login locks the owner out
  from outside too. Preserving the real client address means adding
  `--entrypoints.web.forwardedHeaders.trustedIPs=<the cloudflared hop>` to Traefik, which is an
  owner action in `network/docker-compose.yml`, outside this repo.
- **Prometheus:** scrape `GET /api/metrics` with `METRICS_TOKEN` as a bearer credential, from
  inside the same Docker network as the app (its compose service name, `ledgerly`), for
  example:
  ```yaml
  scrape_configs:
    - job_name: ledgerly
      metrics_path: /api/metrics
      authorization:
        credentials: <METRICS_TOKEN>
      static_configs:
        - targets: ["ledgerly:3000"]
  ```
- **Homelab services** (`/home/mattia/docker`, conventions in its `AGENTS.md`). Ledgerly reuses the
  shared tier rather than running its own copies; `.env.homelab` holds the matching values, and no
  value in it may contain a `$` — Compose interpolates `env_file` contents, so a `$` in a secret
  silently reaches the container truncated.
  - **Postgres** (`db/`, published on the host as `5432`): one database and one role per app.
    ```sql
    CREATE ROLE ledgerly LOGIN PASSWORD '<the DATABASE_URL password>';
    CREATE DATABASE ledgerly OWNER ledgerly;
    ```
  - **Authentik** (`security/`, `auth.longobardo.me`): the OAuth2/OIDC provider and application
    `Ledgerly` (slug `ledgerly`, confidential, implicit-consent authorization flow, the four default
    OpenID scope mappings). Its redirect URIs are
    `<BETTER_AUTH_URL>/api/auth/callback/authentik` — for production and for
    `http://127.0.0.1:3000`. That path is the **social** callback, not the generic-OAuth one
    (`/api/auth/oauth2/callback/…`): the sign-in button calls `authClient.signIn.social`
    (`src/app/(auth)/authentik.ts`), and `authentik` is `OIDC_PROVIDER_ID`. Register the wrong one
    and Authentik answers `redirect_uri_no_match`. The `profile` scope mapping is what puts
    `groups` in the id token, which is how `OIDC_ADMIN_GROUP` (the `Ledgerly` group) grants the
    admin role on sign-in.
  - **Stalwart** (`network/`, `mx.longobardo.me`): send as `no-reply@longobardo.me` over implicit
    TLS on 465, with that mailbox's password in `SMTP_PASSWORD`.
  - **Silo** (`db/`, S3): one bucket per application, named after it — `ledgerly`, with areas as
    folders inside it (`payslips/`, `cometa/`, `avatars/`, …), never split buckets. Its S3 API
    listens on `db_internal` only, so a copy of the app running on a workstation cannot reach it;
    in production the app sits on that network and `http://silo:9000` resolves. Through F2 nothing
    in the running app touches S3 — only `npm run dev:seed` and the storage integration tests do.
- **Production requirements** (`src/platform/env.ts`, checked at boot by
  `src/instrumentation.ts` — the process refuses to start if any check fails): `BETTER_AUTH_URL`
  and `OIDC_DISCOVERY_URL` must be `https` (loopback `http` is accepted in production too — nothing
  here is checked outside production); generate every secret — `BETTER_AUTH_SECRET`, `CRON_SECRET`
  (32+ characters), `METRICS_TOKEN`, `APP_ENCRYPTION_KEY`, the OIDC client secret, and the S3
  access/secret key — the
  `.env.example` placeholder values for `BETTER_AUTH_SECRET`, `CRON_SECRET`, `METRICS_TOKEN` and
  `APP_ENCRYPTION_KEY` are rejected outright; and when `SMTP_USER` is set, `SMTP_SECURE` or `SMTP_REQUIRE_TLS` must be
  enabled so credentials never travel in plaintext.

### Keep `APP_ENCRYPTION_KEY` somewhere else too

It is the only value in the deployment whose loss cannot be recovered from anything else on the
machine. Keep a copy off the host.

- **What is actually lost with it**: the Budget Makers Wallet API token, and nothing more — it is
  the only encrypted column in the database (`integration_connections.credentials`). Accounts,
  balances, transactions, categories, labels and recurrences are all in clear. Pasting a new token
  in Settings › Integrations _is_ the recovery, and it keeps the sync log.
- **Rotating**: _prepend_ the new key and leave the old one in place
  (`APP_ENCRYPTION_KEY=k2:<new>,k1:<old>`). The first key seals from then on and every key still
  opens. **Replacing** a key instead of prepending it starts the app perfectly — everything but the
  token reads fine — and the only symptom is an hourly "Wallet sync failed: Unknown key id" email,
  which reads like a fault at the provider rather than at the key.

## Documentation

The full design and every binding decision: [`docs/specs/2026-09-13-dev-0.1-design.md`](docs/specs/2026-09-13-dev-0.1-design.md).
Phase-by-phase implementation plans: [`docs/plans/`](docs/plans/).
