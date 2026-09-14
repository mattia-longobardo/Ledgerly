# Finance Dashboard

Personal finance and household-admin dashboard. Version 0.1 is a from-scratch rebuild; the design is in
[`docs/specs/2026-09-13-dev-0.1-design.md`](docs/specs/2026-09-13-dev-0.1-design.md) and each phase has its
plan in [`docs/plans/`](docs/plans/).

## Develop

Prerequisites: Node.js ≥22.12 and Docker.

```bash
npm install
cp .env.example .env
npm run dev:services   # Postgres, MinIO, Mailpit, mock OIDC (compose.dev.yml)
npm run db:migrate
npm run dev:seed       # creates the owner account
npm run dev            # http://127.0.0.1:3000
```

Open `http://127.0.0.1:3000` — use `127.0.0.1`, not `localhost`, so the OIDC issuer matches the dev
identity provider. Sign in as `owner@example.test` / `owner-password-123`, or with **Continue with
Authentik** as `admin@example.test` (admin) or any other address (user) on the mock provider.

Mailpit (outgoing mail): `http://127.0.0.1:58025`. MinIO console: `http://127.0.0.1:59001`.

## Check

```bash
npm run format:check && npm run lint && npm run typecheck && npm test && npm run test:integration && npm run e2e
```

## Docker

```bash
docker build -t finance-dashboard:dev .
docker build -t finance-dashboard-cron:dev cron
```

The app image applies pending migrations on boot, then serves the standalone Next.js server. The cron
image runs the scheduled jobs (housekeeping, heartbeat) with the `supercronic` sidecar.

## Operations

- **Before exposing the app:** bind the Authentik application to a group, and create the owner account —
  either `npm run user:create-admin`, or let the first sign-in (password or SSO) become admin. The very
  first user to sign in is granted the admin role automatically; do this before the app is reachable by
  anyone else.
- **SSO never demotes admins:** removing someone from the Authentik admin group stops new sign-ins from
  granting the admin role, but does not revoke an admin role already held in the app. Demote a user from
  Settings inside the app itself.
- **Prometheus:** scrape `GET /api/metrics` with `METRICS_TOKEN` as a bearer credential, for example:
  ```yaml
  scrape_configs:
    - job_name: finance-dashboard
      metrics_path: /api/metrics
      authorization:
        credentials: <METRICS_TOKEN>
      static_configs:
        - targets: ["finance-dashboard:3000"]
  ```
- **Production requirements:** `BETTER_AUTH_URL` and `OIDC_DISCOVERY_URL` must be `https` (loopback
  `http` is only accepted outside production); `BETTER_AUTH_SECRET` must not be the `.env.example`
  placeholder; `METRICS_TOKEN` must be set; and when `SMTP_USER` is set, `SMTP_SECURE` or
  `SMTP_REQUIRE_TLS` must be enabled so credentials never travel in plaintext.

## Documentation

The full design and every binding decision: [`docs/specs/2026-09-13-dev-0.1-design.md`](docs/specs/2026-09-13-dev-0.1-design.md).
Phase-by-phase implementation plans: [`docs/plans/`](docs/plans/).
