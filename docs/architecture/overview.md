# Architecture overview

What `dashboard-app` is today, at the close of the platform rebuild (Phases
0–9; Phases 7–9 were executed in reduced form — see
[`docs/superpowers/plans/2026-09-07-phases-7-9-reduced-conventions.md`](../superpowers/plans/2026-09-07-phases-7-9-reduced-conventions.md)).
The target shape and the rationale are in
[the design spec](../superpowers/specs/2026-09-02-finance-company-platform-design.md)
§3; read that for *why*, this for *what is on disk*.

A single-tenant personal finance and household-admin platform: Next.js 16 App
Router in front, a Hono REST API at `/api/v1` beside it, Drizzle over
Postgres 18 underneath, and Postgres row-level security as the tenancy
boundary. Identity is Authentik (OIDC) through Auth.js; scripts authenticate
with personal access tokens instead.

## Module layout

Nine domain modules plus `home`, each with the same four layers. `domain/` is
pure (no IO), `application/` holds one file per use case plus the port
interfaces, `infrastructure/` binds those ports to Drizzle and to provider
adapters, `api/` is the Hono surface, `ui/` the server-component loaders.

| Module | What it owns |
|---|---|
| `src/modules/accounts` | Manual and synced accounts, groups, balance history, net-worth series |
| `src/modules/integrations` | The provider framework: connect / test / sync / disconnect, encrypted credentials, the sync engine and queue, inbound webhooks |
| `src/modules/expenses` | Transactions, categories, labels, transfer pairing, recurring-pattern detection |
| `src/modules/interests` | Interest rules, accruals, posting entries back to the provider |
| `src/modules/payroll` | Payslip upload, ingest, review and apply; pay periods, component mapping, earnings; document originals and their retention |
| `src/modules/funds` | Funds, plans, effective schedules, signed contributions and reversals, reconciliation issues |
| `src/modules/budgets` | Budgets, versioned initial amounts, virtual allocations, scopes and derived usage |
| `src/modules/timeoff` | Time-off types, payroll-derived balances, booked days, the Trek two-way sync |
| `src/modules/security` | Personal access tokens: create, list, revoke |
| `src/modules/home` | Cross-module Home card composition (`cards.ts`) |

Everything not in a module lives in `src/lib` (the database client, schema and
migrations; `env.ts`; the job bodies; the payslip parsing engine; money and
series math; the Wallet/Trek/Gotify HTTP clients) or in `src/platform`:

| Platform piece | Path |
|---|---|
| `Principal`, permission catalogue, `resolvePrincipal` | `src/platform/auth/principal.ts`, `src/platform/auth/permissions.ts` |
| Personal access tokens (generate, hash, authenticate) | `src/platform/auth/pat.ts` |
| Credential resolution for the API (Bearer, then cookie) | `src/platform/http/authenticate.ts` |
| RLS context (`withUserContext` / `withSystemContext`) | `src/platform/db/context.ts` |
| The API app, error envelope, idempotency, rate limiting, versioning | `src/platform/http` |
| Job registry and tick dispatch | `src/platform/jobs` |
| Audit writes | `src/platform/audit/record.ts` |
| Capability resolution and navigation | `src/platform/capabilities` |
| The `IntegrationProvider` contract, registry, credential crypto | `src/platform/integrations` |

`src/app` is Next.js routing only: pages call a `ui/` loader, server actions in
`src/app/actions` call the same use cases the API calls, and
`src/app/api/v1/[[...route]]/route.ts` mounts the Hono app.

## The use-case rule

UI and API never diverge because they call the **same use case functions**. A
use case takes a `UseCaseDeps` bag of port interfaces from its module's
`application/ports.ts` and never imports Drizzle, `fetch` or `node:*`.
Production assembles that bag in `infrastructure/deps.ts`, binding the
Drizzle-backed repositories to one RLS transaction; a route wraps the call in
`withUserContext`, a page does the same through the module's `ui/run.ts`.

Provider names live only in adapters.
`src/modules/accounts/infrastructure/wallet-adapter.ts` is the only file that
knows what a Wallet account payload looks like; everything upstream speaks the
provider-neutral `ProviderAccount`, `ProviderCode` and `SyncKind`.

From Phase 7 on, the modules keep **no memory repositories**: use cases are
proven in `*.itest.ts` against a real Postgres (`src/test/db.ts`), and
`*.test.ts` covers pure domain functions only. `accounts` still carries
`src/modules/accounts/infrastructure/memory-repositories.ts` from before that
rule.

## RLS context and the `system` role

`src/platform/db/context.ts` has exactly two entry points, both scoped to a
transaction via `set_config(..., true)` so nothing leaks across pooled
connections:

- `withUserContext(db, { userId }, fn)` sets `app.user_id` and
  `app.role = 'user'`. Every user-owned table carries `FORCE ROW LEVEL
  SECURITY` with a policy of the shape
  `app_is_system() OR user_id = app_current_user_id()`, so a query inside this
  context can only reach the caller's own rows — enforced by Postgres, not by
  application code. **The database role must be `NOSUPERUSER`**: a superuser
  bypasses even `FORCE` policies.
- `withSystemContext(db, fn)` sets `app.role = 'system'`, used by jobs, the
  tick endpoint, token authentication and the inbound webhook — paths that act
  across users or before a `Principal` exists.

One parametric test covers the whole schema:
`src/lib/db/rls-matrix.itest.ts` iterates every user-owned table, inserts as
user A, reads as user B expecting zero rows, and expects B's insert carrying
A's `user_id` to be rejected. Constraint checks that carry business meaning
(the one-event-per-day unique index, the fraction CHECK) live in the same file.

## Authentication

Two credentials, in this order (`src/platform/http/authenticate.ts`):

1. `Authorization: Bearer pat_<8>.<43>` — a personal access token. Stored as a
   sha256 hash with a scope list; the scopes are re-intersected with the
   owner's *current* permissions on every request, so a role downgrade shrinks
   live tokens. A request carrying a Bearer credential is decided by it alone,
   with no fallback to the cookie.
2. The Auth.js session cookie, issued after the Authentik OIDC round trip.

Cookie-authenticated writes must also carry `X-Requested-With` (spec §8.3);
token-authenticated ones are exempt, because a browser never attaches a token
by itself. The three `/security/tokens` routes are session-only (Ruling
P8-2), so a leaked token cannot mint its successor.

Permissions (`src/platform/auth/permissions.ts`) are a fixed catalogue —
`accounts.*`, `funds.*`, `budgets.*`, `expenses.*`, `interests.*`,
`payroll.*`, `timeoff.*`, `finance.manage`, `integrations.manage`, `jobs.run`,
`admin.users`, `admin.audit` — granted per role (`owner`, `admin`, `member`,
`viewer`).

## Jobs

`src/platform/jobs/registry.ts` is an in-memory registry
(`registerJob({ name, tier, run })`, `runTier`);
`src/platform/jobs/register-all.ts` (`ensureJobsRegistered`, idempotent) wires
up ten jobs:

| Job | Tier | Body |
|---|---|---|
| `sweep` | hourly | `src/lib/jobs/sweep.ts` |
| `trek_sync` | hourly | `src/lib/jobs/trek-sync-job.ts` |
| `wallet_transactions_sync` | hourly | `src/lib/jobs/wallet-transactions-sync.ts` |
| `sync_queue` | hourly | `src/lib/jobs/sync-queue.ts` |
| `payroll_ingest` | hourly | `src/lib/jobs/payroll-ingest.ts` |
| `wallet_accounts_sync` | daily | `src/lib/jobs/wallet-accounts-sync.ts` |
| `interest_accrual` | daily | `src/lib/jobs/interest-accrual.ts` |
| `payroll_retention` | daily | `src/lib/jobs/payroll-retention.ts` |
| `housekeeping` | daily | `src/lib/jobs/housekeeping.ts` |
| `monthly_close` | monthly | `src/lib/jobs/monthly-close.ts` |

`POST /api/jobs/tick?tier=hourly|daily|monthly` (machine-authenticated with
`X-Cron-Secret`, `src/lib/auth/machine.ts`) runs every job in the tier and
returns per-job results; a failure in one does not stop the others. The
`dashboard-cron` supercronic sidecar (`cron/crontab`) calls it hourly at `:07`,
daily at local noon, and monthly at `23:59` on the 1st, all in `Europe/Rome`.
`/api/jobs/run` (session-authenticated) is the "Run now" button on
Settings › Administration; `/api/jobs/sweep` and `/api/jobs/trek-sync` remain
as machine-authenticated single-job endpoints.

**`withJobLock` holds a session-level advisory lock, not a transaction**
(`src/lib/repo/jobs.ts`, Ruling R9-1). It checks out one `pg` client, takes
`pg_try_advisory_lock(hashtext(key))`, runs the job body **outside** any
transaction on that client, and releases in a `finally`. A second run with the
same key gets `null` rather than blocking. This is what lets a job body open
its own short transactions — including `withUserContext` per user — instead of
holding one open for the whole run.

**`housekeeping` is the retention sweep** (Ruling R9-5): `audit_events` older
than 730 days, `job_runs`/`sync_runs`/`webhook_deliveries` older than 90,
expired `idempotency_keys`, `rate_limit_windows` older than a day. It runs in
the system context (these tables are cross-user by construction), deletes at
most 5,000 rows per table per run so a mistaken window cannot empty the audit
trail in one tick, and records the per-table counts in `job_runs.detail`.

## The REST API

`src/platform/http/app.ts` (`createApiApp`) mounts an `OpenAPIHono` app at
`/api/v1`. Middleware order: request id → authenticate → `X-Requested-With`
check → rate limit → handlers → `onError`. The full narrative — error
envelope, pagination, idempotency, optimistic concurrency, per-module
endpoints — is [`docs/api/README.md`](../api/README.md); the generated
contract is [`docs/api/openapi.json`](../api/openapi.json), kept honest by
`src/platform/http/openapi-drift.test.ts`.

Two conventions worth stating here because they are structural rather than
documentary:

- **Every idempotent write serializes on its own cache row.**
  `src/platform/http/financial-write.ts` is now the only idempotency path: it
  takes a `pg_advisory_xact_lock` keyed on `(namespace, principalId, key)`
  *before* reading the cache, so two concurrent requests with the same key
  serialize instead of racing past a read-then-write gap, and the write and its
  replay row commit in one transaction. The namespace is per module, so two
  modules sharing a principal and a literal key value do not collide on the
  same row. The earlier non-atomic middleware was deleted once the last route
  moved off it.
- **Every route accepts both credentials.** `AUTHENTICATED_SECURITY` in
  `src/platform/http/security-schemes.ts` is the one shared
  `[{ session: [] }, { bearer: [] }]` constant every module's `createRoute`
  calls import (Ruling P9-3), so the published contract matches what
  `authenticate` actually accepts. `src/modules/security/api/routes.ts` keeps
  its own session-only constant.

## Integrations and inbound webhooks

Full guide: [`docs/integrations/README.md`](../integrations/README.md).

`src/platform/integrations/types.ts` defines the provider-neutral
`IntegrationProvider` contract; the adapters under
`src/modules/integrations/infrastructure` are the only files allowed to name a
Wallet, Trek or payroll-silo field. A connection's credential is encrypted
under `APP_ENCRYPTION_KEY`
(`src/platform/integrations/crypto.ts`) into
`integration_connections.credentials_ciphertext` and is never returned,
logged, or written into an audit payload.

`src/modules/integrations/application/run-sync.ts` is the single place a sync
run is recorded, whatever triggered it — cron tick, "Sync now", the REST API,
or a queued row drained by `drain-sync-queue.ts`. A job wrapper owns nothing
but its own `job_runs` bookkeeping and the advisory lock around that call.

`POST /api/v1/webhooks/{provider}`
(`src/modules/integrations/application/handle-webhook.ts`) is the one public
route. It verifies the HMAC against each connected candidate's own secret,
records a `webhook_deliveries` row whatever the outcome, and enqueues a
`queued` `sync_runs` row per requested kind — it never syncs inline, because a
webhook request has no principal and must not write domain data under
`app.role = 'system'`. The hourly `sync_queue` job drains those rows, one
connection-owner context at a time.

Two guards sit in front of that (Ruling R9-6):

- **Replay.** A delivery whose `(connection, payload_hash)` was already
  accepted in the last 24 hours is answered with the earlier result and
  `queued: 0`, without enqueuing again. The key is the **connection**, not the
  provider (Ruling P9-5): a provider payload need carry nothing user-specific,
  so two connections of the same provider routinely produce the same hash, and
  a provider-wide key would silently drop the second owner's sync.
- **Rate.** 60 deliveries per connection per minute, through the same
  `consumeWindow` and `rate_limit_windows` table the API limiter uses, keyed by
  connection id instead of user id (Ruling P9-1). Over the limit is
  `429 rate_limited`.

Neither guard throws: both run inside the webhook's own system transaction, and
throwing would roll back the very rows that make the guard work.

## Time off

`src/modules/timeoff` replaced the legacy `leave_days` table and the
`ferie_*`/`rol_*` payslip columns in migration `0018`, which also dropped every
remaining legacy table (Ruling R7-5'). No data was migrated: the owner's
decision was that legacy data is disposable and production is repopulated by
hand.

Three tables — `timeoff_types`, `timeoff_balances`, `timeoff_events`. Types are
seeded lazily per user on first touch (`vacation`, `permits`, `comp`) with
`hours_per_day` from settings; there is no route to edit one yet. Balances are
written **only** by the payroll apply step, through
`src/modules/timeoff/infrastructure/payroll-balance-sink.ts` — one row per
(type, payroll record). With no rows a balance renders as `—`, never `0.00`.

Trek is a two-way sync over `timeoff_events` and `provider_links`
(`src/modules/timeoff/infrastructure/trek-diff.ts` plans a pass,
`trek-sync.ts` runs it). A booked day is staged locally with a `pendingOp`, the
push carries it upstream, and the pull writes back the Trek entry id.
`permits` are never pushed — Trek cannot hold them — and a day converted to
`permits` has its Trek entry removed upstream before its link is dropped. An
unlanded push is never papered over by the pull.

`/company/time-off` is a **bare** page: native forms and plain tables, built to
be used, not to survive the redesign.

## Capability-driven navigation

`src/platform/capabilities/resolve.ts` is a pure function of a `Principal` and
a `CapabilityProbes` interface, so it is unit-testable without a database. It
answers two questions: `features` (should this section be reachable at all) and
`data` (is it reachable but empty, so a page can render a setup state instead
of a wall of zeros). `src/platform/capabilities/probes.ts` is the production
wiring, kept separate precisely so the resolver stays IO-free.
`navigation.ts` and `src/modules/home/cards.ts` are pure functions of the
resulting `Capabilities`: an entry or card exists only when its capability
does — there is no "coming soon" state anywhere in the shell.

## Deferred

Scope the reduced Phases 7–9 dropped on purpose — outbound webhooks, the
Management pages, the session registry, MFA, invitations and roles, the full
e2e suite, the Time Off workspace UI — is listed one line at a time, with the
original plan and task that describes each in full, in
[`docs/superpowers/DEFERRED.md`](../superpowers/DEFERRED.md). That file is the
list to reopen with the UI redesign; it is not repeated here, so there is only
one place to keep current.

## Known deviations

Places where what is on disk knowingly departs from the target shape:

- **`PATCH` without `If-Match` on three routes.** `transaction_categories`,
  `transaction_labels` and `sync_jobs` have no `version` column and the reduced
  Phase 9 shipped no migration, so those three patches are last-writer-wins
  (Ruling P9-4). `payroll_mapping_rules` does have one and follows the
  convention in full.
- **Write and read paths disagree for expenses management.** The management
  writes are at `/expenses/categories` and `/expenses/labels`; the read routes
  that predate them stay at `/transaction-categories` and
  `/transaction-labels`. Renaming a shipped read path is a breaking change
  nothing asked for.
- **`hasReferences` always answers `false`.**
  `src/modules/accounts/infrastructure/drizzle-accounts-repository.ts` decides
  hard-delete-vs-archive from it, and interest rules and budget allocations do
  reference accounts now. Recorded at the call site.
- **The `onDisconnect` network-I/O invariant is unenforced** (Phase 4 PH4-C4):
  an adapter's `onDisconnect` runs inside the disconnect transaction, so one
  that made a network call there would hold the transaction open across it. No
  adapter does; nothing stops one.
