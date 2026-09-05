# Phase 4: Payroll upload pipeline and Company — INCOMPLETE DRAFT, DO NOT EXECUTE

> **This is not an executable plan.** The planning run was terminated by a provider
> session limit before it wrote a single task. What survives below is the header,
> the architecture notes and the twelve design rulings (R4-1 … R4-12) — no
> `### Task N` sections exist, so there is nothing to dispatch.
>
> Kept because the rulings are real design work worth reusing: where uploaded
> document bytes live, the scanning boundary, upload idempotency, replacement and
> versioning, `needs_ocr` as a real status, `/work` becoming `/company`, and
> Earnings reading `payroll_records` rather than `payroll_imports`.
>
> **Before executing Phase 4:** re-run planning from the spec and the Phase 3
> checkpoint, carrying these rulings forward as input rather than treating them as
> settled. Verify each against the code as it now stands — the Phase 3 fix wave
> landed after these were written.


> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace Paperless with a first-party payroll document pipeline — upload → store (silo or local) → scan → extract → parse through the *existing* `src/lib/payroll/` engine → review → apply — writing `payroll_records`/`payroll_components` under RLS, surfacing them as Company Overview and Earnings, and retiring the Paperless client, its preview proxy, its webhook and its env vars.

**Architecture:** One new domain module, `src/modules/payroll/`, in the exact shape of `src/modules/accounts/` (`domain/`, `application/` with `ports.ts`, `infrastructure/` with Drizzle *and* memory repositories, `api/`, `ui/`), with the accounts-style flat `UseCaseDeps` bag and RLS context opened once by the caller. The parsing engine is **not rewritten**: `src/lib/payroll/{parse,text,teamsystem,rules,anchors,confidence,llm,llm-config}.ts` stay exactly where they are and keep their tests; the new module calls `parsePayslip()` with bytes read from the document store instead of bytes downloaded from Paperless. Document bytes never enter Postgres — they go to an S3-compatible `DocumentStore` (the existing `silo` container, reached through a `payroll_silo` integration connection) or, in development and tests, a local directory. A `MalwareScanner` boundary sits between "bytes stored" and "bytes readable or parseable". Two new jobs (`payroll_ingest`, `payroll_retention`) join the existing tick registry.

**Tech Stack:** Next.js 16.3, React 19, TypeScript 5.7 strict, Drizzle ORM 0.45 + drizzle-kit 0.31, Postgres 18, Zod 4, Hono 4 + `@hono/zod-openapi` 1.x, `unpdf` 1.8, vitest 3, Playwright. **No new npm dependency**: the S3 adapter signs its own AWS SigV4 requests with `node:crypto`, matching how `src/platform/integrations/crypto.ts` hand-rolls AES-256-GCM rather than pulling a library in.

**Spec:** `docs/superpowers/specs/2026-09-02-finance-company-platform-design.md` (§2.4 silo assumption, §2.5 scanner boundary, §4 page map, §5.8 payroll/earnings/time-off tables, §5.10 indexes, §6 feature matrix, §7.8 Company, §7.9 payroll upload, §8.3–8.4 upload validation and data protection, §10.2 Paperless migration, §11 Phase 4, §12.3/§12.10 breaking changes, §13.3 scanner default, §13.5 retention default).

## Global Constraints

- **Row-level security:** every user-owned table gets `FORCE ROW LEVEL SECURITY` with a policy of the shape `app_is_system() OR user_id = app_current_user_id()`; a table owned indirectly (`payroll_components`) uses an `EXISTS` join to its parent. Every such table needs a cross-user integration test proving isolation.
- **Secrets never leave the server:** no credential is echoed by an API response, rendered into HTML, logged, or written into an audit before/after payload. In this phase that covers the silo's access key and secret, the clamd host, and — new — the *document bytes themselves*: an audit row records the import id and a sha256, never a page of a payslip.
- **Never invent financial data:** a missing source renders an empty or setup state, never a zero. An import with no extraction yet shows "not parsed", not `€0.00`; a month with no payroll record is absent from Earnings, not a zero row.
- Cookie-authenticated `/api/v1` mutations require an `X-Requested-With` header, else `403 csrf_required` (already enforced globally in `src/platform/http/app.ts`; no route here is exempt).
- Provider names appear only in `*-adapter.ts`. This phase adds exactly one such file, `src/modules/payroll/infrastructure/silo-provider-adapter.ts`. `s3-document-store.ts` and `sigv4.ts` are protocol code, not provider code: they name S3 (a protocol) and never the `silo` container.
- Money: `numeric(16,2)` for postable money, `numeric(16,6)` for intermediates, `numeric(10,6)` for rates; parsed from decimal strings, never via `Number()`.
- Drizzle 0.45 wraps pg errors: a test asserting on a database error asserts on `err.cause.message`. A caught unique violation inside an open transaction needs a **savepoint** (`tx.transaction(...)` in Drizzle issues one) — Postgres aborts the enclosing transaction otherwise.
- Every commit carries the trailer:
  ```
  Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
  Claude-Session: https://claude.ai/code/session_017yo1RwU9CAfK1DqrGgLCYA
  ```
- All UI copy, labels, errors and docs in English. Italian appears only inside raw payroll component labels, as data (spec §2.9).
- Module layout: use cases in `src/modules/payroll/application`, ports in `ports.ts`, Drizzle and memory repositories in `infrastructure/`, Hono routes in `api/`, loaders and components in `ui/`. UI and API call the same use cases.
- **Deps shape:** `payroll` uses the accounts-style flat `UseCaseDeps` bag (repositories + `documents` + `scanner` + `clock` + `audit`; no `db`, no context-opening method). RLS context is opened exactly once by the caller — an API handler, a job, or `ui/run.ts` — via `withUserContext`/`withSystemContext` from `src/platform/db/context.ts`, which then builds a deps bag bound to that transaction (`payrollDeps(tx, …)`). A use case in this module never imports `withUserContext`. The older `src/modules/integrations/` module keeps its bound-context `IntegrationDeps` shape and is not restructured.
- **`withUserContext`/`withSystemContext` are called sequentially, never nested** — both open a transaction on the same pool.
- **No I/O outside Postgres ever happens inside an open database transaction.** Reading or writing document bytes, calling clamd, and calling the LLM all happen with no transaction open; the surrounding use cases are written as short transaction → I/O → short transaction, exactly as the Phase 2 sync engine's `fetch`/`apply` split does.
- **RLS-blind reads:** where a read's *result decides something*, the task says which context it runs in. A query on the pool-bound `db` handle with no `app.user_id` set returns zero rows instead of erroring, so a guard written that way passes vacuously.
- **Memory and Drizzle repositories are specified together, in the same task, in the same words**, and every repository pair gets a test that pins the *shared* contract — ordering, filtering, conflict-update field lists, and what a second write of the same key preserves. Phase 2 and Phase 3 lost time to five separate drifts between these two implementations (conflict-update behaviour, status filters, result ordering, id monotonicity affecting `desc(id)` tie-breaks, duplicate-name handling); every one of them was invisible to the unit suite because only the fake was under test.
- **Every uniqueness or exclusion claim is proven by an integration test against real Postgres**, not asserted in prose. This phase makes four such claims: `payroll_imports (user_id, sha256)`, `payroll_imports (user_id, idempotency_key)`, `payroll_records (import_id)`, and `payroll_records (user_id, period_start, kind) WHERE superseded_at IS NULL`.
- Use cases take a `Principal` and assert a permission (`src/platform/auth/permissions.ts`); RLS is the second wall. New tables carry `user_id` (directly, or reached by an `EXISTS` join through a table that does).
- New tables use `uuid` primary keys defaulting to `uuidv7()` and carry `created_at`/`updated_at` timestamptz (`defaultNow()`; there is no update trigger anywhere in this codebase — the application sets `updated_at` on every write). Every mutable entity carries `version integer not null default 1`; a PATCH requires the expected version (`If-Match` header or body `version`, via `parseExpectedVersion` in `src/platform/http/versioning.ts`) and answers `409 version_mismatch` on conflict — never swallowed.
- **Migrations:** from `dashboard-app/`, run `npm run db:generate` (this repo's `drizzle-kit generate` has no `--name` flag wired up; it auto-names from a word list), rename the output, then append RLS and seed statements by hand, one per `--> statement-breakpoint`, exactly as `drizzle/0010_integrations.sql` and `drizzle/0012_interests.sql` do. `drizzle/meta/_journal.json` and the generated snapshot are committed in the same commit as the `.sql`. **The next migration number is `0013`** (verified: `drizzle/` ends at `0012_interests.sql`); this phase adds exactly one, `0013_payroll.sql`.
- **`ErrorResponseSchema` is imported from `@/modules/accounts/api/schemas`**, never redeclared. Every module's routes register onto the same shared `ApiApp`/`OpenAPIHono` instance, so a second schema tagged `.openapi("ErrorResponse")` collides at `npm run openapi:generate` time. Only the per-module `errorResponse()`/`commonErrorResponses` wiring (plain route-description objects, not component registrations) is duplicated, matching accounts, integrations, expenses and interests.
- **`docs/api/openapi.json` is regenerated in the same task that changes a route** (`npm run openapi:generate`), so `src/platform/http/openapi-drift.test.ts` is green at every commit. No task ends on a knowingly-red suite.
- Unit tests are `*.test.ts` next to the source, run with `npm test`. Integration tests are `*.itest.ts`, run with `npm run test:db:up && npm run test:integration`, and use the harnesses already in the repo: `src/test/db.ts` (`testDb`/`resetDb`/`closeDb`) and `src/test/principal.ts` (`testPrincipal`). Never hand-roll a `makeDeps`.
- **A signature change and every one of its call sites land in the same task.** The three in this plan are: widening `ProviderCode` to include `payroll_silo` (Task 5), changing `CapabilityProbes.hasPayrollRecords` to read `payroll_records` under `withUserContext` (Task 5), and removing `"paperless"` from `UpstreamService` (Task 23).
- Dead exports and casts used to silence a type error do not survive review. The only `as` casts planned here narrow a Drizzle `text` column to its domain union at the repository boundary (`row.status as PayrollImportStatus`), the pattern `DrizzleAccountsRepository` already uses for the same reason.
- Do not create git branches or worktrees (a project hook blocks it). Commit on the checked-out branch after every task.
- Run `graphify update .` once, after the last task, not per task (Phase 2 Ruling P2-C15: per-task updates produced an unreviewable 9.5 MB diff).
- All commands run from `dashboard-app/` unless stated otherwise.

---

## What already exists, and what happens to it

This phase is **not greenfield**. Every file below exists today. The table is binding: a task that touches one of these files does what this table says.

| File | Fate | Where |
|---|---|---|
| `src/lib/payroll/parse.ts` | **Kept as-is.** `parsePayslip()` is called unchanged by the new ingest use case. Its `ParsePayslipInput.month` comment mentioning Paperless metadata is reworded in Task 23; no behaviour changes. | Tasks 11, 23 |
| `src/lib/payroll/text.ts` | **Kept, one comment reworded.** `extractPdfText` already takes a `Uint8Array` and needs no change: the bytes now come from the document store. The module doc-comment's "Paperless-ngx OCR `content`" line is rewritten in Task 23 to describe the `needs_ocr` state instead. `TextSource` stays `"pdf" \| "ocr"`. | Tasks 11, 23 |
| `src/lib/payroll/teamsystem.ts`, `rules.ts`, `anchors.ts`, `confidence.ts`, `llm.ts`, `llm-config.ts` | **Kept as-is, untouched.** No task modifies them. | — |
| `src/lib/payroll/*.test.ts`, `src/lib/payroll/__fixtures__/**` | **Kept as-is.** The fixtures are text, not PDFs (spec §10.2.5), so nothing about the Paperless retirement invalidates them. | — |
| `src/lib/jobs/payslip-ingest.ts` | **Deleted.** Superseded by `src/modules/payroll/application/ingest-import.ts` + `src/lib/jobs/payroll-ingest.ts`. Its two genuinely useful pieces — the Italian month-name title parser and the "a tredicesima is always December" rule — are ported into `src/modules/payroll/domain/period.ts` in Task 6 with their comments. | Task 23 |
| `src/lib/jobs/payslip-ingest.test.ts` | **Deleted** with its subject. | Task 23 |
| `src/lib/clients/paperless.ts` + `.test.ts` | **Deleted** in Task 23, after Task 22's migration script has used it to pull the 12 originals out. | Task 23 |
| `src/app/api/jobs/payslip-webhook/route.ts` | **Deleted** (spec §12.3: the payslip webhook endpoint is removed). | Task 23 |
| `src/app/api/paperless/preview/[id]/route.ts` | **Deleted**, replaced by `GET /api/v1/payroll/imports/{id}/original` (Task 18), which is scan-gated and audited. The `src/middleware.ts` CSP branch that special-cases `/api/paperless/preview/` moves to the new path in Task 18 and its Paperless form is deleted in Task 23. | Tasks 18, 23 |
| `src/lib/jobs/sweep.ts` | **Evolved.** Its one remaining step, `pollPayslips`, is deleted in Task 23; the job keeps the heartbeat it exists for. `sweep.test.ts` loses the polling cases in the same commit. | Task 23 |
| `src/lib/repo/payslips.ts` | **Kept, frozen, read-only.** The legacy `payslips` table stays as the archive of what was migrated; `verifiedPayslips()`/`latestVerified()` still feed `src/app/(app)/_lib/vacation.ts` (Ferie) and `src/lib/calc/payroll.ts` until Phase 7 replaces them. The *write* functions (`discover`, `storeExtraction`, `verify`, `reject`, `supersede`) lose their only callers in Task 23 and are deleted there. `medianNet`, `allPayslips`, `pendingVerification`, `knownDocIds`, `payslipById` also lose their callers and are deleted there. | Task 23 |
| `src/lib/db/schema/legacy.ts` (`payslips`, `fundDeposits`) | **Kept, no migration drops them.** Spec §11 Phase 9 does the "drop legacy tables" step. `fund_deposits` keeps being written by the new apply step (Task 13) so the Funds page keeps working until Phase 5. | — |
| `src/app/(app)/work/verify/[id]/page.tsx` | **Deleted**, its loader logic re-expressed as `src/modules/payroll/ui/load-review.ts` + `src/app/(app)/company/payroll/[importId]/page.tsx`. | Task 20, deleted in Task 21 |
| `src/app/(app)/work/verify/[id]/_components/VerifyForm.tsx` | **Evolved into** `src/modules/payroll/ui/ReviewForm.tsx`: same two-pane layout, same confidence tinting, same rules-vs-LLM candidate buttons, same queue advance. Changes: numeric ids become uuids, the PDF frame points at the new original route, and the actions become confirm / apply / reject / skip. | Task 20, original deleted in Task 21 |
| `src/app/(app)/work/verify/[id]/_components/queue.ts` + `queue.test.ts` | **Moved** to `src/modules/payroll/ui/queue.ts` + `queue.test.ts`, with `id: number` becoming `id: string` and `verifyHref` becoming `reviewHref`. | Task 20 |
| `src/app/(app)/work/verify/[id]/_components/QueueNav.tsx` | **Moved** to `src/modules/payroll/ui/QueueNav.tsx`, same change. | Task 20 |
| `src/app/(app)/work/page.tsx` and `work/_components/**`, `work/_lib/**` | **Relocated** to `/company/time-off` unchanged (Task 21). This is a route move, not the Phase 7 Time Off workspace redesign. | Task 21 |
| `src/app/actions/payslips.ts` | **Deleted**, replaced by `src/app/actions/payroll.ts` (Task 20). Its `upsertCometaDeposit` behaviour moves into the apply use case's legacy fund-deposit port (Task 13). | Task 21 |
| `src/platform/capabilities/probes.ts` | **Evolved.** `payrollConfigured()` stops meaning "is `PAPERLESS_URL` set"; `hasPayrollRecords` stops counting `payslips` on a pool-bound handle and counts `payroll_records` inside `withUserContext`. | Task 5 |
| `src/lib/env.ts` | **Evolved.** `PAPERLESS_URL`/`PAPERLESS_TOKEN`/`PAPERLESS_PAYSLIP_TAG_ID` removed (Task 23); `DOCUMENT_STORE_DRIVER`, `DOCUMENT_STORE_LOCAL_PATH`, `MALWARE_SCANNER`, `CLAMD_HOST`, `CLAMD_PORT` added (Tasks 2, 4). | Tasks 2, 4, 23 |

---

## File Structure

Every file this phase creates or modifies, relative to `dashboard-app/` unless stated otherwise.

```
Migration and schema
  drizzle/0013_payroll.sql                                          payroll_imports, payroll_records, payroll_components, payroll_mapping_rules + RLS + payroll_silo provider seed
  src/lib/db/schema/payroll.ts                                      Drizzle tables + row types
  src/lib/db/schema/index.ts (modify)                               re-export ./payroll
  src/lib/db/payroll-rls.itest.ts                                   RLS + uniqueness proofs against real Postgres

Document store (Rulings 1)
  src/modules/payroll/application/ports.ts                          DocumentStore, MalwareScanner and the four repository ports
  src/modules/payroll/domain/document.ts                            MAX_UPLOAD_BYTES, looksLikePdf, sha256Hex, newStorageKey
  src/modules/payroll/domain/document.test.ts
  src/modules/payroll/infrastructure/local-document-store.ts        filesystem adapter (development and tests)
  src/modules/payroll/infrastructure/local-document-store.test.ts
  src/modules/payroll/infrastructure/sigv4.ts                       AWS SigV4 request signer, node:crypto only
  src/modules/payroll/infrastructure/sigv4.test.ts                  signed against the AWS published test vector
  src/modules/payroll/infrastructure/s3-document-store.ts           S3-compatible adapter over fetch
  src/modules/payroll/infrastructure/s3-document-store.test.ts
  src/modules/payroll/infrastructure/document-store-resolver.ts     driver selection: silo connection or local path
  src/modules/payroll/infrastructure/document-store-resolver.test.ts

Scanning boundary (Ruling 2)
  src/modules/payroll/infrastructure/noop-scanner.ts                the default: declares clean, names itself "none"
  src/modules/payroll/infrastructure/clamd-scanner.ts               clamd INSTREAM over TCP
  src/modules/payroll/infrastructure/clamd-scanner.test.ts          against a real in-process TCP server
  src/modules/payroll/infrastructure/scanner-resolver.ts            MALWARE_SCANNER env → scanner
  src/modules/payroll/infrastructure/scanner-resolver.test.ts

Integration provider
  src/platform/integrations/types.ts (modify)                       ProviderCode gains "payroll_silo"
  src/platform/integrations/register-all.ts (modify)                registers siloProvider
  src/modules/payroll/infrastructure/silo-provider-adapter.ts       the payroll_silo IntegrationProvider
  src/modules/payroll/infrastructure/silo-provider-adapter.test.ts
  src/modules/integrations/api/schemas.ts (modify)                  provider enum gains "payroll_silo"
  src/platform/capabilities/resolve.ts (modify)                     payroll feature from the silo connection or a local path
  src/platform/capabilities/resolve.test.ts (modify)
  src/platform/capabilities/probes.ts (modify)                      hasPayrollRecords reads payroll_records under withUserContext
  src/platform/capabilities/probes.itest.ts (modify)
  src/platform/auth/permissions.ts (modify)                         payroll.upload, payroll.review, payroll.read, payroll.read_original

Payroll domain
  src/modules/payroll/domain/payroll.ts                             PayrollImport, PayrollRecord, PayrollComponent, statuses, transitions
  src/modules/payroll/domain/payroll.test.ts
  src/modules/payroll/domain/period.ts                              titleMonth, periodFor, recordKindOf (ported from payslip-ingest.ts)
  src/modules/payroll/domain/period.test.ts
  src/modules/payroll/domain/components.ts                          componentsFromExtraction
  src/modules/payroll/domain/components.test.ts
  src/modules/payroll/domain/mapping.ts                             PayrollMappingRule, DEFAULT_MAPPING_RULES, classifyComponent
  src/modules/payroll/domain/mapping.test.ts

Payroll application
  src/modules/payroll/application/deps.ts                           UseCaseDeps
  src/modules/payroll/application/errors.ts
  src/modules/payroll/application/create-import.ts                  createImport (upload)
  src/modules/payroll/application/ingest-import.ts                  ingestImport (scan → text → parse)
  src/modules/payroll/application/verify-import.ts                  verifyImport, rejectImport
  src/modules/payroll/application/apply-import.ts                   applyImport (records + components + legacy fund deposit)
  src/modules/payroll/application/list-imports.ts                   listImports, getImport
  src/modules/payroll/application/list-records.ts                   listRecords, getRecord, earningsSummary
  src/modules/payroll/application/read-original.ts                  readOriginal (scan-gated, audited)
  src/modules/payroll/application/purge-expired-originals.ts        the retention job's use case
  src/modules/payroll/application/*.test.ts                         one per use case above

Payroll infrastructure
  src/modules/payroll/infrastructure/memory-repositories.ts         the four in-memory repositories
  src/modules/payroll/infrastructure/memory-repositories.test.ts
  src/modules/payroll/infrastructure/drizzle-payroll-imports-repository.ts
  src/modules/payroll/infrastructure/drizzle-payroll-records-repository.ts
  src/modules/payroll/infrastructure/drizzle-payroll-components-repository.ts
  src/modules/payroll/infrastructure/drizzle-payroll-mapping-rules-repository.ts
  src/modules/payroll/infrastructure/legacy-fund-deposits.ts        the Phase-5 bridge: writes fund_deposits from an applied record
  src/modules/payroll/infrastructure/deps.ts                        payrollDeps(tx, opts)
  src/modules/payroll/infrastructure/repositories.itest.ts

Payroll API
  src/modules/payroll/api/schemas.ts
  src/modules/payroll/api/routes.ts                                 registerPayrollRoutes
  src/modules/payroll/api/routes.itest.ts
  src/platform/http/app.ts (modify)                                 registerPayrollRoutes joins registerAllRoutes
  docs/api/openapi.json (regenerated)

Payroll UI and pages
  src/modules/payroll/ui/run.ts, deps.ts
  src/modules/payroll/ui/queue.ts, queue.test.ts                    moved from work/verify/[id]/_components
  src/modules/payroll/ui/QueueNav.tsx                               moved
  src/modules/payroll/ui/ReviewForm.tsx                             the evolved VerifyForm
  src/modules/payroll/ui/UploadForm.tsx
  src/modules/payroll/ui/ImportsTable.tsx
  src/modules/payroll/ui/EarningsTable.tsx
  src/modules/payroll/ui/RecordDetail.tsx
  src/modules/payroll/ui/load-company.ts                            Overview + Earnings loaders
  src/modules/payroll/ui/load-payroll.ts                            imports list + review loaders
  src/app/(app)/company/page.tsx                                    Company Overview
  src/app/(app)/company/earnings/page.tsx, [recordId]/page.tsx
  src/app/(app)/company/payroll/page.tsx, [importId]/page.tsx
  src/app/(app)/company/time-off/page.tsx                           relocated from /work
  src/app/(app)/company/**/loading.tsx
  src/app/actions/payroll.ts                                        server actions for upload, verify, apply, reject
  src/app/(app)/work/** (deleted)
  src/app/actions/payslips.ts (deleted)
  src/platform/capabilities/navigation.ts (modify)                  Company group with Overview/Earnings/Time Off/Payroll
  src/platform/capabilities/navigation.test.ts (modify)
  src/modules/home/cards.ts (modify)                                leave card href, payroll import card
  src/modules/home/cards.test.ts (modify)
  src/middleware.ts (modify)                                        frame-src for the new original route

Jobs
  src/lib/contracts.ts (modify)                                     JobName gains payroll_ingest and payroll_retention; UpstreamService loses "paperless" (Task 23)
  src/lib/jobs/payroll-ingest.ts, payroll-ingest.test.ts
  src/lib/jobs/payroll-retention.ts, payroll-retention.test.ts
  src/platform/jobs/register-all.ts (modify)
  src/lib/jobs/sweep.ts (modify), sweep.test.ts (modify)            payslip polling removed

Paperless migration and removal
  scripts/migrate-paperless.ts                                      one-off: Paperless → document store + payroll_imports/records/components
  scripts/validate-paperless-migration.ts                           diffs migrated records against the legacy payslips rows
  src/modules/payroll/infrastructure/paperless-import.ts            the pure mapper the script uses
  src/modules/payroll/infrastructure/paperless-import.test.ts
  package.json (modify)                                             migrate:paperless, migrate:paperless:validate scripts
  docs/migration/paperless-reconciliation.md                        written by the migration run
  src/lib/clients/paperless.ts, paperless.test.ts (deleted)
  src/lib/jobs/payslip-ingest.ts, payslip-ingest.test.ts (deleted)
  src/app/api/jobs/payslip-webhook/route.ts (deleted)
  src/app/api/paperless/preview/[id]/route.ts (deleted)
  src/lib/repo/payslips.ts (modify: write functions deleted)
  src/lib/env.ts (modify), src/lib/env.test.ts (modify)
  src/test/integration-setup.ts (modify), src/lib/auth/machine.test.ts (modify)
  ../docker-compose.yml (modify)                                    PAPERLESS_* out, DOCUMENT_STORE_*/MALWARE_SCANNER in

Docs
  docs/architecture/overview.md (modify)
  docs/api/README.md (modify)
  docs/integrations/README.md (modify)
  docs/deploy/phase-4-runbook.md
  docs/migration/README.md (modify)
  docs/superpowers/handoff/2026-09-05-phase-4-checkpoint.md
  docs/superpowers/handoff/2026-09-05-phase-4-ledger.md
```

---

## Rulings

Made during planning, binding on execution. Each is argued from the spec.

- **R4-1 — Where document bytes live.** Bytes never enter Postgres. The database stores only metadata: `storage_provider` (`silo` | `local`), `storage_key`, `sha256`, `size_bytes`, `mime`, `file_name`, `pages`. Bytes go to a `DocumentStore` port with two adapters — `s3-document-store.ts` against the existing `silo` container (spec §2.4) and `local-document-store.ts` against a directory, for development and tests. The driver is chosen by `DOCUMENT_STORE_DRIVER`; the silo's endpoint, bucket and credentials live **encrypted in `integration_connections`** under a new `payroll_silo` provider (spec §5.2 lists exactly that provider code; `src/platform/integrations/types.ts` already carries the note "Ruling P2-C6: `payroll_silo` joins in Phase 4"), not in env vars, so this phase adds no new secret to `docker-compose.yml`. The object key is **not derivable from anything the client sees**: it is `payroll/{userId}/{YYYY}/{32 hex chars from randomBytes(16)}.pdf`, generated server-side and stored only in the row — never the sha256, never the import id, never the filename. There are no pre-signed URLs and the bucket is never public: every read is proxied by the app after an authorisation check (spec §8.4, "server-side access only (no public URLs)").
- **R4-2 — The scanning boundary.** "Scanning" is a `MalwareScanner` port, `scan(bytes) → { verdict: "clean" | "infected" | "unavailable"; scanner: string; signature: string | null }`, with a no-op default that answers `{ verdict: "clean", scanner: "none" }` and a clamd adapter speaking `zINSTREAM` over TCP (spec §2.5, §13.3 default: boundary only, no scanner enabled). The verdict is **persisted** (`scan_status`, `scanner`, `scan_signature`, `scanned_at`) so an audit can always answer "what cleared this file, and when". Consequences, all enforced: an `infected` verdict deletes the bytes from the store immediately, sets the import `rejected` with `error = "scan_infected"`, and is terminal — a retry re-rejects without re-reading anything. An `unavailable` verdict (clamd down, socket error, timeout) leaves the import in `scanning` with `error = "scan_unavailable"` and is retried by the next tick; the bytes are kept. **An import never reaches the parsing pipeline unless `scan_status = 'clean'`**, and **`readOriginal` refuses any import whose `scan_status` is not `'clean'` with `409 conflict`** — the "never served before it cleared the boundary" rule, enforced in the use case and proven by an integration test (Tasks 11, 18).
- **R4-3 — Idempotency.** The identity of a payslip upload is the **sha256 of its bytes, per user**, enforced by `CREATE UNIQUE INDEX payroll_imports_user_sha_uq ON payroll_imports (user_id, sha256)` — a database constraint, not an application check. Uploading the same file twice therefore cannot produce two imports, and since a `payroll_record` is created only from an import (`payroll_records_import_uq` on `import_id`), it cannot produce two payroll records either — which is precisely the phase's exit criterion. The application still checks first, for a good error message; the constraint is what makes the check safe under concurrency, and the check is wrapped in a **savepoint** (`tx.transaction(...)`) so a lost race surfaces as `409 duplicate` with the existing import id (spec §7.9) rather than an aborted transaction. One refinement: an import in status `failed` (bytes never landed in the store) is **reused** rather than duplicated — the row is reset and the bytes re-written — so a failed upload never dead-ends the user behind their own unique index. Spec §3.2's `Idempotency-Key` requirement is honoured by a second database constraint, `payroll_imports_user_idem_uq (user_id, idempotency_key)`, and *not* by the platform `idempotency()` middleware: that middleware clones and hashes the entire request body into a text string and stores the response — untenable for a 10 MB binary. Both constraints live in the database.
- **R4-4 — Replacement and versioning.** A corrected payslip is a different file, so it gets its own import (different sha256) carrying `replaces_import_id`. Applying it runs in one transaction: the superseded record gets `superseded_at = now()` and `superseded_by_record_id`, its import goes to status `superseded`, and only then is the new record inserted — which is what lets `payroll_records_period_uq (user_id, period_start, kind) WHERE superseded_at IS NULL` stay a hard constraint. **`payroll_components` of the superseded record are kept, not deleted**: they are the evidence for what was believed at the time, and Earnings simply never reads a superseded record. The legacy `fund_deposits` row for that month is re-upserted from the new record (its existing `UNIQUE (fund_id, month)` makes that a single upsert), so the Funds page follows the correction. Nothing is ever silently recomputed: superseding is an explicit, audited action of the apply step.
- **R4-5 — The retention job.** `payroll_retention` runs on the **daily** tier. It deletes **only document bytes**, never a row and never a payroll record: for each import whose `retention_until < now()`, whose status is terminal (`applied`, `rejected`, `superseded`) and whose `storage_key IS NOT NULL`, it deletes the object, then sets `storage_key = NULL`, `purged_at = now()`. `retention_until` is stamped at upload from `app_settings.payroll_retention_years`, default **10** (spec §13.5, the Italian statutory horizon). Three properties make it safe to run unattended: it is idempotent (a row with `storage_key IS NULL` is skipped, so a half-finished run resumes cleanly); it is capped (`PURGE_BATCH = 100` per run, so a misconfigured retention window cannot wipe the archive in one tick and a human has a day to notice); and it never touches an import in a live status (`received`, `scanning`, `extracting`, `parsed`, `needs_review`, `needs_ocr`, `verified`), so a document still being worked on is out of reach by construction. A separate, immediate purge path exists for `infected` (R4-2) and is not the job's business.
- **R4-6 — The apply step.** `applyImport` turns a `verified` import into one `payroll_record` plus its `payroll_components`, and re-upserts the legacy `fund_deposits` row for the month (the Phase-5 bridge that keeps the Funds page working). It is **idempotent and re-runnable**: `payroll_records_import_uq` means an import has at most one record, so re-applying recomputes that record's fields from the current verified values, bumps its `version`, replaces its components wholesale, and re-upserts the fund deposit — an audit row records before/after. It is **not reversible**: there is no `unapply`. The reverse of a wrong apply is a replacement import that supersedes it (R4-4), because the derived rows have no meaningful pre-state to restore and an "unapply" would leave Earnings with a hole no one asked for. Correspondingly, an import's *values* stay editable while it is `needs_review` or `verified`, and stop being editable once it is `applied` — a re-verify of an applied import returns `409 conflict` naming the replacement path.
- **R4-7 — Paperless removal happens in this phase, in two deployment waves, not two phases.** Task 22 adds `scripts/migrate-paperless.ts`, which needs the Paperless client and token to still exist; Task 23 deletes the client, the preview proxy, the webhook route, the sweep's polling step, the ingest job, the write half of `src/lib/repo/payslips.ts`, and the `PAPERLESS_URL` / `PAPERLESS_TOKEN` / `PAPERLESS_PAYSLIP_TAG_ID` env vars (spec §12.10). The runbook (Task 24) therefore prescribes **wave 1**: deploy the image built at Task 22's commit, run `npm run migrate:paperless` and `npm run migrate:paperless:validate`, read `docs/migration/paperless-reconciliation.md`; **wave 2**: deploy the image built at Task 25's commit and remove the three env vars from `docker-compose.yml`. This is the same two-wave shape the repo already learned from the fund-registry seed (commit `33bf33b`). What proves nothing still calls the deleted client: Task 23 removes `PAPERLESS_*` from `src/lib/env.ts` and `"paperless"` from `UpstreamService`, so any surviving call site fails `npx tsc --noEmit`; the task also runs an explicit `grep -rn "paperless\|Paperless\|PAPERLESS" src scripts` whose only permitted hits are the three parser fixtures under `src/lib/payroll/__fixtures__/` (payslip text that happens to contain the word) and `src/lib/db/schema/legacy.ts`'s frozen `paperless_doc_id` column.
- **R4-8 — Deps shape.** `payroll` uses the accounts-style flat `UseCaseDeps` bag, per the Phase 3 precedent (P3-2) and because `src/modules/accounts` is the reference vertical slice. Two of its members are *resolved by the caller before the transaction opens* — `documents: DocumentStore` and `scanner: MalwareScanner` — because resolving the store may require opening an integration connection and decrypting a credential, which is I/O that must not happen inside the transaction the use case runs in.
- **R4-9 — `needs_ocr` is a real status.** Spec §5.8's status list omits it and §7.9's prose requires it ("if below threshold, status `needs_ocr` until an OCR adapter is configured"). Both are the spec; the enum is extended rather than the behaviour dropped, because the alternative — silently parsing an empty string — would produce a confident-looking all-null extraction, exactly the "never invent financial data" failure. There is no OCR adapter in this phase (Paperless was the only OCR source and it is being retired); a scanned payslip therefore parks in `needs_ocr` with an explicit UI state and a `retry` that will pick it up once an adapter exists.
- **R4-10 — Component mapping targets are recorded, not acted on, except for funds.** `payroll_mapping_rules` (spec §5.8) can target `earnings`, `fund_contribution`, `timeoff_balance` and `timeoff_used`. `payroll_components.mapped_to` records the resolved target for every component in this phase, but only `fund_contribution` has a consumer in Phase 4 (the legacy `fund_deposits` bridge). `timeoff_balance`/`timeoff_used` targets are written and left for Phase 7's `timeoff_balances`; `fund_contributions` proper arrives in Phase 5. This is forward compatibility recorded in data, not dead code: every target is exercised by `classifyComponent`'s tests.
- **R4-11 — `/work` becomes `/company` in this phase, and Time Off is relocated, not redesigned.** Spec §4's page map has no `/work`. Deleting `/work` without moving its leave calendar would regress a working screen for three phases, so Task 21 moves `work/page.tsx`, `work/_components/**` and `work/_lib/**` verbatim to `/company/time-off`. The Phase 7 workspace (calendar + balances + in-place detail panel) is explicitly *not* built here.
- **R4-12 — Earnings reads records, never imports.** `earnings_summaries` is a view over records + components in the spec (§5.8: "no table"); here it is a use case, `earningsSummary`, computing gross/net/taxes/contributions per month, quarter and year from `payroll_records` + `payroll_components` with `superseded_at IS NULL`. No page reads `payroll_imports` for a financial figure — imports are pipeline state, records are money.

---
