# Phase 9 (reduced): Job lock, housekeeping, management API, closing docs

> **For agentic workers:** read `2026-09-07-phases-7-9-reduced-conventions.md` first, then the shared conventions. Tasks 1–3 ⚡ run in one session; Task 4 in its own. Steps use `- [ ]` syntax.

**Goal:** Fix the one real platform defect (`withJobLock` holding a transaction across job bodies), add the retention job and inbound-webhook replay protection, expose the management operations (categories, labels, payroll mapping rules, reconciliation issues, sync-job toggles) as API + server actions with no dedicated pages, and write the closing docs once. Outbound webhooks and the Management pages are deferred with the redesign. The legacy drop already happened in Phase 7.

**Rulings kept:** R9-1 (session-level advisory lock), R9-5 (housekeeping retention, 5,000-row cap, `payroll_retention` reads its days from settings — see note), R9-6 (inbound replay protection + per-connection rate limit).
**Rulings deferred:** R9-2, R9-3, R9-4 (outbound webhooks). **Ruling absorbed:** R9-7 (done in Phase 7 as R7-5').

Note on R9-5: the original wires `payroll_retention` to `policies.payrollRetentionDays` (Phase 8 R8-7). Policies are deferred, so `payroll_retention` keeps reading `app_settings` — no change.

## Deferred (append to `docs/superpowers/DEFERRED.md`)

- Outbound webhooks: `webhook_endpoints`, outbox in `webhook_deliveries`, `webhook_delivery` job, HMAC signing, the four events, endpoint management UI — original Task 2, R9-2/R9-3/R9-4. Nothing consumes them today.
- Management pages `/finance/management/{categories,labels,mapping-rules,issues,sync-jobs,contribution-types}` — original Tasks 3–4 UI parts. API and actions exist; pages come with the redesign.
- Final e2e suite beyond a smoke (original Task 7): `budgets`, `funds`, `payroll-upload`, `webhooks`, `home` specs.
- `onDisconnect` network-I/O invariant (Phase 4 PH4-C4) — still not fixed, as in the original.

## File structure

```
src/lib/repo/jobs.ts (rewrite withJobLock), src/lib/repo/jobs.itest.ts, src/lib/db/index.ts (export pool)
src/lib/jobs/housekeeping.ts (+itest)
src/platform/http/rate-limit.ts (extract consumeWindow), src/modules/integrations/application/handle-webhook.ts (+itest)
src/modules/expenses/application/{create-category,update-category,create-label,update-label}.ts, management.itest.ts
src/modules/payroll/application/{list-mapping-rules,create-mapping-rule,update-mapping-rule,delete-mapping-rule}.ts, mapping-rules.itest.ts
src/modules/funds/application/{list-issues,resolve-issue}.ts, issues.itest.ts
src/modules/integrations/application/set-sync-job-enabled.ts (+itest)
src/app/actions/management.ts
tests/e2e/api-client.ts, tests/e2e/smoke-api.spec.ts, tests/e2e/README.md
docs/architecture/overview.md, docs/api/README.md, docs/deploy/README.md, docs/superpowers/DEFERRED.md, docs/superpowers/handoff/2026-09-XX-rebuild-checkpoint.md
```

---

### Task 1 ⚡: Fix `withJobLock` (R9-1)

**Files:** Modify `src/lib/db/index.ts` (export `pool`), `src/lib/repo/jobs.ts`; create `src/lib/repo/jobs.itest.ts`; update the doc comments in `src/lib/jobs/interest-accrual.ts`, `payroll-ingest.ts`, `payroll-retention.ts`, `sync-queue.ts`, `wallet-accounts-sync.ts`.

- [x] **Step 1: `jobs.itest.ts`:** (1) `withJobLock("k", fn)` returns `fn`'s value and a concurrent second call with the same key returns `null` while `fn` awaits a deferred promise; (2) while `fn` runs, `SELECT pg_try_advisory_lock(hashtext('k'))` on another client is `false`, afterwards `true` (then unlock); (3) `fn` may call `withUserContext(db, …)` inside and may throw — lock released, error propagates; (4) different keys do not block.
- [x] **Step 2: Implement** with the code block in the original Phase 9 Task 1 Step 2 (checkout one `pg` client, `pg_try_advisory_lock`, run `fn` with no transaction on that client, `pg_advisory_unlock` in `finally`, release). Rewrite the doc comment; update the five job comments (drop the "runs inside one transaction" language; `claimForPosting` in interest-accrual stays).
- [x] **Verify:** `npm run typecheck && npm test && npm run test:integration -- jobs`. **Commit:** `git add -A src && git commit -m "fix(jobs): session-level advisory lock so job bodies run outside a transaction (R9-1)"`

---

### Task 2 ⚡: Housekeeping and inbound hardening (R9-5, R9-6)

**Files:** `src/lib/jobs/housekeeping.ts` (+`.itest.ts`), `src/lib/contracts.ts` (`JobName` + `housekeeping`), `src/platform/jobs/register-all.ts` (daily), `src/app/(app)/settings/admin/page.tsx` (`JOBS`/`JOB_LABEL`), `src/platform/http/rate-limit.ts` (extract `consumeWindow(db, key, limit, now)`), `src/modules/integrations/application/handle-webhook.ts` (+`.itest.ts`).

- [x] **Step 1: Housekeeping** purges `audit_events` > 730 d, `security_events` (skip — table does not exist in the reduced Phase 8), `job_runs`/`sync_runs` > 90 d, `webhook_deliveries` > 90 d, expired `idempotency_keys`, `rate_limit_windows` > 1 d; 5,000 rows per table per run; `job_runs.detail` records per-table counts. Itest: old vs recent rows per table; seed 5,100 old audit rows → 100 remain; detail counts present.
- [x] **Step 2: Inbound.** `handle-webhook.ts`: same `(provider, payload_hash)` in the last 24 h → return the earlier `202` result without enqueuing; per-connection `consumeWindow(...)` at 60/min → `429 rate_limited`. Itest: duplicate → second 202 with `queued: 0`; 61st in a minute → 429.
- [x] **Verify:** `npm run typecheck && npm test && npm run test:integration -- housekeeping handle-webhook`. **Commit:** `git add -A src && git commit -m "feat(platform): housekeeping retention job; inbound webhook replay protection and rate limit (R9-5, R9-6)"`

### Deviation (Task 2)

Three additions the brief implies but does not name, one reading it leaves open, and one correction from the task review:

1. **`WebhookOutcome` gained a `status`** (`accepted` | `duplicate` | `rate_limited` | `rejected`) and the route response gained `queued`. The brief asks for "a second 202 with `queued: 0`", and the shipped response was `{ accepted, runIds }` with no such field; the route also had no way to tell "refused" from "throttled". `accepted` is kept, so every existing caller and test still reads the same field. `docs/api/openapi.json` is regenerated and committed with this task rather than with Task 3, because otherwise `openapi-drift.test.ts` would fail on the Task 2 commit.
2. **The limiter reaches `handleWebhook` as a port** (`IntegrationDeps.consumeWindow`), wired to `consumeWindow(client, …)` in `integrationDeps`, rather than as a direct call on `deps.db`. The module's unit tests run on `unusedDb` (an intentionally unconnected client), so a direct call would have made every existing `handle-webhook.test.ts` case hit the network.
3. **Neither guard throws.** Both run inside `inSystemContext`'s transaction, and throwing would roll back the very `rate_limit_windows` and `webhook_deliveries` rows that make the guard work — the limiter would never trip. They return a status and the route maps it (429 for `rate_limited`).
4. **`job_runs`/`sync_runs` are aged by `COALESCE(finished_at, started_at)`.** The plan says "90 d" and names no column. Finishing is what makes a run's history uninteresting, and the fallback collects a run that died without ever finishing (a killed process leaves its row `running` for good) once it is older than the window, instead of leaving it in the table permanently. This is the executor's reading, not a controller ruling.
5. **The replay key is `(connection_id, payload_hash)`, not `(provider, payload_hash)` — Ruling P9-5** (fix round 1, after task review). The plan and the original R9-6 both say `(provider, payload_hash)`, and that is wrong: a provider payload need carry nothing user-specific (`{"event":"accounts.changed"}` is a real Wallet body), so two connections of the same provider belonging to two people routinely produce the same hash. Provider-wide, the second person's delivery is answered `duplicate` with `queued: 0` and its sync is dropped behind a 202 — work lost silently. `WebhookDeliveriesRepository.findAccepted` now takes the matched connection id and the Drizzle predicate is `connection_id = $1`. Covered by `handle-webhook.itest.ts` → "keys the replay window on the connection, not the provider (P9-5)".

---

### Task 3 ⚡: Management use cases, routes and actions (no pages)

**Files:** expenses `createCategory`, `updateCategory` (name, color, parentId, archived), `createLabel`, `updateLabel` + routes `POST/PATCH /expenses/categories[/{id}]`, `/expenses/labels[/{id}]` + `management.itest.ts`; payroll `listMappingRules` (globals + user rows, merged order), `createMappingRule`, `updateMappingRule`, `deleteMappingRule` + routes `GET/POST /payroll/mapping-rules`, `PATCH/DELETE /payroll/mapping-rules/{id}` + `mapping-rules.itest.ts`; funds `listIssues` (filters `domain`, `status`, `severity`; cursor), `resolveIssue` + routes `GET /reconciliation/issues`, `POST /reconciliation/issues/{id}/resolve` + `issues.itest.ts`; integrations `setSyncJobEnabled(principal, provider, kind, enabled)` + route `PATCH /integrations/{provider}/sync-jobs/{kind}` (+itest); `src/app/actions/management.ts` with one action per use case; `src/platform/http/app.ts`; `docs/api/README.md`.

- [x] **Step 1: Rules** (each proven in the module's itest): `finance.manage` for categories/labels/issues, `payroll.review` for mapping rules, `integrations.manage` for sync jobs; archiving a category with transactions keeps them (`archived_at` set); a provider-mirrored category (has a `provider_links` row) accepts only `parentId`/`color`, not a rename; a mapping rule's `matchCode`/`matchLabel` regex is compiled at validation time and rejected with `InvalidInputError` when invalid; `priority` defaults to `100 + n`; `setSyncJobEnabled` on a disconnected provider → `InvalidInputError`; `listIssues` pagination is disjoint across pages.
- [x] **Step 2:** routes + `npm run openapi:generate` + README additions; `actions/management.ts` (`"use server"`, `FormData`, `runForPrincipal`, `revalidatePath`) so the redesign only has to render forms.
- [x] **Step 3:** `DEFERRED.md` gets the four items above.
- [x] **Verify:** `npm run typecheck && npm test && npm run test:integration -- expenses payroll funds integrations`. **Commit:** `git add -A src docs/api && git commit -m "feat(management): categories, labels, mapping rules, issues and sync-job use cases as API + actions"`

### Deviation (Task 3)

Where the code the plan names differs from what is on `main`, and what was done instead:

1. **No `If-Match` on three of the four PATCHes.** `transaction_categories`, `transaction_labels` and `sync_jobs` have no `version` column, and this phase ships no migration, so `PATCH /expenses/categories/{id}`, `PATCH /expenses/labels/{id}` and `PATCH /integrations/{provider}/sync-jobs/{kind}` are last-writer-wins patches with no `428`/`409`. `reconciliation_issues` has no version either, and `resolve` is a POST that 404s a second time rather than racing. `payroll_mapping_rules` does have one, so `PATCH /payroll/mapping-rules/{id}` follows the convention in full. Recorded in `docs/api/README.md` under "Optimistic concurrency".
2. **Only `matchLabel` is compiled as a regex.** The brief says "matchCode/matchLabel regex"; in `classifyComponent` only `matchLabel` is a pattern (`new RegExp(rule.matchLabel, "i")`) — `matchCode` is compared with `===` against the parser's field codes. Compiling `matchCode` too would reject valid literal codes containing regex punctuation, so `assertMatchable` compiles `matchLabel` alone (`application/validate-mapping-rule.ts`).
3. **Write paths are `/expenses/…`, read paths stay `/transaction-categories`.** The plan names the write paths; the shipped read routes predate them. Renaming a shipped read path is a breaking change nothing asked for, so both surfaces exist and the README says so.
4. **Two repository ports grew, and two use cases take narrowed bags.** `PayrollMappingRulesRepository` gained `listManaged`/`get`/`create`/`update`/`remove` (the plan assumed CRUD it did not have), `IssuesRepository` gained `list`/`get`, `SyncJobsRepository` gained `setEnabled`, and the expenses `CategoriesRepository`/`LabelsRepository` gained `update` (plus `get` on labels). The mapping-rule use cases run on a new narrow `MappingRuleDeps` (`payrollMappingRuleDeps`) rather than `payrollDeps`, which resolves a document store and refuses the request when none is configured; `updateCategory` takes `UseCaseDeps & { links }` and `expenseDeps` was widened to supply it.
5. **`InvalidInputError` added to the integrations module** so `setSyncJobEnabled` on a disconnected provider answers `422 validation_failed` as the plan asks, rather than reusing `ConnectionNotUsableError`'s 409.
6. **The shared `security` constant lives in `src/platform/http/security-schemes.ts`**, not in `app.ts`: route modules import it as a value, and `app.ts` imports every route module, so putting it there would close an import cycle. It is annotated `RouteConfig["security"]` — without the annotation TypeScript widens the array and every `c.req.valid(...)` in the affected handlers collapses to `never`. `src/modules/security/api/routes.ts` keeps its own session-only constant with the P8-2 reasoning attached.

---

### Task 4: Smoke e2e, closing docs, final gate

**Files:** `tests/e2e/api-client.ts`, `tests/e2e/smoke-api.spec.ts`, `tests/e2e/README.md` (rewrite), `playwright.config.ts` (env `E2E_TOKEN`); `docs/architecture/overview.md` (rewrite), `docs/api/README.md` (guide: session vs PAT auth, idempotency, versioning, pagination, errors, one example per module), `docs/deploy/README.md` (build the image, `db:migrate`, job tiers, env matrix, backup), `docs/superpowers/DEFERRED.md` (final review), `docs/superpowers/handoff/<date>-rebuild-checkpoint.md`, repo `README.md` if it references retired pieces, `.superpowers/sdd/MASTER-LEDGER.md`.

- [ ] **Step 1: Smoke e2e.** `api-client.ts` adds `Authorization: Bearer ${E2E_TOKEN}` and a fresh `Idempotency-Key`; `smoke-api.spec.ts` (skipped with a clear message without the variable): `GET /accounts` 200; create a manual account; create a budget and an allocation from it and assert `GET /accounts/{id}` balance unchanged; create a fund and a manual contribution; `GET /timeoff/workspace`; `PUT /timeoff/events/{weekday}` then `DELETE`. README: how to mint a token on Settings › Security, the note that login/MFA cannot be automated without Authentik.
- [ ] **Step 2: Docs.** Architecture overview: module list (accounts, integrations, expenses, interests, payroll, funds, budgets, timeoff, security), platform pieces (session lock, housekeeping, inbound hardening), and a "Deferred" section that **links to `DEFERRED.md`** rather than repeating it. Every `src/` path cited must exist: `for p in $(grep -oh 'src/[^ \`)]*' ../docs/architecture/overview.md | sort -u); do test -e $p || echo MISSING $p; done` prints nothing. Deploy README replaces every `phase-N-runbook.md` (delete those files; the procedure is now the same for every release: build, `db:migrate`, restart, check the admin jobs panel).
- [ ] **Step 3: Stale comments.** `grep -rn "Phase [0-9]" src --include=*.ts --include=*.tsx | grep -iv "ruling\|R[0-9]-\|P[0-9]-C"` — fix every "arrives in Phase N" that is now built or deferred.
- [ ] **Step 4: Final gate.** `npm run typecheck && npm test && npm run test:db:up && npm run test:integration && npm run build && npm run openapi:generate && git diff --exit-code docs/api/openapi.json && npm run e2e` (without `E2E_TOKEN`: green with skips; with it against a hand-started `next dev`: green).
- [ ] **Step 5: Checkpoint** (one file for the whole reduced run): implemented / deployed / not deployed; rulings kept, dropped and replaced (R7-5', R9-7 absorbed); the manual repopulation the owner must do after deploying `0018` (re-upload payslips, re-enter time off, re-create the Holidays budget if it was migrated data); the standing remainder = `DEFERRED.md` + the `onDisconnect` invariant; the note that `main` should be pushed to `origin` — owner's decision, stated, not taken. `graphify update .` once. MASTER-LEDGER: all phases done (7–9 reduced).
- [ ] **Commit:** `git add -A && git commit -m "docs(handoff): rebuild complete — Phases 7–9 reduced; closing docs, smoke e2e, DEFERRED list"`
