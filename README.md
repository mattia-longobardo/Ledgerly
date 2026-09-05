# Finance Dashboard

A personal finance and household-admin dashboard: net worth across accounts,
fund tracking, and (in later phases) budgets, expenses, interest accrual, and
payroll ingestion. Single-tenant today (one owner, OIDC-gated), built to grow
into a small multi-domain platform without a rewrite.

It is being rebuilt in phases from a working single-file app into a modular,
API-first, PostgreSQL-canonical platform. See
[the design spec](docs/superpowers/specs/2026-09-02-finance-company-platform-design.md)
for the target architecture and the full phase plan, and
[the Phase 0/1 implementation plan](.superpowers/sdd/2026-09-02-phase-0-1-foundations-and-accounts/2026-09-02-phase-0-1-foundations-and-accounts.md)
for how this slice was built task by task.

## Status: Phase 0 + Phase 1 complete

- **Phase 0** — platform foundations: `Principal`/permissions, RLS-scoped
  Postgres access, a Hono-based REST API at `/api/v1` (error envelope,
  idempotency, optimistic concurrency, rate limiting, audit, generated
  OpenAPI with a drift test), a job registry behind a single tiered
  `/api/jobs/tick` endpoint, and capability-driven navigation.
- **Phase 1** — the `accounts` module: manual accounts, the Budget Makers
  Wallet adapter (sync, archive detection), account groups, net-worth series,
  and the retirement of the Teable-based Allocation table it replaces
  (migration + reconciliation script, documented in
  [`docs/migration/README.md`](docs/migration/README.md) and
  [`docs/deploy/phase-1-runbook.md`](docs/deploy/phase-1-runbook.md)).

Everything from Phase 2 onward (integrations UI, Expenses, Interests, Budgets,
payroll upload, Time Off, Administration) is still on the plan, not built.

## Stack

- Next.js 16.3 (App Router, `output: standalone`), React 19, TypeScript,
  Tailwind 4, Base UI, uPlot.
- Hono + `@hono/zod-openapi` mounted inside Next.js for the REST API.
- Drizzle ORM 0.45 + drizzle-kit over Postgres 18, with Postgres row-level
  security as the tenancy boundary.
- Auth.js v5 (beta), single OIDC provider (Authentik).
- `dashboard-cron` — a supercronic sidecar that calls `/api/jobs/tick` on
  three schedules (hourly, daily, monthly).
- Vitest (unit + Postgres-backed integration), Playwright (e2e).

See [`docs/architecture/overview.md`](docs/architecture/overview.md) for the
module layout and conventions this stack is organized around.

## Running it

The app is deployed via Docker Compose (`docker-compose.yml` at the repo
root): the `dashboard-app` service (image `dashboard:latest`, migrations
applied at boot by `entrypoint.sh`) plus the `dashboard-cron` sidecar, both on
the shared `db_internal`/`proxy_public` networks alongside the shared
Postgres 18 container (`postgres`, database `dashboard`).

```bash
cp .env.example .env   # fill in secrets — see the comments in the file
docker compose build
docker compose up -d
```

`docker compose ps` should show `dashboard-app` healthy
(`GET /api/health`) within about a minute. For a first deploy or an upgrade
that touches the Teable migration, follow
[`docs/deploy/phase-1-runbook.md`](docs/deploy/phase-1-runbook.md) instead of
a bare `up -d` — it has the exact, ordered command sequence including backup,
migration sequencing, and rollback.

## Developing

All application code lives in `dashboard-app/`; work from there.

```bash
cd dashboard-app
npm install
npm run dev          # http://localhost:3000
```

`npm run dev` and `npm run build && npm run start` both need the full
environment `src/lib/env.ts` validates at boot (`DATABASE_URL`, `AUTH_*`,
`OIDC_*`, `AUTHORIZED_SUB`, `PAPERLESS_*`, `CRON_SECRET`, `WEBHOOK_SECRET`,
...) — see `.env.example` at the repo root for the full list and what each
one is for.

### Testing

```bash
npm test              # unit tests (vitest run) — no database needed
npm run typecheck      # tsc --noEmit
```

Integration tests exercise real Postgres RLS policies and need the
throwaway test database:

```bash
npm run test:db:up          # docker compose -f docker-compose.test.yml up -d --wait
npm run test:integration    # vitest run --config vitest.integration.config.ts
npm run test:db:down        # tear it down when done
```

(`npm run test:all` runs both `test` and `test:integration` in sequence,
still assuming `test:db:up` has already been run.)

End-to-end tests drive a real running instance with Playwright
(`dashboard-app/tests/e2e/`, see its own README for what's implemented versus
still planned):

```bash
npm run test:db:up
DATABASE_URL=postgresql://app_test:app_test@localhost:55432/dashboard_test \
AUTH_URL=http://localhost:3000 AUTH_SECRET=$(openssl rand -base64 32) \
OIDC_ISSUER=http://localhost:9999/application/o/dashboard/ \
OIDC_CLIENT_ID=x OIDC_CLIENT_SECRET=x AUTHORIZED_SUB=x \
PAPERLESS_URL=http://localhost:9998 PAPERLESS_TOKEN=x \
CRON_SECRET=$(openssl rand -hex 16) WEBHOOK_SECRET=$(openssl rand -hex 16) \
  npm run build && npm run start &   # or `npm run dev` for a faster loop
npm run e2e   # E2E_BASE_URL defaults to http://localhost:3000
```

`npm run lint` is currently broken and is not a merge gate.

## Documentation

- [`docs/architecture/overview.md`](docs/architecture/overview.md) — module
  layout, the use-case rule, RLS context, job tiers, API conventions,
  capability-driven navigation.
- [`docs/api/README.md`](docs/api/README.md) — how to authenticate, the error
  envelope, pagination, idempotency, optimistic concurrency, how to
  regenerate the OpenAPI document, the endpoint list.
- [`docs/api/openapi.json`](docs/api/openapi.json) — the generated OpenAPI
  document, kept in sync with the code by a drift test.
- [`docs/migration/README.md`](docs/migration/README.md) — the Teable →
  Postgres migration scripts.
- [`docs/deploy/phase-1-runbook.md`](docs/deploy/phase-1-runbook.md) — the
  exact deployment sequence for Phase 1, including rollback.
- [`docs/superpowers/specs/2026-09-02-finance-company-platform-design.md`](docs/superpowers/specs/2026-09-02-finance-company-platform-design.md)
  — the full design and phased plan.
- [`BRAND.md`](BRAND.md) — the visual identity.
