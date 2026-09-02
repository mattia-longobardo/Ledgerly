# Finance & Company Platform — Design and Phased Plan

Date: 2026-09-02
Status: DRAFT — awaiting owner approval before any implementation starts.
Scope: rebuild of `dashboard-app` into a modular, API-first, PostgreSQL-canonical
personal-finance and company-information application, dropping Teable and
Paperless.

---

## 0. How to read this document

Sections 1–2 are the repository assessment and the assumptions I am making in
place of questions. Sections 3–9 are the target design. Section 10 is the
migration strategy. Section 11 is the phased implementation plan, each phase a
coherent vertical slice with tests and docs. Section 12 lists every intentional
breaking change. Section 13 lists the questions that are worth a reply but do
not block Phase 0–1.

Nothing here has been implemented. On approval, the next step is a detailed,
task-level plan for Phase 0 and Phase 1 (the first vertical slice).

---

## 1. Repository assessment

### 1.1 What exists

| Area | Finding |
|---|---|
| Runtime | Next.js 16.3 (App Router, `output: standalone`), React 19, TypeScript, Tailwind 4, Base UI, uPlot charts. Node 22 Alpine image, read-only container, non-root, cap-drop ALL, Traefik-fronted on `proxy_public`. |
| Database | Shared Postgres 18 (`db` stack, `pgvector/pgvector:pg18`), database `dashboard`, least-privilege role `dashboard`. Drizzle ORM 0.45 + drizzle-kit, four migrations in `dashboard-app/drizzle/`, applied by `entrypoint.sh` on boot via a bundled `migrate.mjs`. |
| Auth | Auth.js v5 (beta) with a single OIDC provider (Authentik). Single-user allowlist by `AUTHORIZED_SUB`, enforced three times (sign-in, session callback, `requireUser()`). JWT sessions, secure `__Host-` cookie, refresh-token rotation. Middleware is presence-check only plus CSP (documented as defence in depth, CVE-2025-29927). |
| Machine auth | `X-Cron-Secret` / `X-Webhook-Secret` headers, constant-time compare, process-local rate limit, 404 on failure (`src/lib/auth/machine.ts`). |
| Scheduler | `dashboard-cron` supercronic sidecar curling `/api/jobs/*`: monthly-snapshot (1st, 23:59), sweep (hourly), wallet-refresh (daily), trek-sync (hourly). |
| Jobs | Advisory-lock protected (`pg_try_advisory_xact_lock`), recorded in `job_runs` with dedupe keys, attempt budgets, `poisoned`/`missed` states, Gotify alerts, heartbeat file read by `/api/health`, Prometheus gauges at `/api/metrics`. This is a sound pattern and is kept. |
| Teable | The "Allocation" table (9 rows, one per month) is the history for five hand-tracked accounts plus Fideuram and Fondo Cometa; the app writes ING and Revolut into it monthly. Cached into `balance_snapshots` by the sweep. Deleting a tracked account deletes the Teable column. |
| Budget Makers Wallet | Unofficial REST API, bearer token hot-reloaded from a file. Only four named accounts are read (ING - Salary, Revolut, Savings, Holidays), all-or-nothing. Verified today: the API also exposes `/records` (amount+currency, category+group, labels, recordType, recordState, paired transfers, accountName) and `/categories`, with a default three-month date window on records. Enough for Expenses and Interests. |
| Paperless | Payslips discovered by tag, text acquired via `unpdf` first then Paperless OCR, parsed by rules + TeamSystem overlay + optional LLM pass, confidence-scored, verified by hand in `work/verify/[id]`, then written to `payslips` and `fund_deposits`. 12 verified payslips exist. The parser is pure text-in/fields-out and is reusable without Paperless. |
| Trek | Leave sync over Trek's MCP endpoint, day-level mirror in `leave_days` with pending-op staging; already optional (off when unconfigured). |
| Wallet-interest reference | `/home/mattia/docker/projects/Wallet Manager/app/interest.py`: daily ACT/365 simple accrual on one account's balance, net of a withholding tax rate, sub-cent carry, idempotent per day via state file plus API lookup of a note marker, posts an income record into the Wallet under category "Interest, dividends". |
| Object storage | A `silo` container (pgsty/silo, S3-compatible MinIO fork) is already running in the `db` stack. Suitable as the payroll document silo. |
| Money & time | Integer cents in domain math (`src/lib/calc/money.ts`), `numeric(14,2)` at the DB boundary, month keys `YYYY-MM-01` computed in Europe/Rome (`src/lib/time.ts`). Kept. |
| Funds | `src/lib/calc/cometa.ts` already encodes the quarterly posting lag (contributions accrued in a quarter are credited in the month after it closes, with a €3 quarterly fee). This is the behaviour the new schedule model generalises. |
| Tests | 39 vitest unit files (jobs, clients, payroll, calc). `msw` installed but unused. Playwright configured with zero specs. No DB-backed integration tests. |
| Navigation | Hardcoded three tabs (Home, Finance, Work) in `AppShell.tsx`; no capability-driven visibility. `first_run_complete` is written but never read. |
| Brand/UI | `BRAND.md` "Instrument" identity, desktop grid (`PageGrid`), consistent tiles, stale badges, empty states, sheets, toasts. All reusable. |

### 1.2 What to keep, change, retire

Keep: Next.js + Drizzle + Postgres, Auth.js OIDC login, job locking/run-recording pattern, machine-auth pattern, money/time helpers, payroll parser stack, Trek client, Gotify client, HTTP client with retry, brand and component library, Docker hardening.

Change: everything domain-specific that is hardwired to provider names (`AccountKey` unions, `WALLET_ACCOUNTS`, Teable column maps, `monthly_snapshots` ING/Revolut columns), the single-user allowlist, the navigation, the Work page, Settings.

Retire: Teable client and writes, Paperless client, preview proxy and webhook, `wallet-manager` posting loop (superseded in Phase 3, see §7.6).

---

## 2. Assumptions (stated instead of asked)

1. "Track" in the brief means **Trek**, the Vacay leave planner already integrated.
2. **Single organization, multiple users.** No multi-org tenancy. Row-level isolation is per user; an `organizations` table exists with exactly one row to hang policies on, so multi-org can be added later without a schema rewrite.
3. **Authentik stays as SSO**, and the app additionally gets first-party password login, TOTP, recovery codes, and session management. TOTP is an app-level second factor applied after either login method, per-user (§8.1).
4. **The payroll silo is the existing `silo` S3 bucket** behind a `DocumentStore` interface, with a local-volume adapter for development and tests.
5. **Malware scanning is a boundary, not a dependency:** a `MalwareScanner` interface with a no-op default and a clamd adapter; enabling it is a deployment choice.
6. **Currency is EUR today** but every monetary column carries a currency code and the UI formats by user preference.
7. **The existing "Vacation fund"** (Revolut Holidays annotation ledger) is remodelled as a Budget backed by the Holidays account (§7.5). Its history migrates.
8. The Wallet API is unofficial; adapters treat every response as untrusted and validate with Zod, as today.
9. English only in the UI. Italian appears only inside raw payroll component labels as data.

---

## 3. Target architecture

### 3.1 Shape

One deployable (`dashboard-app`) plus the existing cron sidecar. Inside it, a
strict layering:

```
src/
  modules/<domain>/
    domain/          entities, value objects, pure calculations (no IO)
    application/     use cases (one file per operation), ports (interfaces)
    infrastructure/  Drizzle repositories, provider adapters, storage adapters
    api/             Hono routes + Zod schemas → OpenAPI
    ui/              server components, client components, loaders
  platform/
    auth/            session, PAT, MFA, permissions
    capabilities/    feature flags, integration state, "what is available for this user"
    db/              drizzle client, RLS context, migrations
    http/            error format, idempotency, rate limit, audit middleware
    jobs/            scheduler entry, locking, run recording (generalised from src/lib/jobs)
    integrations/    registry, connection lifecycle, credential vault, sync engine
    observability/   structured logs with redaction, metrics, health
  app/               Next.js routes only: thin — call use cases, render ui/
```

Domains: `accounts`, `funds`, `expenses`, `budgets`, `interests`, `payroll`,
`earnings`, `timeoff`, `management`, `settings`, `admin`.

Rules:
- UI components and server actions never contain business logic; they call a use case.
- Use cases depend on ports (repository interfaces, provider interfaces, clock, id generator), never on Drizzle or fetch directly. This is what makes them unit-testable and provider-agnostic.
- Provider adapters map provider payloads into domain models and are the only place provider field names appear.
- The API layer and the server-component loaders call the same use cases, so UI and API cannot drift.

### 3.2 API surface

**Hono mounted inside Next.js** at `app/api/v1/[[...route]]/route.ts`, using
`@hono/zod-openapi`. Rationale: same process and deployment as today, Zod
schemas (already the validation library) generate the OpenAPI document, and Hono
gives a middleware chain for auth, idempotency, rate limiting and audit. REST is
chosen over GraphQL/tRPC because the consumers are external systems (payroll
upload, scripts) as much as the UI.

- Base path `/api/v1`. OpenAPI JSON at `/api/v1/openapi.json`, Swagger UI at `/api/v1/docs` (session-authenticated).
- Auth: session cookie (browser) or `Authorization: Bearer <personal access token>` with scopes. Machine jobs keep `X-Cron-Secret`.
- Error format: `{ error: { code, message, details?, requestId } }` with a fixed code catalogue (`validation_failed`, `not_found`, `conflict`, `version_mismatch`, `permission_denied`, `integration_unavailable`, `rate_limited`, …).
- Pagination: cursor-based (`cursor`, `limit` ≤ 200), response `{ items, nextCursor }`. Filtering via typed query params; sorting via `sort=field:asc`. Date ranges via `from`/`to` as ISO dates, inclusive-exclusive, interpreted in the user's timezone.
- Mutations: `Idempotency-Key` header required on POST that creates financial records and on uploads; stored 24 h with request hash and response replay.
- Concurrency: every mutable entity has `version`; PUT/PATCH require `If-Match: <version>` or body `version`, else `409 version_mismatch`.
- Rate limiting: per principal token bucket in Postgres (single instance, no Redis dependency); headers `RateLimit-*`.
- Audit: middleware records actor, action, entity, before/after hashes for all mutations and for sensitive reads (payroll originals, credentials metadata).
- Webhooks out: `webhook_endpoints` with HMAC-SHA256 signature, events `payroll.import.completed`, `sync.completed`, `sync.failed`, `budget.threshold.exceeded`, delivered by the job runner with retries.
- The generated OpenAPI document is committed (`docs/api/openapi.json`) and a test fails if it drifts from the code.

### 3.3 Capabilities and dynamic composition

`platform/capabilities/resolve.ts` computes, per request and user:

```
{
  features: { budgets: true, funds: true, interests: false, expenses: false, payroll: true, timeoff: true, ... },
  integrations: { wallet: 'connected' | 'error' | 'disconnected' | 'not_configured', payroll: ..., trek: ... },
  permissions: Set<Permission>,
  data: { hasPayrollRecords: boolean, hasAccounts: boolean, ... }
}
```

Both the navigation and the Home card registry are pure functions of this
object. A page whose feature is off renders a setup empty state (with the link
to Settings › Integrations) rather than zeros; a page the user lacks permission
for renders a permission-denied state.

### 3.4 Background work

Keep supercronic, but it calls one endpoint per schedule tier
(`/api/jobs/tick?tier=hourly|daily|monthly`). The tick dispatches to the
job registry, which runs due jobs under advisory locks and records
`job_runs`. Integration syncs are jobs. Everything remains retryable and
observable through the existing `job_runs` + `/api/metrics` + Gotify path.
Webhook inbound endpoints (`/api/v1/webhooks/<provider>`) validate signatures
and enqueue a job row rather than doing work inline.

---

## 4. Navigation and page map

| Area | Route | Visible when |
|---|---|---|
| Home | `/` | always |
| Finance › Overview | `/finance` | always |
| Finance › Accounts | `/finance/accounts`, `/finance/accounts/[id]` | always |
| Finance › Funds | `/finance/funds`, `/finance/funds/[id]` | always (manual mode without payroll) |
| Finance › Expenses | `/finance/expenses`, `/finance/expenses/[transactionId]` | Wallet integration connected |
| Finance › Budgets | `/finance/budgets`, `/finance/budgets/[id]` | always |
| Finance › Interests | `/finance/interests`, `/finance/interests/rules/[id]` | Wallet integration connected |
| Finance › Management | `/finance/management/*` | permission `finance.manage` |
| Company › Overview | `/company` | payroll feature enabled |
| Company › Earnings | `/company/earnings`, `/company/earnings/[recordId]` | payroll records exist (else setup state) |
| Company › Time Off | `/company/time-off` | payroll or Trek available (else setup state) |
| Company › Payroll | `/company/payroll`, `/company/payroll/[importId]` | permission `payroll.upload` or `payroll.review` |
| Settings › Personal | `/settings/personal` | always |
| Settings › Security | `/settings/security` | always |
| Settings › Account | `/settings/account` | always |
| Settings › Integrations | `/settings/integrations`, `/settings/integrations/[provider]` | always |
| Settings › Administration | `/settings/admin/*` | role admin/owner |

Sidebar groups collapse to their available children; the mobile bar shows
Home, Finance, Company, Settings.

---

## 5. Data model

Conventions: UUID v7 primary keys (Postgres 18.6 ships `uuidv7()`; use it as the default), `created_at`/`updated_at`
timestamptz, `created_by`/`updated_by` user ids, `source` enum
(`manual|provider|payroll|system|migration`), `version integer` for optimistic
concurrency, `archived_at` for soft archival where history matters, monetary
columns `numeric(16,2)` + `currency char(3)`, rates `numeric(10,6)`, dates
`date` for civil dates and `timestamptz` for instants. External provider ids
never live on domain tables; they live in `provider_links`.

Row-level security: every user-owned table has `user_id`; policies compare with
`current_setting('app.user_id', true)`. The application sets it with
`SET LOCAL` inside each request transaction. The `dashboard` role is not the
table owner, so RLS applies to it. Admin reads for the Administration area use
explicit `app.role = 'admin'` policies, never a bypass role.

### 5.1 Identity and access
- `organizations` (single row), `users` (email, display name, locale, timezone, currency, number/date prefs, status `invited|active|suspended|deleted`, password_hash nullable, mfa_enabled, deleted_at), `user_identities` (provider `authentik`, subject, linked_at), `roles` (owner, admin, member, viewer), `user_roles`, `permissions` (code catalogue), `role_permissions`, `invitations` (token hash, expires, role), `sessions` (DB-backed: id, user, created, last_seen, ip, user agent, revoked_at) — Auth.js switches to database sessions, `mfa_totp` (encrypted secret, confirmed_at), `mfa_recovery_codes` (hash, used_at), `personal_access_tokens` (hash, prefix, scopes, expires, last_used), `security_events` (login success/failure, mfa, token use, password change), `audit_events` (actor, action, entity_type, entity_id, before_hash, after_hash, request_id, ip).
- `organization_policies` (jsonb: invitations open/closed, allowed integrations, retention days for payroll originals, MFA required).

### 5.2 Integrations
- `integration_providers` (code: `wallet`, `trek`, `payroll_silo`; static seed with capabilities jsonb).
- `integration_connections` (user_id, provider, status `disconnected|connected|error|disabled`, credentials_ciphertext bytea + key_id, settings jsonb, last_test_at, last_sync_at, last_error, disconnect_policy `keep|archive|purge`).
- `sync_jobs` (connection_id, kind `accounts|transactions|leave|...`, schedule cron, enabled), `sync_runs` (job_runs generalised: status, stats jsonb, error, started/finished, trigger `cron|manual|webhook|api`).
- `provider_links` (entity_type, entity_id, provider, external_id, external_parent_id, metadata jsonb, first_seen, last_seen, missing_since) — unique (provider, entity_type, external_id).
- `webhook_endpoints` (url, secret_hash, events[], enabled), `webhook_deliveries` (event, payload hash, attempts, status, response code).
- `idempotency_keys` (principal, key, request_hash, response, expires).

### 5.3 Accounts
- `account_groups` (user_id, name, sort).
- `accounts` (user_id, name, type `checking|savings|cash|investment|pension_fund|crypto|credit|other`, currency, origin `manual|synced`, group_id, owner label, status `active|unavailable|archived`, include_in_net_worth, notes, archived_at, version).
- `account_balances` (account_id, as_of date, balance, available nullable, source, captured_at, sync_run_id) — unique (account_id, as_of, source). Replaces `balance_snapshots`, `monthly_snapshots`, `tracked_accounts` and the Teable table.
- `account_balance_targets` optional later.

Deletion rules (use case `DeleteAccount`): manual accounts hard-delete only if they have no balances/transactions referenced by budgets or interest rules, otherwise archive. Synced accounts cannot be deleted while a live `provider_links` row exists; the sync marks them `unavailable` with `missing_since` when they vanish upstream, and permanent deletion needs an explicit confirmation with the connection's `disconnect_policy` or a one-off confirm.

### 5.4 Transactions (Expenses)
- `transaction_categories` (user_id, name, group name, kind `income|expense|transfer|system`, color, parent_id, source, archived_at), `transaction_labels`.
- `transactions` (user_id, account_id, occurred_at, booked_at, amount signed, currency, type `income|expense|transfer`, state `pending|cleared|reconciled`, category_id, payee/merchant, note, transfer_group_id, source, sync_run_id, version), `transaction_label_links`.
- `recurring_patterns` (detected/confirmed recurring series: payee, cadence, amount band, next_expected).

### 5.5 Funds
- `funds` (user_id, name, kind `pension|investment|savings|other`, currency, account_id nullable link to the valuation account, status).
- `fund_contribution_types` (code `employee|employer|voluntary|adjustment|reversal|fee`, label).
- `fund_contribution_schedules` (fund_id, frequency `monthly|quarterly|annual`, period_anchor_month, posting_lag_months default 1, fee_per_posting, effective_from). Default for payroll-derived: quarterly, lag 1 — March quarter posts in April.
- `fund_contributions` (fund_id, type_id, accrual_period_start, accrual_period_end, value_date, posted_month, amount, currency, source, payroll_record_id nullable, note, attachment_ref nullable, reconciliation_status `expected|received|matched|missing|delayed|duplicate|anomalous`, reverses_id nullable, version).
- `fund_valuations` (fund_id, as_of, value, units nullable, unit_price nullable, source).
Existing `fund_settings` semantics (initial capital, fixed monthly deposit mode) move to `fund_contribution_schedules` + a `fund_plans` row (fixed amount planning).

### 5.6 Budgets
- `budgets` (user_id, name, description, currency, status `active|archived`, period_kind `none|monthly|quarterly|annual|custom`, start_date, end_date, goal_amount nullable, labels[], version).
- `budget_amount_versions` (budget_id, initial_amount, effective_from, reason, actor) — full history of the initial amount.
- `budget_allocations` (budget_id, source_kind `fund|account`, source_id, amount, effective_from, effective_to, note, actor) — virtual, never moves money.
- `budget_scopes` (budget_id, kind `account|category|label|fund`, ref_id) — what counts as usage.
- `budget_usages` (budget_id, transaction_id, amount, matched_by `scope|manual`) — materialised link so usage is auditable.
- `budget_events` (change log).
Derived: allocated, used, remaining = initial + Σallocations − used, available-in-source = source balance − Σ virtual allocations against it. UI labels every allocation "planning value".

### 5.7 Interests
- `interest_rules` (user_id, account_id, annual_rate, tax_rate, day_count `365|360|actual`, compounding `simple_daily|monthly|none`, effective_from, effective_to, posting_mode `analyze_only|post_to_provider`, provider_category_ref, note_marker, version).
- `interest_accruals` (rule_id, accrual_date, balance_basis, gross, tax, net, carry_after, source `computed`) — unique (rule_id, accrual_date).
- `interest_entries` (user_id, account_id, occurred_at, gross, net, kind `paid|projected|adjustment`, transaction_id nullable, rule_id nullable, source).
- Reconciliation view: Σ accruals in period vs Σ matched paid entries.

### 5.8 Payroll, earnings, time off
- `payroll_imports` (user_id, status `received|scanning|extracting|parsed|needs_review|verified|applied|rejected|superseded|failed`, file_name, mime, size, sha256 unique per user, storage_key, storage_provider, pages, text_source `pdf_text|ocr|none`, parser_version, extraction jsonb, confidence jsonb, error, idempotency_key, replaces_import_id, retention_until, uploaded_via `ui|api`, version).
- `payroll_records` (user_id, import_id, period_start, period_end, pay_date, kind `ordinary|thirteenth|fourteenth|bonus|settlement`, currency, gross, net, verified_at, verified_by, corrections jsonb, version) — unique (user_id, period_start, kind) among non-superseded.
- `payroll_components` (record_id, code, label_raw, kind `earning|deduction|tax|employer_contribution|employee_contribution|reimbursement|allowance|bonus|leave_balance|leave_used|leave_accrued|info`, amount nullable, quantity nullable, unit nullable, currency, confidence, source `rules|llm|manual`, mapped_to jsonb).
- `payroll_mapping_rules` (user_id nullable for global, match on code/label regex → component kind, and targets: `earnings`, `fund_contribution(fund_id, type)`, `timeoff_balance(type)`, `timeoff_used(type)`).
- `earnings_summaries` is a view over records + components (no table).
- `timeoff_types` (user_id, code `vacation|comp|permits|sick|other`, label, unit `hours|days`, hours_per_day).
- `timeoff_balances` (user_id, type_id, as_of, accrued, used, remaining, pending, source, payroll_record_id nullable) — one per payroll period.
- `timeoff_events` (user_id, type_id, date, fraction, status `planned|approved|taken|cancelled`, origin `manual|trek|payroll`, note, version) — generalises `leave_days`; `provider_links` holds the Trek entry id.

### 5.9 Management and system
- `reconciliation_issues` (domain, entity_type, entity_id, kind, severity, detail jsonb, status `open|acknowledged|resolved`, resolved_by).
- `app_settings` stays for global toggles; `user_settings` (jsonb) for personal preferences that are not first-class columns.

### 5.10 Indexes (access-pattern driven)
`account_balances (account_id, as_of desc)`, `transactions (user_id, occurred_at desc)`, `transactions (account_id, occurred_at desc)`, `transactions (user_id, category_id, occurred_at)`, `fund_contributions (fund_id, posted_month)`, `payroll_records (user_id, period_start desc)`, `timeoff_events (user_id, date)`, `audit_events (entity_type, entity_id, created_at desc)`, `provider_links (provider, entity_type, external_id) unique`, `sync_runs (job_id, started_at desc)`, partial index on `payroll_imports (status) where status in ('received','extracting','needs_review')`.

---

## 6. Integration framework

`platform/integrations/`:

```ts
interface IntegrationProvider {
  code: 'wallet' | 'trek' | 'payroll_silo';
  capabilities: Capability[];             // 'accounts','transactions','interest_posting','leave','documents'
  credentialSchema: ZodSchema;             // what the connect form asks for; never echoed back
  testConnection(creds, settings): Promise<TestResult>;
  syncs: Record<SyncKind, SyncHandler>;    // pull/push units of work, each idempotent
  webhook?: { verify(req): boolean; toJobs(payload): SyncRequest[] };
  onDisconnect(policy): Promise<void>;
}
```

- Credentials are encrypted with AES-256-GCM under `APP_ENCRYPTION_KEY` (32-byte, env, rotation supported via `key_id`). Existing file-mounted tokens are imported once and the files retired.
- Sync engine: builds a `SyncContext` (connection, cursor state, clock), runs the handler, upserts through `provider_links`, records stats, and marks missing entities (`missing_since`) instead of deleting.
- Retries: reuse `withRetry` with the provider's `minDelayFor` (Wallet 409 init_sync floor, 429 Retry-After).
- Manual trigger: `POST /api/v1/integrations/{provider}/sync` (idempotent per running job).
- Feature matrix:

| Feature | Requires |
|---|---|
| Accounts, Funds, Budgets, Management | none (manual) |
| Synced accounts, Expenses, Interests | Wallet connected |
| Company Overview, Earnings, Payroll | payroll feature (silo or local store configured) |
| Time Off calendar sync | Trek connected (calendar works manually without it) |
| Fund contributions from payroll | payroll records verified |

---

## 7. Domain designs (what each section computes)

### 7.1 Home
Card registry with `requires` and a `load()` returning `{state: 'ready'|'loading'|'empty'|'stale'|'partial'|'integration_error'|'permission_denied', data, updatedAt, source}`. Cards: total balance, period expenses (Wallet), fund totals and contribution status, earnings/cash summary (payroll), active budgets, accrued/projected interest (Wallet), company earnings summary, time-off balance and upcoming leave, payroll import status. Each links to its section. Layout uses the existing `PageGrid`.

### 7.2 Finance Overview
Totals, account breakdown, balance trend (from `account_balances`, carry-forward series from `calc/series.ts`), funds summary, budget availability, expense summary/trends (if Wallet), earnings summary (if payroll), interest summary (if Wallet), freshness per data source. Filters: date range, account, provider, category, currency, source, persisted in the URL.

### 7.3 Accounts
List with grouping (type, provider, currency, owner, status, custom group), balance/available/trend/last update/sync state, allocation and evolution charts, inflow/outflow from transactions where available. Detail: history, related transactions or contributions. Manual CRUD with confirmations; synced accounts are read-only on provider-owned fields but allow local overrides (display name, group, include-in-net-worth).

### 7.4 Funds
Manual mode fully functional. Contributions by type with reversals and adjustments, schedules with the quarterly-posting rule (`posted_month = last month of accrual quarter + posting_lag_months`), expected-vs-received reconciliation producing `reconciliation_issues` for missing, delayed, duplicate and anomalous amounts (median band as in `confidence.ts`), quarterly/annual views, growth and allocation charts, drill-down to the source payroll record. The joining fee and quarterly fee become `fee` contributions rather than constants.

### 7.5 Budgets
As in §5.6. The old Vacation fund becomes a budget named "Holidays" scoped to the Holidays account; withdrawals become manual usages; the accrual rate becomes a monthly recurring allocation.

### 7.6 Interests (reuse / change / deprecate from `interest.py`)
Reused: ACT/365 simple daily accrual, tax-net computation, sub-cent carry, per-day idempotency, note marker for provider records, Gotify alert on auth failure.
Changed: multiple rules per user and per account; accruals stored as a ledger (not just state.json); projections from current balance and rule; reconciliation against provider records categorised as interest; posting to the provider is opt-in per rule (`posting_mode`).
Deprecated: the standalone container loop, env-driven single account, the `state.json` file. The `wallet-manager` container keeps running until a rule with `post_to_provider` is enabled in the dashboard; the migration doc has the cut-over steps.

### 7.7 Expenses
Transactions synced from Wallet with a rolling window and incremental cursor (`updatedAt`), categories and labels mirrored as user categories with `provider_links`, transfers paired via `transfer_group_id` and excluded from expense totals, merchant analysis from payee/note, recurring detection, search/filter/sort/pagination, sync status on every list.

### 7.8 Company
Overview combines earnings, time-off balances, upcoming leave, latest import status, alerts. Earnings: gross/net, taxes, deductions, contributions, bonuses/allowances/reimbursements from typed components, monthly/quarterly/annual comparisons, link to original (authorised, audited, streamed from the document store with `no-store`). Time Off: one workspace — calendar, balances by type, list/details; selecting a day updates the detail panel in place (URL search param, no navigation), responsive two-pane on desktop, stacked on mobile.

### 7.9 Payroll upload
`POST /api/v1/payroll/imports` (multipart or JSON with pre-signed upload) → validation (size ≤ 10 MB, `application/pdf` by magic bytes, sha256 dedupe → `409 duplicate` with the existing import id) → store original → job: scan (boundary) → extract text (`unpdf`; if below threshold, status `needs_ocr` until an OCR adapter is configured) → parse (existing pipeline) → `needs_review` or auto-`verified` when all fields are high confidence and policy allows → `applied`: writes `payroll_records`, `payroll_components`, `timeoff_balances`, `fund_contributions`. Replacement: uploading a new file for the same period creates a new import with `replaces_import_id`; applying it supersedes the previous record. Retry: `POST .../imports/{id}/retry`. Retention: `retention_until` from policy; originals purged by a job, provenance rows kept.

---

## 8. Security design

### 8.1 Authentication and MFA
- Login methods: Authentik OIDC (existing) and first-party email+password (Argon2id via `@node-rs/argon2`). Both resolve to a `users` row; new OIDC subjects are accepted only if invited or if policy allows auto-join.
- Sessions move to database sessions (Auth.js Drizzle adapter) so the Security page can list and revoke them.
- TOTP: `otplib`, secret encrypted at rest, enrolment with QR + confirmation code, 10 single-use recovery codes (hashed), step-up flag `mfa_verified_at` on the session; `requireUser()` enforces MFA when the user has it enabled (or policy requires it), regardless of login method.
- Personal access tokens: `pat_<prefix>.<secret>`, SHA-256 stored, scopes mirror permission codes, optional expiry, last-used tracking, revocation.
- Security history from `security_events`.

### 8.2 Authorization
Permission codes per domain and verb (`accounts.read`, `accounts.write`, `payroll.upload`, `payroll.review`, `payroll.read_original`, `admin.users`, …). Roles map to permission sets. Every use case receives a `Principal` and asserts permissions; RLS is the second wall.

### 8.3 Web security
Keep the existing CSP, headers, secure cookies, `SameSite=Lax`; server actions carry Next's origin check; API mutations with cookie auth additionally require a custom header (`X-Requested-With`) to defeat CSRF; CORS closed by default with an allowlist setting. Uploads validated by size, MIME, magic bytes, and the scanner boundary. Logs redact tokens, secrets and payroll amounts (structured logger with a denylist of field names).

### 8.4 Data protection
Credentials and TOTP secrets encrypted; payroll originals in the silo under per-user prefixes with server-side access only (no public URLs); retention policies; export as a ZIP of JSON + originals; account deletion soft-deletes the user, purges credentials immediately, schedules data purge after the retention window.

---

## 9. Observability and testing

- Structured JSON logs with `requestId`, `userId` (never email), `jobName`.
- `/api/metrics` extended with per-integration sync gauges and API latency histograms.
- `/api/health` unchanged plus DB and document-store checks.
- Tests: vitest unit (domain, use cases with in-memory ports), vitest integration against a real Postgres (`docker-compose.test.yml` with `postgres:18`, migrations applied, RLS asserted), API contract tests (responses validated against the generated OpenAPI), migration tests (fresh + from a fixture dump of the current schema), authorization tests (matrix of roles × endpoints), sync tests with `msw` mocking providers, Playwright e2e for: login + MFA, connect Wallet (mocked), upload payslip, verify and see earnings, create budget and allocation, Home composition per capability.

---

## 10. Migration strategy

### 10.1 Teable → PostgreSQL
1. Snapshot: export the Allocation table (9 rows) to `docs/migration/teable-allocation-<date>.json` via the existing client before removal.
2. Mapping: each column becomes an `accounts` row (manual for EToro, Buddy Bank, IsyBank, Mediolanum, Binance; pension fund for Fondo Cometa; investment for Fideuram; synced for ING and Revolut once the Wallet adapter links them). Each cell becomes `account_balances (as_of = last day of that Rome month, source = 'migration')`. `balance_snapshots` rows (314) become `account_balances` with `source = 'provider'` for Wallet keys and are deduplicated per day.
3. Validation: a script recomputes the net-worth series with the new tables and diffs against the current `loadAccounts()` output month by month; zero tolerance on totals.
4. Reconciliation report written to `docs/migration/teable-reconciliation.md`.
5. Rollback: migrations are additive until Phase 1 is accepted; the old tables stay until a later "drop legacy" migration. Teable itself is untouched, so reverting the image restores the old behaviour.
6. Removal: delete `src/lib/clients/teable.ts`, Teable env vars, the monthly Teable write, `tracked_accounts.teable_column`, `funds.teable_column`; the `db_internal`/`storage` Teable container can be stopped by the owner afterwards.

### 10.2 Paperless → payroll silo
1. For each `payslips` row, create `payroll_imports` with `storage_key` filled by a one-off script that downloads the original from Paperless while the token still exists, and `legacy_source = {provider:'paperless', document_id}` for provenance; sha256 recorded.
2. Convert the 12 verified rows into `payroll_records` + `payroll_components` (gross, net, taxes, fund contributions, leave balances/used as typed components), `verified_at` preserved, `corrections` preserved.
3. `fund_deposits` → `fund_contributions` with `source='payroll'` and links to the new records; the Cometa quarterly schedule row is created so reconciliation reproduces today's `cometa.ts` credits.
4. Remove the Paperless client, preview route, webhook route, env vars. The webhook secret stays for the generic inbound webhook endpoint.
5. Parser fixtures under `src/lib/payroll/__fixtures__` are kept (they are text, not PDFs).

### 10.3 Single user → users table
Seed the owner from `AUTHORIZED_SUB` into `users` + `user_identities` with role `owner`; all existing rows get that `user_id`. `AUTHORIZED_SUB` becomes `BOOTSTRAP_OWNER_SUB`, read only when the users table is empty.

### 10.4 Deployment
Each phase ships as: migration(s) → image → cron changes → docs update. `docs/deploy/` gets a runbook per phase with pre-checks (backup `pg_dump dashboard`), apply, verify, rollback.

---

## 11. Phased implementation plan

Every phase: small PRs, tests first for domain and use cases, migration tests, docs. Existing behaviour stays available until its replacement is verified in the same phase.

### Phase 0 — Foundations (no visible product change)
- Module layout, `platform/*`, `Principal`, permission catalogue, `users`/roles/sessions/audit tables, RLS with request-scoped `SET LOCAL`, owner seed from `AUTHORIZED_SUB`.
- Hono + zod-openapi mounted at `/api/v1`, error format, request ids, idempotency store, rate limit, PAT auth, OpenAPI generation + drift test.
- Job registry + tick endpoint wrapping the existing four jobs unchanged.
- Test infrastructure: Postgres integration harness, msw, first Playwright smoke.
- Capability resolver + navigation driven by it (still Home/Finance/Company/Settings shells).
Exit: all existing tests green, app behaves as today, `/api/v1/openapi.json` served.

### Phase 1 — Accounts and Teable retirement (first vertical slice)
- `accounts`, `account_groups`, `account_balances`, `provider_links`; Wallet adapter syncing all accounts (archived → `unavailable`), manual account CRUD, deletion rules, monthly close job in DB.
- Teable migration scripts + validation + reconciliation report; remove Teable.
- UI: Home (accounts cards), Finance Overview, Accounts list/detail, Management › Accounts/Groups.
- API: `/accounts`, `/accounts/{id}/balances`, `/account-groups`, `/integrations/wallet/sync`.
Exit: net-worth series identical to before; Teable env removed; acceptance items "Accounts generic + safe deletion" and "Teable no longer required" met.

### Phase 2 — Integration framework and Settings › Integrations
- `integration_connections`, encrypted credentials (import wallet + trek tokens from files), test connection, sync jobs/runs, manual trigger, disconnect policies, inbound webhook endpoint.
- Port Wallet and Trek adapters onto the framework.
- Settings restructured into Personal / Security (sessions list only) / Account / Integrations / Administration (read-only users list).
Exit: integrations toggled from the UI; Expenses/Interests nav appears only when Wallet is connected (empty states ready).

### Phase 3 — Expenses and Interests
- Transactions, categories, labels sync; Expenses pages and API; recurring detection.
- Interest rules, accrual job, entries, reconciliation, projections; Interests pages and API; optional posting adapter; wallet-manager cut-over doc.
Exit: acceptance "Expenses and Interests only with Wallet" met.

### Phase 4 — Payroll upload pipeline and Company
- Document store (silo + local), upload API and UI, scanning boundary, extraction, parsing via existing pipeline, review screen (evolved `VerifyForm`), apply step, replacement/versioning, retention job.
- `payroll_records`/`payroll_components`/mapping rules; Company Overview and Earnings; Paperless migration and removal.
Exit: acceptance "Payroll uploaded securely without Paperless, idempotent" met.

### Phase 5 — Funds expansion
- Contribution types, schedules with the quarterly rule, contributions ledger with reversals/adjustments, valuations, reconciliation issues, forecasts, charts, drill-down; migrate `fund_deposits`/`fund_settings`.
Exit: acceptance "Funds manual without payroll + quarterly posting next month" met.

### Phase 6 — Budgets
- Budgets, amount versions, virtual allocations, scopes, usages, events; pages, API, Home card; migrate the Vacation fund.
Exit: acceptance "virtual allocations separated from real balances, availability recalculated" met.

### Phase 7 — Time Off workspace
- `timeoff_types/balances/events`, payroll-derived balances, Trek sync on the framework, unified calendar + balances + detail workspace, API.
Exit: acceptance "earnings and time off clear in a unified experience" met.

### Phase 8 — Security and Administration
- Password login, TOTP + recovery codes, step-up enforcement, session revocation, security history, PATs, invitations, user lifecycle, roles UI, organization policies, audit log viewer, data export, account deletion.
Exit: acceptance "MFA works with recovery codes" and "roles prevent unauthorized access" met.

### Phase 9 — Management, webhooks, hardening
- Management pages for categories/labels, providers/mappings, contribution types, interest rules, import/sync jobs, reconciliation issues; outbound webhooks; retention jobs; final e2e suite; docs (architecture, API guide, deployment, migration retrospective); drop legacy tables.

Estimated order of magnitude: Phases 0–1 are the largest single step (foundation plus first slice); each later phase is a self-contained release.

---

## 12. Intentional breaking changes

1. Navigation: Work → Company; Finance gains Accounts/Expenses/Budgets/Interests/Management; Settings split into five areas.
2. Teable is no longer read or written; the Allocation table becomes a frozen export.
3. Paperless is no longer polled; the payslip webhook endpoint is removed; payslips are uploaded.
4. Deleting a tracked account no longer deletes anything outside the app.
5. Wallet accounts are no longer limited to four fixed names; all accounts sync, and "Revolut" as a combined figure becomes an account group.
6. `monthly_snapshots` (ING/Revolut columns) is replaced by generic `account_balances`.
7. The Vacation fund page is replaced by a Budget.
8. The single-user `AUTHORIZED_SUB` allowlist becomes a bootstrap seed; access is governed by `users`/roles.
9. The wallet-manager container is superseded once interest posting is enabled in-app.
10. Env vars removed: `TEABLE_*`, `PAPERLESS_*`, `WALLET_TOKEN_FILE`, `TREK_TOKEN_FILE` (after credential import). Added: `APP_ENCRYPTION_KEY`, `DOCUMENT_STORE_*`.

---

## 13. Questions worth answering (none block Phase 0–1)

1. MFA placement: is app-level TOTP after an Authentik login acceptable, or should SSO logins be exempt when Authentik already enforced MFA (`amr` claim)? Default: app-level, per-user toggle "require app MFA for SSO logins" defaulting to on once enrolled.
2. Should the dashboard take over posting daily interest to the Wallet (retiring `wallet-manager`), or only analyse? Default: analyse in Phase 3, posting behind a per-rule switch.
3. Is a ClamAV (clamd) container acceptable in the stack for upload scanning? Default: boundary only, no scanner enabled.
4. Which Wallet accounts should count toward net worth by default? Default: all non-archived, with a per-account toggle.
5. Retention for payroll originals: default 10 years (Italian statutory horizon for payslips), configurable.
