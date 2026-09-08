# Finance Dashboard

A personal finance and household-admin dashboard: net worth across accounts,
expenses, interest accrual, funds, budgets, payroll ingestion and time off.
Single-tenant (one owner, OIDC-gated), built as a modular, API-first,
PostgreSQL-canonical platform.

It was rebuilt in phases from a working single-file app. See
[the design spec](docs/superpowers/specs/2026-09-02-finance-company-platform-design.md)
for the target architecture and the phase plan, and
[`docs/superpowers/handoff/`](docs/superpowers/handoff/) for the checkpoint of
each phase.

## Status: Phases 0–9 implemented; Phase 6 is what is deployed

- **Phase 0** — platform foundations: `Principal`/permissions, RLS-scoped
  Postgres access, a Hono REST API at `/api/v1` (error envelope, idempotency,
  optimistic concurrency, rate limiting, audit, generated OpenAPI with a drift
  test), a job registry behind a single tiered `/api/jobs/tick` endpoint, and
  capability-driven navigation.
- **Phase 1** — `accounts`: manual accounts, the Budget Makers Wallet adapter,
  account groups, net-worth series, and the retirement of the Teable Allocation
  table.
- **Phase 2** — the integration framework: encrypted credentials, the sync
  engine and queue, inbound webhooks, Settings › Integrations.
- **Phase 3** — `expenses` and `interests`.
- **Phase 4** — `payroll`: the payslip upload/ingest/review/apply pipeline,
  document originals in an S3-compatible store, Company Overview and Earnings.
- **Phase 5** — `funds`: plans, effective schedules, signed contributions,
  reconciliation.
- **Phase 6** — `budgets`: versioned initial amounts, virtual allocations,
  derived usage. **This is the deployed build.**
- **Phase 7 (reduced)** — `timeoff`: types, payroll-derived balances, booked
  days, the Trek two-way sync, and the drop of every remaining legacy table.
- **Phase 8 (reduced)** — personal access tokens: Bearer authentication for the
  API, managed from Settings › Security.
- **Phase 9 (reduced)** — session-level job locking, a retention job, inbound
  webhook replay protection and rate limiting, and the management operations
  (categories, labels, payroll mapping rules, reconciliation issues, sync-job
  toggles) as API and server actions.

Phases 7–9 were executed in reduced form: the UI is deliberately bare where a
page exists at all, because it is being redesigned.
[`docs/superpowers/DEFERRED.md`](docs/superpowers/DEFERRED.md) is the list of
what was postponed and where each item is specified in full.

## Stack

- Next.js 16.3 (App Router, `output: standalone`), React 19, TypeScript,
  Tailwind 4, Base UI, uPlot.
- Hono + `@hono/zod-openapi` mounted inside Next.js for the REST API.
- Drizzle ORM 0.45 + drizzle-kit over Postgres 18, with Postgres row-level
  security as the tenancy boundary.
- Auth.js v5 (beta), single OIDC provider (Authentik), plus personal access
  tokens for scripts.
- `dashboard-cron` — a supercronic sidecar that calls `/api/jobs/tick` on
  three schedules (hourly, daily, monthly).
- Vitest (unit + Postgres-backed integration), Playwright (e2e).

See [`docs/architecture/overview.md`](docs/architecture/overview.md) for the
module layout and the conventions this stack is organized around.

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
(`GET /api/health`) within about a minute. For an actual release — rather than
a first local bring-up — follow [`docs/deploy/README.md`](docs/deploy/README.md)
instead of a bare `up -d`: it has the ordered sequence including the backup,
the migration step and the post-deploy checks, and the release notes for the
current change.

## Developing

All application code lives in `dashboard-app/`; work from there.

```bash
cd dashboard-app
npm install
npm run dev          # http://localhost:3000
```

`npm run dev` and `npm run build && npm run start` both need the full
environment `src/lib/env.ts` validates at boot (`DATABASE_URL`, `AUTH_*`,
`OIDC_*`, `AUTHORIZED_SUB`, `APP_ENCRYPTION_KEY`, `CRON_SECRET`,
`WEBHOOK_SECRET`) — [`docs/deploy/README.md`](docs/deploy/README.md) has the
full matrix with defaults and what each one is for.

### Testing

```bash
npm test              # unit tests (vitest run) — no database needed
npm run typecheck     # tsc --noEmit
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

End-to-end tests drive a real running instance with Playwright. They never
sign in — Authentik owns that — so they cover the unauthenticated surface and,
with a personal access token in `E2E_TOKEN`, the REST API.
[`dashboard-app/tests/e2e/README.md`](dashboard-app/tests/e2e/README.md) has
the exact environment to export and how to mint the token:

```bash
npm run e2e   # E2E_BASE_URL defaults to http://localhost:3000
```

`npm run lint` is currently broken and is not a merge gate.

## Documentation

- [`docs/architecture/overview.md`](docs/architecture/overview.md) — module
  layout, the use-case rule, RLS context, authentication, job tiers, API
  conventions, known deviations.
- [`docs/api/README.md`](docs/api/README.md) — how to authenticate, the error
  envelope, pagination, idempotency, optimistic concurrency, one example per
  module, how to regenerate the OpenAPI document.
- [`docs/api/openapi.json`](docs/api/openapi.json) — the generated OpenAPI
  document, kept in sync with the code by a drift test.
- [`docs/deploy/README.md`](docs/deploy/README.md) — the release procedure, the
  environment matrix, job tiers, backup and rollback, and the notes for the
  release now pending.
- [`docs/integrations/README.md`](docs/integrations/README.md) — the provider
  framework and how to add one.
- [`docs/migration/README.md`](docs/migration/README.md) — what the Teable →
  Postgres migration did, for the record.
- [`docs/superpowers/DEFERRED.md`](docs/superpowers/DEFERRED.md) — everything
  the reduced phases postponed, and where each item is specified.
- [`docs/superpowers/specs/2026-09-02-finance-company-platform-design.md`](docs/superpowers/specs/2026-09-02-finance-company-platform-design.md)
  — the full design and phased plan.
- [`BRAND.md`](BRAND.md) — the visual identity. Note that the UI built in
  Phases 7–9 deliberately does not follow it; it is being redesigned.
