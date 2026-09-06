# Phase 9: Management, webhooks, hardening

> **For agentic workers:** Codex — one task per run, see "How to execute a plan with Codex" in `2026-09-06-phases-5-9-shared-conventions.md`. Claude Code — `superpowers:subagent-driven-development`, one task per subagent. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Close the platform rebuild: fix the open `withJobLock` defect, deliver outbound webhooks, build the Management pages (categories and labels, payroll mapping rules, reconciliation issues, sync jobs, contribution types), add retention housekeeping and inbound-webhook hardening, drop the legacy tables and the code that only served them, ship the final e2e suite, and write the closing documentation.

**Architecture:** No new domain module. Management pages are thin UIs over use cases added to the modules that own the data (`expenses`, `payroll`, `funds`, `integrations`). Outbound webhooks are a platform concern (`src/platform/webhooks/`) with an outbox in the existing `webhook_deliveries` table (`direction = 'outbound'`) and a delivery job. `withJobLock` moves from a transaction-scoped advisory lock to a session-scoped one on a dedicated pooled connection, so a job body can perform network I/O and open its own short transactions.

**Tech stack:** as in the shared conventions. No new npm dependency.

**Spec:** §3.2 (webhooks out, events, HMAC), §3.4 (background work), §5.2 (`webhook_endpoints`, `webhook_deliveries`), §5.9 (`reconciliation_issues`), §4 (`/finance/management/*`), §8.3 (inbound hardening carried from Phase 2), §9 (final e2e list), §10.1 step 6 / §10.2 / §11 Phase 9 ("drop legacy tables", docs), §12.9 (wallet-manager superseded). Predecessors: Phase 4 checkpoint ("What remains": `withJobLock`, `onDisconnect` I/O invariant), Phase 8 checkpoint.

**Global Constraints:** see the shared conventions. Phase-specific:

- Migrations **`0020_webhooks.sql`** (Task 2) and **`0021_drop_legacy.sql`** (Task 6). Verify numbering with `ls drizzle/*.sql` — Phase 8 used `0019`.
- Webhook endpoint secrets are stored encrypted (`credentialCipher()`), never hashed: HMAC signing needs the plaintext. They are shown once at creation and never returned.
- Outbound deliveries never run inside a database transaction (Task 1 makes that possible for jobs; Task 2 relies on it).
- The legacy drop happens **only after** the Phase 5, 6 and 7 validators have been run in production and recorded in their checkpoints. Task 6 states the check.

## Scope cut

- "Providers/mappings" management (a `provider_links` browser): deferred — nothing edits links by hand.
- Interest rules already have their own pages (`/finance/interests/rules/[id]`); Management links there instead of duplicating.
- The webhook event catalogue is limited to the four events spec §3.2 names.
- The final e2e suite runs API flows with a personal access token and browser flows only when a session cookie is supplied (Authentik cannot be driven headlessly here).
- The `onDisconnect` network-I/O invariant (Phase 4 PH4-C4) is **not** fixed here; it is recorded in the closing checkpoint as the one remaining platform item.

## Rulings

- **R9-1 Session-level advisory lock.** `withJobLock(key, fn)` checks out one `pg` client from the pool, runs `SELECT pg_try_advisory_lock(hashtext(key))` on it, runs `fn()` with **no transaction open on that client**, then `pg_advisory_unlock` in `finally` and releases the client. A client death releases the lock automatically. The signature stays `Promise<T | null>` (null = not acquired), so no caller changes.
- **R9-2 Outbox in `webhook_deliveries`.** Emission = one `outbound` row per subscribed enabled endpoint with `status = 'queued'`, `payload`, `next_attempt_at = now`. The `webhook_delivery` job (hourly tier plus a "Deliver now" action) sends due rows with `POST`, headers `X-Webhook-Id`, `X-Webhook-Event`, `X-Webhook-Timestamp`, `X-Webhook-Signature: v1=<hex hmac-sha256(secret, "<timestamp>.<body>")>`; retry schedule 1 m, 5 m, 30 m, 2 h, 12 h; after the sixth failure `status = 'failed'`.
- **R9-3 Event envelope** `{ id, event, occurredAt, userId, data }`; `data` carries ids and non-sensitive figures only — never payroll amounts (spec §8.3): `payroll.import.completed` carries `{ importId, recordId, periodStart, kind }`; `sync.completed`/`sync.failed` carry `{ provider, kind, runId, stats | error }`; `budget.threshold.exceeded` carries `{ budgetId, name, remaining }`.
- **R9-4 Threshold semantics.** `budget.threshold.exceeded` fires when `refreshUsages` observes `remaining <= 0` and no `budget_events` row of kind `threshold_exceeded` exists for the budget in the last 24 h. It writes that event row in the same transaction as the outbox rows.
- **R9-5 Housekeeping retention** (daily job `housekeeping`): `audit_events` 730 days, `security_events` 365, `job_runs`/`sync_runs` 90, `webhook_deliveries` 90, expired `idempotency_keys`, `rate_limit_windows` older than 1 day; `payroll_retention` starts reading `policies.payrollRetentionDays` (Phase 8 R8-7) instead of `app_settings`. Each purge is capped at 5,000 rows per run.
- **R9-6 Inbound replay protection**: the same `(provider, payload_hash)` seen within 24 h answers `202` without queuing again (an idempotent acknowledgement, so a retrying provider does not error); per-connection inbound rate limit 60/min via `rate_limit_windows` keyed by the connection id.
- **R9-7 Legacy drop list** (`0021_drop_legacy.sql`): `payslips`, `fund_deposits`, `fund_settings`, `legacy_funds`, `vacation_ledger`, `vacation_accrual_rate`, `leave_days`, `balance_snapshots`. `job_runs` and `app_settings` move from `schema/legacy.ts` to `schema/platform.ts` unchanged. `wallet_refresh` (the only remaining `balance_snapshots` writer) is retired in the same task after the grep in Task 6 confirms no reader.

## What already exists, and what happens to it

| File | Fate |
|---|---|
| `src/lib/repo/jobs.ts` `withJobLock` (+ the P3-C39 doc comment) | Rewritten (R9-1); the comment describes the session lock. Task 1. |
| `src/lib/db/index.ts` (`db` proxy over an internal `Pool`) | Exports `pool` for Task 1. |
| `src/lib/jobs/interest-accrual.ts`, `payroll-ingest.ts`, `payroll-retention.ts`, `sync-queue.ts`, `wallet-accounts-sync.ts` doc comments about the lock | Updated to state the new guarantee. Task 1. |
| `src/lib/db/schema/integrations.ts` `webhookDeliveries` | Gains `endpointId`, `userId`, `payload`, `nextAttemptAt`, `deliveredAt`; status values `queued`, `delivering`. Task 2. |
| `src/modules/integrations/api/routes.ts` `/webhooks/{provider}`, `application/handle-webhook.ts` | Replay protection + rate limit. Task 5. |
| `src/modules/payroll/application/apply-import.ts`, `src/modules/integrations/application/run-sync.ts`, `src/modules/budgets/application/refresh-usages.ts` | Gain an `outbox` port call. Task 2. |
| `src/app/(app)/finance/management/page.tsx`, `management/accounts/**` | Section list extended; the accounts page is unchanged. Tasks 3, 4. |
| `src/modules/payroll/domain/mapping.ts` `DEFAULT_MAPPING_RULES`; `payroll_mapping_rules` (user rows never written today) | User-level rules get CRUD. Task 3. |
| `src/modules/expenses/application/ports.ts` `CategoriesRepository`, `LabelsRepository` | Gain create/update/archive. Task 3. |
| `src/lib/db/schema/legacy.ts`, `src/lib/repo/balances.ts`, `src/lib/jobs/wallet-refresh.ts` (+test), `scripts/migrate-*.ts`, `scripts/validate-*.ts`, `src/lib/db/migrate.ts` legacy seed | Deleted / moved in Task 6 (R9-7). Migration scripts are deleted after their validators have been recorded as run; their `package.json` entries go with them. |
| `tests/e2e/README.md`, `smoke.spec.ts`, `settings.spec.ts` | README rewritten; new specs added. Task 7. |
| `docs/architecture/overview.md`, `docs/api/README.md`, `docs/deploy/*`, `docs/integrations/README.md`, `docs/migration/*` | Rewritten/extended in Task 8. |

## File structure

```
src/lib/repo/jobs.ts (rewrite withJobLock), src/lib/repo/jobs.itest.ts, src/lib/db/index.ts (export pool)
drizzle/0020_webhooks.sql, src/lib/db/schema/webhooks.ts (webhookEndpoints), schema/integrations.ts (modify webhookDeliveries), src/lib/db/webhooks-rls.itest.ts
src/platform/webhooks/{ports,envelope,signature,retry}.ts (+tests), outbox.ts (+itest), deliver.ts (+test)
src/lib/jobs/webhook-delivery.ts (+test), src/lib/jobs/housekeeping.ts (+itest)
src/modules/integrations/application/{list-webhook-endpoints,create-webhook-endpoint,update-webhook-endpoint,delete-webhook-endpoint,test-webhook-endpoint,set-sync-job-enabled}.ts (+tests), api routes, ui/WebhooksSection.tsx, ui/SyncJobsManager.tsx
src/modules/expenses/application/{create-category,update-category,create-label,update-label}.ts (+tests), api routes, ui/CategoriesManager.tsx, ui/LabelsManager.tsx
src/modules/payroll/application/{list-mapping-rules,create-mapping-rule,update-mapping-rule,delete-mapping-rule}.ts (+tests), api routes, ui/MappingRulesManager.tsx
src/modules/funds/application/{list-issues,resolve-issue}.ts (+tests), api routes, ui/IssuesManager.tsx, ui/ContributionTypesList.tsx
src/app/(app)/finance/management/{categories,labels,mapping-rules,issues,sync-jobs,contribution-types}/page.tsx, management/page.tsx (modify)
src/app/actions/management.ts
drizzle/0021_drop_legacy.sql, src/lib/db/schema/platform.ts (gains jobRuns, appSettings), schema/legacy.ts (deleted)
tests/e2e/{api-client.ts,budgets.spec.ts,funds.spec.ts,payroll-upload.spec.ts,home.spec.ts,webhooks.spec.ts}, tests/e2e/README.md
docs/architecture/overview.md, docs/api/README.md, docs/deploy/README.md, docs/deploy/phase-9-runbook.md, docs/migration/retrospective.md
docs/superpowers/handoff/2026-09-06-phase-9-checkpoint.md
```

---

### Task 1: Fix `withJobLock` (the platform defect from the Phase 4 checkpoint)

**Files:** Modify `src/lib/db/index.ts` (export the `Pool` as `pool`), `src/lib/repo/jobs.ts`; create `src/lib/repo/jobs.itest.ts`; update the doc comments in the five job files listed above.

- [ ] **Step 1: Test first** (`jobs.itest.ts`, real Postgres):
  1. `withJobLock("k", fn)` runs `fn` and returns its value; a concurrent second call with the same key while `fn` awaits a deferred promise returns `null`.
  2. While `fn` runs, `SELECT pg_try_advisory_lock(hashtext('k'))` on a separate client returns `false`; after `withJobLock` resolves it returns `true` (then unlock).
  3. `fn` can call `withUserContext(db, …)` inside (proving no enclosing transaction) and can throw — the lock is released and the error propagates.
  4. Different keys do not block each other.
- [ ] **Step 2: Implement** (R9-1):

```ts
export async function withJobLock<T>(key: string, fn: () => Promise<T>): Promise<T | null> {
  const client = await pool.connect();
  let locked = false;
  try {
    const res = await client.query<{ locked: boolean }>("SELECT pg_try_advisory_lock(hashtext($1)) AS locked", [key]);
    locked = res.rows[0]?.locked === true;
    if (!locked) return null;
    return await fn();
  } finally {
    if (locked) await client.query("SELECT pg_advisory_unlock(hashtext($1))", [key]).catch(() => undefined);
    client.release();
  }
}
```
Rewrite the doc comment: the lock is session-scoped, held for the whole call including network I/O, released on client death. Update the five job files' comments (remove the "runs inside one transaction" language); the interest-accrual `claimForPosting` defence stays, and its comment now says the lock is a real serialisation guarantee in addition.
- [ ] **Verify / Commit:** `npm run typecheck && npm test && npm run test:integration -- jobs`; `git add -A src && git commit -m "fix(jobs): session-level advisory lock so job bodies run outside a transaction (R9-1)"`

---

### Task 2: Outbound webhooks

**Files:** Create `drizzle/0020_webhooks.sql`, `src/lib/db/schema/webhooks.ts`, `src/lib/db/webhooks-rls.itest.ts`; `src/platform/webhooks/ports.ts`, `envelope.ts` (+test), `signature.ts` (+test), `retry.ts` (+test), `outbox.ts` (+itest), `deliver.ts` (+test with `msw`); `src/lib/jobs/webhook-delivery.ts` (+test); integrations use cases/routes/UI for endpoints. Modify `schema/integrations.ts`, `src/lib/contracts.ts` (`JobName` + `webhook_delivery`), `src/platform/jobs/register-all.ts`, `src/app/(app)/settings/admin/page.tsx` (`JOBS`/`JOB_LABEL`), the three emit points and their tests, `docs/api/*`.

- [ ] **Step 1: Schema.** `webhook_endpoints (id, user_id, url, secret_ciphertext bytea, key_id, events jsonb string[], enabled boolean default true, description, last_delivery_at, last_status, version, created_at, updated_at)` with the owner RLS policy; `webhook_deliveries` gains `endpoint_id uuid references webhook_endpoints on delete cascade`, `user_id uuid` (null for inbound rows), `payload jsonb`, `next_attempt_at timestamptz`, `delivered_at timestamptz`, and the status CHECK widened to `('queued','delivering','accepted','rejected','delivered','failed')`; index `(status, next_attempt_at) where direction = 'outbound'`. RLS on `webhook_deliveries`: `USING (app_is_system() OR user_id = app_current_user_id())` with the same `WITH CHECK` (inbound rows stay system-only). Itest: isolation, and a `queued` row is visible to its owner.
- [ ] **Step 2: Platform pieces** (unit-tested):
```ts
// envelope.ts
export type WebhookEvent = "payroll.import.completed" | "sync.completed" | "sync.failed" | "budget.threshold.exceeded";
export const WEBHOOK_EVENTS: readonly WebhookEvent[];
export interface WebhookEnvelope { id: string; event: WebhookEvent; occurredAt: string; userId: string; data: Record<string, unknown> }
export function buildEnvelope(input: { id: string; event: WebhookEvent; userId: string; data: Record<string, unknown>; now: Date }): WebhookEnvelope;
// signature.ts
export function signWebhook(secret: string, timestamp: string, body: string): string;   // "v1=" + hex hmac-sha256(secret, `${timestamp}.${body}`)
export function verifyWebhookSignature(secret: string, timestamp: string, body: string, header: string): boolean; // constant-time
// retry.ts
export const RETRY_DELAYS_S = [60, 300, 1800, 7200, 43200] as const;
export function nextAttemptAt(attempts: number, now: Date): Date | null;  // attempts = failures so far; null after the last retry → 'failed'
// ports.ts
export interface WebhookOutbox { enqueue(input: { userId: string; event: WebhookEvent; data: Record<string, unknown> }): Promise<number> } // rows created, one per subscribed enabled endpoint; bound to the caller's transaction
```
`outbox.ts`: `drizzleOutbox(tx: DbClient, clock): WebhookOutbox` (select the user's enabled endpoints whose `events` contains the event → insert deliveries) and `memoryOutbox()` for tests. `deliver.ts`: `deliverDue({ db, now, fetch, cipher, limit = 50, endpointId? })` selects due rows under `withSystemContext` and marks them `delivering`, then **outside any transaction** POSTs each with a 10 s timeout, then records the outcome per row (`delivered` + `delivered_at` + `response_code`, or `attempts + 1` and `next_attempt_at`/`failed`; `webhook_endpoints.last_delivery_at`/`last_status` updated). `msw` tests: 200 → delivered; 500 twice → the second `next_attempt_at` is 5 minutes later; sixth failure → `failed`; the signature header verifies with `verifyWebhookSignature`.
- [ ] **Step 3: Job** `webhook_delivery` (hourly tier, `withJobLock("webhook_delivery")`, calls `deliverDue`), registered in `register-all.ts`, listed in the admin panel.
- [ ] **Step 4: Emit points.** Add `outbox: WebhookOutbox` to the `UseCaseDeps` of payroll, integrations (`IntegrationDeps`) and budgets; the memory outbox records calls in tests. `applyImport` → `payroll.import.completed`; `run-sync.ts` on success/failure → `sync.completed`/`sync.failed`; `refreshUsages` → `budget.threshold.exceeded` per R9-4. Update the three use-case tests.
- [ ] **Step 5: Endpoints management.** Use cases `listWebhookEndpoints`, `createWebhookEndpoint` (returns the secret once; `url` must be `https:` unless `NODE_ENV !== "production"`), `updateWebhookEndpoint` (events, enabled, description; version), `deleteWebhookEndpoint`, `testWebhookEndpoint` (enqueues a `sync.completed`-shaped envelope with `data: { test: true }` and runs `deliverDue` for that endpoint only, outside the transaction). Routes under `/webhooks/endpoints` (tag `Webhooks`; permission `integrations.manage`), `WebhooksSection` on `/settings/integrations` (list, create with event checkboxes, one-time secret reveal, enable/disable, test, recent deliveries with status and response code, "Deliver now"). `npm run openapi:generate`.
- [ ] **Verify / Commit:** `npm run typecheck && npm test && npm run test:integration -- webhooks`; `git add -A src drizzle docs/api && git commit -m "feat(webhooks): outbound endpoints, signed deliveries with retries, four events (R9-2, R9-3)"`

---

### Task 3: Management — categories, labels, payroll mapping rules

**Files:** expenses use cases `createCategory`, `updateCategory` (`name`, `color`, `parentId`, `archived`), `createLabel`, `updateLabel` + routes (`POST/PATCH /expenses/categories[/{id}]`, `/expenses/labels[/{id}]`), `ui/CategoriesManager.tsx`, `LabelsManager.tsx`; payroll use cases `listMappingRules` (globals + user rows, merged order), `createMappingRule`, `updateMappingRule`, `deleteMappingRule` + routes (`GET/POST /payroll/mapping-rules`, `PATCH/DELETE /payroll/mapping-rules/{id}`; user rows only), `ui/MappingRulesManager.tsx`; pages `src/app/(app)/finance/management/{categories,labels,mapping-rules}/page.tsx`; `src/app/actions/management.ts`; `management/page.tsx` `SECTIONS` extended.

- [ ] Use cases assert `finance.manage` (categories/labels) and `payroll.review` (mapping rules); archiving a category with transactions keeps them (category id stays, `archived_at` set) — test it; a provider-mirrored category (has a `provider_links` row) accepts only `parentId`/`color` edits, not a rename (the sync would overwrite it) — test it; a mapping rule's `matchCode`/`matchLabel` regex is compiled at validation time and rejected with `InvalidInputError` when invalid; `priority` defaults to `100 + n` so user rules sort above globals.
- [ ] Pages: tables with inline rename (`SheetForm`), archive toggle, "New" sheet; the mapping-rules page has a "Try it" box that runs `classifyComponent` (`src/modules/payroll/domain/mapping.ts`) against a typed code/label with the merged rule set.
- [ ] `routes.itest.ts` additions in each module; `npm run openapi:generate`.
- [ ] **Verify / Commit:** `npm run typecheck && npm test && npm run test:integration -- expenses payroll && npm run build`; `git add -A src docs/api && git commit -m "feat(management): categories, labels and payroll mapping-rule editors"`

---

### Task 4: Management — reconciliation issues, sync jobs, contribution types

**Files:** funds use cases `listIssues` (all domains; filters `domain`, `status`, `severity`; cursor) and `resolveIssue` (alongside Phase 5's `acknowledgeIssue`), routes `GET /reconciliation/issues`, `POST /reconciliation/issues/{id}/resolve`; `ui/IssuesManager.tsx`, `ui/ContributionTypesList.tsx`; integrations use case `setSyncJobEnabled(principal, provider, kind, enabled)` + route `PATCH /integrations/{provider}/sync-jobs/{kind}`; `ui/SyncJobsManager.tsx`; pages `management/{issues,sync-jobs,contribution-types}/page.tsx`; `management/page.tsx` gains the entries and a link to `/finance/interests` labelled "Interest rules".

- [ ] Issues page: filter by domain/status/severity, Acknowledge/Resolve actions, link to the entity (`fund_month` → the fund detail with `?month=`; `fund_contribution` → the fund detail). Sync jobs page: one row per (connection, kind) with schedule tier, an enabled toggle, last run status, and "Run now" calling the existing `POST /integrations/{provider}/sync`. Contribution types: read-only list of `fund_contribution_types` with a footnote that the catalogue is static.
- [ ] Tests: `listIssues` pagination and filters; `setSyncJobEnabled` on a disconnected provider → `InvalidInputError`; route itests for the permissions (`finance.manage` for issues, `integrations.manage` for sync jobs).
- [ ] **Verify / Commit:** `npm run typecheck && npm test && npm run test:integration -- funds integrations && npm run build`; `git add -A src docs/api && git commit -m "feat(management): reconciliation issues, sync jobs and contribution types pages"`

---

### Task 5: Housekeeping retention and inbound webhook hardening

**Files:** `src/lib/jobs/housekeeping.ts` (+`.itest.ts`), `src/lib/contracts.ts` (`housekeeping`), `register-all.ts` (daily), the admin panel lists; `src/lib/jobs/payroll-retention.ts` (+test) reads `readPolicies(...).payrollRetentionDays`; `src/modules/integrations/application/handle-webhook.ts` (+itest) and its route; `src/platform/http/rate-limit.ts` (extract `consumeWindow`).

- [ ] Housekeeping itest: seed old and recent rows in each table and assert only the old ones are gone, the 5,000 cap holds (seed 5,100 old audit rows → 100 remain after one run), and the run records `job_runs.detail` with per-table counts.
- [ ] Inbound: `handle-webhook.ts` looks up `(provider, payload_hash)` in the last 24 h → returns the earlier `202` result without enqueuing (R9-6); a per-connection limit through `consumeWindow(db, key, limit, now)` extracted from `src/platform/http/rate-limit.ts` → `429 rate_limited`. Itest: a duplicate delivery → second response 202 with `queued: 0`; the 61st delivery in a minute → 429.
- [ ] **Verify / Commit:** `npm run typecheck && npm test && npm run test:integration -- housekeeping handle-webhook payroll-retention`; `git add -A src && git commit -m "feat(platform): housekeeping retention job; inbound webhook replay protection and rate limit (R9-5, R9-6)"`

---

### Task 6: Drop the legacy tables and the code that served them

**Files:** `drizzle/0021_drop_legacy.sql`; `src/lib/db/schema/platform.ts` (gains `jobRuns`, `appSettings`); delete `src/lib/db/schema/legacy.ts`, `src/lib/repo/balances.ts`, `src/lib/jobs/wallet-refresh.ts` (+test), `scripts/migrate-teable.ts`, `validate-teable-migration.ts`, `migrate-paperless.ts`, `validate-paperless-migration.ts`, `migrate-funds.ts`, `validate-funds-migration.ts`, `migrate-vacation-budget.ts`, `validate-vacation-budget-migration.ts`, `migrate-timeoff.ts`, `validate-timeoff-migration.ts`, and `import-file-credentials.ts` if its env vars are gone; modify `package.json` scripts, `src/lib/db/migrate.ts` (remove the legacy funds seed), `src/lib/contracts.ts` (`JobName` loses `wallet_refresh`), `register-all.ts`, the admin panel, `cron/crontab` if it names the job, `src/modules/payroll/infrastructure/paperless-import.ts` (+test) if only the scripts used it.

- [ ] **Step 0: Precondition check (do not skip).** Read `docs/superpowers/handoff/2026-09-06-phase-5-checkpoint.md`, the Phase 6 and the Phase 7 checkpoints and confirm each records its validator as **run in production with OK**. If any does not, stop this task and write the deviation: the drop is blocked until they are.
- [ ] **Step 1: Grep the readers.** `grep -rn "balanceSnapshots\|balance_snapshots\|recordSnapshots\|monthlyHistory\|latestBalances(" src scripts` — expected hits only in `schema/legacy.ts`, `repo/balances.ts`, `wallet-refresh.ts` (+test), `scripts/migrate-teable.ts`. Any other hit is a reader to migrate first (write the deviation).
- [ ] **Step 2: Schema move + migration.** Move `jobRuns`/`appSettings` to `schema/platform.ts`; delete `legacy.ts`; `npm run db:generate` produces the DROP statements (answer "drop" for each) → `0021_drop_legacy.sql`; check it contains exactly the eight `DROP TABLE` statements of R9-7 in a cascade-safe order (`fund_deposits` and `fund_settings` before `legacy_funds`; `payslips` after `fund_deposits`).
- [ ] **Step 3: Delete the code**, update `package.json`, `contracts.ts`, `register-all.ts`, the admin `JOBS`, `migrate.ts`. `npm run typecheck` drives the rest.
- [ ] **Verify / Commit:** `npm run typecheck && npm test && npm run test:db:up && npm run test:integration && npm run build`; `grep -rn "legacy\b\|paperless\|teable" src scripts --include=*.ts -il` returns only files whose hits are historical comments (list them in the commit message); `git add -A && git commit -m "refactor: drop the legacy tables and retire wallet_refresh and the migration scripts (R9-7)"`

---

### Task 7: Final e2e suite

**Files:** `tests/e2e/api-client.ts`, `budgets.spec.ts`, `funds.spec.ts`, `payroll-upload.spec.ts`, `webhooks.spec.ts`, `home.spec.ts`; `tests/e2e/README.md` (rewrite); `playwright.config.ts` (env `E2E_TOKEN`, `E2E_SESSION_COOKIE`).

- [ ] `api-client.ts`: a thin `request` wrapper adding `Authorization: Bearer ${E2E_TOKEN}` and a fresh `Idempotency-Key`. Specs `test.skip` with a clear message when the variable is absent, so `npm run e2e` stays green on a bare server.
- [ ] API specs (token): **budgets** — create a manual account, create a budget, add an allocation from that account, confirm `GET /accounts/{id}` balance unchanged and the allocation's `availableInSource` = balance − amount, add a category scope, refresh; **funds** — create a fund, a quarterly schedule, a manual contribution for last month → `postedMonth` per the rule, reverse it; **payroll-upload** — with `DOCUMENT_STORE_DRIVER=local` on the target, upload a fixture PDF (generate a one-page PDF in the spec with plain text, or skip when the store is the silo), poll `GET /payroll/imports/{id}` until `needs_review` or `needs_ocr`, upload the same bytes again → `409 duplicate`; **webhooks** — create an endpoint pointing at a local `http.createServer` started by the spec, call `POST /webhooks/endpoints/{id}/test`, assert the signature verifies with `verifyWebhookSignature`.
- [ ] Browser spec (cookie): **home** — with `E2E_SESSION_COOKIE`, `/` renders the cards the capabilities allow (read `/api/v1/integrations` first to decide whether the Expenses card must be present or absent; the Funds and Budgets cards are always expected).
- [ ] README: how to mint an `E2E_TOKEN` (Settings › Security), how to copy the session cookie, which specs need what, and the note that login + MFA cannot be automated without Authentik.
- [ ] **Verify / Commit:** `npm run e2e` against a hand-started `next dev` both with and without the variables; `git add tests playwright.config.ts && git commit -m "test(e2e): final API and browser flows"`

---

### Task 8: Closing documentation

**Files:** `docs/architecture/overview.md` (rewrite: module list including funds, budgets, timeoff, security, admin; the platform pieces: webhooks, session lock, housekeeping; "What's deferred" reduced to the real remainder: password login, export/deletion, fund valuations, OCR, auto-verify, provider-links browser, per-user cron dispatch, the `onDisconnect` invariant), `docs/api/README.md` (guide: session vs PAT auth, idempotency, versioning, pagination, errors, webhooks out, one example per module), `docs/deploy/README.md` (the standing procedure: build the image, `db:migrate`, tiers, env matrix, backup/restore), `docs/deploy/phase-9-runbook.md`, `docs/migration/retrospective.md` (Teable → Postgres, Paperless → silo, funds, vacation, leave: what moved, what the validators checked, what `0021` dropped), `docs/integrations/README.md` (webhooks section), the repo `README.md` if it references retired pieces.

- [ ] Write them; every path cited must exist: `for p in $(grep -oh 'src/[^ `)]*' ../docs/architecture/overview.md | sort -u); do test -e $p || echo MISSING $p; done` prints nothing.
- [ ] **Commit:** `git add ../docs ../README.md && git commit -m "docs: architecture, API guide, deployment, migration retrospective"`

---

### Task 9: Exit criteria

- [ ] Gate: `npm run typecheck && npm test && npm run test:db:up && npm run test:integration && npm run build && npm run openapi:generate && git diff --exit-code docs/api/openapi.json && npm run e2e`.
- [ ] `grep -rn "Phase [0-9]" src --include=*.ts --include=*.tsx | grep -iv "ruling\|R[0-9]-\|P[0-9]-C"` — review every hit: a comment saying "arrives in Phase N" for something now built is stale; fix them.
- [ ] Runbook `docs/deploy/phase-9-runbook.md`: dump; **confirm the three validators were run (Task 6 Step 0)**; deploy; migrate (`0020`, `0021`); verify the admin panel lists `webhook_delivery` and `housekeeping` and not `wallet_refresh`; create a webhook endpoint and send a test; rollback = restore the dump (**the drop is irreversible without it — say so in bold**).
- [ ] Manual walkthrough (record if owed): apply a payslip and see the `payroll.import.completed` delivery; archive a category from Management; resolve a reconciliation issue; confirm the wallet-manager container can be stopped once an interest rule with `post_to_provider` is on (spec §12.9) — state in the checkpoint whether that switch has been made.
- [ ] `graphify update .`; checkpoint (`docs/superpowers/handoff/2026-09-06-phase-9-checkpoint.md`: rulings R9-1…R9-7; the platform's remaining deferred list including the `onDisconnect` invariant; the note that `main` should now be pushed to `origin` — a decision for the owner, stated, not taken); `.superpowers/sdd/MASTER-LEDGER.md` all phases done.
- [ ] `git add -A ../docs ../graphify-out ../.superpowers && git commit -m "docs(handoff): Phase 9 checkpoint — platform rebuild complete"`

---

## Self-review against the spec

- §3.2 webhooks out: `webhook_endpoints` with HMAC-SHA256 ✔ (secret encrypted, not hashed — stated), four events ✔, delivered by the job runner with retries ✔ (Task 2).
- §3.4: inbound endpoints enqueue rather than work inline — already true; hardened ✔ (Task 5).
- §5.2 `webhook_endpoints`, `webhook_deliveries` ✔. §5.9 `reconciliation_issues` management ✔ (Task 4).
- §4 `/finance/management/*` gated on `finance.manage` ✔ (Tasks 3, 4; sync jobs additionally `integrations.manage`).
- §9 e2e list: login + MFA ✘ (needs Authentik; documented), connect Wallet (mocked) ✘ deferred, upload payslip ✔, verify and see earnings — partial (to `needs_review` only), create budget and allocation ✔, Home composition per capability ✔ (cookie).
- §11 Phase 9: management pages ✔ (providers/mappings deferred), webhooks ✔, retention jobs ✔, final e2e ✔ (scoped), docs ✔, drop legacy ✔ (Task 6 with the precondition). §12.9 ✔ (walkthrough item).
- Phase 4 "What remains": `withJobLock` ✔ (Task 1); `onDisconnect` I/O invariant — recorded, not fixed (scope cut).
- Type consistency: `WebhookEvent` is the single event union used by the envelope, the outbox port, endpoint `events` validation and the UI checkboxes; `nextAttemptAt` drives both `deliver.ts` and the msw test expectations; `WebhookOutbox.enqueue` has the same signature in the three modules' deps.
