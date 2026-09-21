# Ledgerly

Personal finance and household-admin dashboard. Version 0.1 is a from-scratch rebuild; the design is in
[`docs/specs/2026-09-13-dev-0.1-design.md`](docs/specs/2026-09-13-dev-0.1-design.md) and each phase has its
plan in [`docs/plans/`](docs/plans/).

## Develop

Prerequisites: Node.js `^22.13.0 || >=24` and Docker, on the homelab host. There is no local
development server: every change is built and deployed to `https://dash.longobardo.me`
(`docker compose build && docker compose up -d`, see Docker below) and checked there.

```bash
npm install
cp .env.example .env.homelab   # then replace every value (README, Operations)
```

Users change their own password from **Settings → Profile**, under **Sign-in** (accounts with no
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

## Budgets, Pockets and Subscriptions (F3)

- **Budgets** are monthly limits on a spending category, an account, or both, versioned by month: a limit set or edited
  in a month applies from that month on (and replaces the ones set for later months); "Remove from
  this month" ends it there. Spent is the month's expenses of the category in your own time zone —
  never a giroconto, never a hidden movement — on that account or on all of them, and a group's spent
  includes its sub-categories. A budget inside another adds nothing to the total limit, and each
  movement counts once in the total spent.
  Over the limit is **Over**, from 85 % **Near limit**. The five closest to their limit are on
  Overview.
- **Pockets** earmark money without moving it. A pocket may rest on an account or stand alone, and
  target and monthly accrual are both optional. On the 1st at 00:05 (`pockets-accrual`) every active
  pocket gets its month's accrual — once, whatever runs twice — and a new or resumed pocket gets
  the current month's at once; months in the past are never back-filled. **Free** is what the
  backing accounts hold beyond their pockets, unknown (`—`) while one of them has no balance. The
  share of the account's interest stays unknown until the interest rules of F4 exist.
- **Subscriptions** are entered by hand or accepted from the recurring payments already detected
  in Expenses. Hourly, right after the Wallet pass (`subscriptions-check`), each active one with a
  text to look for is checked against the paying account's expenses: **Paid**, **Amount differs**
  (outside its tolerance, 5 % by default), **Due** (within seven days and not found yet) or **Not
  found** (the month of the charge closed without it). A movement pays one charge only. The banners
  at the top of the page are the alerts; there are no emails for them. **Projection by account** is
  today's balance minus the charges due in the next 30 days or 12 months; **Export CSV** downloads
  the table.
- An account a pocket or a subscription points at is archived instead of deleted.

## Interests and PAC funds (F4)

- **Interests.** A rule per account: rate tiers (the first rate up to its threshold, the next on
  the part above), tax withheld, 365 or 360 days, a daily, monthly, quarterly or yearly payout, a validity.
  Every day at 12:00 (`interests-accrual`) each active rule accrues up to yesterday on the account's
  daily balance, in fixed point with the remainder of the day before, missed days caught up in order;
  a negative or unknown balance is a skipped day, shown. Each closed period becomes a payout, checked
  against what the bank paid (income whose payee or category contains the rule's text, each payment
  counted for one payout only) as matched,
  missing, awaited, anomalous or no data. Editing a rule recomputes only what has not been paid out.
- **Posting to Wallet** is off unless a rule asks for it (synced accounts only). A payout is claimed
  first, a record with its marker is looked for, then posted once; a failure after sending is
  _unsure_ and never retried by itself — the rule's page has "Retry" and "Mark as posted".
- **Funds (PAC).** A fund's value lives on its own account (created with it, or an existing manual
  one), so net worth counts it once; "Record valuation" writes that account's balance. Deposits are
  entered by hand or matched hourly (`funds-deposits`) from the paying account's debits whose payee
  contains the rule's text, less the fund's fee per deposit. Gain is value − paid in; the monthly
  return is Simple Dietz between two month-end values. A missing debit three days after the charge
  day is an in-app alert.
- A pocket's "Interest earned on backing" is now the account's last 12 months of interest × the
  pocket's share of the balance, as an estimate.

## Settings, Admin and the API (F8)

- **Admin › Users** (`/settings/users`, admins only): the list with the invitations still pending,
  "Invite user" (a single-use link, seven days), the role selector, block/unblock, "Reset password"
  and "Remove". The last admin cannot be demoted, blocked or removed, and nobody blocks or removes
  themselves — an instance nobody can administer is repaired only from the container. Removing a
  user deletes their row first (the foreign keys take the rest) and then their `payslips/`,
  `cometa/` and `exports/` folders in S3.
- **Admin › Server** (`/settings/server`): Authentik (issuer, client id, secret, admin group, "Test
  connection") and outgoing mail (host, port, encryption, credentials, from address, "Send test
  email"), both saved in `app_settings` with the secret sealed. `.env.homelab` stays the initial
  value and a saved setting wins over it, so a fresh instance runs on the environment file alone.
  Better Auth and the mail transport notice a change within 30 seconds; **changing the issuer signs
  every user out**. Three switches decide what the server may send at all: invitations and resets,
  sync failures, the monthly summary — with "invitations & resets" off the password reset link does
  not go out either.
- **Personal access tokens** (`/settings/security`): `pat_<prefix>.<secret>`, shown once, kept as a
  SHA-256 digest with scopes `read`, `write`, `imports`, an optional expiry and revocation.
- **`/api/v1`** (Hono, `src/app/api/v1/[[...route]]/route.ts`): `GET /accounts`,
  `GET /accounts/{id}/balances`, `GET /transactions`, `GET /summary` (scope `read`),
  `POST /accounts/{id}/balances` (`write`) and `POST /imports` (`imports`). A token acts as its
  user and never beyond them; there is no administrative route at all. Amounts travel as decimal
  strings, never as JSON numbers. 120 calls a minute per token, per worker.

  ```bash
  curl -sS -H "Authorization: Bearer pat_…" https://dash.longobardo.me/api/v1/summary
  ```

- **Export.** "Export my data" (Settings › Data) streams a ZIP of every table as CSV, the same rows
  as one JSON, and the original documents. "Export all data" (Admin › Server) is the `export-all`
  job, which writes one archive per person under `exports/<userId>/`.
- **Backups.** `database-backup` runs daily: `pg_dump -Fc` (from `postgresql18-client`, in the
  image) held in memory — the container's filesystem is read only — and uploaded to `backups/`,
  thirty kept, pruned by `housekeeping`. The dump is not encrypted: a backup that only opens with
  the application's own key ring cannot help when the application is what was lost.
- **Alerts.** A job that fails tells the admins through Gotify, if `GOTIFY_URL` and `GOTIFY_TOKEN`
  are set; without them nothing is sent and nothing is logged about it. `monthly-summary` emails
  whoever asked for it in their preferences, on the 1st, about the month just ended.
- **Running a job by hand**: Settings › Integrations lists every registered job with its schedule
  and its last run, and an admin can press "Run now" (it takes the job's lock, so a job already
  running is skipped rather than started twice).

## Check

```bash
npm run format:check && npm run lint && npm run typecheck && npm test && npm run test:integration
docker compose build && docker compose up -d   # deploy, then:
npm run e2e
```

- **Unit** (`npm test`) needs nothing but Node.
- **Integration** (`npm run test:integration`, `scripts/test-integration.sh`) runs in a throwaway
  Node container on `db_internal`, against the separate `ledgerly_test` database of the homelab
  Postgres — its schemas are dropped and recreated on every run, so it must never be `ledgerly` —
  and against Silo, in the app's bucket under `tests/` only. Create the database once, as the
  Postgres superuser: `CREATE DATABASE ledgerly_test OWNER ledgerly;`.
- **End-to-end** (`npm run e2e`) drives the deployed site. Before the run the seed
  (`scripts/seed-e2e.ts`, through `scripts/on-homelab.sh`) creates four users on `@example.test`
  with their sample data; after it, it deletes them and everything they own. It never touches
  anyone else's data. Nothing that needs a real mailbox or an Authentik login is tested end to end.

## Docker

`docker-compose.yml` is the homelab deployment: the `ledgerly` app behind Traefik on
`proxy_public`, and the `ledgerly-cron` sidecar beside it on `db_internal`. Both read
`.env.homelab`, and both are discovered by
`projects/stack.sh`, so `./stack.sh up` starts them along with the other projects.

```bash
docker compose build          # or: docker compose up -d --build
```

Being on `db_internal` is what lets the app reach `postgres:5432` and `silo:9000` by name; those
are internal-only and unreachable from a workstation, which is why the scripts that need them
(`scripts/on-homelab.sh`, `scripts/test-integration.sh`) run in a container on that network.
`dash.longobardo.me` is reachable from the public internet, but through one door only (spec D20).
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
tick runs every job in `JOBS` (`src/platform/jobs/registry.ts`: `wallet-sync` then
`subscriptions-check` and `funds-deposits` hourly, `housekeeping`, `accounts-alerts` and
`interests-accrual` daily, `accounts-snapshot` and `pockets-accrual` monthly) for that tier, in that order; touching the heartbeat file is a side
effect of every tick, not a job of its own.

## Operations

- **Bootstrap the owner account**, before the app is reachable by anyone else, either by:
  - running `ADMIN_PASSWORD=<12-128 chars> npm run user:create-admin -- <email> "<name>"`
    (`scripts/create-admin.ts`) on the homelab host — it is not built into the Docker image, and
    runs through `scripts/on-homelab.sh` with the deployment's `.env.homelab`; or
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
    `<BETTER_AUTH_URL>/api/auth/callback/authentik`. That path is the **social** callback, not the generic-OAuth one
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
    in the running app touches S3 — only the storage integration tests do, under `tests/`.
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
