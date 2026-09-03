# Architecture overview — Phase 0 + Phase 1

This describes what `dashboard-app` actually is after Phase 0 (platform
foundations) and Phase 1 (accounts, Teable retirement). It follows the target
shape from
[`docs/superpowers/specs/2026-09-02-finance-company-platform-design.md`](../superpowers/specs/2026-09-02-finance-company-platform-design.md)
§3; read that document for the rationale, this one for what is on disk today.

## Module layout

```
src/
  modules/accounts/
    domain/          Account, AccountGroup, BalancePoint, net-worth math — no IO
    application/      one file per use case (create-manual-account.ts, ...), ports.ts (interfaces)
    infrastructure/   Drizzle repositories, the Wallet adapter, the Teable importer
    api/               Hono routes (routes.ts) + Zod schemas (schemas.ts)
    ui/                 server-component loaders (load-overview.ts), client components
  modules/home/         Home page card composition (cards.ts)
  platform/
    auth/               Principal, permission catalogue, resolvePrincipal, require-principal
    capabilities/       resolveCapabilities, buildNavigation, the production probes
    db/                 RLS context (withUserContext/withSystemContext)
    http/               createApiApp, ApiError, idempotency, rate limiting, versioning
    jobs/               job registry, tick dispatch
    audit/               recordAudit
  lib/                  everything not yet migrated into a module: db client/schema/migrate,
                          env, jobs (sweep, trek-sync, wallet-refresh, monthly-close, wallet-accounts-sync),
                          payroll parsing, calc (money/net-worth/cometa), clients (wallet, trek, paperless)
  app/                   Next.js routes only — thin, call use cases and render ui/
```

Only `accounts` is a full module today; everything payroll/trek/paperless-related
still lives under `src/lib/*` and moves into its own module in a later phase
(§11 Phase 4 and after). `src/modules/home/cards.ts` is the first cross-module
composition point: it reads `Capabilities` and the accounts overview to decide
what Home shows.

## The use-case rule

UI and API never diverge because they call the **same use case functions**.
Concretely, for accounts:

- `src/modules/accounts/api/routes.ts` (the HTTP layer) and
  `src/modules/accounts/ui/load-overview.ts` (the server-component loader)
  both call `listAccounts`, `getAccountDetail`, `netWorthSeries`, etc. from
  `application/*.ts`.
- Every use case takes a `UseCaseDeps` bag (`application/deps.ts`):
  `{ accounts, links, groups, clock, audit }`, each an interface from
  `application/ports.ts` (`AccountsRepository`, `ProviderLinksRepository`,
  `GroupsRepository`, `Clock`). Use cases never import Drizzle, `fetch`, or
  `node:*` — only these ports.
- Production assembles `UseCaseDeps` in `infrastructure/deps.ts`
  (`accountDeps(tx, requestId)`), binding the Drizzle-backed repositories to
  one RLS transaction. Tests assemble it from
  `infrastructure/memory-repositories.ts` instead — same use case, no
  database.
- **Provider names live only in adapters.** `infrastructure/wallet-adapter.ts`
  is the only file that knows what a Wallet account payload looks like
  (`WalletAccount`, `TYPE_BY_ACCOUNT_TYPE`); it maps to the provider-neutral
  `ProviderAccount` the use cases and every other layer speak. Adding a
  second provider means writing a second adapter, not touching a use case.

This is why `WalletSyncResultSchema`'s route
(`POST /api/v1/integrations/wallet/sync`) is a thin wrapper: it builds
`walletAccountsSource(clock)` and calls `syncProviderAccounts`, the same
function a future scheduled job would call.

## RLS context and the `system` role

`src/platform/db/context.ts` exposes two entry points, both transaction-scoped
via `set_config(..., true)` (never leaks across pooled connections):

- `withUserContext(db, { userId }, fn)` — sets `app.user_id` and
  `app.role = 'user'`. Every account/group/balance table has
  `FORCE ROW LEVEL SECURITY` with a policy of the shape
  `app_is_system() OR user_id = app_current_user_id()` (see
  `drizzle/0006_accounts.sql`), so a query inside this context can only see
  the caller's own rows — enforced by Postgres, not application code.
- `withSystemContext(db, fn)` — sets `app.role = 'system'`, bypassing the
  per-user filter. Used by jobs and one-off scripts (`migrate-teable.mjs`
  resolves the single owner and imports on their behalf; the tick endpoint
  runs jobs this way) that legitimately act across users or before a
  `Principal` exists.

Every API route wraps its use-case call in `withUserContext(deps.db, {
userId: principal.userId }, tx => ...)`; there is no code path in the
`accounts` module that queries the database outside an RLS context.

## Job tiers

`src/platform/jobs/registry.ts` is a small in-memory registry:
`registerJob({ name, tier, run })`, `runTier(tier, input)`. Tiers are
`"hourly" | "daily" | "monthly"`. `src/platform/jobs/register-all.ts`
(`ensureJobsRegistered`, idempotent) wires up the five jobs that exist today:

| Job | Tier | Source |
|---|---|---|
| `sweep` | hourly | `src/lib/jobs/sweep.ts` |
| `trek_sync` | hourly | `src/lib/jobs/trek-sync-job.ts` |
| `wallet_refresh` | daily | `src/lib/jobs/wallet-refresh.ts` |
| `wallet_accounts_sync` | daily | `src/lib/jobs/wallet-accounts-sync.ts` |
| `monthly_close` | monthly | `src/lib/jobs/monthly-close.ts` |

`POST /api/jobs/tick?tier=hourly|daily|monthly` (machine-authenticated via
`X-Cron-Secret`, see `src/lib/auth/machine.ts`) calls `runTier`, which runs
every job in that tier and returns per-job results; a failed job does not
stop the others. The `dashboard-cron` supercronic sidecar
(`cron/crontab`) calls this endpoint on three schedules — hourly at `:07`,
daily at local noon, monthly at `23:59` on the 1st — all in the container's
`Europe/Rome` timezone. Before Phase 0 the crontab called four separate
per-job endpoints directly; those individual routes
(`/api/jobs/sweep`, `/api/jobs/wallet-refresh`, `/api/jobs/trek-sync`) still
exist unchanged and are still machine-authenticated the same way, but the
crontab no longer calls them — it calls the tiered `tick` endpoint, which
dispatches through the job registry instead. The individual routes remain
live as a secondary path: `/api/jobs/run` (session-authenticated) is the
"run now" action from the UI, and calls the same job functions directly by
name rather than by tier.

## API conventions

`src/platform/http/app.ts` (`createApiApp`) mounts a Hono `OpenAPIHono` app at
base path `/api/v1`, wired into Next.js via
`src/app/api/v1/[[...route]]/route.ts` (`hono/vercel`'s `handle`). Middleware
order: request id → authenticate (session cookie today; see
`docs/api/README.md`) → CSRF header check → rate limit → route handlers →
`onError`.

- **Error envelope**: `{ error: { code, message, requestId, details? } }`
  (`src/platform/http/errors.ts`, `ApiError`/`toErrorBody`). `code` is one of
  a fixed catalogue: `validation_failed`, `unauthorized`, `permission_denied`,
  `csrf_required`, `not_found`, `conflict`, `version_mismatch`,
  `precondition_required`, `idempotency_key_reused`, `rate_limited`,
  `integration_unavailable`, `internal`.
- **CSRF (spec §8.3)**: a `POST`/`PUT`/`PATCH`/`DELETE` authenticated by the
  session cookie must carry `X-Requested-With` with any non-empty value, or it
  is refused with `403 csrf_required` before any handler runs.
  `ApiDeps.authenticate` reports *how* the caller authenticated (`{ principal, method:
  "session" | "token" }`) precisely so the check can exempt a token, which a
  browser never attaches by itself. Only the header's presence is checked: a
  cross-site form cannot set one without a CORS preflight this app answers for
  nobody.
- **Idempotency**: `src/platform/http/idempotency.ts`. Required (`428` if
  missing) on `POST /accounts` and `POST /accounts/{id}/balances` via
  `Idempotency-Key`. Keyed on `(principalId, key)`, stores a sha256 of
  `METHOD path\nbody`, replays the stored response on an exact repeat, and
  returns `422 idempotency_key_reused` if the same key is reused with a
  different request. TTL 24h (`idempotency_keys` table, migration `0005`). A
  `5xx` is never stored — caching a transient failure would hand it straight
  back to the retry that was meant to escape it.
- **Versioning (optimistic concurrency)**: `src/platform/http/versioning.ts`.
  Every mutable entity carries `version`; `PATCH` reads it from `If-Match`
  (falls back to body `version`), `428 precondition_required` if neither is
  present, `409 version_mismatch` from the use case if it's stale.
- **Pagination**: cursor-based, `GET /accounts/{id}/balances` — `cursor` is
  the base64url of the previous page's last `asOf`, response is `{ items,
  nextCursor? }`, `limit` clamped to `[1, 200]` (default 50).
- **Rate limiting**: `src/platform/http/rate-limit.ts`, a per-principal
  fixed-window counter in Postgres (`rate_limit_windows`, migration `0005`),
  300 requests/minute by default, `RateLimit-Limit`/`RateLimit-Remaining`
  headers, `429 rate_limited` over the limit. No Redis dependency — single
  instance, and the counter is a plain upsert.
- **Audit**: `src/platform/audit/record.ts` (`recordAudit`), written by every
  mutating use case via `UseCaseDeps.audit`, into `audit_events` (migration
  `0004`) with actor, action, entity, before/after, and `requestId`.
- **OpenAPI + drift test**: `app.doc("/openapi.json", ...)` builds the
  document from the same `createRoute`/Zod schemas the handlers use.
  `docs/api/openapi.json` is the committed snapshot;
  `src/platform/http/openapi-drift.test.ts` fails if `scripts/openapi.ts`'s
  output no longer matches it. Regenerate with `npm run openapi:generate`.

Permissions (`src/platform/auth/permissions.ts`) are a fixed catalogue —
`accounts.read`, `accounts.write`, `accounts.delete`, `finance.manage`,
`integrations.manage`, `jobs.run`, `admin.users`, `admin.audit` — granted per
role (`owner`, `admin`, `member`, `viewer`). `assertPermission(principal,
permission)` throws `PermissionDeniedError`, caught by `app.onError` and
turned into `403 permission_denied`.

## Capability-driven navigation and Home

`src/platform/capabilities/resolve.ts` (`resolveCapabilities`) is a pure
function of a `Principal` and a `CapabilityProbes` interface — no `@/lib/db`
or `node:fs` import, so it is unit-testable without a database. It answers
two separate questions per the module's own doc comment:

- `features` — should this section be reachable at all (`accounts`, `funds`,
  `budgets` are always on; `expenses`/`interests` need Wallet connected;
  `payroll`/`timeoff` need their own integrations).
- `data` — is the section empty even though it's reachable
  (`hasAccounts`, `hasPayrollRecords`), so a page can render a setup empty
  state instead of a wall of zeros.

`src/platform/capabilities/probes.ts` (`realProbes`) is the production
wiring — file reads for token presence, `COUNT(*)` queries for data — kept
apart from `resolve.ts` precisely so the resolver stays free of IO for its
own tests. Both data probes take the principal's `userId`: `accounts` carries
`FORCE ROW LEVEL SECURITY`, so `hasAccounts` counts inside
`withUserContext` — the same count on the bare pool sees no rows at all and
would answer "no accounts" for everybody. `hasPayrollRecords` still counts
`payslips` directly; that table has no RLS until payroll becomes a module
(Phase 4).

`src/platform/capabilities/navigation.ts` (`buildNavigation`) and
`src/modules/home/cards.ts` are both pure functions of the resulting
`Capabilities` object: a nav entry or Home card exists only when its
capability is present — there is no "coming soon" placeholder state anywhere
in the shell. The Home net-worth curve is loaded server-side by
`src/modules/accounts/ui/load-overview.ts`, which calls the same
`netWorthSeries` use case `GET /api/v1/net-worth` calls — directly, not over
HTTP, per the use-case rule above.

## What's deferred to later phases

Per the spec's phased plan (§11), Phase 1 explicitly does not include:

- Personal access tokens for the API (Phase 8) — session cookie is the only
  auth today.
- Outbound webhooks (Phase 9).
- `integration_connections` with encrypted, UI-managed credentials (Phase 2)
  — Phase 1 still reads the Wallet token from a mounted file
  (`WALLET_TOKEN_FILE`).
- Budgets, Expenses, Interests, and Management beyond the placeholder
  navigation entries `buildNavigation` already renders (Budgets
  unconditionally, Expenses/Interests once Wallet is connected, Management
  for principals holding `finance.manage`) — no domain module, use cases, or
  tables exist behind any of these links yet.
- The payroll/earnings/timeoff domain moving out of `src/lib/*` into its own
  module (Phase 4).

## Known deviations

Places where what is on disk knowingly departs from the target shape, with the
phase that closes each:

- **No RLS on `audit_events`, `idempotency_keys` and `rate_limit_windows`**
  (Phase 2). Every other user-scoped table has `FORCE ROW LEVEL SECURITY`;
  these three do not. They are written by middleware and by the audit sink,
  which run *outside* any `withUserContext` transaction — the rate limiter
  counts before a route handler opens one, the idempotency middleware reads and
  writes around the handler, and `recordAudit` is called with the request's own
  connection. A policy of the usual shape would make all three invisible to
  themselves. Rows are still scoped by an explicit `principal_id`/actor column
  in every query, so the exposure is an in-process one, not a cross-user API
  read. The policies arrive with the per-user connection work in Phase 2, which
  gives these paths a user context to run in.
- **Wallet sync is owner-only** rather than permission-only.
  `integrations.manage` is granted to `admin` and `member` too, but a sync rewrites the whole
  household account graph, and until Phase 2 gives an integration connection
  its own owner there is no per-user connection to scope it to. Enforced in one
  place, `assertWalletSyncAllowed`
  (`src/modules/accounts/application/sync-provider-accounts.ts`), shared by the
  API route and the Server Action.
