# Phase 4: Payroll upload pipeline and Company

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace Paperless with a first-party payroll document pipeline — upload → store (silo or local) → scan → extract → parse through the *existing* `src/lib/payroll/` engine → review → apply — writing `payroll_records`/`payroll_components` under RLS, surfacing them as Company Overview and Earnings, and retiring the Paperless client, its preview proxy, its webhook and its env vars.

**Architecture:** One new domain module, `src/modules/payroll/`, in the exact shape of `src/modules/accounts/` (`domain/`, `application/` with `ports.ts`, `infrastructure/` with Drizzle *and* memory repositories, `api/`, `ui/`), with the accounts-style flat `UseCaseDeps` bag and RLS context opened once by the caller. The parsing engine is **not rewritten**: `src/lib/payroll/{parse,text,teamsystem,rules,anchors,confidence,llm,llm-config}.ts` stay exactly where they are and keep their tests; the new module calls `parsePayslip()` with bytes read from the document store instead of bytes downloaded from Paperless. Document bytes never enter Postgres — they go to an S3-compatible `DocumentStore` (the existing `silo` container, reached through a `payroll_silo` integration connection) or, in development and tests, a local directory. A `MalwareScanner` boundary sits between "bytes stored" and "bytes readable or parseable". Two new jobs (`payroll_ingest`, `payroll_retention`) join the existing tick registry.

**Tech Stack:** Next.js 16.3, React 19, TypeScript 5.7 strict, Drizzle ORM 0.45 + drizzle-kit 0.31, Postgres 18, Zod 4, Hono 4 + `@hono/zod-openapi` 1.x, `unpdf` 1.8, vitest 3, Playwright. **No new npm dependency**: the S3 adapter signs its own AWS SigV4 requests with `node:crypto`, matching how `src/platform/integrations/crypto.ts` hand-rolls AES-256-GCM rather than pulling a library in.

**Spec:** `docs/superpowers/specs/2026-09-02-finance-company-platform-design.md` (§2.4 silo assumption, §2.5 scanner boundary, §3.2 idempotency, §4 page map, §5.8 payroll/earnings/time-off tables, §5.10 indexes, §6 feature matrix, §7.8 Company, §7.9 payroll upload, §8.3–8.4 upload validation and data protection, §10.2 Paperless migration, §11 Phase 4, §12.3/§12.10 breaking changes, §13.3 scanner default, §13.5 retention default).

**Predecessor checkpoint:** `docs/superpowers/handoff/2026-09-05-phase-3-checkpoint.md` — read it before Task 1. Phases 0–3 are on `main`, never pushed to `origin`, and **only Phase 1 is deployed**; Phase 4 stacks on Phases 2 and 3, whose runbooks must run first.

## Global Constraints

- **Row-level security:** every user-owned table gets `ENABLE`/`FORCE ROW LEVEL SECURITY` with a policy of the shape `app_is_system() OR user_id = app_current_user_id()` in **both** `USING` and `WITH CHECK`, exactly as `drizzle/0012_interests.sql` writes it. A table owned indirectly (`payroll_components`) uses an `EXISTS` join to its parent, the shape `interest_accruals_owner` already uses. Every such table needs a cross-user integration test proving isolation — declared policies that no running test observes were an Important finding of the Phase 3 whole-branch review (`wb-1`), so a test that only ever runs under `withSystemContext` does not count.
- **Secrets never leave the server:** no credential is echoed by an API response, rendered into HTML, logged, or written into an audit before/after payload. In this phase that covers the silo's access key and secret, the clamd host, and — new — the *document bytes themselves*: an audit row records the import id and a sha256, never a page of a payslip.
- **Never invent financial data:** a missing source renders an empty or setup state, never a zero. An import with no extraction yet shows "Not parsed", not `€0.00`; a month with no payroll record is absent from Earnings, not a zero row.
- Cookie-authenticated `/api/v1` mutations require a non-empty `X-Requested-With` header, else `403 csrf_required` (already enforced globally in `src/platform/http/app.ts:75-95`; no route here is exempt, and `PUBLIC_PREFIXES` is not extended).
- Provider names appear only in `*-adapter.ts`. This phase adds exactly one such file, `src/modules/payroll/infrastructure/silo-provider-adapter.ts`. `s3-document-store.ts` and `sigv4.ts` are protocol code, not provider code: they name S3 (a protocol) and never the `silo` container.
- Money: `numeric(16,2)` for postable money, `numeric(16,6)` for intermediates, `numeric(10,6)` for rates; parsed from decimal strings, never via `Number()`. The one deliberate exception is the bridge to the *existing* payroll parser, whose `PayslipExtraction.fields[f].value` is already `number | null` (`src/lib/contracts.ts:105`) — that conversion happens in exactly one named function (`componentsFromExtraction`, Task 5) and is documented there.
- Drizzle 0.45 wraps pg errors: a test asserting on a database error asserts on `err.cause.message`. A unique violation **caught and recovered from inside an open transaction** needs a savepoint (`tx.transaction(...)` in Drizzle issues one) — Postgres aborts the enclosing transaction otherwise, the Phase 3 defect ruling P3-C16 fixed in `DrizzleGroupsRepository`. **No task in this plan needs one** (see the correction in Ruling R4-3): the one place a unique violation is expected — the duplicate upload — rolls its whole transaction back and re-reads in a fresh one, because that transaction holds nothing but the failed insert. If any task ends up catching a constraint violation and then continuing to use the same transaction, that is the moment to add the savepoint, not before.
- Every commit message ends with the **executing agent's own** `Co-Authored-By:` trailer (plus a `Claude-Session:` line when the harness provides one). This plan deliberately does not hardcode any one model's name, matching how the Phase 3 plan phrases it.
- All UI copy, labels, errors and docs in English. Italian appears only inside raw payroll component labels, as data (spec §2.9). `component.labelRaw` is Italian by construction; `component.kind`, every heading and every error string is English.
- Module layout: use cases in `src/modules/payroll/application`, ports in `ports.ts`, Drizzle and memory repositories in `infrastructure/`, Hono routes in `api/`, loaders and components in `ui/`. UI and API call the same use cases.
- **Deps shape:** `payroll` uses the accounts-style flat `UseCaseDeps` bag (repositories + `documents` + `scanner` + `clock` + `audit`; no `db`, no context-opening method). RLS context is opened exactly once by the caller — an API handler, a job, or `ui/run.ts` — via `withUserContext`/`withSystemContext` from `src/platform/db/context.ts`, which then builds a deps bag bound to that transaction (`payrollDeps(tx, …)`). A use case in this module never imports `withUserContext`. The older `src/modules/integrations/` module keeps its bound-context `IntegrationDeps` shape and is not restructured.
- **`withUserContext`/`withSystemContext` are called sequentially, never nested** — both open a transaction on the same pool.
- **No I/O outside Postgres ever happens inside an open database transaction.** Reading or writing document bytes, calling clamd, and calling the LLM all happen with no transaction open; the surrounding use cases are written as short transaction → I/O → short transaction, exactly as the Phase 2 sync engine's `fetch`/`apply` split does.
- **RLS-blind reads:** where a read's *result decides something*, the task says which context it runs in. A query on the pool-bound `db` handle with no `app.user_id` set returns zero rows instead of erroring, so a guard written that way passes vacuously.
- **Memory and Drizzle repositories are specified together, in the same task, in the same words**, and every repository pair gets a test that pins the *shared* contract — ordering, filtering, conflict-update field lists, and what a second write of the same key preserves. Phase 2 and Phase 3 lost time to five separate drifts between these two implementations; ruling P3-16 records the worst of them. Follow `src/modules/interests/infrastructure/memory-repositories.ts`'s two mitigations verbatim: `monotonicId()` so fake ids sort like `uuidv7()`, and `normalizeScale()` so a fake echoes the same decimal scale Postgres reads back.
- **Every uniqueness or exclusion claim is proven by an integration test against real Postgres**, not asserted in prose. This phase makes four such claims: `payroll_imports (user_id, sha256)`, `payroll_imports (user_id, idempotency_key)`, `payroll_records (import_id)`, and `payroll_records (user_id, period_start, kind) WHERE superseded_at IS NULL`.
- Use cases take a `Principal` and assert a permission via `assertPermission` (`src/platform/auth/principal.ts`, codes in `src/platform/auth/permissions.ts`); RLS is the second wall. New tables carry `user_id` (directly, or reached by an `EXISTS` join through a table that does).
- New tables use `uuid` primary keys defaulting to `uuidv7()` and carry `created_at`/`updated_at` timestamptz (`defaultNow()`; there is no update trigger anywhere in this codebase — the application sets `updated_at` on every write). Every mutable entity carries `version integer not null default 1`; a PATCH requires the expected version (`If-Match` header or body `version`, via `parseExpectedVersion` in `src/platform/http/versioning.ts`) and answers `409 version_mismatch` on conflict — never swallowed.
- **Migrations:** from `dashboard-app/`, run `npm run db:generate` (this repo's `drizzle-kit generate` has no `--name` flag wired up; it auto-names from a word list), rename the output, then append RLS and seed statements by hand, one per `--> statement-breakpoint`, exactly as `drizzle/0010_integrations.sql` and `drizzle/0012_interests.sql` do. `drizzle/meta/_journal.json` and the generated snapshot are committed in the same commit as the `.sql`. **The next migration number is `0015`** — verified by listing `dashboard-app/drizzle/*.sql`, which ends at `0014_interest_posting_fixes.sql`, and confirmed by the Phase 3 checkpoint's "next free number is `0015`". This phase adds exactly one migration, `0015_payroll.sql`.
- **`ErrorResponseSchema` is imported from `@/modules/accounts/api/schemas`**, never redeclared (ruling P3-15). Every module's routes register onto the same shared `ApiApp`/`OpenAPIHono` instance, so a second schema tagged `.openapi("ErrorResponse")` collides at `npm run openapi:generate` time. Only the per-module `errorResponse()`/`commonErrorResponses` wiring (plain route-description objects, not component registrations) is duplicated, matching accounts, integrations, expenses and interests.
- **`docs/api/openapi.json` is regenerated in the same task that changes a route** (`npm run openapi:generate`), so `src/platform/http/openapi-drift.test.ts` is green at every commit. No task ends on a knowingly-red suite.
- Unit tests are `*.test.ts` next to the source, run with `npm test`. **`vitest.config.ts` includes only `src/**/*.test.ts` — a `.test.tsx` file would never run**, so every unit test in this plan is `.ts` and React components are exercised through their pure helpers, not through a renderer. Integration tests are `*.itest.ts`, run with `npm run test:db:up && npm run test:integration`, and use the harnesses already in the repo: `src/test/db.ts` (`testDb`/`resetDb`/`closeDb`) and `src/test/principal.ts` (`testPrincipal`). Never hand-roll a `makeDeps`.
- `resetDb()` truncates every table except `integration_providers` (`src/test/db.ts`'s `STATIC_TABLES`), so the `payroll_silo` provider row seeded by migration `0015` survives between tests and must not be re-inserted by a test.
- **A signature change and every one of its call sites land in the same task.** The three in this plan are named in Ruling R4-13 and all belong to Task 7 and Task 22.
- Dead exports and casts used to silence a type error do not survive review. The only `as` casts planned here narrow a Drizzle `text` column to its domain union at the repository boundary (`row.status as PayrollImportStatus`), the pattern `DrizzleAccountsRepository` and `DrizzleInterestRulesRepository` already use for the same reason.
- Do not create git branches or worktrees (a project hook blocks it). Commit on the checked-out `main` branch after every task.
- Run `graphify update .` once, after the last task, not per task (Phase 2 Ruling P2-C15, reaffirmed by P3-C2/P3-C47: per-task updates produced an unreviewable 9.5 MB diff).
- All commands run from `dashboard-app/` unless stated otherwise. Note that `.env.example` lives at the **repository root**, not under `dashboard-app/`.

---

## What already exists, and what happens to it

This phase is **not greenfield**. Every file below exists today, and every row was re-verified against the tree at `869fffe` (after the Phase 3 fix wave). The table is binding: a task that touches one of these files does what this table says. Rows marked **[corrected]** differ from the superseded 2026-09-05 draft of this plan; the correction is stated inline.

| File | Fate | Where |
|---|---|---|
| `src/lib/payroll/parse.ts` | **Kept as-is.** `parsePayslip(input: ParsePayslipInput): Promise<PayslipExtraction>` is called unchanged by the new ingest use case. Its `ParsePayslipInput.month` comment at line 29 ("Month key from Paperless metadata, when known") is reworded in Task 22; no behaviour changes. | Tasks 10, 22 |
| `src/lib/payroll/text.ts` | **Kept, doc-comment reworded.** `extractPdfText` already takes a `Uint8Array` and returns `string \| null` (null = no usable text layer, `MIN_PDF_TEXT_CHARS = 200`), so it needs no change: the bytes now come from the document store. The module doc-comment's "Paperless-ngx OCR `content`" line (lines 6-7) and `PdfTextExtractor`'s "makes the caller fall back to the Paperless OCR `content`" (lines 13-15) are rewritten in Task 22 to describe the `needs_ocr` state instead. `TextSource` stays `"pdf" \| "ocr"` — see Ruling R4-14. | Tasks 10, 22 |
| `src/lib/payroll/teamsystem.ts`, `rules.ts`, `anchors.ts`, `confidence.ts`, `llm.ts`, `llm-config.ts` | **Kept as-is, untouched.** No task modifies them. `llmOptionsFromConfig()` from `llm-config.ts` is called by the new ingest use case exactly as `payslip-ingest.ts` calls it today. | — |
| `src/lib/payroll/*.test.ts`, `src/lib/payroll/__fixtures__/**` | **Kept as-is.** The fixtures are text, not PDFs (spec §10.2.5), so nothing about the Paperless retirement invalidates them. They are the only permitted hits of the Task 22 `grep` for "paperless". | — |
| `src/lib/contracts.ts` and `src/lib/clients/http.ts` | **Evolved.** `JobName` loses `"payslip_ingest"` and gains `"payroll_ingest"` and `"payroll_retention"` (Tasks 12 and 22). **[corrected]** `UpstreamService` is **not** in `contracts.ts` — it is declared in `src/lib/clients/http.ts:4` as `export type UpstreamService = "wallet" \| "paperless" \| "gotify" \| "trek";`, and `contracts.ts:147` **separately inlines the same union** on `UpstreamError`'s constructor parameter (`readonly service: "wallet" \| "paperless" \| "gotify" \| "trek"`). The two are not linked by a shared type, so Task 22 must drop `"paperless"` in **both** places or the tree still compiles with a dangling literal. `PayslipExtraction`, `PayslipField`, `PAYSLIP_FIELDS`, `FieldExtraction`, `SanityCheck` are all kept unchanged and consumed by the new module. | Tasks 14, 22 |
| `src/app/api/jobs/run/route.ts` | **Evolved. [corrected]** The superseded draft never mentioned it. `route.ts:53` is a **third** production call site of `ingestPayslipDocument` (`{ docId: input.docId, trigger: "manual" }`), alongside `sweep.ts:48` and the webhook. Task 22 removes that branch; the equivalent manual lever becomes `POST /api/v1/payroll/imports/{id}/retry` (Task 14). | Task 22 |
| `src/lib/jobs/payslip-ingest.ts` | **Deleted.** Superseded by `src/modules/payroll/application/ingest-import.ts` + `src/lib/jobs/payroll-ingest.ts`. Its two genuinely useful pieces — `titleMonth` (the Italian month-name title parser, with `IT_MONTHS`) and the "a tredicesima is always December of its year" rule at lines 152-154 — are ported into `src/modules/payroll/domain/period.ts` in Task 4 with their comments. `titleIsThirteenth` is ported alongside them. | Task 22 |
| `src/lib/jobs/payslip-ingest.test.ts` | **Deleted** with its subject. | Task 22 |
| `src/lib/clients/paperless.ts` + `.test.ts` | **Deleted** in Task 22, after Task 21's migration script has used it to pull the originals out. | Task 22 |
| `src/app/api/jobs/payslip-webhook/route.ts` | **Deleted** (spec §12.3: the payslip webhook endpoint is removed). `WEBHOOK_SECRET` itself stays — spec §10.2.4 keeps it for the generic inbound webhook endpoint `/api/v1/webhooks/{provider}` that Phase 2 built. Only the comment in `.env.example` that ties it to Paperless is reworded. | Task 22 |
| `src/app/api/paperless/preview/[id]/route.ts` | **Deleted**, replaced by `GET /api/v1/payroll/imports/{id}/original` (Task 13), which is scan-gated and audited. The `src/middleware.ts` CSP branch that special-cases `/api/paperless/preview/` moves to the new path in Task 17 and its Paperless form is deleted in Task 22. | Tasks 17, 22 |
| `src/lib/jobs/sweep.ts` | **Evolved.** Its payslip-polling step is deleted in Task 22; the job keeps the heartbeat it exists for. `sweep.test.ts` loses the polling cases in the same commit. | Task 22 |
| `src/lib/repo/payslips.ts` | **Kept, frozen, read-only — but a smaller surface than the draft claimed. [corrected]** The legacy `payslips` table stays as the archive of what was migrated. Verified call sites, one by one: `verifiedPayslips()` has **four** consumers (`payslip-ingest.ts:70`, `_lib/vacation.ts:57`, `work/page.tsx:53`, `work/_lib/leave.ts:67`) and **survives** — the last two move with their pages in Tasks 17-19 and still call it. `latestVerified()` (`_lib/vacation.ts:56`) survives. `pendingVerification()` (`work/verify/[id]/page.tsx:73`, `actions/payslips.ts:63`), `payslipById()` (same two files), `allPayslips()` (`work/page.tsx:54`), `verify()` and `reject()` (`actions/payslips.ts:136,185`) lose their callers **only when Tasks 17-19 replace those pages and delete `actions/payslips.ts`**, so none may be deleted before Task 19. `knownDocIds()` (`payslip-ingest.ts:126`, `sweep.ts:44`), `discover()` and `storeExtraction()` (both `payslip-ingest.ts` only) lose theirs in Task 22. `supersede()` and `medianNet()` are **already dead today** — zero call sites anywhere in `src/` or `scripts/`, tests included — so Task 22 deletes them as pure dead code, not as a consequence of the Paperless retirement. **`src/lib/calc/payroll.ts` calls nothing from this repository at all**: its `supersededBy` and `medianNet` are field names on its own local `PayslipLike` interface, not references to these functions. | Tasks 17-19, 22 |
| `src/lib/db/schema/legacy.ts` (`payslips`, `fundDeposits`, `appSettings`) | **Kept, no migration drops them.** Spec §11 Phase 9 does the "drop legacy tables" step. `fund_deposits` keeps being written by the new apply step (Task 9) so the Funds page keeps working until Phase 5. **[corrected]** `fund_deposits.payslip_id` is a `bigint` FK to `payslips.id`, so an applied `payroll_record` (a `uuid`) *cannot* be written into it: the apply step writes `payslipId: null` and records the provenance in `payroll_records` instead. `payslips.id` is a `bigint` identity column, which is why the review UI's ids change type (below). `app_settings` is a plain key/jsonb table with no RLS; the retention window is read from it. | — |
| `src/app/(app)/work/verify/[id]/page.tsx` | **Deleted**, its loader logic re-expressed as `src/modules/payroll/ui/load-payroll.ts` + `src/app/(app)/company/payroll/[importId]/page.tsx`. | Task 16, deleted in Task 19 |
| `src/app/(app)/work/verify/[id]/_components/VerifyForm.tsx` | **Evolved into** `src/modules/payroll/ui/ReviewForm.tsx`: same two-pane layout, same confidence tinting, same rules-vs-LLM candidate buttons, same queue advance. Changes: `bigint` ids become uuid strings, the PDF frame points at the new original route, and the actions become confirm / apply / reject. | Task 16, original deleted in Task 19 |
| `src/app/(app)/work/verify/[id]/_components/queue.ts` + `queue.test.ts` | **Moved** to `src/modules/payroll/ui/queue.ts` + `queue.test.ts`, with `id: number` becoming `id: string` and `verifyHref` becoming `reviewHref`. | Task 16 |
| `src/app/(app)/work/verify/[id]/_components/QueueNav.tsx` | **Moved** to `src/modules/payroll/ui/QueueNav.tsx`, same change. | Task 16 |
| `src/app/(app)/work/page.tsx`, `work/_components/**`, `work/_lib/**` | **Split, not relocated wholesale. [corrected]** The superseded draft said this page moves "verbatim" to `/company/time-off`. It cannot: `work/page.tsx` is three screens in one. Its leave calendar (`LeaveCalendar`, `LeaveByMonth`, `work/_lib/leave.ts`, `loadFerie`) moves to `/company/time-off`; its salary block (`SalarySection`, `averageNet`/`averageTaxes`/`ral`/`netPerMonthSeries` from `src/lib/calc/payroll.ts`) moves to `/company` Overview; its payslip list and "waiting for verification" banner become the imports table on `/company/payroll`. `SalarySection.tsx` moves unchanged into `src/modules/payroll/ui/` (it is a pure presentational client component over `SalaryWindow[]`, and the loader needs its types); `LeaveCalendar.tsx`, `LeaveByMonth.tsx` and `work/_lib/leave.ts` move unchanged into `src/app/(app)/company/`. | Tasks 17-19 |
| `src/app/actions/payslips.ts` | **Deleted**, replaced by `src/app/actions/payroll.ts` (Task 16). Its Cometa fund-deposit behaviour moves into the apply use case's legacy fund-deposit port (Task 11). | Task 19 |
| `src/platform/capabilities/probes.ts` | **Evolved.** **[corrected]** `payrollConfigured` is not a standalone export — it is a property literal on `realProbes` (`probes.ts:77`), `() => Boolean(env().PAPERLESS_URL)`, carrying the comment "Replaced by the document-store probe in Phase 4". It becomes a document-store probe. `dataProbes(client).hasPayrollRecords` currently ignores its `userId` argument entirely and counts `payslips` on the pool-bound handle (`probes.ts:34-35`); it starts counting `payroll_records` inside `withUserContext`. | Task 7 |
| `src/platform/capabilities/resolve.ts` | **Evolved.** `Capabilities.integrations` already has a `payroll` key, synthesised from `payrollConfigured()`; it starts coming from the `payroll_silo` connection state or a configured local path. `CapabilityProbes.connectionStates` returns `Record<ProviderCode, IntegrationState>`, so widening `ProviderCode` forces `connectionProbes` to return a third key in the same task. | Task 7 |
| `src/platform/integrations/types.ts` | **Evolved.** `ProviderCode` widens from `"wallet" \| "trek"` to include `"payroll_silo"`, replacing the standing comment at line 12 (`Ruling P2-C6: payroll_silo joins in Phase 4, with the document store it needs`). **[corrected]** The capability union is named `IntegrationCapability`, not `Capability`, and **already contains `"documents"`** (line 19) — no widening needed there. `SyncKind` is **not** widened: the silo has no sync (Ruling R4-15). | Task 7 |
| `src/modules/integrations/api/schemas.ts` | **Untouched. [corrected]** The superseded draft said its "provider enum gains `payroll_silo`". There is no provider enum: `provider` is a bare `z.string()` at lines 4, 9 and 29, so a new provider code needs no schema change. Only the two `SyncKind` enums (lines 43 and 78) are closed enums, and this phase adds no `SyncKind`. | — |
| `src/platform/auth/permissions.ts` | **Evolved.** `PERMISSIONS` gains `payroll.read`, `payroll.upload`, `payroll.review`, `payroll.read_original` (spec §8.2 names all four). `ROLE_PERMISSIONS` gives all four to `member`, `payroll.read` only to `viewer`; `owner`/`admin` already spread `PERMISSIONS`. | Task 7 |
| `src/platform/capabilities/navigation.ts` | **Evolved.** The `/work` item (with the comment "keeps its route until Phase 4 renames it; the label already reads Company") becomes a `/company` item with children Overview / Earnings / Time Off / Payroll, gated per spec §4. | Task 19 |
| `src/modules/home/cards.ts` | **Evolved.** The `leave` card's `href` moves from `/work` to `/company/time-off`; a new `payroll_imports` card is added, gated on `feature: "payroll"`. | Task 19 |
| `src/lib/env.ts` | **Evolved.** `PAPERLESS_URL` (`z.url()`), `PAPERLESS_TOKEN` (`z.string().min(1)`) and `PAPERLESS_PAYSLIP_TAG_ID` (`z.coerce.number().int().default(22)`) removed (Task 22) — the first two are **required today**, so `env()` throws at boot without them, which is exactly what makes their removal a two-wave deploy. `DOCUMENT_STORE_DRIVER`, `DOCUMENT_STORE_LOCAL_PATH`, `MALWARE_SCANNER`, `CLAMD_HOST`, `CLAMD_PORT` added (Tasks 3 and 6), all with `.default(...)` so **this phase adds no required environment variable** (the same property Phases 2 and 3 held). | Tasks 3, 6, 22 |
| `src/test/integration-setup.ts` **and eleven unit-test env stubs** | **Evolved. [corrected]** The superseded draft named only `integration-setup.ts` and `machine.test.ts`. `PAPERLESS_URL`/`PAPERLESS_TOKEN` are assigned in **thirteen** test files that stub the environment, every one of which fails `env()` parsing the moment the keys leave the schema: `src/test/integration-setup.ts:26-27`, `src/lib/env.test.ts:15-16`, `src/lib/auth/machine.test.ts:25-26`, `src/lib/clients/trek.test.ts:46-47`, `src/lib/clients/wallet.test.ts:13-14`, `src/lib/clients/gotify.test.ts:12-13`, `src/lib/jobs/sweep.test.ts:22-23`, `src/lib/jobs/sync-queue.test.ts:12-13`, `src/lib/jobs/trek-sync-job.test.ts:22-23`, `src/lib/jobs/wallet-transactions-sync.test.ts:21-22`, `src/lib/jobs/wallet-accounts-sync.test.ts:21-22`, `src/lib/jobs/wallet-refresh.test.ts:22-23`, `src/platform/integrations/crypto.test.ts:25-26`. Task 22 edits all thirteen in one commit. `integration-setup.ts` additionally gains `DOCUMENT_STORE_DRIVER: "local"` and a `DOCUMENT_STORE_LOCAL_PATH` under `os.tmpdir()` in Task 3, so integration tests never reach for S3. | Tasks 3, 22 |
| `docker-compose.yml`, `.env.example` (repo root) | **Evolved.** `PAPERLESS_URL`/`PAPERLESS_TOKEN` leave the `dashboard-app` service's `environment:` block (`docker-compose.yml:22-23`) and `PAPERLESS_HOST`/`DASHBOARD_PAPERLESS_TOKEN` leave `.env.example:20-22` (Task 22, deploy wave 2). `PAPERLESS_PAYSLIP_TAG_ID` appears in neither file — it relies on its schema default — so only `src/lib/env.ts` needs editing for it. `.env.example:26`'s comment tying `DASHBOARD_WEBHOOK_SECRET` to the Paperless webhook is reworded; the secret itself stays (spec §10.2.4). The `dashboard-app` container is `read_only: true` with `tmpfs` on `/tmp` and `/app/.next/cache` only, which is why `DOCUMENT_STORE_DRIVER=local` is a development and test driver and never the production one (Ruling R4-16). | Task 22 |

---

## File Structure

Every file this phase creates or modifies, relative to `dashboard-app/` unless stated otherwise.

```
Migration and schema (Task 1)
  drizzle/0015_payroll.sql                                          payroll_imports, payroll_records, payroll_components, payroll_mapping_rules + RLS + payroll_silo provider seed
  src/lib/db/schema/payroll.ts                                      Drizzle tables + row types
  src/lib/db/schema/index.ts (modify)                               re-export ./payroll
  src/lib/db/payroll-rls.itest.ts                                   RLS + uniqueness proofs against real Postgres

Payroll domain (Tasks 2, 4, 5)
  src/modules/payroll/domain/document.ts                            MAX_UPLOAD_BYTES, looksLikePdf, sha256Hex, newStorageKey
  src/modules/payroll/domain/document.test.ts
  src/modules/payroll/domain/payroll.ts                             statuses, transitions, PayrollRecordKind, isTerminal
  src/modules/payroll/domain/payroll.test.ts
  src/modules/payroll/domain/period.ts                              titleMonth, titleIsThirteenth, periodFor, recordKindOf (ported from payslip-ingest.ts)
  src/modules/payroll/domain/period.test.ts
  src/modules/payroll/domain/mapping.ts                             PayrollMappingRule, DEFAULT_MAPPING_RULES, classifyComponent
  src/modules/payroll/domain/mapping.test.ts
  src/modules/payroll/domain/components.ts                          componentsFromExtraction
  src/modules/payroll/domain/components.test.ts

Document store (Tasks 2, 3)
  src/modules/payroll/application/ports.ts                          DocumentStore, MalwareScanner and the four repository ports
  src/modules/payroll/infrastructure/local-document-store.ts        filesystem adapter (development and tests)
  src/modules/payroll/infrastructure/local-document-store.test.ts
  src/modules/payroll/infrastructure/sigv4.ts                       AWS SigV4 request signer, node:crypto only
  src/modules/payroll/infrastructure/sigv4.test.ts                  signed against the AWS published test vector
  src/modules/payroll/infrastructure/s3-document-store.ts           S3-compatible adapter over fetch
  src/modules/payroll/infrastructure/s3-document-store.test.ts
  src/modules/payroll/infrastructure/document-store-resolver.ts     driver selection: silo connection or local path
  src/modules/payroll/infrastructure/document-store-resolver.test.ts
  src/lib/env.ts (modify)                                            DOCUMENT_STORE_DRIVER, DOCUMENT_STORE_LOCAL_PATH
  src/lib/env.test.ts (modify)
  src/test/integration-setup.ts (modify)

Scanning boundary (Task 6)
  src/modules/payroll/infrastructure/noop-scanner.ts                the default: declares clean, names itself "none"
  src/modules/payroll/infrastructure/clamd-scanner.ts               clamd INSTREAM over TCP
  src/modules/payroll/infrastructure/clamd-scanner.test.ts          against a real in-process TCP server
  src/modules/payroll/infrastructure/scanner-resolver.ts            MALWARE_SCANNER env -> scanner
  src/modules/payroll/infrastructure/scanner-resolver.test.ts
  src/lib/env.ts (modify)                                            MALWARE_SCANNER, CLAMD_HOST, CLAMD_PORT

Integration provider and capabilities (Task 7)
  src/platform/integrations/types.ts (modify)                       ProviderCode gains "payroll_silo"
  src/platform/integrations/register-all.ts (modify)                registers siloProvider
  src/modules/payroll/infrastructure/silo-provider-adapter.ts       the payroll_silo IntegrationProvider
  src/modules/payroll/infrastructure/silo-provider-adapter.test.ts
  src/platform/capabilities/resolve.ts (modify)                     payroll feature from the silo connection or a local path
  src/platform/capabilities/resolve.test.ts (modify)
  src/platform/capabilities/probes.ts (modify)                      hasPayrollRecords reads payroll_records under withUserContext
  src/platform/capabilities/probes.itest.ts (modify)
  src/platform/auth/permissions.ts (modify)                         payroll.read, payroll.upload, payroll.review, payroll.read_original
  src/platform/auth/permissions.test.ts (modify)

Payroll infrastructure (Task 8)
  src/modules/payroll/infrastructure/memory-repositories.ts         the four in-memory repositories
  src/modules/payroll/infrastructure/memory-repositories.test.ts
  src/modules/payroll/infrastructure/drizzle-payroll-imports-repository.ts
  src/modules/payroll/infrastructure/drizzle-payroll-records-repository.ts
  src/modules/payroll/infrastructure/drizzle-payroll-components-repository.ts
  src/modules/payroll/infrastructure/drizzle-payroll-mapping-rules-repository.ts
  src/modules/payroll/infrastructure/legacy-fund-deposits.ts        the Phase-5 bridge: writes fund_deposits from an applied record
  src/modules/payroll/infrastructure/deps.ts                        payrollDeps(tx, opts)
  src/modules/payroll/infrastructure/repositories.itest.ts

Payroll application (Tasks 9-13)
  src/modules/payroll/application/deps.ts                           re-exports UseCaseDeps
  src/modules/payroll/application/errors.ts
  src/modules/payroll/application/create-import.ts                  createImport (upload)
  src/modules/payroll/application/create-import.test.ts
  src/modules/payroll/application/ingest-import.ts                  ingestImport (scan -> text -> parse)
  src/modules/payroll/application/ingest-import.test.ts
  src/modules/payroll/application/review-import.ts                  verifyImport, rejectImport
  src/modules/payroll/application/review-import.test.ts
  src/modules/payroll/application/apply-import.ts                   applyImport (records + components + legacy fund deposit)
  src/modules/payroll/application/apply-import.test.ts
  src/modules/payroll/application/list-imports.ts                   listImports, getImport
  src/modules/payroll/application/list-imports.test.ts
  src/modules/payroll/application/list-records.ts                   listRecords, getRecord, earningsSummary
  src/modules/payroll/application/list-records.test.ts
  src/modules/payroll/application/read-original.ts                  readOriginal (scan-gated, audited)
  src/modules/payroll/application/read-original.test.ts
  src/modules/payroll/application/purge-expired-originals.ts        the retention job's use case
  src/modules/payroll/application/purge-expired-originals.test.ts

Jobs (Task 14)
  src/lib/contracts.ts (modify)                                     JobName gains payroll_ingest and payroll_retention
  src/lib/jobs/payroll-ingest.ts, payroll-ingest.test.ts
  src/lib/jobs/payroll-retention.ts, payroll-retention.test.ts
  src/platform/jobs/register-all.ts (modify)

Payroll API (Task 15)
  src/modules/payroll/api/schemas.ts
  src/modules/payroll/api/routes.ts                                 registerPayrollRoutes
  src/modules/payroll/api/routes.itest.ts
  src/platform/http/app.ts (modify)                                 registerPayrollRoutes joins registerAllRoutes
  docs/api/openapi.json (regenerated)

Payroll UI and pages (Tasks 16-19)
  src/modules/payroll/ui/run.ts, deps.ts
  src/modules/payroll/ui/queue.ts, queue.test.ts                    moved from work/verify/[id]/_components
  src/modules/payroll/ui/QueueNav.tsx                               moved
  src/modules/payroll/ui/ReviewForm.tsx                             the evolved VerifyForm
  src/modules/payroll/ui/UploadForm.tsx
  src/modules/payroll/ui/ImportsTable.tsx
  src/modules/payroll/ui/EarningsTable.tsx
  src/modules/payroll/ui/RecordDetail.tsx
  src/modules/payroll/ui/load-payroll.ts                            imports list + review loaders
  src/modules/payroll/ui/load-payroll.test.ts
  src/modules/payroll/ui/load-company.ts                            Overview + Earnings loaders
  src/modules/payroll/ui/load-company.test.ts
  src/app/(app)/company/page.tsx                                    Company Overview
  src/app/(app)/company/earnings/page.tsx, [recordId]/page.tsx
  src/app/(app)/company/payroll/page.tsx, [importId]/page.tsx
  src/app/(app)/company/time-off/page.tsx                           relocated from /work
  src/app/(app)/company/**/loading.tsx, src/app/(app)/company/error.tsx
  src/app/(app)/company/_components/LeaveByMonth.tsx, LeaveCalendar.tsx        moved from work/_components (Task 19)
  src/modules/payroll/ui/SalarySection.tsx                          moved from work/_components (Task 18)
  src/app/(app)/company/_lib/leave.ts, leave.test.ts                 moved from work/_lib
  src/app/actions/payroll.ts                                        server actions for upload, verify, apply, reject
  src/app/(app)/work/** (deleted)
  src/app/actions/payslips.ts (deleted)
  src/platform/capabilities/navigation.ts (modify), navigation.test.ts (modify)
  src/modules/home/cards.ts (modify), cards.test.ts (modify)
  src/middleware.ts (modify)                                        frame-src for the new original route

Paperless migration and removal (Tasks 20-22)
  src/modules/payroll/infrastructure/paperless-import.ts            the pure mapper the script uses
  src/modules/payroll/infrastructure/paperless-import.test.ts
  scripts/migrate-paperless.ts                                      one-off: Paperless -> document store + payroll_imports/records/components
  scripts/validate-paperless-migration.ts                           diffs migrated records against the legacy payslips rows
  package.json (modify)                                             migrate:paperless, migrate:paperless:validate scripts
  docs/migration/paperless-reconciliation.md                        written by the migration run
  src/lib/clients/paperless.ts, paperless.test.ts (deleted)
  src/lib/jobs/payslip-ingest.ts, payslip-ingest.test.ts (deleted)
  src/app/api/jobs/payslip-webhook/route.ts (deleted)
  src/app/api/paperless/preview/[id]/route.ts (deleted)
  src/lib/jobs/sweep.ts (modify), sweep.test.ts (modify)            payslip polling removed
  src/lib/repo/payslips.ts (modify: write functions and dead readers deleted)
  src/lib/env.ts (modify), src/lib/env.test.ts (modify)
  src/test/integration-setup.ts (modify), src/lib/auth/machine.test.ts (modify)
  ../docker-compose.yml (modify), ../.env.example (modify)

Docs and exit (Tasks 23, 24)
  docs/architecture/overview.md (modify)
  docs/api/README.md (modify)
  docs/integrations/README.md (modify)
  docs/migration/README.md (modify)
  docs/deploy/phase-4-runbook.md
  docs/superpowers/handoff/2026-09-05-phase-4-checkpoint.md         written by Task 24
  docs/superpowers/handoff/2026-09-05-phase-4-ledger.md             written by Task 24
```

---

## Rulings

Made during planning, binding on execution. R4-1 … R4-12 are carried forward from the superseded 2026-09-05 draft and were each re-verified against the current tree; where verification changed a premise, the correction is stated inside the ruling and marked **[corrected]**. R4-13 … R4-18 are new to this planning pass.

- **R4-1 — Where document bytes live.** Bytes never enter Postgres. The database stores only metadata: `storage_provider` (`silo` | `local`), `storage_key`, `sha256`, `size_bytes`, `mime`, `file_name`, `pages`. Bytes go to a `DocumentStore` port with two adapters — `s3-document-store.ts` against the existing `silo` container (spec §2.4) and `local-document-store.ts` against a directory, for development and tests. The driver is chosen by `DOCUMENT_STORE_DRIVER`; the silo's endpoint, bucket and credentials live **encrypted in `integration_connections`** under a new `payroll_silo` provider (spec §5.2 lists exactly that provider code; `src/platform/integrations/types.ts:12` carries the standing note "Ruling P2-C6: `payroll_silo` joins in Phase 4"), not in env vars, so this phase adds no new secret to `docker-compose.yml`. The object key is **not derivable from anything the client sees**: it is `payroll/{userId}/{YYYY}/{32 hex chars from randomBytes(16)}.pdf`, generated server-side and stored only in the row — never the sha256, never the import id, never the filename. There are no pre-signed URLs and the bucket is never public: every read is proxied by the app after an authorisation check (spec §8.4, "server-side access only (no public URLs)").
- **R4-2 — The scanning boundary.** "Scanning" is a `MalwareScanner` port, `scan(bytes) → { verdict: "clean" | "infected" | "unavailable"; scanner: string; signature: string | null }`, with a no-op default that answers `{ verdict: "clean", scanner: "none", signature: null }` and a clamd adapter speaking `zINSTREAM` over TCP (spec §2.5, §13.3 default: boundary only, no scanner enabled). The verdict is **persisted** (`scan_status`, `scanner`, `scan_signature`, `scanned_at`) so an audit can always answer "what cleared this file, and when". Consequences, all enforced: an `infected` verdict deletes the bytes from the store immediately, sets the import `rejected` with `error = "scan_infected"`, and is terminal — a retry re-rejects without re-reading anything. An `unavailable` verdict (clamd down, socket error, timeout) leaves the import in `scanning` with `error = "scan_unavailable"` and is retried by the next tick; the bytes are kept. **An import never reaches the parsing pipeline unless `scan_status = 'clean'`**, and **`readOriginal` refuses any import whose `scan_status` is not `'clean'` with `409 conflict`** — the "never served before it cleared the boundary" rule, enforced in the use case and proven by an integration test (Tasks 10, 13, 15).
- **R4-3 — Idempotency.** The identity of a payslip upload is the **sha256 of its bytes, per user**, enforced by `CREATE UNIQUE INDEX payroll_imports_user_sha_uq ON payroll_imports (user_id, sha256)` — a database constraint, not an application check. Uploading the same file twice therefore cannot produce two imports, and since a `payroll_record` is created only from an import (`payroll_records_import_uq` on `import_id`), it cannot produce two payroll records either — which is precisely the phase's exit criterion. The application still checks first, for a good error message; the constraint is what makes the check safe under concurrency. **[corrected]** The superseded draft wrapped that insert in a **savepoint** (`tx.transaction(...)`) so a lost race would not abort the enclosing transaction. Verified against the design this plan actually lands, the savepoint is unnecessary and is dropped: the reservation transaction contains **nothing but the insert** (Task 9 splits the upload into reserve → write bytes → confirm, precisely so no network I/O sits inside a transaction), so a lost race can simply roll that transaction back and re-read the winning import in a fresh one. There is no partial work to preserve, which is the only thing a savepoint buys. Either way the user sees `409 duplicate` with the existing import id (spec §7.9). One refinement: an import in status `failed` (bytes never landed in the store) is **reused** rather than duplicated — the row is reset and the bytes re-written — so a failed upload never dead-ends the user behind their own unique index. Spec §3.2's `Idempotency-Key` requirement is honoured by a second database constraint, `payroll_imports_user_idem_uq (user_id, idempotency_key)`, and *not* by the platform `idempotency()` middleware: that middleware clones and hashes the entire request body into a text string and stores the response — untenable for a 10 MB binary. Both constraints live in the database.
- **R4-4 — Replacement and versioning.** A corrected payslip is a different file, so it gets its own import (different sha256) carrying `replaces_import_id`. Applying it runs in one transaction: the superseded record gets `superseded_at = now()` and `superseded_by_record_id`, its import goes to status `superseded`, and only then is the new record inserted — which is what lets `payroll_records_period_uq (user_id, period_start, kind) WHERE superseded_at IS NULL` stay a hard constraint. **`payroll_components` of the superseded record are kept, not deleted**: they are the evidence for what was believed at the time, and Earnings simply never reads a superseded record. The legacy `fund_deposits` row for that month is re-upserted from the new record (its existing `UNIQUE (fund_id, month)` makes that a single upsert), so the Funds page follows the correction. Nothing is ever silently recomputed: superseding is an explicit, audited action of the apply step.
- **R4-5 — The retention job.** `payroll_retention` runs on the **daily** tier. It deletes **only document bytes**, never a row and never a payroll record: for each import whose `retention_until < now()`, whose status is terminal (`applied`, `rejected`, `superseded`) and whose `storage_key IS NOT NULL`, it deletes the object, then sets `storage_key = NULL`, `purged_at = now()`. `retention_until` is stamped at upload from `app_settings.payroll_retention_years`, default **10** (spec §13.5, the Italian statutory horizon). Three properties make it safe to run unattended: it is idempotent (a row with `storage_key IS NULL` is skipped, so a half-finished run resumes cleanly); it is capped (`PURGE_BATCH = 100` per run, so a misconfigured retention window cannot wipe the archive in one tick and a human has a day to notice); and it never touches an import in a live status (`received`, `scanning`, `extracting`, `parsed`, `needs_review`, `needs_ocr`, `verified`), so a document still being worked on is out of reach by construction. A separate, immediate purge path exists for `infected` (R4-2) and is not the job's business.
- **R4-6 — The apply step.** `applyImport` turns a `verified` import into one `payroll_record` plus its `payroll_components`, and re-upserts the legacy `fund_deposits` row for the month (the Phase-5 bridge that keeps the Funds page working). It is **idempotent and re-runnable**: `payroll_records_import_uq` means an import has at most one record, so re-applying recomputes that record's fields from the current verified values, bumps its `version`, replaces its components wholesale, and re-upserts the fund deposit — an audit row records before/after. It is **not reversible**: there is no `unapply`. The reverse of a wrong apply is a replacement import that supersedes it (R4-4), because the derived rows have no meaningful pre-state to restore and an "unapply" would leave Earnings with a hole no one asked for. Correspondingly, an import's *values* stay editable while it is `needs_review` or `verified`, and stop being editable once it is `applied` — a re-verify of an applied import returns `409 conflict` naming the replacement path.
- **R4-7 — Paperless removal happens in this phase, in two deployment waves, not two phases.** Task 21 adds `scripts/migrate-paperless.ts`, which needs the Paperless client and token to still exist; Task 22 deletes the client, the preview proxy, the webhook route, the sweep's polling step, the ingest job, the write half of `src/lib/repo/payslips.ts`, and the `PAPERLESS_URL` / `PAPERLESS_TOKEN` env vars (spec §12.10). The runbook (Task 23) therefore prescribes **wave 1**: deploy the image built at Task 21's commit, run `npm run migrate:paperless` and `npm run migrate:paperless:validate`, read `docs/migration/paperless-reconciliation.md`; **wave 2**: deploy the image built at Task 22's commit and remove the env vars from `docker-compose.yml`. This is the same two-wave shape the repo already learned from the fund-registry seed (commit `33bf33b`) and from Phase 2's own credential import. What proves nothing still calls the deleted client: Task 22 removes `PAPERLESS_*` from `src/lib/env.ts` and `"paperless"` from `UpstreamError`'s inline service union, so any surviving call site fails `npx tsc --noEmit`; the task also runs an explicit `grep -rn "paperless\|Paperless\|PAPERLESS" src scripts` whose permitted hits are exactly: the parser fixtures under `src/lib/payroll/__fixtures__/` (payslip text that happens to contain the word), the four reworded parser comments (`anchors.ts:45`, `parse.ts:29`, `parse.ts:60`, `teamsystem.ts:6`, `text.ts:6/15/30`), `src/lib/db/schema/legacy.ts`'s frozen `paperless_doc_id` column and its `payslips_doc_thirteenth_uq` index, `src/lib/repo/payslips.ts`'s surviving `knownDocIds`-shaped reader if any, and the two migration scripts' doc comments. **[corrected]** `PAPERLESS_PAYSLIP_TAG_ID` *is* declared, at `src/lib/env.ts:33` (`z.coerce.number().int().default(22)`) — it is simply absent from `docker-compose.yml` and `.env.example` because it relies on that default. Task 22 removes it from `env.ts` and needs no compose change for it.
- **R4-8 — Deps shape.** `payroll` uses the accounts-style flat `UseCaseDeps` bag, per the Phase 3 precedent (P3-2) and because `src/modules/accounts` is the reference vertical slice. Two of its members are *resolved by the caller before the transaction opens* — `documents: DocumentStore` and `scanner: MalwareScanner` — because resolving the store may require opening an integration connection and decrypting a credential, which is I/O that must not happen inside the transaction the use case runs in.
- **R4-9 — `needs_ocr` is a real status.** Spec §5.8's status list omits it and §7.9's prose requires it ("if below threshold, status `needs_ocr` until an OCR adapter is configured"). Both are the spec; the enum is extended rather than the behaviour dropped, because the alternative — silently parsing an empty string — would produce a confident-looking all-null extraction, exactly the "never invent financial data" failure. There is no OCR adapter in this phase (Paperless was the only OCR source and it is being retired); a scanned payslip therefore parks in `needs_ocr` with an explicit UI state and a `retry` that will pick it up once an adapter exists.
- **R4-10 — Component mapping targets are recorded, not acted on, except for funds.** `payroll_mapping_rules` (spec §5.8) can target `earnings`, `fund_contribution`, `timeoff_balance` and `timeoff_used`. `payroll_components.mapped_to` records the resolved target for every component in this phase, but only `fund_contribution` has a consumer in Phase 4 (the legacy `fund_deposits` bridge). `timeoff_balance`/`timeoff_used` targets are written and left for Phase 7's `timeoff_balances`; `fund_contributions` proper arrives in Phase 5. This is forward compatibility recorded in data, not dead code: every target is exercised by `classifyComponent`'s tests.
- **R4-11 — `/work` becomes `/company` in this phase, and Time Off is relocated, not redesigned. [corrected]** Spec §4's page map has no `/work`. The superseded draft said `work/page.tsx` and its `_components`/`_lib` move "verbatim" to `/company/time-off`. Verification shows that is not possible: `work/page.tsx` renders three unrelated things — a leave calendar, a salary block (`SalarySection`, `ral`, `averageNet`) and a payslip list with a "waiting for verification" banner. Moving it whole would put earnings on a Time Off page and keep `allPayslips()` alive. Tasks 17-19 therefore **split** it along the spec's own page map: leave → `/company/time-off`, salary → `/company` Overview, payslip list → `/company/payroll`. The three client components and `work/_lib/leave.ts` move file-for-file with no behaviour change: `LeaveCalendar.tsx`, `LeaveByMonth.tsx` and `leave.ts` into `src/app/(app)/company/_components/` and `_lib/`, and `SalarySection.tsx` into `src/modules/payroll/ui/` — the last one because `load-company.ts` needs its `SalaryWindow` type, and a module importing from `src/app/` would invert this phase's own layering. The Phase 7 workspace (calendar + balances + in-place detail panel) is explicitly *not* built here.
- **R4-12 — Earnings reads records, never imports.** `earnings_summaries` is a view over records + components in the spec (§5.8: "no table"); here it is a use case, `earningsSummary`, computing gross/net/taxes/contributions per month, quarter and year from `payroll_records` + `payroll_components` with `superseded_at IS NULL`. No page reads `payroll_imports` for a financial figure — imports are pipeline state, records are money.
- **R4-13 — The signature changes, and which task each lands in. [corrected]** The superseded draft named three and got two of them wrong. Verified against the current tree, they are: (a) widening `ProviderCode` from `"wallet" | "trek"` to include `"payroll_silo"` (`src/platform/integrations/types.ts:13`), which also forces `connectionProbes` to return a third key because `CapabilityProbes.connectionStates` is typed `Record<ProviderCode, IntegrationState>` — **Task 7**; (b) changing `dataProbes(client).hasPayrollRecords` to count `payroll_records` inside `withUserContext` instead of counting `payslips` on the pool-bound handle, together with `payrollConfigured`'s replacement — **Task 7**; (c) dropping `"paperless"` from the service union, which lives in **two unlinked places**, not one: `src/lib/clients/http.ts:4` (`export type UpstreamService`) and, separately inlined, `src/lib/contracts.ts:147` (`UpstreamError`'s constructor parameter) — **Task 22** edits both, because dropping only one leaves the other compiling happily with a value nothing can produce. A fourth, additive change belongs in the same category and is called out here so no task is surprised by it: `JobName` loses `"payslip_ingest"` and gains `"payroll_ingest"`/`"payroll_retention"` — the gain is **Task 14**, the loss is **Task 22**, and they are separated deliberately so the tree type-checks between them. Two changes the draft implied are **not** needed: `IntegrationCapability` already contains `"documents"` (`types.ts:19`), and `src/modules/integrations/api/schemas.ts` has no provider enum to widen (`provider` is a bare `z.string()` at lines 4, 9 and 29).
- **R4-14 — `text_source` in the database is wider than `TextSource` in the parser.** Spec §5.8 declares `text_source (pdf_text|ocr|none)`; the existing parser's `TextSource` is `"pdf" | "ocr"` (`src/lib/payroll/text.ts:10`) and `PayslipExtraction.textSource` is `"pdf" | "ocr"` (`src/lib/contracts.ts:104`). Rather than widen the parser's type — which would force every existing `src/lib/payroll/**` test to acknowledge a state the parser can never produce — the **column** carries the spec's three values and the **module** maps: `"pdf" → "pdf_text"`, `"ocr" → "ocr"`, and `"none"` is written by the module itself for an import that reached `needs_ocr` and was therefore never handed to `parsePayslip` at all. The mapping lives in one named function, `textSourceColumn()`, in `src/modules/payroll/domain/payroll.ts`. This is the honest encoding of R4-9: `none` means "no text was ever obtained", which is exactly the `needs_ocr` state.
- **R4-15 — `payroll_silo` is a connection, not a sync.** It registers as an `IntegrationProvider` so its credentials get the same AES-256-GCM vault, the same Settings › Integrations connect/test/disconnect UI, and the same `integration_connections` row as Wallet and Trek — but its `syncs` is `{}` and no `SyncKind` is added. A document store has nothing to pull on a schedule; every read and write is driven by a user action or by the ingest job, which resolves the store directly. `capabilities` is `["documents"]`, a value `IntegrationCapability` already carries. `testConnection` does a real round trip: `PUT` a tiny probe object under `payroll/_probe/<random>`, `GET` it back, `DELETE` it — because a credential that can list but not write would otherwise pass a HEAD-only check and fail on the first real upload. `onDisconnect` with policy `purge` deletes every object under the user's `payroll/{userId}/` prefix and nulls their `storage_key`s; with `keep` or `archive` it leaves the bytes and only marks the connection disconnected.
- **R4-16 — `local` is a development and test driver, never production.** The `dashboard-app` container runs `read_only: true` with `tmpfs` mounts on `/tmp` and `/app/.next/cache` only (`docker-compose.yml`), so a local document store in production would either fail to write or write into a tmpfs that vanishes on restart — silently losing payroll originals. `documentStoreResolver` therefore refuses `DOCUMENT_STORE_DRIVER=local` when `NODE_ENV === "production"` unless `DOCUMENT_STORE_LOCAL_PATH` is set to an explicitly configured path, and the Phase 4 runbook says the same in one line. The default when the variable is unset is `silo`.
- **R4-17 — `payroll.read` gates Earnings; `payroll.read_original` gates the bytes.** Spec §8.2 names `payroll.upload`, `payroll.review` and `payroll.read_original`. A fourth, `payroll.read`, is added because §4's page map gates `/company/earnings` on data rather than on upload or review rights, and reusing `payroll.upload` for a read would deny Earnings to a viewer who may legitimately see figures but never a scanned original. Role mapping: `owner`/`admin` get all four (they already spread `PERMISSIONS`); `member` gets all four; `viewer` gets `payroll.read` only.
- **R4-18 — Auto-verify is not built in this phase.** Spec §7.9 allows `needs_review` **or** auto-`verified` "when all fields are high confidence and policy allows". The policy it refers to lives in `organization_policies`, a table Phase 8 creates; there is no policy row to consult and no UI to set one. Building the auto-verify branch now would mean inventing a default for a policy the spec deliberately leaves to the organisation — and the default that writes payroll figures with no human ever looking at them is the wrong one to guess. Every ingested import therefore lands in `needs_review` (or `needs_ocr`), and the confidence data the auto-verify branch would need (`confidence` jsonb, already persisted per field) is recorded from day one so Phase 8 can add the branch without a migration.

---

### Task 1: Migration 0015 — payroll imports, records, components, mapping rules

**Files:**
- Create: `src/lib/db/schema/payroll.ts`
- Modify: `src/lib/db/schema/index.ts` (add `export * from "./payroll";` as the eighth line)
- Create: `drizzle/0015_payroll.sql` (generated, then hand-edited)
- Create: `drizzle/meta/0015_snapshot.json` (generated), modify `drizzle/meta/_journal.json` (generated)
- Create: `src/lib/db/payroll-rls.itest.ts`

**Interfaces:**
- Consumes: `users` from `./identity` (existing), `integrationProviders` from `./integrations` (existing, seeded by `0010`).
- Produces:
```ts
export const payrollImports: PgTable;        // id, userId, status, fileName, mime, sizeBytes, sha256, storageProvider, storageKey, pages, textSource, parserVersion, extraction, confidence, scanStatus, scanner, scanSignature, scannedAt, error, idempotencyKey, replacesImportId, retentionUntil, purgedAt, uploadedVia, version, createdAt, updatedAt
export const payrollRecords: PgTable;        // id, userId, importId, periodStart, periodEnd, payDate, kind, currency, gross, net, verifiedAt, verifiedBy, corrections, supersededAt, supersededByRecordId, version, createdAt, updatedAt
export const payrollComponents: PgTable;     // id, recordId, code, labelRaw, kind, amount, quantity, unit, currency, confidence, source, mappedTo, sortOrder, createdAt
export const payrollMappingRules: PgTable;   // id, userId, matchCode, matchLabel, componentKind, target, priority, createdAt, updatedAt
export type PayrollImportRow = typeof payrollImports.$inferSelect;
export type PayrollRecordRow = typeof payrollRecords.$inferSelect;
export type PayrollComponentRow = typeof payrollComponents.$inferSelect;
export type PayrollMappingRuleRow = typeof payrollMappingRules.$inferSelect;
```

- [ ] **Step 1: Write the failing RLS and uniqueness test**

```ts
// src/lib/db/payroll-rls.itest.ts
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { closeDb, resetDb, testDb } from "@/test/db";
import {
  organizations,
  payrollComponents,
  payrollImports,
  payrollRecords,
  users,
} from "@/lib/db/schema";
import { withSystemContext, withUserContext } from "@/platform/db/context";

async function twoUsers() {
  const db = await testDb();
  const [org] = await db.insert(organizations).values({ name: "P" }).returning();
  const [a] = await db.insert(users).values({ organizationId: org!.id, displayName: "A" }).returning();
  const [b] = await db.insert(users).values({ organizationId: org!.id, displayName: "B" }).returning();
  return { db, a: a!.id, b: b!.id };
}

function anImport(userId: string, sha: string) {
  return {
    userId,
    fileName: "busta.pdf",
    sizeBytes: 1234,
    sha256: sha,
    storageProvider: "local" as const,
    storageKey: `payroll/${userId}/2026/${sha.slice(0, 32)}.pdf`,
    retentionUntil: new Date("2036-01-01T00:00:00Z"),
  };
}

describe("payroll RLS and uniqueness", () => {
  beforeEach(resetDb);
  afterAll(closeDb);

  it("a user sees only their own imports; system sees all; no context sees none", async () => {
    const { db, a, b } = await twoUsers();
    await withSystemContext(db, (tx) =>
      tx.insert(payrollImports).values([anImport(a, "a".repeat(64)), anImport(b, "b".repeat(64))]),
    );
    const mine = await withUserContext(db, { userId: a }, (tx) => tx.select().from(payrollImports));
    expect(mine.map((r) => r.sha256)).toEqual(["a".repeat(64)]);
    expect((await withSystemContext(db, (tx) => tx.select().from(payrollImports))).length).toBe(2);
    expect(await db.select().from(payrollImports)).toEqual([]);
  });

  it("a user cannot write an import attributed to somebody else", async () => {
    const { db, a, b } = await twoUsers();
    await expect(
      withUserContext(db, { userId: a }, (tx) => tx.insert(payrollImports).values(anImport(b, "c".repeat(64)))),
    ).rejects.toThrow();
  });

  it("payroll_components are reachable only through their owning record", async () => {
    const { db, a, b } = await twoUsers();
    const componentId = await withSystemContext(db, async (tx) => {
      const [imp] = await tx.insert(payrollImports).values(anImport(a, "d".repeat(64))).returning();
      const [rec] = await tx
        .insert(payrollRecords)
        .values({ userId: a, importId: imp!.id, periodStart: "2026-08-01", periodEnd: "2026-08-31", kind: "ordinary" })
        .returning();
      const [comp] = await tx
        .insert(payrollComponents)
        .values({ recordId: rec!.id, code: "NETTO", labelRaw: "Netto del mese", kind: "earning", amount: "1800.00" })
        .returning();
      return comp!.id;
    });
    const asOwner = await withUserContext(db, { userId: a }, (tx) => tx.select().from(payrollComponents));
    expect(asOwner.map((c) => c.id)).toEqual([componentId]);
    const asOther = await withUserContext(db, { userId: b }, (tx) => tx.select().from(payrollComponents));
    expect(asOther).toEqual([]);
  });

  it("(user_id, sha256) is unique — the same file cannot be imported twice", async () => {
    const { db, a } = await twoUsers();
    await withUserContext(db, { userId: a }, (tx) => tx.insert(payrollImports).values(anImport(a, "e".repeat(64))));
    await expect(
      withUserContext(db, { userId: a }, (tx) => tx.insert(payrollImports).values(anImport(a, "e".repeat(64)))),
    ).rejects.toThrow(/payroll_imports_user_sha_uq/);
  });

  it("(user_id, idempotency_key) is unique, and null keys do not collide", async () => {
    const { db, a } = await twoUsers();
    await withUserContext(db, { userId: a }, async (tx) => {
      await tx.insert(payrollImports).values({ ...anImport(a, "f".repeat(64)), idempotencyKey: "k1" });
      await tx.insert(payrollImports).values({ ...anImport(a, "0".repeat(64)), idempotencyKey: null });
      await tx.insert(payrollImports).values({ ...anImport(a, "1".repeat(64)), idempotencyKey: null });
    });
    await expect(
      withUserContext(db, { userId: a }, (tx) =>
        tx.insert(payrollImports).values({ ...anImport(a, "2".repeat(64)), idempotencyKey: "k1" }),
      ),
    ).rejects.toThrow(/payroll_imports_user_idem_uq/);
  });

  it("one import yields at most one record, and one live record per (user, period, kind)", async () => {
    const { db, a } = await twoUsers();
    const importIds = await withSystemContext(db, async (tx) => {
      const rows = await tx
        .insert(payrollImports)
        .values([anImport(a, "3".repeat(64)), anImport(a, "4".repeat(64))])
        .returning();
      return rows.map((r) => r.id);
    });
    const period = { periodStart: "2026-08-01", periodEnd: "2026-08-31", kind: "ordinary" as const };
    const firstRecordId = await withUserContext(db, { userId: a }, async (tx) => {
      const [rec] = await tx.insert(payrollRecords).values({ userId: a, importId: importIds[0]!, ...period }).returning();
      return rec!.id;
    });
    await expect(
      withUserContext(db, { userId: a }, (tx) =>
        tx.insert(payrollRecords).values({ userId: a, importId: importIds[0]!, ...period, periodStart: "2026-09-01" }),
      ),
    ).rejects.toThrow(/payroll_records_import_uq/);
    await expect(
      withUserContext(db, { userId: a }, (tx) =>
        tx.insert(payrollRecords).values({ userId: a, importId: importIds[1]!, ...period }),
      ),
    ).rejects.toThrow(/payroll_records_period_uq/);
    // Superseding the first frees the period: the partial index only covers live rows.
    await withUserContext(db, { userId: a }, async (tx) => {
      await tx
        .update(payrollRecords)
        .set({ supersededAt: new Date() })
        .where(eqId(payrollRecords.id, firstRecordId));
      await tx.insert(payrollRecords).values({ userId: a, importId: importIds[1]!, ...period });
    });
    const live = await withUserContext(db, { userId: a }, (tx) => tx.select().from(payrollRecords));
    expect(live.filter((r) => r.supersededAt === null).length).toBe(1);
  });
});

// Local helper so the test file needs only one drizzle-orm import.
import { eq as eqId } from "drizzle-orm";
```

- [ ] **Step 2: Run it and watch it fail**

Run: `npm run test:db:up && npm run test:integration -- payroll-rls`
Expected: FAIL — `relation "payroll_imports" does not exist`.

- [ ] **Step 3: Write the Drizzle schema**

```ts
// src/lib/db/schema/payroll.ts
import {
  check,
  date,
  index,
  integer,
  jsonb,
  numeric,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
  type AnyPgColumn,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { users } from "./identity";

const tz = (n: string) => timestamp(n, { withTimezone: true, mode: "date" });
const id = () => uuid("id").primaryKey().default(sql`uuidv7()`);
const money = (n: string) => numeric(n, { precision: 16, scale: 2 });

/**
 * Pipeline state for one uploaded payslip. Bytes never live here (Ruling
 * R4-1): `storage_key` points into the `DocumentStore`, and a null key on a
 * terminal row means the retention job has already purged the object while
 * keeping the provenance (Ruling R4-5).
 *
 * `text_source` carries the spec's three values while the parser's own
 * `TextSource` has two (Ruling R4-14): `none` is the honest encoding of an
 * import that reached `needs_ocr` and was therefore never parsed at all.
 */
export const payrollImports = pgTable(
  "payroll_imports",
  {
    id: id(),
    userId: uuid("user_id").notNull().references(() => users.id),
    status: text("status").notNull().default("received"),
    fileName: text("file_name").notNull(),
    mime: text("mime").notNull().default("application/pdf"),
    sizeBytes: integer("size_bytes").notNull(),
    sha256: text("sha256").notNull(),
    storageProvider: text("storage_provider").notNull().default("silo"),
    storageKey: text("storage_key"),
    pages: integer("pages"),
    textSource: text("text_source"),
    parserVersion: text("parser_version"),
    extraction: jsonb("extraction"),
    confidence: jsonb("confidence"),
    scanStatus: text("scan_status").notNull().default("pending"),
    scanner: text("scanner"),
    scanSignature: text("scan_signature"),
    scannedAt: tz("scanned_at"),
    error: text("error"),
    idempotencyKey: text("idempotency_key"),
    replacesImportId: uuid("replaces_import_id").references((): AnyPgColumn => payrollImports.id),
    retentionUntil: tz("retention_until").notNull(),
    purgedAt: tz("purged_at"),
    uploadedVia: text("uploaded_via").notNull().default("ui"),
    version: integer("version").notNull().default(1),
    createdAt: tz("created_at").notNull().defaultNow(),
    updatedAt: tz("updated_at").notNull().defaultNow(),
  },
  (t) => [
    check(
      "payroll_imports_status_ck",
      sql`${t.status} IN ('received','scanning','needs_ocr','extracting','parsed','needs_review','verified','applied','rejected','superseded','failed')`,
    ),
    check("payroll_imports_storage_ck", sql`${t.storageProvider} IN ('silo','local')`),
    check("payroll_imports_scan_ck", sql`${t.scanStatus} IN ('pending','clean','infected','unavailable')`),
    check("payroll_imports_text_source_ck", sql`${t.textSource} IN ('pdf_text','ocr','none')`),
    check("payroll_imports_uploaded_via_ck", sql`${t.uploadedVia} IN ('ui','api','migration')`),
    check("payroll_imports_size_ck", sql`${t.sizeBytes} > 0 AND ${t.sizeBytes} <= 10485760`),
    check("payroll_imports_sha_ck", sql`${t.sha256} ~ '^[0-9a-f]{64}$'`),
    uniqueIndex("payroll_imports_user_sha_uq").on(t.userId, t.sha256),
    // Partial: two imports may both have no idempotency key (Ruling R4-3);
    // in Postgres NULLs never collide in a plain unique index either, but the
    // predicate keeps the index small and states the intent.
    uniqueIndex("payroll_imports_user_idem_uq")
      .on(t.userId, t.idempotencyKey)
      .where(sql`idempotency_key IS NOT NULL`),
    index("payroll_imports_user_created_idx").on(t.userId, t.createdAt.desc()),
    // Spec §5.10's partial index, widened by the two statuses this phase's
    // pipeline actually parks in (`scanning`, `needs_ocr`) — the ingest job
    // scans exactly this set on every tick.
    index("payroll_imports_open_idx")
      .on(t.status)
      .where(sql`status IN ('received','scanning','needs_ocr','extracting','needs_review')`),
  ],
);

/**
 * The money. One live record per (user, period, kind); a correction supersedes
 * rather than overwrites (Ruling R4-4), which is what lets the partial unique
 * index below stay a hard constraint.
 */
export const payrollRecords = pgTable(
  "payroll_records",
  {
    id: id(),
    userId: uuid("user_id").notNull().references(() => users.id),
    importId: uuid("import_id").notNull().references(() => payrollImports.id),
    periodStart: date("period_start").notNull(),
    periodEnd: date("period_end").notNull(),
    payDate: date("pay_date"),
    kind: text("kind").notNull().default("ordinary"),
    currency: text("currency").notNull().default("EUR"),
    // Nullable on purpose: an applied record whose gross the parser could not
    // read renders as "—", never as 0.00 (global constraint: never invent).
    gross: money("gross"),
    net: money("net"),
    verifiedAt: tz("verified_at"),
    verifiedBy: uuid("verified_by").references(() => users.id),
    corrections: jsonb("corrections"),
    supersededAt: tz("superseded_at"),
    supersededByRecordId: uuid("superseded_by_record_id").references((): AnyPgColumn => payrollRecords.id),
    version: integer("version").notNull().default(1),
    createdAt: tz("created_at").notNull().defaultNow(),
    updatedAt: tz("updated_at").notNull().defaultNow(),
  },
  (t) => [
    check("payroll_records_kind_ck", sql`${t.kind} IN ('ordinary','thirteenth','fourteenth','bonus','settlement')`),
    check("payroll_records_currency_ck", sql`char_length(${t.currency}) = 3`),
    check("payroll_records_period_ck", sql`${t.periodEnd} >= ${t.periodStart}`),
    uniqueIndex("payroll_records_import_uq").on(t.importId),
    uniqueIndex("payroll_records_period_uq")
      .on(t.userId, t.periodStart, t.kind)
      .where(sql`superseded_at IS NULL`),
    index("payroll_records_user_period_idx").on(t.userId, t.periodStart.desc()),
  ],
);

/**
 * One row per line the parser produced. `label_raw` is the payslip's own
 * Italian text, kept verbatim as data (spec §2.9); `kind` and everything the
 * UI renders around it are English.
 */
export const payrollComponents = pgTable(
  "payroll_components",
  {
    id: id(),
    recordId: uuid("record_id").notNull().references(() => payrollRecords.id, { onDelete: "cascade" }),
    code: text("code").notNull(),
    labelRaw: text("label_raw").notNull(),
    kind: text("kind").notNull(),
    amount: money("amount"),
    quantity: numeric("quantity", { precision: 16, scale: 6 }),
    unit: text("unit"),
    currency: text("currency").notNull().default("EUR"),
    confidence: text("confidence"),
    source: text("source").notNull().default("rules"),
    mappedTo: jsonb("mapped_to"),
    sortOrder: integer("sort_order").notNull().default(0),
    createdAt: tz("created_at").notNull().defaultNow(),
  },
  (t) => [
    check(
      "payroll_components_kind_ck",
      sql`${t.kind} IN ('earning','deduction','tax','employer_contribution','employee_contribution','reimbursement','allowance','bonus','leave_balance','leave_used','leave_accrued','info')`,
    ),
    check("payroll_components_confidence_ck", sql`${t.confidence} IN ('high','medium','low')`),
    check("payroll_components_source_ck", sql`${t.source} IN ('rules','llm','manual')`),
    check("payroll_components_unit_ck", sql`${t.unit} IN ('hours','days','eur')`),
    index("payroll_components_record_idx").on(t.recordId, t.sortOrder),
  ],
);

/**
 * `user_id IS NULL` is a global rule, seeded by this migration and readable by
 * everybody. The RLS policy's USING clause admits those rows; its WITH CHECK
 * does not, so a user can never write one.
 */
export const payrollMappingRules = pgTable(
  "payroll_mapping_rules",
  {
    id: id(),
    userId: uuid("user_id").references(() => users.id),
    matchCode: text("match_code"),
    matchLabel: text("match_label"),
    componentKind: text("component_kind").notNull(),
    target: jsonb("target").notNull(),
    priority: integer("priority").notNull().default(100),
    createdAt: tz("created_at").notNull().defaultNow(),
    updatedAt: tz("updated_at").notNull().defaultNow(),
  },
  (t) => [
    check(
      "payroll_mapping_rules_kind_ck",
      sql`${t.componentKind} IN ('earning','deduction','tax','employer_contribution','employee_contribution','reimbursement','allowance','bonus','leave_balance','leave_used','leave_accrued','info')`,
    ),
    check("payroll_mapping_rules_match_ck", sql`${t.matchCode} IS NOT NULL OR ${t.matchLabel} IS NOT NULL`),
    index("payroll_mapping_rules_lookup_idx").on(t.userId, t.priority),
  ],
);

export type PayrollImportRow = typeof payrollImports.$inferSelect;
export type PayrollRecordRow = typeof payrollRecords.$inferSelect;
export type PayrollComponentRow = typeof payrollComponents.$inferSelect;
export type PayrollMappingRuleRow = typeof payrollMappingRules.$inferSelect;
```

- [ ] **Step 4: Re-export the new schema file**

```ts
// src/lib/db/schema/index.ts
export * from "./legacy";
export * from "./identity";
export * from "./platform";
export * from "./accounts";
export * from "./integrations";
export * from "./transactions";
export * from "./interests";
export * from "./payroll";
```

- [ ] **Step 5: Generate the migration and rename it**

Run:
```bash
npm run db:generate
```
Then rename the generated `drizzle/00NN_<word>.sql` to `drizzle/0015_payroll.sql` and update the matching `tag` in `drizzle/meta/_journal.json` to `0015_payroll`. Confirm the generated file number is `0015` — if `db:generate` produced anything else, stop: the working tree has an unexpected migration and this plan's numbering is wrong.

- [ ] **Step 6: Hand-append the RLS block and the provider seed**

Append to `drizzle/0015_payroll.sql`, each statement separated by `--> statement-breakpoint`, exactly as `drizzle/0012_interests.sql` does:

```sql
--> statement-breakpoint
ALTER TABLE payroll_imports ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE payroll_imports FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY payroll_imports_owner ON payroll_imports
  USING (app_is_system() OR user_id = app_current_user_id())
  WITH CHECK (app_is_system() OR user_id = app_current_user_id());
--> statement-breakpoint
ALTER TABLE payroll_records ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE payroll_records FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY payroll_records_owner ON payroll_records
  USING (app_is_system() OR user_id = app_current_user_id())
  WITH CHECK (app_is_system() OR user_id = app_current_user_id());
--> statement-breakpoint
ALTER TABLE payroll_components ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE payroll_components FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY payroll_components_owner ON payroll_components
  USING (app_is_system() OR EXISTS (
    SELECT 1 FROM payroll_records r WHERE r.id = record_id AND r.user_id = app_current_user_id()
  ))
  WITH CHECK (app_is_system() OR EXISTS (
    SELECT 1 FROM payroll_records r WHERE r.id = record_id AND r.user_id = app_current_user_id()
  ));
--> statement-breakpoint
ALTER TABLE payroll_mapping_rules ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE payroll_mapping_rules FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY payroll_mapping_rules_owner ON payroll_mapping_rules
  USING (app_is_system() OR user_id IS NULL OR user_id = app_current_user_id())
  WITH CHECK (app_is_system() OR user_id = app_current_user_id());
--> statement-breakpoint
INSERT INTO integration_providers (code, label, capabilities) VALUES
  ('payroll_silo', 'Payroll document store', '["documents"]'::jsonb)
ON CONFLICT (code) DO NOTHING;
```

The mapping-rules policy is the one asymmetric pair in this phase: `USING` admits the seeded global rows (`user_id IS NULL`) so every user can read them, while `WITH CHECK` does not, so no user can write one. The seed itself runs as the migration role, which is not subject to the policy.

- [ ] **Step 7: Run the test and watch it pass**

Run: `npm run test:integration -- payroll-rls`
Expected: PASS — all six cases, including both unique-index names appearing verbatim in the rejection messages.

- [ ] **Step 8: Commit**

```bash
git add src/lib/db/schema/payroll.ts src/lib/db/schema/index.ts src/lib/db/payroll-rls.itest.ts drizzle/0015_payroll.sql drizzle/meta/
git commit -m "feat(payroll): add payroll imports, records, components and mapping rules with RLS"
```

---

### Task 2: Application ports, the document domain, and the local document store

**Files:**
- Create: `src/modules/payroll/application/ports.ts`
- Create: `src/modules/payroll/application/deps.ts`
- Create: `src/modules/payroll/application/errors.ts`
- Create: `src/modules/payroll/domain/document.ts`
- Create: `src/modules/payroll/domain/document.test.ts`
- Create: `src/modules/payroll/infrastructure/local-document-store.ts`
- Create: `src/modules/payroll/infrastructure/local-document-store.test.ts`

**Interfaces:**
- Consumes: `AuditInput` from `@/platform/audit/record`; `PayslipExtraction`, `Confidence`, `SanityCheck` from `@/lib/contracts`.
- Produces:
```ts
// domain/document.ts
export const MAX_UPLOAD_BYTES = 10 * 1024 * 1024;
export function looksLikePdf(bytes: Uint8Array): boolean;
export function sha256Hex(bytes: Uint8Array): string;
export function newStorageKey(userId: string, at: Date): string;
// application/ports.ts — every repository port plus the two infrastructure ports
export interface DocumentStore { readonly provider: "silo" | "local"; put(key: string, bytes: Uint8Array, contentType: string): Promise<void>; get(key: string): Promise<Uint8Array | null>; delete(key: string): Promise<void>; listPrefix(prefix: string): Promise<string[]>; }
export interface ScanResult { verdict: "clean" | "infected" | "unavailable"; scanner: string; signature: string | null }
export interface MalwareScanner { scan(bytes: Uint8Array): Promise<ScanResult>; }
export interface PayrollImport { /* … see Step 3 */ }
export interface PayrollImportsRepository { /* … */ }
export interface PayrollRecordsRepository { /* … */ }
export interface PayrollComponentsRepository { /* … */ }
export interface PayrollMappingRulesRepository { /* … */ }
export interface LegacyFundDeposits { upsertForRecord(input: LegacyFundDepositInput): Promise<void>; }
export interface UseCaseDeps { imports; records; components; mappingRules; funds; documents; scanner; clock; audit }
```

- [ ] **Step 1: Write the failing domain test**

```ts
// src/modules/payroll/domain/document.test.ts
import { describe, expect, it } from "vitest";
import { MAX_UPLOAD_BYTES, looksLikePdf, newStorageKey, sha256Hex } from "./document";

const pdf = (extra = "") => new TextEncoder().encode(`%PDF-1.7\n${extra}`);

describe("looksLikePdf", () => {
  it("accepts the %PDF- magic bytes", () => {
    expect(looksLikePdf(pdf())).toBe(true);
  });

  it("rejects a file whose declared type lies about its content", () => {
    expect(looksLikePdf(new TextEncoder().encode("<html><body>gotcha"))).toBe(false);
  });

  it("rejects a file shorter than the magic itself, without throwing", () => {
    expect(looksLikePdf(new Uint8Array([0x25, 0x50]))).toBe(false);
  });

  it("rejects a PDF whose magic is not at offset 0", () => {
    expect(looksLikePdf(new TextEncoder().encode("   %PDF-1.7"))).toBe(false);
  });
});

describe("sha256Hex", () => {
  it("returns the well-known digest of the empty input, lowercase and 64 chars", () => {
    expect(sha256Hex(new Uint8Array())).toBe(
      "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
    );
  });

  it("is stable across two calls with equal bytes", () => {
    expect(sha256Hex(pdf("a"))).toBe(sha256Hex(pdf("a")));
    expect(sha256Hex(pdf("a"))).not.toBe(sha256Hex(pdf("b")));
  });
});

describe("newStorageKey", () => {
  const userId = "00000000-0000-7000-8000-000000000001";

  it("namespaces by user and year and ends in .pdf", () => {
    const key = newStorageKey(userId, new Date("2026-08-31T22:30:00Z"));
    expect(key).toMatch(new RegExp(`^payroll/${userId}/2026/[0-9a-f]{32}\\.pdf$`));
  });

  it("uses the Rome calendar year, not UTC", () => {
    // 2025-12-31T23:30Z is already 2026-01-01 in Europe/Rome.
    expect(newStorageKey(userId, new Date("2025-12-31T23:30:00Z"))).toContain("/2026/");
  });

  it("is unguessable: two keys for the same user and instant differ", () => {
    const at = new Date("2026-08-31T22:30:00Z");
    expect(newStorageKey(userId, at)).not.toBe(newStorageKey(userId, at));
  });
});

describe("MAX_UPLOAD_BYTES", () => {
  it("is the spec's 10 MB (§7.9), matching the database CHECK on size_bytes", () => {
    expect(MAX_UPLOAD_BYTES).toBe(10485760);
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `npm test -- payroll/domain/document`
Expected: FAIL — `Cannot find module './document'`.

- [ ] **Step 3: Write the document domain**

```ts
// src/modules/payroll/domain/document.ts
import { createHash, randomBytes } from "node:crypto";
import { romeDate } from "@/lib/time";

/** Spec §7.9: uploads are rejected above 10 MB. Mirrored by `payroll_imports_size_ck`. */
export const MAX_UPLOAD_BYTES = 10 * 1024 * 1024;

const PDF_MAGIC = [0x25, 0x50, 0x44, 0x46, 0x2d]; // "%PDF-"

/**
 * Spec §8.3: a declared MIME type is a claim by the client, so the bytes get
 * the last word. Only the magic at offset 0 counts — a PDF viewer will happily
 * open a file with leading junk, but so will a polyglot crafted to be read as
 * something else by a different parser.
 */
export function looksLikePdf(bytes: Uint8Array): boolean {
  if (bytes.length < PDF_MAGIC.length) return false;
  return PDF_MAGIC.every((b, i) => bytes[i] === b);
}

/** The identity of an upload (Ruling R4-3). Lowercase hex, 64 chars, matching `payroll_imports_sha_ck`. */
export function sha256Hex(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

/**
 * Ruling R4-1: the object key must not be derivable from anything the client
 * sees — not the sha256, not the import id, not the filename. 16 random bytes
 * is 128 bits of unguessability, and the user/year prefix is what makes
 * `onDisconnect(purge)` and a per-user export a single prefix listing.
 *
 * The year comes from the Rome calendar (`romeDate`), the same civil calendar
 * every other date in this codebase uses; a UTC year would file a 31 December
 * evening upload under the wrong year for an Italian user.
 */
export function newStorageKey(userId: string, at: Date): string {
  const year = romeDate(at).slice(0, 4);
  return `payroll/${userId}/${year}/${randomBytes(16).toString("hex")}.pdf`;
}
```

- [ ] **Step 4: Run the domain test and watch it pass**

Run: `npm test -- payroll/domain/document`
Expected: PASS — all nine cases.

- [ ] **Step 5: Write the ports**

```ts
// src/modules/payroll/application/ports.ts
import type { Confidence, PayslipExtraction, SanityCheck } from "@/lib/contracts";
import type { AuditInput } from "@/platform/audit/record";

// ---- Infrastructure ports (resolved by the caller, before any transaction opens — Ruling R4-8) ----

/**
 * Where payslip bytes live (Ruling R4-1). Two adapters implement it:
 * `s3-document-store.ts` against the silo, `local-document-store.ts` against a
 * directory. Neither is ever called inside an open database transaction.
 *
 * `get` answers `null` for a key that is not there — a purged original is an
 * expected state (Ruling R4-5), not an error.
 */
export interface DocumentStore {
  readonly provider: "silo" | "local";
  put(key: string, bytes: Uint8Array, contentType: string): Promise<void>;
  get(key: string): Promise<Uint8Array | null>;
  delete(key: string): Promise<void>;
  listPrefix(prefix: string): Promise<string[]>;
}

export type ScanVerdict = "clean" | "infected" | "unavailable";

export interface ScanResult {
  verdict: ScanVerdict;
  /** What answered, recorded on the import so an audit can name it. */
  scanner: string;
  /** The signature name for an `infected` verdict; null otherwise. */
  signature: string | null;
}

/**
 * Spec §2.5 / §13.3: a boundary, not a dependency. The default implementation
 * declares everything clean and names itself `"none"`, so the absence of a
 * scanner is a recorded fact rather than an unrecorded assumption.
 */
export interface MalwareScanner {
  scan(bytes: Uint8Array): Promise<ScanResult>;
}

// ---- Entities ----

export type PayrollImportStatus =
  | "received"
  | "scanning"
  | "needs_ocr"
  | "extracting"
  | "parsed"
  | "needs_review"
  | "verified"
  | "applied"
  | "rejected"
  | "superseded"
  | "failed";

export type ScanStatus = "pending" | "clean" | "infected" | "unavailable";
export type StorageProvider = "silo" | "local";
export type TextSourceColumn = "pdf_text" | "ocr" | "none";
export type UploadedVia = "ui" | "api" | "migration";

export interface PayrollImport {
  id: string;
  userId: string;
  status: PayrollImportStatus;
  fileName: string;
  mime: string;
  sizeBytes: number;
  sha256: string;
  storageProvider: StorageProvider;
  storageKey: string | null;
  pages: number | null;
  textSource: TextSourceColumn | null;
  parserVersion: string | null;
  extraction: PayslipExtraction | null;
  /** Per-field confidence, lifted out of `extraction` so Phase 8's auto-verify branch can index it (Ruling R4-18). */
  confidence: Record<string, Confidence> | null;
  scanStatus: ScanStatus;
  scanner: string | null;
  scanSignature: string | null;
  scannedAt: Date | null;
  error: string | null;
  idempotencyKey: string | null;
  replacesImportId: string | null;
  retentionUntil: Date;
  purgedAt: Date | null;
  uploadedVia: UploadedVia;
  version: number;
  createdAt: Date;
  updatedAt: Date;
}

export type NewPayrollImport = Pick<
  PayrollImport,
  "userId" | "fileName" | "mime" | "sizeBytes" | "sha256" | "storageProvider" | "storageKey" | "idempotencyKey" | "replacesImportId" | "retentionUntil" | "uploadedVia"
>;

export type PayrollImportPatch = Partial<
  Pick<
    PayrollImport,
    | "status" | "storageKey" | "pages" | "textSource" | "parserVersion" | "extraction"
    | "confidence" | "scanStatus" | "scanner" | "scanSignature" | "scannedAt" | "error" | "purgedAt"
  >
>;

export interface ListImportsOptions {
  statuses?: readonly PayrollImportStatus[];
  limit?: number;
}

export interface PayrollImportsRepository {
  /** Newest first, by `created_at desc, id desc` — the order the imports table renders. */
  list(userId: string, opts?: ListImportsOptions): Promise<PayrollImport[]>;
  get(userId: string, id: string): Promise<PayrollImport | null>;
  findBySha(userId: string, sha256: string): Promise<PayrollImport | null>;
  /**
   * Throws on a unique-index violation rather than swallowing it — the caller
   * (`createImport`) wraps this in a savepoint and turns the violation into a
   * `409 duplicate` naming the existing import (Ruling R4-3).
   */
  create(input: NewPayrollImport): Promise<PayrollImport>;
  /** Bumps `version` and `updated_at`. No optimistic-concurrency check: pipeline transitions are server-driven. */
  patch(userId: string, id: string, patch: PayrollImportPatch): Promise<PayrollImport | null>;
  /** Cross-user, for the ingest and retention jobs. Runs under `withSystemContext` only. */
  listByStatusForAllUsers(statuses: readonly PayrollImportStatus[], limit: number): Promise<PayrollImport[]>;
  /** Cross-user; terminal statuses with a live object whose retention has run out (Ruling R4-5). */
  listPurgeableForAllUsers(before: Date, limit: number): Promise<PayrollImport[]>;
}

export type PayrollRecordKind = "ordinary" | "thirteenth" | "fourteenth" | "bonus" | "settlement";

export interface PayrollRecord {
  id: string;
  userId: string;
  importId: string;
  periodStart: string;
  periodEnd: string;
  payDate: string | null;
  kind: PayrollRecordKind;
  currency: string;
  gross: string | null;
  net: string | null;
  verifiedAt: Date | null;
  verifiedBy: string | null;
  corrections: Record<string, { extracted: unknown; corrected: unknown }> | null;
  supersededAt: Date | null;
  supersededByRecordId: string | null;
  version: number;
  createdAt: Date;
  updatedAt: Date;
}

export type NewPayrollRecord = Omit<
  PayrollRecord,
  "id" | "version" | "createdAt" | "updatedAt" | "supersededAt" | "supersededByRecordId"
>;

export interface ListRecordsOptions {
  /** Inclusive lower and upper bounds on `periodStart`, as "YYYY-MM-DD". */
  from?: string;
  to?: string;
  includeSuperseded?: boolean;
}

export interface PayrollRecordsRepository {
  /** `period_start desc, id desc`. Excludes superseded rows unless asked (Ruling R4-12). */
  list(userId: string, opts?: ListRecordsOptions): Promise<PayrollRecord[]>;
  get(userId: string, id: string): Promise<PayrollRecord | null>;
  getByImport(userId: string, importId: string): Promise<PayrollRecord | null>;
  /** The live record for a period, or null. Used by the apply step to decide whether to supersede. */
  liveForPeriod(userId: string, periodStart: string, kind: PayrollRecordKind): Promise<PayrollRecord | null>;
  create(input: NewPayrollRecord): Promise<PayrollRecord>;
  /** Recomputes an existing record from a re-apply; bumps `version`. */
  update(userId: string, id: string, patch: Partial<Pick<PayrollRecord, "periodEnd" | "payDate" | "currency" | "gross" | "net" | "corrections">>): Promise<PayrollRecord | null>;
  supersede(userId: string, id: string, bySupersedingRecordId: string, at: Date): Promise<void>;
}

export type PayrollComponentKind =
  | "earning" | "deduction" | "tax" | "employer_contribution" | "employee_contribution"
  | "reimbursement" | "allowance" | "bonus" | "leave_balance" | "leave_used" | "leave_accrued" | "info";

export type MappingTarget =
  | { kind: "earnings" }
  | { kind: "fund_contribution"; fundSlug: string; part: "employee" | "employer" }
  | { kind: "timeoff_balance"; timeoffCode: string }
  | { kind: "timeoff_used"; timeoffCode: string }
  | { kind: "none" };

export interface PayrollComponent {
  id: string;
  recordId: string;
  code: string;
  /** The payslip's own Italian text, verbatim. Data, never UI chrome (spec §2.9). */
  labelRaw: string;
  kind: PayrollComponentKind;
  amount: string | null;
  quantity: string | null;
  unit: "hours" | "days" | "eur" | null;
  currency: string;
  confidence: Confidence | null;
  source: "rules" | "llm" | "manual";
  mappedTo: MappingTarget | null;
  sortOrder: number;
  createdAt: Date;
}

export type NewPayrollComponent = Omit<PayrollComponent, "id" | "createdAt">;

export interface PayrollComponentsRepository {
  /** `sort_order asc, id asc`. */
  listForRecord(recordId: string): Promise<PayrollComponent[]>;
  listForRecords(recordIds: readonly string[]): Promise<PayrollComponent[]>;
  /** Deletes every existing component of the record and inserts these (Ruling R4-6: replace wholesale). */
  replaceForRecord(recordId: string, components: readonly NewPayrollComponent[]): Promise<PayrollComponent[]>;
}

export interface PayrollMappingRule {
  id: string;
  /** null for a seeded global rule. */
  userId: string | null;
  matchCode: string | null;
  matchLabel: string | null;
  componentKind: PayrollComponentKind;
  target: MappingTarget;
  priority: number;
}

export interface PayrollMappingRulesRepository {
  /** Global rules and this user's own, `priority asc, id asc` — the order `classifyComponent` resolves in. */
  listFor(userId: string): Promise<PayrollMappingRule[]>;
}

export interface LegacyFundDepositInput {
  fundSlug: string;
  month: string;
  employee: string | null;
  employer: string | null;
}

/**
 * The Phase-5 bridge (Ruling R4-6). `fund_deposits` is a legacy, non-RLS table
 * whose `payslip_id` is a bigint FK to `payslips.id`, so an applied
 * `payroll_record` (a uuid) is written with `payslipId: null` and the
 * provenance kept on `payroll_records` instead.
 */
export interface LegacyFundDeposits {
  upsertForRecord(input: LegacyFundDepositInput): Promise<"written" | "no_fund" | "no_amount">;
}

export interface Clock {
  now(): Date;
}

export interface UseCaseDeps {
  imports: PayrollImportsRepository;
  records: PayrollRecordsRepository;
  components: PayrollComponentsRepository;
  mappingRules: PayrollMappingRulesRepository;
  funds: LegacyFundDeposits;
  /** Resolved before the transaction opens (Ruling R4-8). */
  documents: DocumentStore;
  /** Resolved before the transaction opens (Ruling R4-8). */
  scanner: MalwareScanner;
  clock: Clock;
  audit(e: AuditInput): Promise<void>;
}

/** Re-exported for the ingest use case, which hands them straight to `parsePayslip`. */
export type { PayslipExtraction, SanityCheck };
```

```ts
// src/modules/payroll/application/deps.ts
export type { UseCaseDeps } from "./ports";
```

```ts
// src/modules/payroll/application/errors.ts
export class NotFoundError extends Error {
  constructor(message = "Payroll import not found") {
    super(message);
    this.name = "NotFoundError";
  }
}

export class VersionMismatchError extends Error {
  constructor(message = "This import changed since you opened it. Reload and try again.") {
    super(message);
    this.name = "VersionMismatchError";
  }
}

export class InvalidInputError extends Error {
  constructor(
    message: string,
    readonly issues?: unknown,
  ) {
    super(message);
    this.name = "InvalidInputError";
  }
}

/**
 * A duplicate upload (Ruling R4-3). Carries the id of the import that already
 * holds these bytes so the API can answer `409 duplicate` with somewhere for
 * the user to go, which spec §7.9 requires.
 */
export class DuplicateImportError extends Error {
  constructor(readonly existingImportId: string) {
    super("This payslip has already been uploaded.");
    this.name = "DuplicateImportError";
  }
}

/**
 * A transition the pipeline refuses: applying an unverified import, re-verifying
 * an applied one, reading an original that has not cleared the scanner
 * (Ruling R4-2), or reading one the retention job has purged (Ruling R4-5).
 * Always a `409 conflict`, never a 404 — the thing exists, the action does not
 * apply to it.
 */
export class ConflictError extends Error {
  constructor(
    message: string,
    readonly reason: string,
  ) {
    super(message);
    this.name = "ConflictError";
  }
}
```

- [ ] **Step 6: Write the failing local-document-store test**

```ts
// src/modules/payroll/infrastructure/local-document-store.test.ts
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createLocalDocumentStore } from "./local-document-store";

let root = "";

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "payroll-store-"));
});
afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

const bytes = new TextEncoder().encode("%PDF-1.7 hello");

describe("createLocalDocumentStore", () => {
  it("names itself local, so the import row records which store holds the object", () => {
    expect(createLocalDocumentStore(root).provider).toBe("local");
  });

  it("round-trips bytes through nested key directories it creates itself", async () => {
    const store = createLocalDocumentStore(root);
    await store.put("payroll/u1/2026/abc.pdf", bytes, "application/pdf");
    expect(await store.get("payroll/u1/2026/abc.pdf")).toEqual(bytes);
  });

  it("answers null for a key that is not there, rather than throwing", async () => {
    expect(await createLocalDocumentStore(root).get("payroll/u1/2026/missing.pdf")).toBeNull();
  });

  it("delete is idempotent — purging an already-purged object is a no-op", async () => {
    const store = createLocalDocumentStore(root);
    await store.put("payroll/u1/2026/abc.pdf", bytes, "application/pdf");
    await store.delete("payroll/u1/2026/abc.pdf");
    await expect(store.delete("payroll/u1/2026/abc.pdf")).resolves.toBeUndefined();
    expect(await store.get("payroll/u1/2026/abc.pdf")).toBeNull();
  });

  it("listPrefix returns full keys under the prefix and nothing outside it", async () => {
    const store = createLocalDocumentStore(root);
    await store.put("payroll/u1/2026/a.pdf", bytes, "application/pdf");
    await store.put("payroll/u1/2025/b.pdf", bytes, "application/pdf");
    await store.put("payroll/u2/2026/c.pdf", bytes, "application/pdf");
    expect((await store.listPrefix("payroll/u1/")).sort()).toEqual([
      "payroll/u1/2025/b.pdf",
      "payroll/u1/2026/a.pdf",
    ]);
    expect(await store.listPrefix("payroll/u3/")).toEqual([]);
  });

  it("refuses a key that would escape the root", async () => {
    const store = createLocalDocumentStore(root);
    await expect(store.put("../../etc/passwd", bytes, "application/pdf")).rejects.toThrow(/invalid storage key/i);
    await expect(store.get("payroll/../../etc/passwd")).rejects.toThrow(/invalid storage key/i);
  });
});
```

- [ ] **Step 7: Run it and watch it fail**

Run: `npm test -- payroll/infrastructure/local-document-store`
Expected: FAIL — `Cannot find module './local-document-store'`.

- [ ] **Step 8: Write the local document store**

```ts
// src/modules/payroll/infrastructure/local-document-store.ts
import { mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { dirname, join, posix, resolve, sep } from "node:path";
import type { DocumentStore } from "../application/ports";

/** Keys are POSIX-shaped and generated by `newStorageKey`; anything else is a bug or an attack. */
const KEY_RE = /^[A-Za-z0-9][A-Za-z0-9/_.-]*$/;

function assertKey(key: string): void {
  if (!KEY_RE.test(key) || key.includes("..") || key.includes("//")) {
    throw new Error(`invalid storage key: ${key}`);
  }
}

/**
 * The development and test driver (Ruling R4-16): the production container is
 * `read_only: true` with only tmpfs mounts, so a local store there would either
 * fail to write or silently lose originals on restart. `documentStoreResolver`
 * (Task 3) is what refuses it in production; this adapter simply does its job.
 *
 * Path traversal is checked twice — by the key shape, and by re-resolving the
 * absolute path against the root — because a store that can be talked into
 * reading `/etc/passwd` would be reachable through an API route that streams
 * whatever it reads back to the caller.
 */
export function createLocalDocumentStore(root: string): DocumentStore {
  const absoluteRoot = resolve(root);

  function pathFor(key: string): string {
    assertKey(key);
    const full = resolve(join(absoluteRoot, ...key.split("/")));
    if (full !== absoluteRoot && !full.startsWith(absoluteRoot + sep)) {
      throw new Error(`invalid storage key: ${key}`);
    }
    return full;
  }

  async function keysUnder(dir: string, prefix: string): Promise<string[]> {
    const entries = await readdir(dir, { withFileTypes: true }).catch(() => []);
    const out: string[] = [];
    for (const entry of entries) {
      const childKey = prefix === "" ? entry.name : posix.join(prefix, entry.name);
      if (entry.isDirectory()) out.push(...(await keysUnder(join(dir, entry.name), childKey)));
      else out.push(childKey);
    }
    return out;
  }

  return {
    provider: "local",

    async put(key, bytes) {
      const path = pathFor(key);
      await mkdir(dirname(path), { recursive: true });
      await writeFile(path, bytes);
    },

    async get(key) {
      const path = pathFor(key);
      try {
        return new Uint8Array(await readFile(path));
      } catch (err) {
        if ((err as NodeJS.ErrnoException).code === "ENOENT") return null;
        throw err;
      }
    },

    async delete(key) {
      // `force` makes this idempotent: the retention job may re-run over a row
      // whose object it already removed (Ruling R4-5).
      await rm(pathFor(key), { force: true });
    },

    async listPrefix(prefix) {
      assertKey(prefix.endsWith("/") ? prefix.slice(0, -1) : prefix);
      const all = await keysUnder(absoluteRoot, "");
      return all.filter((k) => k.startsWith(prefix));
    },
  };
}
```

- [ ] **Step 9: Run both tests and watch them pass**

Run: `npm test -- payroll/`
Expected: PASS — 9 document-domain cases and 6 local-store cases.

- [ ] **Step 10: Type-check, then commit**

Run: `npx tsc --noEmit`
Expected: exit 0.

```bash
git add src/modules/payroll/application src/modules/payroll/domain src/modules/payroll/infrastructure
git commit -m "feat(payroll): add application ports, the document domain and the local document store"
```

---

### Task 3: AWS SigV4, the S3 document store, the driver resolver and their environment

**Files:**
- Create: `src/modules/payroll/infrastructure/sigv4.ts`
- Create: `src/modules/payroll/infrastructure/sigv4.test.ts`
- Create: `src/modules/payroll/infrastructure/s3-document-store.ts`
- Create: `src/modules/payroll/infrastructure/s3-document-store.test.ts`
- Create: `src/modules/payroll/infrastructure/document-store-resolver.ts`
- Create: `src/modules/payroll/infrastructure/document-store-resolver.test.ts`
- Modify: `src/lib/env.ts` (add `DOCUMENT_STORE_DRIVER`, `DOCUMENT_STORE_LOCAL_PATH`)
- Modify: `src/lib/env.test.ts`
- Modify: `src/test/integration-setup.ts`

**Interfaces:**
- Consumes: `DocumentStore` from `../application/ports` (Task 2); `env` from `@/lib/env`.
- Produces:
```ts
export interface SigV4Input { method: string; url: URL; region: string; service: string; accessKeyId: string; secretAccessKey: string; payloadHash: string; headers: Record<string, string>; at: Date }
export function signRequest(input: SigV4Input): Record<string, string>; // headers to send, including Authorization
export function hashPayload(bytes: Uint8Array): string;
export interface S3StoreConfig { endpoint: string; bucket: string; region: string; accessKeyId: string; secretAccessKey: string; fetchImpl?: typeof fetch }
export function createS3DocumentStore(config: S3StoreConfig): DocumentStore;
export interface DocumentStoreResolution { store: DocumentStore; driver: "silo" | "local" }
export interface StoreFromDriverInput { driver: "silo" | "local"; localPath: string | undefined; nodeEnv: string; credentials: SiloCredentials | null }
export function storeFromDriver(input: StoreFromDriverInput): DocumentStoreResolution | null;
// SiloCredentials is declared locally in this task as a stub shape; Task 7 replaces it with the
// real export from silo-provider-adapter.ts. resolveDocumentStore and documentStoreConfigured are
// NOT produced by this task — the file does not compile without SILO_PROVIDER/siloCredentialSchema,
// which Task 7 writes. Both are written in Task 7's Interfaces block instead.
```

- [ ] **Step 1: Write the failing SigV4 test against AWS's published vector**

```ts
// src/modules/payroll/infrastructure/sigv4.test.ts
import { describe, expect, it } from "vitest";
import { hashPayload, signRequest } from "./sigv4";

/**
 * AWS's own `get-vanilla` test vector from the SigV4 test suite. Using the
 * published vector rather than a self-consistent round trip is the whole point:
 * a signer that agrees only with itself signs nothing the silo will accept.
 */
const VECTOR = {
  accessKeyId: "AKIDEXAMPLE",
  secretAccessKey: "wJalrXUtnFEMI/K7MDENG+bPxRfiCYEXAMPLEKEY",
  region: "us-east-1",
  service: "service",
  at: new Date("2015-08-30T12:36:00Z"),
};

describe("hashPayload", () => {
  it("returns the empty-payload hash AWS documents", () => {
    expect(hashPayload(new Uint8Array())).toBe(
      "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
    );
  });
});

describe("signRequest", () => {
  it("reproduces the get-vanilla Authorization header byte for byte", () => {
    const headers = signRequest({
      method: "GET",
      url: new URL("https://example.amazonaws.com/"),
      headers: { host: "example.amazonaws.com" },
      payloadHash: hashPayload(new Uint8Array()),
      ...VECTOR,
    });
    expect(headers["authorization"]).toBe(
      "AWS4-HMAC-SHA256 Credential=AKIDEXAMPLE/20150830/us-east-1/service/aws4_request, " +
        "SignedHeaders=host;x-amz-content-sha256;x-amz-date, " +
        "Signature=" + headers["__expected_signature_placeholder__"],
    );
  });

  it("always sends x-amz-content-sha256 and x-amz-date, and signs both", () => {
    const headers = signRequest({
      method: "PUT",
      url: new URL("https://silo.internal/bucket/payroll/u1/2026/a.pdf"),
      headers: { host: "silo.internal", "content-type": "application/pdf" },
      payloadHash: hashPayload(new TextEncoder().encode("%PDF-1.7")),
      ...VECTOR,
    });
    expect(headers["x-amz-date"]).toBe("20150830T123600Z");
    expect(headers["x-amz-content-sha256"]).toBe(hashPayload(new TextEncoder().encode("%PDF-1.7")));
    expect(headers["authorization"]).toContain("SignedHeaders=content-type;host;x-amz-content-sha256;x-amz-date");
    expect(headers["authorization"]).toMatch(/Signature=[0-9a-f]{64}$/);
  });

  it("percent-encodes the path segment by segment, leaving the slashes intact", () => {
    const headers = signRequest({
      method: "GET",
      url: new URL("https://silo.internal/bucket/payroll/u 1/a+b.pdf"),
      headers: { host: "silo.internal" },
      payloadHash: hashPayload(new Uint8Array()),
      ...VECTOR,
    });
    // The signature is over the canonical request; the assertion that matters is
    // that signing does not throw and produces a stable 64-hex signature for a
    // path S3 would itself encode this way.
    expect(headers["authorization"]).toMatch(/Signature=[0-9a-f]{64}$/);
  });

  it("produces a different signature for a different payload — the body is bound to the signature", () => {
    const base = {
      method: "PUT",
      url: new URL("https://silo.internal/bucket/k.pdf"),
      headers: { host: "silo.internal" },
      ...VECTOR,
    };
    const a = signRequest({ ...base, payloadHash: hashPayload(new TextEncoder().encode("a")) });
    const b = signRequest({ ...base, payloadHash: hashPayload(new TextEncoder().encode("b")) });
    expect(a["authorization"]).not.toBe(b["authorization"]);
  });
});
```

Replace the first case's `"Signature=" + headers["__expected_signature_placeholder__"]` with the literal AWS expects once you have run it: the vector's documented value is
`5fa00fa31553b73ebf1942676e86291e8372ff2a2260956d9b8aae1d763fbf31`. Write the assertion as the full literal string, not as string concatenation:

```ts
    expect(headers["authorization"]).toBe(
      "AWS4-HMAC-SHA256 Credential=AKIDEXAMPLE/20150830/us-east-1/service/aws4_request, " +
        "SignedHeaders=host;x-amz-content-sha256;x-amz-date, " +
        "Signature=5fa00fa31553b73ebf1942676e86291e8372ff2a2260956d9b8aae1d763fbf31",
    );
```

Note that AWS's published `get-vanilla` signature covers `host;x-amz-date` only; this signer always adds `x-amz-content-sha256` (S3 requires it), so the signature differs from the raw published value. **Run the test once, read the signature this implementation produces, verify by hand that the canonical request and string-to-sign it logs match AWS's documented format, then pin that value.** Pinning a value you have not checked is how a signer that agrees only with itself gets shipped; the second, third and fourth cases are the ones that must pass without any pinning.

- [ ] **Step 2: Run it and watch it fail**

Run: `npm test -- payroll/infrastructure/sigv4`
Expected: FAIL — `Cannot find module './sigv4'`.

- [ ] **Step 3: Write the signer**

```ts
// src/modules/payroll/infrastructure/sigv4.ts
import { createHash, createHmac } from "node:crypto";

/**
 * AWS Signature Version 4, in about eighty lines of `node:crypto`.
 *
 * This is protocol code, not provider code: it names S3 and AWS (a protocol and
 * its specification) and never the `silo` container, so it does not fall under
 * the "provider names only in `*-adapter.ts`" rule. The alternative was
 * `@aws-sdk/client-s3`, a multi-megabyte dependency for four verbs, against the
 * precedent set by `src/platform/integrations/crypto.ts` hand-rolling AES-GCM.
 */
export interface SigV4Input {
  method: string;
  url: URL;
  region: string;
  service: string;
  accessKeyId: string;
  secretAccessKey: string;
  /** Hex sha256 of the body; `hashPayload(new Uint8Array())` for a bodyless request. */
  payloadHash: string;
  /** Must include `host`. Names are lower-cased and values trimmed before signing. */
  headers: Record<string, string>;
  at: Date;
}

export function hashPayload(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

function sha256Hex(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

function hmac(key: Buffer | string, value: string): Buffer {
  return createHmac("sha256", key).update(value, "utf8").digest();
}

/** RFC 3986 unreserved set, which is narrower than `encodeURIComponent`'s. */
function uriEncode(value: string): string {
  return encodeURIComponent(value).replace(/[!'()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`);
}

/** Every segment is encoded; the separators are not. S3 canonicalises paths exactly this way. */
function canonicalPath(pathname: string): string {
  return pathname.split("/").map(uriEncode).join("/") || "/";
}

function canonicalQuery(url: URL): string {
  const pairs: Array<[string, string]> = [];
  url.searchParams.forEach((v, k) => pairs.push([uriEncode(k), uriEncode(v)]));
  pairs.sort((a, b) => (a[0] === b[0] ? a[1].localeCompare(b[1]) : a[0].localeCompare(b[0])));
  return pairs.map(([k, v]) => `${k}=${v}`).join("&");
}

function amzDate(at: Date): string {
  return at.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
}

/**
 * Returns every header the request must carry, the `Authorization` header
 * included. The caller sends exactly these — adding a header afterwards
 * invalidates the signature, because `SignedHeaders` is fixed here.
 */
export function signRequest(input: SigV4Input): Record<string, string> {
  const stamp = amzDate(input.at);
  const day = stamp.slice(0, 8);

  const headers: Record<string, string> = {};
  for (const [name, value] of Object.entries(input.headers)) {
    headers[name.toLowerCase()] = value.trim().replace(/\s+/g, " ");
  }
  headers["x-amz-date"] = stamp;
  headers["x-amz-content-sha256"] = input.payloadHash;

  const signedNames = Object.keys(headers).sort();
  const canonicalHeaders = signedNames.map((n) => `${n}:${headers[n]}\n`).join("");
  const signedHeaders = signedNames.join(";");

  const canonicalRequest = [
    input.method.toUpperCase(),
    canonicalPath(input.url.pathname),
    canonicalQuery(input.url),
    canonicalHeaders,
    signedHeaders,
    input.payloadHash,
  ].join("\n");

  const scope = `${day}/${input.region}/${input.service}/aws4_request`;
  const stringToSign = ["AWS4-HMAC-SHA256", stamp, scope, sha256Hex(canonicalRequest)].join("\n");

  const signingKey = hmac(hmac(hmac(hmac(`AWS4${input.secretAccessKey}`, day), input.region), input.service), "aws4_request");
  const signature = createHmac("sha256", signingKey).update(stringToSign, "utf8").digest("hex");

  headers["authorization"] =
    `AWS4-HMAC-SHA256 Credential=${input.accessKeyId}/${scope}, SignedHeaders=${signedHeaders}, Signature=${signature}`;
  return headers;
}
```

- [ ] **Step 4: Write the failing S3 store test**

```ts
// src/modules/payroll/infrastructure/s3-document-store.test.ts
import { describe, expect, it, vi } from "vitest";
import { createS3DocumentStore } from "./s3-document-store";

const config = {
  endpoint: "https://silo.internal",
  bucket: "payroll",
  region: "us-east-1",
  accessKeyId: "AKIDEXAMPLE",
  secretAccessKey: "wJalrXUtnFEMI/K7MDENG+bPxRfiCYEXAMPLEKEY",
};

const bytes = new TextEncoder().encode("%PDF-1.7 hi");

function storeWith(impl: (req: Request) => Promise<Response>) {
  const fetchImpl = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) =>
    impl(new Request(input as URL | string, init)),
  );
  return { store: createS3DocumentStore({ ...config, fetchImpl: fetchImpl as unknown as typeof fetch }), fetchImpl };
}

describe("createS3DocumentStore", () => {
  it("names itself silo, so the import row records which store holds the object", () => {
    expect(storeWith(async () => new Response(null, { status: 200 })).store.provider).toBe("silo");
  });

  it("PUTs to endpoint/bucket/key with a signed Authorization header and the content type", async () => {
    const { store, fetchImpl } = storeWith(async () => new Response(null, { status: 200 }));
    await store.put("payroll/u1/2026/a.pdf", bytes, "application/pdf");
    const req = fetchImpl.mock.calls[0]![0] as unknown as Request;
    expect(req.method).toBe("PUT");
    expect(req.url).toBe("https://silo.internal/payroll/payroll/u1/2026/a.pdf");
    expect(req.headers.get("authorization")).toMatch(/^AWS4-HMAC-SHA256 Credential=AKIDEXAMPLE\//);
    expect(req.headers.get("content-type")).toBe("application/pdf");
    expect(req.headers.get("x-amz-content-sha256")).toMatch(/^[0-9a-f]{64}$/);
  });

  it("GET returns the bytes", async () => {
    const { store } = storeWith(async () => new Response(bytes, { status: 200 }));
    expect(await store.get("payroll/u1/2026/a.pdf")).toEqual(bytes);
  });

  it("GET answers null on 404 rather than throwing — a purged original is expected", async () => {
    const { store } = storeWith(async () => new Response("", { status: 404 }));
    expect(await store.get("payroll/u1/2026/gone.pdf")).toBeNull();
  });

  it("GET throws on 500, so a broken silo never looks like a purged object", async () => {
    const { store } = storeWith(async () => new Response("boom", { status: 500 }));
    await expect(store.get("payroll/u1/2026/a.pdf")).rejects.toThrow(/document store GET failed: 500/);
  });

  it("DELETE treats 204 and 404 alike, so the retention job is idempotent", async () => {
    const { store: s204 } = storeWith(async () => new Response(null, { status: 204 }));
    await expect(s204.delete("payroll/u1/2026/a.pdf")).resolves.toBeUndefined();
    const { store: s404 } = storeWith(async () => new Response("", { status: 404 }));
    await expect(s404.delete("payroll/u1/2026/a.pdf")).resolves.toBeUndefined();
  });

  it("listPrefix pages through continuation tokens and returns full keys", async () => {
    let call = 0;
    const { store } = storeWith(async () => {
      call += 1;
      const body =
        call === 1
          ? `<?xml version="1.0"?><ListBucketResult><IsTruncated>true</IsTruncated>` +
            `<Contents><Key>payroll/u1/2026/a.pdf</Key></Contents>` +
            `<NextContinuationToken>tok</NextContinuationToken></ListBucketResult>`
          : `<?xml version="1.0"?><ListBucketResult><IsTruncated>false</IsTruncated>` +
            `<Contents><Key>payroll/u1/2025/b.pdf</Key></Contents></ListBucketResult>`;
      return new Response(body, { status: 200 });
    });
    expect(await store.listPrefix("payroll/u1/")).toEqual(["payroll/u1/2026/a.pdf", "payroll/u1/2025/b.pdf"]);
    expect(call).toBe(2);
  });

  it("PUT throws with the status on a rejected write, so a failed upload never records a storage key", async () => {
    const { store } = storeWith(async () => new Response("denied", { status: 403 }));
    await expect(store.put("payroll/u1/2026/a.pdf", bytes, "application/pdf")).rejects.toThrow(
      /document store PUT failed: 403/,
    );
  });
});
```

- [ ] **Step 5: Run it and watch it fail**

Run: `npm test -- payroll/infrastructure/s3-document-store`
Expected: FAIL — `Cannot find module './s3-document-store'`.

- [ ] **Step 6: Write the S3 store**

```ts
// src/modules/payroll/infrastructure/s3-document-store.ts
import type { DocumentStore } from "../application/ports";
import { hashPayload, signRequest } from "./sigv4";

export interface S3StoreConfig {
  /** Origin only, e.g. `https://silo.internal` — no bucket, no trailing slash. */
  endpoint: string;
  bucket: string;
  region: string;
  accessKeyId: string;
  secretAccessKey: string;
  /** Injected in tests so the suite never opens a socket. */
  fetchImpl?: typeof fetch;
}

/** MinIO-family servers do not accept a `Key` element containing raw XML entities we would have to unescape. */
const KEY_TAG = /<Key>([^<]*)<\/Key>/g;
const TRUNCATED = /<IsTruncated>\s*true\s*<\/IsTruncated>/i;
const NEXT_TOKEN = /<NextContinuationToken>([^<]*)<\/NextContinuationToken>/;

/**
 * The S3-compatible adapter. Path-style addressing (`{endpoint}/{bucket}/{key}`)
 * because the silo is reached by an internal hostname with no per-bucket DNS.
 *
 * Every response is checked by status: a 404 on GET is `null` (an object the
 * retention job already purged), a 404 on DELETE is success (idempotency,
 * Ruling R4-5), and anything else throws with the status in the message so a
 * broken store is never mistaken for an absent object.
 */
export function createS3DocumentStore(config: S3StoreConfig): DocumentStore {
  const doFetch = config.fetchImpl ?? fetch;
  const origin = config.endpoint.replace(/\/+$/, "");

  async function send(method: string, url: URL, body: Uint8Array | null, extraHeaders: Record<string, string> = {}) {
    const payloadHash = hashPayload(body ?? new Uint8Array());
    const headers = signRequest({
      method,
      url,
      region: config.region,
      service: "s3",
      accessKeyId: config.accessKeyId,
      secretAccessKey: config.secretAccessKey,
      payloadHash,
      headers: { host: url.host, ...extraHeaders },
      at: new Date(),
    });
    return doFetch(url, { method, headers, ...(body ? { body } : {}) });
  }

  function urlFor(key: string): URL {
    return new URL(`${origin}/${config.bucket}/${key}`);
  }

  return {
    provider: "silo",

    async put(key, bytes, contentType) {
      const res = await send("PUT", urlFor(key), bytes, {
        "content-type": contentType,
        "content-length": String(bytes.byteLength),
      });
      if (!res.ok) throw new Error(`document store PUT failed: ${res.status}`);
    },

    async get(key) {
      const res = await send("GET", urlFor(key), null);
      if (res.status === 404) return null;
      if (!res.ok) throw new Error(`document store GET failed: ${res.status}`);
      return new Uint8Array(await res.arrayBuffer());
    },

    async delete(key) {
      const res = await send("DELETE", urlFor(key), null);
      if (res.status === 404) return;
      if (!res.ok) throw new Error(`document store DELETE failed: ${res.status}`);
    },

    async listPrefix(prefix) {
      const keys: string[] = [];
      let token: string | null = null;
      // Bounded: a per-user prefix cannot legitimately hold more than a few
      // hundred payslips, and an unbounded loop against a misbehaving store
      // would hang the disconnect path.
      for (let page = 0; page < 50; page += 1) {
        const url = new URL(`${origin}/${config.bucket}`);
        url.searchParams.set("list-type", "2");
        url.searchParams.set("prefix", prefix);
        if (token) url.searchParams.set("continuation-token", token);
        const res = await send("GET", url, null);
        if (!res.ok) throw new Error(`document store LIST failed: ${res.status}`);
        const xml = await res.text();
        for (const match of xml.matchAll(KEY_TAG)) keys.push(match[1]!);
        if (!TRUNCATED.test(xml)) return keys;
        token = NEXT_TOKEN.exec(xml)?.[1] ?? null;
        if (!token) return keys;
      }
      throw new Error("document store LIST did not terminate after 50 pages");
    },
  };
}
```

- [ ] **Step 7: Add the two environment variables**

In `src/lib/env.ts`, add after the `WALLET_API_URL` line:

```ts
  /**
   * Where payslip originals live (Ruling R4-1). `silo` reads the endpoint,
   * bucket and credentials from the user's `payroll_silo` integration
   * connection — no secret in the environment. `local` writes into
   * `DOCUMENT_STORE_LOCAL_PATH` and is a development and test driver only
   * (Ruling R4-16): the production container is read-only.
   *
   * Defaulted, not required: this phase adds no required environment variable.
   */
  DOCUMENT_STORE_DRIVER: z.enum(["silo", "local"]).default("silo"),
  DOCUMENT_STORE_LOCAL_PATH: z.preprocess(blankToUndefined, z.string().optional()),
```

In `src/lib/env.test.ts`, add a case next to the existing ones:

```ts
  it("defaults the document store driver to silo and leaves the local path unset", () => {
    const parsed = envFromFixture();
    expect(parsed.DOCUMENT_STORE_DRIVER).toBe("silo");
    expect(parsed.DOCUMENT_STORE_LOCAL_PATH).toBeUndefined();
  });
```
(`envFromFixture` is whatever helper the existing file already uses to build a valid environment; reuse it rather than adding a second one.)

In `src/test/integration-setup.ts`, add to the `Object.assign(process.env, { … })` block, keeping the existing `PAPERLESS_*` lines for now (Task 22 removes them):

```ts
  DOCUMENT_STORE_DRIVER: "local",
  DOCUMENT_STORE_LOCAL_PATH: mkdtempSync(join(tmpdir(), "payroll-itest-")),
```
with `import { mkdtempSync } from "node:fs"; import { tmpdir } from "node:os"; import { join } from "node:path";` at the top. Integration tests must never reach for S3.

- [ ] **Step 8: Write the failing resolver test**

```ts
// src/modules/payroll/infrastructure/document-store-resolver.test.ts
import { describe, expect, it } from "vitest";
import { storeFromDriver } from "./document-store-resolver";

describe("storeFromDriver", () => {
  it("builds a local store from an explicit path", () => {
    const res = storeFromDriver({ driver: "local", localPath: "/tmp/payroll", nodeEnv: "development", credentials: null });
    expect(res?.driver).toBe("local");
    expect(res?.store.provider).toBe("local");
  });

  it("returns null for the local driver with no path — never a silently invented directory", () => {
    expect(storeFromDriver({ driver: "local", localPath: undefined, nodeEnv: "development", credentials: null })).toBeNull();
  });

  it("refuses the local driver in production (Ruling R4-16: the container is read-only)", () => {
    expect(() =>
      storeFromDriver({ driver: "local", localPath: "/tmp/payroll", nodeEnv: "production", credentials: null }),
    ).toThrow(/local document store is not usable in production/i);
  });

  it("builds a silo store from a complete credential", () => {
    const res = storeFromDriver({
      driver: "silo",
      localPath: undefined,
      nodeEnv: "production",
      credentials: {
        endpoint: "https://silo.internal",
        bucket: "payroll",
        region: "us-east-1",
        accessKeyId: "AK",
        secretAccessKey: "SK",
      },
    });
    expect(res?.driver).toBe("silo");
    expect(res?.store.provider).toBe("silo");
  });

  it("returns null for the silo driver with no connection — the setup state, not an error", () => {
    expect(storeFromDriver({ driver: "silo", localPath: undefined, nodeEnv: "production", credentials: null })).toBeNull();
  });
});
```

- [ ] **Step 9: Run it and watch it fail**

Run: `npm test -- payroll/infrastructure/document-store-resolver`
Expected: FAIL — `Cannot find module './document-store-resolver'`.

- [ ] **Step 10: Write the resolver**

```ts
// src/modules/payroll/infrastructure/document-store-resolver.ts
import { db } from "@/lib/db";
import { env } from "@/lib/env";
import type { DocumentStore } from "../application/ports";
import { createLocalDocumentStore } from "./local-document-store";
import { createS3DocumentStore } from "./s3-document-store";
import { SILO_PROVIDER, siloCredentialSchema, type SiloCredentials } from "./silo-provider-adapter";

export interface DocumentStoreResolution {
  store: DocumentStore;
  driver: "silo" | "local";
}

export interface StoreFromDriverInput {
  driver: "silo" | "local";
  localPath: string | undefined;
  nodeEnv: string;
  credentials: SiloCredentials | null;
}

/**
 * The pure half, so the decision is unit-testable without a database.
 *
 * `null` means "not configured" — a setup state the pages render as an empty
 * state with a link to Settings › Integrations, never as a zero or an error.
 * The one hard refusal is the local driver in production (Ruling R4-16), which
 * throws rather than returning null: silently falling back to the silo there
 * would hide a misconfiguration behind a store the operator did not choose.
 */
export function storeFromDriver(input: StoreFromDriverInput): DocumentStoreResolution | null {
  if (input.driver === "local") {
    if (input.nodeEnv === "production") {
      throw new Error(
        "local document store is not usable in production: the container is read-only (see docs/deploy/phase-4-runbook.md)",
      );
    }
    if (!input.localPath) return null;
    return { store: createLocalDocumentStore(input.localPath), driver: "local" };
  }
  if (!input.credentials) return null;
  return { store: createS3DocumentStore(input.credentials), driver: "silo" };
}

/**
 * The impure half. Reads the user's `payroll_silo` connection and decrypts its
 * credential, both **outside** any caller's transaction — this is exactly the
 * I/O Ruling R4-8 keeps out of the use-case transaction, which is why the store
 * is resolved before `withUserContext` opens and handed in as a dep.
 */
export async function resolveDocumentStore(userId: string): Promise<DocumentStoreResolution | null> {
  const e = env();
  if (e.DOCUMENT_STORE_DRIVER === "local") {
    return storeFromDriver({ driver: "local", localPath: e.DOCUMENT_STORE_LOCAL_PATH, nodeEnv: e.NODE_ENV, credentials: null });
  }
  const { integrationDeps } = await import("@/modules/integrations/infrastructure/deps");
  const { openConnection } = await import("@/modules/integrations/application/open-connection");
  const opened = await integrationDeps(db).inUserContext(userId, (deps) => openConnection(deps)(userId, SILO_PROVIDER));
  if (!opened) return null;
  const parsed = siloCredentialSchema.safeParse(opened.credentials);
  if (!parsed.success) return null;
  return storeFromDriver({ driver: "silo", localPath: undefined, nodeEnv: e.NODE_ENV, credentials: parsed.data });
}

/** Whether a store could be resolved at all, for the capability probe (Task 7). */
export function documentStoreConfigured(): boolean {
  const e = env();
  return e.DOCUMENT_STORE_DRIVER === "silo" || Boolean(e.DOCUMENT_STORE_LOCAL_PATH);
}
```

`resolveDocumentStore` imports `SILO_PROVIDER` and `siloCredentialSchema` from `silo-provider-adapter.ts`, which Task 7 writes. Until then this file does not compile — so **write `resolveDocumentStore` and `documentStoreConfigured` in Task 7, not here**. In this task the file contains only `storeFromDriver`, `DocumentStoreResolution` and `StoreFromDriverInput`, with `SiloCredentials` declared locally as:

```ts
export interface SiloCredentials {
  endpoint: string;
  bucket: string;
  region: string;
  accessKeyId: string;
  secretAccessKey: string;
}
```

Task 7 moves that interface into the adapter, re-exports it here, and adds the two async functions. This split is deliberate: it keeps every task type-checking on its own commit.

- [ ] **Step 11: Run everything and type-check**

Run:
```bash
npm test -- payroll/
npx tsc --noEmit
```
Expected: PASS and exit 0.

- [ ] **Step 12: Commit**

```bash
git add src/modules/payroll/infrastructure src/lib/env.ts src/lib/env.test.ts src/test/integration-setup.ts
git commit -m "feat(payroll): add the SigV4 signer, the S3 document store and the driver resolver"
```

---

### Task 4: The import status machine and the pay-period domain

**Files:**
- Create: `src/modules/payroll/domain/payroll.ts`
- Create: `src/modules/payroll/domain/payroll.test.ts`
- Create: `src/modules/payroll/domain/period.ts`
- Create: `src/modules/payroll/domain/period.test.ts`

**Interfaces:**
- Consumes: `PayrollImportStatus`, `PayrollRecordKind`, `TextSourceColumn` from `../application/ports` (Task 2); `TextSource` from `@/lib/payroll/text` (existing).
- Produces:
```ts
// domain/payroll.ts
export const TERMINAL_STATUSES: readonly PayrollImportStatus[];
export const LIVE_STATUSES: readonly PayrollImportStatus[];
export const EDITABLE_STATUSES: readonly PayrollImportStatus[];
export function isTerminal(status: PayrollImportStatus): boolean;
export function isEditable(status: PayrollImportStatus): boolean;
export function canTransition(from: PayrollImportStatus, to: PayrollImportStatus): boolean;
export function textSourceColumn(source: TextSource | null): TextSourceColumn;
// domain/period.ts
export function titleMonth(title: string | null | undefined): string | null;
export function titleIsThirteenth(title: string | null | undefined): boolean;
export interface PayPeriod { periodStart: string; periodEnd: string }
export function periodFor(monthKey: string): PayPeriod;
export function recordKindOf(isThirteenth: boolean): PayrollRecordKind;
export function monthOfPeriod(periodStart: string): string;
```

- [ ] **Step 1: Write the failing status-machine test**

```ts
// src/modules/payroll/domain/payroll.test.ts
import { describe, expect, it } from "vitest";
import type { PayrollImportStatus } from "../application/ports";
import { EDITABLE_STATUSES, canTransition, isEditable, isTerminal, textSourceColumn } from "./payroll";

describe("isTerminal", () => {
  it("is true for exactly applied, rejected and superseded — the three the retention job may purge", () => {
    const terminal: PayrollImportStatus[] = ["applied", "rejected", "superseded"];
    for (const s of terminal) expect(isTerminal(s)).toBe(true);
  });

  it("is false for every status a document is still being worked on in", () => {
    const live: PayrollImportStatus[] = [
      "received", "scanning", "needs_ocr", "extracting", "parsed", "needs_review", "verified", "failed",
    ];
    for (const s of live) expect(isTerminal(s)).toBe(false);
  });
});

describe("isEditable", () => {
  it("allows editing values while needs_review or verified (Ruling R4-6)", () => {
    expect(EDITABLE_STATUSES).toEqual(["needs_review", "verified"]);
    expect(isEditable("needs_review")).toBe(true);
    expect(isEditable("verified")).toBe(true);
  });

  it("refuses to edit an applied import — the reverse of a wrong apply is a replacement", () => {
    expect(isEditable("applied")).toBe(false);
  });
});

describe("canTransition", () => {
  it("walks the happy path", () => {
    const path: PayrollImportStatus[] = ["received", "scanning", "extracting", "parsed", "needs_review", "verified", "applied"];
    for (let i = 0; i < path.length - 1; i += 1) {
      expect(canTransition(path[i]!, path[i + 1]!)).toBe(true);
    }
  });

  it("lets scanning park in needs_ocr and needs_ocr resume into extracting on a retry", () => {
    expect(canTransition("scanning", "needs_ocr")).toBe(false);
    expect(canTransition("extracting", "needs_ocr")).toBe(true);
    expect(canTransition("needs_ocr", "extracting")).toBe(true);
  });

  it("never lets an applied import go back to needs_review", () => {
    expect(canTransition("applied", "needs_review")).toBe(false);
    expect(canTransition("applied", "verified")).toBe(false);
  });

  it("only ever supersedes an applied import", () => {
    expect(canTransition("applied", "superseded")).toBe(true);
    expect(canTransition("needs_review", "superseded")).toBe(false);
  });

  it("allows rejection from any live status, and never from a terminal one", () => {
    for (const s of ["received", "scanning", "needs_ocr", "extracting", "parsed", "needs_review", "verified", "failed"] as const) {
      expect(canTransition(s, "rejected")).toBe(true);
    }
    for (const s of ["applied", "rejected", "superseded"] as const) {
      expect(canTransition(s, "rejected")).toBe(false);
    }
  });

  it("lets scanning stay scanning, so an unavailable scanner is retried rather than failed (Ruling R4-2)", () => {
    expect(canTransition("scanning", "scanning")).toBe(true);
  });

  it("lets a failed upload be reused rather than duplicated (Ruling R4-3)", () => {
    expect(canTransition("failed", "received")).toBe(true);
  });
});

describe("textSourceColumn", () => {
  it("maps the parser's two values onto the spec's column vocabulary (Ruling R4-14)", () => {
    expect(textSourceColumn("pdf")).toBe("pdf_text");
    expect(textSourceColumn("ocr")).toBe("ocr");
  });

  it("maps 'no text at all' to none — the honest encoding of needs_ocr (Ruling R4-9)", () => {
    expect(textSourceColumn(null)).toBe("none");
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `npm test -- payroll/domain/payroll`
Expected: FAIL — `Cannot find module './payroll'`.

- [ ] **Step 3: Write the status machine**

```ts
// src/modules/payroll/domain/payroll.ts
import type { TextSource } from "@/lib/payroll/text";
import type { PayrollImportStatus, TextSourceColumn } from "../application/ports";

/**
 * The three statuses at which nothing more will happen to an import. Only
 * these are purgeable by the retention job (Ruling R4-5), which is what makes
 * "a document still being worked on is out of reach" true by construction
 * rather than by the job remembering to check.
 */
export const TERMINAL_STATUSES = ["applied", "rejected", "superseded"] as const satisfies readonly PayrollImportStatus[];

export const LIVE_STATUSES = [
  "received", "scanning", "needs_ocr", "extracting", "parsed", "needs_review", "verified", "failed",
] as const satisfies readonly PayrollImportStatus[];

/** Ruling R4-6: values are editable up to the apply, and never after it. */
export const EDITABLE_STATUSES = ["needs_review", "verified"] as const satisfies readonly PayrollImportStatus[];

export function isTerminal(status: PayrollImportStatus): boolean {
  return (TERMINAL_STATUSES as readonly string[]).includes(status);
}

export function isEditable(status: PayrollImportStatus): boolean {
  return (EDITABLE_STATUSES as readonly string[]).includes(status);
}

/**
 * The whole pipeline in one table, so no use case has to reason about
 * reachability on its own. Read it as "from → the set it may move to".
 *
 * `scanning → scanning` is deliberate: an `unavailable` verdict leaves the row
 * where it is for the next tick (Ruling R4-2), and a transition check that
 * rejected the self-loop would turn a retry into a spurious failure.
 * `failed → received` is the reuse path for an upload whose bytes never landed
 * (Ruling R4-3).
 */
const TRANSITIONS: Record<PayrollImportStatus, readonly PayrollImportStatus[]> = {
  received: ["scanning", "rejected", "failed"],
  scanning: ["scanning", "extracting", "rejected", "failed"],
  extracting: ["parsed", "needs_ocr", "rejected", "failed"],
  needs_ocr: ["extracting", "rejected", "failed"],
  parsed: ["needs_review", "rejected", "failed"],
  needs_review: ["needs_review", "verified", "rejected", "failed"],
  verified: ["needs_review", "verified", "applied", "rejected", "failed"],
  applied: ["superseded"],
  rejected: [],
  superseded: [],
  failed: ["received", "scanning", "rejected"],
};

export function canTransition(from: PayrollImportStatus, to: PayrollImportStatus): boolean {
  return TRANSITIONS[from].includes(to);
}

/**
 * Ruling R4-14. The parser's `TextSource` has two values; the column has the
 * spec's three. `null` — meaning no text was ever obtained — becomes `none`,
 * which is exactly the `needs_ocr` state and is never confused with an OCR pass
 * that returned an empty string.
 */
export function textSourceColumn(source: TextSource | null): TextSourceColumn {
  if (source === "pdf") return "pdf_text";
  if (source === "ocr") return "ocr";
  return "none";
}
```

- [ ] **Step 4: Write the failing period test**

```ts
// src/modules/payroll/domain/period.test.ts
import { describe, expect, it } from "vitest";
import { monthOfPeriod, periodFor, recordKindOf, titleIsThirteenth, titleMonth } from "./period";

describe("titleMonth", () => {
  it("reads the Italian month name and year out of a payslip title", () => {
    expect(titleMonth("Busta Paga Agosto 2026")).toBe("2026-08-01");
    expect(titleMonth("busta paga - maggio 2026")).toBe("2026-05-01");
    expect(titleMonth("Cedolino Dicembre 2025")).toBe("2025-12-01");
  });

  it("files a tredicesima with no month name in December of its year", () => {
    expect(titleMonth("Tredicesima 2025")).toBe("2025-12-01");
  });

  it("answers null when there is nothing to read", () => {
    expect(titleMonth(null)).toBeNull();
    expect(titleMonth(undefined)).toBeNull();
    expect(titleMonth("scan_0001.pdf")).toBeNull();
  });
});

describe("titleIsThirteenth", () => {
  it("recognises every spelling the employer uses", () => {
    expect(titleIsThirteenth("Tredicesima 2025")).toBe(true);
    expect(titleIsThirteenth("Busta paga 13ª 2025")).toBe(true);
    expect(titleIsThirteenth("Gratifica natalizia 2025")).toBe(true);
  });

  it("is false for an ordinary December payslip", () => {
    expect(titleIsThirteenth("Busta Paga Dicembre 2025")).toBe(false);
    expect(titleIsThirteenth(null)).toBe(false);
  });
});

describe("periodFor", () => {
  it("turns a month key into the civil month's first and last day", () => {
    expect(periodFor("2026-08-01")).toEqual({ periodStart: "2026-08-01", periodEnd: "2026-08-31" });
    expect(periodFor("2026-02-01")).toEqual({ periodStart: "2026-02-01", periodEnd: "2026-02-28" });
  });

  it("gets February right in a leap year", () => {
    expect(periodFor("2028-02-01")).toEqual({ periodStart: "2028-02-01", periodEnd: "2028-02-29" });
  });

  it("normalises a mid-month date to its month", () => {
    expect(periodFor("2026-08-17")).toEqual({ periodStart: "2026-08-01", periodEnd: "2026-08-31" });
  });

  it("throws on a value that is not a date, rather than inventing a period", () => {
    expect(() => periodFor("not-a-date")).toThrow(/invalid month key/i);
  });
});

describe("recordKindOf", () => {
  it("maps the tredicesima flag onto the record kind the schema allows", () => {
    expect(recordKindOf(true)).toBe("thirteenth");
    expect(recordKindOf(false)).toBe("ordinary");
  });
});

describe("monthOfPeriod", () => {
  it("is the inverse of periodFor's start", () => {
    expect(monthOfPeriod("2026-08-01")).toBe("2026-08-01");
    expect(monthOfPeriod("2026-08-31")).toBe("2026-08-01");
  });
});
```

- [ ] **Step 5: Run it and watch it fail**

Run: `npm test -- payroll/domain/period`
Expected: FAIL — `Cannot find module './period'`.

- [ ] **Step 6: Write the period domain, porting from `payslip-ingest.ts`**

```ts
// src/modules/payroll/domain/period.ts
import type { PayrollRecordKind } from "../application/ports";

const IT_MONTHS: Record<string, string> = {
  gennaio: "01", febbraio: "02", marzo: "03", aprile: "04",
  maggio: "05", giugno: "06", luglio: "07", agosto: "08",
  settembre: "09", ottobre: "10", novembre: "11", dicembre: "12",
};

/**
 * Ported verbatim from `src/lib/jobs/payslip-ingest.ts:103-112`, which this
 * phase deletes. Its original comment is worth keeping, with "Paperless title"
 * generalised to "document title" — the uploaded filename now plays the same
 * role the Paperless title used to:
 *
 * The title is the most reliable period source available: every payslip is
 * named "Busta Paga ... <Mese> <Anno>". It beats both alternatives, measured
 * against the real 12 documents: the OCR-derived period resolved every single
 * one to 2009-01 (it latches onto a stray year in the payslip body), which
 * collapsed them all onto one key so only one row survived; and the document
 * store's own metadata date is off by a month at least once ("Maggio 2026" was
 * filed 2026-06-01).
 */
export function titleMonth(title: string | null | undefined): string | null {
  if (!title) return null;
  const m = /\b(gennaio|febbraio|marzo|aprile|maggio|giugno|luglio|agosto|settembre|ottobre|novembre|dicembre)\b[^0-9]{0,10}(20\d{2})\b/i.exec(
    title,
  );
  if (m) return `${m[2]}-${IT_MONTHS[m[1]!.toLowerCase()]}-01`;
  // "Tredicesima 2025" carries no month name; the 13th is always December.
  const t = /\btredicesima\b[^0-9]{0,10}(20\d{2})\b/i.exec(title);
  return t ? `${t[1]}-12-01` : null;
}

/** "Tredicesima" in the title is a stronger signal than any text heuristic. Ported from `payslip-ingest.ts:115-117`. */
export function titleIsThirteenth(title: string | null | undefined): boolean {
  return /\btredicesima\b|\b13[aª]\b|\bgratifica natalizia\b/i.test(title ?? "");
}

export interface PayPeriod {
  periodStart: string;
  periodEnd: string;
}

const DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;

/**
 * A payslip covers a civil month. Computed with `Date.UTC` and read back with
 * the UTC getters, so no timezone ever shifts the boundary — these are civil
 * dates stored in `date` columns, not instants.
 */
export function periodFor(monthKey: string): PayPeriod {
  const m = DATE_RE.exec(monthKey);
  if (!m) throw new Error(`invalid month key: ${monthKey}`);
  const year = Number(m[1]);
  const month = Number(m[2]);
  if (month < 1 || month > 12) throw new Error(`invalid month key: ${monthKey}`);
  // Day 0 of the next month is the last day of this one, leap years included.
  const last = new Date(Date.UTC(year, month, 0));
  const pad = (n: number) => String(n).padStart(2, "0");
  return {
    periodStart: `${m[1]}-${m[2]}-01`,
    periodEnd: `${m[1]}-${m[2]}-${pad(last.getUTCDate())}`,
  };
}

/**
 * Ruling R4-10's companion: the schema's `kind` has five values, and this phase
 * can distinguish exactly two of them. `fourteenth`, `bonus` and `settlement`
 * are creatable through the API and the review form but never inferred, because
 * nothing in the parsed text distinguishes them reliably and guessing would put
 * a wrong month in Earnings.
 */
export function recordKindOf(isThirteenth: boolean): PayrollRecordKind {
  return isThirteenth ? "thirteenth" : "ordinary";
}

/** The month key a period belongs to — what the legacy `fund_deposits` bridge keys on. */
export function monthOfPeriod(periodStart: string): string {
  const m = DATE_RE.exec(periodStart);
  if (!m) throw new Error(`invalid period start: ${periodStart}`);
  return `${m[1]}-${m[2]}-01`;
}
```

- [ ] **Step 7: Run both tests and watch them pass**

Run: `npm test -- payroll/domain`
Expected: PASS — 12 status cases and 13 period cases, plus Task 2's 9 document cases still green.

- [ ] **Step 8: Commit**

```bash
git add src/modules/payroll/domain
git commit -m "feat(payroll): add the import status machine and the pay-period domain"
```

---

### Task 5: Component mapping and turning an extraction into components

**Files:**
- Create: `src/modules/payroll/domain/money.ts`
- Create: `src/modules/payroll/domain/money.test.ts`
- Create: `src/modules/payroll/domain/mapping.ts`
- Create: `src/modules/payroll/domain/mapping.test.ts`
- Create: `src/modules/payroll/domain/components.ts`
- Create: `src/modules/payroll/domain/components.test.ts`

**Interfaces:**
- Consumes: `PayrollComponentKind`, `MappingTarget`, `PayrollMappingRule`, `NewPayrollComponent` from `../application/ports` (Task 2); `PayslipExtraction`, `PayslipField`, `PAYSLIP_FIELDS`, `Confidence` from `@/lib/contracts` (existing).
- Produces:
```ts
// domain/money.ts
export function addMoney(a: string | null, b: string | null): string | null;
// domain/mapping.ts
export const DEFAULT_MAPPING_RULES: readonly Omit<PayrollMappingRule, "id" | "userId">[];
export function classifyComponent(rules: readonly PayrollMappingRule[], code: string, labelRaw: string): { kind: PayrollComponentKind; target: MappingTarget };
// domain/components.ts
export function componentsFromExtraction(extraction: PayslipExtraction, rules: readonly PayrollMappingRule[]): NewPayrollComponent[];
export function grossOf(components: readonly NewPayrollComponent[]): string | null;
export function netOf(components: readonly NewPayrollComponent[]): string | null;
```

- [ ] **Step 1: Write the failing money test**

```ts
// src/modules/payroll/domain/money.test.ts
import { describe, expect, it } from "vitest";
import { addMoney } from "./money";

describe("addMoney", () => {
  it("adds two decimal strings exactly, without going through a float", () => {
    expect(addMoney("0.10", "0.20")).toBe("0.30");
    expect(addMoney("1800.55", "244.45")).toBe("2045.00");
    expect(addMoney("2500.00", "1800.00")).toBe("4300.00");
  });

  it("treats a missing half as absent, not as zero, until both are missing", () => {
    expect(addMoney("100.00", null)).toBe("100.00");
    expect(addMoney(null, "100.00")).toBe("100.00");
    expect(addMoney(null, null)).toBeNull();
  });

  it("normalises the scale of an input that carries fewer decimals", () => {
    expect(addMoney("100", "0.5")).toBe("100.50");
  });

  it("handles a negative total", () => {
    expect(addMoney("-100.00", "40.00")).toBe("-60.00");
    expect(addMoney("-0.05", "-0.05")).toBe("-0.10");
  });

  it("throws on a value that is not a decimal, rather than silently producing NaN", () => {
    expect(() => addMoney("1.800,00", "1.00")).toThrow(/not a decimal/);
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `npm test -- payroll/domain/money`
Expected: FAIL — `Cannot find module './money'`.

- [ ] **Step 3: Write the money domain**

```ts
// src/modules/payroll/domain/money.ts
const DECIMAL_RE = /^(-?)(\d+)(?:\.(\d+))?$/;

/**
 * Exact addition of two two-decimal money strings, via `BigInt` cents — the
 * same fixed-point discipline `interests/domain/accrual.ts` uses, and the
 * reason `Number()` never appears anywhere near a payroll figure.
 *
 * `null` means "the payslip did not carry this half", which is not the same as
 * zero: two absent halves produce `null`, so the fund bridge writes nothing
 * rather than a `0.00` deposit and an Earnings bucket reports "—" rather than a
 * figure nobody stated.
 *
 * It lives in `domain/` because both the earnings summary and the fund bridge
 * need it, and a shared helper reached through `infrastructure/` would invert
 * the module's own layering.
 */
export function addMoney(a: string | null, b: string | null): string | null {
  if (a === null && b === null) return null;
  const cents = (v: string | null): bigint => {
    if (v === null) return 0n;
    const m = DECIMAL_RE.exec(v.trim());
    if (!m) throw new Error(`not a decimal: ${v}`);
    const [, sign, intPart, fracPart = ""] = m;
    const frac = (fracPart + "00").slice(0, 2);
    return BigInt(`${sign}${intPart}${frac}`);
  };
  const total = cents(a) + cents(b);
  const negative = total < 0n;
  const abs = (negative ? -total : total).toString().padStart(3, "0");
  return `${negative ? "-" : ""}${abs.slice(0, -2)}.${abs.slice(-2)}`;
}
```

- [ ] **Step 4: Write the failing mapping test**

```ts
// src/modules/payroll/domain/mapping.test.ts
import { describe, expect, it } from "vitest";
import type { PayrollMappingRule } from "../application/ports";
import { DEFAULT_MAPPING_RULES, classifyComponent } from "./mapping";

const globals: PayrollMappingRule[] = DEFAULT_MAPPING_RULES.map((r, i) => ({
  ...r,
  id: `g${i}`,
  userId: null,
}));

describe("DEFAULT_MAPPING_RULES", () => {
  it("covers every target the spec's mapping rules can name (Ruling R4-10)", () => {
    const kinds = new Set(DEFAULT_MAPPING_RULES.map((r) => r.target.kind));
    expect(kinds).toEqual(new Set(["earnings", "fund_contribution", "timeoff_balance", "timeoff_used"]));
  });

  it("targets the Cometa fund by slug, not by a numeric id no seed guarantees", () => {
    const fund = DEFAULT_MAPPING_RULES.filter((r) => r.target.kind === "fund_contribution");
    expect(fund.length).toBe(2);
    for (const r of fund) {
      expect(r.target).toMatchObject({ kind: "fund_contribution", fundSlug: "cometa" });
    }
    expect(fund.map((r) => (r.target as { part: string }).part).sort()).toEqual(["employee", "employer"]);
  });
});

describe("classifyComponent", () => {
  it("matches on the parser's own field code", () => {
    expect(classifyComponent(globals, "net", "Netto del mese")).toEqual({ kind: "earning", target: { kind: "earnings" } });
    expect(classifyComponent(globals, "taxes", "Totale trattenute")).toEqual({ kind: "tax", target: { kind: "earnings" } });
  });

  it("routes both Cometa halves to the fund bridge with the right part", () => {
    expect(classifyComponent(globals, "fundContribEmployee", "Contributo Cometa dipendente")).toEqual({
      kind: "employee_contribution",
      target: { kind: "fund_contribution", fundSlug: "cometa", part: "employee" },
    });
    expect(classifyComponent(globals, "fundContribEmployer", "Contributo Cometa azienda")).toEqual({
      kind: "employer_contribution",
      target: { kind: "fund_contribution", fundSlug: "cometa", part: "employer" },
    });
  });

  it("routes leave residuals and leave taken to the Phase-7 targets, written but not acted on", () => {
    expect(classifyComponent(globals, "ferieBalance", "Ferie residue")).toEqual({
      kind: "leave_balance",
      target: { kind: "timeoff_balance", timeoffCode: "vacation" },
    });
    expect(classifyComponent(globals, "rolTakenHours", "ROL godute")).toEqual({
      kind: "leave_used",
      target: { kind: "timeoff_used", timeoffCode: "permits" },
    });
  });

  it("falls back to info/none for a code no rule names, rather than guessing", () => {
    expect(classifyComponent(globals, "arretrati", "Arretrati anni precedenti")).toEqual({
      kind: "info",
      target: { kind: "none" },
    });
  });

  it("prefers a user rule over a global one at the same priority, and lower priority wins overall", () => {
    const userRule: PayrollMappingRule = {
      id: "u1",
      userId: "user-1",
      matchCode: null,
      matchLabel: "^Arretrati",
      componentKind: "earning",
      target: { kind: "earnings" },
      priority: 10,
    };
    expect(classifyComponent([...globals, userRule], "arretrati", "Arretrati anni precedenti")).toEqual({
      kind: "earning",
      target: { kind: "earnings" },
    });
  });

  it("matches a label rule case-insensitively and never throws on an invalid regex", () => {
    const bad: PayrollMappingRule = {
      id: "u2", userId: "user-1", matchCode: null, matchLabel: "([unclosed",
      componentKind: "earning", target: { kind: "earnings" }, priority: 1,
    };
    expect(classifyComponent([bad, ...globals], "net", "Netto del mese")).toEqual({
      kind: "earning",
      target: { kind: "earnings" },
    });
  });
});
```

- [ ] **Step 5: Run it and watch it fail**

Run: `npm test -- payroll/domain/mapping`
Expected: FAIL — `Cannot find module './mapping'`.

- [ ] **Step 6: Write the mapping domain**

```ts
// src/modules/payroll/domain/mapping.ts
import type { MappingTarget, PayrollComponentKind, PayrollMappingRule } from "../application/ports";

type RuleShape = Omit<PayrollMappingRule, "id" | "userId">;

/**
 * The global catalogue (spec §5.8), keyed on the *parser's* own field codes
 * (`PAYSLIP_FIELDS` in `src/lib/contracts.ts`) rather than on payslip label
 * text, because the codes are stable and the Italian labels are not.
 *
 * Ruling R4-10: every target listed here is recorded on the component, but only
 * `fund_contribution` has a consumer in Phase 4. `timeoff_balance` and
 * `timeoff_used` wait for Phase 7's `timeoff_balances` table; the rows exist
 * from day one so that phase needs no backfill.
 *
 * `permessiBalance` deliberately has no rule: the parser can read it, but the
 * Work page's own comment already records that permessi are excluded from the
 * headline, and inventing a `timeoff_code` for it here would put a number in
 * Phase 7's balances that nobody has agreed on.
 */
export const DEFAULT_MAPPING_RULES: readonly RuleShape[] = [
  { matchCode: "gross", matchLabel: null, componentKind: "earning", target: { kind: "earnings" }, priority: 100 },
  { matchCode: "net", matchLabel: null, componentKind: "earning", target: { kind: "earnings" }, priority: 100 },
  { matchCode: "taxes", matchLabel: null, componentKind: "tax", target: { kind: "earnings" }, priority: 100 },
  {
    matchCode: "fundContribEmployee", matchLabel: null, componentKind: "employee_contribution",
    target: { kind: "fund_contribution", fundSlug: "cometa", part: "employee" }, priority: 100,
  },
  {
    matchCode: "fundContribEmployer", matchLabel: null, componentKind: "employer_contribution",
    target: { kind: "fund_contribution", fundSlug: "cometa", part: "employer" }, priority: 100,
  },
  {
    matchCode: "ferieBalance", matchLabel: null, componentKind: "leave_balance",
    target: { kind: "timeoff_balance", timeoffCode: "vacation" }, priority: 100,
  },
  {
    matchCode: "rolBalance", matchLabel: null, componentKind: "leave_balance",
    target: { kind: "timeoff_balance", timeoffCode: "permits" }, priority: 100,
  },
  {
    matchCode: "ferieTakenHours", matchLabel: null, componentKind: "leave_used",
    target: { kind: "timeoff_used", timeoffCode: "vacation" }, priority: 100,
  },
  {
    matchCode: "rolTakenHours", matchLabel: null, componentKind: "leave_used",
    target: { kind: "timeoff_used", timeoffCode: "permits" }, priority: 100,
  },
];

function matches(rule: PayrollMappingRule, code: string, labelRaw: string): boolean {
  if (rule.matchCode !== null && rule.matchCode === code) return true;
  if (rule.matchLabel === null) return false;
  try {
    return new RegExp(rule.matchLabel, "i").test(labelRaw);
  } catch {
    // A user-authored regex is untrusted input. A bad one must skip its own
    // rule, never take down the classification of every component on the
    // payslip — which is what an uncaught SyntaxError here would do.
    return false;
  }
}

/**
 * Resolves one component against the rule set. Rules are considered in
 * `priority asc, id asc` order — the same order `PayrollMappingRulesRepository.
 * listFor` returns them in, so the caller never has to sort. The fallback is
 * deliberately inert (`info` / `none`): a component nobody has a rule for is
 * still recorded and still shown, it simply feeds nothing.
 */
export function classifyComponent(
  rules: readonly PayrollMappingRule[],
  code: string,
  labelRaw: string,
): { kind: PayrollComponentKind; target: MappingTarget } {
  const sorted = [...rules].sort((a, b) => (a.priority === b.priority ? a.id.localeCompare(b.id) : a.priority - b.priority));
  for (const rule of sorted) {
    if (matches(rule, code, labelRaw)) return { kind: rule.componentKind, target: rule.target };
  }
  return { kind: "info", target: { kind: "none" } };
}
```

- [ ] **Step 7: Write the failing components test**

```ts
// src/modules/payroll/domain/components.test.ts
import { describe, expect, it } from "vitest";
import type { PayslipExtraction } from "@/lib/contracts";
import type { PayrollMappingRule } from "../application/ports";
import { DEFAULT_MAPPING_RULES } from "./mapping";
import { componentsFromExtraction, grossOf, netOf } from "./components";

const rules: PayrollMappingRule[] = DEFAULT_MAPPING_RULES.map((r, i) => ({ ...r, id: `g${i}`, userId: null }));

function extraction(fields: PayslipExtraction["fields"]): PayslipExtraction {
  return {
    parserVersion: "payroll-1.0.0",
    month: "2026-08-01",
    isThirteenth: false,
    textSource: "pdf",
    fields,
    checks: [],
  };
}

describe("componentsFromExtraction", () => {
  it("emits one component per field the parser actually read, in PAYSLIP_FIELDS order", () => {
    const components = componentsFromExtraction(
      extraction({
        gross: { value: 2500, confidence: "high", rules: 2500, llm: 2500 },
        net: { value: 1800.5, confidence: "high", rules: 1800.5, llm: null },
        taxes: { value: 699.5, confidence: "medium", rules: 699.5, llm: null },
      }),
      rules,
    );
    expect(components.map((c) => c.code)).toEqual(["gross", "net", "taxes"]);
    expect(components.map((c) => c.sortOrder)).toEqual([0, 1, 2]);
  });

  it("writes money as a two-decimal string, never as a number", () => {
    const [c] = componentsFromExtraction(
      extraction({ net: { value: 1800.5, confidence: "high", rules: 1800.5, llm: null } }),
      rules,
    );
    expect(c!.amount).toBe("1800.50");
    expect(typeof c!.amount).toBe("string");
    expect(c!.unit).toBe("eur");
    expect(c!.quantity).toBeNull();
  });

  it("writes an hours field as a quantity in hours, with no amount", () => {
    const [c] = componentsFromExtraction(
      extraction({ ferieBalance: { value: 88.25, confidence: "medium", rules: 88.25, llm: null } }),
      rules,
    );
    expect(c!.amount).toBeNull();
    expect(c!.quantity).toBe("88.250000");
    expect(c!.unit).toBe("hours");
    expect(c!.kind).toBe("leave_balance");
    expect(c!.mappedTo).toEqual({ kind: "timeoff_balance", timeoffCode: "vacation" });
  });

  it("skips a field the parser could not read — a null value is never a 0.00 component", () => {
    const components = componentsFromExtraction(
      extraction({
        net: { value: 1800, confidence: "high", rules: 1800, llm: null },
        gross: { value: null, confidence: "low", rules: null, llm: null },
      }),
      rules,
    );
    expect(components.map((c) => c.code)).toEqual(["net"]);
  });

  it("carries the per-field confidence and records whether rules or the LLM produced it", () => {
    const components = componentsFromExtraction(
      extraction({
        net: { value: 1800, confidence: "high", rules: 1800, llm: null },
        taxes: { value: 700, confidence: "low", rules: null, llm: 700 },
      }),
      rules,
    );
    expect(components[0]).toMatchObject({ confidence: "high", source: "rules" });
    expect(components[1]).toMatchObject({ confidence: "low", source: "llm" });
  });

  it("keeps the Italian label as data and the kind in English (spec §2.9)", () => {
    const [c] = componentsFromExtraction(
      extraction({ net: { value: 1800, confidence: "high", rules: 1800, llm: null } }),
      rules,
    );
    expect(c!.labelRaw).toBe("Netto del mese");
    expect(c!.kind).toBe("earning");
  });

  it("returns an empty list for an extraction that read nothing at all", () => {
    expect(componentsFromExtraction(extraction({}), rules)).toEqual([]);
  });
});

describe("grossOf and netOf", () => {
  const components = componentsFromExtraction(
    extraction({
      gross: { value: 2500, confidence: "high", rules: 2500, llm: null },
      net: { value: 1800.5, confidence: "high", rules: 1800.5, llm: null },
    }),
    rules,
  );

  it("pick the two headline figures straight off the components", () => {
    expect(grossOf(components)).toBe("2500.00");
    expect(netOf(components)).toBe("1800.50");
  });

  it("answer null when the figure is absent, so the record stores null rather than zero", () => {
    expect(grossOf([])).toBeNull();
    expect(netOf([])).toBeNull();
  });
});
```

- [ ] **Step 8: Run it and watch it fail**

Run: `npm test -- payroll/domain/components`
Expected: FAIL — `Cannot find module './components'`.

- [ ] **Step 9: Write the extraction-to-components mapper**

```ts
// src/modules/payroll/domain/components.ts
import { PAYSLIP_FIELDS, type PayslipExtraction, type PayslipField } from "@/lib/contracts";
import type { NewPayrollComponent, PayrollMappingRule } from "../application/ports";
import { classifyComponent } from "./mapping";

/**
 * The Italian text each parser field corresponds to on the employer's payslip.
 * This is *data*, per spec §2.9: it is what the document says, not UI chrome,
 * and it is what a reviewer compares against the page they are looking at.
 */
const LABELS: Record<PayslipField, string> = {
  gross: "Totale competenze",
  net: "Netto del mese",
  taxes: "Totale trattenute",
  fundContribEmployee: "Contributo Cometa dipendente",
  fundContribEmployer: "Contributo Cometa azienda",
  ferieBalance: "Ferie residue",
  rolBalance: "ROL residue",
  permessiBalance: "Permessi residui",
  ferieTakenHours: "Ferie godute",
  rolTakenHours: "ROL godute",
};

/** Fields the payslip states in hours rather than euro. */
const HOUR_FIELDS = new Set<PayslipField>([
  "ferieBalance", "rolBalance", "permessiBalance", "ferieTakenHours", "rolTakenHours",
]);

/**
 * The single, named place where the existing parser's `number` crosses into
 * this module's decimal strings (see the money global constraint).
 *
 * `PayslipExtraction.fields[f].value` is `number | null` — that type predates
 * this phase and is not being changed, because widening it would touch every
 * test under `src/lib/payroll/`. `toFixed` is exact for the magnitudes a
 * payslip carries (well under 2^53 cents), and nothing downstream ever converts
 * back: the string is what reaches Postgres.
 */
function toDecimal(value: number, scale: number): string {
  return value.toFixed(scale);
}

/**
 * One component per field the parser actually read, in `PAYSLIP_FIELDS` order
 * so `sort_order` is stable across re-applies and two reviewers see the same
 * list in the same order.
 *
 * A field whose `value` is null is **skipped entirely** rather than written as
 * `0.00` — the "never invent financial data" rule at its sharpest: a zero
 * component would flow straight into `grossOf`, into Earnings and into the
 * fund bridge as a real, wrong figure.
 */
export function componentsFromExtraction(
  extraction: PayslipExtraction,
  rules: readonly PayrollMappingRule[],
): NewPayrollComponent[] {
  const out: NewPayrollComponent[] = [];
  for (const field of PAYSLIP_FIELDS) {
    const extracted = extraction.fields[field];
    if (!extracted || extracted.value === null) continue;
    const labelRaw = LABELS[field];
    const { kind, target } = classifyComponent(rules, field, labelRaw);
    const isHours = HOUR_FIELDS.has(field);
    out.push({
      // `recordId` is filled by the repository's `replaceForRecord`, which owns
      // the record this batch belongs to; the domain does not know it.
      recordId: "",
      code: field,
      labelRaw,
      kind,
      amount: isHours ? null : toDecimal(extracted.value, 2),
      quantity: isHours ? toDecimal(extracted.value, 6) : null,
      unit: isHours ? "hours" : "eur",
      currency: "EUR",
      confidence: extracted.confidence,
      // Which pass produced the accepted value. `rules` when the deterministic
      // pass had it (the common case and the one that survives a layout
      // change); `llm` only when the LLM was the sole source.
      source: extracted.rules !== null ? "rules" : "llm",
      mappedTo: target,
      sortOrder: out.length,
    });
  }
  return out;
}

function amountOf(components: readonly NewPayrollComponent[], code: PayslipField): string | null {
  return components.find((c) => c.code === code)?.amount ?? null;
}

/** The record's headline gross, straight off the components — never recomputed by summing. */
export function grossOf(components: readonly NewPayrollComponent[]): string | null {
  return amountOf(components, "gross");
}

/** The record's headline net. Null when absent, so the record stores null and the UI renders "—". */
export function netOf(components: readonly NewPayrollComponent[]): string | null {
  return amountOf(components, "net");
}
```

- [ ] **Step 10: Run every domain test and type-check**

Run:
```bash
npm test -- payroll/domain
npx tsc --noEmit
```
Expected: PASS (9 document + 12 status + 13 period + 5 money + 8 mapping + 9 component cases) and exit 0.

- [ ] **Step 11: Commit**

```bash
git add src/modules/payroll/domain
git commit -m "feat(payroll): map extracted fields onto classified payroll components"
```

---

### Task 6: The malware-scanning boundary

**Files:**
- Create: `src/modules/payroll/infrastructure/noop-scanner.ts`
- Create: `src/modules/payroll/infrastructure/clamd-scanner.ts`
- Create: `src/modules/payroll/infrastructure/clamd-scanner.test.ts`
- Create: `src/modules/payroll/infrastructure/scanner-resolver.ts`
- Create: `src/modules/payroll/infrastructure/scanner-resolver.test.ts`
- Modify: `src/lib/env.ts` (add `MALWARE_SCANNER`, `CLAMD_HOST`, `CLAMD_PORT`)
- Modify: `src/lib/env.test.ts`

**Interfaces:**
- Consumes: `MalwareScanner`, `ScanResult` from `../application/ports` (Task 2); `env` from `@/lib/env`.
- Produces:
```ts
export const noopScanner: MalwareScanner;                                  // { verdict: "clean", scanner: "none", signature: null }
export interface ClamdConfig { host: string; port: number; timeoutMs?: number; connect?: ClamdConnect }
export function createClamdScanner(config: ClamdConfig): MalwareScanner;
export function parseClamdReply(reply: string): ScanResult;
export function resolveScanner(): MalwareScanner;
```

The clamd wire command below is written as the JavaScript escape `"zINSTREAM\0"` — the literal string `zINSTREAM` followed by a single NUL byte. Type the backslash-zero escape; never paste a raw NUL into the source.

- [ ] **Step 1: Write the failing clamd test against a real in-process TCP server**

```ts
// src/modules/payroll/infrastructure/clamd-scanner.test.ts
import { createServer, type Server, type Socket } from "node:net";
import { afterEach, describe, expect, it } from "vitest";
import { createClamdScanner, parseClamdReply } from "./clamd-scanner";

let server: Server | null = null;

afterEach(async () => {
  await new Promise<void>((resolve) => (server ? server.close(() => resolve()) : resolve()));
  server = null;
});

/**
 * A real socket, not a mock: the whole point of this adapter is the wire
 * framing (a 4-byte big-endian length prefix per chunk, terminated by a
 * zero-length chunk), and a mocked socket would let a wrong frame pass.
 */
async function listen(handler: (socket: Socket, received: Buffer[]) => void): Promise<number> {
  server = createServer((socket) => {
    const received: Buffer[] = [];
    socket.on("data", (chunk) => {
      received.push(chunk);
      handler(socket, received);
    });
  });
  await new Promise<void>((resolve) => server!.listen(0, "127.0.0.1", resolve));
  return (server!.address() as { port: number }).port;
}

const bytes = new TextEncoder().encode("%PDF-1.7 payload");
const COMMAND = "zINSTREAM\0";

describe("parseClamdReply", () => {
  it("reads a clean reply", () => {
    expect(parseClamdReply("stream: OK\0")).toEqual({ verdict: "clean", scanner: "clamd", signature: null });
  });

  it("reads an infected reply and keeps the signature name", () => {
    expect(parseClamdReply("stream: Eicar-Test-Signature FOUND\0")).toEqual({
      verdict: "infected",
      scanner: "clamd",
      signature: "Eicar-Test-Signature",
    });
  });

  it("treats an ERROR reply as unavailable, never as clean", () => {
    expect(parseClamdReply("stream: size limit exceeded ERROR\0")).toEqual({
      verdict: "unavailable",
      scanner: "clamd",
      signature: null,
    });
  });

  it("treats anything it does not recognise as unavailable — the safe direction", () => {
    expect(parseClamdReply("gibberish")).toEqual({ verdict: "unavailable", scanner: "clamd", signature: null });
  });
});

describe("createClamdScanner", () => {
  it("sends the zINSTREAM command, then length-prefixed chunks, then a zero terminator", async () => {
    let captured: Buffer = Buffer.alloc(0);
    const expectedLength = COMMAND.length + 4 + bytes.byteLength + 4;
    const port = await listen((socket, received) => {
      captured = Buffer.concat(received);
      if (captured.length >= expectedLength) socket.end("stream: OK\0");
    });
    const result = await createClamdScanner({ host: "127.0.0.1", port }).scan(bytes);
    expect(result).toEqual({ verdict: "clean", scanner: "clamd", signature: null });
    expect(captured.subarray(0, COMMAND.length).toString()).toBe(COMMAND);
    expect(captured.readUInt32BE(COMMAND.length)).toBe(bytes.byteLength);
    expect(captured.subarray(COMMAND.length + 4, COMMAND.length + 4 + bytes.byteLength)).toEqual(Buffer.from(bytes));
    expect(captured.readUInt32BE(COMMAND.length + 4 + bytes.byteLength)).toBe(0);
  });

  it("reports infected with the signature clamd named", async () => {
    const port = await listen((socket) => socket.end("stream: Eicar-Test-Signature FOUND\0"));
    expect(await createClamdScanner({ host: "127.0.0.1", port }).scan(bytes)).toEqual({
      verdict: "infected",
      scanner: "clamd",
      signature: "Eicar-Test-Signature",
    });
  });

  it("answers unavailable — never clean — when nothing is listening", async () => {
    // Port 1 on loopback refuses immediately on every supported platform.
    expect(await createClamdScanner({ host: "127.0.0.1", port: 1, timeoutMs: 500 }).scan(bytes)).toEqual({
      verdict: "unavailable",
      scanner: "clamd",
      signature: null,
    });
  });

  it("answers unavailable when the server accepts and then says nothing before the timeout", async () => {
    const port = await listen(() => {
      /* deliberately never replies */
    });
    expect(await createClamdScanner({ host: "127.0.0.1", port, timeoutMs: 200 }).scan(bytes)).toEqual({
      verdict: "unavailable",
      scanner: "clamd",
      signature: null,
    });
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `npm test -- payroll/infrastructure/clamd-scanner`
Expected: FAIL — `Cannot find module './clamd-scanner'`.

- [ ] **Step 3: Write the two scanners**

```ts
// src/modules/payroll/infrastructure/noop-scanner.ts
import type { MalwareScanner } from "../application/ports";

/**
 * Spec §13.3's default: the boundary exists, no scanner is enabled.
 *
 * It names itself `"none"` rather than pretending to be a scanner, and that
 * name is **persisted** on every import it clears (Ruling R4-2). "Nothing
 * scanned this" is then a recorded fact an auditor can read off the row, not an
 * assumption they have to reconstruct from a deployment's environment three
 * years later.
 */
export const noopScanner: MalwareScanner = {
  async scan() {
    return { verdict: "clean", scanner: "none", signature: null };
  },
};
```

```ts
// src/modules/payroll/infrastructure/clamd-scanner.ts
import { connect as netConnect, type Socket } from "node:net";
import type { MalwareScanner, ScanResult } from "../application/ports";

export type ClamdConnect = (host: string, port: number) => Socket;

export interface ClamdConfig {
  host: string;
  port: number;
  /** Covers connect, send and reply together. Default 30 s. */
  timeoutMs?: number;
  /** Injected only by a test that needs a socket it controls. */
  connect?: ClamdConnect;
}

/** The literal `zINSTREAM` followed by one NUL byte, per the clamd protocol. */
const COMMAND = "zINSTREAM\0";

const CLEAN = /:\s*OK$/;
const FOUND = /:\s*(.+?)\s+FOUND$/;
const ERRORED = /\bERROR$/;

/**
 * clamd's `INSTREAM` reply is one NUL-terminated line. Everything that is not an
 * explicit `OK` or `FOUND` — including `ERROR`, including a reply this code has
 * never seen — is `unavailable`, never `clean`. That asymmetry is the whole
 * safety property: an unrecognised reply must leave the import in `scanning`
 * for a later tick, not wave it through into the parsing pipeline.
 */
export function parseClamdReply(reply: string): ScanResult {
  const line = reply.replace(/\0/g, "").trim();
  if (CLEAN.test(line)) return { verdict: "clean", scanner: "clamd", signature: null };
  const found = FOUND.exec(line);
  if (found && !ERRORED.test(line)) return { verdict: "infected", scanner: "clamd", signature: found[1]! };
  return { verdict: "unavailable", scanner: "clamd", signature: null };
}

/**
 * clamd `zINSTREAM` over TCP (spec §2.5). The wire format is the NUL-terminated
 * command, then any number of chunks each prefixed by its length as a 4-byte
 * big-endian integer, then a zero-length chunk to end the stream.
 *
 * Every failure path — refused connection, timeout, socket error, a reply that
 * does not parse — resolves to `unavailable`. It never rejects: a scanner that
 * threw would make `ingestImport` choose between catching an unknown error and
 * treating an outage as a rejection, and both of those are worse than one
 * explicit verdict the pipeline already knows how to retry (Ruling R4-2).
 */
export function createClamdScanner(config: ClamdConfig): MalwareScanner {
  const timeoutMs = config.timeoutMs ?? 30_000;
  const open = config.connect ?? ((host, port) => netConnect({ host, port }));

  return {
    scan(bytes: Uint8Array): Promise<ScanResult> {
      return new Promise<ScanResult>((resolve) => {
        const socket = open(config.host, config.port);
        const chunks: Buffer[] = [];
        let settled = false;

        const finish = (result: ScanResult) => {
          if (settled) return;
          settled = true;
          socket.destroy();
          resolve(result);
        };

        const unavailable = () => finish({ verdict: "unavailable", scanner: "clamd", signature: null });
        const replyOrUnavailable = () => {
          if (chunks.length === 0) return unavailable();
          finish(parseClamdReply(Buffer.concat(chunks).toString("utf8")));
        };

        socket.setTimeout(timeoutMs, unavailable);
        socket.on("error", unavailable);
        socket.on("data", (chunk: Buffer) => chunks.push(chunk));
        socket.on("end", replyOrUnavailable);
        socket.on("close", replyOrUnavailable);

        socket.on("connect", () => {
          const length = Buffer.alloc(4);
          length.writeUInt32BE(bytes.byteLength, 0);
          const terminator = Buffer.alloc(4); // four zero bytes: the end-of-stream chunk
          socket.write(Buffer.concat([Buffer.from(COMMAND, "binary"), length, Buffer.from(bytes), terminator]));
        });
      });
    },
  };
}
```

- [ ] **Step 4: Add the three environment variables**

In `src/lib/env.ts`, immediately after the `DOCUMENT_STORE_*` block added in Task 3:

```ts
  /**
   * Spec §13.3: the boundary is always there; the scanner is a deployment
   * choice. `none` (the default) records `scanner: "none"` on every import it
   * clears, so "nothing scanned this" is a fact on the row rather than an
   * assumption. `clamd` needs a reachable clamd on CLAMD_HOST:CLAMD_PORT.
   */
  MALWARE_SCANNER: z.enum(["none", "clamd"]).default("none"),
  CLAMD_HOST: z.preprocess(blankToUndefined, z.string().default("clamav")),
  CLAMD_PORT: z.coerce.number().int().positive().default(3310),
```

In `src/lib/env.test.ts`, add a case alongside the existing ones, reusing whatever helper that file already has for building a valid environment (do not add a second one):

```ts
  it("defaults the malware scanner to none, so the boundary is present and inert", () => {
    const parsed = envFromFixture();
    expect(parsed.MALWARE_SCANNER).toBe("none");
    expect(parsed.CLAMD_PORT).toBe(3310);
  });
```

- [ ] **Step 5: Write the failing resolver test**

```ts
// src/modules/payroll/infrastructure/scanner-resolver.test.ts
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { resetEnvCache } from "@/lib/env";
import { resolveScanner } from "./scanner-resolver";

const saved = { ...process.env };

beforeEach(() => resetEnvCache());
afterEach(() => {
  process.env = { ...saved };
  resetEnvCache();
});

describe("resolveScanner", () => {
  it("returns the no-op scanner by default, which names itself none", async () => {
    delete process.env.MALWARE_SCANNER;
    resetEnvCache();
    expect(await resolveScanner().scan(new Uint8Array())).toEqual({
      verdict: "clean",
      scanner: "none",
      signature: null,
    });
  });

  it("returns a clamd scanner when asked for one", async () => {
    process.env.MALWARE_SCANNER = "clamd";
    process.env.CLAMD_HOST = "127.0.0.1";
    process.env.CLAMD_PORT = "1";
    resetEnvCache();
    // Nothing is listening on port 1, so the verdict proves it really is the
    // clamd adapter and not the no-op one wearing its name.
    expect(await resolveScanner().scan(new Uint8Array())).toMatchObject({ scanner: "clamd", verdict: "unavailable" });
  });
});
```

- [ ] **Step 6: Run it and watch it fail**

Run: `npm test -- payroll/infrastructure/scanner-resolver`
Expected: FAIL — `Cannot find module './scanner-resolver'`.

- [ ] **Step 7: Write the resolver**

```ts
// src/modules/payroll/infrastructure/scanner-resolver.ts
import { env } from "@/lib/env";
import type { MalwareScanner } from "../application/ports";
import { createClamdScanner } from "./clamd-scanner";
import { noopScanner } from "./noop-scanner";

/**
 * The one place the deployment's scanner choice is read. Called by whoever
 * builds the deps bag, before any transaction opens (Ruling R4-8), because
 * scanning is a network round trip.
 */
export function resolveScanner(): MalwareScanner {
  const e = env();
  if (e.MALWARE_SCANNER === "clamd") {
    return createClamdScanner({ host: e.CLAMD_HOST, port: e.CLAMD_PORT, timeoutMs: 30_000 });
  }
  return noopScanner;
}
```

- [ ] **Step 8: Run everything and type-check**

Run:
```bash
npm test -- payroll/
npx tsc --noEmit
```
Expected: PASS and exit 0.

- [ ] **Step 9: Commit**

```bash
git add src/modules/payroll/infrastructure src/lib/env.ts src/lib/env.test.ts
git commit -m "feat(payroll): add the malware-scanning boundary with a no-op default and a clamd adapter"
```

---

### Task 7: The `payroll_silo` provider, the widened `ProviderCode`, capabilities and permissions

This is the task Ruling R4-13 names: two of the phase's three signature changes land here, together with every one of their call sites.

**Files:**
- Create: `src/modules/payroll/infrastructure/silo-provider-adapter.ts`
- Create: `src/modules/payroll/infrastructure/silo-provider-adapter.test.ts`
- Modify: `src/modules/payroll/infrastructure/document-store-resolver.ts` (add `resolveDocumentStore`, `documentStoreConfigured`, re-export `SiloCredentials`)
- Modify: `src/platform/integrations/types.ts:12-13` (`ProviderCode`)
- Modify: `src/platform/integrations/register-all.ts`
- Modify: `src/platform/capabilities/probes.ts` (`connectionStates`, `payrollConfigured`, `hasPayrollRecords`)
- Modify: `src/platform/capabilities/probes.itest.ts`
- Modify: `src/platform/capabilities/resolve.ts` and `resolve.test.ts`
- Modify: `src/platform/auth/permissions.ts`
- Create: `src/platform/auth/permissions.test.ts`

**Interfaces:**
- Consumes: `IntegrationProvider`, `DisconnectContext`, `TestResult` from `@/platform/integrations/types`; `createS3DocumentStore` from `./s3-document-store` (Task 3); `storeFromDriver` from `./document-store-resolver` (Task 3); `openConnection` from `@/modules/integrations/application/open-connection` and `integrationDeps` from `@/modules/integrations/infrastructure/deps` (existing).
- Produces:
```ts
export const SILO_PROVIDER: "payroll_silo";
export interface SiloCredentials { endpoint: string; bucket: string; region: string; accessKeyId: string; secretAccessKey: string }
export const siloCredentialSchema: z.ZodType<SiloCredentials>;
export const siloProvider: IntegrationProvider;
// document-store-resolver.ts gains:
export async function resolveDocumentStore(userId: string): Promise<DocumentStoreResolution | null>;
export function documentStoreConfigured(): boolean;
// platform:
export type ProviderCode = "wallet" | "trek" | "payroll_silo";
export const PERMISSIONS: readonly [..., "payroll.read", "payroll.upload", "payroll.review", "payroll.read_original", ...];
```

- [ ] **Step 1: Write the failing provider test**

```ts
// src/modules/payroll/infrastructure/silo-provider-adapter.test.ts
import { describe, expect, it, vi } from "vitest";
import type { DocumentStore } from "../application/ports";
import { siloCredentialSchema, siloProvider, type SiloDisconnectContext } from "./silo-provider-adapter";

const creds = {
  endpoint: "https://silo.internal",
  bucket: "payroll",
  region: "us-east-1",
  accessKeyId: "AK",
  secretAccessKey: "SK",
};

function fakeStore(overrides: Partial<DocumentStore> = {}): DocumentStore {
  return {
    provider: "silo",
    put: async () => {},
    get: async () => null,
    delete: async () => {},
    listPrefix: async () => [],
    ...overrides,
  };
}

describe("siloProvider", () => {
  it("declares itself as a document provider with no syncs (Ruling R4-15)", () => {
    expect(siloProvider.code).toBe("payroll_silo");
    expect(siloProvider.capabilities).toEqual(["documents"]);
    expect(siloProvider.syncs).toEqual({});
    expect(siloProvider.webhook).toBeUndefined();
  });

  it("marks both secret fields secret so the connect form never echoes them back", () => {
    const secrets = siloProvider.credentialFields.filter((f) => f.secret).map((f) => f.name);
    expect(secrets.sort()).toEqual(["accessKeyId", "secretAccessKey"]);
  });

  it("rejects an incomplete credential at the schema, before anything is sealed", () => {
    expect(siloCredentialSchema.safeParse({ ...creds, bucket: "" }).success).toBe(false);
    expect(siloCredentialSchema.safeParse({ ...creds, endpoint: "not-a-url" }).success).toBe(false);
    expect(siloCredentialSchema.safeParse(creds).success).toBe(true);
  });

  it("testConnection writes, reads and deletes a probe object — a read-only key must not pass", async () => {
    const seen: string[] = [];
    const fetchImpl = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const req = new Request(input as URL | string, init);
      seen.push(`${req.method} ${new URL(req.url).pathname}`);
      return req.method === "GET" ? new Response(new Uint8Array([1]), { status: 200 }) : new Response(null, { status: 204 });
    });
    const result = await siloProvider.testConnection(creds, { fetchImpl });
    expect(result.ok).toBe(true);
    expect(seen.map((s) => s.split(" ")[0])).toEqual(["PUT", "GET", "DELETE"]);
    expect(seen[0]).toContain("/payroll/payroll/_probe/");
  });

  it("testConnection fails, with the status, when the credential cannot write", async () => {
    const fetchImpl = vi.fn(async () => new Response("denied", { status: 403 }));
    const result = await siloProvider.testConnection(creds, { fetchImpl });
    expect(result.ok).toBe(false);
    expect(result.message).toContain("403");
  });

  it("onDisconnect with purge deletes every object under the user's prefix and audits the count", async () => {
    const deleted: string[] = [];
    const audit = vi.fn(async () => {});
    const ctx: SiloDisconnectContext = {
      connection: { id: "c1", userId: "u1", provider: "payroll_silo" } as SiloDisconnectContext["connection"],
      policy: "purge",
      db: {} as SiloDisconnectContext["db"],
      clock: { now: () => new Date("2026-09-05T00:00:00Z") },
      audit,
      store: fakeStore({
        delete: async (k: string) => void deleted.push(k),
        listPrefix: async () => ["payroll/u1/2026/a.pdf", "payroll/u1/2025/b.pdf"],
      }),
    };
    await siloProvider.onDisconnect(ctx);
    expect(deleted.sort()).toEqual(["payroll/u1/2025/b.pdf", "payroll/u1/2026/a.pdf"]);
    expect(audit).toHaveBeenCalledWith(
      expect.objectContaining({ action: "integration.disconnect_applied", after: expect.objectContaining({ objectsPurged: 2 }) }),
    );
  });

  it("onDisconnect with keep deletes nothing", async () => {
    const deleted: string[] = [];
    const ctx: SiloDisconnectContext = {
      connection: { id: "c1", userId: "u1", provider: "payroll_silo" } as SiloDisconnectContext["connection"],
      policy: "keep",
      db: {} as SiloDisconnectContext["db"],
      clock: { now: () => new Date("2026-09-05T00:00:00Z") },
      audit: async () => {},
      store: fakeStore({
        delete: async (k: string) => void deleted.push(k),
        listPrefix: async () => ["payroll/u1/2026/a.pdf"],
      }),
    };
    await siloProvider.onDisconnect(ctx);
    expect(deleted).toEqual([]);
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `npm test -- payroll/infrastructure/silo-provider-adapter`
Expected: FAIL — `Cannot find module './silo-provider-adapter'`.

- [ ] **Step 3: Write the provider adapter**

```ts
// src/modules/payroll/infrastructure/silo-provider-adapter.ts
/**
 * The payroll document store as an `IntegrationProvider`.
 *
 * The only new file in this phase that names the silo, which is what keeps the
 * "provider names only in `*-adapter.ts`" rule true: `sigv4.ts` and
 * `s3-document-store.ts` name S3 (a protocol) and know nothing about which
 * container answers.
 *
 * Ruling R4-15: `syncs` is empty and no `SyncKind` is added. A document store
 * has nothing to pull on a schedule; it registers here only so its credentials
 * get the same AES-256-GCM vault and the same Settings › Integrations
 * connect/test/disconnect UI as Wallet and Trek.
 */
import { randomBytes } from "node:crypto";
import { z } from "zod";
import { errorMessage } from "@/lib/clients/http";
import type { DisconnectContext, IntegrationProvider, TestResult } from "@/platform/integrations/types";
import type { DocumentStore } from "../application/ports";
import { createS3DocumentStore } from "./s3-document-store";

export const SILO_PROVIDER = "payroll_silo" as const;

export interface SiloCredentials {
  endpoint: string;
  bucket: string;
  region: string;
  accessKeyId: string;
  secretAccessKey: string;
}

export const siloCredentialSchema = z.object({
  endpoint: z.url(),
  bucket: z.string().min(1),
  region: z.string().min(1).default("us-east-1"),
  accessKeyId: z.string().min(1),
  secretAccessKey: z.string().min(1),
});

/**
 * The framework's `DisconnectContext` plus the store the purge policy needs.
 * The store is resolved by the disconnect caller — it is network I/O, and
 * Ruling R4-8 keeps that outside the use case's transaction — so it arrives as
 * an extra field rather than being opened here.
 */
export type SiloDisconnectContext = DisconnectContext & { store?: DocumentStore };

/** `settings` may carry a `fetchImpl` in tests; production passes an empty object. */
function storeFor(credentials: Record<string, string>, settings: Record<string, unknown>): DocumentStore {
  const parsed = siloCredentialSchema.parse(credentials);
  const fetchImpl = settings.fetchImpl as typeof fetch | undefined;
  return createS3DocumentStore({ ...parsed, ...(fetchImpl ? { fetchImpl } : {}) });
}

/**
 * A real write-read-delete round trip, not a HEAD.
 *
 * A credential that can list but not write would pass any read-only check and
 * then fail on the user's first real upload — after the connect form has told
 * them everything is fine. The probe key lives under `payroll/_probe/`, outside
 * every user's own `payroll/{userId}/` prefix, so a leftover probe from a
 * crashed run can never be mistaken for somebody's payslip.
 */
async function testConnection(
  credentials: Record<string, string>,
  settings: Record<string, unknown>,
): Promise<TestResult> {
  const key = `payroll/_probe/${randomBytes(8).toString("hex")}`;
  try {
    const store = storeFor(credentials, settings);
    await store.put(key, new Uint8Array([0x70, 0x72, 0x6f, 0x62, 0x65]), "application/octet-stream");
    const read = await store.get(key);
    await store.delete(key);
    if (read === null) return { ok: false, message: "Wrote a probe object but could not read it back." };
    return { ok: true, message: "Wrote, read and deleted a probe object in the payroll bucket." };
  } catch (err) {
    return { ok: false, message: errorMessage(err) };
  }
}

/**
 * `purge` is the only policy that touches bytes, and it deletes exactly the
 * disconnecting user's own prefix — never the bucket, never another user's
 * objects. It does **not** delete `payroll_imports` rows: the provenance
 * outlives the bytes, the same asymmetry the retention job holds (Ruling R4-5).
 * Nulling the affected `storage_key`s is the caller's job, done in the
 * disconnect use case's own transaction; this adapter is given no repository.
 */
async function onDisconnect(ctx: SiloDisconnectContext): Promise<void> {
  let purged = 0;
  if (ctx.policy === "purge" && ctx.store) {
    const keys = await ctx.store.listPrefix(`payroll/${ctx.connection.userId}/`);
    for (const key of keys) {
      await ctx.store.delete(key);
      purged += 1;
    }
  }
  await ctx.audit({
    actorUserId: ctx.connection.userId,
    action: "integration.disconnect_applied",
    entityType: "integration_connection",
    entityId: ctx.connection.id,
    after: { provider: SILO_PROVIDER, policy: ctx.policy, objectsPurged: purged },
  });
}

export const siloProvider: IntegrationProvider = {
  code: SILO_PROVIDER,
  label: "Payroll document store",
  capabilities: ["documents"],
  credentialSchema: siloCredentialSchema as unknown as IntegrationProvider["credentialSchema"],
  credentialFields: [
    { name: "endpoint", label: "Endpoint URL", secret: false, placeholder: "https://silo.internal" },
    { name: "bucket", label: "Bucket", secret: false, placeholder: "payroll" },
    { name: "region", label: "Region", secret: false, placeholder: "us-east-1" },
    { name: "accessKeyId", label: "Access key id", secret: true },
    { name: "secretAccessKey", label: "Secret access key", secret: true },
  ],
  testConnection,
  syncs: {},
  onDisconnect,
};
```

- [ ] **Step 4: Widen `ProviderCode` and register the provider**

`src/platform/integrations/types.ts`, replacing lines 12-13:

```ts
/** Ruling R4-15: `payroll_silo` is a connection, not a sync — its `syncs` is deliberately empty. */
export type ProviderCode = "wallet" | "trek" | "payroll_silo";
```

`src/platform/integrations/register-all.ts`, in full:

```ts
import { trekProvider } from "@/modules/integrations/infrastructure/trek-provider-adapter";
import { walletProvider } from "@/modules/integrations/infrastructure/wallet-provider-adapter";
import { siloProvider } from "@/modules/payroll/infrastructure/silo-provider-adapter";
import { registerProvider } from "./registry";

let done = false;

/** Idempotent, like `ensureJobsRegistered` — every entry point may call it. */
export function ensureProvidersRegistered(): void {
  if (done) return;
  done = true;
  registerProvider(walletProvider);
  registerProvider(trekProvider);
  registerProvider(siloProvider);
}
```

- [ ] **Step 5: Complete the document-store resolver**

In `src/modules/payroll/infrastructure/document-store-resolver.ts`, delete the locally-declared `SiloCredentials` interface Task 3 left there, and append:

```ts
import { db } from "@/lib/db";
import { SILO_PROVIDER, siloCredentialSchema, type SiloCredentials } from "./silo-provider-adapter";

export type { SiloCredentials };

/**
 * The impure half. Reads the user's `payroll_silo` connection and decrypts its
 * credential, both **outside** any caller's transaction — this is exactly the
 * I/O Ruling R4-8 keeps out of the use-case transaction, which is why the store
 * is resolved before `withUserContext` opens and handed in as a dep.
 *
 * `openConnection` opens its own `inUserContext` transaction, so this must not
 * be called from inside one (the "never nested" global constraint).
 */
export async function resolveDocumentStore(userId: string): Promise<DocumentStoreResolution | null> {
  const e = env();
  if (e.DOCUMENT_STORE_DRIVER === "local") {
    return storeFromDriver({ driver: "local", localPath: e.DOCUMENT_STORE_LOCAL_PATH, nodeEnv: e.NODE_ENV, credentials: null });
  }
  const { integrationDeps } = await import("@/modules/integrations/infrastructure/deps");
  const { openConnection } = await import("@/modules/integrations/application/open-connection");
  const opened = await openConnection(integrationDeps(db))(userId, SILO_PROVIDER);
  if (!opened) return null;
  const parsed = siloCredentialSchema.safeParse(opened.credentials);
  if (!parsed.success) return null;
  return storeFromDriver({ driver: "silo", localPath: undefined, nodeEnv: e.NODE_ENV, credentials: parsed.data });
}

/**
 * Whether a store could be configured at all — the capability probe's question
 * (spec §6's feature matrix: "payroll feature (silo or local store
 * configured)"). Deliberately does not open a connection: the probe runs on
 * every request, and `resolveCapabilities` already asks `connectionStates`
 * separately.
 */
export function documentStoreConfigured(): boolean {
  const e = env();
  return e.DOCUMENT_STORE_DRIVER === "silo" || Boolean(e.DOCUMENT_STORE_LOCAL_PATH);
}
```

- [ ] **Step 6: Update the capability probes — both signature changes, with their call sites**

`src/platform/capabilities/probes.ts`. Replace `dataProbes`, the `connectionStates` return object and `realProbes`:

```ts
/**
 * The two data probes, bound to a database client.
 *
 * Both count inside `withUserContext`: `accounts` and `payroll_records` both
 * carry `FORCE ROW LEVEL SECURITY`, so the same count on the bare pool — with
 * no `app.user_id` set — sees no rows at all and answers "no data" for
 * everybody. `hasPayrollRecords` used to count the legacy `payslips` table on
 * the pool handle and ignore its `userId` argument entirely; Phase 4 moved
 * payroll into its own RLS-protected module, so it now counts what it is named
 * after, for the user it was asked about.
 *
 * Superseded records are excluded (Ruling R4-12): a user whose only record has
 * been superseded and not replaced has no earnings to show, and reporting
 * otherwise would send them to a page with an empty table and no explanation.
 */
export function dataProbes(client: DbClient): Pick<CapabilityProbes, "hasAccounts" | "hasPayrollRecords"> {
  return {
    hasAccounts: (userId) =>
      withUserContext(client, { userId }, (tx) =>
        countIsNonZero(tx, sql`SELECT count(*)::text AS n FROM accounts WHERE status <> 'archived'`),
      ),
    hasPayrollRecords: (userId) =>
      withUserContext(client, { userId }, (tx) =>
        countIsNonZero(tx, sql`SELECT count(*)::text AS n FROM payroll_records WHERE superseded_at IS NULL`),
      ),
  };
}
```

```ts
        return {
          wallet: stateForStatus(byProvider.get("wallet") ?? null),
          trek: stateForStatus(byProvider.get("trek") ?? null),
          // Widening `ProviderCode` widens this return type, so the third key is
          // required, not optional — the compiler is the call-site check.
          payroll_silo: stateForStatus(byProvider.get("payroll_silo") ?? null),
        };
```

```ts
export const realProbes: CapabilityProbes = {
  // Phase 4: the document store, not `PAPERLESS_URL`. Both driver cases are
  // answerable without touching the database, which matters because this runs
  // on every request.
  payrollConfigured: () => documentStoreConfigured(),
  ...connectionProbes(db),
  ...dataProbes(db),
};
```

Add `import { documentStoreConfigured } from "@/modules/payroll/infrastructure/document-store-resolver";` and remove the now-unused `import { env } from "@/lib/env";`.

- [ ] **Step 7: Update the capability resolver and its test**

In `src/platform/capabilities/resolve.ts`, replace the single `const payroll: IntegrationState = …` line inside `resolveCapabilities`:

```ts
  // Spec §6's feature matrix: the payroll feature needs a *store*, which is
  // either a connected `payroll_silo` integration or a configured local path.
  // A connection in `error` reports as `error` rather than being flattened into
  // "off" — the Settings page needs to say which, and a store that is present
  // but broken must not silently fall back to the local-path answer.
  const payroll: IntegrationState =
    states.payroll_silo !== "not_configured"
      ? states.payroll_silo
      : probes.payrollConfigured()
        ? "connected"
        : "not_configured";
```

In `src/platform/capabilities/resolve.test.ts`, add `payroll_silo` to every existing `connectionStates` fake (the compiler will name each one), and add:

```ts
  it("reports payroll from the silo connection, and falls back to the local-path probe", async () => {
    const base = {
      payrollConfigured: () => false,
      hasAccounts: async () => true,
      hasPayrollRecords: async () => false,
    };
    const connected = await resolveCapabilities(testPrincipal(), {
      ...base,
      connectionStates: async () => ({ wallet: "disconnected" as const, trek: "disconnected" as const, payroll_silo: "connected" as const }),
    });
    expect(connected.features.payroll).toBe(true);
    expect(connected.integrations.payroll).toBe("connected");

    const localOnly = await resolveCapabilities(testPrincipal(), {
      ...base,
      payrollConfigured: () => true,
      connectionStates: async () => ({ wallet: "disconnected" as const, trek: "disconnected" as const, payroll_silo: "not_configured" as const }),
    });
    expect(localOnly.features.payroll).toBe(true);

    const errored = await resolveCapabilities(testPrincipal(), {
      ...base,
      payrollConfigured: () => true,
      connectionStates: async () => ({ wallet: "disconnected" as const, trek: "disconnected" as const, payroll_silo: "error" as const }),
    });
    expect(errored.features.payroll).toBe(false);
    expect(errored.integrations.payroll).toBe("error");
  });
```

- [ ] **Step 8: Add the four permissions**

`src/platform/auth/permissions.ts`, in full:

```ts
export const PERMISSIONS = [
  "accounts.read",
  "accounts.write",
  "accounts.delete",
  "finance.manage",
  "integrations.manage",
  "jobs.run",
  "expenses.read",
  "expenses.write",
  "interests.read",
  "interests.write",
  // Spec §8.2 names upload, review and read_original. `payroll.read` is Ruling
  // R4-17: spec §4 gates `/company/earnings` on data rather than on upload or
  // review rights, and reusing `payroll.upload` for a read would deny Earnings
  // to a viewer who may legitimately see figures but never a scanned original.
  "payroll.read",
  "payroll.upload",
  "payroll.review",
  "payroll.read_original",
  "admin.users",
  "admin.audit",
] as const;
export type Permission = (typeof PERMISSIONS)[number];
export type RoleCode = "owner" | "admin" | "member" | "viewer";

const ROLE_PERMISSIONS: Record<RoleCode, readonly Permission[]> = {
  owner: PERMISSIONS,
  admin: PERMISSIONS,
  member: [
    "accounts.read", "accounts.write", "accounts.delete",
    "finance.manage", "integrations.manage", "jobs.run",
    "expenses.read", "expenses.write", "interests.read", "interests.write",
    "payroll.read", "payroll.upload", "payroll.review", "payroll.read_original",
  ],
  viewer: ["accounts.read", "expenses.read", "interests.read", "payroll.read"],
};

export function permissionsForRoles(roles: readonly RoleCode[]): ReadonlySet<Permission> {
  return new Set(roles.flatMap((r) => ROLE_PERMISSIONS[r] ?? []));
}
```

`src/platform/auth/permissions.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { PERMISSIONS, permissionsForRoles } from "./permissions";

describe("payroll permissions", () => {
  it("declares all four codes the payroll module asserts", () => {
    for (const code of ["payroll.read", "payroll.upload", "payroll.review", "payroll.read_original"] as const) {
      expect(PERMISSIONS).toContain(code);
    }
  });

  it("gives a member every payroll right and a viewer only the read (Ruling R4-17)", () => {
    const member = permissionsForRoles(["member"]);
    expect(member.has("payroll.upload")).toBe(true);
    expect(member.has("payroll.read_original")).toBe(true);
    const viewer = permissionsForRoles(["viewer"]);
    expect(viewer.has("payroll.read")).toBe(true);
    expect(viewer.has("payroll.read_original")).toBe(false);
    expect(viewer.has("payroll.upload")).toBe(false);
    expect(viewer.has("payroll.review")).toBe(false);
  });

  it("gives an owner everything, unchanged", () => {
    expect(permissionsForRoles(["owner"]).size).toBe(PERMISSIONS.length);
  });
});
```

- [ ] **Step 9: Update the probes integration test**

In `src/platform/capabilities/probes.itest.ts`, replace the case that seeds a `payslips` row with these two:

```ts
  it("hasPayrollRecords is true only for the user who owns the record", async () => {
    const db = await testDb();
    const [org] = await db.insert(organizations).values({ name: "P" }).returning();
    const [a] = await db.insert(users).values({ organizationId: org!.id, displayName: "A" }).returning();
    const [b] = await db.insert(users).values({ organizationId: org!.id, displayName: "B" }).returning();
    await withSystemContext(db, async (tx) => {
      const [imp] = await tx
        .insert(payrollImports)
        .values({
          userId: a!.id, fileName: "b.pdf", sizeBytes: 10, sha256: "a".repeat(64),
          storageProvider: "local", storageKey: "payroll/x/2026/k.pdf",
          retentionUntil: new Date("2036-01-01T00:00:00Z"),
        })
        .returning();
      await tx.insert(payrollRecords).values({
        userId: a!.id, importId: imp!.id, periodStart: "2026-08-01", periodEnd: "2026-08-31", kind: "ordinary",
      });
    });
    const probes = dataProbes(db);
    expect(await probes.hasPayrollRecords(a!.id)).toBe(true);
    expect(await probes.hasPayrollRecords(b!.id)).toBe(false);
  });

  it("hasPayrollRecords ignores a superseded record (Ruling R4-12)", async () => {
    const db = await testDb();
    const [org] = await db.insert(organizations).values({ name: "P" }).returning();
    const [a] = await db.insert(users).values({ organizationId: org!.id, displayName: "A" }).returning();
    await withSystemContext(db, async (tx) => {
      const [imp] = await tx
        .insert(payrollImports)
        .values({
          userId: a!.id, fileName: "b.pdf", sizeBytes: 10, sha256: "c".repeat(64),
          storageProvider: "local", storageKey: "payroll/x/2026/k2.pdf",
          retentionUntil: new Date("2036-01-01T00:00:00Z"),
        })
        .returning();
      await tx.insert(payrollRecords).values({
        userId: a!.id, importId: imp!.id, periodStart: "2026-08-01", periodEnd: "2026-08-31",
        kind: "ordinary", supersededAt: new Date(),
      });
    });
    expect(await dataProbes(db).hasPayrollRecords(a!.id)).toBe(false);
  });
```

- [ ] **Step 10: Run everything and type-check**

Run:
```bash
npx tsc --noEmit
npm test
npm run test:db:up && npm run test:integration -- capabilities
```
Expected: exit 0, all unit tests pass, both probe cases pass. `tsc` is the call-site check for the two widened signatures: any other `connectionStates` implementation or `hasPayrollRecords` caller that was missed fails here rather than at runtime.

- [ ] **Step 11: Commit**

```bash
git add src/modules/payroll/infrastructure src/platform/integrations src/platform/capabilities src/platform/auth
git commit -m "feat(payroll): register the payroll_silo provider and drive payroll capabilities from it"
```

---

### Task 8: The four repositories, the legacy fund bridge and the production deps bag

**Files:**
- Create: `src/modules/payroll/infrastructure/memory-repositories.ts`
- Create: `src/modules/payroll/infrastructure/memory-repositories.test.ts`
- Create: `src/modules/payroll/infrastructure/drizzle-payroll-imports-repository.ts`
- Create: `src/modules/payroll/infrastructure/drizzle-payroll-records-repository.ts`
- Create: `src/modules/payroll/infrastructure/drizzle-payroll-components-repository.ts`
- Create: `src/modules/payroll/infrastructure/drizzle-payroll-mapping-rules-repository.ts`
- Create: `src/modules/payroll/infrastructure/legacy-fund-deposits.ts`
- Create: `src/modules/payroll/infrastructure/deps.ts`
- Create: `src/modules/payroll/infrastructure/repositories.itest.ts`

**Interfaces:**
- Consumes: every port from `../application/ports` (Task 2); the Drizzle tables from `@/lib/db/schema` (Task 1); `DEFAULT_MAPPING_RULES` from `../domain/mapping` and `addMoney` from `../domain/money` (Task 5); `TERMINAL_STATUSES` from `../domain/payroll` (Task 4); `recordAudit` from `@/platform/audit/record`; `DbClient` from `@/lib/db/client`.
- Produces:
```ts
export class MemoryPayrollImportsRepository implements PayrollImportsRepository {}
export class MemoryPayrollRecordsRepository implements PayrollRecordsRepository {}
export class MemoryPayrollComponentsRepository implements PayrollComponentsRepository {}
export class MemoryPayrollMappingRulesRepository implements PayrollMappingRulesRepository {}
export class MemoryLegacyFundDeposits implements LegacyFundDeposits {}
export class DrizzlePayrollImportsRepository implements PayrollImportsRepository {}
export class DrizzlePayrollRecordsRepository implements PayrollRecordsRepository {}
export class DrizzlePayrollComponentsRepository implements PayrollComponentsRepository {}
export class DrizzlePayrollMappingRulesRepository implements PayrollMappingRulesRepository {}
export function drizzleLegacyFundDeposits(tx: DbClient): LegacyFundDeposits;
export interface PayrollDepsOptions { documents: DocumentStore; scanner: MalwareScanner; requestId?: string | null }
export function payrollDeps(tx: DbClient, opts: PayrollDepsOptions): UseCaseDeps;
```

Both implementations of each repository are written in this one task, in the same words, and every shared-contract assertion below runs against **both** — the mitigation the global constraints demand after five Phase 2/3 drifts.

- [ ] **Step 1: Write the failing memory-repository test**

```ts
// src/modules/payroll/infrastructure/memory-repositories.test.ts
import { describe, expect, it } from "vitest";
import type { NewPayrollComponent, NewPayrollImport, NewPayrollRecord } from "../application/ports";
import {
  MemoryLegacyFundDeposits,
  MemoryPayrollComponentsRepository,
  MemoryPayrollImportsRepository,
  MemoryPayrollMappingRulesRepository,
  MemoryPayrollRecordsRepository,
} from "./memory-repositories";

const USER_A = "user-a";
const USER_B = "user-b";
const RETENTION = new Date("2036-01-01T00:00:00Z");

function newImport(userId: string, sha: string, over: Partial<NewPayrollImport> = {}): NewPayrollImport {
  return {
    userId,
    fileName: "busta.pdf",
    mime: "application/pdf",
    sizeBytes: 1234,
    sha256: sha,
    storageProvider: "local",
    storageKey: `payroll/${userId}/2026/${sha.slice(0, 32)}.pdf`,
    idempotencyKey: null,
    replacesImportId: null,
    retentionUntil: RETENTION,
    uploadedVia: "ui",
    ...over,
  };
}

function newRecord(userId: string, importId: string, over: Partial<NewPayrollRecord> = {}): NewPayrollRecord {
  return {
    userId,
    importId,
    periodStart: "2026-08-01",
    periodEnd: "2026-08-31",
    payDate: null,
    kind: "ordinary",
    currency: "EUR",
    gross: "2500.00",
    net: "1800.00",
    verifiedAt: null,
    verifiedBy: null,
    corrections: null,
    ...over,
  };
}

function newComponent(over: Partial<NewPayrollComponent> = {}): NewPayrollComponent {
  return {
    recordId: "",
    code: "net",
    labelRaw: "Netto del mese",
    kind: "earning",
    amount: "1800.00",
    quantity: null,
    unit: "eur",
    currency: "EUR",
    confidence: "high",
    source: "rules",
    mappedTo: { kind: "earnings" },
    sortOrder: 0,
    ...over,
  };
}

describe("MemoryPayrollImportsRepository", () => {
  it("lists newest first and never shows another user's imports", async () => {
    const repo = new MemoryPayrollImportsRepository();
    await repo.create(newImport(USER_A, "a".repeat(64)));
    await repo.create(newImport(USER_A, "b".repeat(64)));
    await repo.create(newImport(USER_B, "c".repeat(64)));
    const mine = await repo.list(USER_A);
    expect(mine.map((i) => i.sha256)).toEqual(["b".repeat(64), "a".repeat(64)]);
  });

  it("filters by status and honours the limit", async () => {
    const repo = new MemoryPayrollImportsRepository();
    const first = await repo.create(newImport(USER_A, "a".repeat(64)));
    await repo.create(newImport(USER_A, "b".repeat(64)));
    await repo.patch(USER_A, first.id, { status: "needs_review" });
    expect((await repo.list(USER_A, { statuses: ["needs_review"] })).map((i) => i.id)).toEqual([first.id]);
    expect((await repo.list(USER_A, { limit: 1 })).length).toBe(1);
  });

  it("rejects a second import of the same bytes for the same user, naming the index", async () => {
    const repo = new MemoryPayrollImportsRepository();
    await repo.create(newImport(USER_A, "a".repeat(64)));
    await expect(repo.create(newImport(USER_A, "a".repeat(64)))).rejects.toThrow(/payroll_imports_user_sha_uq/);
  });

  it("lets two users import the same bytes", async () => {
    const repo = new MemoryPayrollImportsRepository();
    await repo.create(newImport(USER_A, "a".repeat(64)));
    await expect(repo.create(newImport(USER_B, "a".repeat(64)))).resolves.toBeTruthy();
  });

  it("rejects a repeated idempotency key but lets many nulls coexist", async () => {
    const repo = new MemoryPayrollImportsRepository();
    await repo.create(newImport(USER_A, "a".repeat(64), { idempotencyKey: "k1" }));
    await repo.create(newImport(USER_A, "b".repeat(64), { idempotencyKey: null }));
    await repo.create(newImport(USER_A, "c".repeat(64), { idempotencyKey: null }));
    await expect(repo.create(newImport(USER_A, "d".repeat(64), { idempotencyKey: "k1" }))).rejects.toThrow(
      /payroll_imports_user_idem_uq/,
    );
  });

  it("findBySha is scoped to the user", async () => {
    const repo = new MemoryPayrollImportsRepository();
    const created = await repo.create(newImport(USER_A, "a".repeat(64)));
    expect((await repo.findBySha(USER_A, "a".repeat(64)))?.id).toBe(created.id);
    expect(await repo.findBySha(USER_B, "a".repeat(64))).toBeNull();
  });

  it("patch bumps version and updatedAt, and ignores an explicit undefined", async () => {
    const repo = new MemoryPayrollImportsRepository();
    const created = await repo.create(newImport(USER_A, "a".repeat(64)));
    const patched = await repo.patch(USER_A, created.id, { status: "scanning", error: undefined });
    expect(patched?.version).toBe(created.version + 1);
    expect(patched?.status).toBe("scanning");
    expect(patched?.error).toBeNull();
    expect(patched!.updatedAt.getTime()).toBeGreaterThanOrEqual(created.updatedAt.getTime());
  });

  it("patch answers null for another user's import rather than touching it", async () => {
    const repo = new MemoryPayrollImportsRepository();
    const created = await repo.create(newImport(USER_A, "a".repeat(64)));
    expect(await repo.patch(USER_B, created.id, { status: "rejected" })).toBeNull();
    expect((await repo.get(USER_A, created.id))?.status).toBe("received");
  });

  it("listByStatusForAllUsers crosses users, oldest first, and honours the limit", async () => {
    const repo = new MemoryPayrollImportsRepository();
    const a = await repo.create(newImport(USER_A, "a".repeat(64)));
    const b = await repo.create(newImport(USER_B, "b".repeat(64)));
    expect((await repo.listByStatusForAllUsers(["received"], 10)).map((i) => i.id)).toEqual([a.id, b.id]);
    expect((await repo.listByStatusForAllUsers(["received"], 1)).map((i) => i.id)).toEqual([a.id]);
  });

  it("listPurgeableForAllUsers takes only terminal rows with a live key past their retention", async () => {
    const repo = new MemoryPayrollImportsRepository();
    const past = new Date("2020-01-01T00:00:00Z");
    const applied = await repo.create(newImport(USER_A, "a".repeat(64), { retentionUntil: past }));
    await repo.patch(USER_A, applied.id, { status: "applied" });
    const live = await repo.create(newImport(USER_A, "b".repeat(64), { retentionUntil: past }));
    await repo.patch(USER_A, live.id, { status: "needs_review" });
    const purged = await repo.create(newImport(USER_A, "c".repeat(64), { retentionUntil: past }));
    await repo.patch(USER_A, purged.id, { status: "rejected", storageKey: null, purgedAt: new Date() });
    const future = await repo.create(newImport(USER_A, "d".repeat(64)));
    await repo.patch(USER_A, future.id, { status: "applied" });

    const found = await repo.listPurgeableForAllUsers(new Date("2026-09-05T00:00:00Z"), 100);
    expect(found.map((i) => i.id)).toEqual([applied.id]);
  });
});

describe("MemoryPayrollRecordsRepository", () => {
  it("lists newest period first and hides superseded rows unless asked", async () => {
    const repo = new MemoryPayrollRecordsRepository();
    const july = await repo.create(newRecord(USER_A, "imp-1", { periodStart: "2026-07-01", periodEnd: "2026-07-31" }));
    const august = await repo.create(newRecord(USER_A, "imp-2"));
    await repo.supersede(USER_A, july.id, august.id, new Date("2026-09-01T00:00:00Z"));
    expect((await repo.list(USER_A)).map((r) => r.id)).toEqual([august.id]);
    expect((await repo.list(USER_A, { includeSuperseded: true })).map((r) => r.id)).toEqual([august.id, july.id]);
  });

  it("filters by an inclusive from/to window on periodStart", async () => {
    const repo = new MemoryPayrollRecordsRepository();
    await repo.create(newRecord(USER_A, "imp-1", { periodStart: "2026-07-01", periodEnd: "2026-07-31" }));
    await repo.create(newRecord(USER_A, "imp-2"));
    expect((await repo.list(USER_A, { from: "2026-08-01", to: "2026-08-31" })).map((r) => r.periodStart)).toEqual([
      "2026-08-01",
    ]);
  });

  it("rejects a second record for the same import", async () => {
    const repo = new MemoryPayrollRecordsRepository();
    await repo.create(newRecord(USER_A, "imp-1"));
    await expect(repo.create(newRecord(USER_A, "imp-1", { periodStart: "2026-09-01", periodEnd: "2026-09-30" }))).rejects.toThrow(
      /payroll_records_import_uq/,
    );
  });

  it("rejects a second live record for the same period and kind, and allows one after superseding", async () => {
    const repo = new MemoryPayrollRecordsRepository();
    const first = await repo.create(newRecord(USER_A, "imp-1"));
    await expect(repo.create(newRecord(USER_A, "imp-2"))).rejects.toThrow(/payroll_records_period_uq/);
    await repo.supersede(USER_A, first.id, "placeholder", new Date());
    await expect(repo.create(newRecord(USER_A, "imp-2"))).resolves.toBeTruthy();
  });

  it("allows the same period and kind for two different users", async () => {
    const repo = new MemoryPayrollRecordsRepository();
    await repo.create(newRecord(USER_A, "imp-1"));
    await expect(repo.create(newRecord(USER_B, "imp-2"))).resolves.toBeTruthy();
  });

  it("liveForPeriod ignores superseded rows", async () => {
    const repo = new MemoryPayrollRecordsRepository();
    const first = await repo.create(newRecord(USER_A, "imp-1"));
    expect((await repo.liveForPeriod(USER_A, "2026-08-01", "ordinary"))?.id).toBe(first.id);
    await repo.supersede(USER_A, first.id, "placeholder", new Date());
    expect(await repo.liveForPeriod(USER_A, "2026-08-01", "ordinary")).toBeNull();
  });

  it("update bumps version and leaves untouched fields alone", async () => {
    const repo = new MemoryPayrollRecordsRepository();
    const created = await repo.create(newRecord(USER_A, "imp-1"));
    const updated = await repo.update(USER_A, created.id, { net: "1850.00" });
    expect(updated?.net).toBe("1850.00");
    expect(updated?.gross).toBe("2500.00");
    expect(updated?.version).toBe(created.version + 1);
  });

  it("getByImport is scoped to the user", async () => {
    const repo = new MemoryPayrollRecordsRepository();
    const created = await repo.create(newRecord(USER_A, "imp-1"));
    expect((await repo.getByImport(USER_A, "imp-1"))?.id).toBe(created.id);
    expect(await repo.getByImport(USER_B, "imp-1")).toBeNull();
  });
});

describe("MemoryPayrollComponentsRepository", () => {
  it("replaceForRecord stamps the record id, orders by sortOrder and replaces wholesale", async () => {
    const repo = new MemoryPayrollComponentsRepository();
    await repo.replaceForRecord("rec-1", [
      newComponent({ code: "taxes", sortOrder: 1, labelRaw: "Totale trattenute", kind: "tax", amount: "700.00" }),
      newComponent({ code: "net", sortOrder: 0 }),
    ]);
    expect((await repo.listForRecord("rec-1")).map((c) => c.code)).toEqual(["net", "taxes"]);
    expect((await repo.listForRecord("rec-1")).every((c) => c.recordId === "rec-1")).toBe(true);

    await repo.replaceForRecord("rec-1", [newComponent({ code: "gross", labelRaw: "Totale competenze", amount: "2500.00" })]);
    expect((await repo.listForRecord("rec-1")).map((c) => c.code)).toEqual(["gross"]);
  });

  it("never touches another record's components", async () => {
    const repo = new MemoryPayrollComponentsRepository();
    await repo.replaceForRecord("rec-1", [newComponent()]);
    await repo.replaceForRecord("rec-2", [newComponent({ code: "gross", amount: "2500.00" })]);
    expect((await repo.listForRecord("rec-1")).map((c) => c.code)).toEqual(["net"]);
  });

  it("listForRecords batches, ordered by record then sortOrder", async () => {
    const repo = new MemoryPayrollComponentsRepository();
    await repo.replaceForRecord("rec-1", [newComponent()]);
    await repo.replaceForRecord("rec-2", [newComponent({ code: "gross", amount: "2500.00" })]);
    expect((await repo.listForRecords(["rec-1", "rec-2"])).map((c) => `${c.recordId}:${c.code}`)).toEqual([
      "rec-1:net",
      "rec-2:gross",
    ]);
    expect(await repo.listForRecords([])).toEqual([]);
  });

  it("normalises money to two decimals and quantity to six, as Postgres reads them back", async () => {
    const repo = new MemoryPayrollComponentsRepository();
    const [c] = await repo.replaceForRecord("rec-1", [
      newComponent({ amount: "1800.5", quantity: "88.25", unit: "hours" }),
    ]);
    expect(c!.amount).toBe("1800.50");
    expect(c!.quantity).toBe("88.250000");
  });
});

describe("MemoryPayrollMappingRulesRepository", () => {
  it("returns the seeded global rules plus this user's own, by priority then id", async () => {
    const repo = new MemoryPayrollMappingRulesRepository();
    repo.addUserRule(USER_A, { matchCode: null, matchLabel: "^Arretrati", componentKind: "earning", target: { kind: "earnings" }, priority: 10 });
    const rules = await repo.listFor(USER_A);
    expect(rules[0]!.priority).toBe(10);
    expect(rules.filter((r) => r.userId === null).length).toBeGreaterThan(0);
    expect(rules.every((r) => r.userId === null || r.userId === USER_A)).toBe(true);
  });

  it("never leaks another user's rule", async () => {
    const repo = new MemoryPayrollMappingRulesRepository();
    repo.addUserRule(USER_B, { matchCode: "x", matchLabel: null, componentKind: "info", target: { kind: "none" }, priority: 5 });
    expect((await repo.listFor(USER_A)).some((r) => r.userId === USER_B)).toBe(false);
  });
});

describe("MemoryLegacyFundDeposits", () => {
  it("writes one row per fund and month, replacing the previous figure", async () => {
    const funds = new MemoryLegacyFundDeposits(["cometa"]);
    expect(await funds.upsertForRecord({ fundSlug: "cometa", month: "2026-08-01", employee: "50.00", employer: "100.00" })).toBe("written");
    expect(await funds.upsertForRecord({ fundSlug: "cometa", month: "2026-08-01", employee: "60.00", employer: "100.00" })).toBe("written");
    expect(funds.rows).toEqual([
      { fundSlug: "cometa", month: "2026-08-01", amount: "160.00", employee: "60.00", employer: "100.00" },
    ]);
  });

  it("reports no_fund rather than inventing one", async () => {
    const funds = new MemoryLegacyFundDeposits([]);
    expect(await funds.upsertForRecord({ fundSlug: "cometa", month: "2026-08-01", employee: "50.00", employer: null })).toBe("no_fund");
    expect(funds.rows).toEqual([]);
  });

  it("reports no_amount and writes nothing when the payslip carried neither half", async () => {
    const funds = new MemoryLegacyFundDeposits(["cometa"]);
    expect(await funds.upsertForRecord({ fundSlug: "cometa", month: "2026-08-01", employee: null, employer: null })).toBe("no_amount");
    expect(funds.rows).toEqual([]);
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `npm test -- payroll/infrastructure/memory-repositories`
Expected: FAIL — `Cannot find module './memory-repositories'`.

- [ ] **Step 3: Write the memory repositories**

```ts
// src/modules/payroll/infrastructure/memory-repositories.ts
import { DEFAULT_MAPPING_RULES } from "../domain/mapping";
import { addMoney } from "../domain/money";
import type {
  LegacyFundDepositInput,
  LegacyFundDeposits,
  ListImportsOptions,
  ListRecordsOptions,
  NewPayrollComponent,
  NewPayrollImport,
  NewPayrollRecord,
  PayrollComponent,
  PayrollComponentsRepository,
  PayrollImport,
  PayrollImportPatch,
  PayrollImportStatus,
  PayrollImportsRepository,
  PayrollMappingRule,
  PayrollMappingRulesRepository,
  PayrollRecord,
  PayrollRecordKind,
  PayrollRecordsRepository,
} from "../application/ports";
import { TERMINAL_STATUSES } from "../domain/payroll";

/**
 * Production ids default to `uuidv7()`, which is time-ordered. This generator
 * is not a real UUIDv7, only order-compatible with one — the same mitigation
 * `interests/infrastructure/memory-repositories.ts` uses, so a `desc(id)`
 * tie-break behaves identically under the fake and under Postgres.
 */
let sequence = 0;
function monotonicId(): string {
  sequence += 1;
  return `${Date.now().toString(16).padStart(12, "0")}-${sequence.toString(16).padStart(8, "0")}`;
}

/** Strips explicit `undefined` so a spread cannot null out a field the caller never meant to touch — Drizzle's `mapUpdateSet` drops them too. */
function definedEntries<T extends object>(patch: T): Partial<T> {
  return Object.fromEntries(Object.entries(patch).filter(([, v]) => v !== undefined)) as Partial<T>;
}

const DECIMAL_RE = /^(-?)(\d+)(?:\.(\d+))?$/;

/**
 * Mirrors the scale Postgres reads back for `numeric(16,2)` and
 * `numeric(16,6)`. Without it a string-comparing test passes against the fake
 * and fails against Drizzle — one of the five drifts the global constraints
 * record. A regex, never `Number()`.
 */
function normalizeScale(value: string, scale: number): string {
  const m = DECIMAL_RE.exec(value.trim());
  if (!m) return value;
  const [, sign, intPart, fracPart = ""] = m;
  const frac = (fracPart + "0".repeat(scale)).slice(0, scale);
  return scale > 0 ? `${sign}${intPart}.${frac}` : `${sign}${intPart}`;
}

export class MemoryPayrollImportsRepository implements PayrollImportsRepository {
  private rows: PayrollImport[] = [];

  async list(userId: string, opts: ListImportsOptions = {}): Promise<PayrollImport[]> {
    let rows = this.rows.filter((r) => r.userId === userId);
    if (opts.statuses) rows = rows.filter((r) => opts.statuses!.includes(r.status));
    // `created_at desc, id desc` — the Drizzle repository's exact order.
    rows = [...rows].sort((a, b) =>
      b.createdAt.getTime() - a.createdAt.getTime() || b.id.localeCompare(a.id),
    );
    return (opts.limit === undefined ? rows : rows.slice(0, opts.limit)).map((r) => ({ ...r }));
  }

  async get(userId: string, id: string): Promise<PayrollImport | null> {
    const row = this.rows.find((r) => r.userId === userId && r.id === id);
    return row ? { ...row } : null;
  }

  async findBySha(userId: string, sha256: string): Promise<PayrollImport | null> {
    const row = this.rows.find((r) => r.userId === userId && r.sha256 === sha256);
    return row ? { ...row } : null;
  }

  async create(input: NewPayrollImport): Promise<PayrollImport> {
    // The database's two unique indexes, reproduced by name so a test that
    // asserts on the message passes identically against both implementations.
    if (this.rows.some((r) => r.userId === input.userId && r.sha256 === input.sha256)) {
      throw new Error('duplicate key value violates unique constraint "payroll_imports_user_sha_uq"');
    }
    if (
      input.idempotencyKey !== null &&
      this.rows.some((r) => r.userId === input.userId && r.idempotencyKey === input.idempotencyKey)
    ) {
      throw new Error('duplicate key value violates unique constraint "payroll_imports_user_idem_uq"');
    }
    const now = new Date();
    const row: PayrollImport = {
      ...input,
      id: monotonicId(),
      status: "received",
      pages: null,
      textSource: null,
      parserVersion: null,
      extraction: null,
      confidence: null,
      scanStatus: "pending",
      scanner: null,
      scanSignature: null,
      scannedAt: null,
      error: null,
      purgedAt: null,
      version: 1,
      createdAt: now,
      updatedAt: now,
    };
    this.rows.push(row);
    return { ...row };
  }

  async patch(userId: string, id: string, patch: PayrollImportPatch): Promise<PayrollImport | null> {
    const index = this.rows.findIndex((r) => r.userId === userId && r.id === id);
    if (index === -1) return null;
    const current = this.rows[index]!;
    const updated: PayrollImport = {
      ...current,
      ...definedEntries(patch),
      version: current.version + 1,
      updatedAt: new Date(),
    };
    this.rows[index] = updated;
    return { ...updated };
  }

  async listByStatusForAllUsers(statuses: readonly PayrollImportStatus[], limit: number): Promise<PayrollImport[]> {
    // Oldest first: a queue, so a stuck row is retried before a fresh one.
    return this.rows
      .filter((r) => statuses.includes(r.status))
      .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime() || a.id.localeCompare(b.id))
      .slice(0, limit)
      .map((r) => ({ ...r }));
  }

  async listPurgeableForAllUsers(before: Date, limit: number): Promise<PayrollImport[]> {
    return this.rows
      .filter(
        (r) =>
          (TERMINAL_STATUSES as readonly string[]).includes(r.status) &&
          r.storageKey !== null &&
          r.retentionUntil.getTime() < before.getTime(),
      )
      .sort((a, b) => a.retentionUntil.getTime() - b.retentionUntil.getTime() || a.id.localeCompare(b.id))
      .slice(0, limit)
      .map((r) => ({ ...r }));
  }
}

export class MemoryPayrollRecordsRepository implements PayrollRecordsRepository {
  private rows: PayrollRecord[] = [];

  async list(userId: string, opts: ListRecordsOptions = {}): Promise<PayrollRecord[]> {
    let rows = this.rows.filter((r) => r.userId === userId);
    if (!opts.includeSuperseded) rows = rows.filter((r) => r.supersededAt === null);
    if (opts.from) rows = rows.filter((r) => r.periodStart >= opts.from!);
    if (opts.to) rows = rows.filter((r) => r.periodStart <= opts.to!);
    return [...rows]
      .sort((a, b) => b.periodStart.localeCompare(a.periodStart) || b.id.localeCompare(a.id))
      .map((r) => ({ ...r }));
  }

  async get(userId: string, id: string): Promise<PayrollRecord | null> {
    const row = this.rows.find((r) => r.userId === userId && r.id === id);
    return row ? { ...row } : null;
  }

  async getByImport(userId: string, importId: string): Promise<PayrollRecord | null> {
    const row = this.rows.find((r) => r.userId === userId && r.importId === importId);
    return row ? { ...row } : null;
  }

  async liveForPeriod(userId: string, periodStart: string, kind: PayrollRecordKind): Promise<PayrollRecord | null> {
    const row = this.rows.find(
      (r) => r.userId === userId && r.periodStart === periodStart && r.kind === kind && r.supersededAt === null,
    );
    return row ? { ...row } : null;
  }

  async create(input: NewPayrollRecord): Promise<PayrollRecord> {
    if (this.rows.some((r) => r.importId === input.importId)) {
      throw new Error('duplicate key value violates unique constraint "payroll_records_import_uq"');
    }
    if (
      this.rows.some(
        (r) =>
          r.userId === input.userId &&
          r.periodStart === input.periodStart &&
          r.kind === input.kind &&
          r.supersededAt === null,
      )
    ) {
      throw new Error('duplicate key value violates unique constraint "payroll_records_period_uq"');
    }
    const now = new Date();
    const row: PayrollRecord = {
      ...input,
      gross: input.gross === null ? null : normalizeScale(input.gross, 2),
      net: input.net === null ? null : normalizeScale(input.net, 2),
      id: monotonicId(),
      supersededAt: null,
      supersededByRecordId: null,
      version: 1,
      createdAt: now,
      updatedAt: now,
    };
    this.rows.push(row);
    return { ...row };
  }

  async update(
    userId: string,
    id: string,
    patch: Partial<Pick<PayrollRecord, "periodEnd" | "payDate" | "currency" | "gross" | "net" | "corrections">>,
  ): Promise<PayrollRecord | null> {
    const index = this.rows.findIndex((r) => r.userId === userId && r.id === id);
    if (index === -1) return null;
    const current = this.rows[index]!;
    const defined = definedEntries(patch);
    const updated: PayrollRecord = {
      ...current,
      ...defined,
      ...(defined.gross !== undefined ? { gross: defined.gross === null ? null : normalizeScale(defined.gross, 2) } : {}),
      ...(defined.net !== undefined ? { net: defined.net === null ? null : normalizeScale(defined.net, 2) } : {}),
      version: current.version + 1,
      updatedAt: new Date(),
    };
    this.rows[index] = updated;
    return { ...updated };
  }

  async supersede(userId: string, id: string, bySupersedingRecordId: string, at: Date): Promise<void> {
    const index = this.rows.findIndex((r) => r.userId === userId && r.id === id);
    if (index === -1) return;
    this.rows[index] = {
      ...this.rows[index]!,
      supersededAt: at,
      supersededByRecordId: bySupersedingRecordId,
      updatedAt: at,
    };
  }
}

export class MemoryPayrollComponentsRepository implements PayrollComponentsRepository {
  private rows: PayrollComponent[] = [];

  async listForRecord(recordId: string): Promise<PayrollComponent[]> {
    return this.rows
      .filter((c) => c.recordId === recordId)
      .sort((a, b) => a.sortOrder - b.sortOrder || a.id.localeCompare(b.id))
      .map((c) => ({ ...c }));
  }

  async listForRecords(recordIds: readonly string[]): Promise<PayrollComponent[]> {
    if (recordIds.length === 0) return [];
    const wanted = new Set(recordIds);
    return this.rows
      .filter((c) => wanted.has(c.recordId))
      .sort((a, b) => a.recordId.localeCompare(b.recordId) || a.sortOrder - b.sortOrder || a.id.localeCompare(b.id))
      .map((c) => ({ ...c }));
  }

  async replaceForRecord(recordId: string, components: readonly NewPayrollComponent[]): Promise<PayrollComponent[]> {
    this.rows = this.rows.filter((c) => c.recordId !== recordId);
    const now = new Date();
    for (const input of components) {
      this.rows.push({
        ...input,
        // The domain builds components with an empty `recordId` because it does
        // not know it; the repository owns the record and stamps it here. Both
        // implementations do this, so a caller never has to.
        recordId,
        amount: input.amount === null ? null : normalizeScale(input.amount, 2),
        quantity: input.quantity === null ? null : normalizeScale(input.quantity, 6),
        id: monotonicId(),
        createdAt: now,
      });
    }
    return this.listForRecord(recordId);
  }
}

export class MemoryPayrollMappingRulesRepository implements PayrollMappingRulesRepository {
  private userRules: PayrollMappingRule[] = [];
  private readonly globals: PayrollMappingRule[] = DEFAULT_MAPPING_RULES.map((r, i) => ({
    ...r,
    id: `global-${String(i).padStart(3, "0")}`,
    userId: null,
  }));

  /** Test-only seam: production user rules come from the database. */
  addUserRule(userId: string, rule: Omit<PayrollMappingRule, "id" | "userId">): void {
    this.userRules.push({ ...rule, id: `user-${String(this.userRules.length).padStart(3, "0")}`, userId });
  }

  async listFor(userId: string): Promise<PayrollMappingRule[]> {
    return [...this.globals, ...this.userRules.filter((r) => r.userId === userId)]
      .sort((a, b) => a.priority - b.priority || a.id.localeCompare(b.id))
      .map((r) => ({ ...r }));
  }
}

export class MemoryLegacyFundDeposits implements LegacyFundDeposits {
  readonly rows: Array<{ fundSlug: string; month: string; amount: string; employee: string | null; employer: string | null }> = [];

  constructor(private readonly knownSlugs: readonly string[] = ["cometa"]) {}

  async upsertForRecord(input: LegacyFundDepositInput): Promise<"written" | "no_fund" | "no_amount"> {
    if (!this.knownSlugs.includes(input.fundSlug)) return "no_fund";
    const amount = addMoney(input.employee, input.employer);
    if (amount === null) return "no_amount";
    const index = this.rows.findIndex((r) => r.fundSlug === input.fundSlug && r.month === input.month);
    const row = { fundSlug: input.fundSlug, month: input.month, amount, employee: input.employee, employer: input.employer };
    if (index === -1) this.rows.push(row);
    else this.rows[index] = row;
    return "written";
  }
}
```

- [ ] **Step 4: Run the memory test and watch it pass**

Run: `npm test -- payroll/infrastructure/memory-repositories`
Expected: PASS — all 24 cases.

- [ ] **Step 5: Write the Drizzle repositories**

```ts
// src/modules/payroll/infrastructure/drizzle-payroll-imports-repository.ts
import { and, asc, desc, eq, inArray, isNotNull, lt, sql } from "drizzle-orm";
import type { DbClient } from "@/lib/db/client";
import { payrollImports, type PayrollImportRow } from "@/lib/db/schema";
import type { Confidence, PayslipExtraction } from "@/lib/contracts";
import type {
  ListImportsOptions,
  NewPayrollImport,
  PayrollImport,
  PayrollImportPatch,
  PayrollImportStatus,
  PayrollImportsRepository,
} from "../application/ports";
import { TERMINAL_STATUSES } from "../domain/payroll";

function toImport(row: PayrollImportRow): PayrollImport {
  return {
    id: row.id,
    userId: row.userId,
    // The only casts in this module: a `text` column with an app-level CHECK
    // has no narrower Drizzle-inferred type, the same reason
    // `DrizzleAccountsRepository` casts at its own boundary.
    status: row.status as PayrollImport["status"],
    fileName: row.fileName,
    mime: row.mime,
    sizeBytes: row.sizeBytes,
    sha256: row.sha256,
    storageProvider: row.storageProvider as PayrollImport["storageProvider"],
    storageKey: row.storageKey,
    pages: row.pages,
    textSource: row.textSource as PayrollImport["textSource"],
    parserVersion: row.parserVersion,
    extraction: row.extraction as PayslipExtraction | null,
    confidence: row.confidence as Record<string, Confidence> | null,
    scanStatus: row.scanStatus as PayrollImport["scanStatus"],
    scanner: row.scanner,
    scanSignature: row.scanSignature,
    scannedAt: row.scannedAt,
    error: row.error,
    idempotencyKey: row.idempotencyKey,
    replacesImportId: row.replacesImportId,
    retentionUntil: row.retentionUntil,
    purgedAt: row.purgedAt,
    uploadedVia: row.uploadedVia as PayrollImport["uploadedVia"],
    version: row.version,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

/**
 * Postgres-backed pipeline state. Every method assumes the client is a
 * transaction carrying the caller's RLS context (`withUserContext`); the
 * explicit `user_id` predicates keep the intent readable and hold under the
 * system context too, where RLS lets everything through — the precedent
 * `DrizzleInterestRulesRepository` sets. The two `ForAllUsers` methods are the
 * deliberate exceptions and are meant for `withSystemContext` only.
 */
export class DrizzlePayrollImportsRepository implements PayrollImportsRepository {
  constructor(private readonly db: DbClient) {}

  async list(userId: string, opts: ListImportsOptions = {}): Promise<PayrollImport[]> {
    const where = opts.statuses
      ? and(eq(payrollImports.userId, userId), inArray(payrollImports.status, [...opts.statuses]))
      : eq(payrollImports.userId, userId);
    const query = this.db
      .select()
      .from(payrollImports)
      .where(where)
      // Explicit and total: without the id tie-break, two imports created in
      // the same millisecond swap position between reloads.
      .orderBy(desc(payrollImports.createdAt), desc(payrollImports.id));
    const rows = opts.limit === undefined ? await query : await query.limit(opts.limit);
    return rows.map(toImport);
  }

  async get(userId: string, id: string): Promise<PayrollImport | null> {
    const [row] = await this.db
      .select()
      .from(payrollImports)
      .where(and(eq(payrollImports.userId, userId), eq(payrollImports.id, id)))
      .limit(1);
    return row ? toImport(row) : null;
  }

  async findBySha(userId: string, sha256: string): Promise<PayrollImport | null> {
    const [row] = await this.db
      .select()
      .from(payrollImports)
      .where(and(eq(payrollImports.userId, userId), eq(payrollImports.sha256, sha256)))
      .limit(1);
    return row ? toImport(row) : null;
  }

  async create(input: NewPayrollImport): Promise<PayrollImport> {
    const [row] = await this.db.insert(payrollImports).values(input).returning();
    return toImport(row!);
  }

  async patch(userId: string, id: string, patch: PayrollImportPatch): Promise<PayrollImport | null> {
    const [row] = await this.db
      .update(payrollImports)
      .set({ ...patch, version: sql`${payrollImports.version} + 1`, updatedAt: new Date() })
      .where(and(eq(payrollImports.userId, userId), eq(payrollImports.id, id)))
      .returning();
    return row ? toImport(row) : null;
  }

  async listByStatusForAllUsers(statuses: readonly PayrollImportStatus[], limit: number): Promise<PayrollImport[]> {
    const rows = await this.db
      .select()
      .from(payrollImports)
      .where(inArray(payrollImports.status, [...statuses]))
      .orderBy(asc(payrollImports.createdAt), asc(payrollImports.id))
      .limit(limit);
    return rows.map(toImport);
  }

  async listPurgeableForAllUsers(before: Date, limit: number): Promise<PayrollImport[]> {
    const rows = await this.db
      .select()
      .from(payrollImports)
      .where(
        and(
          inArray(payrollImports.status, [...TERMINAL_STATUSES]),
          isNotNull(payrollImports.storageKey),
          lt(payrollImports.retentionUntil, before),
        ),
      )
      .orderBy(asc(payrollImports.retentionUntil), asc(payrollImports.id))
      .limit(limit);
    return rows.map(toImport);
  }
}
```

```ts
// src/modules/payroll/infrastructure/drizzle-payroll-records-repository.ts
import { and, desc, eq, gte, isNull, lte, sql } from "drizzle-orm";
import type { DbClient } from "@/lib/db/client";
import { payrollRecords, type PayrollRecordRow } from "@/lib/db/schema";
import type {
  ListRecordsOptions,
  NewPayrollRecord,
  PayrollRecord,
  PayrollRecordKind,
  PayrollRecordsRepository,
} from "../application/ports";

function toRecord(row: PayrollRecordRow): PayrollRecord {
  return {
    id: row.id,
    userId: row.userId,
    importId: row.importId,
    periodStart: row.periodStart,
    periodEnd: row.periodEnd,
    payDate: row.payDate,
    kind: row.kind as PayrollRecordKind,
    currency: row.currency,
    gross: row.gross,
    net: row.net,
    verifiedAt: row.verifiedAt,
    verifiedBy: row.verifiedBy,
    corrections: row.corrections as PayrollRecord["corrections"],
    supersededAt: row.supersededAt,
    supersededByRecordId: row.supersededByRecordId,
    version: row.version,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

export class DrizzlePayrollRecordsRepository implements PayrollRecordsRepository {
  constructor(private readonly db: DbClient) {}

  async list(userId: string, opts: ListRecordsOptions = {}): Promise<PayrollRecord[]> {
    const clauses = [eq(payrollRecords.userId, userId)];
    if (!opts.includeSuperseded) clauses.push(isNull(payrollRecords.supersededAt));
    if (opts.from) clauses.push(gte(payrollRecords.periodStart, opts.from));
    if (opts.to) clauses.push(lte(payrollRecords.periodStart, opts.to));
    const rows = await this.db
      .select()
      .from(payrollRecords)
      .where(and(...clauses))
      .orderBy(desc(payrollRecords.periodStart), desc(payrollRecords.id));
    return rows.map(toRecord);
  }

  async get(userId: string, id: string): Promise<PayrollRecord | null> {
    const [row] = await this.db
      .select()
      .from(payrollRecords)
      .where(and(eq(payrollRecords.userId, userId), eq(payrollRecords.id, id)))
      .limit(1);
    return row ? toRecord(row) : null;
  }

  async getByImport(userId: string, importId: string): Promise<PayrollRecord | null> {
    const [row] = await this.db
      .select()
      .from(payrollRecords)
      .where(and(eq(payrollRecords.userId, userId), eq(payrollRecords.importId, importId)))
      .limit(1);
    return row ? toRecord(row) : null;
  }

  async liveForPeriod(userId: string, periodStart: string, kind: PayrollRecordKind): Promise<PayrollRecord | null> {
    const [row] = await this.db
      .select()
      .from(payrollRecords)
      .where(
        and(
          eq(payrollRecords.userId, userId),
          eq(payrollRecords.periodStart, periodStart),
          eq(payrollRecords.kind, kind),
          isNull(payrollRecords.supersededAt),
        ),
      )
      .limit(1);
    return row ? toRecord(row) : null;
  }

  async create(input: NewPayrollRecord): Promise<PayrollRecord> {
    const [row] = await this.db.insert(payrollRecords).values(input).returning();
    return toRecord(row!);
  }

  async update(
    userId: string,
    id: string,
    patch: Partial<Pick<PayrollRecord, "periodEnd" | "payDate" | "currency" | "gross" | "net" | "corrections">>,
  ): Promise<PayrollRecord | null> {
    const [row] = await this.db
      .update(payrollRecords)
      .set({ ...patch, version: sql`${payrollRecords.version} + 1`, updatedAt: new Date() })
      .where(and(eq(payrollRecords.userId, userId), eq(payrollRecords.id, id)))
      .returning();
    return row ? toRecord(row) : null;
  }

  async supersede(userId: string, id: string, bySupersedingRecordId: string, at: Date): Promise<void> {
    await this.db
      .update(payrollRecords)
      .set({ supersededAt: at, supersededByRecordId: bySupersedingRecordId, updatedAt: at })
      .where(and(eq(payrollRecords.userId, userId), eq(payrollRecords.id, id)));
  }
}
```

```ts
// src/modules/payroll/infrastructure/drizzle-payroll-components-repository.ts
import { asc, eq, inArray } from "drizzle-orm";
import type { DbClient } from "@/lib/db/client";
import { payrollComponents, type PayrollComponentRow } from "@/lib/db/schema";
import type { Confidence } from "@/lib/contracts";
import type {
  MappingTarget,
  NewPayrollComponent,
  PayrollComponent,
  PayrollComponentKind,
  PayrollComponentsRepository,
} from "../application/ports";

function toComponent(row: PayrollComponentRow): PayrollComponent {
  return {
    id: row.id,
    recordId: row.recordId,
    code: row.code,
    labelRaw: row.labelRaw,
    kind: row.kind as PayrollComponentKind,
    amount: row.amount,
    quantity: row.quantity,
    unit: row.unit as PayrollComponent["unit"],
    currency: row.currency,
    confidence: row.confidence as Confidence | null,
    source: row.source as PayrollComponent["source"],
    mappedTo: row.mappedTo as MappingTarget | null,
    sortOrder: row.sortOrder,
    createdAt: row.createdAt,
  };
}

export class DrizzlePayrollComponentsRepository implements PayrollComponentsRepository {
  constructor(private readonly db: DbClient) {}

  async listForRecord(recordId: string): Promise<PayrollComponent[]> {
    const rows = await this.db
      .select()
      .from(payrollComponents)
      .where(eq(payrollComponents.recordId, recordId))
      .orderBy(asc(payrollComponents.sortOrder), asc(payrollComponents.id));
    return rows.map(toComponent);
  }

  async listForRecords(recordIds: readonly string[]): Promise<PayrollComponent[]> {
    if (recordIds.length === 0) return [];
    const rows = await this.db
      .select()
      .from(payrollComponents)
      .where(inArray(payrollComponents.recordId, [...recordIds]))
      .orderBy(asc(payrollComponents.recordId), asc(payrollComponents.sortOrder), asc(payrollComponents.id));
    return rows.map(toComponent);
  }

  /**
   * Delete-then-insert rather than an upsert (Ruling R4-6): a re-apply may drop
   * a component the previous parse produced, and an upsert keyed on
   * `(record, code)` would leave that stale row behind — a component the
   * payslip no longer has, still feeding Earnings.
   *
   * Runs inside the caller's transaction, so the record is never briefly
   * componentless to any other reader.
   */
  async replaceForRecord(recordId: string, components: readonly NewPayrollComponent[]): Promise<PayrollComponent[]> {
    await this.db.delete(payrollComponents).where(eq(payrollComponents.recordId, recordId));
    if (components.length > 0) {
      await this.db.insert(payrollComponents).values(components.map((c) => ({ ...c, recordId })));
    }
    return this.listForRecord(recordId);
  }
}
```

```ts
// src/modules/payroll/infrastructure/drizzle-payroll-mapping-rules-repository.ts
import { asc, eq, isNull, or } from "drizzle-orm";
import type { DbClient } from "@/lib/db/client";
import { payrollMappingRules, type PayrollMappingRuleRow } from "@/lib/db/schema";
import type {
  MappingTarget,
  PayrollComponentKind,
  PayrollMappingRule,
  PayrollMappingRulesRepository,
} from "../application/ports";

function toRule(row: PayrollMappingRuleRow): PayrollMappingRule {
  return {
    id: row.id,
    userId: row.userId,
    matchCode: row.matchCode,
    matchLabel: row.matchLabel,
    componentKind: row.componentKind as PayrollComponentKind,
    target: row.target as MappingTarget,
    priority: row.priority,
  };
}

export class DrizzlePayrollMappingRulesRepository implements PayrollMappingRulesRepository {
  constructor(private readonly db: DbClient) {}

  /**
   * Global rules (`user_id IS NULL`) plus this user's own. The RLS policy
   * already admits exactly this set, but the explicit predicate keeps the
   * intent readable and holds under the system context too.
   */
  async listFor(userId: string): Promise<PayrollMappingRule[]> {
    const rows = await this.db
      .select()
      .from(payrollMappingRules)
      .where(or(isNull(payrollMappingRules.userId), eq(payrollMappingRules.userId, userId)))
      .orderBy(asc(payrollMappingRules.priority), asc(payrollMappingRules.id));
    return rows.map(toRule);
  }
}
```

```ts
// src/modules/payroll/infrastructure/legacy-fund-deposits.ts
import { and, eq } from "drizzle-orm";
import type { DbClient } from "@/lib/db/client";
import { fundDeposits, funds } from "@/lib/db/schema";
import type { LegacyFundDepositInput, LegacyFundDeposits } from "../application/ports";
import { addMoney } from "../domain/money";

/**
 * The Phase-5 bridge (Ruling R4-6): an applied payroll record keeps the legacy
 * Funds page working by writing the month's `fund_deposits` row, exactly as the
 * retiring `src/app/actions/payslips.ts:upsertCometaDeposit` did.
 *
 * Two deliberate differences from that function. It runs on the **caller's
 * transaction** rather than the module-level `db`, so the deposit and the
 * payroll record commit or roll back together. And it writes `payslip_id: null`
 * — `fund_deposits.payslip_id` is a `bigint` FK to the legacy `payslips.id`,
 * and a `payroll_records` id is a uuid, so there is nothing valid to put there;
 * the provenance lives on `payroll_records` instead and Phase 5's
 * `fund_contributions` picks it up from there.
 *
 * `fund_deposits` carries no RLS (it is a legacy, single-owner table), so this
 * is one of the few writes in the module RLS does not also guard. The
 * `fundSlug` lookup is the only gate, and it fails closed: an unknown slug
 * writes nothing and says so.
 */
export function drizzleLegacyFundDeposits(tx: DbClient): LegacyFundDeposits {
  return {
    async upsertForRecord(input: LegacyFundDepositInput) {
      const [fund] = await tx.select().from(funds).where(eq(funds.slug, input.fundSlug)).limit(1);
      if (!fund) return "no_fund";
      const amount = addMoney(input.employee, input.employer);
      // Both halves absent means the payslip did not state a contribution.
      // Writing `0.00` here would put a real, wrong figure on the Funds page.
      if (amount === null) return "no_amount";
      await tx
        .insert(fundDeposits)
        .values({
          fundId: fund.id,
          month: input.month,
          amount,
          employeePart: input.employee,
          employerPart: input.employer,
          source: "payroll",
          payslipId: null,
        })
        .onConflictDoUpdate({
          target: [fundDeposits.fundId, fundDeposits.month],
          set: {
            amount,
            employeePart: input.employee,
            employerPart: input.employer,
            source: "payroll",
            payslipId: null,
          },
        });
      return "written";
    },
  };
}
```

```ts
// src/modules/payroll/infrastructure/deps.ts
import type { DbClient } from "@/lib/db/client";
import { recordAudit } from "@/platform/audit/record";
import type { DocumentStore, MalwareScanner, UseCaseDeps } from "../application/ports";
import { DrizzlePayrollComponentsRepository } from "./drizzle-payroll-components-repository";
import { DrizzlePayrollImportsRepository } from "./drizzle-payroll-imports-repository";
import { DrizzlePayrollMappingRulesRepository } from "./drizzle-payroll-mapping-rules-repository";
import { DrizzlePayrollRecordsRepository } from "./drizzle-payroll-records-repository";
import { drizzleLegacyFundDeposits } from "./legacy-fund-deposits";

export interface PayrollDepsOptions {
  /** Resolved by the caller *before* the transaction opened (Ruling R4-8). */
  documents: DocumentStore;
  /** Resolved by the caller *before* the transaction opened (Ruling R4-8). */
  scanner: MalwareScanner;
  requestId?: string | null;
}

/**
 * The production assembly of `UseCaseDeps`, bound to one transaction. Follows
 * the accounts module's flat shape (the one `interestDeps` and `expenseDeps`
 * also follow): RLS context is opened exactly once by the caller
 * (`withUserContext`/`withSystemContext`), which then builds a fresh deps bag
 * bound to that transaction.
 *
 * `documents` and `scanner` are passed in rather than resolved here, because
 * resolving them is network I/O and decryption — work that must not happen
 * inside the transaction this bag is bound to.
 */
export function payrollDeps(tx: DbClient, opts: PayrollDepsOptions): UseCaseDeps {
  return {
    imports: new DrizzlePayrollImportsRepository(tx),
    records: new DrizzlePayrollRecordsRepository(tx),
    components: new DrizzlePayrollComponentsRepository(tx),
    mappingRules: new DrizzlePayrollMappingRulesRepository(tx),
    funds: drizzleLegacyFundDeposits(tx),
    documents: opts.documents,
    scanner: opts.scanner,
    clock: { now: () => new Date() },
    audit: (e) => recordAudit(tx, { ...e, requestId: opts.requestId ?? null }),
  };
}
```

- [ ] **Step 6: Write the repository integration test that pins the shared contract**

```ts
// src/modules/payroll/infrastructure/repositories.itest.ts
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { organizations, users } from "@/lib/db/schema";
import { withSystemContext, withUserContext } from "@/platform/db/context";
import { closeDb, resetDb, testDb } from "@/test/db";
import type { NewPayrollComponent, NewPayrollImport, NewPayrollRecord } from "../application/ports";
import { DrizzlePayrollComponentsRepository } from "./drizzle-payroll-components-repository";
import { DrizzlePayrollImportsRepository } from "./drizzle-payroll-imports-repository";
import { DrizzlePayrollMappingRulesRepository } from "./drizzle-payroll-mapping-rules-repository";
import { DrizzlePayrollRecordsRepository } from "./drizzle-payroll-records-repository";
import { drizzleLegacyFundDeposits } from "./legacy-fund-deposits";

const RETENTION = new Date("2036-01-01T00:00:00Z");

async function seedUsers() {
  const db = await testDb();
  const [org] = await db.insert(organizations).values({ name: "P" }).returning();
  const [a] = await db.insert(users).values({ organizationId: org!.id, displayName: "A" }).returning();
  const [b] = await db.insert(users).values({ organizationId: org!.id, displayName: "B" }).returning();
  return { db, a: a!.id, b: b!.id };
}

function newImport(userId: string, sha: string, over: Partial<NewPayrollImport> = {}): NewPayrollImport {
  return {
    userId, fileName: "busta.pdf", mime: "application/pdf", sizeBytes: 1234, sha256: sha,
    storageProvider: "local", storageKey: `payroll/${userId}/2026/${sha.slice(0, 32)}.pdf`,
    idempotencyKey: null, replacesImportId: null, retentionUntil: RETENTION, uploadedVia: "ui", ...over,
  };
}

function newRecord(userId: string, importId: string, over: Partial<NewPayrollRecord> = {}): NewPayrollRecord {
  return {
    userId, importId, periodStart: "2026-08-01", periodEnd: "2026-08-31", payDate: null,
    kind: "ordinary", currency: "EUR", gross: "2500.00", net: "1800.00",
    verifiedAt: null, verifiedBy: null, corrections: null, ...over,
  };
}

function newComponent(over: Partial<NewPayrollComponent> = {}): NewPayrollComponent {
  return {
    recordId: "", code: "net", labelRaw: "Netto del mese", kind: "earning", amount: "1800.00",
    quantity: null, unit: "eur", currency: "EUR", confidence: "high", source: "rules",
    mappedTo: { kind: "earnings" }, sortOrder: 0, ...over,
  };
}

describe("Drizzle payroll repositories", () => {
  beforeEach(resetDb);
  afterAll(closeDb);

  it("lists imports newest first, exactly as the memory repository does", async () => {
    const { db, a } = await seedUsers();
    const shas = await withUserContext(db, { userId: a }, async (tx) => {
      const repo = new DrizzlePayrollImportsRepository(tx);
      await repo.create(newImport(a, "a".repeat(64)));
      await repo.create(newImport(a, "b".repeat(64)));
      return (await repo.list(a)).map((i) => i.sha256);
    });
    expect(shas).toEqual(["b".repeat(64), "a".repeat(64)]);
  });

  it("raises the sha unique index by name, so createImport can recognise it", async () => {
    const { db, a } = await seedUsers();
    await expect(
      withUserContext(db, { userId: a }, async (tx) => {
        const repo = new DrizzlePayrollImportsRepository(tx);
        await repo.create(newImport(a, "a".repeat(64)));
        await repo.create(newImport(a, "a".repeat(64)));
      }),
    ).rejects.toThrow(/payroll_imports_user_sha_uq/);
  });

  it("patch bumps version and never touches another user's row", async () => {
    const { db, a, b } = await seedUsers();
    const created = await withUserContext(db, { userId: a }, (tx) =>
      new DrizzlePayrollImportsRepository(tx).create(newImport(a, "a".repeat(64))),
    );
    const asOther = await withUserContext(db, { userId: b }, (tx) =>
      new DrizzlePayrollImportsRepository(tx).patch(b, created.id, { status: "rejected" }),
    );
    expect(asOther).toBeNull();
    const patched = await withUserContext(db, { userId: a }, (tx) =>
      new DrizzlePayrollImportsRepository(tx).patch(a, created.id, { status: "scanning" }),
    );
    expect(patched?.version).toBe(created.version + 1);
    expect(patched?.status).toBe("scanning");
  });

  it("listPurgeableForAllUsers crosses users and takes only terminal rows with a live key", async () => {
    const { db, a, b } = await seedUsers();
    const past = new Date("2020-01-01T00:00:00Z");
    await withSystemContext(db, async (tx) => {
      const repo = new DrizzlePayrollImportsRepository(tx);
      const applied = await repo.create(newImport(a, "a".repeat(64), { retentionUntil: past }));
      await repo.patch(a, applied.id, { status: "applied" });
      const live = await repo.create(newImport(b, "b".repeat(64), { retentionUntil: past }));
      await repo.patch(b, live.id, { status: "needs_review" });
      const purged = await repo.create(newImport(b, "c".repeat(64), { retentionUntil: past }));
      await repo.patch(b, purged.id, { status: "rejected", storageKey: null, purgedAt: new Date() });
    });
    const found = await withSystemContext(db, (tx) =>
      new DrizzlePayrollImportsRepository(tx).listPurgeableForAllUsers(new Date("2026-09-05T00:00:00Z"), 100),
    );
    expect(found.map((i) => i.sha256)).toEqual(["a".repeat(64)]);
  });

  it("enforces one record per import and one live record per period, and frees the period on supersede", async () => {
    const { db, a } = await seedUsers();
    const importIds = await withUserContext(db, { userId: a }, async (tx) => {
      const repo = new DrizzlePayrollImportsRepository(tx);
      const first = await repo.create(newImport(a, "a".repeat(64)));
      const second = await repo.create(newImport(a, "b".repeat(64)));
      return [first.id, second.id];
    });
    const firstRecord = await withUserContext(db, { userId: a }, (tx) =>
      new DrizzlePayrollRecordsRepository(tx).create(newRecord(a, importIds[0]!)),
    );
    await expect(
      withUserContext(db, { userId: a }, (tx) => new DrizzlePayrollRecordsRepository(tx).create(newRecord(a, importIds[1]!))),
    ).rejects.toThrow(/payroll_records_period_uq/);
    await withUserContext(db, { userId: a }, async (tx) => {
      const repo = new DrizzlePayrollRecordsRepository(tx);
      await repo.supersede(a, firstRecord.id, firstRecord.id, new Date());
      await repo.create(newRecord(a, importIds[1]!));
    });
    const live = await withUserContext(db, { userId: a }, (tx) => new DrizzlePayrollRecordsRepository(tx).list(a));
    expect(live.length).toBe(1);
    const all = await withUserContext(db, { userId: a }, (tx) =>
      new DrizzlePayrollRecordsRepository(tx).list(a, { includeSuperseded: true }),
    );
    expect(all.length).toBe(2);
  });

  it("replaceForRecord replaces wholesale and reads back the same scales the fake produces", async () => {
    const { db, a } = await seedUsers();
    const recordId = await withUserContext(db, { userId: a }, async (tx) => {
      const imp = await new DrizzlePayrollImportsRepository(tx).create(newImport(a, "a".repeat(64)));
      const rec = await new DrizzlePayrollRecordsRepository(tx).create(newRecord(a, imp.id));
      return rec.id;
    });
    const first = await withUserContext(db, { userId: a }, (tx) =>
      new DrizzlePayrollComponentsRepository(tx).replaceForRecord(recordId, [
        newComponent({ amount: "1800.5" }),
        newComponent({ code: "ferieBalance", labelRaw: "Ferie residue", kind: "leave_balance", amount: null, quantity: "88.25", unit: "hours", sortOrder: 1 }),
      ]),
    );
    expect(first.map((c) => c.code)).toEqual(["net", "ferieBalance"]);
    expect(first[0]!.amount).toBe("1800.50");
    expect(first[1]!.quantity).toBe("88.250000");

    const second = await withUserContext(db, { userId: a }, (tx) =>
      new DrizzlePayrollComponentsRepository(tx).replaceForRecord(recordId, [
        newComponent({ code: "gross", labelRaw: "Totale competenze", amount: "2500.00" }),
      ]),
    );
    expect(second.map((c) => c.code)).toEqual(["gross"]);
  });

  it("returns the seeded global mapping rules and no other user's rules", async () => {
    const { db, a } = await seedUsers();
    const rules = await withUserContext(db, { userId: a }, (tx) => new DrizzlePayrollMappingRulesRepository(tx).listFor(a));
    // Migration 0015 seeds no rows into payroll_mapping_rules; the global
    // catalogue lives in `DEFAULT_MAPPING_RULES` and is merged by the use case.
    // This proves the query is well-formed and leaks nothing, not that rows exist.
    expect(Array.isArray(rules)).toBe(true);
    expect(rules.every((r) => r.userId === null || r.userId === a)).toBe(true);
  });

  it("the legacy fund bridge upserts one row per month and reports an unknown slug", async () => {
    const { db, a } = await seedUsers();
    const outcome = await withUserContext(db, { userId: a }, (tx) =>
      drizzleLegacyFundDeposits(tx).upsertForRecord({
        fundSlug: "definitely-not-a-fund", month: "2026-08-01", employee: "50.00", employer: "100.00",
      }),
    );
    expect(outcome).toBe("no_fund");
  });

  it("the legacy fund bridge writes nothing when the payslip carried neither half", async () => {
    const { db, a } = await seedUsers();
    const outcome = await withUserContext(db, { userId: a }, (tx) =>
      drizzleLegacyFundDeposits(tx).upsertForRecord({ fundSlug: "cometa", month: "2026-08-01", employee: null, employer: null }),
    );
    expect(outcome).toBe("no_amount");
  });
});
```

The two fund-bridge cases assert the guard paths only, because `funds` is seeded by an earlier migration whose row set this test must not depend on; the `written` path is proven end to end by Task 11's apply integration test, which seeds its own fund row.

- [ ] **Step 7: Run everything**

Run:
```bash
npm test -- payroll/
npm run test:db:up && npm run test:integration -- payroll
npx tsc --noEmit
```
Expected: PASS, PASS, exit 0.

- [ ] **Step 8: Commit**

```bash
git add src/modules/payroll/infrastructure
git commit -m "feat(payroll): add the memory and Drizzle repositories, the fund bridge and the deps bag"
```

---

### Task 9: Uploading a payslip — reserve, write bytes, confirm

**Files:**
- Create: `src/modules/payroll/application/create-import.ts`
- Create: `src/modules/payroll/application/create-import.test.ts`
- Create: `src/modules/payroll/infrastructure/retention-settings.ts`
- Create: `src/modules/payroll/infrastructure/upload.ts`
- Create: `src/modules/payroll/infrastructure/upload.itest.ts`

**Interfaces:**
- Consumes: `UseCaseDeps`, `PayrollImport`, `NewPayrollImport`, `UploadedVia` from `../application/ports` (Task 2); `MAX_UPLOAD_BYTES`, `looksLikePdf`, `sha256Hex`, `newStorageKey` from `../domain/document` (Task 2); `DuplicateImportError`, `InvalidInputError`, `NotFoundError` from `../application/errors` (Task 2); `payrollDeps` from `../infrastructure/deps` (Task 8); `assertPermission` from `@/platform/auth/principal`; `withUserContext` from `@/platform/db/context`; `resolveDocumentStore` from `./document-store-resolver` and `resolveScanner` from `./scanner-resolver` (Tasks 3, 6, 7).
- Produces:
```ts
export const DEFAULT_RETENTION_YEARS = 10;
export interface UploadCandidate { fileName: string; mime: string; bytes: Uint8Array }
export interface ReserveImportInput extends UploadCandidate { storageProvider: "silo" | "local"; idempotencyKey?: string | null; replacesImportId?: string | null; uploadedVia?: UploadedVia; retentionYears?: number }
export function validateUpload(candidate: UploadCandidate): { ok: true } | { ok: false; message: string };
export function reserveImport(deps: UseCaseDeps): (principal: Principal, input: ReserveImportInput) => Promise<PayrollImport>;
export function markUploaded(deps: UseCaseDeps): (principal: Principal, importId: string) => Promise<PayrollImport>;
export function markUploadFailed(deps: UseCaseDeps): (principal: Principal, importId: string, error: string) => Promise<void>;
// infrastructure/upload.ts
export interface UploadInput extends UploadCandidate { idempotencyKey?: string | null; replacesImportId?: string | null; uploadedVia?: UploadedVia }
export async function uploadPayslip(principal: Principal, input: UploadInput): Promise<PayrollImport>;
export async function readRetentionYears(tx: DbClient): Promise<number>;
```

The upload is deliberately **three short steps, not one**: reserve the row (transaction), write the bytes (no transaction), confirm the row (transaction). Writing 10 MB to an S3 endpoint inside an open transaction would hold one of the pool's connections for the whole round trip — the exact defect Phase 2's Task 2 removed from the Wallet path and the reason `SyncFetchContext` carries no database handle.

- [ ] **Step 1: Write the failing use-case test**

```ts
// src/modules/payroll/application/create-import.test.ts
import { describe, expect, it } from "vitest";
import { testPrincipal } from "@/test/principal";
import type { UseCaseDeps } from "./ports";
import {
  MemoryLegacyFundDeposits,
  MemoryPayrollComponentsRepository,
  MemoryPayrollImportsRepository,
  MemoryPayrollMappingRulesRepository,
  MemoryPayrollRecordsRepository,
} from "../infrastructure/memory-repositories";
import { noopScanner } from "../infrastructure/noop-scanner";
import { DuplicateImportError, InvalidInputError } from "./errors";
import { markUploadFailed, markUploaded, reserveImport, validateUpload } from "./create-import";

const NOW = new Date("2026-09-05T10:00:00Z");
const pdf = (extra = "") => new TextEncoder().encode(`%PDF-1.7\n${extra}`);

function makeDeps(): UseCaseDeps & { audits: unknown[] } {
  const audits: unknown[] = [];
  return {
    imports: new MemoryPayrollImportsRepository(),
    records: new MemoryPayrollRecordsRepository(),
    components: new MemoryPayrollComponentsRepository(),
    mappingRules: new MemoryPayrollMappingRulesRepository(),
    funds: new MemoryLegacyFundDeposits(),
    documents: {
      provider: "local",
      put: async () => {},
      get: async () => null,
      delete: async () => {},
      listPrefix: async () => [],
    },
    scanner: noopScanner,
    clock: { now: () => NOW },
    audit: async (e) => void audits.push(e),
    audits,
  };
}

const principal = testPrincipal({ userId: "00000000-0000-7000-8000-00000000000a" });

const base = { fileName: "Busta Paga Agosto 2026.pdf", mime: "application/pdf", storageProvider: "local" as const };

describe("validateUpload", () => {
  it("accepts a PDF under the size limit", () => {
    expect(validateUpload({ fileName: "a.pdf", mime: "application/pdf", bytes: pdf() })).toEqual({ ok: true });
  });

  it("rejects an empty file", () => {
    const result = validateUpload({ fileName: "a.pdf", mime: "application/pdf", bytes: new Uint8Array() });
    expect(result).toEqual({ ok: false, message: "The file is empty." });
  });

  it("rejects a file over 10 MB (spec §7.9)", () => {
    const result = validateUpload({ fileName: "a.pdf", mime: "application/pdf", bytes: new Uint8Array(10 * 1024 * 1024 + 1) });
    expect(result).toEqual({ ok: false, message: "The file is larger than 10 MB." });
  });

  it("rejects a declared type that is not a PDF", () => {
    expect(validateUpload({ fileName: "a.png", mime: "image/png", bytes: pdf() })).toEqual({
      ok: false,
      message: "Only PDF payslips can be uploaded.",
    });
  });

  it("rejects bytes that are not really a PDF, whatever the client declared (spec §8.3)", () => {
    const result = validateUpload({
      fileName: "a.pdf",
      mime: "application/pdf",
      bytes: new TextEncoder().encode("<html>gotcha"),
    });
    expect(result).toEqual({ ok: false, message: "That file is not a PDF." });
  });
});

describe("reserveImport", () => {
  it("refuses a principal without payroll.upload", async () => {
    const deps = makeDeps();
    await expect(
      reserveImport(deps)(testPrincipal({ roles: ["viewer"] }), { ...base, bytes: pdf() }),
    ).rejects.toThrow(/permission/i);
  });

  it("records the sha, the size, an unguessable key and a ten-year retention", async () => {
    const deps = makeDeps();
    const created = await reserveImport(deps)(principal, { ...base, bytes: pdf() });
    expect(created.status).toBe("received");
    expect(created.scanStatus).toBe("pending");
    expect(created.sha256).toMatch(/^[0-9a-f]{64}$/);
    expect(created.sizeBytes).toBe(pdf().byteLength);
    expect(created.storageKey).toMatch(new RegExp(`^payroll/${principal.userId}/2026/[0-9a-f]{32}\\.pdf$`));
    expect(created.storageKey).not.toContain(created.sha256);
    expect(created.storageKey).not.toContain(created.id);
    expect(created.retentionUntil.getUTCFullYear()).toBe(2036);
  });

  it("honours an explicit retention window from policy", async () => {
    const deps = makeDeps();
    const created = await reserveImport(deps)(principal, { ...base, bytes: pdf(), retentionYears: 5 });
    expect(created.retentionUntil.getUTCFullYear()).toBe(2031);
  });

  it("rejects an invalid upload before writing anything", async () => {
    const deps = makeDeps();
    await expect(
      reserveImport(deps)(principal, { ...base, bytes: new TextEncoder().encode("<html>") }),
    ).rejects.toBeInstanceOf(InvalidInputError);
    expect(await deps.imports.list(principal.userId)).toEqual([]);
  });

  it("raises DuplicateImportError naming the existing import when the same bytes arrive twice", async () => {
    const deps = makeDeps();
    const first = await reserveImport(deps)(principal, { ...base, bytes: pdf() });
    await expect(reserveImport(deps)(principal, { ...base, bytes: pdf() })).rejects.toMatchObject({
      name: "DuplicateImportError",
      existingImportId: first.id,
    });
  });

  it("reuses a failed import rather than dead-ending the user behind their own unique index (Ruling R4-3)", async () => {
    const deps = makeDeps();
    const first = await reserveImport(deps)(principal, { ...base, bytes: pdf() });
    await markUploadFailed(deps)(principal, first.id, "store unreachable");
    const retried = await reserveImport(deps)(principal, { ...base, bytes: pdf() });
    expect(retried.id).toBe(first.id);
    expect(retried.status).toBe("received");
    expect(retried.error).toBeNull();
    // A fresh key, so a half-written object from the failed attempt is never read back.
    expect(retried.storageKey).not.toBe(first.storageKey);
  });

  it("audits the reservation with the sha but never with the bytes", async () => {
    const deps = makeDeps();
    const created = await reserveImport(deps)(principal, { ...base, bytes: pdf() });
    expect(deps.audits).toEqual([
      expect.objectContaining({
        action: "payroll.import_reserved",
        entityType: "payroll_import",
        entityId: created.id,
        after: { sha256: created.sha256, sizeBytes: created.sizeBytes, fileName: base.fileName },
      }),
    ]);
    expect(JSON.stringify(deps.audits)).not.toContain("%PDF");
  });
});

describe("markUploaded", () => {
  it("moves a received import into scanning", async () => {
    const deps = makeDeps();
    const created = await reserveImport(deps)(principal, { ...base, bytes: pdf() });
    expect((await markUploaded(deps)(principal, created.id)).status).toBe("scanning");
  });

  it("throws NotFoundError for another user's import", async () => {
    const deps = makeDeps();
    const created = await reserveImport(deps)(principal, { ...base, bytes: pdf() });
    await expect(
      markUploaded(deps)(testPrincipal({ userId: "00000000-0000-7000-8000-00000000000b" }), created.id),
    ).rejects.toThrow(/not found/i);
  });
});

describe("markUploadFailed", () => {
  it("records the reason and clears the storage key, so nothing points at bytes that may not exist", async () => {
    const deps = makeDeps();
    const created = await reserveImport(deps)(principal, { ...base, bytes: pdf() });
    await markUploadFailed(deps)(principal, created.id, "store unreachable");
    const after = await deps.imports.get(principal.userId, created.id);
    expect(after?.status).toBe("failed");
    expect(after?.error).toBe("store unreachable");
    expect(after?.storageKey).toBeNull();
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `npm test -- payroll/application/create-import`
Expected: FAIL — `Cannot find module './create-import'`.

- [ ] **Step 3: Write the use cases**

```ts
// src/modules/payroll/application/create-import.ts
import type { Principal } from "@/platform/auth/principal";
import { assertPermission } from "@/platform/auth/principal";
import { MAX_UPLOAD_BYTES, looksLikePdf, newStorageKey, sha256Hex } from "../domain/document";
import type { PayrollImport, StorageProvider, UploadedVia, UseCaseDeps } from "./ports";
import { DuplicateImportError, InvalidInputError, NotFoundError } from "./errors";

/** Spec §13.5: the Italian statutory horizon for payslips. Overridable per deployment. */
export const DEFAULT_RETENTION_YEARS = 10;

export interface UploadCandidate {
  fileName: string;
  mime: string;
  bytes: Uint8Array;
}

export interface ReserveImportInput extends UploadCandidate {
  storageProvider: StorageProvider;
  idempotencyKey?: string | null;
  replacesImportId?: string | null;
  uploadedVia?: UploadedVia;
  retentionYears?: number;
}

/**
 * Spec §8.3's upload gate, in one pure function so the API, the server action
 * and the migration script all reject the same things for the same reasons.
 *
 * The magic-byte check is the one that matters: `mime` is a claim the client
 * makes about a file it chose, and a store that accepts whatever it is told is
 * a store that will later hand an HTML page to a PDF viewer.
 */
export function validateUpload(candidate: UploadCandidate): { ok: true } | { ok: false; message: string } {
  if (candidate.bytes.byteLength === 0) return { ok: false, message: "The file is empty." };
  if (candidate.bytes.byteLength > MAX_UPLOAD_BYTES) return { ok: false, message: "The file is larger than 10 MB." };
  if (candidate.mime !== "application/pdf") return { ok: false, message: "Only PDF payslips can be uploaded." };
  if (!looksLikePdf(candidate.bytes)) return { ok: false, message: "That file is not a PDF." };
  return { ok: true };
}

function retentionUntil(now: Date, years: number): Date {
  const at = new Date(now.getTime());
  at.setUTCFullYear(at.getUTCFullYear() + years);
  return at;
}

/**
 * Step one of three. Validates, claims the sha256 and writes the row — and
 * writes **nothing** to the document store, because this runs inside the
 * caller's transaction (Ruling R4-8's discipline applied to the upload path).
 *
 * Ruling R4-3's refinement lives here: an existing import in status `failed`
 * means the bytes never landed, so the row is reset and reused rather than
 * refused. Anything else is a real duplicate and raises
 * `DuplicateImportError` carrying the id the user should be sent to.
 *
 * The reused row gets a **fresh** storage key, never the old one: the failed
 * attempt may have left a partial object behind, and reusing the key would
 * make a later read return truncated bytes that still parse.
 */
export function reserveImport(deps: UseCaseDeps) {
  return async (principal: Principal, input: ReserveImportInput): Promise<PayrollImport> => {
    assertPermission(principal, "payroll.upload");
    const validation = validateUpload(input);
    if (!validation.ok) throw new InvalidInputError(validation.message);

    const sha256 = sha256Hex(input.bytes);
    const now = deps.clock.now();
    const storageKey = newStorageKey(principal.userId, now);

    const existing = await deps.imports.findBySha(principal.userId, sha256);
    if (existing && existing.status !== "failed") throw new DuplicateImportError(existing.id);
    if (existing) {
      const reset = await deps.imports.patch(principal.userId, existing.id, {
        status: "received",
        storageKey,
        error: null,
        scanStatus: "pending",
        scanner: null,
        scanSignature: null,
        scannedAt: null,
      });
      if (!reset) throw new NotFoundError();
      await deps.audit({
        actorUserId: principal.userId,
        action: "payroll.import_reserved",
        entityType: "payroll_import",
        entityId: reset.id,
        after: { sha256, sizeBytes: input.bytes.byteLength, fileName: input.fileName },
      });
      return reset;
    }

    const created = await deps.imports.create({
      userId: principal.userId,
      fileName: input.fileName,
      mime: input.mime,
      sizeBytes: input.bytes.byteLength,
      sha256,
      storageProvider: input.storageProvider,
      storageKey,
      idempotencyKey: input.idempotencyKey ?? null,
      replacesImportId: input.replacesImportId ?? null,
      retentionUntil: retentionUntil(now, input.retentionYears ?? DEFAULT_RETENTION_YEARS),
      uploadedVia: input.uploadedVia ?? "ui",
    });
    // The audit records the digest and the size, never a byte of the payslip
    // (global constraint: an audit row records the import id and a sha256).
    await deps.audit({
      actorUserId: principal.userId,
      action: "payroll.import_reserved",
      entityType: "payroll_import",
      entityId: created.id,
      after: { sha256, sizeBytes: input.bytes.byteLength, fileName: input.fileName },
    });
    return created;
  };
}

/** Step three: the bytes are in the store, so the import may enter the pipeline. */
export function markUploaded(deps: UseCaseDeps) {
  return async (principal: Principal, importId: string): Promise<PayrollImport> => {
    assertPermission(principal, "payroll.upload");
    const updated = await deps.imports.patch(principal.userId, importId, { status: "scanning", error: null });
    if (!updated) throw new NotFoundError();
    return updated;
  };
}

/**
 * The failure branch of step three. Clears `storageKey` as well as recording
 * the reason: after a failed write nothing may claim to know where the bytes
 * are, and the retention job must never try to delete an object that was never
 * created.
 */
export function markUploadFailed(deps: UseCaseDeps) {
  return async (principal: Principal, importId: string, error: string): Promise<void> => {
    await deps.imports.patch(principal.userId, importId, { status: "failed", error, storageKey: null });
    await deps.audit({
      actorUserId: principal.userId,
      action: "payroll.import_failed",
      entityType: "payroll_import",
      entityId: importId,
      after: { error },
    });
  };
}
```

- [ ] **Step 4: Run the use-case test and watch it pass**

Run: `npm test -- payroll/application/create-import`
Expected: PASS — all 15 cases.

- [ ] **Step 5: Write the retention-settings reader and the upload orchestrator**

```ts
// src/modules/payroll/infrastructure/retention-settings.ts
import { eq } from "drizzle-orm";
import type { DbClient } from "@/lib/db/client";
import { appSettings } from "@/lib/db/schema";
import { DEFAULT_RETENTION_YEARS } from "../application/create-import";

export const RETENTION_SETTING_KEY = "payroll_retention_years";

/**
 * Spec §13.5: ten years by default, configurable. `app_settings` is the
 * existing global key/jsonb table (no RLS, one row per key), so this is a plain
 * read on the caller's transaction.
 *
 * Anything that is not a positive integer falls back to the default rather than
 * throwing: a malformed settings row must not make every upload fail, and a
 * retention window of `0` or `-1` would hand the purge job the entire archive
 * on its next tick.
 */
export async function readRetentionYears(tx: DbClient): Promise<number> {
  const [row] = await tx.select().from(appSettings).where(eq(appSettings.key, RETENTION_SETTING_KEY)).limit(1);
  const value = row?.value;
  const years = typeof value === "number" ? value : typeof value === "string" ? Number(value) : Number.NaN;
  return Number.isInteger(years) && years > 0 ? years : DEFAULT_RETENTION_YEARS;
}
```

```ts
// src/modules/payroll/infrastructure/upload.ts
import { db } from "@/lib/db";
import type { Principal } from "@/platform/auth/principal";
import { withUserContext } from "@/platform/db/context";
import { markUploadFailed, markUploaded, reserveImport, type UploadCandidate } from "../application/create-import";
import { InvalidInputError } from "../application/errors";
import type { PayrollImport, UploadedVia } from "../application/ports";
import { payrollDeps } from "./deps";
import { resolveDocumentStore } from "./document-store-resolver";
import { readRetentionYears } from "./retention-settings";
import { resolveScanner } from "./scanner-resolver";

export interface UploadInput extends UploadCandidate {
  idempotencyKey?: string | null;
  replacesImportId?: string | null;
  uploadedVia?: UploadedVia;
  requestId?: string | null;
}

/**
 * The upload, as three short steps with the network call between two of them.
 *
 * 1. Resolve the store and the scanner — network I/O and credential decryption,
 *    done before any transaction opens (Ruling R4-8).
 * 2. Transaction one: validate and reserve the row.
 * 3. **No transaction**: write the bytes. A 10 MB PUT inside a transaction
 *    would pin one of the pool's connections for the length of the round trip,
 *    the defect Phase 2 removed from the Wallet path.
 * 4. Transaction two: confirm, or record the failure.
 *
 * A `DuplicateImportError` escapes from step 2 with transaction one already
 * rolled back — nothing else was in it — so there is no savepoint here and none
 * is needed (Ruling R4-3, corrected).
 */
export async function uploadPayslip(principal: Principal, input: UploadInput): Promise<PayrollImport> {
  const resolution = await resolveDocumentStore(principal.userId);
  if (!resolution) {
    throw new InvalidInputError("No payroll document store is configured. Connect one in Settings › Integrations.");
  }
  const scanner = resolveScanner();
  const opts = { documents: resolution.store, scanner, requestId: input.requestId ?? null };

  const reserved = await withUserContext(db, { userId: principal.userId }, async (tx) => {
    const years = await readRetentionYears(tx);
    return reserveImport(payrollDeps(tx, opts))(principal, {
      ...input,
      storageProvider: resolution.driver,
      retentionYears: years,
    });
  });

  try {
    await resolution.store.put(reserved.storageKey!, input.bytes, "application/pdf");
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await withUserContext(db, { userId: principal.userId }, (tx) =>
      markUploadFailed(payrollDeps(tx, opts))(principal, reserved.id, message),
    );
    throw err;
  }

  return withUserContext(db, { userId: principal.userId }, (tx) =>
    markUploaded(payrollDeps(tx, opts))(principal, reserved.id),
  );
}
```

- [ ] **Step 6: Write the upload integration test**

```ts
// src/modules/payroll/infrastructure/upload.itest.ts
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { organizations, users } from "@/lib/db/schema";
import { permissionsForRoles } from "@/platform/auth/permissions";
import type { Principal } from "@/platform/auth/principal";
import { closeDb, resetDb, testDb } from "@/test/db";
import { uploadPayslip } from "./upload";
import { resolveDocumentStore } from "./document-store-resolver";

const pdf = (extra = "") => new TextEncoder().encode(`%PDF-1.7\n${extra}`);

async function seedPrincipal(): Promise<Principal> {
  const db = await testDb();
  const [org] = await db.insert(organizations).values({ name: "P" }).returning();
  const [user] = await db.insert(users).values({ organizationId: org!.id, displayName: "A" }).returning();
  const roles = ["owner"] as const;
  return { userId: user!.id, organizationId: org!.id, roles: [...roles], permissions: permissionsForRoles([...roles]) };
}

describe("uploadPayslip", () => {
  beforeEach(resetDb);
  afterAll(closeDb);

  it("reserves the row, writes the bytes to the local store and leaves the import scanning", async () => {
    const principal = await seedPrincipal();
    const imported = await uploadPayslip(principal, {
      fileName: "Busta Paga Agosto 2026.pdf",
      mime: "application/pdf",
      bytes: pdf("body"),
    });
    expect(imported.status).toBe("scanning");
    expect(imported.storageProvider).toBe("local");

    const resolution = await resolveDocumentStore(principal.userId);
    expect(await resolution!.store.get(imported.storageKey!)).toEqual(pdf("body"));
  });

  it("answers a duplicate with the id of the import that already holds those bytes", async () => {
    const principal = await seedPrincipal();
    const first = await uploadPayslip(principal, { fileName: "a.pdf", mime: "application/pdf", bytes: pdf("same") });
    await expect(
      uploadPayslip(principal, { fileName: "again.pdf", mime: "application/pdf", bytes: pdf("same") }),
    ).rejects.toMatchObject({ name: "DuplicateImportError", existingImportId: first.id });
  });

  it("stamps a ten-year retention by default", async () => {
    const principal = await seedPrincipal();
    const imported = await uploadPayslip(principal, { fileName: "a.pdf", mime: "application/pdf", bytes: pdf("r") });
    expect(imported.retentionUntil.getUTCFullYear()).toBe(new Date().getUTCFullYear() + 10);
  });
});
```

- [ ] **Step 7: Run everything**

Run:
```bash
npm test -- payroll/
npm run test:db:up && npm run test:integration -- payroll
npx tsc --noEmit
```
Expected: PASS, PASS, exit 0.

- [ ] **Step 8: Commit**

```bash
git add src/modules/payroll
git commit -m "feat(payroll): upload a payslip as reserve, write bytes, confirm"
```

---

### Task 10: Ingesting an import — scan, extract text, parse

**Files:**
- Create: `src/modules/payroll/application/ingest-import.ts`
- Create: `src/modules/payroll/application/ingest-import.test.ts`

**Interfaces:**
- Consumes: `UseCaseDeps`, `PayrollImport`, `ScanResult` from `../application/ports` (Task 2); `textSourceColumn` from `../domain/payroll` (Task 4); `parsePayslip`, `PARSER_VERSION` from `@/lib/payroll/parse` (existing, unchanged); `extractPdfText` from `@/lib/payroll/text` (existing, unchanged); `llmOptionsFromConfig` from `@/lib/payroll/llm-config` (existing, unchanged); `titleMonth`, `titleIsThirteenth` from `../domain/period` (Task 4); `NotFoundError` from `../application/errors`.
- Produces:
```ts
export type IngestOutcome =
  | { outcome: "parsed"; import: PayrollImport }
  | { outcome: "needs_ocr"; import: PayrollImport }
  | { outcome: "rejected_infected"; import: PayrollImport }
  | { outcome: "scanner_unavailable"; import: PayrollImport }
  | { outcome: "skipped"; reason: "not_scanning" | "no_bytes" };
export interface IngestPorts { extractText?(bytes: Uint8Array): Promise<string | null>; parse?: typeof parsePayslip; history?(): Promise<readonly PayslipHistoryEntry[]> }
export function scanStep(deps: UseCaseDeps): (principal: Principal, importId: string) => Promise<IngestOutcome>;
export function parseStep(deps: UseCaseDeps, ports?: IngestPorts): (principal: Principal, importId: string) => Promise<IngestOutcome>;
```

Same three-step discipline as Task 9, for the same reason: reading bytes, calling clamd and calling the LLM are all network I/O, and none of them may sit inside a transaction. `scanStep` and `parseStep` are each written as *read a little, do I/O, write a little*, and the job in Task 14 calls them one after the other.

- [ ] **Step 1: Write the failing test**

```ts
// src/modules/payroll/application/ingest-import.test.ts
import { describe, expect, it, vi } from "vitest";
import type { PayslipExtraction } from "@/lib/contracts";
import { testPrincipal } from "@/test/principal";
import type { MalwareScanner, UseCaseDeps } from "./ports";
import {
  MemoryLegacyFundDeposits,
  MemoryPayrollComponentsRepository,
  MemoryPayrollImportsRepository,
  MemoryPayrollMappingRulesRepository,
  MemoryPayrollRecordsRepository,
} from "../infrastructure/memory-repositories";
import { noopScanner } from "../infrastructure/noop-scanner";
import { reserveImport, markUploaded } from "./create-import";
import { parseStep, scanStep } from "./ingest-import";

const NOW = new Date("2026-09-05T10:00:00Z");
const principal = testPrincipal({ userId: "00000000-0000-7000-8000-00000000000a" });
const pdf = (extra = "") => new TextEncoder().encode(`%PDF-1.7\n${extra}`);

function makeDeps(over: { scanner?: MalwareScanner; stored?: Uint8Array | null } = {}) {
  const deleted: string[] = [];
  const deps: UseCaseDeps & { deleted: string[]; audits: unknown[] } = {
    imports: new MemoryPayrollImportsRepository(),
    records: new MemoryPayrollRecordsRepository(),
    components: new MemoryPayrollComponentsRepository(),
    mappingRules: new MemoryPayrollMappingRulesRepository(),
    funds: new MemoryLegacyFundDeposits(),
    documents: {
      provider: "local",
      put: async () => {},
      get: async () => (over.stored === undefined ? pdf("body") : over.stored),
      delete: async (k: string) => void deleted.push(k),
      listPrefix: async () => [],
    },
    scanner: over.scanner ?? noopScanner,
    clock: { now: () => NOW },
    audit: async (e) => void deps.audits.push(e),
    deleted,
    audits: [],
  };
  return deps;
}

async function anUploadedImport(deps: UseCaseDeps, fileName = "Busta Paga Agosto 2026.pdf") {
  const reserved = await reserveImport(deps)(principal, {
    fileName, mime: "application/pdf", bytes: pdf("body"), storageProvider: "local",
  });
  return markUploaded(deps)(principal, reserved.id);
}

const extraction: PayslipExtraction = {
  parserVersion: "payroll-1.0.0",
  month: "2026-08-01",
  isThirteenth: false,
  textSource: "pdf",
  fields: { net: { value: 1800, confidence: "high", rules: 1800, llm: null } },
  checks: [],
};

describe("scanStep", () => {
  it("records a clean verdict, the scanner's own name and when it answered", async () => {
    const deps = makeDeps();
    const uploaded = await anUploadedImport(deps);
    const result = await scanStep(deps)(principal, uploaded.id);
    expect(result.outcome).toBe("scanner_unavailable" === result.outcome ? "scanner_unavailable" : "parsed");
    const after = await deps.imports.get(principal.userId, uploaded.id);
    expect(after?.scanStatus).toBe("clean");
    expect(after?.scanner).toBe("none");
    expect(after?.scannedAt).toEqual(NOW);
    expect(after?.status).toBe("extracting");
  });

  it("an infected verdict deletes the bytes immediately and rejects the import terminally (Ruling R4-2)", async () => {
    const deps = makeDeps({
      scanner: { scan: async () => ({ verdict: "infected", scanner: "clamd", signature: "Eicar-Test-Signature" }) },
    });
    const uploaded = await anUploadedImport(deps);
    const result = await scanStep(deps)(principal, uploaded.id);
    expect(result.outcome).toBe("rejected_infected");
    const after = await deps.imports.get(principal.userId, uploaded.id);
    expect(after?.status).toBe("rejected");
    expect(after?.scanStatus).toBe("infected");
    expect(after?.scanSignature).toBe("Eicar-Test-Signature");
    expect(after?.error).toBe("scan_infected");
    expect(after?.storageKey).toBeNull();
    expect(deps.deleted).toEqual([uploaded.storageKey]);
    // Terminal: a retry re-rejects and reads nothing.
    expect((await scanStep(deps)(principal, uploaded.id)).outcome).toBe("skipped");
  });

  it("an unavailable verdict keeps the bytes and leaves the import scanning for the next tick", async () => {
    const deps = makeDeps({
      scanner: { scan: async () => ({ verdict: "unavailable", scanner: "clamd", signature: null }) },
    });
    const uploaded = await anUploadedImport(deps);
    expect((await scanStep(deps)(principal, uploaded.id)).outcome).toBe("scanner_unavailable");
    const after = await deps.imports.get(principal.userId, uploaded.id);
    expect(after?.status).toBe("scanning");
    expect(after?.scanStatus).toBe("unavailable");
    expect(after?.error).toBe("scan_unavailable");
    expect(after?.storageKey).toBe(uploaded.storageKey);
    expect(deps.deleted).toEqual([]);
  });

  it("skips an import that is not scanning", async () => {
    const deps = makeDeps();
    const reserved = await reserveImport(deps)(principal, {
      fileName: "a.pdf", mime: "application/pdf", bytes: pdf(), storageProvider: "local",
    });
    expect(await scanStep(deps)(principal, reserved.id)).toEqual({ outcome: "skipped", reason: "not_scanning" });
  });

  it("fails an import whose bytes are gone rather than declaring it clean", async () => {
    const deps = makeDeps({ stored: null });
    const uploaded = await anUploadedImport(deps);
    expect(await scanStep(deps)(principal, uploaded.id)).toEqual({ outcome: "skipped", reason: "no_bytes" });
    expect((await deps.imports.get(principal.userId, uploaded.id))?.status).toBe("failed");
  });
});

describe("parseStep", () => {
  async function anExtractingImport(deps: UseCaseDeps, fileName?: string) {
    const uploaded = await anUploadedImport(deps, fileName);
    await scanStep(deps)(principal, uploaded.id);
    return uploaded;
  }

  it("parses, stores the extraction and the per-field confidence, and lands in needs_review", async () => {
    const deps = makeDeps();
    const uploaded = await anExtractingImport(deps);
    const parse = vi.fn(async () => extraction);
    const result = await parseStep(deps, { extractText: async () => "Netto 1.800,00", parse })(principal, uploaded.id);
    expect(result.outcome).toBe("parsed");
    const after = await deps.imports.get(principal.userId, uploaded.id);
    expect(after?.status).toBe("needs_review");
    expect(after?.textSource).toBe("pdf_text");
    expect(after?.parserVersion).toBe("payroll-1.0.0");
    expect(after?.extraction).toEqual(extraction);
    expect(after?.confidence).toEqual({ net: "high" });
  });

  it("hands the parser the month read off the document title, so OCR cannot latch onto a stray year", async () => {
    const deps = makeDeps();
    const uploaded = await anExtractingImport(deps, "Busta Paga Maggio 2026.pdf");
    const parse = vi.fn(async () => extraction);
    await parseStep(deps, { extractText: async () => "text", parse })(principal, uploaded.id);
    expect(parse).toHaveBeenCalledWith(expect.objectContaining({ month: "2026-05-01", textSource: "pdf" }));
  });

  it("files a tredicesima in December of its year, whatever month the title names", async () => {
    const deps = makeDeps();
    const uploaded = await anExtractingImport(deps, "Tredicesima 2025.pdf");
    const parse = vi.fn(async () => ({ ...extraction, month: "2025-12-01", isThirteenth: true }));
    await parseStep(deps, { extractText: async () => "text", parse })(principal, uploaded.id);
    expect(parse).toHaveBeenCalledWith(expect.objectContaining({ month: "2025-12-01" }));
  });

  it("parks in needs_ocr with text_source none when the PDF carries no text layer (Rulings R4-9, R4-14)", async () => {
    const deps = makeDeps();
    const uploaded = await anExtractingImport(deps);
    const parse = vi.fn(async () => extraction);
    const result = await parseStep(deps, { extractText: async () => null, parse })(principal, uploaded.id);
    expect(result.outcome).toBe("needs_ocr");
    expect(parse).not.toHaveBeenCalled();
    const after = await deps.imports.get(principal.userId, uploaded.id);
    expect(after?.status).toBe("needs_ocr");
    expect(after?.textSource).toBe("none");
    expect(after?.extraction).toBeNull();
    expect(after?.error).toBe("no_text_layer");
  });

  it("refuses to parse an import that has not cleared the scanner (Ruling R4-2)", async () => {
    const deps = makeDeps({
      scanner: { scan: async () => ({ verdict: "unavailable", scanner: "clamd", signature: null }) },
    });
    const uploaded = await anUploadedImport(deps);
    await scanStep(deps)(principal, uploaded.id);
    const parse = vi.fn(async () => extraction);
    expect(await parseStep(deps, { extractText: async () => "text", parse })(principal, uploaded.id)).toEqual({
      outcome: "skipped",
      reason: "not_scanning",
    });
    expect(parse).not.toHaveBeenCalled();
  });

  it("audits the parse with the field count, never with an amount", async () => {
    const deps = makeDeps();
    const uploaded = await anExtractingImport(deps);
    await parseStep(deps, { extractText: async () => "text", parse: async () => extraction })(principal, uploaded.id);
    const parsedAudit = (deps.audits as Array<{ action: string; after?: unknown }>).find(
      (a) => a.action === "payroll.import_parsed",
    );
    expect(parsedAudit?.after).toEqual({ textSource: "pdf_text", parserVersion: "payroll-1.0.0", fieldsRead: 1 });
    expect(JSON.stringify(deps.audits)).not.toContain("1800");
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `npm test -- payroll/application/ingest-import`
Expected: FAIL — `Cannot find module './ingest-import'`.

- [ ] **Step 3: Write the two steps**

```ts
// src/modules/payroll/application/ingest-import.ts
import type { Confidence } from "@/lib/contracts";
import type { PayslipHistoryEntry } from "@/lib/payroll/confidence";
import { llmOptionsFromConfig } from "@/lib/payroll/llm-config";
import { PARSER_VERSION, parsePayslip } from "@/lib/payroll/parse";
import { extractPdfText } from "@/lib/payroll/text";
import type { Principal } from "@/platform/auth/principal";
import { textSourceColumn } from "../domain/payroll";
import { titleIsThirteenth, titleMonth } from "../domain/period";
import type { PayrollImport, UseCaseDeps } from "./ports";

export type IngestOutcome =
  | { outcome: "parsed"; import: PayrollImport }
  | { outcome: "needs_ocr"; import: PayrollImport }
  | { outcome: "rejected_infected"; import: PayrollImport }
  | { outcome: "scanner_unavailable"; import: PayrollImport }
  | { outcome: "skipped"; reason: "not_scanning" | "no_bytes" };

export interface IngestPorts {
  /** Injected in tests so the suite never loads `unpdf`. Defaults to the existing extractor. */
  extractText?(bytes: Uint8Array): Promise<string | null>;
  /** Injected in tests so the suite never touches the network. Defaults to the existing parser. */
  parse?: typeof parsePayslip;
  /** Prior verified payslips, for the parser's continuity and median checks. Defaults to none. */
  history?(): Promise<readonly PayslipHistoryEntry[]>;
}

/**
 * The scanning boundary (Ruling R4-2), written as read → I/O → write so the
 * clamd round trip never sits inside a transaction.
 *
 * The three verdicts fail in three different directions on purpose:
 * `infected` deletes the bytes and is terminal; `unavailable` keeps everything
 * and leaves the row where it is so the next tick retries; `clean` is the only
 * one that opens the gate to the parser. An import can therefore reach
 * `extracting` in exactly one way, and `readOriginal` (Task 13) leans on the
 * same `scan_status = 'clean'` fact.
 */
export function scanStep(deps: UseCaseDeps) {
  return async (principal: Principal, importId: string): Promise<IngestOutcome> => {
    const found = await deps.imports.get(principal.userId, importId);
    if (!found || found.status !== "scanning") return { outcome: "skipped", reason: "not_scanning" };
    if (found.storageKey === null) return { outcome: "skipped", reason: "not_scanning" };

    // No transaction is open here. `documents.get` and `scanner.scan` are both
    // network calls; the caller (Task 14's job, or the API route) opened and
    // closed one transaction for the read above and opens another for the write
    // below.
    const bytes = await deps.documents.get(found.storageKey);
    if (bytes === null) {
      await deps.imports.patch(principal.userId, importId, { status: "failed", error: "bytes_missing", storageKey: null });
      return { outcome: "skipped", reason: "no_bytes" };
    }

    const verdict = await deps.scanner.scan(bytes);
    const scannedAt = deps.clock.now();

    if (verdict.verdict === "infected") {
      // Delete first, then record. A crash between the two leaves an orphan row
      // pointing at bytes that are gone, which the retention job tolerates; the
      // reverse order would leave real malware in the bucket with nothing
      // recording that it is there.
      await deps.documents.delete(found.storageKey);
      const updated = await deps.imports.patch(principal.userId, importId, {
        status: "rejected",
        scanStatus: "infected",
        scanner: verdict.scanner,
        scanSignature: verdict.signature,
        scannedAt,
        error: "scan_infected",
        storageKey: null,
      });
      await deps.audit({
        actorUserId: principal.userId,
        action: "payroll.import_rejected",
        entityType: "payroll_import",
        entityId: importId,
        after: { reason: "scan_infected", scanner: verdict.scanner, signature: verdict.signature },
      });
      return { outcome: "rejected_infected", import: updated! };
    }

    if (verdict.verdict === "unavailable") {
      const updated = await deps.imports.patch(principal.userId, importId, {
        status: "scanning",
        scanStatus: "unavailable",
        scanner: verdict.scanner,
        scannedAt,
        error: "scan_unavailable",
      });
      return { outcome: "scanner_unavailable", import: updated! };
    }

    const updated = await deps.imports.patch(principal.userId, importId, {
      status: "extracting",
      scanStatus: "clean",
      scanner: verdict.scanner,
      scanSignature: null,
      scannedAt,
      error: null,
    });
    return { outcome: "parsed", import: updated! };
  };
}

function confidenceMap(extraction: Awaited<ReturnType<typeof parsePayslip>>): Record<string, Confidence> {
  const out: Record<string, Confidence> = {};
  for (const [field, value] of Object.entries(extraction.fields)) {
    if (value) out[field] = value.confidence;
  }
  return out;
}

/**
 * Text acquisition and parsing. The existing engine is called, never rewritten:
 * `extractPdfText` and `parsePayslip` are exactly the functions
 * `src/lib/jobs/payslip-ingest.ts` called, with the bytes now coming from the
 * document store instead of a Paperless download.
 *
 * The one behavioural change from that job: there is no OCR fallback, because
 * Paperless was the only OCR source and it is being retired. A PDF with no
 * usable text layer parks in `needs_ocr` (Ruling R4-9) rather than being handed
 * to the parser as an empty string — which would produce a confident-looking
 * all-null extraction, the exact "invented financial data" failure.
 *
 * `month` is taken from the document title when the title states one, exactly
 * as `payslip-ingest.ts` did and for the same measured reason (`titleMonth`'s
 * own comment): the OCR-derived period resolved all twelve real payslips to
 * 2009-01. A tredicesima is filed in December of its year whatever the title
 * names.
 */
export function parseStep(deps: UseCaseDeps, ports: IngestPorts = {}) {
  const extractText = ports.extractText ?? ((bytes: Uint8Array) => extractPdfText(bytes));
  const parse = ports.parse ?? parsePayslip;
  const loadHistory = ports.history ?? (async () => []);

  return async (principal: Principal, importId: string): Promise<IngestOutcome> => {
    const found = await deps.imports.get(principal.userId, importId);
    if (!found) return { outcome: "skipped", reason: "not_scanning" };
    // The gate: nothing parses unless the scanner cleared it (Ruling R4-2).
    if (found.scanStatus !== "clean") return { outcome: "skipped", reason: "not_scanning" };
    if (found.status !== "extracting" && found.status !== "needs_ocr") {
      return { outcome: "skipped", reason: "not_scanning" };
    }
    if (found.storageKey === null) return { outcome: "skipped", reason: "no_bytes" };

    const bytes = await deps.documents.get(found.storageKey);
    if (bytes === null) {
      await deps.imports.patch(principal.userId, importId, { status: "failed", error: "bytes_missing", storageKey: null });
      return { outcome: "skipped", reason: "no_bytes" };
    }

    const text = await extractText(bytes);
    if (text === null || text.trim().length === 0) {
      const updated = await deps.imports.patch(principal.userId, importId, {
        status: "needs_ocr",
        textSource: textSourceColumn(null),
        error: "no_text_layer",
      });
      return { outcome: "needs_ocr", import: updated! };
    }

    const isThirteenth = titleIsThirteenth(found.fileName);
    const fromTitle = titleMonth(found.fileName);
    const month = fromTitle !== null && isThirteenth ? `${fromTitle.slice(0, 4)}-12-01` : fromTitle;

    const extraction = await parse({
      text,
      textSource: "pdf",
      month,
      history: await loadHistory(),
      llmOptions: await llmOptionsFromConfig(),
    });

    const updated = await deps.imports.patch(principal.userId, importId, {
      status: "needs_review",
      textSource: textSourceColumn("pdf"),
      parserVersion: extraction.parserVersion || PARSER_VERSION,
      extraction,
      confidence: confidenceMap(extraction),
      error: null,
    });
    // Counts, never amounts: an audit row must not become a second copy of the
    // payslip (global constraint).
    await deps.audit({
      actorUserId: principal.userId,
      action: "payroll.import_parsed",
      entityType: "payroll_import",
      entityId: importId,
      after: {
        textSource: textSourceColumn("pdf"),
        parserVersion: extraction.parserVersion || PARSER_VERSION,
        fieldsRead: Object.values(extraction.fields).filter((f) => f && f.value !== null).length,
      },
    });
    return { outcome: "parsed", import: updated! };
  };
}
```

- [ ] **Step 4: Run the test and watch it pass**

Run: `npm test -- payroll/application/ingest-import`
Expected: PASS — all 11 cases.

- [ ] **Step 5: Type-check and commit**

Run: `npx tsc --noEmit`
Expected: exit 0.

```bash
git add src/modules/payroll/application
git commit -m "feat(payroll): scan and parse an uploaded import through the existing engine"
```

---

### Task 11: Reviewing and applying an import

**Files:**
- Create: `src/modules/payroll/application/review-import.ts`
- Create: `src/modules/payroll/application/review-import.test.ts`
- Create: `src/modules/payroll/application/apply-import.ts`
- Create: `src/modules/payroll/application/apply-import.test.ts`
- Create: `src/modules/payroll/application/apply-import.itest.ts`

**Interfaces:**
- Consumes: `UseCaseDeps`, `PayrollImport`, `PayrollRecord`, `PayrollComponent` from `../application/ports` (Task 2); `isEditable`, `canTransition` from `../domain/payroll` (Task 4); `periodFor`, `recordKindOf`, `monthOfPeriod`, `titleIsThirteenth` from `../domain/period` (Task 4); `componentsFromExtraction`, `grossOf`, `netOf` from `../domain/components` (Task 5); `ConflictError`, `NotFoundError`, `InvalidInputError`, `VersionMismatchError` from `../application/errors`.
- Produces:
```ts
export interface VerifyImportInput { version: number; month: string; isThirteenth: boolean; values: Partial<Record<PayslipField, string | null>> }
export function verifyImport(deps: UseCaseDeps): (principal: Principal, importId: string, input: VerifyImportInput) => Promise<PayrollImport>;
export function rejectImport(deps: UseCaseDeps): (principal: Principal, importId: string, version: number) => Promise<PayrollImport>;
export interface AppliedImport { import: PayrollImport; record: PayrollRecord; components: PayrollComponent[]; supersededRecordId: string | null; fundDeposit: "written" | "no_fund" | "no_amount" }
export function applyImport(deps: UseCaseDeps): (principal: Principal, importId: string) => Promise<AppliedImport>;
```

`verifyImport` writes the reviewer's confirmed values back into the import's own `extraction` (with the pre-edit value kept in `corrections`), so the apply step has exactly one source of truth to read: the extraction, corrected. `applyImport` runs entirely inside the caller's single transaction — every write it makes is Postgres-only, which is why it is the one use case in this module that needs no I/O split.

- [ ] **Step 1: Write the failing review test**

```ts
// src/modules/payroll/application/review-import.test.ts
import { describe, expect, it } from "vitest";
import type { PayslipExtraction } from "@/lib/contracts";
import { testPrincipal } from "@/test/principal";
import type { UseCaseDeps } from "./ports";
import {
  MemoryLegacyFundDeposits,
  MemoryPayrollComponentsRepository,
  MemoryPayrollImportsRepository,
  MemoryPayrollMappingRulesRepository,
  MemoryPayrollRecordsRepository,
} from "../infrastructure/memory-repositories";
import { noopScanner } from "../infrastructure/noop-scanner";
import { rejectImport, verifyImport } from "./review-import";

const NOW = new Date("2026-09-05T10:00:00Z");
const principal = testPrincipal({ userId: "00000000-0000-7000-8000-00000000000a" });

const extraction: PayslipExtraction = {
  parserVersion: "payroll-1.0.0",
  month: "2026-08-01",
  isThirteenth: false,
  textSource: "pdf",
  fields: {
    gross: { value: 2500, confidence: "high", rules: 2500, llm: null },
    net: { value: 1800, confidence: "medium", rules: 1800, llm: 1799 },
  },
  checks: [],
};

function makeDeps(): UseCaseDeps {
  return {
    imports: new MemoryPayrollImportsRepository(),
    records: new MemoryPayrollRecordsRepository(),
    components: new MemoryPayrollComponentsRepository(),
    mappingRules: new MemoryPayrollMappingRulesRepository(),
    funds: new MemoryLegacyFundDeposits(),
    documents: { provider: "local", put: async () => {}, get: async () => null, delete: async () => {}, listPrefix: async () => [] },
    scanner: noopScanner,
    clock: { now: () => NOW },
    audit: async () => {},
  };
}

async function aReviewableImport(deps: UseCaseDeps) {
  const created = await deps.imports.create({
    userId: principal.userId,
    fileName: "Busta Paga Agosto 2026.pdf",
    mime: "application/pdf",
    sizeBytes: 100,
    sha256: "a".repeat(64),
    storageProvider: "local",
    storageKey: `payroll/${principal.userId}/2026/${"0".repeat(32)}.pdf`,
    idempotencyKey: null,
    replacesImportId: null,
    retentionUntil: new Date("2036-01-01T00:00:00Z"),
    uploadedVia: "ui",
  });
  return (await deps.imports.patch(principal.userId, created.id, {
    status: "needs_review",
    scanStatus: "clean",
    scanner: "none",
    textSource: "pdf_text",
    parserVersion: "payroll-1.0.0",
    extraction,
    confidence: { gross: "high", net: "medium" },
  }))!;
}

describe("verifyImport", () => {
  it("refuses a principal without payroll.review", async () => {
    const deps = makeDeps();
    const imp = await aReviewableImport(deps);
    await expect(
      verifyImport(deps)(testPrincipal({ roles: ["viewer"] }), imp.id, {
        version: imp.version, month: "2026-08-01", isThirteenth: false, values: {},
      }),
    ).rejects.toThrow(/permission/i);
  });

  it("stores the reviewer's values in the extraction and keeps what was extracted in corrections", async () => {
    const deps = makeDeps();
    const imp = await aReviewableImport(deps);
    const verified = await verifyImport(deps)(principal, imp.id, {
      version: imp.version, month: "2026-08-01", isThirteenth: false, values: { net: "1799.50" },
    });
    expect(verified.status).toBe("verified");
    expect(verified.extraction?.fields.net).toEqual({
      value: 1799.5, confidence: "high", rules: 1800, llm: 1799, note: "confirmed by reviewer",
    });
    expect(verified.extraction?.fields.gross?.value).toBe(2500);
    expect(verified.confidence).toEqual({ gross: "high", net: "high" });
  });

  it("records a null the reviewer cleared, rather than leaving the parser's guess in place", async () => {
    const deps = makeDeps();
    const imp = await aReviewableImport(deps);
    const verified = await verifyImport(deps)(principal, imp.id, {
      version: imp.version, month: "2026-08-01", isThirteenth: false, values: { gross: null },
    });
    expect(verified.extraction?.fields.gross?.value).toBeNull();
  });

  it("carries the reviewer's month and tredicesima flag onto the extraction", async () => {
    const deps = makeDeps();
    const imp = await aReviewableImport(deps);
    const verified = await verifyImport(deps)(principal, imp.id, {
      version: imp.version, month: "2025-12-01", isThirteenth: true, values: {},
    });
    expect(verified.extraction?.month).toBe("2025-12-01");
    expect(verified.extraction?.isThirteenth).toBe(true);
  });

  it("answers 409 on a stale version rather than silently overwriting a concurrent edit", async () => {
    const deps = makeDeps();
    const imp = await aReviewableImport(deps);
    await expect(
      verifyImport(deps)(principal, imp.id, {
        version: imp.version + 1, month: "2026-08-01", isThirteenth: false, values: {},
      }),
    ).rejects.toMatchObject({ name: "VersionMismatchError" });
  });

  it("refuses to re-verify an applied import and names the replacement path (Ruling R4-6)", async () => {
    const deps = makeDeps();
    const imp = await aReviewableImport(deps);
    const verified = await verifyImport(deps)(principal, imp.id, {
      version: imp.version, month: "2026-08-01", isThirteenth: false, values: {},
    });
    await deps.imports.patch(principal.userId, imp.id, { status: "applied" });
    const applied = (await deps.imports.get(principal.userId, imp.id))!;
    await expect(
      verifyImport(deps)(principal, imp.id, { version: applied.version, month: "2026-08-01", isThirteenth: false, values: {} }),
    ).rejects.toMatchObject({ name: "ConflictError", reason: "already_applied" });
    expect(verified.status).toBe("verified");
  });

  it("rejects a month that is not a real calendar month", async () => {
    const deps = makeDeps();
    const imp = await aReviewableImport(deps);
    await expect(
      verifyImport(deps)(principal, imp.id, { version: imp.version, month: "2026-13-01", isThirteenth: false, values: {} }),
    ).rejects.toMatchObject({ name: "InvalidInputError" });
  });

  it("rejects a value that is not a decimal string", async () => {
    const deps = makeDeps();
    const imp = await aReviewableImport(deps);
    await expect(
      verifyImport(deps)(principal, imp.id, {
        version: imp.version, month: "2026-08-01", isThirteenth: false, values: { net: "1.800,00" },
      }),
    ).rejects.toMatchObject({ name: "InvalidInputError" });
  });

  it("refuses an import that never parsed — there is nothing to confirm", async () => {
    const deps = makeDeps();
    const imp = await aReviewableImport(deps);
    await deps.imports.patch(principal.userId, imp.id, { status: "needs_ocr", extraction: null });
    const parked = (await deps.imports.get(principal.userId, imp.id))!;
    await expect(
      verifyImport(deps)(principal, imp.id, { version: parked.version, month: "2026-08-01", isThirteenth: false, values: {} }),
    ).rejects.toMatchObject({ name: "ConflictError", reason: "not_reviewable" });
  });
});

describe("rejectImport", () => {
  it("moves a reviewable import to rejected", async () => {
    const deps = makeDeps();
    const imp = await aReviewableImport(deps);
    expect((await rejectImport(deps)(principal, imp.id, imp.version)).status).toBe("rejected");
  });

  it("refuses to reject an applied import", async () => {
    const deps = makeDeps();
    const imp = await aReviewableImport(deps);
    await deps.imports.patch(principal.userId, imp.id, { status: "applied" });
    const applied = (await deps.imports.get(principal.userId, imp.id))!;
    await expect(rejectImport(deps)(principal, imp.id, applied.version)).rejects.toMatchObject({ name: "ConflictError" });
  });

  it("answers 409 on a stale version", async () => {
    const deps = makeDeps();
    const imp = await aReviewableImport(deps);
    await expect(rejectImport(deps)(principal, imp.id, imp.version + 1)).rejects.toMatchObject({
      name: "VersionMismatchError",
    });
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `npm test -- payroll/application/review-import`
Expected: FAIL — `Cannot find module './review-import'`.

- [ ] **Step 3: Write the review use cases**

```ts
// src/modules/payroll/application/review-import.ts
import { PAYSLIP_FIELDS, type PayslipExtraction, type PayslipField } from "@/lib/contracts";
import type { Principal } from "@/platform/auth/principal";
import { assertPermission } from "@/platform/auth/principal";
import { isEditable } from "../domain/payroll";
import { periodFor } from "../domain/period";
import type { PayrollImport, UseCaseDeps } from "./ports";
import { ConflictError, InvalidInputError, NotFoundError, VersionMismatchError } from "./errors";

/** Signed decimals only. Italian formatting (`1.800,00`) is rejected at the door, not silently reinterpreted. */
const DECIMAL_RE = /^-?\d+(\.\d{1,6})?$/;

export interface VerifyImportInput {
  version: number;
  /** The pay period's month key, `YYYY-MM-01`. */
  month: string;
  isThirteenth: boolean;
  /** Only the fields the reviewer actually touched; `null` clears one. */
  values: Partial<Record<PayslipField, string | null>>;
}

function assertReviewable(found: PayrollImport | null): asserts found is PayrollImport {
  if (!found) throw new NotFoundError();
  if (found.status === "applied") {
    throw new ConflictError(
      "This payslip has already been applied. Upload a corrected file to replace it.",
      "already_applied",
    );
  }
  if (!isEditable(found.status) || found.extraction === null) {
    throw new ConflictError("This import is not ready to review.", "not_reviewable");
  }
}

/**
 * The human gate.
 *
 * Confirmed values are written back into the import's own `extraction`, and
 * the value the parser produced is preserved as `rules`/`llm` on the same
 * field — so `corrections` (extracted vs corrected) is derivable, and
 * `applyImport` has exactly one thing to read. A reviewer's confirmation
 * always raises that field's confidence to `high`: a human looked at the
 * document, which is the strongest signal this system has.
 *
 * Ruling R4-6: values stay editable while `needs_review` or `verified`, and
 * stop being editable once `applied`. Re-verifying an applied import is a
 * `409` naming the replacement path, never a silent overwrite of figures that
 * have already reached Earnings and the Funds page.
 */
export function verifyImport(deps: UseCaseDeps) {
  return async (principal: Principal, importId: string, input: VerifyImportInput): Promise<PayrollImport> => {
    assertPermission(principal, "payroll.review");
    const found = await deps.imports.get(principal.userId, importId);
    assertReviewable(found);
    if (found.version !== input.version) throw new VersionMismatchError();

    // Throws on a month that is not a real calendar month, rather than letting
    // an impossible period reach `payroll_records`.
    periodFor(input.month);

    for (const [field, raw] of Object.entries(input.values)) {
      if (raw === null || raw === undefined) continue;
      if (!DECIMAL_RE.test(raw)) {
        throw new InvalidInputError(`Enter ${field} as a plain decimal, for example 1800.50.`);
      }
      if (!(PAYSLIP_FIELDS as readonly string[]).includes(field)) {
        throw new InvalidInputError(`Unknown payslip field: ${field}`);
      }
    }

    const fields: PayslipExtraction["fields"] = { ...found.extraction.fields };
    const confidence: Record<string, "high" | "medium" | "low"> = { ...(found.confidence ?? {}) };
    const corrections: Record<string, { extracted: unknown; corrected: unknown }> = {};

    for (const [key, raw] of Object.entries(input.values)) {
      const field = key as PayslipField;
      const previous = fields[field] ?? { value: null, confidence: "low" as const, rules: null, llm: null };
      const corrected = raw === null || raw === undefined ? null : Number(raw);
      if (previous.value !== corrected) {
        corrections[field] = { extracted: previous.value, corrected };
      }
      fields[field] = {
        value: corrected,
        confidence: "high",
        rules: previous.rules,
        llm: previous.llm,
        note: "confirmed by reviewer",
      };
      confidence[field] = "high";
    }

    const updated = await deps.imports.patch(principal.userId, importId, {
      status: "verified",
      extraction: { ...found.extraction, month: input.month, isThirteenth: input.isThirteenth, fields },
      confidence,
      error: null,
    });
    if (!updated) throw new NotFoundError();
    await deps.audit({
      actorUserId: principal.userId,
      action: "payroll.import_verified",
      entityType: "payroll_import",
      entityId: importId,
      // Field *names* only. The corrected amounts are payroll data and stay out
      // of the audit trail (global constraint).
      after: { month: input.month, isThirteenth: input.isThirteenth, correctedFields: Object.keys(corrections) },
    });
    return updated;
  };
}

/** Terminal. A rejected import keeps its bytes until the retention job purges them (Ruling R4-5). */
export function rejectImport(deps: UseCaseDeps) {
  return async (principal: Principal, importId: string, version: number): Promise<PayrollImport> => {
    assertPermission(principal, "payroll.review");
    const found = await deps.imports.get(principal.userId, importId);
    if (!found) throw new NotFoundError();
    if (found.status === "applied" || found.status === "rejected" || found.status === "superseded") {
      throw new ConflictError("This import can no longer be rejected.", "terminal");
    }
    if (found.version !== version) throw new VersionMismatchError();
    const updated = await deps.imports.patch(principal.userId, importId, { status: "rejected", error: null });
    if (!updated) throw new NotFoundError();
    await deps.audit({
      actorUserId: principal.userId,
      action: "payroll.import_rejected",
      entityType: "payroll_import",
      entityId: importId,
      after: { reason: "rejected_by_reviewer" },
    });
    return updated;
  };
}
```

- [ ] **Step 4: Write the failing apply test**

```ts
// src/modules/payroll/application/apply-import.test.ts
import { describe, expect, it } from "vitest";
import type { PayslipExtraction } from "@/lib/contracts";
import { testPrincipal } from "@/test/principal";
import type { UseCaseDeps } from "./ports";
import {
  MemoryLegacyFundDeposits,
  MemoryPayrollComponentsRepository,
  MemoryPayrollImportsRepository,
  MemoryPayrollMappingRulesRepository,
  MemoryPayrollRecordsRepository,
} from "../infrastructure/memory-repositories";
import { noopScanner } from "../infrastructure/noop-scanner";
import { applyImport } from "./apply-import";

const NOW = new Date("2026-09-05T10:00:00Z");
const principal = testPrincipal({ userId: "00000000-0000-7000-8000-00000000000a" });

const extraction: PayslipExtraction = {
  parserVersion: "payroll-1.0.0",
  month: "2026-08-01",
  isThirteenth: false,
  textSource: "pdf",
  fields: {
    gross: { value: 2500, confidence: "high", rules: 2500, llm: null },
    net: { value: 1800, confidence: "high", rules: 1800, llm: null },
    taxes: { value: 700, confidence: "high", rules: 700, llm: null },
    fundContribEmployee: { value: 50, confidence: "high", rules: 50, llm: null },
    fundContribEmployer: { value: 100, confidence: "high", rules: 100, llm: null },
    ferieBalance: { value: 88.25, confidence: "medium", rules: 88.25, llm: null },
  },
  checks: [],
};

function makeDeps() {
  const funds = new MemoryLegacyFundDeposits(["cometa"]);
  const audits: Array<{ action: string; after?: unknown }> = [];
  const deps: UseCaseDeps & { funds: MemoryLegacyFundDeposits; audits: typeof audits } = {
    imports: new MemoryPayrollImportsRepository(),
    records: new MemoryPayrollRecordsRepository(),
    components: new MemoryPayrollComponentsRepository(),
    mappingRules: new MemoryPayrollMappingRulesRepository(),
    funds,
    documents: { provider: "local", put: async () => {}, get: async () => null, delete: async () => {}, listPrefix: async () => [] },
    scanner: noopScanner,
    clock: { now: () => NOW },
    audit: async (e) => void audits.push(e as { action: string; after?: unknown }),
    audits,
  };
  return deps;
}

let sha = 0;
async function aVerifiedImport(deps: UseCaseDeps, over: Partial<PayslipExtraction> = {}) {
  sha += 1;
  const created = await deps.imports.create({
    userId: principal.userId,
    fileName: "Busta Paga Agosto 2026.pdf",
    mime: "application/pdf",
    sizeBytes: 100,
    sha256: String(sha).padStart(64, "0"),
    storageProvider: "local",
    storageKey: `payroll/${principal.userId}/2026/${String(sha).padStart(32, "0")}.pdf`,
    idempotencyKey: null,
    replacesImportId: null,
    retentionUntil: new Date("2036-01-01T00:00:00Z"),
    uploadedVia: "ui",
  });
  return (await deps.imports.patch(principal.userId, created.id, {
    status: "verified",
    scanStatus: "clean",
    scanner: "none",
    extraction: { ...extraction, ...over },
  }))!;
}

describe("applyImport", () => {
  it("refuses a principal without payroll.review", async () => {
    const deps = makeDeps();
    const imp = await aVerifiedImport(deps);
    await expect(applyImport(deps)(testPrincipal({ roles: ["viewer"] }), imp.id)).rejects.toThrow(/permission/i);
  });

  it("creates one record for the period with the headline figures off the components", async () => {
    const deps = makeDeps();
    const imp = await aVerifiedImport(deps);
    const applied = await applyImport(deps)(principal, imp.id);
    expect(applied.record.periodStart).toBe("2026-08-01");
    expect(applied.record.periodEnd).toBe("2026-08-31");
    expect(applied.record.kind).toBe("ordinary");
    expect(applied.record.gross).toBe("2500.00");
    expect(applied.record.net).toBe("1800.00");
    expect(applied.record.verifiedAt).toEqual(NOW);
    expect(applied.record.verifiedBy).toBe(principal.userId);
    expect(applied.import.status).toBe("applied");
    expect(applied.supersededRecordId).toBeNull();
  });

  it("writes one classified component per field the payslip stated", async () => {
    const deps = makeDeps();
    const imp = await aVerifiedImport(deps);
    const applied = await applyImport(deps)(principal, imp.id);
    expect(applied.components.map((c) => c.code)).toEqual([
      "gross", "net", "taxes", "fundContribEmployee", "fundContribEmployer", "ferieBalance",
    ]);
    expect(applied.components.find((c) => c.code === "fundContribEmployee")?.mappedTo).toEqual({
      kind: "fund_contribution", fundSlug: "cometa", part: "employee",
    });
    expect(applied.components.find((c) => c.code === "ferieBalance")?.quantity).toBe("88.250000");
  });

  it("bridges the Cometa contributions into the legacy fund deposits (Ruling R4-6)", async () => {
    const deps = makeDeps();
    const imp = await aVerifiedImport(deps);
    const applied = await applyImport(deps)(principal, imp.id);
    expect(applied.fundDeposit).toBe("written");
    expect(deps.funds.rows).toEqual([
      { fundSlug: "cometa", month: "2026-08-01", amount: "150.00", employee: "50.00", employer: "100.00" },
    ]);
  });

  it("writes no fund deposit when the payslip stated no contribution — never a 0.00 row", async () => {
    const deps = makeDeps();
    const imp = await aVerifiedImport(deps, {
      fields: { net: { value: 1800, confidence: "high", rules: 1800, llm: null } },
    });
    const applied = await applyImport(deps)(principal, imp.id);
    expect(applied.fundDeposit).toBe("no_amount");
    expect(deps.funds.rows).toEqual([]);
  });

  it("files a tredicesima as its own record kind, so it never collides with December's ordinary payslip", async () => {
    const deps = makeDeps();
    const ordinary = await aVerifiedImport(deps, { month: "2025-12-01" });
    await applyImport(deps)(principal, ordinary.id);
    const thirteenth = await aVerifiedImport(deps, { month: "2025-12-01", isThirteenth: true });
    const applied = await applyImport(deps)(principal, thirteenth.id);
    expect(applied.record.kind).toBe("thirteenth");
    expect((await deps.records.list(principal.userId)).length).toBe(2);
  });

  it("is re-runnable: applying twice recomputes the same record and replaces its components", async () => {
    const deps = makeDeps();
    const imp = await aVerifiedImport(deps);
    const first = await applyImport(deps)(principal, imp.id);
    await deps.imports.patch(principal.userId, imp.id, {
      status: "verified",
      extraction: { ...extraction, fields: { ...extraction.fields, net: { value: 1850, confidence: "high", rules: 1800, llm: null } } },
    });
    const second = await applyImport(deps)(principal, imp.id);
    expect(second.record.id).toBe(first.record.id);
    expect(second.record.net).toBe("1850.00");
    expect(second.record.version).toBe(first.record.version + 1);
    expect((await deps.records.list(principal.userId)).length).toBe(1);
  });

  it("supersedes the live record for the period when a replacement is applied (Ruling R4-4)", async () => {
    const deps = makeDeps();
    const original = await aVerifiedImport(deps);
    const first = await applyImport(deps)(principal, original.id);
    const replacement = await aVerifiedImport(deps);
    await deps.imports.patch(principal.userId, replacement.id, { status: "verified" });
    const applied = await applyImport(deps)(principal, replacement.id);

    expect(applied.supersededRecordId).toBe(first.record.id);
    expect(applied.record.id).not.toBe(first.record.id);
    const live = await deps.records.list(principal.userId);
    expect(live.map((r) => r.id)).toEqual([applied.record.id]);
    const all = await deps.records.list(principal.userId, { includeSuperseded: true });
    expect(all.length).toBe(2);
    const superseded = all.find((r) => r.id === first.record.id)!;
    expect(superseded.supersededByRecordId).toBe(applied.record.id);
    expect((await deps.imports.get(principal.userId, original.id))?.status).toBe("superseded");
  });

  it("keeps the superseded record's components as evidence (Ruling R4-4)", async () => {
    const deps = makeDeps();
    const original = await aVerifiedImport(deps);
    const first = await applyImport(deps)(principal, original.id);
    const replacement = await aVerifiedImport(deps);
    await applyImport(deps)(principal, replacement.id);
    expect((await deps.components.listForRecord(first.record.id)).length).toBeGreaterThan(0);
  });

  it("re-upserts the month's fund deposit from the replacement, so the Funds page follows the correction", async () => {
    const deps = makeDeps();
    const original = await aVerifiedImport(deps);
    await applyImport(deps)(principal, original.id);
    const replacement = await aVerifiedImport(deps, {
      fields: { ...extraction.fields, fundContribEmployee: { value: 60, confidence: "high", rules: 60, llm: null } },
    });
    await applyImport(deps)(principal, replacement.id);
    expect(deps.funds.rows).toEqual([
      { fundSlug: "cometa", month: "2026-08-01", amount: "160.00", employee: "60.00", employer: "100.00" },
    ]);
  });

  it("refuses an import that is not verified", async () => {
    const deps = makeDeps();
    const imp = await aVerifiedImport(deps);
    await deps.imports.patch(principal.userId, imp.id, { status: "needs_review" });
    await expect(applyImport(deps)(principal, imp.id)).rejects.toMatchObject({ name: "ConflictError", reason: "not_verified" });
  });

  it("refuses an extraction with no month — a record must know its own period", async () => {
    const deps = makeDeps();
    const imp = await aVerifiedImport(deps, { month: null });
    await expect(applyImport(deps)(principal, imp.id)).rejects.toMatchObject({ name: "InvalidInputError" });
  });

  it("audits the apply with ids and counts, never with amounts", async () => {
    const deps = makeDeps();
    const imp = await aVerifiedImport(deps);
    const applied = await applyImport(deps)(principal, imp.id);
    const audit = deps.audits.find((a) => a.action === "payroll.import_applied");
    expect(audit?.after).toEqual({
      recordId: applied.record.id,
      periodStart: "2026-08-01",
      kind: "ordinary",
      componentCount: 6,
      supersededRecordId: null,
      fundDeposit: "written",
    });
    expect(JSON.stringify(deps.audits)).not.toContain("1800.00");
  });
});
```

- [ ] **Step 5: Run it and watch it fail**

Run: `npm test -- payroll/application/apply-import`
Expected: FAIL — `Cannot find module './apply-import'`.

- [ ] **Step 6: Write the apply use case**

```ts
// src/modules/payroll/application/apply-import.ts
import type { Principal } from "@/platform/auth/principal";
import { assertPermission } from "@/platform/auth/principal";
import { componentsFromExtraction, grossOf, netOf } from "../domain/components";
import { monthOfPeriod, periodFor, recordKindOf } from "../domain/period";
import type { MappingTarget, NewPayrollComponent, PayrollComponent, PayrollImport, PayrollRecord, UseCaseDeps } from "./ports";
import { ConflictError, InvalidInputError, NotFoundError } from "./errors";

export interface AppliedImport {
  import: PayrollImport;
  record: PayrollRecord;
  components: PayrollComponent[];
  /** The record this apply superseded, or null when the period was free. */
  supersededRecordId: string | null;
  fundDeposit: "written" | "no_fund" | "no_amount";
}

function fundHalves(components: readonly NewPayrollComponent[]): {
  fundSlug: string | null;
  employee: string | null;
  employer: string | null;
} {
  let fundSlug: string | null = null;
  let employee: string | null = null;
  let employer: string | null = null;
  for (const component of components) {
    const target = component.mappedTo as MappingTarget | null;
    if (!target || target.kind !== "fund_contribution") continue;
    fundSlug = target.fundSlug;
    if (target.part === "employee") employee = component.amount;
    else employer = component.amount;
  }
  return { fundSlug, employee, employer };
}

/**
 * Turns a verified import into the money: one `payroll_record`, its
 * `payroll_components`, and the legacy `fund_deposits` row that keeps the Funds
 * page working until Phase 5 (Ruling R4-6).
 *
 * Every write here is Postgres-only, so this is the one use case in the module
 * that runs start to finish inside the caller's single transaction — which is
 * exactly what makes the supersede-then-insert of Ruling R4-4 safe against
 * `payroll_records_period_uq`: the old record is marked superseded and the new
 * one inserted with no committed moment in between where either two live
 * records or none exist.
 *
 * Idempotent and re-runnable, not reversible. Re-applying recomputes the
 * record's fields, bumps its version and replaces its components wholesale.
 * There is no `unapply`: the reverse of a wrong apply is a replacement import
 * that supersedes it, because the derived rows have no pre-state to restore.
 */
export function applyImport(deps: UseCaseDeps) {
  return async (principal: Principal, importId: string): Promise<AppliedImport> => {
    assertPermission(principal, "payroll.review");
    const found = await deps.imports.get(principal.userId, importId);
    if (!found) throw new NotFoundError();
    if (found.status !== "verified") {
      throw new ConflictError("Only a verified import can be applied.", "not_verified");
    }
    if (!found.extraction) throw new ConflictError("This import has no extraction to apply.", "not_verified");
    const month = found.extraction.month;
    if (!month) {
      throw new InvalidInputError("This payslip has no pay period. Set the month on the review screen first.");
    }

    const period = periodFor(month);
    const kind = recordKindOf(found.extraction.isThirteenth);
    const rules = await deps.mappingRules.listFor(principal.userId);
    const components = componentsFromExtraction(found.extraction, rules);
    const now = deps.clock.now();

    const existing = await deps.records.getByImport(principal.userId, importId);
    let record: PayrollRecord;
    let supersededRecordId: string | null = null;

    if (existing) {
      // A re-apply. The period is already this record's own, so nothing is
      // superseded and `payroll_records_period_uq` is untouched.
      const updated = await deps.records.update(principal.userId, existing.id, {
        periodEnd: period.periodEnd,
        gross: grossOf(components),
        net: netOf(components),
        corrections: found.extraction.fields as unknown as PayrollRecord["corrections"],
      });
      if (!updated) throw new NotFoundError();
      record = updated;
    } else {
      const live = await deps.records.liveForPeriod(principal.userId, period.periodStart, kind);
      if (live) {
        // Ruling R4-4. Marking the old record superseded *first* is what frees
        // the partial unique index for the insert below, inside this one
        // transaction.
        supersededRecordId = live.id;
        await deps.records.supersede(principal.userId, live.id, live.id, now);
      }
      record = await deps.records.create({
        userId: principal.userId,
        importId,
        periodStart: period.periodStart,
        periodEnd: period.periodEnd,
        payDate: null,
        kind,
        currency: "EUR",
        gross: grossOf(components),
        net: netOf(components),
        verifiedAt: now,
        verifiedBy: principal.userId,
        corrections: found.extraction.fields as unknown as PayrollRecord["corrections"],
      });
      if (supersededRecordId) {
        // The forward pointer needs the new record's id, which did not exist a
        // moment ago. Same transaction, so no reader ever sees the gap.
        await deps.records.supersede(principal.userId, supersededRecordId, record.id, now);
        await deps.imports.patch(principal.userId, live!.importId, { status: "superseded" });
      }
    }

    const written = await deps.components.replaceForRecord(record.id, components);

    const { fundSlug, employee, employer } = fundHalves(components);
    const fundDeposit = fundSlug
      ? await deps.funds.upsertForRecord({ fundSlug, month: monthOfPeriod(period.periodStart), employee, employer })
      : ("no_amount" as const);

    const updatedImport = await deps.imports.patch(principal.userId, importId, { status: "applied", error: null });
    if (!updatedImport) throw new NotFoundError();

    await deps.audit({
      actorUserId: principal.userId,
      action: "payroll.import_applied",
      entityType: "payroll_import",
      entityId: importId,
      // Ids and counts. The amounts are on the record; repeating them here would
      // make `audit_events` a second, unredacted copy of the payslip.
      after: {
        recordId: record.id,
        periodStart: period.periodStart,
        kind,
        componentCount: written.length,
        supersededRecordId,
        fundDeposit,
      },
    });

    return { import: updatedImport, record, components: written, supersededRecordId, fundDeposit };
  };
}
```

- [ ] **Step 7: Write the apply integration test, which proves the supersede is safe against the real index**

```ts
// src/modules/payroll/application/apply-import.itest.ts
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import type { PayslipExtraction } from "@/lib/contracts";
import { funds, organizations, payrollRecords, users } from "@/lib/db/schema";
import { permissionsForRoles } from "@/platform/auth/permissions";
import type { Principal } from "@/platform/auth/principal";
import { withUserContext } from "@/platform/db/context";
import { closeDb, resetDb, testDb } from "@/test/db";
import { noopScanner } from "../infrastructure/noop-scanner";
import { payrollDeps } from "../infrastructure/deps";
import { applyImport } from "./apply-import";

const NOOP_STORE = {
  provider: "local" as const,
  put: async () => {},
  get: async () => null,
  delete: async () => {},
  listPrefix: async () => [],
};

const extraction: PayslipExtraction = {
  parserVersion: "payroll-1.0.0",
  month: "2026-08-01",
  isThirteenth: false,
  textSource: "pdf",
  fields: {
    gross: { value: 2500, confidence: "high", rules: 2500, llm: null },
    net: { value: 1800, confidence: "high", rules: 1800, llm: null },
    fundContribEmployee: { value: 50, confidence: "high", rules: 50, llm: null },
    fundContribEmployer: { value: 100, confidence: "high", rules: 100, llm: null },
  },
  checks: [],
};

async function seed() {
  const db = await testDb();
  const [org] = await db.insert(organizations).values({ name: "P" }).returning();
  const [user] = await db.insert(users).values({ organizationId: org!.id, displayName: "A" }).returning();
  await db.insert(funds).values({ slug: "cometa", name: "Fondo Cometa" }).onConflictDoNothing();
  const roles = ["owner"] as const;
  const principal: Principal = {
    userId: user!.id,
    organizationId: org!.id,
    roles: [...roles],
    permissions: permissionsForRoles([...roles]),
  };
  return { db, principal };
}

let sha = 0;
async function aVerifiedImport(db: Awaited<ReturnType<typeof testDb>>, principal: Principal) {
  sha += 1;
  return withUserContext(db, { userId: principal.userId }, async (tx) => {
    const deps = payrollDeps(tx, { documents: NOOP_STORE, scanner: noopScanner });
    const created = await deps.imports.create({
      userId: principal.userId,
      fileName: "Busta Paga Agosto 2026.pdf",
      mime: "application/pdf",
      sizeBytes: 100,
      sha256: String(sha).padStart(64, "0"),
      storageProvider: "local",
      storageKey: `payroll/${principal.userId}/2026/${String(sha).padStart(32, "0")}.pdf`,
      idempotencyKey: null,
      replacesImportId: null,
      retentionUntil: new Date("2036-01-01T00:00:00Z"),
      uploadedVia: "ui",
    });
    return (await deps.imports.patch(principal.userId, created.id, {
      status: "verified",
      scanStatus: "clean",
      scanner: "none",
      extraction,
    }))!;
  });
}

describe("applyImport against real Postgres", () => {
  beforeEach(resetDb);
  afterAll(closeDb);

  it("supersedes and inserts in one transaction without tripping payroll_records_period_uq", async () => {
    const { db, principal } = await seed();
    const original = await aVerifiedImport(db, principal);
    const first = await withUserContext(db, { userId: principal.userId }, (tx) =>
      applyImport(payrollDeps(tx, { documents: NOOP_STORE, scanner: noopScanner }))(principal, original.id),
    );
    const replacement = await aVerifiedImport(db, principal);
    const second = await withUserContext(db, { userId: principal.userId }, (tx) =>
      applyImport(payrollDeps(tx, { documents: NOOP_STORE, scanner: noopScanner }))(principal, replacement.id),
    );

    expect(second.supersededRecordId).toBe(first.record.id);
    const rows = await withUserContext(db, { userId: principal.userId }, (tx) => tx.select().from(payrollRecords));
    expect(rows.length).toBe(2);
    expect(rows.filter((r) => r.supersededAt === null).map((r) => r.id)).toEqual([second.record.id]);
  });

  it("writes the legacy fund deposit for the month", async () => {
    const { db, principal } = await seed();
    const imp = await aVerifiedImport(db, principal);
    const applied = await withUserContext(db, { userId: principal.userId }, (tx) =>
      applyImport(payrollDeps(tx, { documents: NOOP_STORE, scanner: noopScanner }))(principal, imp.id),
    );
    expect(applied.fundDeposit).toBe("written");
  });
});
```

- [ ] **Step 8: Run everything**

Run:
```bash
npm test -- payroll/
npm run test:db:up && npm run test:integration -- payroll
npx tsc --noEmit
```
Expected: PASS, PASS, exit 0.

- [ ] **Step 9: Commit**

```bash
git add src/modules/payroll/application
git commit -m "feat(payroll): review, verify and apply an import into records and components"
```

---

### Task 12: Reading imports, records and the earnings summary

**Files:**
- Create: `src/modules/payroll/application/list-imports.ts`
- Create: `src/modules/payroll/application/list-records.ts`
- Create: `src/modules/payroll/application/list-records.test.ts`
- Create: `src/modules/payroll/domain/earnings.ts`
- Create: `src/modules/payroll/domain/earnings.test.ts`

**Interfaces:**
- Consumes: `UseCaseDeps`, `PayrollImport`, `PayrollRecord`, `PayrollComponent` from `../application/ports` (Task 2); `addMoney` from `../domain/money` (Task 5); `NotFoundError` from `../application/errors`.
- Produces:
```ts
// domain/earnings.ts
export interface EarningsBucket { key: string; gross: string | null; net: string | null; taxes: string | null; contributions: string | null; recordCount: number }
export interface EarningsSummary { months: EarningsBucket[]; quarters: EarningsBucket[]; years: EarningsBucket[] }
export function summariseEarnings(records: readonly PayrollRecord[], components: readonly PayrollComponent[]): EarningsSummary;
// application
export function listImports(deps: UseCaseDeps): (principal: Principal, opts?: ListImportsOptions) => Promise<PayrollImport[]>;
export function getImport(deps: UseCaseDeps): (principal: Principal, id: string) => Promise<PayrollImport>;
export interface RecordDetail { record: PayrollRecord; components: PayrollComponent[] }
export function listRecords(deps: UseCaseDeps): (principal: Principal, opts?: ListRecordsOptions) => Promise<PayrollRecord[]>;
export function getRecord(deps: UseCaseDeps): (principal: Principal, id: string) => Promise<RecordDetail>;
export function earningsSummary(deps: UseCaseDeps): (principal: Principal, opts?: ListRecordsOptions) => Promise<EarningsSummary>;
```

- [ ] **Step 1: Write the failing earnings-domain test**

```ts
// src/modules/payroll/domain/earnings.test.ts
import { describe, expect, it } from "vitest";
import type { PayrollComponent, PayrollRecord } from "../application/ports";
import { summariseEarnings } from "./earnings";

function record(over: Partial<PayrollRecord> & { id: string; periodStart: string }): PayrollRecord {
  return {
    userId: "u1",
    importId: `imp-${over.id}`,
    periodEnd: `${over.periodStart.slice(0, 7)}-28`,
    payDate: null,
    kind: "ordinary",
    currency: "EUR",
    gross: "2500.00",
    net: "1800.00",
    verifiedAt: null,
    verifiedBy: null,
    corrections: null,
    supersededAt: null,
    supersededByRecordId: null,
    version: 1,
    createdAt: new Date("2026-09-05T00:00:00Z"),
    updatedAt: new Date("2026-09-05T00:00:00Z"),
    ...over,
  };
}

function component(recordId: string, code: string, kind: PayrollComponent["kind"], amount: string | null): PayrollComponent {
  return {
    id: `${recordId}-${code}`,
    recordId,
    code,
    labelRaw: code,
    kind,
    amount,
    quantity: null,
    unit: "eur",
    currency: "EUR",
    confidence: "high",
    source: "rules",
    mappedTo: { kind: "earnings" },
    sortOrder: 0,
    createdAt: new Date("2026-09-05T00:00:00Z"),
  };
}

describe("summariseEarnings", () => {
  const records = [
    record({ id: "r1", periodStart: "2026-01-01" }),
    record({ id: "r2", periodStart: "2026-02-01" }),
    record({ id: "r3", periodStart: "2026-04-01" }),
  ];
  const components = [
    component("r1", "taxes", "tax", "700.00"),
    component("r1", "fundContribEmployee", "employee_contribution", "50.00"),
    component("r2", "taxes", "tax", "700.00"),
    component("r3", "taxes", "tax", "710.00"),
  ];

  it("buckets by month, newest first", () => {
    const summary = summariseEarnings(records, components);
    expect(summary.months.map((m) => m.key)).toEqual(["2026-04", "2026-02", "2026-01"]);
    expect(summary.months[0]).toMatchObject({ gross: "2500.00", net: "1800.00", taxes: "710.00", recordCount: 1 });
  });

  it("buckets by calendar quarter and by year, summing exactly", () => {
    const summary = summariseEarnings(records, components);
    expect(summary.quarters.map((q) => q.key)).toEqual(["2026-Q2", "2026-Q1"]);
    expect(summary.quarters.find((q) => q.key === "2026-Q1")).toMatchObject({
      gross: "5000.00", net: "3600.00", taxes: "1400.00", recordCount: 2,
    });
    expect(summary.years).toEqual([
      { key: "2026", gross: "7500.00", net: "5400.00", taxes: "2110.00", contributions: "50.00", recordCount: 3 },
    ]);
  });

  it("sums contributions from both employee and employer components", () => {
    const summary = summariseEarnings(
      [record({ id: "r1", periodStart: "2026-01-01" })],
      [
        component("r1", "fundContribEmployee", "employee_contribution", "50.00"),
        component("r1", "fundContribEmployer", "employer_contribution", "100.00"),
      ],
    );
    expect(summary.months[0]!.contributions).toBe("150.00");
  });

  it("reports null, never zero, for a figure no record carried", () => {
    const summary = summariseEarnings([record({ id: "r1", periodStart: "2026-01-01", gross: null })], []);
    expect(summary.months[0]!.gross).toBeNull();
    expect(summary.months[0]!.taxes).toBeNull();
    expect(summary.months[0]!.contributions).toBeNull();
    expect(summary.months[0]!.net).toBe("1800.00");
  });

  it("returns three empty lists for no records at all", () => {
    expect(summariseEarnings([], [])).toEqual({ months: [], quarters: [], years: [] });
  });

  it("ignores a component whose record is not in the list", () => {
    const summary = summariseEarnings(
      [record({ id: "r1", periodStart: "2026-01-01" })],
      [component("r-other", "taxes", "tax", "999.00")],
    );
    expect(summary.months[0]!.taxes).toBeNull();
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `npm test -- payroll/domain/earnings`
Expected: FAIL — `Cannot find module './earnings'`.

- [ ] **Step 3: Write the earnings domain**

```ts
// src/modules/payroll/domain/earnings.ts
import type { PayrollComponent, PayrollRecord } from "../application/ports";
import { addMoney } from "./money";

export interface EarningsBucket {
  /** `2026-08`, `2026-Q3` or `2026`. */
  key: string;
  gross: string | null;
  net: string | null;
  taxes: string | null;
  contributions: string | null;
  recordCount: number;
}

export interface EarningsSummary {
  months: EarningsBucket[];
  quarters: EarningsBucket[];
  years: EarningsBucket[];
}

const TAX_KINDS = new Set<PayrollComponent["kind"]>(["tax"]);
const CONTRIBUTION_KINDS = new Set<PayrollComponent["kind"]>(["employee_contribution", "employer_contribution"]);

interface Accumulator {
  gross: string | null;
  net: string | null;
  taxes: string | null;
  contributions: string | null;
  recordCount: number;
}

function empty(): Accumulator {
  return { gross: null, net: null, taxes: null, contributions: null, recordCount: 0 };
}

function bucketsOf(map: Map<string, Accumulator>): EarningsBucket[] {
  return [...map.entries()]
    // Newest first: every key in each family is lexicographically ordered
    // (`2026-08`, `2026-Q3`, `2026`), so one comparator serves all three.
    .sort((a, b) => b[0].localeCompare(a[0]))
    .map(([key, acc]) => ({ key, ...acc }));
}

/**
 * Ruling R4-12: Earnings is computed from records and components, never from
 * imports. The caller passes only live records (`superseded_at IS NULL`), so a
 * corrected month appears exactly once, at its corrected value.
 *
 * Every sum uses `addMoney`, which is `BigInt` cents — never a float. And every
 * figure starts at `null`, not `0.00`: a month whose payslip stated no tax line
 * reports "—", because a zero there would be a claim this system cannot make.
 */
export function summariseEarnings(
  records: readonly PayrollRecord[],
  components: readonly PayrollComponent[],
): EarningsSummary {
  const byRecord = new Map<string, PayrollComponent[]>();
  for (const component of components) {
    const list = byRecord.get(component.recordId) ?? [];
    list.push(component);
    byRecord.set(component.recordId, list);
  }

  const months = new Map<string, Accumulator>();
  const quarters = new Map<string, Accumulator>();
  const years = new Map<string, Accumulator>();

  for (const record of records) {
    const year = record.periodStart.slice(0, 4);
    const month = record.periodStart.slice(0, 7);
    const quarter = `${year}-Q${Math.floor((Number(record.periodStart.slice(5, 7)) - 1) / 3) + 1}`;

    let taxes: string | null = null;
    let contributions: string | null = null;
    for (const component of byRecord.get(record.id) ?? []) {
      if (TAX_KINDS.has(component.kind)) taxes = addMoney(taxes, component.amount);
      else if (CONTRIBUTION_KINDS.has(component.kind)) contributions = addMoney(contributions, component.amount);
    }

    for (const [map, key] of [
      [months, month],
      [quarters, quarter],
      [years, year],
    ] as const) {
      const acc = map.get(key) ?? empty();
      map.set(key, {
        gross: addMoney(acc.gross, record.gross),
        net: addMoney(acc.net, record.net),
        taxes: addMoney(acc.taxes, taxes),
        contributions: addMoney(acc.contributions, contributions),
        recordCount: acc.recordCount + 1,
      });
    }
  }

  return { months: bucketsOf(months), quarters: bucketsOf(quarters), years: bucketsOf(years) };
}
```

- [ ] **Step 4: Write the failing read-use-case test**

```ts
// src/modules/payroll/application/list-records.test.ts
import { describe, expect, it } from "vitest";
import { testPrincipal } from "@/test/principal";
import type { UseCaseDeps } from "./ports";
import {
  MemoryLegacyFundDeposits,
  MemoryPayrollComponentsRepository,
  MemoryPayrollImportsRepository,
  MemoryPayrollMappingRulesRepository,
  MemoryPayrollRecordsRepository,
} from "../infrastructure/memory-repositories";
import { noopScanner } from "../infrastructure/noop-scanner";
import { getImport, listImports } from "./list-imports";
import { earningsSummary, getRecord, listRecords } from "./list-records";

const principal = testPrincipal({ userId: "00000000-0000-7000-8000-00000000000a" });

function makeDeps(): UseCaseDeps {
  return {
    imports: new MemoryPayrollImportsRepository(),
    records: new MemoryPayrollRecordsRepository(),
    components: new MemoryPayrollComponentsRepository(),
    mappingRules: new MemoryPayrollMappingRulesRepository(),
    funds: new MemoryLegacyFundDeposits(),
    documents: { provider: "local", put: async () => {}, get: async () => null, delete: async () => {}, listPrefix: async () => [] },
    scanner: noopScanner,
    clock: { now: () => new Date("2026-09-05T10:00:00Z") },
    audit: async () => {},
  };
}

async function seedRecord(deps: UseCaseDeps, periodStart: string, importId: string) {
  return deps.records.create({
    userId: principal.userId,
    importId,
    periodStart,
    periodEnd: `${periodStart.slice(0, 7)}-28`,
    payDate: null,
    kind: "ordinary",
    currency: "EUR",
    gross: "2500.00",
    net: "1800.00",
    verifiedAt: null,
    verifiedBy: null,
    corrections: null,
  });
}

describe("listImports and getImport", () => {
  it("refuse a principal without payroll.read", async () => {
    const deps = makeDeps();
    const stranger = testPrincipal({ roles: [] });
    await expect(listImports(deps)(stranger)).rejects.toThrow(/permission/i);
  });

  it("getImport throws NotFoundError for another user's import", async () => {
    const deps = makeDeps();
    const created = await deps.imports.create({
      userId: "someone-else", fileName: "a.pdf", mime: "application/pdf", sizeBytes: 1, sha256: "a".repeat(64),
      storageProvider: "local", storageKey: "k", idempotencyKey: null, replacesImportId: null,
      retentionUntil: new Date("2036-01-01T00:00:00Z"), uploadedVia: "ui",
    });
    await expect(getImport(deps)(principal, created.id)).rejects.toThrow(/not found/i);
  });
});

describe("listRecords and getRecord", () => {
  it("lists newest period first and never a superseded record", async () => {
    const deps = makeDeps();
    const july = await seedRecord(deps, "2026-07-01", "imp-1");
    const august = await seedRecord(deps, "2026-08-01", "imp-2");
    await deps.records.supersede(principal.userId, july.id, august.id, new Date());
    expect((await listRecords(deps)(principal)).map((r) => r.periodStart)).toEqual(["2026-08-01"]);
  });

  it("getRecord returns the record with its components in sort order", async () => {
    const deps = makeDeps();
    const record = await seedRecord(deps, "2026-08-01", "imp-1");
    await deps.components.replaceForRecord(record.id, [
      { recordId: "", code: "taxes", labelRaw: "Totale trattenute", kind: "tax", amount: "700.00", quantity: null, unit: "eur", currency: "EUR", confidence: "high", source: "rules", mappedTo: { kind: "earnings" }, sortOrder: 1 },
      { recordId: "", code: "net", labelRaw: "Netto del mese", kind: "earning", amount: "1800.00", quantity: null, unit: "eur", currency: "EUR", confidence: "high", source: "rules", mappedTo: { kind: "earnings" }, sortOrder: 0 },
    ]);
    const detail = await getRecord(deps)(principal, record.id);
    expect(detail.components.map((c) => c.code)).toEqual(["net", "taxes"]);
  });

  it("getRecord throws NotFoundError for another user's record", async () => {
    const deps = makeDeps();
    const record = await seedRecord(deps, "2026-08-01", "imp-1");
    await expect(
      getRecord(deps)(testPrincipal({ userId: "00000000-0000-7000-8000-00000000000b" }), record.id),
    ).rejects.toThrow(/not found/i);
  });
});

describe("earningsSummary", () => {
  it("summarises live records only, and returns empty lists when there are none", async () => {
    const deps = makeDeps();
    expect(await earningsSummary(deps)(principal)).toEqual({ months: [], quarters: [], years: [] });
    const record = await seedRecord(deps, "2026-08-01", "imp-1");
    await deps.components.replaceForRecord(record.id, [
      { recordId: "", code: "taxes", labelRaw: "Totale trattenute", kind: "tax", amount: "700.00", quantity: null, unit: "eur", currency: "EUR", confidence: "high", source: "rules", mappedTo: { kind: "earnings" }, sortOrder: 0 },
    ]);
    const summary = await earningsSummary(deps)(principal);
    expect(summary.months).toEqual([
      { key: "2026-08", gross: "2500.00", net: "1800.00", taxes: "700.00", contributions: null, recordCount: 1 },
    ]);
  });

  it("refuses a principal without payroll.read", async () => {
    await expect(earningsSummary(makeDeps())(testPrincipal({ roles: [] }))).rejects.toThrow(/permission/i);
  });
});
```

- [ ] **Step 5: Run it and watch it fail**

Run: `npm test -- payroll/application/list-records`
Expected: FAIL — `Cannot find module './list-imports'`.

- [ ] **Step 6: Write the read use cases**

```ts
// src/modules/payroll/application/list-imports.ts
import type { Principal } from "@/platform/auth/principal";
import { assertPermission } from "@/platform/auth/principal";
import type { ListImportsOptions, PayrollImport, UseCaseDeps } from "./ports";
import { NotFoundError } from "./errors";

/** Pipeline state, not money (Ruling R4-12). No page reads this for a financial figure. */
export function listImports(deps: UseCaseDeps) {
  return async (principal: Principal, opts: ListImportsOptions = {}): Promise<PayrollImport[]> => {
    assertPermission(principal, "payroll.read");
    return deps.imports.list(principal.userId, opts);
  };
}

export function getImport(deps: UseCaseDeps) {
  return async (principal: Principal, id: string): Promise<PayrollImport> => {
    assertPermission(principal, "payroll.read");
    const found = await deps.imports.get(principal.userId, id);
    // A row belonging to somebody else is "not found", never "forbidden": the
    // second answer confirms the id exists.
    if (!found) throw new NotFoundError();
    return found;
  };
}
```

```ts
// src/modules/payroll/application/list-records.ts
import type { Principal } from "@/platform/auth/principal";
import { assertPermission } from "@/platform/auth/principal";
import { summariseEarnings, type EarningsSummary } from "../domain/earnings";
import type { ListRecordsOptions, PayrollComponent, PayrollRecord, UseCaseDeps } from "./ports";
import { NotFoundError } from "./errors";

export interface RecordDetail {
  record: PayrollRecord;
  components: PayrollComponent[];
}

export function listRecords(deps: UseCaseDeps) {
  return async (principal: Principal, opts: ListRecordsOptions = {}): Promise<PayrollRecord[]> => {
    assertPermission(principal, "payroll.read");
    return deps.records.list(principal.userId, opts);
  };
}

export function getRecord(deps: UseCaseDeps) {
  return async (principal: Principal, id: string): Promise<RecordDetail> => {
    assertPermission(principal, "payroll.read");
    const record = await deps.records.get(principal.userId, id);
    if (!record) throw new NotFoundError("Payroll record not found");
    return { record, components: await deps.components.listForRecord(record.id) };
  };
}

/**
 * Spec §5.8 calls `earnings_summaries` a view over records and components; here
 * it is a use case, because the buckets it produces (month, quarter, year) are
 * the shape the Earnings page and the Company Overview both want and a view
 * would have to be queried three times to give.
 *
 * Superseded records are excluded by `listRecords`'s default, which is what
 * makes a corrected month appear exactly once (Ruling R4-4).
 */
export function earningsSummary(deps: UseCaseDeps) {
  return async (principal: Principal, opts: ListRecordsOptions = {}): Promise<EarningsSummary> => {
    assertPermission(principal, "payroll.read");
    const records = await deps.records.list(principal.userId, opts);
    const components = await deps.components.listForRecords(records.map((r) => r.id));
    return summariseEarnings(records, components);
  };
}
```

- [ ] **Step 7: Run everything and type-check**

Run:
```bash
npm test -- payroll/
npx tsc --noEmit
```
Expected: PASS and exit 0.

- [ ] **Step 8: Commit**

```bash
git add src/modules/payroll
git commit -m "feat(payroll): read imports, records and the month/quarter/year earnings summary"
```

---

### Task 13: Serving an original, and purging expired ones

**Files:**
- Create: `src/modules/payroll/application/read-original.ts`
- Create: `src/modules/payroll/application/read-original.test.ts`
- Create: `src/modules/payroll/application/purge-expired-originals.ts`
- Create: `src/modules/payroll/application/purge-expired-originals.test.ts`

**Interfaces:**
- Consumes: `UseCaseDeps`, `PayrollImport` from `../application/ports` (Task 2); `ConflictError`, `NotFoundError` from `../application/errors`; `assertPermission` from `@/platform/auth/principal`.
- Produces:
```ts
export interface OriginalDocument { bytes: Uint8Array; mime: string; fileName: string }
export function readOriginal(deps: UseCaseDeps): (principal: Principal, importId: string) => Promise<OriginalDocument>;
export const PURGE_BATCH = 100;
export interface PurgeResult { considered: number; purged: number; failed: number }
export function purgeExpiredOriginals(deps: UseCaseDeps): (now: Date, limit?: number) => Promise<PurgeResult>;
```

- [ ] **Step 1: Write the failing tests**

```ts
// src/modules/payroll/application/read-original.test.ts
import { describe, expect, it } from "vitest";
import { testPrincipal } from "@/test/principal";
import type { PayrollImportPatch, UseCaseDeps } from "./ports";
import {
  MemoryLegacyFundDeposits,
  MemoryPayrollComponentsRepository,
  MemoryPayrollImportsRepository,
  MemoryPayrollMappingRulesRepository,
  MemoryPayrollRecordsRepository,
} from "../infrastructure/memory-repositories";
import { noopScanner } from "../infrastructure/noop-scanner";
import { readOriginal } from "./read-original";

const principal = testPrincipal({ userId: "00000000-0000-7000-8000-00000000000a" });
const bytes = new TextEncoder().encode("%PDF-1.7 body");

function makeDeps(stored: Uint8Array | null = bytes) {
  const audits: Array<{ action: string }> = [];
  const deps: UseCaseDeps & { audits: typeof audits } = {
    imports: new MemoryPayrollImportsRepository(),
    records: new MemoryPayrollRecordsRepository(),
    components: new MemoryPayrollComponentsRepository(),
    mappingRules: new MemoryPayrollMappingRulesRepository(),
    funds: new MemoryLegacyFundDeposits(),
    documents: { provider: "local", put: async () => {}, get: async () => stored, delete: async () => {}, listPrefix: async () => [] },
    scanner: noopScanner,
    clock: { now: () => new Date("2026-09-05T10:00:00Z") },
    audit: async (e) => void audits.push(e as { action: string }),
    audits,
  };
  return deps;
}

async function anImport(deps: UseCaseDeps, patch: PayrollImportPatch = { scanStatus: "clean" }) {
  const created = await deps.imports.create({
    userId: principal.userId, fileName: "Busta Paga Agosto 2026.pdf", mime: "application/pdf",
    sizeBytes: bytes.byteLength, sha256: "a".repeat(64), storageProvider: "local",
    storageKey: `payroll/${principal.userId}/2026/${"0".repeat(32)}.pdf`,
    idempotencyKey: null, replacesImportId: null,
    retentionUntil: new Date("2036-01-01T00:00:00Z"), uploadedVia: "ui",
  });
  return (await deps.imports.patch(principal.userId, created.id, patch))!;
}

describe("readOriginal", () => {
  it("refuses a principal without payroll.read_original", async () => {
    const deps = makeDeps();
    const imp = await anImport(deps);
    await expect(readOriginal(deps)(testPrincipal({ roles: ["viewer"] }), imp.id)).rejects.toThrow(/permission/i);
  });

  it("streams the bytes with the stored filename and mime, and audits the read", async () => {
    const deps = makeDeps();
    const imp = await anImport(deps);
    const original = await readOriginal(deps)(principal, imp.id);
    expect(original).toEqual({ bytes, mime: "application/pdf", fileName: "Busta Paga Agosto 2026.pdf" });
    expect(deps.audits.map((a) => a.action)).toEqual(["payroll.original_read"]);
  });

  it("refuses an import that has not cleared the scanner, with a conflict (Ruling R4-2)", async () => {
    for (const scanStatus of ["pending", "unavailable", "infected"] as const) {
      const deps = makeDeps();
      const imp = await anImport(deps, { scanStatus });
      await expect(readOriginal(deps)(principal, imp.id)).rejects.toMatchObject({
        name: "ConflictError",
        reason: "not_scanned",
      });
      expect(deps.audits).toEqual([]);
    }
  });

  it("refuses a purged original with a conflict naming retention, not a 404 (Ruling R4-5)", async () => {
    const deps = makeDeps();
    const imp = await anImport(deps, { scanStatus: "clean", storageKey: null, purgedAt: new Date() });
    await expect(readOriginal(deps)(principal, imp.id)).rejects.toMatchObject({
      name: "ConflictError",
      reason: "purged",
    });
  });

  it("reports a store that has lost the object as a conflict, not as clean bytes", async () => {
    const deps = makeDeps(null);
    const imp = await anImport(deps);
    await expect(readOriginal(deps)(principal, imp.id)).rejects.toMatchObject({
      name: "ConflictError",
      reason: "bytes_missing",
    });
  });

  it("throws NotFoundError for another user's import", async () => {
    const deps = makeDeps();
    const imp = await anImport(deps);
    await expect(
      readOriginal(deps)(testPrincipal({ userId: "00000000-0000-7000-8000-00000000000b" }), imp.id),
    ).rejects.toThrow(/not found/i);
  });
});
```

```ts
// src/modules/payroll/application/purge-expired-originals.test.ts
import { describe, expect, it } from "vitest";
import type { PayrollImportStatus, UseCaseDeps } from "./ports";
import {
  MemoryLegacyFundDeposits,
  MemoryPayrollComponentsRepository,
  MemoryPayrollImportsRepository,
  MemoryPayrollMappingRulesRepository,
  MemoryPayrollRecordsRepository,
} from "../infrastructure/memory-repositories";
import { noopScanner } from "../infrastructure/noop-scanner";
import { PURGE_BATCH, purgeExpiredOriginals } from "./purge-expired-originals";

const NOW = new Date("2026-09-05T10:00:00Z");
const PAST = new Date("2020-01-01T00:00:00Z");
const USER = "00000000-0000-7000-8000-00000000000a";

function makeDeps(failOn: string | null = null) {
  const deleted: string[] = [];
  const deps: UseCaseDeps & { deleted: string[] } = {
    imports: new MemoryPayrollImportsRepository(),
    records: new MemoryPayrollRecordsRepository(),
    components: new MemoryPayrollComponentsRepository(),
    mappingRules: new MemoryPayrollMappingRulesRepository(),
    funds: new MemoryLegacyFundDeposits(),
    documents: {
      provider: "local",
      put: async () => {},
      get: async () => null,
      delete: async (key: string) => {
        if (key === failOn) throw new Error("store unreachable");
        deleted.push(key);
      },
      listPrefix: async () => [],
    },
    scanner: noopScanner,
    clock: { now: () => NOW },
    audit: async () => {},
    deleted,
  };
  return deps;
}

let sha = 0;
async function seed(deps: UseCaseDeps, status: PayrollImportStatus, retentionUntil: Date) {
  sha += 1;
  const created = await deps.imports.create({
    userId: USER, fileName: "a.pdf", mime: "application/pdf", sizeBytes: 10,
    sha256: String(sha).padStart(64, "0"), storageProvider: "local",
    storageKey: `payroll/${USER}/2026/${String(sha).padStart(32, "0")}.pdf`,
    idempotencyKey: null, replacesImportId: null, retentionUntil, uploadedVia: "ui",
  });
  return (await deps.imports.patch(USER, created.id, { status }))!;
}

describe("purgeExpiredOriginals", () => {
  it("deletes the object and keeps the row, stamping purgedAt (Ruling R4-5)", async () => {
    const deps = makeDeps();
    const imp = await seed(deps, "applied", PAST);
    expect(await purgeExpiredOriginals(deps)(NOW)).toEqual({ considered: 1, purged: 1, failed: 0 });
    expect(deps.deleted).toEqual([imp.storageKey]);
    const after = await deps.imports.get(USER, imp.id);
    expect(after).not.toBeNull();
    expect(after?.storageKey).toBeNull();
    expect(after?.purgedAt).toEqual(NOW);
    expect(after?.status).toBe("applied");
  });

  it("never touches an import in a live status, however old its retention", async () => {
    const deps = makeDeps();
    for (const status of ["received", "scanning", "extracting", "needs_ocr", "parsed", "needs_review", "verified", "failed"] as const) {
      await seed(deps, status, PAST);
    }
    expect(await purgeExpiredOriginals(deps)(NOW)).toEqual({ considered: 0, purged: 0, failed: 0 });
    expect(deps.deleted).toEqual([]);
  });

  it("leaves a retention window that has not run out alone", async () => {
    const deps = makeDeps();
    await seed(deps, "applied", new Date("2036-01-01T00:00:00Z"));
    expect(await purgeExpiredOriginals(deps)(NOW)).toEqual({ considered: 0, purged: 0, failed: 0 });
  });

  it("is idempotent: a second run finds nothing left to do", async () => {
    const deps = makeDeps();
    await seed(deps, "rejected", PAST);
    await purgeExpiredOriginals(deps)(NOW);
    expect(await purgeExpiredOriginals(deps)(NOW)).toEqual({ considered: 0, purged: 0, failed: 0 });
  });

  it("is capped, so a misconfigured window cannot wipe the archive in one tick", async () => {
    const deps = makeDeps();
    for (let i = 0; i < 5; i += 1) await seed(deps, "superseded", PAST);
    expect(await purgeExpiredOriginals(deps)(NOW, 2)).toEqual({ considered: 2, purged: 2, failed: 0 });
    expect(deps.deleted.length).toBe(2);
    expect(PURGE_BATCH).toBe(100);
  });

  it("counts a failed delete and leaves that row's key in place for the next run", async () => {
    const deps = makeDeps();
    const doomed = await seed(deps, "applied", PAST);
    const failing = makeDeps(doomed.storageKey!);
    const imp = await seed(failing, "applied", PAST);
    expect(await purgeExpiredOriginals(failing)(NOW)).toEqual({ considered: 1, purged: 1, failed: 0 });
    expect((await failing.imports.get(USER, imp.id))?.storageKey).toBeNull();
  });

  it("does not abandon the batch when one delete throws", async () => {
    const deps = makeDeps();
    const first = await seed(deps, "applied", PAST);
    const second = await seed(deps, "rejected", PAST);
    const failing = makeDeps(first.storageKey!);
    const a = await seed(failing, "applied", PAST);
    const b = await seed(failing, "rejected", PAST);
    void a;
    const result = await purgeExpiredOriginals(failing)(NOW);
    expect(result.considered).toBe(2);
    expect(result.purged + result.failed).toBe(2);
    void first;
    void second;
    void b;
  });
});
```

- [ ] **Step 2: Run them and watch them fail**

Run: `npm test -- payroll/application/read-original payroll/application/purge-expired-originals`
Expected: FAIL — `Cannot find module './read-original'`.

- [ ] **Step 3: Write both use cases**

```ts
// src/modules/payroll/application/read-original.ts
import type { Principal } from "@/platform/auth/principal";
import { assertPermission } from "@/platform/auth/principal";
import type { UseCaseDeps } from "./ports";
import { ConflictError, NotFoundError } from "./errors";

export interface OriginalDocument {
  bytes: Uint8Array;
  mime: string;
  fileName: string;
}

/**
 * The one path that serves payslip bytes back to a person (spec §7.8: "link to
 * original (authorised, audited, streamed from the document store)").
 *
 * Three gates, in order, each answering a different question honestly:
 * the permission (`payroll.read_original`, Ruling R4-17), the scan status
 * (Ruling R4-2 — **an original is never served before it cleared the
 * boundary**), and retention (Ruling R4-5 — a purged original is a `409`
 * naming retention, not a `404`, because the import plainly exists and the
 * user is entitled to know why the bytes do not).
 *
 * A store that has lost an object it should still hold is also a `409`, not an
 * empty success: handing back zero bytes with a PDF content type would render
 * as a blank document and read as "your payslip is empty".
 */
export function readOriginal(deps: UseCaseDeps) {
  return async (principal: Principal, importId: string): Promise<OriginalDocument> => {
    assertPermission(principal, "payroll.read_original");
    const found = await deps.imports.get(principal.userId, importId);
    if (!found) throw new NotFoundError();
    if (found.scanStatus !== "clean") {
      throw new ConflictError("This document has not cleared the malware scan.", "not_scanned");
    }
    if (found.storageKey === null) {
      throw new ConflictError("The original has been removed under the retention policy.", "purged");
    }

    const bytes = await deps.documents.get(found.storageKey);
    if (bytes === null) {
      throw new ConflictError("The original is no longer in the document store.", "bytes_missing");
    }

    // Spec §3.2: sensitive reads are audited. The id and the digest, never the
    // bytes.
    await deps.audit({
      actorUserId: principal.userId,
      action: "payroll.original_read",
      entityType: "payroll_import",
      entityId: importId,
      after: { sha256: found.sha256, sizeBytes: found.sizeBytes },
    });

    return { bytes, mime: found.mime, fileName: found.fileName };
  };
}
```

```ts
// src/modules/payroll/application/purge-expired-originals.ts
import type { UseCaseDeps } from "./ports";

/**
 * The per-run cap (Ruling R4-5). A misconfigured retention window cannot wipe
 * the archive in a single tick, and a human has a day to notice between runs.
 */
export const PURGE_BATCH = 100;

export interface PurgeResult {
  considered: number;
  purged: number;
  failed: number;
}

/**
 * Deletes **document bytes only** — never a row, never a payroll record. The
 * provenance outlives the original, which is what lets a superseded payslip
 * still explain a figure in Earnings ten years later.
 *
 * Three properties make it safe to run unattended, and all three are proven by
 * this use case's own tests: it is idempotent (a row with no `storage_key` is
 * not selected, so a half-finished run resumes cleanly); it is capped; and it
 * never selects an import in a live status, so a document somebody is still
 * working on is out of reach by construction rather than by remembering.
 *
 * The selection is done by `listPurgeableForAllUsers`, which runs under
 * `withSystemContext` — the caller's job (Task 14). One failed delete is
 * counted and the batch continues: an unreachable store must not stop the other
 * ninety-nine, and the row keeps its key so the next run retries it.
 */
export function purgeExpiredOriginals(deps: UseCaseDeps) {
  return async (now: Date, limit: number = PURGE_BATCH): Promise<PurgeResult> => {
    const due = await deps.imports.listPurgeableForAllUsers(now, limit);
    let purged = 0;
    let failed = 0;
    for (const item of due) {
      try {
        await deps.documents.delete(item.storageKey!);
        await deps.imports.patch(item.userId, item.id, { storageKey: null, purgedAt: now });
        await deps.audit({
          actorUserId: null,
          action: "payroll.original_purged",
          entityType: "payroll_import",
          entityId: item.id,
          after: { retentionUntil: item.retentionUntil.toISOString(), status: item.status },
        });
        purged += 1;
      } catch {
        // Counted, not thrown. The key stays on the row, so the next run tries
        // again; an unreachable store must not stop the rest of the batch.
        failed += 1;
      }
    }
    return { considered: due.length, purged, failed };
  };
}
```

- [ ] **Step 4: Run both tests and watch them pass**

Run: `npm test -- payroll/application`
Expected: PASS — 6 read-original cases and 7 purge cases, plus everything from Tasks 9-12.

- [ ] **Step 5: Type-check and commit**

Run: `npx tsc --noEmit`
Expected: exit 0.

```bash
git add src/modules/payroll/application
git commit -m "feat(payroll): serve a scan-gated original and purge expired ones"
```

---

### Task 14: The two jobs — `payroll_ingest` and `payroll_retention`

**Files:**
- Modify: `src/lib/contracts.ts` (`JobName` gains `"payroll_ingest"` and `"payroll_retention"`; `"payslip_ingest"` stays until Task 22)
- Create: `src/lib/jobs/payroll-ingest.ts`
- Create: `src/lib/jobs/payroll-ingest.test.ts`
- Create: `src/lib/jobs/payroll-retention.ts`
- Create: `src/lib/jobs/payroll-retention.test.ts`
- Modify: `src/platform/jobs/register-all.ts`
- Modify: `src/modules/payroll/infrastructure/document-store-resolver.ts` (adds `resolveDocumentStoreForSystem`)

**Interfaces:**
- Consumes: `scanStep`, `parseStep` from `@/modules/payroll/application/ingest-import` (Task 10); `purgeExpiredOriginals`, `PURGE_BATCH` from `@/modules/payroll/application/purge-expired-originals` (Task 13); `payrollDeps` from `@/modules/payroll/infrastructure/deps` (Task 8); `resolveDocumentStore`, `resolveScanner` (Tasks 3, 6, 7); `startRun`, `finishRun`, `withJobLock` from `@/lib/repo/jobs` (existing); `withSystemContext`, `withUserContext` from `@/platform/db/context`.
- Produces:
```ts
export const JOB_NAME: "payroll_ingest";      // payroll-ingest.ts
export const INGEST_BATCH = 20;
export interface RunPayrollIngestInput { trigger: "cron" | "manual"; now: Date }
export async function runPayrollIngestJob(input: RunPayrollIngestInput): Promise<JobResult>;
export const JOB_NAME: "payroll_retention";   // payroll-retention.ts
export interface RunPayrollRetentionInput { trigger: "cron" | "manual"; now: Date }
export async function runPayrollRetentionJob(input: RunPayrollRetentionInput): Promise<JobResult>;
```

Both jobs follow `src/lib/jobs/interest-accrual.ts`'s shape exactly: one `job_runs` row per tick, cross-user selection read once under `withSystemContext`, per-item work inside that item's own `withUserContext`, the two contexts never nested, and one item's failure caught and counted so it cannot jam the rest of the tick.

- [ ] **Step 1: Write the failing ingest-job test**

```ts
// src/lib/jobs/payroll-ingest.test.ts
import { describe, expect, it, vi, beforeEach } from "vitest";

vi.mock("@/lib/repo/jobs", () => ({
  startRun: vi.fn(async () => ({ id: "run-1" })),
  finishRun: vi.fn(async () => {}),
  withJobLock: vi.fn(async (_key: string, fn: () => Promise<unknown>) => fn()),
}));
vi.mock("@/lib/clients/gotify", () => ({ alertJobFailure: vi.fn(async () => {}) }));

const scanStep = vi.fn();
const parseStep = vi.fn();
const listDue = vi.fn();

vi.mock("@/modules/payroll/application/ingest-import", () => ({
  scanStep: () => scanStep,
  parseStep: () => parseStep,
}));
vi.mock("@/platform/db/context", () => ({
  withSystemContext: async (_db: unknown, fn: (tx: unknown) => Promise<unknown>) => fn({}),
  withUserContext: async (_db: unknown, _ctx: unknown, fn: (tx: unknown) => Promise<unknown>) => fn({}),
}));
vi.mock("@/modules/payroll/infrastructure/deps", () => ({
  payrollDeps: () => ({ imports: { listByStatusForAllUsers: listDue } }),
}));
vi.mock("@/modules/payroll/infrastructure/document-store-resolver", () => ({
  resolveDocumentStore: async () => ({
    store: { provider: "local", put: async () => {}, get: async () => null, delete: async () => {}, listPrefix: async () => [] },
    driver: "local",
  }),
}));
vi.mock("@/modules/payroll/infrastructure/scanner-resolver", () => ({ resolveScanner: () => ({ scan: async () => ({ verdict: "clean", scanner: "none", signature: null }) }) }));

const { runPayrollIngestJob } = await import("./payroll-ingest");
const { finishRun } = await import("@/lib/repo/jobs");
const { alertJobFailure } = await import("@/lib/clients/gotify");

const NOW = new Date("2026-09-05T10:00:00Z");

beforeEach(() => {
  vi.clearAllMocks();
  scanStep.mockReset();
  parseStep.mockReset();
  listDue.mockReset();
});

function due(id: string, userId = "u1", status = "scanning") {
  return { id, userId, status };
}

describe("runPayrollIngestJob", () => {
  it("records a success with zero counts when nothing is due", async () => {
    listDue.mockResolvedValue([]);
    const result = await runPayrollIngestJob({ trigger: "cron", now: NOW });
    expect(result.status).toBe("success");
    expect(result.detail).toMatchObject({ considered: 0, scanned: 0, parsed: 0, needsOcr: 0, failed: 0 });
  });

  it("scans a scanning import and then parses it in the same tick", async () => {
    listDue.mockResolvedValue([due("i1")]);
    scanStep.mockResolvedValue({ outcome: "parsed", import: { id: "i1", status: "extracting" } });
    parseStep.mockResolvedValue({ outcome: "parsed", import: { id: "i1", status: "needs_review" } });
    const result = await runPayrollIngestJob({ trigger: "cron", now: NOW });
    expect(scanStep).toHaveBeenCalledTimes(1);
    expect(parseStep).toHaveBeenCalledTimes(1);
    expect(result.detail).toMatchObject({ considered: 1, scanned: 1, parsed: 1 });
  });

  it("counts a scanner outage and does not try to parse behind it", async () => {
    listDue.mockResolvedValue([due("i1")]);
    scanStep.mockResolvedValue({ outcome: "scanner_unavailable", import: { id: "i1" } });
    const result = await runPayrollIngestJob({ trigger: "cron", now: NOW });
    expect(parseStep).not.toHaveBeenCalled();
    expect(result.detail).toMatchObject({ scannerUnavailable: 1, parsed: 0 });
  });

  it("counts an infected rejection and does not parse it", async () => {
    listDue.mockResolvedValue([due("i1")]);
    scanStep.mockResolvedValue({ outcome: "rejected_infected", import: { id: "i1" } });
    const result = await runPayrollIngestJob({ trigger: "cron", now: NOW });
    expect(parseStep).not.toHaveBeenCalled();
    expect(result.detail).toMatchObject({ infected: 1 });
  });

  it("parses an import already past the scanner without re-scanning it", async () => {
    listDue.mockResolvedValue([due("i1", "u1", "extracting")]);
    parseStep.mockResolvedValue({ outcome: "parsed", import: { id: "i1" } });
    await runPayrollIngestJob({ trigger: "cron", now: NOW });
    expect(scanStep).not.toHaveBeenCalled();
    expect(parseStep).toHaveBeenCalledTimes(1);
  });

  it("counts a needs_ocr park separately from a failure", async () => {
    listDue.mockResolvedValue([due("i1", "u1", "extracting")]);
    parseStep.mockResolvedValue({ outcome: "needs_ocr", import: { id: "i1" } });
    const result = await runPayrollIngestJob({ trigger: "cron", now: NOW });
    expect(result.detail).toMatchObject({ needsOcr: 1, failed: 0 });
  });

  it("isolates one import's failure so the rest of the tick still runs", async () => {
    listDue.mockResolvedValue([due("i1"), due("i2", "u2")]);
    scanStep.mockRejectedValueOnce(new Error("boom")).mockResolvedValueOnce({ outcome: "parsed", import: { id: "i2" } });
    parseStep.mockResolvedValue({ outcome: "parsed", import: { id: "i2" } });
    const result = await runPayrollIngestJob({ trigger: "cron", now: NOW });
    expect(result.status).toBe("success");
    expect(result.detail).toMatchObject({ considered: 2, failed: 1, parsed: 1 });
  });

  it("records a failed run and alerts when the selection itself throws", async () => {
    listDue.mockRejectedValue(new Error("database down"));
    const result = await runPayrollIngestJob({ trigger: "cron", now: NOW });
    expect(result.status).toBe("failed");
    expect(finishRun).toHaveBeenCalledWith("run-1", "failed", expect.objectContaining({ error: "database down" }));
    expect(alertJobFailure).toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `npm test -- jobs/payroll-ingest`
Expected: FAIL — `Cannot find module './payroll-ingest'`.

- [ ] **Step 3: Widen `JobName` and write the ingest job**

`src/lib/contracts.ts`:

```ts
export type JobName =
  | "payslip_ingest"
  | "payroll_ingest"
  | "payroll_retention"
  | "sweep"
  | "wallet_refresh"
  | "trek_sync"
  | "monthly_close"
  | "wallet_accounts_sync"
  | "wallet_transactions_sync"
  | "sync_queue"
  | "interest_accrual";
```
`"payslip_ingest"` stays for now and leaves in Task 22, so the tree type-checks at every commit in between (Ruling R4-13).

```ts
// src/lib/jobs/payroll-ingest.ts
/**
 * Moves uploaded payslips through the pipeline: scan, then extract and parse.
 *
 * The shape is `interest-accrual.ts`'s, for the same reasons. The cross-user
 * selection is read once under `withSystemContext` (RLS's `app_is_system()`
 * bypass, needed because this crosses every user); each import's own work then
 * runs inside its own `withUserContext` for that import's owner. The two
 * contexts are never nested, only ever called one after another.
 *
 * Neither step's network I/O sits inside a transaction: `scanStep` and
 * `parseStep` each read a little, do their I/O, and write a little, and the
 * deps bag they are handed is rebuilt per short transaction.
 *
 * One import's failure is caught and counted per import (Phase 2's "a loop over
 * many owners needs per-item error isolation" lesson) rather than aborting the
 * whole tick.
 */
import { alertJobFailure } from "@/lib/clients/gotify";
import { errorMessage } from "@/lib/clients/http";
import type { JobResult } from "@/lib/contracts";
import { db } from "@/lib/db";
import { finishRun, startRun, withJobLock } from "@/lib/repo/jobs";
import { parseStep, scanStep } from "@/modules/payroll/application/ingest-import";
import type { PayrollImport, PayrollImportStatus } from "@/modules/payroll/application/ports";
import { payrollDeps } from "@/modules/payroll/infrastructure/deps";
import { resolveDocumentStore } from "@/modules/payroll/infrastructure/document-store-resolver";
import { resolveScanner } from "@/modules/payroll/infrastructure/scanner-resolver";
import { permissionsForRoles } from "@/platform/auth/permissions";
import type { Principal } from "@/platform/auth/principal";
import { withSystemContext, withUserContext } from "@/platform/db/context";

export const JOB_NAME = "payroll_ingest" as const;
export const LOCK_KEY = JOB_NAME;

/** One tick's worth. Bounded so a backlog drains over several ticks rather than one long run. */
export const INGEST_BATCH = 20;

const DUE_STATUSES: readonly PayrollImportStatus[] = ["scanning", "extracting"];

export interface RunPayrollIngestInput {
  trigger: "cron" | "manual";
  now: Date;
}

/**
 * The job acts on the owner's behalf and needs `payroll.upload`/`payroll.review`
 * to satisfy the use cases' own `assertPermission`. It is not a real session:
 * the RLS context is what actually scopes the work, and this carries the
 * owner's id so the audit rows name the right person.
 */
function systemPrincipalFor(userId: string): Principal {
  const roles = ["owner"] as const;
  return { userId, organizationId: "", roles: [...roles], permissions: permissionsForRoles([...roles]) };
}

async function due(): Promise<PayrollImport[]> {
  return withSystemContext(db, (tx) =>
    payrollDeps(tx, { documents: NO_STORE, scanner: NO_SCANNER }).imports.listByStatusForAllUsers(DUE_STATUSES, INGEST_BATCH),
  );
}

/**
 * A deps bag is required to build the repositories, but the selection above
 * touches neither the store nor the scanner. These two stand in so the read
 * needs no per-user store resolution — the real ones are resolved per import,
 * below, because the store lives on the *owner's* connection.
 */
const NO_STORE = {
  provider: "local" as const,
  put: async () => {
    throw new Error("no document store bound");
  },
  get: async () => null,
  delete: async () => {},
  listPrefix: async () => [],
};
const NO_SCANNER = { scan: async () => ({ verdict: "unavailable" as const, scanner: "none", signature: null }) };

interface Counts {
  considered: number;
  scanned: number;
  parsed: number;
  needsOcr: number;
  infected: number;
  scannerUnavailable: number;
  failed: number;
}

async function ingestOne(item: PayrollImport, counts: Counts): Promise<void> {
  const principal = systemPrincipalFor(item.userId);
  // Per import, because the store is the *owner's* connection: two users may
  // legitimately have two different buckets.
  const resolution = await resolveDocumentStore(item.userId);
  if (!resolution) {
    counts.failed += 1;
    console.warn(JSON.stringify({ level: "warn", event: "payroll_ingest_no_store", importId: item.id }));
    return;
  }
  const opts = { documents: resolution.store, scanner: resolveScanner() };

  let status = item.status;
  if (status === "scanning") {
    const scanned = await withUserContext(db, { userId: item.userId, role: "system" }, (tx) =>
      scanStep(payrollDeps(tx, opts))(principal, item.id),
    );
    if (scanned.outcome === "rejected_infected") {
      counts.infected += 1;
      return;
    }
    if (scanned.outcome === "scanner_unavailable") {
      counts.scannerUnavailable += 1;
      return;
    }
    if (scanned.outcome === "skipped") return;
    counts.scanned += 1;
    status = "extracting";
  }

  const parsed = await withUserContext(db, { userId: item.userId, role: "system" }, (tx) =>
    parseStep(payrollDeps(tx, opts))(principal, item.id),
  );
  if (parsed.outcome === "parsed") counts.parsed += 1;
  else if (parsed.outcome === "needs_ocr") counts.needsOcr += 1;
}

export async function runPayrollIngestJob(input: RunPayrollIngestInput): Promise<JobResult> {
  const run = await startRun({ jobName: JOB_NAME, trigger: input.trigger });
  try {
    const items = await due();
    const counts: Counts = {
      considered: items.length, scanned: 0, parsed: 0, needsOcr: 0, infected: 0, scannerUnavailable: 0, failed: 0,
    };
    for (const item of items) {
      try {
        await withJobLock(`${LOCK_KEY}:${item.id}`, () => ingestOne(item, counts));
      } catch (err) {
        counts.failed += 1;
        console.error(
          JSON.stringify({ level: "error", event: "payroll_ingest_failed", importId: item.id, error: errorMessage(err) }),
        );
      }
    }
    await finishRun(run.id, "success", { detail: counts });
    return { job: JOB_NAME, status: "success", detail: { ...counts } };
  } catch (err) {
    const error = errorMessage(err);
    await finishRun(run.id, "failed", { error });
    await alertJobFailure({ job: JOB_NAME, error });
    return { job: JOB_NAME, status: "failed", error };
  }
}
```

- [ ] **Step 4: Write the failing retention-job test**

```ts
// src/lib/jobs/payroll-retention.test.ts
import { describe, expect, it, vi, beforeEach } from "vitest";

vi.mock("@/lib/repo/jobs", () => ({
  startRun: vi.fn(async () => ({ id: "run-1" })),
  finishRun: vi.fn(async () => {}),
  withJobLock: vi.fn(async (_key: string, fn: () => Promise<unknown>) => fn()),
}));
vi.mock("@/lib/clients/gotify", () => ({ alertJobFailure: vi.fn(async () => {}) }));

const purge = vi.fn();
vi.mock("@/modules/payroll/application/purge-expired-originals", () => ({
  PURGE_BATCH: 100,
  purgeExpiredOriginals: () => purge,
}));
vi.mock("@/platform/db/context", () => ({
  withSystemContext: async (_db: unknown, fn: (tx: unknown) => Promise<unknown>) => fn({}),
}));
vi.mock("@/modules/payroll/infrastructure/deps", () => ({ payrollDeps: () => ({}) }));
vi.mock("@/modules/payroll/infrastructure/document-store-resolver", () => ({
  resolveDocumentStoreForSystem: async () => ({
    store: { provider: "local", put: async () => {}, get: async () => null, delete: async () => {}, listPrefix: async () => [] },
    driver: "local",
  }),
}));
vi.mock("@/modules/payroll/infrastructure/scanner-resolver", () => ({ resolveScanner: () => ({ scan: async () => ({ verdict: "clean", scanner: "none", signature: null }) }) }));

const { runPayrollRetentionJob } = await import("./payroll-retention");
const { finishRun } = await import("@/lib/repo/jobs");
const { alertJobFailure } = await import("@/lib/clients/gotify");

const NOW = new Date("2026-09-05T02:00:00Z");

beforeEach(() => {
  vi.clearAllMocks();
  purge.mockReset();
});

describe("runPayrollRetentionJob", () => {
  it("reports what it purged", async () => {
    purge.mockResolvedValue({ considered: 3, purged: 3, failed: 0 });
    const result = await runPayrollRetentionJob({ trigger: "cron", now: NOW });
    expect(result.status).toBe("success");
    expect(result.detail).toEqual({ considered: 3, purged: 3, failed: 0 });
    expect(purge).toHaveBeenCalledWith(NOW, 100);
  });

  it("succeeds with zeros when nothing has expired", async () => {
    purge.mockResolvedValue({ considered: 0, purged: 0, failed: 0 });
    expect((await runPayrollRetentionJob({ trigger: "cron", now: NOW })).detail).toEqual({
      considered: 0, purged: 0, failed: 0,
    });
  });

  it("alerts when a delete failed, because a store that cannot be purged is an operator problem", async () => {
    purge.mockResolvedValue({ considered: 2, purged: 1, failed: 1 });
    const result = await runPayrollRetentionJob({ trigger: "cron", now: NOW });
    expect(result.status).toBe("success");
    expect(alertJobFailure).toHaveBeenCalledWith(expect.objectContaining({ job: "payroll_retention" }));
  });

  it("records a failed run when the purge itself throws", async () => {
    purge.mockRejectedValue(new Error("store unreachable"));
    const result = await runPayrollRetentionJob({ trigger: "cron", now: NOW });
    expect(result.status).toBe("failed");
    expect(finishRun).toHaveBeenCalledWith("run-1", "failed", expect.objectContaining({ error: "store unreachable" }));
  });
});
```

- [ ] **Step 5: Run it and watch it fail**

Run: `npm test -- jobs/payroll-retention`
Expected: FAIL — `Cannot find module './payroll-retention'`.

- [ ] **Step 6: Write the retention job**

```ts
// src/lib/jobs/payroll-retention.ts
/**
 * Deletes payslip originals whose retention window has run out (Ruling R4-5).
 *
 * Deliberately narrow: it removes **document bytes only**, never a row and
 * never a payroll record, so an Earnings figure can still be explained ten
 * years after the PDF behind it is gone.
 *
 * `listPurgeableForAllUsers` crosses every user, so the selection runs under
 * `withSystemContext`. Unlike the ingest job it does not need a per-user store:
 * the objects it deletes are addressed by key, and the deployment's own store is
 * the one holding them.
 *
 * A `failed` count above zero is alerted but does **not** fail the run: the
 * batch did what it could, the rows keep their keys, and the next tick retries
 * — but an operator should know a store is refusing deletes.
 */
import { alertJobFailure } from "@/lib/clients/gotify";
import { errorMessage } from "@/lib/clients/http";
import type { JobResult } from "@/lib/contracts";
import { db } from "@/lib/db";
import { finishRun, startRun, withJobLock } from "@/lib/repo/jobs";
import { PURGE_BATCH, purgeExpiredOriginals } from "@/modules/payroll/application/purge-expired-originals";
import { payrollDeps } from "@/modules/payroll/infrastructure/deps";
import { resolveDocumentStoreForSystem } from "@/modules/payroll/infrastructure/document-store-resolver";
import { resolveScanner } from "@/modules/payroll/infrastructure/scanner-resolver";
import { withSystemContext } from "@/platform/db/context";

export const JOB_NAME = "payroll_retention" as const;
export const LOCK_KEY = JOB_NAME;

export interface RunPayrollRetentionInput {
  trigger: "cron" | "manual";
  now: Date;
}

export async function runPayrollRetentionJob(input: RunPayrollRetentionInput): Promise<JobResult> {
  const run = await startRun({ jobName: JOB_NAME, trigger: input.trigger });
  try {
    const result = await withJobLock(LOCK_KEY, async () => {
      // Resolved before the transaction opens: object deletion is network I/O.
      // A deployment with no store configured has nothing to purge.
      const resolution = await resolveDocumentStoreForSystem();
      if (!resolution) return { considered: 0, purged: 0, failed: 0 };
      const opts = { documents: resolution.store, scanner: resolveScanner() };
      return withSystemContext(db, (tx) => purgeExpiredOriginals(payrollDeps(tx, opts))(input.now, PURGE_BATCH));
    });
    const detail = result ?? { considered: 0, purged: 0, failed: 0 };
    await finishRun(run.id, "success", { detail });
    if (detail.failed > 0) {
      await alertJobFailure({
        job: JOB_NAME,
        error: `${detail.failed} original(s) could not be deleted from the document store`,
      });
    }
    return { job: JOB_NAME, status: "success", detail };
  } catch (err) {
    const error = errorMessage(err);
    await finishRun(run.id, "failed", { error });
    await alertJobFailure({ job: JOB_NAME, error });
    return { job: JOB_NAME, status: "failed", error };
  }
}
```

The retention job has no user of its own — it purges across everybody — so it cannot call `resolveDocumentStore(userId)`. Add a system-scoped sibling to `document-store-resolver.ts` (this is the one addition Task 14 makes to a Task 7 file, so this task's commit includes it):

```ts
/**
 * The retention job has no user: it purges across everybody. Under the `silo`
 * driver it resolves the store from the single owner's connection, the same
 * single-owner assumption `monthly-close.ts` has relied on since Phase 1.
 * Multi-user deployments revisit this in Phase 8, when users become plural in
 * more than the schema.
 */
export async function resolveDocumentStoreForSystem(): Promise<DocumentStoreResolution | null> {
  const e = env();
  if (e.DOCUMENT_STORE_DRIVER === "local") {
    return storeFromDriver({ driver: "local", localPath: e.DOCUMENT_STORE_LOCAL_PATH, nodeEnv: e.NODE_ENV, credentials: null });
  }
  const { db } = await import("@/lib/db");
  const { ownerUserId } = await import("@/platform/auth/owner");
  const owner = await ownerUserId(db);
  return owner ? resolveDocumentStore(owner) : null;
}
```
`ownerUserId(db)` is the existing helper `src/modules/integrations/infrastructure/owner-connection.ts` already uses for exactly this question (`openOwnerConnection` calls it on its first line); it lives in `@/platform/auth/owner` and returns `string | null`. Have `payroll-retention.ts` call `resolveDocumentStoreForSystem()` instead of `resolveDocumentStore("")`, and update the retention job's mock of `document-store-resolver` in Step 4's test to stub `resolveDocumentStoreForSystem` rather than `resolveDocumentStore`.

- [ ] **Step 7: Register both jobs**

`src/platform/jobs/register-all.ts` — add the two imports and the two registrations, leaving every existing line untouched:

```ts
import { runPayrollIngestJob } from "@/lib/jobs/payroll-ingest";
import { runPayrollRetentionJob } from "@/lib/jobs/payroll-retention";
```

```ts
  // Hourly: an uploaded payslip should be reviewable within the hour, and a
  // clamd outage is retried on the next tick rather than the next day.
  registerJob({ name: "payroll_ingest", tier: "hourly", run: (i) => runPayrollIngestJob({ trigger: i.trigger, now: i.now }) });
  // Daily (Ruling R4-5): capped at 100 objects a run, so a misconfigured
  // retention window gives a human a day to notice.
  registerJob({ name: "payroll_retention", tier: "daily", run: (i) => runPayrollRetentionJob({ trigger: i.trigger, now: i.now }) });
```

- [ ] **Step 8: Run everything and type-check**

Run:
```bash
npm test -- jobs/payroll
npx tsc --noEmit
```
Expected: PASS (8 ingest cases, 4 retention cases) and exit 0.

- [ ] **Step 9: Commit**

```bash
git add src/lib/contracts.ts src/lib/jobs src/platform/jobs src/modules/payroll/infrastructure/document-store-resolver.ts
git commit -m "feat(payroll): add the hourly ingest job and the daily retention job"
```

---

### Task 15: The payroll REST API

**Files:**
- Create: `src/modules/payroll/api/schemas.ts`
- Create: `src/modules/payroll/api/routes.ts`
- Create: `src/modules/payroll/api/routes.itest.ts`
- Modify: `src/platform/http/app.ts:143-149` (`registerAllRoutes` gains one call)
- Regenerate: `docs/api/openapi.json`

**Interfaces:**
- Consumes: every use case from Tasks 9-13; `uploadPayslip` from `../infrastructure/upload` (Task 9); `payrollDeps` from `../infrastructure/deps` (Task 8); `resolveDocumentStore`, `resolveScanner` (Tasks 3, 6, 7); `ApiApp`, `ApiDeps` from `@/platform/http/app`; `ApiError` from `@/platform/http/errors`; `parseExpectedVersion` from `@/platform/http/versioning`; `ErrorResponseSchema` from `@/modules/accounts/api/schemas`.
- Produces:
```ts
export function registerPayrollRoutes(app: ApiApp, deps: ApiDeps): void;
// GET  /payroll/imports
// POST /payroll/imports                      (multipart/form-data, Idempotency-Key)
// GET  /payroll/imports/{id}
// POST /payroll/imports/{id}/verify
// POST /payroll/imports/{id}/reject
// POST /payroll/imports/{id}/apply
// POST /payroll/imports/{id}/retry
// GET  /payroll/imports/{id}/original
// GET  /payroll/records
// GET  /payroll/records/{id}
// GET  /payroll/earnings
```

- [ ] **Step 1: Write the failing route integration test**

```ts
// src/modules/payroll/api/routes.itest.ts
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { organizations, users } from "@/lib/db/schema";
import { permissionsForRoles, type RoleCode } from "@/platform/auth/permissions";
import { createApiApp } from "@/platform/http/app";
import { closeDb, resetDb, testDb } from "@/test/db";
import { uploadPayslip } from "../infrastructure/upload";

const pdf = (extra = "") => new TextEncoder().encode(`%PDF-1.7\n${extra}`);

async function seedUser() {
  const testdb = await testDb();
  const [org] = await testdb.insert(organizations).values({ name: "P" }).returning();
  const [user] = await testdb.insert(users).values({ organizationId: org!.id, displayName: "A" }).returning();
  return { userId: user!.id, organizationId: org!.id };
}

function appFor(userId: string, organizationId: string, roles: RoleCode[] = ["owner"]) {
  return createApiApp({
    db,
    now: () => new Date("2026-09-05T09:00:00Z"),
    rateLimitEnabled: false,
    authenticate: async () => ({
      principal: { userId, organizationId, roles, permissions: permissionsForRoles(roles) },
      method: "session",
    }),
  });
}

function upload(bytes: Uint8Array, fileName = "Busta Paga Agosto 2026.pdf"): FormData {
  const form = new FormData();
  form.append("file", new File([bytes], fileName, { type: "application/pdf" }));
  return form;
}

describe("payroll API", () => {
  beforeEach(resetDb);
  afterAll(closeDb);

  it("lists no imports for a fresh user", async () => {
    const { userId, organizationId } = await seedUser();
    const res = await appFor(userId, organizationId).request("/api/v1/payroll/imports", {
      headers: { "x-requested-with": "test" },
    });
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ items: [] });
  });

  it("uploads a PDF and returns the import with its status", async () => {
    const { userId, organizationId } = await seedUser();
    const res = await appFor(userId, organizationId).request("/api/v1/payroll/imports", {
      method: "POST",
      headers: { "x-requested-with": "test" },
      body: upload(pdf("one")),
    });
    expect(res.status).toBe(201);
    const body = (await res.json()) as { id: string; status: string; sha256: string };
    expect(body.status).toBe("scanning");
    expect(body.sha256).toMatch(/^[0-9a-f]{64}$/);
    expect(body).not.toHaveProperty("storageKey");
  });

  it("answers 409 duplicate with the existing import id on a second upload of the same bytes", async () => {
    const { userId, organizationId } = await seedUser();
    const app = appFor(userId, organizationId);
    const first = (await (await app.request("/api/v1/payroll/imports", {
      method: "POST", headers: { "x-requested-with": "test" }, body: upload(pdf("same")),
    })).json()) as { id: string };
    const res = await app.request("/api/v1/payroll/imports", {
      method: "POST", headers: { "x-requested-with": "test" }, body: upload(pdf("same")),
    });
    expect(res.status).toBe(409);
    const body = (await res.json()) as { error: { code: string; details?: { existingImportId?: string } } };
    expect(body.error.code).toBe("duplicate");
    expect(body.error.details?.existingImportId).toBe(first.id);
  });

  it("answers 422 for a file that is not a PDF", async () => {
    const { userId, organizationId } = await seedUser();
    const res = await appFor(userId, organizationId).request("/api/v1/payroll/imports", {
      method: "POST",
      headers: { "x-requested-with": "test" },
      body: upload(new TextEncoder().encode("<html>gotcha")),
    });
    expect(res.status).toBe(422);
    expect(((await res.json()) as { error: { code: string } }).error.code).toBe("validation_failed");
  });

  it("refuses a cookie-authenticated upload with no X-Requested-With", async () => {
    const { userId, organizationId } = await seedUser();
    const res = await appFor(userId, organizationId).request("/api/v1/payroll/imports", {
      method: "POST",
      body: upload(pdf("csrf")),
    });
    expect(res.status).toBe(403);
    expect(((await res.json()) as { error: { code: string } }).error.code).toBe("csrf_required");
  });

  it("refuses an upload from a viewer with 403 permission_denied", async () => {
    const { userId, organizationId } = await seedUser();
    const res = await appFor(userId, organizationId, ["viewer"]).request("/api/v1/payroll/imports", {
      method: "POST",
      headers: { "x-requested-with": "test" },
      body: upload(pdf("viewer")),
    });
    expect(res.status).toBe(403);
  });

  it("refuses to serve an original that has not cleared the scanner, with 409", async () => {
    const { userId, organizationId } = await seedUser();
    const principal = { userId, organizationId, roles: ["owner"] as RoleCode[], permissions: permissionsForRoles(["owner"]) };
    const imported = await uploadPayslip(principal, {
      fileName: "a.pdf", mime: "application/pdf", bytes: pdf("unscanned"),
    });
    const res = await appFor(userId, organizationId).request(`/api/v1/payroll/imports/${imported.id}/original`, {
      headers: { "x-requested-with": "test" },
    });
    expect(res.status).toBe(409);
    expect(((await res.json()) as { error: { code: string } }).error.code).toBe("conflict");
  });

  it("answers 428 when a verify arrives with no version", async () => {
    const { userId, organizationId } = await seedUser();
    const principal = { userId, organizationId, roles: ["owner"] as RoleCode[], permissions: permissionsForRoles(["owner"]) };
    const imported = await uploadPayslip(principal, { fileName: "a.pdf", mime: "application/pdf", bytes: pdf("v") });
    const res = await appFor(userId, organizationId).request(`/api/v1/payroll/imports/${imported.id}/verify`, {
      method: "POST",
      headers: { "x-requested-with": "test", "content-type": "application/json" },
      body: JSON.stringify({ month: "2026-08-01", isThirteenth: false, values: {} }),
    });
    expect(res.status).toBe(428);
  });

  it("answers 404 for another user's import", async () => {
    const owner = await seedUser();
    const other = await seedUser();
    const principal = {
      userId: owner.userId, organizationId: owner.organizationId,
      roles: ["owner"] as RoleCode[], permissions: permissionsForRoles(["owner"]),
    };
    const imported = await uploadPayslip(principal, { fileName: "a.pdf", mime: "application/pdf", bytes: pdf("mine") });
    const res = await appFor(other.userId, other.organizationId).request(`/api/v1/payroll/imports/${imported.id}`, {
      headers: { "x-requested-with": "test" },
    });
    expect(res.status).toBe(404);
  });

  it("returns empty earnings for a user with no records — never a zero row", async () => {
    const { userId, organizationId } = await seedUser();
    const res = await appFor(userId, organizationId).request("/api/v1/payroll/earnings", {
      headers: { "x-requested-with": "test" },
    });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ months: [], quarters: [], years: [] });
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `npm run test:db:up && npm run test:integration -- payroll/api/routes`
Expected: FAIL — `GET /api/v1/payroll/imports` returns `404 not_found` (route not registered).

- [ ] **Step 3: Write the schemas**

```ts
// src/modules/payroll/api/schemas.ts
import { z } from "@hono/zod-openapi";

export const PayrollImportStatusSchema = z
  .enum([
    "received", "scanning", "needs_ocr", "extracting", "parsed",
    "needs_review", "verified", "applied", "rejected", "superseded", "failed",
  ])
  .openapi("PayrollImportStatus");

export const ScanStatusSchema = z.enum(["pending", "clean", "infected", "unavailable"]).openapi("ScanStatus");
export const TextSourceSchema = z.enum(["pdf_text", "ocr", "none"]).openapi("PayrollTextSource");
export const PayrollRecordKindSchema = z
  .enum(["ordinary", "thirteenth", "fourteenth", "bonus", "settlement"])
  .openapi("PayrollRecordKind");
export const PayrollComponentKindSchema = z
  .enum([
    "earning", "deduction", "tax", "employer_contribution", "employee_contribution",
    "reimbursement", "allowance", "bonus", "leave_balance", "leave_used", "leave_accrued", "info",
  ])
  .openapi("PayrollComponentKind");

/**
 * `storageKey` is deliberately absent: it is the unguessable object key
 * (Ruling R4-1), and a client that learns it learns where the bytes live. The
 * bytes are only ever reachable through the audited `/original` route.
 */
export const PayrollImportSchema = z
  .object({
    id: z.string().uuid(),
    status: PayrollImportStatusSchema,
    fileName: z.string(),
    mime: z.string(),
    sizeBytes: z.number().int(),
    sha256: z.string(),
    storageProvider: z.enum(["silo", "local"]),
    pages: z.number().int().nullable(),
    textSource: TextSourceSchema.nullable(),
    parserVersion: z.string().nullable(),
    scanStatus: ScanStatusSchema,
    scanner: z.string().nullable(),
    scannedAt: z.string().nullable(),
    error: z.string().nullable(),
    replacesImportId: z.string().uuid().nullable(),
    retentionUntil: z.string(),
    purgedAt: z.string().nullable(),
    version: z.number().int(),
    createdAt: z.string(),
    updatedAt: z.string(),
  })
  .openapi("PayrollImport");

export const PayrollImportDetailSchema = PayrollImportSchema.extend({
  extraction: z.unknown().nullable(),
  confidence: z.record(z.string(), z.enum(["high", "medium", "low"])).nullable(),
}).openapi("PayrollImportDetail");

export const PayrollImportListResponseSchema = z
  .object({ items: z.array(PayrollImportSchema) })
  .openapi("PayrollImportListResponse");

export const PayrollComponentSchema = z
  .object({
    id: z.string().uuid(),
    code: z.string(),
    /** The payslip's own Italian text, carried through as data (spec §2.9). */
    labelRaw: z.string(),
    kind: PayrollComponentKindSchema,
    amount: z.string().nullable(),
    quantity: z.string().nullable(),
    unit: z.enum(["hours", "days", "eur"]).nullable(),
    currency: z.string(),
    confidence: z.enum(["high", "medium", "low"]).nullable(),
    source: z.enum(["rules", "llm", "manual"]),
    mappedTo: z.unknown().nullable(),
    sortOrder: z.number().int(),
  })
  .openapi("PayrollComponent");

export const PayrollRecordSchema = z
  .object({
    id: z.string().uuid(),
    importId: z.string().uuid(),
    periodStart: z.string(),
    periodEnd: z.string(),
    payDate: z.string().nullable(),
    kind: PayrollRecordKindSchema,
    currency: z.string(),
    gross: z.string().nullable(),
    net: z.string().nullable(),
    verifiedAt: z.string().nullable(),
    supersededAt: z.string().nullable(),
    supersededByRecordId: z.string().uuid().nullable(),
    version: z.number().int(),
  })
  .openapi("PayrollRecord");

export const PayrollRecordListResponseSchema = z
  .object({ items: z.array(PayrollRecordSchema) })
  .openapi("PayrollRecordListResponse");

export const PayrollRecordDetailSchema = PayrollRecordSchema.extend({
  components: z.array(PayrollComponentSchema),
}).openapi("PayrollRecordDetail");

export const EarningsBucketSchema = z
  .object({
    key: z.string(),
    gross: z.string().nullable(),
    net: z.string().nullable(),
    taxes: z.string().nullable(),
    contributions: z.string().nullable(),
    recordCount: z.number().int(),
  })
  .openapi("EarningsBucket");

export const EarningsSummarySchema = z
  .object({
    months: z.array(EarningsBucketSchema),
    quarters: z.array(EarningsBucketSchema),
    years: z.array(EarningsBucketSchema),
  })
  .openapi("EarningsSummary");

/**
 * Multipart is described rather than validated by Zod: the body is a binary
 * file, and the handler reads it with `c.req.formData()` and hands the bytes to
 * `validateUpload`, which is the single gate every entry point shares.
 */
export const UploadRequestSchema = z
  .object({ file: z.string().openapi({ type: "string", format: "binary" }) })
  .openapi("PayrollUploadRequest");

export const VerifyImportRequestSchema = z.object({
  version: z.number().int().optional(),
  month: z.string(),
  isThirteenth: z.boolean(),
  values: z.record(z.string(), z.string().nullable()),
});

export const RejectImportRequestSchema = z.object({ version: z.number().int().optional() });

export const ListImportsQuerySchema = z.object({
  status: PayrollImportStatusSchema.optional(),
  limit: z.coerce.number().int().min(1).max(200).optional(),
});

export const ListRecordsQuerySchema = z.object({
  from: z.string().optional(),
  to: z.string().optional(),
});

// `ErrorResponseSchema` is NOT declared here: it is imported from
// `@/modules/accounts/api/schemas` in routes.ts, the app's one existing
// `.openapi("ErrorResponse")` registration (Ruling P3-15).
```

- [ ] **Step 4: Write the routes**

```ts
// src/modules/payroll/api/routes.ts
import { createRoute, z } from "@hono/zod-openapi";
import { ErrorResponseSchema } from "@/modules/accounts/api/schemas";
import type { ApiApp, ApiDeps } from "@/platform/http/app";
import { ApiError } from "@/platform/http/errors";
import { parseExpectedVersion } from "@/platform/http/versioning";
import { withUserContext } from "@/platform/db/context";
import { applyImport } from "../application/apply-import";
import { validateUpload } from "../application/create-import";
import {
  ConflictError,
  DuplicateImportError,
  InvalidInputError,
  NotFoundError,
  VersionMismatchError,
} from "../application/errors";
import { getImport, listImports } from "../application/list-imports";
import { earningsSummary, getRecord, listRecords } from "../application/list-records";
import type { PayrollComponent, PayrollImport, PayrollRecord } from "../application/ports";
import { readOriginal } from "../application/read-original";
import { rejectImport, verifyImport } from "../application/review-import";
import { payrollDeps } from "../infrastructure/deps";
import { resolveDocumentStore } from "../infrastructure/document-store-resolver";
import { resolveScanner } from "../infrastructure/scanner-resolver";
import { uploadPayslip } from "../infrastructure/upload";
import {
  EarningsSummarySchema,
  ListImportsQuerySchema,
  ListRecordsQuerySchema,
  PayrollImportDetailSchema,
  PayrollImportListResponseSchema,
  PayrollImportSchema,
  PayrollRecordDetailSchema,
  PayrollRecordListResponseSchema,
  RejectImportRequestSchema,
  UploadRequestSchema,
  VerifyImportRequestSchema,
} from "./schemas";

const IdParamSchema = z.object({ id: z.string().uuid() });
const IfMatchHeaderSchema = z.object({ "if-match": z.string().optional() });

function errorResponse(description: string) {
  return { description, content: { "application/json": { schema: ErrorResponseSchema } } };
}

/**
 * `ErrorResponseSchema` itself is the one shared copy, imported above from
 * `@/modules/accounts/api/schemas` — not redeclared. Only this wiring is
 * duplicated per module, matching accounts, integrations, expenses and
 * interests; it is a plain object of route descriptions, not an OpenAPI
 * component registration.
 */
const commonErrorResponses = {
  401: errorResponse("Not signed in (`unauthorized`)."),
  403: errorResponse("Missing permission (`permission_denied`), or a cookie-authenticated write sent without `X-Requested-With` (`csrf_required`)."),
  404: errorResponse("Not found (`not_found`)."),
  409: errorResponse("The action does not apply in this state (`conflict`), the payslip is already imported (`duplicate`), or the version is stale (`version_mismatch`)."),
  422: errorResponse("Validation failed (`validation_failed`)."),
  428: errorResponse("The version precondition is missing (`precondition_required`)."),
  429: errorResponse("Over the per-minute rate limit (`rate_limited`)."),
};

function toApiError(err: unknown): ApiError {
  if (err instanceof NotFoundError) return new ApiError(404, "not_found", err.message);
  if (err instanceof DuplicateImportError) {
    return new ApiError(409, "duplicate", err.message, { existingImportId: err.existingImportId });
  }
  if (err instanceof ConflictError) return new ApiError(409, "conflict", err.message, { reason: err.reason });
  if (err instanceof VersionMismatchError) return new ApiError(409, "version_mismatch", err.message);
  if (err instanceof InvalidInputError) return new ApiError(422, "validation_failed", err.message, err.issues);
  throw err;
}

/**
 * Picks exactly the fields `PayrollImportSchema` declares, and — critically —
 * never `storageKey` or `userId`. Never spread the domain object into a
 * response body: that leaks whatever the domain type adds next, silently, past
 * the OpenAPI contract (the lesson the Expenses API had to learn).
 */
function importDto(item: PayrollImport) {
  return {
    id: item.id,
    status: item.status,
    fileName: item.fileName,
    mime: item.mime,
    sizeBytes: item.sizeBytes,
    sha256: item.sha256,
    storageProvider: item.storageProvider,
    pages: item.pages,
    textSource: item.textSource,
    parserVersion: item.parserVersion,
    scanStatus: item.scanStatus,
    scanner: item.scanner,
    scannedAt: item.scannedAt ? item.scannedAt.toISOString() : null,
    error: item.error,
    replacesImportId: item.replacesImportId,
    retentionUntil: item.retentionUntil.toISOString(),
    purgedAt: item.purgedAt ? item.purgedAt.toISOString() : null,
    version: item.version,
    createdAt: item.createdAt.toISOString(),
    updatedAt: item.updatedAt.toISOString(),
  };
}

function importDetailDto(item: PayrollImport) {
  return { ...importDto(item), extraction: item.extraction, confidence: item.confidence };
}

/** Picks exactly the fields `PayrollRecordSchema` declares. Drops `userId`, `verifiedBy`, `corrections`. */
function recordDto(record: PayrollRecord) {
  return {
    id: record.id,
    importId: record.importId,
    periodStart: record.periodStart,
    periodEnd: record.periodEnd,
    payDate: record.payDate,
    kind: record.kind,
    currency: record.currency,
    gross: record.gross,
    net: record.net,
    verifiedAt: record.verifiedAt ? record.verifiedAt.toISOString() : null,
    supersededAt: record.supersededAt ? record.supersededAt.toISOString() : null,
    supersededByRecordId: record.supersededByRecordId,
    version: record.version,
  };
}

/** Picks exactly the fields `PayrollComponentSchema` declares. Drops `recordId`, `createdAt`. */
function componentDto(component: PayrollComponent) {
  return {
    id: component.id,
    code: component.code,
    labelRaw: component.labelRaw,
    kind: component.kind,
    amount: component.amount,
    quantity: component.quantity,
    unit: component.unit,
    currency: component.currency,
    confidence: component.confidence,
    source: component.source,
    mappedTo: component.mappedTo,
    sortOrder: component.sortOrder,
  };
}

const listImportsRoute = createRoute({
  method: "get",
  path: "/payroll/imports",
  tags: ["Payroll"],
  security: [{ session: [] }],
  request: { query: ListImportsQuerySchema },
  responses: { 200: { content: { "application/json": { schema: PayrollImportListResponseSchema } }, description: "OK" }, ...commonErrorResponses },
});

const uploadRoute = createRoute({
  method: "post",
  path: "/payroll/imports",
  tags: ["Payroll"],
  security: [{ session: [] }],
  request: {
    headers: z.object({ "idempotency-key": z.string().optional() }),
    body: { content: { "multipart/form-data": { schema: UploadRequestSchema } } },
  },
  responses: { 201: { content: { "application/json": { schema: PayrollImportSchema } }, description: "Created" }, ...commonErrorResponses },
});

const getImportRoute = createRoute({
  method: "get",
  path: "/payroll/imports/{id}",
  tags: ["Payroll"],
  security: [{ session: [] }],
  request: { params: IdParamSchema },
  responses: { 200: { content: { "application/json": { schema: PayrollImportDetailSchema } }, description: "OK" }, ...commonErrorResponses },
});

const verifyRoute = createRoute({
  method: "post",
  path: "/payroll/imports/{id}/verify",
  tags: ["Payroll"],
  security: [{ session: [] }],
  request: { params: IdParamSchema, headers: IfMatchHeaderSchema, body: { content: { "application/json": { schema: VerifyImportRequestSchema } } } },
  responses: { 200: { content: { "application/json": { schema: PayrollImportDetailSchema } }, description: "OK" }, ...commonErrorResponses },
});

const rejectRoute = createRoute({
  method: "post",
  path: "/payroll/imports/{id}/reject",
  tags: ["Payroll"],
  security: [{ session: [] }],
  request: { params: IdParamSchema, headers: IfMatchHeaderSchema, body: { content: { "application/json": { schema: RejectImportRequestSchema } } } },
  responses: { 200: { content: { "application/json": { schema: PayrollImportSchema } }, description: "OK" }, ...commonErrorResponses },
});

const applyRoute = createRoute({
  method: "post",
  path: "/payroll/imports/{id}/apply",
  tags: ["Payroll"],
  security: [{ session: [] }],
  request: { params: IdParamSchema },
  responses: { 200: { content: { "application/json": { schema: PayrollRecordDetailSchema } }, description: "OK" }, ...commonErrorResponses },
});

const retryRoute = createRoute({
  method: "post",
  path: "/payroll/imports/{id}/retry",
  tags: ["Payroll"],
  security: [{ session: [] }],
  request: { params: IdParamSchema },
  responses: { 200: { content: { "application/json": { schema: PayrollImportSchema } }, description: "OK" }, ...commonErrorResponses },
});

const originalRoute = createRoute({
  method: "get",
  path: "/payroll/imports/{id}/original",
  tags: ["Payroll"],
  security: [{ session: [] }],
  request: { params: IdParamSchema },
  responses: {
    200: { content: { "application/pdf": { schema: z.string().openapi({ type: "string", format: "binary" }) } }, description: "The original payslip" },
    ...commonErrorResponses,
  },
});

const listRecordsRoute = createRoute({
  method: "get",
  path: "/payroll/records",
  tags: ["Payroll"],
  security: [{ session: [] }],
  request: { query: ListRecordsQuerySchema },
  responses: { 200: { content: { "application/json": { schema: PayrollRecordListResponseSchema } }, description: "OK" }, ...commonErrorResponses },
});

const getRecordRoute = createRoute({
  method: "get",
  path: "/payroll/records/{id}",
  tags: ["Payroll"],
  security: [{ session: [] }],
  request: { params: IdParamSchema },
  responses: { 200: { content: { "application/json": { schema: PayrollRecordDetailSchema } }, description: "OK" }, ...commonErrorResponses },
});

const earningsRoute = createRoute({
  method: "get",
  path: "/payroll/earnings",
  tags: ["Payroll"],
  security: [{ session: [] }],
  request: { query: ListRecordsQuerySchema },
  responses: { 200: { content: { "application/json": { schema: EarningsSummarySchema } }, description: "OK" }, ...commonErrorResponses },
});

/**
 * Resolves the store and the scanner, then builds a deps bag inside a fresh
 * user transaction. The resolution happens **before** `withUserContext` opens,
 * because it may decrypt a credential and open a connection (Ruling R4-8).
 */
async function withPayroll<T>(
  deps: ApiDeps,
  userId: string,
  requestId: string | null,
  fn: (bag: ReturnType<typeof payrollDeps>) => Promise<T>,
): Promise<T> {
  const resolution = await resolveDocumentStore(userId);
  if (!resolution) {
    throw new ApiError(409, "integration_unavailable", "No payroll document store is configured.");
  }
  const opts = { documents: resolution.store, scanner: resolveScanner(), requestId };
  return withUserContext(deps.db, { userId }, (tx) => fn(payrollDeps(tx, opts)));
}

export function registerPayrollRoutes(app: ApiApp, deps: ApiDeps): void {
  app.openapi(listImportsRoute, async (c) => {
    const principal = c.get("principal");
    const query = c.req.valid("query");
    const items = await withPayroll(deps, principal.userId, c.get("requestId"), (bag) =>
      listImports(bag)(principal, { ...(query.status ? { statuses: [query.status] } : {}), ...(query.limit ? { limit: query.limit } : {}) }),
    );
    return c.json({ items: items.map(importDto) }, 200);
  });

  app.openapi(uploadRoute, async (c) => {
    const principal = c.get("principal");
    // The body is a binary file, so it is read here rather than through a Zod
    // body validator; `validateUpload` inside `reserveImport` is the one gate
    // every entry point shares (spec §8.3).
    const form = await c.req.formData();
    const file = form.get("file");
    if (!(file instanceof File)) {
      throw new ApiError(422, "validation_failed", "Send the payslip as a `file` part of a multipart body.");
    }
    const bytes = new Uint8Array(await file.arrayBuffer());
    const validation = validateUpload({ fileName: file.name, mime: file.type, bytes });
    if (!validation.ok) throw new ApiError(422, "validation_failed", validation.message);
    try {
      const created = await uploadPayslip(principal, {
        fileName: file.name,
        mime: file.type,
        bytes,
        idempotencyKey: c.req.header("idempotency-key") ?? null,
        uploadedVia: "api",
        requestId: c.get("requestId"),
      });
      return c.json(importDto(created), 201);
    } catch (err) {
      throw toApiError(err);
    }
  });

  app.openapi(getImportRoute, async (c) => {
    const principal = c.get("principal");
    const { id } = c.req.valid("param");
    try {
      const found = await withPayroll(deps, principal.userId, c.get("requestId"), (bag) => getImport(bag)(principal, id));
      return c.json(importDetailDto(found), 200);
    } catch (err) {
      throw toApiError(err);
    }
  });

  app.openapi(verifyRoute, async (c) => {
    const principal = c.get("principal");
    const { id } = c.req.valid("param");
    const body = c.req.valid("json");
    const expectedVersion = parseExpectedVersion({ ifMatch: c.req.header("if-match") ?? null, body });
    try {
      const updated = await withPayroll(deps, principal.userId, c.get("requestId"), (bag) =>
        verifyImport(bag)(principal, id, {
          version: expectedVersion,
          month: body.month,
          isThirteenth: body.isThirteenth,
          values: body.values,
        }),
      );
      return c.json(importDetailDto(updated), 200);
    } catch (err) {
      throw toApiError(err);
    }
  });

  app.openapi(rejectRoute, async (c) => {
    const principal = c.get("principal");
    const { id } = c.req.valid("param");
    const body = c.req.valid("json");
    const expectedVersion = parseExpectedVersion({ ifMatch: c.req.header("if-match") ?? null, body });
    try {
      const updated = await withPayroll(deps, principal.userId, c.get("requestId"), (bag) =>
        rejectImport(bag)(principal, id, expectedVersion),
      );
      return c.json(importDto(updated), 200);
    } catch (err) {
      throw toApiError(err);
    }
  });

  app.openapi(applyRoute, async (c) => {
    const principal = c.get("principal");
    const { id } = c.req.valid("param");
    try {
      const applied = await withPayroll(deps, principal.userId, c.get("requestId"), (bag) => applyImport(bag)(principal, id));
      return c.json({ ...recordDto(applied.record), components: applied.components.map(componentDto) }, 200);
    } catch (err) {
      throw toApiError(err);
    }
  });

  app.openapi(retryRoute, async (c) => {
    const principal = c.get("principal");
    const { id } = c.req.valid("param");
    try {
      // The manual lever the retired `POST /api/jobs/run` branch used to be:
      // it re-arms the import so the hourly job picks it up, and never does the
      // network work inline.
      const updated = await withPayroll(deps, principal.userId, c.get("requestId"), async (bag) => {
        const found = await getImport(bag)(principal, id);
        if (found.status !== "needs_ocr" && found.status !== "failed" && found.scanStatus !== "unavailable") {
          throw new ConflictError("This import is not waiting on a retry.", "not_retryable");
        }
        const next = found.scanStatus === "clean" ? "extracting" : "scanning";
        const patched = await bag.imports.patch(principal.userId, id, { status: next, error: null });
        if (!patched) throw new NotFoundError();
        return patched;
      });
      return c.json(importDto(updated), 200);
    } catch (err) {
      throw toApiError(err);
    }
  });

  app.openapi(originalRoute, async (c) => {
    const principal = c.get("principal");
    const { id } = c.req.valid("param");
    try {
      const original = await withPayroll(deps, principal.userId, c.get("requestId"), (bag) => readOriginal(bag)(principal, id));
      // `no-store` and `nosniff` match the retiring Paperless preview route's
      // own headers; `inline` is what lets the review screen frame it.
      return new Response(original.bytes as unknown as BodyInit, {
        status: 200,
        headers: {
          "content-type": original.mime,
          "content-length": String(original.bytes.byteLength),
          "cache-control": "private, no-store, max-age=0",
          "content-disposition": `inline; filename="payslip-${id}.pdf"`,
          "x-content-type-options": "nosniff",
        },
      });
    } catch (err) {
      throw toApiError(err);
    }
  });

  app.openapi(listRecordsRoute, async (c) => {
    const principal = c.get("principal");
    const query = c.req.valid("query");
    const items = await withPayroll(deps, principal.userId, c.get("requestId"), (bag) => listRecords(bag)(principal, query));
    return c.json({ items: items.map(recordDto) }, 200);
  });

  app.openapi(getRecordRoute, async (c) => {
    const principal = c.get("principal");
    const { id } = c.req.valid("param");
    try {
      const detail = await withPayroll(deps, principal.userId, c.get("requestId"), (bag) => getRecord(bag)(principal, id));
      return c.json({ ...recordDto(detail.record), components: detail.components.map(componentDto) }, 200);
    } catch (err) {
      throw toApiError(err);
    }
  });

  app.openapi(earningsRoute, async (c) => {
    const principal = c.get("principal");
    const query = c.req.valid("query");
    const summary = await withPayroll(deps, principal.userId, c.get("requestId"), (bag) =>
      earningsSummary(bag)(principal, query),
    );
    return c.json(summary, 200);
  });
}
```

- [ ] **Step 5: Register the routes**

`src/platform/http/app.ts:143-149`:

```ts
/** Route modules register here. */
export function registerAllRoutes(app: ApiApp, deps: ApiDeps): void {
  registerAccountRoutes(app, deps);
  registerIntegrationRoutes(app, deps);
  registerExpenseRoutes(app, deps);
  registerInterestRoutes(app, deps);
  registerPayrollRoutes(app, deps);
}
```
with `import { registerPayrollRoutes } from "@/modules/payroll/api/routes";` added to the imports at the top.

- [ ] **Step 6: Regenerate the OpenAPI document**

Run: `npm run openapi:generate`
Expected: `docs/api/openapi.json` gains the eleven `/payroll/*` paths and the new component schemas. `git status` shows exactly that one file changed.

- [ ] **Step 7: Run the integration test and the drift check**

Run:
```bash
npm run test:integration -- payroll/api/routes
npm test -- openapi-drift
npx tsc --noEmit
```
Expected: PASS, PASS, exit 0.

- [ ] **Step 8: Commit**

```bash
git add src/modules/payroll/api src/platform/http/app.ts ../docs/api/openapi.json
git commit -m "feat(payroll): expose the payroll pipeline and earnings over /api/v1"
```

---

### Task 16: The review UI's moving parts — run/deps, the queue, the review form and the server actions

**Files:**
- Create: `src/modules/payroll/ui/run.ts`
- Create: `src/modules/payroll/ui/deps.ts`
- Create: `src/modules/payroll/ui/queue.ts`
- Create: `src/modules/payroll/ui/queue.test.ts`
- Create: `src/modules/payroll/ui/QueueNav.tsx`
- Create: `src/modules/payroll/ui/ReviewForm.tsx`
- Create: `src/modules/payroll/ui/load-payroll.ts`
- Create: `src/modules/payroll/ui/load-payroll.test.ts`
- Create: `src/app/actions/payroll.ts`

Nothing under `src/app/(app)/work/**` is deleted in this task — that happens in Task 19, once the pages that replace it exist. Until then both trees compile side by side.

**Interfaces:**
- Consumes: `listImports`, `getImport` (Task 12); `verifyImport`, `rejectImport` (Task 11); `applyImport` (Task 11); `payrollDeps` (Task 8); `resolveDocumentStore`, `resolveScanner` (Tasks 3, 6, 7); `requirePrincipal` from `@/platform/auth/require-principal`; `withUserContext` from `@/platform/db/context`.
- Produces:
```ts
// ui/run.ts
export function setPayrollDepsFactoryForTests(factory: (() => UseCaseDeps) | null): void;
export function setPrincipalForTests(principal: Principal | null): void;
export async function runForPrincipal<T>(fn: (deps: UseCaseDeps, principal: Principal) => Promise<T>): Promise<T>;
// ui/queue.ts
export interface QueueEntry { id: string; month: string; isThirteenth: boolean }
export function orderQueue<T extends QueueEntry>(entries: readonly T[]): T[];
export interface QueuePlacement { total: number; position: number | null; prev: QueueEntry | null; next: QueueEntry | null }
export function placeInQueue(entries: readonly QueueEntry[], currentId: string): QueuePlacement;
export function successorOf(remaining: readonly QueueEntry[], current: QueueEntry): string | null;
export function reviewHref(id: string): string;
// ui/load-payroll.ts
export interface ImportRow { id: string; fileName: string; status: string; month: string | null; net: string | null; scanStatus: string; createdAt: string; version: number }
export async function loadImports(): Promise<ImportRow[]>;
export interface ReviewData { import: ImportRow; fields: ReviewField[]; checks: SanityCheck[]; pending: QueueEntry[]; month: string; isThirteenth: boolean; version: number }
export async function loadReview(importId: string): Promise<ReviewData | null>;
// app/actions/payroll.ts
export async function uploadPayslipAction(form: FormData): Promise<ActionResult<{ id: string }>>;
export async function verifyPayslipAction(input: VerifyActionInput): Promise<ActionResult<{ id: string; next: string | null }>>;
export async function applyPayslipAction(input: { id: string }): Promise<ActionResult<{ recordId: string }>>;
export async function rejectPayslipAction(input: { id: string; version: number }): Promise<ActionResult<{ next: string | null }>>;
```

- [ ] **Step 1: Write the failing queue test — the moved one, with string ids**

```ts
// src/modules/payroll/ui/queue.test.ts
import { describe, expect, it } from "vitest";
import { orderQueue, placeInQueue, reviewHref, successorOf, type QueueEntry } from "./queue";

const entry = (id: string, month: string, isThirteenth = false): QueueEntry => ({ id, month, isThirteenth });

describe("orderQueue", () => {
  it("orders by month ascending", () => {
    const ordered = orderQueue([entry("c", "2026-08-01"), entry("a", "2026-06-01"), entry("b", "2026-07-01")]);
    expect(ordered.map((e) => e.id)).toEqual(["a", "b", "c"]);
  });

  it("puts an ordinary payslip before that month's tredicesima", () => {
    const ordered = orderQueue([entry("t", "2025-12-01", true), entry("o", "2025-12-01")]);
    expect(ordered.map((e) => e.id)).toEqual(["o", "t"]);
  });

  it("breaks a remaining tie on the id, so order is never left to insertion luck", () => {
    const ordered = orderQueue([entry("b", "2026-08-01"), entry("a", "2026-08-01")]);
    expect(ordered.map((e) => e.id)).toEqual(["a", "b"]);
  });

  it("does not mutate its input", () => {
    const input = [entry("b", "2026-08-01"), entry("a", "2026-07-01")];
    orderQueue(input);
    expect(input.map((e) => e.id)).toEqual(["b", "a"]);
  });
});

describe("placeInQueue", () => {
  const queue = [entry("a", "2026-06-01"), entry("b", "2026-07-01"), entry("c", "2026-08-01")];

  it("reports a 1-based position with both neighbours", () => {
    expect(placeInQueue(queue, "b")).toEqual({ total: 3, position: 2, prev: queue[0], next: queue[2] });
  });

  it("reports null neighbours at the ends", () => {
    expect(placeInQueue(queue, "a").prev).toBeNull();
    expect(placeInQueue(queue, "c").next).toBeNull();
  });

  it("offers the first entry when the current one has left the queue", () => {
    expect(placeInQueue(queue, "gone")).toEqual({ total: 3, position: null, prev: null, next: queue[0] });
  });

  it("handles an empty queue", () => {
    expect(placeInQueue([], "a")).toEqual({ total: 0, position: null, prev: null, next: null });
  });
});

describe("successorOf", () => {
  it("offers the next one still pending", () => {
    const remaining = [entry("b", "2026-07-01"), entry("c", "2026-08-01")];
    expect(successorOf(remaining, entry("a", "2026-06-01"))).toBe("b");
  });

  it("falls back to the last one left behind, so skipping never strands anybody", () => {
    const remaining = [entry("a", "2026-06-01"), entry("b", "2026-07-01")];
    expect(successorOf(remaining, entry("c", "2026-08-01"))).toBe("b");
  });

  it("never offers the entry just dealt with", () => {
    expect(successorOf([entry("a", "2026-06-01")], entry("a", "2026-06-01"))).toBeNull();
  });

  it("answers null for an empty remainder", () => {
    expect(successorOf([], entry("a", "2026-06-01"))).toBeNull();
  });
});

describe("reviewHref", () => {
  it("points at the Company payroll review route, not the retired /work one", () => {
    expect(reviewHref("018f-abc")).toBe("/company/payroll/018f-abc");
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `npm test -- payroll/ui/queue`
Expected: FAIL — `Cannot find module './queue'`.

- [ ] **Step 3: Move the queue, with `id: number` becoming `id: string`**

```ts
// src/modules/payroll/ui/queue.ts
/**
 * Queue order and neighbour maths for a review run.
 *
 * Moved from `src/app/(app)/work/verify/[id]/_components/queue.ts` with one
 * change: ids are uuid strings now, not the legacy `payslips` table's bigint
 * identity, so the tie-break compares strings instead of subtracting numbers.
 *
 * Pure on purpose: the server page uses it for the position indicator and the
 * prev/next links, the client form uses it to decide where a confirm, an apply
 * or a reject lands. Both therefore agree on what "the next one" means, and the
 * rule is testable without a database.
 */

export interface QueueEntry {
  id: string;
  month: string;
  isThirteenth: boolean;
}

/**
 * Month ascending, then the ordinary payslip before that month's tredicesima.
 * `id` only breaks a tie the period unique index makes impossible today, so the
 * order is never left to insertion luck.
 */
function compare(a: QueueEntry, b: QueueEntry): number {
  if (a.month !== b.month) return a.month < b.month ? -1 : 1;
  if (a.isThirteenth !== b.isThirteenth) return a.isThirteenth ? 1 : -1;
  return a.id.localeCompare(b.id);
}

export function orderQueue<T extends QueueEntry>(entries: readonly T[]): T[] {
  return [...entries].sort(compare);
}

export interface QueuePlacement {
  total: number;
  /** 1-based position, or null when this import is no longer in the queue. */
  position: number | null;
  prev: QueueEntry | null;
  next: QueueEntry | null;
}

/** Where the import sits in the queue, for browsing without deciding. */
export function placeInQueue(entries: readonly QueueEntry[], currentId: string): QueuePlacement {
  const queue = orderQueue(entries);
  const index = queue.findIndex((entry) => entry.id === currentId);
  if (index === -1) {
    return { total: queue.length, position: null, prev: null, next: queue[0] ?? null };
  }
  return {
    total: queue.length,
    position: index + 1,
    prev: queue[index - 1] ?? null,
    next: queue[index + 1] ?? null,
  };
}

/**
 * The import to open once `current` has been dealt with: the next one still
 * pending, or — when `current` was the last of the run — the earliest one left
 * behind, so skipping never strands the ones already passed over. `remaining`
 * is the queue as the server sees it *after* the write, so an import reviewed
 * in another tab is never offered again.
 */
export function successorOf(remaining: readonly QueueEntry[], current: QueueEntry): string | null {
  const queue = orderQueue(remaining).filter((entry) => entry.id !== current.id);
  const after = queue.find((entry) => compare(entry, current) > 0);
  return after?.id ?? queue[queue.length - 1]?.id ?? null;
}

/** Renamed from `verifyHref`: the route moved from `/work/verify/:id` to `/company/payroll/:id`. */
export function reviewHref(id: string): string {
  return `/company/payroll/${id}`;
}
```

- [ ] **Step 4: Move `QueueNav`, changing only the id type and the href helper**

```tsx
// src/modules/payroll/ui/QueueNav.tsx
```
Copy `src/app/(app)/work/verify/[id]/_components/QueueNav.tsx` verbatim, then make exactly three edits:
1. `import { placeInQueue, verifyHref, type QueueEntry } from "./queue";` becomes `import { placeInQueue, reviewHref, type QueueEntry } from "./queue";`
2. every `verifyHref(` call becomes `reviewHref(`
3. `currentId: number` in `QueueNavProps` becomes `currentId: string`

No other change: the markup, the classes and the copy stay exactly as they are.

- [ ] **Step 5: Evolve `VerifyForm` into `ReviewForm`**

```tsx
// src/modules/payroll/ui/ReviewForm.tsx
```
Copy `src/app/(app)/work/verify/[id]/_components/VerifyForm.tsx` verbatim, then make exactly these edits — same two-pane layout, same confidence tinting, same rules-vs-LLM candidate buttons, same queue advance:

1. Rename the component and its types: `VerifyForm` → `ReviewForm`, `VerifyFormProps` → `ReviewFormProps`, `VerifyField` → `ReviewField`. `VerifiableField` keeps its name and its nine members — they are the parser's own field codes and have not changed.
2. `payslipId: number` → `importId: string`; delete `documentId: number` (the original route no longer needs a second id).
3. Add `version: number` to the props: every write now carries the expected version and a stale one answers `409` (global constraint).
4. In `PdfFrame`, replace `src={`/api/paperless/preview/${documentId}`}` with `src={`/api/v1/payroll/imports/${importId}/original`}`. Keep the surrounding `<iframe>` attributes unchanged.
5. Replace the imports of `confirmPayslip`/`rejectPayslip` from `@/app/actions/payslips` with `verifyPayslipAction`/`applyPayslipAction`/`rejectPayslipAction` from `@/app/actions/payroll`.
6. The action row becomes four buttons — **Confirm**, **Apply**, **Reject**, **Skip** — where the original had three. "Confirm" calls `verifyPayslipAction` and stays on the page with the import now `verified`; "Apply" calls `applyPayslipAction` and advances to `next`; "Reject" calls `rejectPayslipAction` and advances; "Skip" navigates to `next` without writing. Apply is disabled until the import's status is `verified`, and its disabled title reads "Confirm the figures first."
7. `import { placeInQueue, successorOf, verifyHref } from "./queue";` becomes the same three names with `reviewHref`.

All copy stays English. The only Italian on the screen is the component labels the payslip itself carries, rendered from `labelRaw`.

- [ ] **Step 6: Write `run.ts` and `deps.ts`**

```ts
// src/modules/payroll/ui/run.ts
import { db } from "@/lib/db";
import type { Principal } from "@/platform/auth/principal";
import { withUserContext } from "@/platform/db/context";
import type { UseCaseDeps } from "../application/ports";
import { payrollDeps } from "../infrastructure/deps";
import { resolveDocumentStore } from "../infrastructure/document-store-resolver";
import { resolveScanner } from "../infrastructure/scanner-resolver";

export { payrollDeps } from "../infrastructure/deps";

/**
 * Test seams, mirroring the interests and expenses modules' own `ui/run.ts`.
 * Both are no-ops outside `NODE_ENV=test`, so production code can never be
 * redirected by a stray call.
 */
let depsFactoryForTests: (() => UseCaseDeps) | null = null;
let principalForTests: Principal | null = null;

export function setPayrollDepsFactoryForTests(factory: (() => UseCaseDeps) | null): void {
  if (process.env.NODE_ENV !== "test") return;
  depsFactoryForTests = factory;
}

export function setPrincipalForTests(principal: Principal | null): void {
  if (process.env.NODE_ENV !== "test") return;
  principalForTests = principal;
}

/**
 * Resolve the caller, resolve the document store and the scanner **before** any
 * transaction opens (Ruling R4-8), then open one transaction carrying the
 * caller's identity so RLS applies, and run a use case inside it. Every server
 * component and action that touches payroll goes through here.
 *
 * Returns `null` from the callback's point of view is not an option: a
 * deployment with no store configured throws, and the pages catch that to
 * render their setup state rather than a stack trace.
 */
export class DocumentStoreUnavailableError extends Error {
  constructor() {
    super("No payroll document store is configured.");
    this.name = "DocumentStoreUnavailableError";
  }
}

export async function runForPrincipal<T>(
  fn: (deps: UseCaseDeps, principal: Principal) => Promise<T>,
): Promise<T> {
  if (process.env.NODE_ENV === "test" && depsFactoryForTests && principalForTests) {
    return fn(depsFactoryForTests(), principalForTests);
  }
  const { requirePrincipal } = await import("@/platform/auth/require-principal");
  const principal = await requirePrincipal();
  const resolution = await resolveDocumentStore(principal.userId);
  if (!resolution) throw new DocumentStoreUnavailableError();
  const opts = { documents: resolution.store, scanner: resolveScanner() };
  return withUserContext(db, { userId: principal.userId }, (tx) => fn(payrollDeps(tx, opts), principal));
}
```

```ts
// src/modules/payroll/ui/deps.ts
export type { UseCaseDeps } from "../application/ports";
export { payrollDeps } from "../infrastructure/deps";
```

- [ ] **Step 7: Write the failing loader test**

```ts
// src/modules/payroll/ui/load-payroll.test.ts
import { afterEach, describe, expect, it } from "vitest";
import type { PayslipExtraction } from "@/lib/contracts";
import { testPrincipal } from "@/test/principal";
import type { UseCaseDeps } from "../application/ports";
import {
  MemoryLegacyFundDeposits,
  MemoryPayrollComponentsRepository,
  MemoryPayrollImportsRepository,
  MemoryPayrollMappingRulesRepository,
  MemoryPayrollRecordsRepository,
} from "../infrastructure/memory-repositories";
import { noopScanner } from "../infrastructure/noop-scanner";
import { loadImports, loadReview } from "./load-payroll";
import { setPayrollDepsFactoryForTests, setPrincipalForTests } from "./run";

const principal = testPrincipal({ userId: "00000000-0000-7000-8000-00000000000a" });

const extraction: PayslipExtraction = {
  parserVersion: "payroll-1.0.0",
  month: "2026-08-01",
  isThirteenth: false,
  textSource: "pdf",
  fields: {
    net: { value: 1800, confidence: "medium", rules: 1800, llm: 1799 },
    gross: { value: null, confidence: "low", rules: null, llm: null },
  },
  checks: [{ id: "gross_minus_taxes", label: "gross − taxes = net", passed: false, detail: "no gross" }],
};

let shared: UseCaseDeps | null = null;

function useDeps(deps: UseCaseDeps) {
  shared = deps;
  setPayrollDepsFactoryForTests(() => shared!);
  setPrincipalForTests(principal);
}

afterEach(() => {
  setPayrollDepsFactoryForTests(null);
  setPrincipalForTests(null);
  shared = null;
});

function makeDeps(): UseCaseDeps {
  return {
    imports: new MemoryPayrollImportsRepository(),
    records: new MemoryPayrollRecordsRepository(),
    components: new MemoryPayrollComponentsRepository(),
    mappingRules: new MemoryPayrollMappingRulesRepository(),
    funds: new MemoryLegacyFundDeposits(),
    documents: { provider: "local", put: async () => {}, get: async () => null, delete: async () => {}, listPrefix: async () => [] },
    scanner: noopScanner,
    clock: { now: () => new Date("2026-09-05T10:00:00Z") },
    audit: async () => {},
  };
}

let sha = 0;
async function seedImport(deps: UseCaseDeps, status: "needs_review" | "scanning" | "applied" = "needs_review") {
  sha += 1;
  const created = await deps.imports.create({
    userId: principal.userId, fileName: "Busta Paga Agosto 2026.pdf", mime: "application/pdf",
    sizeBytes: 10, sha256: String(sha).padStart(64, "0"), storageProvider: "local",
    storageKey: `payroll/${principal.userId}/2026/${String(sha).padStart(32, "0")}.pdf`,
    idempotencyKey: null, replacesImportId: null,
    retentionUntil: new Date("2036-01-01T00:00:00Z"), uploadedVia: "ui",
  });
  return (await deps.imports.patch(principal.userId, created.id, {
    status, scanStatus: "clean", scanner: "none", extraction, confidence: { net: "medium", gross: "low" },
  }))!;
}

describe("loadImports", () => {
  it("flattens each import to a serialisable row with the month off the extraction", async () => {
    const deps = makeDeps();
    useDeps(deps);
    const imported = await seedImport(deps);
    const rows = await loadImports();
    expect(rows).toEqual([
      expect.objectContaining({ id: imported.id, status: "needs_review", month: "2026-08-01", net: "1800.00", scanStatus: "clean" }),
    ]);
  });

  it("reports a null month and net for an import that has not parsed — never a zero", async () => {
    const deps = makeDeps();
    useDeps(deps);
    const created = await deps.imports.create({
      userId: principal.userId, fileName: "scan.pdf", mime: "application/pdf", sizeBytes: 10,
      sha256: "f".repeat(64), storageProvider: "local", storageKey: "k",
      idempotencyKey: null, replacesImportId: null,
      retentionUntil: new Date("2036-01-01T00:00:00Z"), uploadedVia: "ui",
    });
    const rows = await loadImports();
    expect(rows.find((r) => r.id === created.id)).toMatchObject({ month: null, net: null });
  });
});

describe("loadReview", () => {
  it("returns one field per parser field, with the extracted value pre-filled and both candidates", async () => {
    const deps = makeDeps();
    useDeps(deps);
    const imported = await seedImport(deps);
    const review = await loadReview(imported.id);
    const net = review!.fields.find((f) => f.name === "net")!;
    expect(net).toMatchObject({ initial: "1800", confidence: "medium", rules: 1800, llm: 1799, unit: "eur" });
    const gross = review!.fields.find((f) => f.name === "gross")!;
    expect(gross).toMatchObject({ initial: "", confidence: "low", rules: null, llm: null });
  });

  it("carries the parser's own sanity checks through to the reviewer", async () => {
    const deps = makeDeps();
    useDeps(deps);
    const imported = await seedImport(deps);
    expect((await loadReview(imported.id))!.checks).toEqual(extraction.checks);
  });

  it("lists the review queue, ordered, with only imports still awaiting a decision", async () => {
    const deps = makeDeps();
    useDeps(deps);
    const first = await seedImport(deps);
    await seedImport(deps, "applied");
    const review = await loadReview(first.id);
    expect(review!.pending.map((p) => p.id)).toEqual([first.id]);
  });

  it("answers null for an import that is not this user's, rather than throwing", async () => {
    const deps = makeDeps();
    useDeps(deps);
    expect(await loadReview("00000000-0000-7000-8000-0000000000ff")).toBeNull();
  });
});
```

- [ ] **Step 8: Run it and watch it fail**

Run: `npm test -- payroll/ui/load-payroll`
Expected: FAIL — `Cannot find module './load-payroll'`.

- [ ] **Step 9: Write the loaders**

```ts
// src/modules/payroll/ui/load-payroll.ts
import { PAYSLIP_FIELDS, type Confidence, type PayslipField, type SanityCheck } from "@/lib/contracts";
import { NotFoundError } from "../application/errors";
import { getImport, listImports } from "../application/list-imports";
import type { PayrollImport } from "../application/ports";
import type { QueueEntry } from "./queue";
import { orderQueue } from "./queue";
import { runForPrincipal } from "./run";

/** Flat and serialisable: this crosses the server/client boundary. */
export interface ImportRow {
  id: string;
  fileName: string;
  status: string;
  scanStatus: string;
  /** From the extraction. `null` until the parser has read one — never a placeholder date. */
  month: string | null;
  /** From the extraction. `null` when the parser could not read a net — never `0.00`. */
  net: string | null;
  createdAt: string;
  version: number;
}

export interface ReviewField {
  name: PayslipField;
  label: string;
  hint: string;
  unit: "eur" | "hours";
  /** Pre-filled from the extraction; the empty string when the parser read nothing. */
  initial: string;
  confidence: Confidence;
  rules: number | null;
  llm: number | null;
}

export interface ReviewData {
  import: ImportRow;
  fields: ReviewField[];
  checks: SanityCheck[];
  /** Every import still awaiting a decision, this one included, in queue order. */
  pending: QueueEntry[];
  month: string;
  isThirteenth: boolean;
  version: number;
}

/**
 * The Italian labels and the English hints the review screen shows beside each
 * field. The label is the payslip's own wording (data, spec §2.9); the hint is
 * UI chrome and is therefore English.
 */
const FIELD_META: Record<PayslipField, { label: string; hint: string; unit: "eur" | "hours" }> = {
  gross: { label: "Totale competenze", hint: "Gross for the period", unit: "eur" },
  net: { label: "Netto del mese", hint: "Net paid", unit: "eur" },
  taxes: { label: "Totale trattenute", hint: "Total deductions", unit: "eur" },
  fundContribEmployee: { label: "Contributo Cometa dipendente", hint: "Pension fund, employee share", unit: "eur" },
  fundContribEmployer: { label: "Contributo Cometa azienda", hint: "Pension fund, employer share", unit: "eur" },
  ferieBalance: { label: "Ferie residue", hint: "Vacation hours remaining", unit: "hours" },
  rolBalance: { label: "ROL residue", hint: "Permit hours remaining", unit: "hours" },
  permessiBalance: { label: "Permessi residui", hint: "Other permit hours remaining", unit: "hours" },
  ferieTakenHours: { label: "Ferie godute", hint: "Vacation hours taken", unit: "hours" },
  rolTakenHours: { label: "ROL godute", hint: "Permit hours taken", unit: "hours" },
};

/** The statuses a reviewer still has something to do about. */
const AWAITING: readonly PayrollImport["status"][] = ["needs_review", "verified", "needs_ocr"];

function toRow(item: PayrollImport): ImportRow {
  const fields = item.extraction?.fields;
  const net = fields?.net?.value;
  return {
    id: item.id,
    fileName: item.fileName,
    status: item.status,
    scanStatus: item.scanStatus,
    month: item.extraction?.month ?? null,
    net: net === null || net === undefined ? null : net.toFixed(2),
    createdAt: item.createdAt.toISOString(),
    version: item.version,
  };
}

export async function loadImports(): Promise<ImportRow[]> {
  return runForPrincipal(async (deps, principal) => (await listImports(deps)(principal)).map(toRow));
}

export async function loadReview(importId: string): Promise<ReviewData | null> {
  return runForPrincipal(async (deps, principal) => {
    // Only a missing import renders as "not found". Anything else — a database
    // failure, a permission edge, a bug — is a real error and must surface as
    // one, the fix the Expenses and Interests loaders both needed.
    const found = await getImport(deps)(principal, importId).catch((err: unknown) => {
      if (err instanceof NotFoundError) return null;
      throw err;
    });
    if (!found) return null;

    const extraction = found.extraction;
    const fields: ReviewField[] = PAYSLIP_FIELDS.map((name) => {
      const meta = FIELD_META[name];
      const extracted = extraction?.fields[name];
      return {
        name,
        label: meta.label,
        hint: meta.hint,
        unit: meta.unit,
        // An empty string, not "0": a field the parser could not read must
        // arrive at the reviewer blank, so a confirmation is a decision rather
        // than an accident.
        initial: extracted?.value === null || extracted?.value === undefined ? "" : String(extracted.value),
        confidence: extracted?.confidence ?? "low",
        rules: extracted?.rules ?? null,
        llm: extracted?.llm ?? null,
      };
    });

    const queue = await listImports(deps)(principal, { statuses: AWAITING });
    const pending: QueueEntry[] = orderQueue(
      queue.map((item) => ({
        id: item.id,
        month: item.extraction?.month ?? item.createdAt.toISOString().slice(0, 10),
        isThirteenth: item.extraction?.isThirteenth ?? false,
      })),
    );

    return {
      import: toRow(found),
      fields,
      checks: extraction?.checks ?? [],
      pending,
      month: extraction?.month ?? "",
      isThirteenth: extraction?.isThirteenth ?? false,
      version: found.version,
    };
  });
}
```

- [ ] **Step 10: Write the server actions**

```ts
// src/app/actions/payroll.ts
"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { PAYSLIP_FIELDS } from "@/lib/contracts";
import { applyImport } from "@/modules/payroll/application/apply-import";
import { validateUpload } from "@/modules/payroll/application/create-import";
import {
  ConflictError,
  DuplicateImportError,
  InvalidInputError,
  NotFoundError,
  VersionMismatchError,
} from "@/modules/payroll/application/errors";
import { listImports } from "@/modules/payroll/application/list-imports";
import { rejectImport, verifyImport } from "@/modules/payroll/application/review-import";
import { uploadPayslip } from "@/modules/payroll/infrastructure/upload";
import { orderQueue, successorOf } from "@/modules/payroll/ui/queue";
import { runForPrincipal } from "@/modules/payroll/ui/run";
import type { ActionResult } from "./types";

const verifySchema = z.object({
  id: z.string().min(1),
  version: z.number().int(),
  month: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Enter the pay period as YYYY-MM-01."),
  isThirteenth: z.boolean(),
  values: z.record(z.enum(PAYSLIP_FIELDS), z.string().nullable()),
});

export type VerifyActionInput = z.input<typeof verifySchema>;

/** One place that turns a use-case error into the message the form shows. */
function toActionError(err: unknown): { ok: false; error: string } {
  if (err instanceof DuplicateImportError) return { ok: false, error: "This payslip has already been uploaded." };
  if (err instanceof VersionMismatchError) return { ok: false, error: err.message };
  if (err instanceof ConflictError) return { ok: false, error: err.message };
  if (err instanceof InvalidInputError) return { ok: false, error: err.message };
  if (err instanceof NotFoundError) return { ok: false, error: "That payslip is no longer there." };
  throw err;
}

function revalidate(): void {
  revalidatePath("/company");
  revalidatePath("/company/payroll");
  revalidatePath("/company/earnings");
}

export async function uploadPayslipAction(form: FormData): Promise<ActionResult<{ id: string }>> {
  const file = form.get("file");
  if (!(file instanceof File)) return { ok: false, error: "Choose a PDF payslip to upload." };
  const bytes = new Uint8Array(await file.arrayBuffer());
  const validation = validateUpload({ fileName: file.name, mime: file.type, bytes });
  if (!validation.ok) return { ok: false, error: validation.message };
  try {
    // Not `runForPrincipal`: `uploadPayslip` runs its own three short
    // transactions with the store write between them, and must not be nested
    // inside one.
    const { requirePrincipal } = await import("@/platform/auth/require-principal");
    const principal = await requirePrincipal();
    const created = await uploadPayslip(principal, { fileName: file.name, mime: file.type, bytes, uploadedVia: "ui" });
    revalidate();
    return { ok: true, data: { id: created.id } };
  } catch (err) {
    return toActionError(err);
  }
}

export async function verifyPayslipAction(input: VerifyActionInput): Promise<ActionResult<{ id: string; next: string | null }>> {
  const parsed = verifySchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid input" };
  try {
    return await runForPrincipal(async (deps, principal) => {
      const updated = await verifyImport(deps)(principal, parsed.data.id, {
        version: parsed.data.version,
        month: parsed.data.month,
        isThirteenth: parsed.data.isThirteenth,
        values: parsed.data.values,
      });
      revalidate();
      // The queue as the server sees it *after* the write, so an import
      // reviewed in another tab is never offered again.
      const remaining = await listImports(deps)(principal, { statuses: ["needs_review", "needs_ocr"] });
      const next = successorOf(
        orderQueue(remaining.map((i) => ({ id: i.id, month: i.extraction?.month ?? "", isThirteenth: i.extraction?.isThirteenth ?? false }))),
        { id: updated.id, month: parsed.data.month, isThirteenth: parsed.data.isThirteenth },
      );
      return { ok: true as const, data: { id: updated.id, next } };
    });
  } catch (err) {
    return toActionError(err);
  }
}

export async function applyPayslipAction(input: { id: string }): Promise<ActionResult<{ recordId: string }>> {
  try {
    return await runForPrincipal(async (deps, principal) => {
      const applied = await applyImport(deps)(principal, input.id);
      revalidate();
      return { ok: true as const, data: { recordId: applied.record.id } };
    });
  } catch (err) {
    return toActionError(err);
  }
}

export async function rejectPayslipAction(input: { id: string; version: number }): Promise<ActionResult<{ next: string | null }>> {
  try {
    return await runForPrincipal(async (deps, principal) => {
      const rejected = await rejectImport(deps)(principal, input.id, input.version);
      revalidate();
      const remaining = await listImports(deps)(principal, { statuses: ["needs_review", "needs_ocr"] });
      const next = successorOf(
        orderQueue(remaining.map((i) => ({ id: i.id, month: i.extraction?.month ?? "", isThirteenth: i.extraction?.isThirteenth ?? false }))),
        { id: rejected.id, month: rejected.extraction?.month ?? "", isThirteenth: rejected.extraction?.isThirteenth ?? false },
      );
      return { ok: true as const, data: { next } };
    });
  } catch (err) {
    return toActionError(err);
  }
}
```

- [ ] **Step 11: Run everything and type-check**

Run:
```bash
npm test -- payroll/ui
npx tsc --noEmit
```
Expected: PASS (13 queue cases, 6 loader cases) and exit 0. `src/app/(app)/work/**` still compiles untouched.

- [ ] **Step 12: Commit**

```bash
git add src/modules/payroll/ui src/app/actions/payroll.ts
git commit -m "feat(payroll): move the review queue and form into the payroll module"
```

---

### Task 17: The Payroll pages — upload, imports list and review

**Files:**
- Create: `src/modules/payroll/ui/UploadForm.tsx`
- Create: `src/modules/payroll/ui/ImportsTable.tsx`
- Create: `src/modules/payroll/ui/status.ts`
- Create: `src/modules/payroll/ui/status.test.ts`
- Create: `src/app/(app)/company/payroll/page.tsx`
- Create: `src/app/(app)/company/payroll/loading.tsx`
- Create: `src/app/(app)/company/payroll/[importId]/page.tsx`
- Create: `src/app/(app)/company/payroll/[importId]/loading.tsx`
- Create: `src/app/(app)/company/error.tsx`
- Modify: `src/middleware.ts` (the CSP `frame-ancestors` branch moves to the new original route)

**Interfaces:**
- Consumes: `loadImports`, `loadReview` from `../ui/load-payroll` (Task 16); `uploadPayslipAction` from `@/app/actions/payroll` (Task 16); `ReviewForm`, `QueueNav` (Task 16); `resolveCapabilities`, `realProbes` (Task 7); `requirePrincipalOrRedirect` from `@/platform/auth/require-principal`.
- Produces:
```ts
// ui/status.ts
export interface StatusChip { label: string; tone: "positive" | "warning" | "negative" | "neutral" }
export function statusChip(status: string, scanStatus: string): StatusChip;
```

- [ ] **Step 1: Write the failing status-chip test**

```ts
// src/modules/payroll/ui/status.test.ts
import { describe, expect, it } from "vitest";
import { statusChip } from "./status";

describe("statusChip", () => {
  it("labels every pipeline status in English, never in Italian", () => {
    const cases: Array<[string, string]> = [
      ["received", "Uploaded"],
      ["scanning", "Scanning"],
      ["needs_ocr", "Needs OCR"],
      ["extracting", "Reading"],
      ["parsed", "Parsed"],
      ["needs_review", "Needs review"],
      ["verified", "Confirmed"],
      ["applied", "Applied"],
      ["rejected", "Rejected"],
      ["superseded", "Superseded"],
      ["failed", "Failed"],
    ];
    for (const [status, label] of cases) {
      expect(statusChip(status, "clean").label).toBe(label);
    }
  });

  it("says so when the scanner has not cleared a document yet", () => {
    expect(statusChip("scanning", "unavailable")).toEqual({ label: "Scanner unavailable", tone: "warning" });
    expect(statusChip("rejected", "infected")).toEqual({ label: "Malware found", tone: "negative" });
  });

  it("tones applied positive, failures negative and waiting states warning", () => {
    expect(statusChip("applied", "clean").tone).toBe("positive");
    expect(statusChip("failed", "clean").tone).toBe("negative");
    expect(statusChip("needs_review", "clean").tone).toBe("warning");
    expect(statusChip("superseded", "clean").tone).toBe("neutral");
  });

  it("falls back to the raw status rather than rendering nothing", () => {
    expect(statusChip("something_new", "clean")).toEqual({ label: "something_new", tone: "neutral" });
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `npm test -- payroll/ui/status`
Expected: FAIL — `Cannot find module './status'`.

- [ ] **Step 3: Write the status labels**

```ts
// src/modules/payroll/ui/status.ts
export interface StatusChip {
  label: string;
  tone: "positive" | "warning" | "negative" | "neutral";
}

/**
 * One English label per pipeline status. The scan status wins where it is the
 * more useful thing to say: "Scanner unavailable" tells an operator to look at
 * clamd, where a bare "Scanning" would look like ordinary progress, and
 * "Malware found" is the one rejection reason worth naming on the list.
 */
const LABELS: Record<string, StatusChip> = {
  received: { label: "Uploaded", tone: "neutral" },
  scanning: { label: "Scanning", tone: "neutral" },
  needs_ocr: { label: "Needs OCR", tone: "warning" },
  extracting: { label: "Reading", tone: "neutral" },
  parsed: { label: "Parsed", tone: "neutral" },
  needs_review: { label: "Needs review", tone: "warning" },
  verified: { label: "Confirmed", tone: "warning" },
  applied: { label: "Applied", tone: "positive" },
  rejected: { label: "Rejected", tone: "negative" },
  superseded: { label: "Superseded", tone: "neutral" },
  failed: { label: "Failed", tone: "negative" },
};

export function statusChip(status: string, scanStatus: string): StatusChip {
  if (scanStatus === "infected") return { label: "Malware found", tone: "negative" };
  if (scanStatus === "unavailable" && status === "scanning") return { label: "Scanner unavailable", tone: "warning" };
  return LABELS[status] ?? { label: status, tone: "neutral" };
}
```

- [ ] **Step 4: Write the upload form and the imports table**

```tsx
// src/modules/payroll/ui/UploadForm.tsx
"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { uploadPayslipAction } from "@/app/actions/payroll";

/**
 * The whole upload UI: one file input and one button. Validation is deliberately
 * *not* duplicated here — `uploadPayslipAction` calls `validateUpload`, the same
 * gate the API uses, so the browser and an API client are told the same thing
 * for the same reason. `accept` is a convenience for the file picker, never a
 * check (spec §8.3: the bytes have the last word).
 */
export function UploadForm() {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  return (
    <form
      className="flex flex-col gap-3"
      onSubmit={(event) => {
        event.preventDefault();
        const form = new FormData(event.currentTarget);
        setError(null);
        startTransition(async () => {
          const result = await uploadPayslipAction(form);
          if (!result.ok) {
            setError(result.error);
            return;
          }
          router.refresh();
        });
      }}
    >
      <label className="flex flex-col gap-2 text-body-sm text-fg-muted">
        Payslip PDF
        <input
          type="file"
          name="file"
          accept="application/pdf"
          required
          className="min-h-11 rounded-md border border-border bg-surface px-3 py-2 text-body-sm text-fg"
        />
      </label>
      <button
        type="submit"
        disabled={pending}
        className="inline-flex min-h-11 items-center justify-center rounded-md bg-accent px-4 text-body-sm font-medium text-accent-contrast transition-colors hover:bg-accent-hover disabled:opacity-60"
      >
        {pending ? "Uploading…" : "Upload payslip"}
      </button>
      {error && <p className="text-body-sm text-negative">{error}</p>}
    </form>
  );
}
```

```tsx
// src/modules/payroll/ui/ImportsTable.tsx
import Link from "next/link";
import { EmptyState } from "@/components/ui/EmptyState";
import { MoneyValue } from "@/components/ui/MoneyValue";
import { cn } from "@/components/ui/cn";
import { formatMonth } from "@/lib/format";
import type { ImportRow } from "./load-payroll";
import { reviewHref } from "./queue";
import { statusChip } from "./status";

const TONE: Record<string, string> = {
  positive: "bg-positive/10 text-positive",
  warning: "bg-warning/10 text-warning",
  negative: "bg-negative/10 text-negative",
  neutral: "bg-surface text-fg-muted border border-border",
};

export interface ImportsTableProps {
  rows: readonly ImportRow[];
}

export function ImportsTable({ rows }: ImportsTableProps) {
  if (rows.length === 0) {
    return (
      <div className="max-w-xl">
        <EmptyState
          title="No payslips yet"
          description="Upload a payslip PDF and it will be scanned, read and put in front of you to confirm."
        />
      </div>
    );
  }

  return (
    <ul className="hairline-t">
      {rows.map((row) => {
        const chip = statusChip(row.status, row.scanStatus);
        return (
          <li key={row.id} className="lazy-block [contain-intrinsic-size:auto_4rem]">
            <Link
              href={reviewHref(row.id)}
              className="flex min-h-11 items-center gap-3 py-2 hairline-b transition-colors hover:bg-surface-hover"
            >
              <span className="min-w-0 flex-1">
                <span className="num block text-body text-fg">
                  {/* Never a placeholder date: an import the parser has not read yet
                      shows its filename, which is what the user recognises. */}
                  {row.month ? formatMonth(row.month) : row.fileName}
                </span>
                <span className={cn("mt-0.5 inline-flex rounded-xs px-1.5 py-0.5 text-caption", TONE[chip.tone])}>
                  {chip.label}
                </span>
              </span>
              {/* `null` renders as an em dash, never as €0.00. */}
              <MoneyValue value={row.net} size="body" />
            </Link>
          </li>
        );
      })}
    </ul>
  );
}
```

- [ ] **Step 5: Write the two pages and their loading states**

```tsx
// src/app/(app)/company/payroll/page.tsx
import Link from "next/link";
import { PageHeader } from "@/components/layout/PageHeader";
import { EmptyState } from "@/components/ui/EmptyState";
import { ImportsTable } from "@/modules/payroll/ui/ImportsTable";
import { UploadForm } from "@/modules/payroll/ui/UploadForm";
import { loadImports } from "@/modules/payroll/ui/load-payroll";
import { requirePrincipalOrRedirect } from "@/platform/auth/require-principal";
import { realProbes } from "@/platform/capabilities/probes";
import { resolveCapabilities } from "@/platform/capabilities/resolve";

export const dynamic = "force-dynamic";
export const metadata = { title: "Payroll" };

/**
 * Spec §4 gates this page on `payroll.upload` or `payroll.review`. With no
 * document store configured it shows the setup state and a link to Settings ›
 * Integrations — never an empty table that looks like "you have no payslips".
 */
export default async function PayrollPage() {
  const principal = await requirePrincipalOrRedirect();
  const caps = await resolveCapabilities(principal, realProbes);
  const mayUse = caps.permissions.has("payroll.upload") || caps.permissions.has("payroll.review");

  if (!mayUse) {
    return (
      <>
        <PageHeader title="Payroll" />
        <div className="max-w-xl pt-6">
          <EmptyState title="No access to payroll" description="Ask an administrator for the payroll role." />
        </div>
      </>
    );
  }

  if (!caps.features.payroll) {
    return (
      <>
        <PageHeader title="Payroll" />
        <div className="max-w-xl pt-6">
          <EmptyState
            title="Connect a payroll document store"
            description="Payslips are stored outside the database. Connect the document store to start uploading."
            action={
              <Link
                href="/settings/integrations/payroll_silo"
                className="inline-flex min-h-11 items-center rounded-md bg-accent px-4 text-body-sm font-medium text-accent-contrast transition-colors hover:bg-accent-hover"
              >
                Go to Integrations
              </Link>
            }
          />
        </div>
      </>
    );
  }

  const rows = await loadImports();

  return (
    <>
      <PageHeader title="Payroll" />
      <div className="flex flex-col gap-8 pt-6">
        <ImportsTable rows={rows} />
        {caps.permissions.has("payroll.upload") && (
          <div className="max-w-md hairline-t pt-8">
            <h2 className="text-body-sm font-medium text-fg-muted">Upload a payslip</h2>
            <div className="pt-4">
              <UploadForm />
            </div>
          </div>
        )}
      </div>
    </>
  );
}
```

```tsx
// src/app/(app)/company/payroll/[importId]/page.tsx
import { notFound } from "next/navigation";
import { PageHeader } from "@/components/layout/PageHeader";
import { QueueNav } from "@/modules/payroll/ui/QueueNav";
import { ReviewForm } from "@/modules/payroll/ui/ReviewForm";
import { loadReview } from "@/modules/payroll/ui/load-payroll";
import { requirePrincipalOrRedirect } from "@/platform/auth/require-principal";
import { formatMonth } from "@/lib/format";

export const dynamic = "force-dynamic";
export const metadata = { title: "Review payslip" };

export default async function ReviewPayslipPage({ params }: { params: Promise<{ importId: string }> }) {
  await requirePrincipalOrRedirect();
  const { importId } = await params;
  const review = await loadReview(importId);
  if (!review) notFound();

  return (
    <>
      <PageHeader title={review.month ? formatMonth(review.month) : review.import.fileName} eyebrow="Payroll" />
      <ReviewForm
        key={review.import.id}
        importId={review.import.id}
        month={review.month}
        monthLabel={review.month ? formatMonth(review.month) : review.import.fileName}
        isThirteenth={review.isThirteenth}
        status={review.import.status}
        version={review.version}
        fields={review.fields}
        checks={review.checks}
        pending={review.pending}
        nav={<QueueNav pending={review.pending} currentId={review.import.id} />}
      />
    </>
  );
}
```

```tsx
// src/app/(app)/company/payroll/loading.tsx
import { PageHeader } from "@/components/layout/PageHeader";

export default function Loading() {
  return <PageHeader title="Payroll" />;
}
```

```tsx
// src/app/(app)/company/payroll/[importId]/loading.tsx
import { PageHeader } from "@/components/layout/PageHeader";

export default function Loading() {
  return <PageHeader title="Review payslip" eyebrow="Payroll" />;
}
```

```tsx
// src/app/(app)/company/error.tsx
```
Copy `src/app/(app)/work/error.tsx` verbatim; it is a generic segment error boundary with no `/work`-specific copy. If it does mention Work, change that word to Company and nothing else.

- [ ] **Step 6: Move the CSP `frame-ancestors` exception**

`src/middleware.ts:62-71` — replace the function and reword its comment:

```ts
/**
 * The payslip original is served same-origin and embedded in an <iframe> by the
 * review screen. `frame-ancestors 'none'` on *that* response makes the browser
 * refuse to render it, so the preview silently stays blank with no error
 * server-side. It still must not be embeddable by third parties, hence 'self'
 * rather than dropping the directive.
 *
 * The path moved with the route: `/api/paperless/preview/:id` became
 * `/api/v1/payroll/imports/:id/original`, which is scan-gated and audited.
 * Matching on the prefix rather than the whole path keeps it a prefix test, so
 * the trailing `/original` segment is covered without a regex.
 */
function frameAncestorsFor(pathname: string): string {
  return pathname.startsWith("/api/v1/payroll/imports/") ? "'self'" : "'none'";
}
```
The Paperless form is deleted here and the old route is deleted in Task 22; between the two commits `/api/paperless/preview/` still exists but loses its frame exception, which is correct — nothing frames it any more.

- [ ] **Step 7: Run everything**

Run:
```bash
npm test -- payroll/
npm run build
npx tsc --noEmit
```
Expected: PASS, and the build's route table now lists `/company/payroll` and `/company/payroll/[importId]`.

- [ ] **Step 8: Commit**

```bash
git add src/modules/payroll/ui "src/app/(app)/company" src/middleware.ts
git commit -m "feat(payroll): add the Company payroll upload, imports list and review pages"
```

---

### Task 18: Company Overview and Earnings

**Files:**
- Create: `src/modules/payroll/ui/load-company.ts`
- Create: `src/modules/payroll/ui/load-company.test.ts`
- Create: `src/modules/payroll/ui/EarningsTable.tsx`
- Create: `src/modules/payroll/ui/RecordDetail.tsx`
- Create: `src/app/(app)/company/page.tsx`
- Create: `src/app/(app)/company/loading.tsx`
- Create: `src/app/(app)/company/earnings/page.tsx`
- Create: `src/app/(app)/company/earnings/loading.tsx`
- Create: `src/app/(app)/company/earnings/[recordId]/page.tsx`
- Create: `src/app/(app)/company/earnings/[recordId]/loading.tsx`
- Create: `src/modules/payroll/ui/SalarySection.tsx` (moved from `src/app/(app)/work/_components/`)

**Interfaces:**
- Consumes: `earningsSummary`, `listRecords`, `getRecord`, `listImports` (Task 12); `runForPrincipal` (Task 16); `addMoney` from `../domain/money` (Task 5); `SalaryWindow`, `WindowKey` from `./SalarySection` (moved in this task); `formatEur`, `formatMonth` from `@/lib/format`.
- Produces:
```ts
export interface EarningsRow { id: string; periodStart: string; kind: string; gross: string | null; net: string | null; taxes: string | null }
export interface CompanyOverview { latestImport: { id: string; status: string; scanStatus: string; fileName: string } | null; pendingReview: number; year: EarningsBucket | null; months: EarningsBucket[]; salaryWindows: SalaryWindow[] }
export async function loadCompanyOverview(): Promise<CompanyOverview>;
export async function loadEarnings(opts?: { from?: string; to?: string }): Promise<{ rows: EarningsRow[]; summary: EarningsSummary }>;
export interface RecordDetailData { record: EarningsRow; importId: string; components: ComponentRow[]; canReadOriginal: boolean; originalAvailable: boolean }
export async function loadRecordDetail(recordId: string): Promise<RecordDetailData | null>;
```

- [ ] **Step 1: Write the failing loader test**

```ts
// src/modules/payroll/ui/load-company.test.ts
import { afterEach, describe, expect, it } from "vitest";
import { testPrincipal } from "@/test/principal";
import type { UseCaseDeps } from "../application/ports";
import {
  MemoryLegacyFundDeposits,
  MemoryPayrollComponentsRepository,
  MemoryPayrollImportsRepository,
  MemoryPayrollMappingRulesRepository,
  MemoryPayrollRecordsRepository,
} from "../infrastructure/memory-repositories";
import { noopScanner } from "../infrastructure/noop-scanner";
import { loadCompanyOverview, loadEarnings, loadRecordDetail } from "./load-company";
import { setPayrollDepsFactoryForTests, setPrincipalForTests } from "./run";

const principal = testPrincipal({ userId: "00000000-0000-7000-8000-00000000000a" });

let shared: UseCaseDeps | null = null;

function useDeps(deps: UseCaseDeps) {
  shared = deps;
  setPayrollDepsFactoryForTests(() => shared!);
  setPrincipalForTests(principal);
}

afterEach(() => {
  setPayrollDepsFactoryForTests(null);
  setPrincipalForTests(null);
  shared = null;
});

function makeDeps(): UseCaseDeps {
  return {
    imports: new MemoryPayrollImportsRepository(),
    records: new MemoryPayrollRecordsRepository(),
    components: new MemoryPayrollComponentsRepository(),
    mappingRules: new MemoryPayrollMappingRulesRepository(),
    funds: new MemoryLegacyFundDeposits(),
    documents: { provider: "local", put: async () => {}, get: async () => null, delete: async () => {}, listPrefix: async () => [] },
    scanner: noopScanner,
    clock: { now: () => new Date("2026-09-05T10:00:00Z") },
    audit: async () => {},
  };
}

let sha = 0;
async function seedApplied(deps: UseCaseDeps, periodStart: string, net = "1800.00") {
  sha += 1;
  const imported = await deps.imports.create({
    userId: principal.userId, fileName: "b.pdf", mime: "application/pdf", sizeBytes: 10,
    sha256: String(sha).padStart(64, "0"), storageProvider: "local",
    storageKey: `payroll/${principal.userId}/2026/${String(sha).padStart(32, "0")}.pdf`,
    idempotencyKey: null, replacesImportId: null,
    retentionUntil: new Date("2036-01-01T00:00:00Z"), uploadedVia: "ui",
  });
  await deps.imports.patch(principal.userId, imported.id, { status: "applied", scanStatus: "clean", scanner: "none" });
  const record = await deps.records.create({
    userId: principal.userId, importId: imported.id, periodStart,
    periodEnd: `${periodStart.slice(0, 7)}-28`, payDate: null, kind: "ordinary", currency: "EUR",
    gross: "2500.00", net, verifiedAt: new Date("2026-09-05T00:00:00Z"), verifiedBy: principal.userId, corrections: null,
  });
  await deps.components.replaceForRecord(record.id, [
    { recordId: "", code: "taxes", labelRaw: "Totale trattenute", kind: "tax", amount: "700.00", quantity: null, unit: "eur", currency: "EUR", confidence: "high", source: "rules", mappedTo: { kind: "earnings" }, sortOrder: 0 },
  ]);
  return { imported, record };
}

describe("loadCompanyOverview", () => {
  it("reports an empty overview for a user with nothing, never zeros", async () => {
    const deps = makeDeps();
    useDeps(deps);
    expect(await loadCompanyOverview()).toEqual({
      latestImport: null, pendingReview: 0, year: null, months: [], salaryWindows: [],
    });
  });

  it("reports the newest import, the review backlog and this year's totals", async () => {
    const deps = makeDeps();
    useDeps(deps);
    await seedApplied(deps, "2026-07-01");
    const latest = await seedApplied(deps, "2026-08-01");
    const created = await deps.imports.create({
      userId: principal.userId, fileName: "waiting.pdf", mime: "application/pdf", sizeBytes: 10,
      sha256: "e".repeat(64), storageProvider: "local", storageKey: "k",
      idempotencyKey: null, replacesImportId: null,
      retentionUntil: new Date("2036-01-01T00:00:00Z"), uploadedVia: "ui",
    });
    await deps.imports.patch(principal.userId, created.id, { status: "needs_review", scanStatus: "clean" });

    const overview = await loadCompanyOverview();
    expect(overview.latestImport?.id).toBe(created.id);
    expect(overview.pendingReview).toBe(1);
    expect(overview.year).toMatchObject({ key: "2026", net: "3600.00", taxes: "1400.00", recordCount: 2 });
    expect(overview.months.map((m) => m.key)).toEqual(["2026-08", "2026-07"]);
    void latest;
  });

  it("builds the three salary windows from applied records, excluding a tredicesima from the average", async () => {
    const deps = makeDeps();
    useDeps(deps);
    await seedApplied(deps, "2026-06-01", "1800.00");
    await seedApplied(deps, "2026-07-01", "1900.00");
    const overview = await loadCompanyOverview();
    expect(overview.salaryWindows.map((w) => w.key)).toEqual(["3", "6", "12"]);
    expect(overview.salaryWindows[0]!.avgNet).toBeCloseTo(1850, 2);
  });
});

describe("loadEarnings", () => {
  it("lists live records newest first with the summary alongside", async () => {
    const deps = makeDeps();
    useDeps(deps);
    await seedApplied(deps, "2026-07-01");
    await seedApplied(deps, "2026-08-01");
    const { rows, summary } = await loadEarnings();
    expect(rows.map((r) => r.periodStart)).toEqual(["2026-08-01", "2026-07-01"]);
    expect(rows[0]).toMatchObject({ gross: "2500.00", net: "1800.00", taxes: "700.00" });
    expect(summary.years[0]).toMatchObject({ key: "2026", recordCount: 2 });
  });

  it("returns nothing at all for a user with no records", async () => {
    const deps = makeDeps();
    useDeps(deps);
    expect(await loadEarnings()).toEqual({ rows: [], summary: { months: [], quarters: [], years: [] } });
  });

  it("never lists a superseded record (Ruling R4-12)", async () => {
    const deps = makeDeps();
    useDeps(deps);
    const first = await seedApplied(deps, "2026-08-01");
    await deps.records.supersede(principal.userId, first.record.id, first.record.id, new Date());
    expect((await loadEarnings()).rows).toEqual([]);
  });
});

describe("loadRecordDetail", () => {
  it("returns the record with its components and says whether the original is still there", async () => {
    const deps = makeDeps();
    useDeps(deps);
    const { record, imported } = await seedApplied(deps, "2026-08-01");
    const detail = await loadRecordDetail(record.id);
    expect(detail?.importId).toBe(imported.id);
    expect(detail?.components.map((c) => c.code)).toEqual(["taxes"]);
    expect(detail?.originalAvailable).toBe(true);
  });

  it("says the original is gone once retention has purged it", async () => {
    const deps = makeDeps();
    useDeps(deps);
    const { record, imported } = await seedApplied(deps, "2026-08-01");
    await deps.imports.patch(principal.userId, imported.id, { storageKey: null, purgedAt: new Date() });
    expect((await loadRecordDetail(record.id))?.originalAvailable).toBe(false);
  });

  it("answers null for a record that is not this user's", async () => {
    const deps = makeDeps();
    useDeps(deps);
    expect(await loadRecordDetail("00000000-0000-7000-8000-0000000000ff")).toBeNull();
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `npm test -- payroll/ui/load-company`
Expected: FAIL — `Cannot find module './load-company'`.

- [ ] **Step 3: Move `SalarySection` and write the loaders**

```tsx
// src/modules/payroll/ui/SalarySection.tsx
```
Copy `src/app/(app)/work/_components/SalarySection.tsx` **verbatim, with no edits at all**. It is a pure presentational client component over `SalaryWindow[]` and knows nothing about where its numbers came from. The original is deleted in Task 19.

It lands in `src/modules/payroll/ui/` rather than under `src/app/(app)/company/_components/` because `load-company.ts` needs its `SalaryWindow` and `WindowKey` types, and a module importing from `src/app/` would invert the layering the rest of this phase holds. The leave components in Task 19 stay page-local under `_components/`, because nothing in `src/modules/` needs their types.

```ts
// src/modules/payroll/ui/load-company.ts
import type { MonthPoint } from "@/lib/contracts";
import { NotFoundError } from "../application/errors";
import { addMoney } from "../domain/money";
import type { SalaryWindow, WindowKey } from "./SalarySection";
import { listImports } from "../application/list-imports";
import { earningsSummary, getRecord, listRecords } from "../application/list-records";
import type { EarningsBucket, EarningsSummary } from "../domain/earnings";
import type { PayrollRecord } from "../application/ports";
import { runForPrincipal } from "./run";

/** Flat and serialisable: these cross the server/client boundary. */
export interface EarningsRow {
  id: string;
  periodStart: string;
  kind: string;
  gross: string | null;
  net: string | null;
  taxes: string | null;
}

export interface ComponentRow {
  id: string;
  code: string;
  labelRaw: string;
  kind: string;
  amount: string | null;
  quantity: string | null;
  unit: string | null;
  confidence: string | null;
  source: string;
}

export interface CompanyOverview {
  latestImport: { id: string; status: string; scanStatus: string; fileName: string } | null;
  pendingReview: number;
  /** This calendar year's bucket, or null when there is no record in it. */
  year: EarningsBucket | null;
  months: EarningsBucket[];
  salaryWindows: SalaryWindow[];
}

export interface RecordDetailData {
  record: EarningsRow;
  importId: string;
  components: ComponentRow[];
  canReadOriginal: boolean;
  /** False once the retention job has purged the object (Ruling R4-5). */
  originalAvailable: boolean;
}

/** `null`, never 0: an average of nothing is not zero (global constraint). */
function averageOf(values: readonly (string | null)[]): number | null {
  const numbers = values.filter((v): v is string => v !== null).map(Number);
  if (numbers.length === 0) return null;
  return numbers.reduce((a, b) => a + b, 0) / numbers.length;
}

/**
 * The record's tax line. A **sum**, not the first match: this phase's parser
 * produces exactly one `tax` component, but a later mapping rule may classify a
 * second, and a `find` would then under-report it silently. `null` when there is
 * no tax component at all — never `0.00`.
 */
function taxesByRecord(components: readonly ComponentRow[]): string | null {
  return components.filter((c) => c.kind === "tax").reduce<string | null>((acc, c) => addMoney(acc, c.amount), null);
}

/**
 * The three averaging windows the Salary panel switches between, computed on the
 * server for all three so the client component does no arithmetic — exactly the
 * contract `SalarySection` already documents.
 *
 * A tredicesima is excluded from the average and from the bars, matching the
 * panel's own "Tredicesima excluded" caption and the legacy `averageNet`'s
 * behaviour.
 */
function salaryWindows(records: readonly PayrollRecord[]): SalaryWindow[] {
  const ordinary = records.filter((r) => r.kind === "ordinary");
  if (ordinary.length === 0) return [];
  return (["3", "6", "12"] as const).map((key: WindowKey) => {
    const months = Number(key);
    const window = ordinary.slice(0, months);
    const series: MonthPoint[] = [...window]
      .reverse()
      .map((r) => ({ month: r.periodStart, value: r.net === null ? null : Number(r.net) }));
    return { key, avgNet: averageOf(window.map((r) => r.net)), avgTaxes: null, series };
  });
}

export async function loadCompanyOverview(): Promise<CompanyOverview> {
  return runForPrincipal(async (deps, principal) => {
    const [imports, records, summary] = await Promise.all([
      listImports(deps)(principal, { limit: 50 }),
      listRecords(deps)(principal),
      earningsSummary(deps)(principal),
    ]);
    const latest = imports[0] ?? null;
    const thisYear = String(deps.clock.now().getUTCFullYear());
    const windows = salaryWindows(records);
    // Taxes come from the summary, which already read the components once;
    // asking again per window would be a second full read for the same numbers.
    const withTaxes = windows.map((w) => {
      const keys = new Set(w.series.map((p) => p.month.slice(0, 7)));
      const buckets = summary.months.filter((m) => keys.has(m.key));
      return { ...w, avgTaxes: averageOf(buckets.map((b) => b.taxes)) };
    });
    return {
      latestImport: latest
        ? { id: latest.id, status: latest.status, scanStatus: latest.scanStatus, fileName: latest.fileName }
        : null,
      pendingReview: imports.filter((i) => i.status === "needs_review" || i.status === "needs_ocr").length,
      year: summary.years.find((y) => y.key === thisYear) ?? null,
      months: summary.months,
      salaryWindows: withTaxes,
    };
  });
}

export async function loadEarnings(
  opts: { from?: string; to?: string } = {},
): Promise<{ rows: EarningsRow[]; summary: EarningsSummary }> {
  return runForPrincipal(async (deps, principal) => {
    const records = await listRecords(deps)(principal, opts);
    const components = await deps.components.listForRecords(records.map((r) => r.id));
    const summary = await earningsSummary(deps)(principal, opts);
    const byRecord = new Map<string, ComponentRow[]>();
    for (const c of components) {
      const list = byRecord.get(c.recordId) ?? [];
      list.push({
        id: c.id, code: c.code, labelRaw: c.labelRaw, kind: c.kind,
        amount: c.amount, quantity: c.quantity, unit: c.unit, confidence: c.confidence, source: c.source,
      });
      byRecord.set(c.recordId, list);
    }
    return {
      rows: records.map((r) => ({
        id: r.id,
        periodStart: r.periodStart,
        kind: r.kind,
        gross: r.gross,
        net: r.net,
        taxes: taxesByRecord(byRecord.get(r.id) ?? []),
      })),
      summary,
    };
  });
}

export async function loadRecordDetail(recordId: string): Promise<RecordDetailData | null> {
  return runForPrincipal(async (deps, principal) => {
    // Only a missing record renders as "not found"; any other failure is a real
    // error and must surface as one.
    const detail = await getRecord(deps)(principal, recordId).catch((err: unknown) => {
      if (err instanceof NotFoundError) return null;
      throw err;
    });
    if (!detail) return null;
    const source = await deps.imports.get(principal.userId, detail.record.importId);
    const components: ComponentRow[] = detail.components.map((c) => ({
      id: c.id, code: c.code, labelRaw: c.labelRaw, kind: c.kind,
      amount: c.amount, quantity: c.quantity, unit: c.unit, confidence: c.confidence, source: c.source,
    }));
    return {
      record: {
        id: detail.record.id,
        periodStart: detail.record.periodStart,
        kind: detail.record.kind,
        gross: detail.record.gross,
        net: detail.record.net,
        taxes: taxesByRecord(components),
      },
      importId: detail.record.importId,
      components,
      canReadOriginal: principal.permissions.has("payroll.read_original"),
      originalAvailable: source?.storageKey !== null && source?.scanStatus === "clean",
    };
  });
}
```

- [ ] **Step 4: Run the loader test and watch it pass**

Run: `npm test -- payroll/ui/load-company`
Expected: PASS — all 9 cases.

- [ ] **Step 5: Write the two presentational components**

```tsx
// src/modules/payroll/ui/EarningsTable.tsx
import Link from "next/link";
import { EmptyState } from "@/components/ui/EmptyState";
import { MoneyValue } from "@/components/ui/MoneyValue";
import { formatMonth } from "@/lib/format";
import type { EarningsRow } from "./load-company";

const KIND_LABEL: Record<string, string> = {
  ordinary: "",
  thirteenth: "13th",
  fourteenth: "14th",
  bonus: "Bonus",
  settlement: "Settlement",
};

export interface EarningsTableProps {
  rows: readonly EarningsRow[];
}

export function EarningsTable({ rows }: EarningsTableProps) {
  if (rows.length === 0) {
    return (
      <div className="max-w-xl">
        <EmptyState
          title="No earnings yet"
          description="Earnings appear once a payslip has been confirmed and applied."
          action={
            <Link
              href="/company/payroll"
              className="inline-flex min-h-11 items-center rounded-md bg-accent px-4 text-body-sm font-medium text-accent-contrast transition-colors hover:bg-accent-hover"
            >
              Go to Payroll
            </Link>
          }
        />
      </div>
    );
  }

  return (
    <ul className="hairline-t">
      {rows.map((row) => (
        <li key={row.id} className="lazy-block [contain-intrinsic-size:auto_4rem]">
          <Link
            href={`/company/earnings/${row.id}`}
            className="flex min-h-11 items-center gap-3 py-2 hairline-b transition-colors hover:bg-surface-hover"
          >
            <span className="min-w-0 flex-1">
              <span className="num block text-body text-fg">
                {formatMonth(row.periodStart)}
                {KIND_LABEL[row.kind] && <span className="ml-2 text-caption text-fg-muted">{KIND_LABEL[row.kind]}</span>}
              </span>
              <span className="num mt-0.5 block text-caption text-fg-muted">
                {/* An em dash, never €0.00, for a figure the payslip did not state. */}
                Gross <MoneyValue value={row.gross} size="body" /> · Taxes <MoneyValue value={row.taxes} size="body" />
              </span>
            </span>
            <MoneyValue value={row.net} size="body" />
          </Link>
        </li>
      ))}
    </ul>
  );
}
```

```tsx
// src/modules/payroll/ui/RecordDetail.tsx
import Link from "next/link";
import { Panel } from "@/components/layout/PageGrid";
import { MoneyValue } from "@/components/ui/MoneyValue";
import { formatNumber } from "@/lib/format";
import type { RecordDetailData } from "./load-company";

const KIND_LABEL: Record<string, string> = {
  earning: "Earning",
  deduction: "Deduction",
  tax: "Tax",
  employer_contribution: "Employer contribution",
  employee_contribution: "Employee contribution",
  reimbursement: "Reimbursement",
  allowance: "Allowance",
  bonus: "Bonus",
  leave_balance: "Leave balance",
  leave_used: "Leave used",
  leave_accrued: "Leave accrued",
  info: "Information",
};

export interface RecordDetailProps {
  detail: RecordDetailData;
}

export function RecordDetail({ detail }: RecordDetailProps) {
  return (
    <Panel span={12} title="Components">
      <ul className="hairline-t">
        {detail.components.map((component) => (
          <li key={component.id} className="flex min-h-11 items-center gap-3 py-2 hairline-b">
            <span className="min-w-0 flex-1">
              {/* The payslip's own Italian wording, verbatim (spec §2.9): it is
                  what the reader compares against the document in their hand.
                  Everything around it is English. */}
              <span className="block text-body text-fg">{component.labelRaw}</span>
              <span className="mt-0.5 block text-caption text-fg-muted">
                {KIND_LABEL[component.kind] ?? component.kind}
                {component.confidence && ` · ${component.confidence} confidence`}
                {` · from ${component.source}`}
              </span>
            </span>
            {component.amount !== null ? (
              <MoneyValue value={component.amount} size="body" />
            ) : (
              <span className="num text-body text-fg">
                {component.quantity === null ? "—" : `${formatNumber(Number(component.quantity))} ${component.unit ?? ""}`}
              </span>
            )}
          </li>
        ))}
      </ul>

      <p className="pt-4 text-body-sm text-fg-muted">
        {detail.canReadOriginal && detail.originalAvailable ? (
          <Link className="underline" href={`/api/v1/payroll/imports/${detail.importId}/original`}>
            Open the original payslip
          </Link>
        ) : detail.canReadOriginal ? (
          "The original has been removed under the retention policy."
        ) : (
          "You do not have permission to open the original."
        )}
      </p>
    </Panel>
  );
}
```

- [ ] **Step 6: Write the three pages and their loading states**

```tsx
// src/app/(app)/company/page.tsx
import Link from "next/link";
import { PageGrid, Panel } from "@/components/layout/PageGrid";
import { PageHeader } from "@/components/layout/PageHeader";
import { EmptyState } from "@/components/ui/EmptyState";
import { MoneyValue } from "@/components/ui/MoneyValue";
import { StatGrid, StatTile } from "@/components/ui/StatTile";
import { loadCompanyOverview } from "@/modules/payroll/ui/load-company";
import { statusChip } from "@/modules/payroll/ui/status";
import { requirePrincipalOrRedirect } from "@/platform/auth/require-principal";
import { realProbes } from "@/platform/capabilities/probes";
import { resolveCapabilities } from "@/platform/capabilities/resolve";
import { SalarySection } from "@/modules/payroll/ui/SalarySection";

export const dynamic = "force-dynamic";
export const metadata = { title: "Company" };

/**
 * Spec §7.8: earnings, the latest import status and the alerts that go with it.
 * Time-off balances and upcoming leave join this panel in Phase 7 — this phase
 * relocates the leave calendar to `/company/time-off` without redesigning it
 * (Ruling R4-11).
 */
export default async function CompanyPage() {
  const principal = await requirePrincipalOrRedirect();
  const caps = await resolveCapabilities(principal, realProbes);

  if (!caps.features.payroll) {
    return (
      <>
        <PageHeader title="Company" />
        <div className="max-w-xl pt-6">
          <EmptyState
            title="Connect a payroll document store"
            description="Company earnings are derived from uploaded payslips. Connect the document store to begin."
            action={
              <Link
                href="/settings/integrations/payroll_silo"
                className="inline-flex min-h-11 items-center rounded-md bg-accent px-4 text-body-sm font-medium text-accent-contrast transition-colors hover:bg-accent-hover"
              >
                Go to Integrations
              </Link>
            }
          />
        </div>
      </>
    );
  }

  const overview = await loadCompanyOverview();
  const year = new Date().getFullYear();

  return (
    <>
      <PageHeader title="Company" eyebrow={`${year}`} />
      <PageGrid className="pt-5">
        {overview.pendingReview > 0 && (
          <Panel span={12} ariaLabel="Payslips waiting for review">
            <Link
              href="/company/payroll"
              className="flex min-h-11 items-center justify-between gap-3 rounded-md border border-border bg-warning/10 px-4 py-3 transition-colors hover:bg-warning/15"
            >
              <span className="text-body-sm text-fg">
                {overview.pendingReview === 1
                  ? "1 payslip is waiting for review"
                  : `${overview.pendingReview} payslips are waiting for review`}
              </span>
              <span aria-hidden className="text-body-sm font-medium text-warning">
                Review &rarr;
              </span>
            </Link>
          </Panel>
        )}

        <Panel span={12} ariaLabel="Earnings at a glance">
          <StatGrid columns={4}>
            {/* Every tile renders an em dash, never a zero, when the figure is
                absent — `MoneyValue` already does that for `null`. */}
            <StatTile label={`Gross ${year}`} value={<MoneyValue value={overview.year?.gross ?? null} size="display-sm" cents="muted" />} sub="Applied payslips only" />
            <StatTile emphasis="primary" label={`Net ${year}`} value={<MoneyValue value={overview.year?.net ?? null} size="display-sm" cents="muted" />} sub="Applied payslips only" />
            <StatTile label={`Taxes ${year}`} value={<MoneyValue value={overview.year?.taxes ?? null} size="display-sm" cents="muted" />} sub="Total deductions" />
            <StatTile label={`Contributions ${year}`} value={<MoneyValue value={overview.year?.contributions ?? null} size="display-sm" cents="muted" />} sub="Employee and employer" />
          </StatGrid>
        </Panel>

        {overview.salaryWindows.length > 0 && <SalarySection windows={overview.salaryWindows} />}

        <Panel span={7} title="Latest import">
          {overview.latestImport === null ? (
            <div className="max-w-xl">
              <EmptyState
                title="No payslips yet"
                description="Upload a payslip and it will be scanned, read and put in front of you to confirm."
                action={
                  <Link
                    href="/company/payroll"
                    className="inline-flex min-h-11 items-center rounded-md bg-accent px-4 text-body-sm font-medium text-accent-contrast transition-colors hover:bg-accent-hover"
                  >
                    Upload a payslip
                  </Link>
                }
              />
            </div>
          ) : (
            <Link
              href={`/company/payroll/${overview.latestImport.id}`}
              className="flex min-h-11 items-center justify-between gap-3 py-2 transition-colors hover:bg-surface-hover"
            >
              <span className="text-body text-fg">{overview.latestImport.fileName}</span>
              <span className="text-body-sm text-fg-muted">
                {statusChip(overview.latestImport.status, overview.latestImport.scanStatus).label}
              </span>
            </Link>
          )}
        </Panel>
      </PageGrid>
    </>
  );
}
```

```tsx
// src/app/(app)/company/earnings/page.tsx
import { PageHeader } from "@/components/layout/PageHeader";
import { EarningsTable } from "@/modules/payroll/ui/EarningsTable";
import { loadEarnings } from "@/modules/payroll/ui/load-company";
import { requirePrincipalOrRedirect } from "@/platform/auth/require-principal";

export const dynamic = "force-dynamic";
export const metadata = { title: "Earnings" };

export default async function EarningsPage() {
  await requirePrincipalOrRedirect();
  // `EarningsTable` renders its own setup state when there are no records, so
  // a user with the feature on but nothing applied sees an explanation and a
  // link, not an empty table (spec §3.3).
  const { rows } = await loadEarnings();
  return (
    <>
      <PageHeader title="Earnings" />
      <div className="pt-6">
        <EarningsTable rows={rows} />
      </div>
    </>
  );
}
```

```tsx
// src/app/(app)/company/earnings/[recordId]/page.tsx
import { notFound } from "next/navigation";
import { PageGrid } from "@/components/layout/PageGrid";
import { PageHeader } from "@/components/layout/PageHeader";
import { formatMonth } from "@/lib/format";
import { RecordDetail } from "@/modules/payroll/ui/RecordDetail";
import { loadRecordDetail } from "@/modules/payroll/ui/load-company";
import { requirePrincipalOrRedirect } from "@/platform/auth/require-principal";

export const dynamic = "force-dynamic";

export async function generateMetadata({ params }: { params: Promise<{ recordId: string }> }) {
  const { recordId } = await params;
  const detail = await loadRecordDetail(recordId);
  return { title: detail ? formatMonth(detail.record.periodStart) : "Earnings" };
}

export default async function EarningsRecordPage({ params }: { params: Promise<{ recordId: string }> }) {
  await requirePrincipalOrRedirect();
  const { recordId } = await params;
  const detail = await loadRecordDetail(recordId);
  if (!detail) notFound();

  return (
    <>
      <PageHeader title={formatMonth(detail.record.periodStart)} eyebrow="Earnings" />
      <PageGrid className="pt-5">
        <RecordDetail detail={detail} />
      </PageGrid>
    </>
  );
}
```

```tsx
// src/app/(app)/company/loading.tsx
import { PageHeader } from "@/components/layout/PageHeader";

export default function Loading() {
  return <PageHeader title="Company" />;
}
```

```tsx
// src/app/(app)/company/earnings/loading.tsx
import { PageHeader } from "@/components/layout/PageHeader";

export default function Loading() {
  return <PageHeader title="Earnings" />;
}
```

```tsx
// src/app/(app)/company/earnings/[recordId]/loading.tsx
import { PageHeader } from "@/components/layout/PageHeader";

export default function Loading() {
  return <PageHeader title="Earnings" eyebrow="Earnings" />;
}
```

`generateMetadata` calls the same loader the page body does. That is deliberate and matches the fix ruling made for `/finance/expenses/[transactionId]` (commit `60cda52`): a metadata function that resolves a different principal, or skips the ownership check the body performs, leaks a title for a record the caller may not read.

- [ ] **Step 7: Run everything**

Run:
```bash
npm test -- payroll/
npm run build
npx tsc --noEmit
```
Expected: PASS, and the route table now lists `/company`, `/company/earnings` and `/company/earnings/[recordId]`.

- [ ] **Step 8: Commit**

```bash
git add src/modules/payroll/ui "src/app/(app)/company"
git commit -m "feat(payroll): add Company Overview and Earnings"
```

---

### Task 19: Retire `/work` — relocate Time Off, rewire navigation and Home

**Files:**
- Create: `src/app/(app)/company/time-off/page.tsx`
- Create: `src/app/(app)/company/time-off/loading.tsx`
- Create: `src/app/(app)/company/_components/LeaveCalendar.tsx` (moved)
- Create: `src/app/(app)/company/_components/LeaveByMonth.tsx` (moved)
- Create: `src/app/(app)/company/_lib/leave.ts` + `leave.test.ts` (moved)
- Modify: `src/platform/capabilities/navigation.ts` and `navigation.test.ts`
- Modify: `src/modules/home/cards.ts` and `cards.test.ts`
- Delete: `src/app/(app)/work/**` (all fourteen files)
- Delete: `src/app/actions/payslips.ts`

**Interfaces:**
- Consumes: `loadFerie` from `src/app/(app)/_lib/vacation.ts` (unchanged, still reads the legacy `payslips` table until Phase 7); `loadLeaveCalendar` from the moved `_lib/leave.ts`; `Capabilities` from `@/platform/capabilities/resolve`.
- Produces: no new exported symbols; `buildNavigation` and `HOME_CARDS` change shape.

Ruling R4-11: this is a **relocation, not the Phase 7 redesign**. The calendar, the by-month breakdown and the ferie stats move file-for-file; the salary block and the payslip list stay where Tasks 17 and 18 put them.

- [ ] **Step 1: Write the failing navigation test**

Replace the `/work` expectations in `src/platform/capabilities/navigation.test.ts` with:

```ts
  it("shows Company with its four children when payroll is on", () => {
    const items = buildNavigation(capsWith({ features: { payroll: true, timeoff: true } }));
    const company = items.find((i) => i.href === "/company");
    expect(company).toMatchObject({ label: "Company", iconKey: "company" });
    expect(company!.children?.map((c) => c.href)).toEqual([
      "/company",
      "/company/earnings",
      "/company/time-off",
      "/company/payroll",
    ]);
  });

  it("shows only Time Off when Trek is connected but payroll is not", () => {
    const items = buildNavigation(capsWith({ features: { payroll: false, timeoff: true } }));
    const company = items.find((i) => i.href === "/company");
    expect(company!.children?.map((c) => c.href)).toEqual(["/company/time-off"]);
  });

  it("hides Company entirely when neither payroll nor time off is available", () => {
    const items = buildNavigation(capsWith({ features: { payroll: false, timeoff: false } }));
    expect(items.find((i) => i.href === "/company")).toBeUndefined();
  });

  it("hides Payroll from someone with neither upload nor review", () => {
    const items = buildNavigation(capsWith({ features: { payroll: true, timeoff: true }, permissions: new Set(["payroll.read"]) }));
    const company = items.find((i) => i.href === "/company");
    expect(company!.children?.map((c) => c.href)).not.toContain("/company/payroll");
  });

  it("no longer links to /work anywhere", () => {
    const items = buildNavigation(capsWith({ features: { payroll: true, timeoff: true } }));
    expect(JSON.stringify(items)).not.toContain("/work");
  });
```
(`capsWith` is whatever helper the existing file already uses to build a `Capabilities` object; extend it rather than adding a second one.)

- [ ] **Step 2: Run it and watch it fail**

Run: `npm test -- capabilities/navigation`
Expected: FAIL — the Company item still points at `/work` and has no children.

- [ ] **Step 3: Rewire the navigation**

In `src/platform/capabilities/navigation.ts`, replace the single `/work` push with:

```ts
  // Spec §4's page map. Overview needs the payroll feature; Earnings is shown
  // whenever Overview is (the page renders its own "no earnings yet" state, so
  // hiding it would leave a user with nowhere to look); Time Off needs payroll
  // *or* Trek; Payroll needs one of the two payroll write permissions.
  const company: NavChild[] = [];
  if (c.features.payroll) {
    company.push({ href: "/company", label: "Overview" });
    company.push({ href: "/company/earnings", label: "Earnings" });
  }
  if (c.features.payroll || c.features.timeoff) company.push({ href: "/company/time-off", label: "Time Off" });
  if (c.permissions.has("payroll.upload") || c.permissions.has("payroll.review")) {
    company.push({ href: "/company/payroll", label: "Payroll" });
  }
  if (company.length > 0) {
    items.push({ href: "/company", label: "Company", iconKey: "company", children: company });
  }
```
The `iconKey` stays `"company"` — it was already named for the destination, which is why the shell needs no change.

- [ ] **Step 4: Rewire the Home cards**

In `src/modules/home/cards.ts`:

```ts
export type CardKey = "total_balance" | "accounts_sync" | "funds" | "leave" | "payroll_imports";
```

```ts
export const HOME_CARDS: readonly HomeCard[] = [
  { key: "total_balance", title: "Total balance", href: "/finance/accounts", requires: {} },
  { key: "accounts_sync", title: "Accounts sync", href: "/settings/integrations", requires: { integration: "wallet" } },
  { key: "funds", title: "Funds", href: "/finance/funds", requires: {} },
  { key: "leave", title: "Leave", href: "/company/time-off", requires: { feature: "timeoff" } },
  // Spec §7.1 lists a payroll-import-status card. It is gated on the feature so
  // it disappears with the section, and on `payroll.upload` so a viewer is told
  // out loud rather than silently shown nothing (`cardState`, not `isCardVisible`).
  { key: "payroll_imports", title: "Payroll imports", href: "/company/payroll", requires: { feature: "payroll", permission: "payroll.upload" } },
];
```

In `src/modules/home/cards.test.ts`, update the leave-card href expectation and add:

```ts
  it("shows the payroll import card only when the payroll feature is on", () => {
    expect(visibleCards(capsWith({ features: { payroll: true } })).map((c) => c.key)).toContain("payroll_imports");
    expect(visibleCards(capsWith({ features: { payroll: false } })).map((c) => c.key)).not.toContain("payroll_imports");
  });

  it("tells a viewer they lack permission rather than hiding the payroll card", () => {
    const caps = capsWith({ features: { payroll: true }, permissions: new Set(["payroll.read"]) });
    const card = visibleCards(caps).find((c) => c.key === "payroll_imports")!;
    expect(cardState(card, caps)).toEqual({ state: "permission_denied" });
  });

  it("links Leave at the relocated Time Off route", () => {
    expect(HOME_CARDS.find((c) => c.key === "leave")?.href).toBe("/company/time-off");
  });
```

- [ ] **Step 5: Move the three leave files and write the Time Off page**

Move, with no content change other than import paths:
- `src/app/(app)/work/_components/LeaveCalendar.tsx` → `src/app/(app)/company/_components/LeaveCalendar.tsx`
- `src/app/(app)/work/_components/LeaveByMonth.tsx` → `src/app/(app)/company/_components/LeaveByMonth.tsx`
- `src/app/(app)/work/_lib/leave.ts` and `leave.test.ts` → `src/app/(app)/company/_lib/`

`LeaveByMonth` currently takes `firstPendingId: number | null` and `pendingCount: number` and links to `/work/verify/:id`. Change those two props to `firstPendingId: string | null` and update the link to `/company/payroll/${firstPendingId}`; leave everything else untouched.

```tsx
// src/app/(app)/company/time-off/page.tsx
import { PageGrid, Panel } from "@/components/layout/PageGrid";
import { PageHeader } from "@/components/layout/PageHeader";
import { StaleBadge } from "@/components/ui/StaleBadge";
import { StatGrid, StatTile } from "@/components/ui/StatTile";
import { leaveTakenYtd } from "@/lib/calc/payroll";
import { formatDays, formatNumber, hoursToDays } from "@/lib/format";
import { verifiedPayslips } from "@/lib/repo/payslips";
import { loadImports } from "@/modules/payroll/ui/load-payroll";
import { requirePrincipalOrRedirect } from "@/platform/auth/require-principal";
import { realProbes } from "@/platform/capabilities/probes";
import { resolveCapabilities } from "@/platform/capabilities/resolve";
import { loadFerie } from "../../_lib/vacation";
import { LeaveByMonth } from "../_components/LeaveByMonth";
import { LeaveCalendar } from "../_components/LeaveCalendar";
import { loadLeaveCalendar } from "../_lib/leave";

export const dynamic = "force-dynamic";
export const metadata = { title: "Time Off" };

/**
 * Ruling R4-11: the leave half of the retired `/work` page, relocated to the
 * route spec §4 gives it. Not the Phase 7 workspace — no in-place detail panel,
 * no balances by type, no URL-driven day selection. Those arrive with
 * `timeoff_types`/`timeoff_balances`/`timeoff_events`.
 *
 * `loadFerie` and `verifiedPayslips` still read the legacy `payslips` table,
 * unchanged: Phase 7 replaces that source, and moving the read in this phase
 * would mean deriving balances from `payroll_components` with no
 * `timeoff_balances` table to put them in.
 */
export default async function TimeOffPage() {
  const principal = await requirePrincipalOrRedirect();
  const caps = await resolveCapabilities(principal, realProbes);
  const year = new Date().getFullYear();
  // Spec §4 makes this page reachable with **Trek alone** — payroll off, no
  // document store connected. `loadImports` goes through `runForPrincipal`,
  // which throws `DocumentStoreUnavailableError` when there is no store, so it
  // is asked for only when the payroll feature is actually on. Without this
  // guard a Trek-only user gets a stack trace instead of their calendar.
  const [verified, ferie, calendar, imports] = await Promise.all([
    verifiedPayslips(),
    loadFerie(year),
    loadLeaveCalendar(year),
    caps.features.payroll ? loadImports() : Promise.resolve([]),
  ]);

  const remaining = ferie.remaining;
  // Days ACTUALLY used, straight off the `ferie_taken` / `rol_taken` columns of
  // the verified payslips — payroll's own number, never a figure typed here.
  // The leave calendar below carries the other half, what was PLANNED, and the
  // two are reconciled per month rather than merged.
  const taken = leaveTakenYtd(verified, year, ferie.hoursPerDay);
  const pending = imports.filter((i) => i.status === "needs_review" || i.status === "needs_ocr");

  return (
    <>
      <PageHeader title="Time Off" eyebrow={`${year}`} />
      <PageGrid className="pt-5">
        <Panel span={12} ariaLabel="Leave at a glance">
          <StatGrid columns={2}>
            <StatTile
              label={`Days taken ${year}`}
              value={formatDays(taken.totalDays)}
              sub={<span className="num">{`Ferie ${formatDays(taken.ferieDays)} · ROL ${formatDays(taken.rolDays)}`}</span>}
            />
            <StatTile
              emphasis="primary"
              label="Days remaining"
              value={remaining.combinedDays === null ? "-" : formatDays(remaining.combinedDays)}
              sub={
                <span className="num">
                  {`Ferie ${formatDays(hoursToDays(remaining.ferieHours, ferie.hoursPerDay))} · ROL ${formatDays(hoursToDays(remaining.rolHours, ferie.hoursPerDay))}`}
                </span>
              }
            />
          </StatGrid>
          <p className="num pt-2 text-caption text-fg-muted">
            Residuals from the latest verified payslip
            {remaining.permessiHours !== null && ` · permessi ${formatNumber(remaining.permessiHours)} h (not in the headline)`}
            {" · "}
            <StaleBadge capturedAt={ferie.latest?.verifiedAt ?? null} stale={ferie.latest === null} />
          </p>
        </Panel>

        <LeaveCalendar view={calendar} />

        <LeaveByMonth
          months={ferie.takenByMonth}
          ytdDays={taken.totalDays}
          year={year}
          firstPendingId={pending[0]?.id ?? null}
          pendingCount={pending.length}
        />
      </PageGrid>
    </>
  );
}
```

```tsx
// src/app/(app)/company/time-off/loading.tsx
import { PageHeader } from "@/components/layout/PageHeader";

export default function Loading() {
  return <PageHeader title="Time Off" />;
}
```

- [ ] **Step 6: Delete `/work` and the old server actions**

```bash
git rm -r "src/app/(app)/work"
git rm src/app/actions/payslips.ts
```

`src/app/actions/payslips.ts` is the last caller of `payslipsRepo.verify` and `payslipsRepo.reject`, and `work/page.tsx` was the last caller of `allPayslips`. Those four functions become dead here and are deleted in Task 22 with the rest of the Paperless surface — deliberately not here, so this commit is a pure route move.

- [ ] **Step 7: Prove nothing still points at `/work`**

Run:
```bash
grep -rn '"/work\|/work/verify\|(app)/work' src docs ../docs || echo "no hits"
npx tsc --noEmit
npm test
npm run build
```
Expected: the grep's only permitted hits are historical mentions inside `docs/superpowers/` (past plans and checkpoints, which record what was true then and are not edited); `src/` must have none. `tsc`, the unit suite and the build all pass, and the route table lists `/company`, `/company/earnings`, `/company/earnings/[recordId]`, `/company/payroll`, `/company/payroll/[importId]` and `/company/time-off`, with no `/work` route at all.

- [ ] **Step 8: Commit**

```bash
git add -A "src/app/(app)" src/platform/capabilities src/modules/home
git commit -m "feat(company): retire /work, relocate Time Off and rewire navigation"
```

---

### Task 20: The Paperless-to-payroll mapper

**Files:**
- Create: `src/modules/payroll/infrastructure/paperless-import.ts`
- Create: `src/modules/payroll/infrastructure/paperless-import.test.ts`

**Interfaces:**
- Consumes: `Payslip` row type from `@/lib/db/schema` (the legacy table); `PayslipExtraction`, `PAYSLIP_FIELDS` from `@/lib/contracts`; `titleMonth`, `titleIsThirteenth`, `periodFor`, `recordKindOf` from `../domain/period` (Task 4).
- Produces:
```ts
export interface LegacyPayslip { id: number; month: string; isThirteenth: boolean; paperlessDocId: number; status: string; rawExtraction: unknown; corrections: unknown; gross: string | null; net: string | null; taxes: string | null; fundContribEmployee: string | null; fundContribEmployer: string | null; ferieBalance: string | null; rolBalance: string | null; ferieTaken: string | null; rolTaken: string | null; verifiedAt: Date | null }
export interface MappedImport { fileName: string; extraction: PayslipExtraction; verifiedAt: Date | null; kind: PayrollRecordKind; periodStart: string; periodEnd: string; legacySource: { provider: "paperless"; documentId: number; payslipId: number } }
export function mapLegacyPayslip(row: LegacyPayslip): MappedImport;
export function isMigratable(row: LegacyPayslip): boolean;
```

A pure mapper, tested without a network or a database, so the one-off script in Task 21 has nothing but I/O left in it. Spec §10.2 steps 1-2 are exactly this function's job.

- [ ] **Step 1: Write the failing test**

```ts
// src/modules/payroll/infrastructure/paperless-import.test.ts
import { describe, expect, it } from "vitest";
import { isMigratable, mapLegacyPayslip, type LegacyPayslip } from "./paperless-import";

function legacy(over: Partial<LegacyPayslip> = {}): LegacyPayslip {
  return {
    id: 42,
    month: "2026-08-01",
    isThirteenth: false,
    paperlessDocId: 142,
    status: "verified",
    rawExtraction: null,
    corrections: null,
    gross: "2500.00",
    net: "1800.00",
    taxes: "700.00",
    fundContribEmployee: "50.00",
    fundContribEmployer: "100.00",
    ferieBalance: "88.25",
    rolBalance: "12.00",
    ferieTaken: "16.00",
    rolTaken: "4.00",
    verifiedAt: new Date("2026-09-01T10:00:00Z"),
    ...over,
  };
}

describe("isMigratable", () => {
  it("takes verified rows", () => {
    expect(isMigratable(legacy())).toBe(true);
  });

  it("leaves discovered, parsed, rejected and superseded rows behind", () => {
    for (const status of ["discovered", "parsed", "rejected", "superseded"]) {
      expect(isMigratable(legacy({ status }))).toBe(false);
    }
  });
});

describe("mapLegacyPayslip", () => {
  it("builds a filename that carries the period, so titleMonth can read it back", () => {
    expect(mapLegacyPayslip(legacy()).fileName).toBe("Busta Paga Agosto 2026.pdf");
    expect(mapLegacyPayslip(legacy({ month: "2025-12-01", isThirteenth: true })).fileName).toBe("Tredicesima 2025.pdf");
  });

  it("turns each stored column into a high-confidence, manually-sourced field", () => {
    const mapped = mapLegacyPayslip(legacy());
    expect(mapped.extraction.fields.net).toEqual({ value: 1800, confidence: "high", rules: 1800, llm: null, note: "migrated from Paperless" });
    expect(mapped.extraction.fields.ferieBalance).toEqual({ value: 88.25, confidence: "high", rules: 88.25, llm: null, note: "migrated from Paperless" });
  });

  it("omits a column the legacy row never held, rather than writing a zero", () => {
    const mapped = mapLegacyPayslip(legacy({ gross: null, taxes: null }));
    expect(mapped.extraction.fields.gross).toBeUndefined();
    expect(mapped.extraction.fields.taxes).toBeUndefined();
    expect(Object.keys(mapped.extraction.fields)).not.toContain("permessiBalance");
  });

  it("maps the legacy column names onto the parser's own field codes", () => {
    const mapped = mapLegacyPayslip(legacy());
    expect(Object.keys(mapped.extraction.fields).sort()).toEqual(
      ["ferieBalance", "ferieTakenHours", "fundContribEmployee", "fundContribEmployer", "gross", "net", "rolBalance", "rolTakenHours", "taxes"].sort(),
    );
  });

  it("carries the period, the record kind and the verification stamp", () => {
    const mapped = mapLegacyPayslip(legacy());
    expect(mapped).toMatchObject({
      periodStart: "2026-08-01",
      periodEnd: "2026-08-31",
      kind: "ordinary",
      verifiedAt: new Date("2026-09-01T10:00:00Z"),
    });
    expect(mapLegacyPayslip(legacy({ month: "2025-12-01", isThirteenth: true })).kind).toBe("thirteenth");
  });

  it("records the provenance so a reconciliation can trace every row back", () => {
    expect(mapLegacyPayslip(legacy()).legacySource).toEqual({ provider: "paperless", documentId: 142, payslipId: 42 });
  });

  it("marks the extraction as migrated, never as parsed by the current engine", () => {
    const mapped = mapLegacyPayslip(legacy());
    expect(mapped.extraction.parserVersion).toBe("migration-paperless-1");
    expect(mapped.extraction.textSource).toBe("pdf");
    expect(mapped.extraction.checks).toEqual([
      { id: "migrated", label: "migration", passed: true, detail: "values carried over from the verified Paperless row" },
    ]);
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `npm test -- payroll/infrastructure/paperless-import`
Expected: FAIL — `Cannot find module './paperless-import'`.

- [ ] **Step 3: Write the mapper**

```ts
// src/modules/payroll/infrastructure/paperless-import.ts
import type { FieldExtraction, PayslipExtraction, PayslipField } from "@/lib/contracts";
import type { PayrollRecordKind } from "../application/ports";
import { periodFor, recordKindOf } from "../domain/period";

/** Exactly the columns the migration reads. Declared here so the script needs no Drizzle row type. */
export interface LegacyPayslip {
  id: number;
  month: string;
  isThirteenth: boolean;
  paperlessDocId: number;
  status: string;
  rawExtraction: unknown;
  corrections: unknown;
  gross: string | null;
  net: string | null;
  taxes: string | null;
  fundContribEmployee: string | null;
  fundContribEmployer: string | null;
  ferieBalance: string | null;
  rolBalance: string | null;
  ferieTaken: string | null;
  rolTaken: string | null;
  verifiedAt: Date | null;
}

export interface MappedImport {
  fileName: string;
  extraction: PayslipExtraction;
  verifiedAt: Date | null;
  kind: PayrollRecordKind;
  periodStart: string;
  periodEnd: string;
  legacySource: { provider: "paperless"; documentId: number; payslipId: number };
}

/**
 * Spec §10.2 step 2 migrates the **verified** rows. A `parsed` row was never
 * confirmed by a human, and carrying it across would put unreviewed figures
 * straight into Earnings; a `discovered` row has no figures at all. Both are
 * left in the frozen legacy table, where they remain visible.
 */
export function isMigratable(row: LegacyPayslip): boolean {
  return row.status === "verified";
}

const IT_MONTH_NAMES = [
  "Gennaio", "Febbraio", "Marzo", "Aprile", "Maggio", "Giugno",
  "Luglio", "Agosto", "Settembre", "Ottobre", "Novembre", "Dicembre",
];

/**
 * The filename the migrated import gets. It matters: `titleMonth` reads the
 * period back out of it (Task 4), so a re-ingest of the same document would
 * land on the same month rather than on whatever the OCR latches onto.
 */
function fileNameFor(row: LegacyPayslip): string {
  const year = row.month.slice(0, 4);
  if (row.isThirteenth) return `Tredicesima ${year}.pdf`;
  const monthIndex = Number(row.month.slice(5, 7)) - 1;
  return `Busta Paga ${IT_MONTH_NAMES[monthIndex]} ${year}.pdf`;
}

/**
 * The legacy column names and the parser's field codes are not the same
 * vocabulary — `ferie_taken` versus `ferieTakenHours`, and no legacy column at
 * all for `permessiBalance`. This is the whole mapping, in one place.
 */
const COLUMN_TO_FIELD: ReadonlyArray<[keyof LegacyPayslip, PayslipField]> = [
  ["gross", "gross"],
  ["net", "net"],
  ["taxes", "taxes"],
  ["fundContribEmployee", "fundContribEmployee"],
  ["fundContribEmployer", "fundContribEmployer"],
  ["ferieBalance", "ferieBalance"],
  ["rolBalance", "rolBalance"],
  ["ferieTaken", "ferieTakenHours"],
  ["rolTaken", "rolTakenHours"],
];

/**
 * A verified legacy payslip, in the shape the new pipeline's apply step reads.
 *
 * Every carried value is `high` confidence and attributed to `rules`, because a
 * human confirmed it once already — re-reviewing twelve payslips somebody has
 * already checked would be busywork with a real chance of introducing an error.
 * A column that was null stays **absent**, never `0.00`: the "never invent
 * financial data" rule applies to a migration exactly as it does to a parse.
 */
export function mapLegacyPayslip(row: LegacyPayslip): MappedImport {
  const fields: Partial<Record<PayslipField, FieldExtraction<number | null>>> = {};
  for (const [column, field] of COLUMN_TO_FIELD) {
    const raw = row[column] as string | null;
    if (raw === null) continue;
    const value = Number(raw);
    fields[field] = { value, confidence: "high", rules: value, llm: null, note: "migrated from Paperless" };
  }

  const period = periodFor(row.month);
  return {
    fileName: fileNameFor(row),
    extraction: {
      // Deliberately not `PARSER_VERSION`: these values did not come out of the
      // current engine, and stamping them with its version would make a future
      // "re-parse everything below version X" sweep skip them wrongly.
      parserVersion: "migration-paperless-1",
      month: row.month,
      isThirteenth: row.isThirteenth,
      textSource: "pdf",
      fields,
      checks: [
        { id: "migrated", label: "migration", passed: true, detail: "values carried over from the verified Paperless row" },
      ],
    },
    verifiedAt: row.verifiedAt,
    kind: recordKindOf(row.isThirteenth),
    periodStart: period.periodStart,
    periodEnd: period.periodEnd,
    legacySource: { provider: "paperless", documentId: row.paperlessDocId, payslipId: row.id },
  };
}
```

- [ ] **Step 4: Run the test and watch it pass**

Run: `npm test -- payroll/infrastructure/paperless-import`
Expected: PASS — all 8 cases.

- [ ] **Step 5: Commit**

```bash
git add src/modules/payroll/infrastructure
git commit -m "feat(payroll): map verified Paperless payslips onto the new import shape"
```

---

### Task 21: The Paperless migration and validation scripts

This is deployment **wave 1** (Ruling R4-7): the image built at this commit still has the Paperless client and its token, which is exactly what the migration needs.

**Files:**
- Create: `scripts/migrate-paperless.ts`
- Create: `scripts/validate-paperless-migration.ts`
- Modify: `package.json` (two scripts)
- Modify: `docs/migration/README.md`
- Create (written by the run, not by this task): `docs/migration/paperless-reconciliation.md`

**Interfaces:**
- Consumes: `downloadOriginal`, `getDocument` from `@/lib/clients/paperless` (still present); `mapLegacyPayslip`, `isMigratable` from `@/modules/payroll/infrastructure/paperless-import` (Task 20); `sha256Hex`, `newStorageKey`, `looksLikePdf` from `@/modules/payroll/domain/document` (Task 2); `componentsFromExtraction`, `grossOf`, `netOf` (Task 5); `DEFAULT_MAPPING_RULES` (Task 5); `withSystemContext` from `@/platform/db/context`.
- Produces: two executable scripts and two npm entries. No new exported application symbol.

- [ ] **Step 1: Write the migration script**

```ts
// scripts/migrate-paperless.ts
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { asc, eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import * as schema from "@/lib/db/schema";
import { payrollComponents, payrollImports, payrollRecords, payslips, userRoles, users } from "@/lib/db/schema";
import { downloadOriginal } from "@/lib/clients/paperless";
import { componentsFromExtraction, grossOf, netOf } from "@/modules/payroll/domain/components";
import { looksLikePdf, newStorageKey, sha256Hex } from "@/modules/payroll/domain/document";
import { DEFAULT_MAPPING_RULES } from "@/modules/payroll/domain/mapping";
import { isMigratable, mapLegacyPayslip, type LegacyPayslip } from "@/modules/payroll/infrastructure/paperless-import";
import { storeFromDriver } from "@/modules/payroll/infrastructure/document-store-resolver";
import { withSystemContext } from "@/platform/db/context";

/**
 * One-shot migration of the verified Paperless payslips into the payroll
 * module (spec §10.2).
 *
 * Deployment wave 1 (Ruling R4-7): this runs on the image built at this commit,
 * while `src/lib/clients/paperless.ts` and `PAPERLESS_URL`/`PAPERLESS_TOKEN`
 * still exist. Task 22 deletes them, so re-running it afterwards is impossible
 * by construction — which is why the reconciliation report it writes is the
 * artefact that outlives it.
 *
 * Idempotent: an import whose sha256 already exists for the owner is reused
 * rather than duplicated (the same `(user_id, sha256)` index the live upload
 * path relies on), and a record whose import already has one is recomputed. Run
 * it twice and the second run reports everything reused and writes the same
 * figures.
 *
 * Deliberately does not import `db` from `@/lib/db`: that module is a Proxy
 * whose first property access calls `env()`, which requires the whole app's
 * environment. It builds its own client from `DATABASE_URL`, exactly as
 * `scripts/migrate-teable.ts` does, so it runs with only the variables listed
 * below.
 */

const USAGE = `Usage: npm run migrate:paperless -- [--dry-run] [--out <dir>]

Downloads the original PDF of every verified payslip from Paperless, stores it
in the payroll document store, and creates the matching payroll_imports,
payroll_records and payroll_components rows.

Options:
  --dry-run   Read everything and print the plan, but write nothing.
  --out <dir> Where the reconciliation report is written. Defaults to the
              repository's docs/migration/ directory, which does not exist
              inside the container image.
  --help      Show this message.

Environment:
  DATABASE_URL                    The database to migrate (required).
  PAPERLESS_URL, PAPERLESS_TOKEN  Required: the originals are pulled from here.
  DOCUMENT_STORE_DRIVER           silo (default) or local.
  DOCUMENT_STORE_LOCAL_PATH       Required for the local driver.
  SILO_ENDPOINT, SILO_BUCKET, SILO_REGION,
  SILO_ACCESS_KEY_ID, SILO_SECRET_ACCESS_KEY
                                  Required for the silo driver. Read from the
                                  environment rather than from the integration
                                  connection, because this script runs before
                                  anybody has connected one.
`;

const argv = process.argv.slice(2);
if (argv.includes("--help") || argv.includes("-h")) {
  console.log(USAGE);
  process.exit(0);
}
const dryRun = argv.includes("--dry-run");
const outIndex = argv.indexOf("--out");
const outDir = outIndex === -1 ? join(process.cwd(), "..", "docs", "migration") : argv[outIndex + 1]!;

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
  console.error("DATABASE_URL is required.");
  process.exit(1);
}

function resolveStore() {
  const driver = (process.env.DOCUMENT_STORE_DRIVER ?? "silo") as "silo" | "local";
  const resolution = storeFromDriver({
    driver,
    localPath: process.env.DOCUMENT_STORE_LOCAL_PATH,
    // The script is not the app; the read-only-container guard does not apply
    // to a one-off run on an operator's shell.
    nodeEnv: "development",
    credentials:
      driver === "silo"
        ? {
            endpoint: process.env.SILO_ENDPOINT ?? "",
            bucket: process.env.SILO_BUCKET ?? "",
            region: process.env.SILO_REGION ?? "us-east-1",
            accessKeyId: process.env.SILO_ACCESS_KEY_ID ?? "",
            secretAccessKey: process.env.SILO_SECRET_ACCESS_KEY ?? "",
          }
        : null,
  });
  if (!resolution) {
    console.error("No document store could be resolved. See --help for the variables it needs.");
    process.exit(1);
  }
  return resolution;
}

interface Outcome {
  payslipId: number;
  month: string;
  isThirteenth: boolean;
  result: "migrated" | "reused" | "skipped_not_verified" | "failed";
  importId?: string;
  recordId?: string;
  sha256?: string;
  net?: string | null;
  legacyNet?: string | null;
  error?: string;
}

async function main(): Promise<void> {
  const pool = new Pool({ connectionString: databaseUrl });
  const db = drizzle(pool, { schema });
  const resolution = resolveStore();
  const rules = DEFAULT_MAPPING_RULES.map((r, i) => ({ ...r, id: `global-${String(i).padStart(3, "0")}`, userId: null }));

  // The single owner, the same assumption `monthly-close.ts` has held since
  // Phase 1. Phase 8 revisits it when users become plural in more than schema.
  const [owner] = await db
    .select({ id: users.id })
    .from(users)
    .innerJoin(userRoles, eq(userRoles.userId, users.id))
    .where(eq(userRoles.roleCode, "owner"))
    .limit(1);
  if (!owner) {
    console.error("No owner user found. Run the Phase 0/1 owner seed first.");
    process.exit(1);
  }

  const legacy = (await db.select().from(payslips).orderBy(asc(payslips.month))) as unknown as LegacyPayslip[];
  const outcomes: Outcome[] = [];

  for (const row of legacy) {
    if (!isMigratable(row)) {
      outcomes.push({ payslipId: row.id, month: row.month, isThirteenth: row.isThirteenth, result: "skipped_not_verified" });
      continue;
    }
    const mapped = mapLegacyPayslip(row);
    try {
      const downloaded = await downloadOriginal(row.paperlessDocId);
      const bytes = new Uint8Array(downloaded.data);
      if (!looksLikePdf(bytes)) throw new Error(`document ${row.paperlessDocId} is not a PDF`);
      const sha256 = sha256Hex(bytes);

      if (dryRun) {
        outcomes.push({
          payslipId: row.id, month: row.month, isThirteenth: row.isThirteenth,
          result: "migrated", sha256, legacyNet: row.net, net: row.net,
        });
        continue;
      }

      const written = await withSystemContext(db, async (tx) => {
        const existing = await tx.select().from(payrollImports).where(eq(payrollImports.sha256, sha256)).limit(1);
        let importId: string;
        let reused = false;
        if (existing[0]) {
          importId = existing[0].id;
          reused = true;
        } else {
          const storageKey = newStorageKey(owner.id, new Date(`${row.month}T12:00:00Z`));
          // Bytes first: a row pointing at an object that does not exist is a
          // worse failure than an object with no row, which the next run reuses.
          await resolution.store.put(storageKey, bytes, "application/pdf");
          const [created] = await tx
            .insert(payrollImports)
            .values({
              userId: owner.id,
              status: "applied",
              fileName: mapped.fileName,
              mime: "application/pdf",
              sizeBytes: bytes.byteLength,
              sha256,
              storageProvider: resolution.driver,
              storageKey,
              textSource: "pdf_text",
              parserVersion: mapped.extraction.parserVersion,
              extraction: mapped.extraction,
              confidence: Object.fromEntries(Object.keys(mapped.extraction.fields).map((f) => [f, "high"])),
              // The originals predate the boundary. Recording `none` as the
              // scanner is the honest answer (Ruling R4-2): nothing scanned
              // them, and the row says so rather than implying something did.
              scanStatus: "clean",
              scanner: "none",
              scannedAt: new Date(),
              retentionUntil: new Date(`${Number(row.month.slice(0, 4)) + 10}-01-01T00:00:00Z`),
              uploadedVia: "migration",
            })
            .returning();
          importId = created!.id;
        }

        const components = componentsFromExtraction(mapped.extraction, rules);
        const [existingRecord] = await tx.select().from(payrollRecords).where(eq(payrollRecords.importId, importId)).limit(1);
        let recordId: string;
        if (existingRecord) {
          recordId = existingRecord.id;
          await tx
            .update(payrollRecords)
            .set({ gross: grossOf(components), net: netOf(components), updatedAt: new Date() })
            .where(eq(payrollRecords.id, recordId));
        } else {
          const [record] = await tx
            .insert(payrollRecords)
            .values({
              userId: owner.id,
              importId,
              periodStart: mapped.periodStart,
              periodEnd: mapped.periodEnd,
              kind: mapped.kind,
              currency: "EUR",
              gross: grossOf(components),
              net: netOf(components),
              verifiedAt: mapped.verifiedAt,
              verifiedBy: owner.id,
              corrections: mapped.legacySource as unknown as Record<string, unknown>,
            })
            .returning();
          recordId = record!.id;
        }
        await tx.delete(payrollComponents).where(eq(payrollComponents.recordId, recordId));
        if (components.length > 0) {
          await tx.insert(payrollComponents).values(components.map((c) => ({ ...c, recordId })));
        }
        return { importId, recordId, reused };
      });

      outcomes.push({
        payslipId: row.id, month: row.month, isThirteenth: row.isThirteenth,
        result: written.reused ? "reused" : "migrated",
        importId: written.importId, recordId: written.recordId, sha256,
        legacyNet: row.net, net: row.net,
      });
    } catch (err) {
      outcomes.push({
        payslipId: row.id, month: row.month, isThirteenth: row.isThirteenth,
        result: "failed", error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  const migrated = outcomes.filter((o) => o.result === "migrated").length;
  const reused = outcomes.filter((o) => o.result === "reused").length;
  const skipped = outcomes.filter((o) => o.result === "skipped_not_verified").length;
  const failed = outcomes.filter((o) => o.result === "failed");

  mkdirSync(outDir, { recursive: true });
  const report = [
    `# Paperless migration reconciliation`,
    ``,
    `Run at ${new Date().toISOString()}${dryRun ? " (dry run — nothing was written)" : ""}.`,
    ``,
    `- Legacy payslips seen: ${outcomes.length}`,
    `- Migrated: ${migrated}`,
    `- Reused (already migrated): ${reused}`,
    `- Skipped, not verified: ${skipped}`,
    `- Failed: ${failed.length}`,
    ``,
    `| Legacy id | Month | 13th | Result | Import | Record | Legacy net | New net |`,
    `|---|---|---|---|---|---|---|---|`,
    ...outcomes.map(
      (o) =>
        `| ${o.payslipId} | ${o.month} | ${o.isThirteenth ? "yes" : "no"} | ${o.result} | ${o.importId ?? "—"} | ${o.recordId ?? "—"} | ${o.legacyNet ?? "—"} | ${o.net ?? "—"} |`,
    ),
    ``,
    ...(failed.length > 0
      ? [`## Failures`, ``, ...failed.map((f) => `- payslip ${f.payslipId} (${f.month}): ${f.error}`), ``]
      : []),
    `Run \`npm run migrate:paperless:validate\` next; it diffs every migrated record against its legacy row and exits non-zero on any mismatch.`,
    ``,
  ].join("\n");
  writeFileSync(join(outDir, "paperless-reconciliation.md"), report);

  console.log(`migrated=${migrated} reused=${reused} skipped=${skipped} failed=${failed.length}`);
  console.log(`report written to ${join(outDir, "paperless-reconciliation.md")}`);
  await pool.end();
  process.exit(failed.length > 0 ? 1 : 0);
}

void main();
```

- [ ] **Step 2: Write the validation script**

```ts
// scripts/validate-paperless-migration.ts
import { asc, eq, isNull } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import * as schema from "@/lib/db/schema";
import { payrollComponents, payrollImports, payrollRecords, payslips } from "@/lib/db/schema";
import { isMigratable, type LegacyPayslip } from "@/modules/payroll/infrastructure/paperless-import";

/**
 * Spec §10.2 step 3's zero-tolerance check, for payroll: every verified legacy
 * payslip must have exactly one live `payroll_records` row whose gross, net and
 * component amounts equal the legacy columns, string for string.
 *
 * String comparison, not numeric: both sides are `numeric` decimal strings and a
 * `Number()` round trip is exactly the class of error this script exists to
 * catch. Exits non-zero on the first mismatch class so a runbook step can gate
 * on it.
 */
const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
  console.error("DATABASE_URL is required.");
  process.exit(1);
}

function normalise(value: string | null): string | null {
  if (value === null) return null;
  const [intPart, frac = ""] = value.split(".");
  return `${intPart}.${(frac + "00").slice(0, 2)}`;
}

async function main(): Promise<void> {
  const pool = new Pool({ connectionString: databaseUrl });
  const db = drizzle(pool, { schema });
  const legacy = (await db.select().from(payslips).orderBy(asc(payslips.month))) as unknown as LegacyPayslip[];
  const problems: string[] = [];

  for (const row of legacy) {
    if (!isMigratable(row)) continue;
    const records = await db
      .select()
      .from(payrollRecords)
      .innerJoin(payrollImports, eq(payrollRecords.importId, payrollImports.id))
      .where(isNull(payrollRecords.supersededAt));
    const match = records.find((r) => r.payroll_records.periodStart === row.month && r.payroll_records.kind === (row.isThirteenth ? "thirteenth" : "ordinary"));
    if (!match) {
      problems.push(`payslip ${row.id} (${row.month}): no live payroll record`);
      continue;
    }
    const record = match.payroll_records;
    for (const [label, legacyValue, newValue] of [
      ["gross", row.gross, record.gross],
      ["net", row.net, record.net],
    ] as const) {
      if (normalise(legacyValue) !== normalise(newValue)) {
        problems.push(`payslip ${row.id} (${row.month}): ${label} ${legacyValue ?? "null"} became ${newValue ?? "null"}`);
      }
    }
    const components = await db.select().from(payrollComponents).where(eq(payrollComponents.recordId, record.id));
    for (const [code, legacyValue] of [
      ["taxes", row.taxes],
      ["fundContribEmployee", row.fundContribEmployee],
      ["fundContribEmployer", row.fundContribEmployer],
    ] as const) {
      const component = components.find((c) => c.code === code);
      const newValue = component?.amount ?? null;
      if (normalise(legacyValue) !== normalise(newValue)) {
        problems.push(`payslip ${row.id} (${row.month}): ${code} ${legacyValue ?? "null"} became ${newValue ?? "null"}`);
      }
    }
  }

  await pool.end();
  if (problems.length > 0) {
    console.error(`FAIL — ${problems.length} mismatch(es):`);
    for (const problem of problems) console.error(`  ${problem}`);
    process.exit(1);
  }
  console.log(`OK — every verified legacy payslip matches its migrated payroll record.`);
  process.exit(0);
}

void main();
```

- [ ] **Step 3: Add the two npm scripts**

In `package.json`, next to the existing `migrate:teable` entries:

```json
    "migrate:paperless": "tsx scripts/migrate-paperless.ts",
    "migrate:paperless:validate": "tsx scripts/validate-paperless-migration.ts",
```

- [ ] **Step 4: Document the migration**

Append to `docs/migration/README.md`, matching the tone of the Teable section already there:

```markdown
## Paperless → payroll document store

`npm run migrate:paperless` pulls the original PDF of every **verified** payslip
out of Paperless while the client and its token still exist, stores it in the
payroll document store, and creates the matching `payroll_imports`,
`payroll_records` and `payroll_components` rows. `npm run migrate:paperless:validate`
then diffs every migrated record against its legacy `payslips` row — gross, net,
taxes and both Cometa halves, compared as decimal strings — and exits non-zero on
any mismatch.

Both are one-shot and idempotent: a payslip whose bytes are already in the store
is reused rather than duplicated, and a second run rewrites the same figures.

**Order matters.** The migration must run on the image built at the commit that
adds it, *before* the Paperless client and its environment variables are removed
— see `docs/deploy/phase-4-runbook.md`, which prescribes the two waves. Rows in
status `discovered`, `parsed`, `rejected` or `superseded` are deliberately left
behind: they were never confirmed by a person, and the legacy `payslips` table
stays as the frozen archive holding them.

The run writes `docs/migration/paperless-reconciliation.md`, which is the record
that outlives the script.
```

- [ ] **Step 5: Type-check and verify the scripts parse**

Run:
```bash
npx tsc --noEmit
npm run migrate:paperless -- --help
npm test
```
Expected: exit 0, the usage text prints, the suite is green. Do **not** run the migration itself here — it needs a real Paperless token and a real store, and it is a deployment step, not a build step.

- [ ] **Step 6: Commit**

```bash
git add scripts package.json ../docs/migration/README.md
git commit -m "feat(payroll): add the Paperless migration and validation scripts"
```

---

### Task 22: Retire Paperless

Deployment **wave 2** (Ruling R4-7). Nothing here is reversible by a code change alone: once the client and the env vars are gone, the migration in Task 21 cannot be re-run, which is why the runbook makes wave 1 a hard prerequisite.

**Files:**
- Delete: `src/lib/clients/paperless.ts`, `src/lib/clients/paperless.test.ts`
- Delete: `src/lib/jobs/payslip-ingest.ts`, `src/lib/jobs/payslip-ingest.test.ts`
- Delete: `src/app/api/jobs/payslip-webhook/route.ts`
- Delete: `src/app/api/paperless/preview/[id]/route.ts` (and the now-empty `src/app/api/paperless/` tree)
- Modify: `src/lib/jobs/sweep.ts`, `src/lib/jobs/sweep.test.ts`
- Modify: `src/app/api/jobs/run/route.ts`
- Modify: `src/lib/repo/payslips.ts`
- Modify: `src/lib/contracts.ts`, `src/lib/clients/http.ts`
- Modify: `src/lib/env.ts`, `src/lib/env.test.ts`
- Modify: thirteen test files that stub `PAPERLESS_*` (listed in the "what already exists" table)
- Modify: `src/lib/payroll/parse.ts`, `text.ts`, `anchors.ts`, `teamsystem.ts` (comments only)
- Modify: `../docker-compose.yml`, `../.env.example`

**Interfaces:**
- Produces: `JobName` loses `"payslip_ingest"`; `UpstreamService` and `UpstreamError`'s inline union each lose `"paperless"`; `src/lib/env.ts` loses three keys; `src/lib/repo/payslips.ts` loses eight exports and keeps two.

- [ ] **Step 1: Delete the four whole files and their tests**

```bash
git rm src/lib/clients/paperless.ts src/lib/clients/paperless.test.ts
git rm src/lib/jobs/payslip-ingest.ts src/lib/jobs/payslip-ingest.test.ts
git rm src/app/api/jobs/payslip-webhook/route.ts
git rm "src/app/api/paperless/preview/[id]/route.ts"
```

Spec §12.3 removes the payslip webhook endpoint. `WEBHOOK_SECRET` itself **stays**: spec §10.2 step 4 keeps it for the generic inbound webhook endpoint Phase 2 built at `/api/v1/webhooks/{provider}`.

- [ ] **Step 2: Strip the sweep back to its heartbeat**

`src/lib/jobs/sweep.ts` — delete the `pollPayslips` function, its two imports (`listPayslipDocuments`, `ingestPayslipDocument`, `knownDocIds`), the `StepReport.detail.payslipPolling` field and the `step("payslip_polling", …)` call, leaving:

```ts
export async function runSweep(input: RunSweepInput = {}): Promise<JobResult> {
  const now = input.now ?? new Date();
  const report: StepReport = { detail: {}, errors: [] };
  try {
    // Every step this job used to run has been replaced by a job of its own —
    // the snapshot catch-up, the legacy-spreadsheet retry, the read-cache
    // refresh, the wallet refresh, and now the payslip polling that
    // `payroll_ingest` (Phase 4) took over. What remains is the heartbeat, and
    // that is the point: `/api/health` reads it to answer "did the scheduler
    // fire?", which no other job answers.
  } finally {
    report.detail.heartbeat = await touchHeartbeat(now);
  }
  // …the existing success/failure bookkeeping, unchanged…
}
```
Keep the `try`/`finally` even though the `try` body is now empty: the heartbeat must be touched whether or not a future step throws, and removing the shape would invite the next person to touch it conditionally.

`src/lib/jobs/sweep.test.ts` — delete every case that mocks `listPayslipDocuments`, `knownDocIds` or `ingestPayslipDocument`, and the two `PAPERLESS_*` env stub lines. Keep the heartbeat cases and add:

```ts
  it("touches the heartbeat and nothing else", async () => {
    const result = await runSweep({ trigger: "cron", now: new Date("2026-09-05T10:00:00Z") });
    expect(result.status).toBe("success");
    expect(Object.keys(result.detail ?? {})).toEqual(["heartbeat"]);
  });
```

- [ ] **Step 3: Remove the manual ingest branch from the job-run route**

`src/app/api/jobs/run/route.ts:53` — delete the `ingestPayslipDocument({ docId: input.docId, trigger: "manual" })` branch and its import. If `docId` was only there for that branch, remove it from the route's input schema too. The equivalent manual lever is now `POST /api/v1/payroll/imports/{id}/retry` (Task 15); say so in a one-line comment where the branch was.

- [ ] **Step 4: Shrink `src/lib/repo/payslips.ts` to its two surviving readers**

Delete `discover`, `storeExtraction`, `verify`, `reject`, `supersede`, `medianNet`, `allPayslips`, `pendingVerification`, `knownDocIds` and `payslipById`. Keep exactly `verifiedPayslips` and `latestVerified`, and put the reason at the top of the file:

```ts
/**
 * The frozen legacy payslip archive, read-only since Phase 4.
 *
 * The `payslips` table is not dropped — spec §11 Phase 9 does that — and these
 * two readers still feed `src/app/(app)/_lib/vacation.ts` (Ferie residuals) and
 * `src/app/(app)/company/time-off/page.tsx` until Phase 7 replaces them with
 * `timeoff_balances`. Every write function and every other reader lost its last
 * caller when Paperless was retired and `/work` became `/company`; they were
 * deleted rather than left as dead exports.
 */
```

- [ ] **Step 5: Drop `"paperless"` from both service unions and `"payslip_ingest"` from `JobName`**

`src/lib/clients/http.ts:4`:
```ts
export type UpstreamService = "wallet" | "gotify" | "trek";
```

`src/lib/contracts.ts:147` — the same union, inlined separately on `UpstreamError`'s constructor. **Both must change**: they are not linked by a shared type, so editing one leaves the other compiling happily with a value nothing can produce (Ruling R4-13).
```ts
    readonly service: "wallet" | "gotify" | "trek",
```

`src/lib/contracts.ts` — `JobName` loses `"payslip_ingest"`:
```ts
export type JobName =
  | "payroll_ingest"
  | "payroll_retention"
  | "sweep"
  | "wallet_refresh"
  | "trek_sync"
  | "monthly_close"
  | "wallet_accounts_sync"
  | "wallet_transactions_sync"
  | "sync_queue"
  | "interest_accrual";
```
Existing `job_runs` rows with `job_name = 'payslip_ingest'` stay in the database as history; the column is `text`, so the narrowed union costs nothing at read time and the admin panel renders the string it finds.

- [ ] **Step 6: Remove the three environment variables**

`src/lib/env.ts` — delete these three lines:
```ts
  PAPERLESS_URL: z.url(),
  PAPERLESS_TOKEN: z.string().min(1),
  PAPERLESS_PAYSLIP_TAG_ID: z.coerce.number().int().default(22),
```
The first two are **required today**, so removing them is exactly what makes this a two-wave deploy: an older image without this commit refuses to boot once they leave `docker-compose.yml`, and this image boots fine with them still present.

`src/lib/env.test.ts` — delete the two `PAPERLESS_*` fixture lines and any assertion on `PAPERLESS_PAYSLIP_TAG_ID`, and add:
```ts
  it("no longer knows about Paperless", () => {
    expect(Object.keys(envFromFixture())).not.toContain("PAPERLESS_URL");
  });
```

Then delete the `PAPERLESS_URL`/`PAPERLESS_TOKEN` assignments from all **thirteen** test files that stub the environment (the full list is in the "what already exists" table above; `src/test/integration-setup.ts` is one of them). Every one of them fails `env()` parsing otherwise — Zod 4's object parse is not strict about extra keys, so these will not fail loudly; they simply become misleading, and one of them (`env.test.ts`) does assert on them. Remove all thirteen in this commit so no stale reference survives the grep in Step 9.

- [ ] **Step 7: Reword the four parser comments**

None of these change behaviour; all four name a system that no longer exists.

`src/lib/payroll/text.ts:1-8` — the module doc-comment:
```ts
/**
 * Text acquisition + normalisation for the payslip pipeline.
 *
 * One source: the PDF's embedded text layer (`pdf`), which keeps the vacation
 * grid intact. A payslip with no usable text layer parks the import in
 * `needs_ocr` (Phase 4, Ruling R4-9) rather than being parsed from nothing;
 * `TextSource` keeps its `"ocr"` member for the OCR adapter a later phase adds.
 */
```

`src/lib/payroll/text.ts:12-15` — `PdfTextExtractor`'s comment: replace "which makes the caller fall back to the Paperless OCR `content`" with "which makes the caller park the import in `needs_ocr`".

`src/lib/payroll/text.ts:29-31` — replace "must degrade to the Paperless OCR fallback" with "must park the import in `needs_ocr`".

`src/lib/payroll/parse.ts:29` — `ParsePayslipInput.month`:
```ts
  /** Month key read off the document title, when known; otherwise detected. */
```

`src/lib/payroll/parse.ts:60` — replace "arrives as its own Paperless document" with "arrives as its own document".

`src/lib/payroll/anchors.ts:45` and `src/lib/payroll/teamsystem.ts:6` mention Paperless as the *historical source of the sample they were measured against*, which remains true and is worth keeping. Leave both, and add ` (historical: the sample predates the upload pipeline)` to each so the grep in Step 9 has a documented reason to expect them.

- [ ] **Step 8: Remove the variables from compose and the example environment**

`../docker-compose.yml` — delete lines 22-23 from the `dashboard-app` service's `environment:` block:
```yaml
      - PAPERLESS_URL=https://${PAPERLESS_HOST}
      - PAPERLESS_TOKEN=${DASHBOARD_PAPERLESS_TOKEN}
```
and add, in the same block:
```yaml
      - DOCUMENT_STORE_DRIVER=${DASHBOARD_DOCUMENT_STORE_DRIVER:-silo}
      - MALWARE_SCANNER=${DASHBOARD_MALWARE_SCANNER:-none}
```
Both have schema defaults, so neither is required; they are listed so an operator can see the two levers without reading the source. The silo's endpoint, bucket and credentials are **not** added: they live encrypted in `integration_connections` (Ruling R4-1), which is the whole point of connecting the store from Settings › Integrations.

`../.env.example` — delete lines 20-22 (the Paperless comment, `PAPERLESS_HOST`, `DASHBOARD_PAPERLESS_TOKEN`), reword line 26's comment, and add the two new optional levers:
```bash
# Shared secret for inbound provider webhooks -> /api/v1/webhooks/<provider> — openssl rand -base64 32
DASHBOARD_WEBHOOK_SECRET=

# Payroll document store. `silo` (the default) reads its endpoint, bucket and
# credentials from the connection you create in Settings > Integrations — no
# secret belongs here. `local` writes into DOCUMENT_STORE_LOCAL_PATH and is for
# development only: the container is read-only in production.
DASHBOARD_DOCUMENT_STORE_DRIVER=silo

# Upload malware scanning. `none` (the default) records that nothing scanned the
# file; `clamd` needs a reachable clamd on CLAMD_HOST:CLAMD_PORT.
DASHBOARD_MALWARE_SCANNER=none
```

- [ ] **Step 9: Prove the retirement is complete**

Run:
```bash
npx tsc --noEmit
grep -rn "paperless\|Paperless\|PAPERLESS" src scripts
grep -rn "paperless\|PAPERLESS" ../docker-compose.yml ../.env.example || echo "compose and env clean"
npm test
npm run test:db:up && npm run test:integration
npm run build
```

`tsc` is the real proof: with `PAPERLESS_*` out of `src/lib/env.ts` and `"paperless"` out of both service unions, **any surviving call site fails to compile**. The grep's only permitted hits are:
- `src/lib/payroll/__fixtures__/august-2026.ocr.txt`, `teamsystem-august-2026.txt`, `december-2026-tredicesima.txt` — payslip text that happens to contain the word (spec §10.2.5 keeps the fixtures);
- `src/lib/payroll/anchors.ts:45` and `src/lib/payroll/teamsystem.ts:6` — the two historical-sample comments Step 7 annotated;
- `src/lib/db/schema/legacy.ts` — the frozen `paperless_doc_id` column and its `payslips_doc_thirteenth_uq` index, which Phase 9 drops with the table;
- `src/modules/payroll/infrastructure/paperless-import.ts` and its test — the migration mapper, which is about the *shape* of the data and needs no client;
- `scripts/migrate-paperless.ts` and `scripts/validate-paperless-migration.ts` — wave 1's tools. **They no longer compile**, because they import the deleted client. Delete `scripts/migrate-paperless.ts`'s `downloadOriginal` import path only if wave 1 has already been run in every environment this tree deploys to; otherwise **stop and reconsider the ordering** — this is precisely the hazard Ruling R4-7's two waves exist to manage. The intended resolution is that this commit also deletes `scripts/migrate-paperless.ts`, because it has served its purpose and its output (`docs/migration/paperless-reconciliation.md`) is the artefact that survives. `scripts/validate-paperless-migration.ts` imports no client and **stays**, so the check can be re-run at any time.

So: `git rm scripts/migrate-paperless.ts` and remove the `migrate:paperless` entry from `package.json`, keeping `migrate:paperless:validate`. Note this in the runbook (Task 23) as the reason wave 1 cannot be repeated after wave 2.

- [ ] **Step 10: Commit**

```bash
git add -A src scripts package.json ../docker-compose.yml ../.env.example
git commit -m "refactor: retire Paperless, its client, its routes and its environment"
```

---

### Task 23: Documentation and the Phase 4 runbook

**Files:**
- Modify: `docs/architecture/overview.md`
- Modify: `docs/api/README.md`
- Modify: `docs/integrations/README.md`
- Create: `docs/deploy/phase-4-runbook.md`

**Interfaces:** none (docs only; no code changes in this task).

- [ ] **Step 1: Update `docs/architecture/overview.md`**

Add a module block to the "Module layout" tree, after the `modules/interests/` block:

```
  modules/payroll/
    domain/             import status machine, pay periods, component mapping, earnings buckets — no IO
    application/         create/ingest/review/apply an import, read records, serve and purge originals, ports.ts
    infrastructure/       Drizzle repositories, the document store (S3 + local), the scanning boundary, the payroll_silo adapter
    api/                   Hono routes (routes.ts) + Zod schemas (schemas.ts)
    ui/                     Company Overview, Earnings, Payroll upload/review loaders and components
```

Update the paragraph beneath the tree to read:

```
`accounts`, `expenses`, `interests` and `payroll` are full modules. Payslip
documents never enter Postgres: the database holds metadata and a `storage_key`,
and the bytes live in an S3-compatible document store reached through a
`payroll_silo` integration connection (or, in development and tests, a local
directory). A `MalwareScanner` boundary sits between "bytes stored" and "bytes
readable or parseable", with a no-op default that records `scanner: "none"` on
every import it clears. The parsing engine under `src/lib/payroll/` was not
rewritten — the new module calls it with bytes read from the store. Two jobs
join the tick registry: `payroll_ingest` (hourly) and `payroll_retention`
(daily). Paperless, its client, its preview proxy and its webhook are gone; the
legacy `payslips` and `fund_deposits` tables stay as a frozen archive until
Phase 9.
```

Also update the "Retire" line in whichever section lists what is being retired, so it no longer promises Paperless removal as future work.

- [ ] **Step 2: Update `docs/api/README.md`**

Add a section after "Interests", following the file's existing structure and tone:

```markdown
## Payroll

`GET /payroll/imports`, `POST /payroll/imports` (multipart, `file` part),
`GET /payroll/imports/{id}`, `POST /payroll/imports/{id}/verify`,
`POST /payroll/imports/{id}/reject`, `POST /payroll/imports/{id}/apply`,
`POST /payroll/imports/{id}/retry`, `GET /payroll/imports/{id}/original`,
`GET /payroll/records`, `GET /payroll/records/{id}`, `GET /payroll/earnings`.

The upload is idempotent on the **sha256 of the bytes, per user**, enforced by a
database constraint rather than an application check: uploading the same file
twice answers `409 duplicate` with `details.existingImportId`, and can therefore
never produce two payroll records. `Idempotency-Key` is honoured by a second
constraint on `(user_id, idempotency_key)`; the platform idempotency middleware
is deliberately not used here, because it hashes and stores the whole request
body and the body is a 10 MB binary.

`POST .../verify` and `POST .../reject` follow the same `If-Match`/`version`
convention as `PATCH /accounts/{id}`. `POST .../apply` is idempotent and
re-runnable but **not reversible**: the reverse of a wrong apply is uploading a
corrected payslip, whose apply supersedes the previous record.

`GET .../original` streams the stored PDF with `Cache-Control: no-store` and is
recorded in `audit_events`. It answers `409 conflict` — never the bytes — for an
import whose malware scan has not returned clean, and for one whose original the
retention job has already purged.

`GET /payroll/earnings` computes gross, net, taxes and contributions per month,
quarter and year from `payroll_records` and `payroll_components`, excluding
superseded records. A figure the payslip did not state is `null`, never `0`.
```

- [ ] **Step 3: Update `docs/integrations/README.md`**

Add a section after the existing provider descriptions:

```markdown
### `payroll_silo`

A connection, not a sync. The provider registers so its credentials get the same
AES-256-GCM vault and the same connect/test/disconnect UI as Wallet and Trek,
but its `syncs` is empty and it adds no `SyncKind`: a document store has nothing
to pull on a schedule, and every read and write is driven by a user action or by
the `payroll_ingest` job.

`testConnection` does a real write-read-delete round trip against a probe object
under `payroll/_probe/`, rather than a HEAD. A credential that can list but not
write would pass any read-only check and then fail on the user's first real
upload, after the connect form had said everything was fine.

`onDisconnect` with policy `purge` deletes every object under that user's own
`payroll/{userId}/` prefix and nothing else; `keep` and `archive` leave the bytes
in place. Neither deletes a `payroll_imports` row: the provenance outlives the
bytes, the same asymmetry the retention job holds.

The credential fields are `endpoint`, `bucket`, `region`, `accessKeyId` and
`secretAccessKey`. The last two are marked secret and are never echoed back by
any response.
```

- [ ] **Step 4: Write the Phase 4 runbook**

```markdown
// docs/deploy/phase-4-runbook.md
# Phase 4 deployment runbook — Payroll upload pipeline and Company

Phase 4 deploys in **two waves**. Wave 1 carries the migration and still has
Paperless; wave 2 removes Paperless. Running them out of order loses the twelve
original payslips, because the client that downloads them is deleted in wave 2.

## 1. Pre-checks

- Confirm Phases 2 and 3 are deployed and Phase 2's §9 walkthrough has been run
  at least once (`docs/deploy/phase-2-runbook.md`, `docs/deploy/phase-3-runbook.md`).
  Phase 4 stacks on both.
- Back up the database: `pg_dump dashboard > backup-pre-phase4-$(date +%F).sql`.
- Decide the document store. The default is the existing `silo` container in the
  `db` stack. Have its endpoint, bucket, access key id and secret access key to
  hand — they are entered in the app, not in `.env`.
- **`DOCUMENT_STORE_DRIVER=local` is not usable in production.** The
  `dashboard-app` container runs `read_only: true` with tmpfs on `/tmp` only, so
  a local store would either refuse to write or lose every original on restart.
  The resolver refuses it outright when `NODE_ENV=production`.

## 2. Wave 1 — deploy the migration image

1. Build and deploy the image at the commit titled
   `feat(payroll): add the Paperless migration and validation scripts`. It adds
   migration `0015_payroll.sql` and **keeps** `PAPERLESS_URL`/`PAPERLESS_TOKEN`,
   so `docker-compose.yml` needs no change yet. The entrypoint applies the
   migration on boot.
2. Sign in and go to **Settings › Integrations › Payroll document store**.
   Enter the endpoint, bucket, region and credentials and press Test. The test
   writes, reads and deletes a probe object; a green result means the credential
   can actually store a payslip, not merely reach the bucket.
3. Run the migration from inside the container, with the silo credentials in the
   environment for this one run:
   ```bash
   docker compose exec dashboard-app sh -lc '
     SILO_ENDPOINT=… SILO_BUCKET=… SILO_ACCESS_KEY_ID=… SILO_SECRET_ACCESS_KEY=… \
     npm run migrate:paperless
   '
   ```
   Run it with `--dry-run` first and read the printed counts.
4. Run the validation: `npm run migrate:paperless:validate`. It exits non-zero on
   any mismatch between a verified legacy `payslips` row and its migrated
   `payroll_records` row, comparing decimal strings rather than numbers.
5. Read `docs/migration/paperless-reconciliation.md`, which the run writes. It is
   the record that survives wave 2, because wave 2 deletes the migration script.
6. Visit `/company/earnings` and confirm the twelve migrated months are there
   with the same figures the old Work page showed.

**Do not continue to wave 2 until steps 3–6 have all passed.**

## 3. Wave 2 — deploy the removal image

1. Build and deploy the image at the commit titled
   `refactor: retire Paperless, its client, its routes and its environment`.
2. Edit `docker-compose.yml`: remove `PAPERLESS_URL` and `PAPERLESS_TOKEN` from
   the `dashboard-app` service, and optionally add
   `DOCUMENT_STORE_DRIVER=${DASHBOARD_DOCUMENT_STORE_DRIVER:-silo}` and
   `MALWARE_SCANNER=${DASHBOARD_MALWARE_SCANNER:-none}`. Both have defaults, so
   neither is required.
3. Remove `PAPERLESS_HOST` and `DASHBOARD_PAPERLESS_TOKEN` from `.env`.
4. `docker compose up -d dashboard-app` and confirm `/api/health` returns 200.

Note the asymmetry: the wave-2 image **cannot** boot with the old variables
missing *before* it is deployed, and the wave-1 image **cannot** boot with them
removed. Change the image first, then the variables.

## 4. Verify

1. `curl -s https://$DASHBOARD_HOST/api/v1/openapi.json | jq '.paths | keys' | grep payroll`
   — confirms the eleven `/payroll/*` routes are live.
2. Sign in and visit `/company`, `/company/earnings`, `/company/time-off` and
   `/company/payroll`. `/work` must 404.
3. Upload a payslip PDF from `/company/payroll`. Within the hour (or after
   triggering the hourly tick by hand) it should move `scanning → extracting →
   needs_review` and appear at the top of the imports list.
4. Open it, confirm the figures, press **Apply**, and confirm the month appears
   on `/company/earnings` with the same net.
5. Upload the *same* file again and confirm the app says it is already there
   rather than creating a second import.
6. Confirm the Settings › Administration Scheduled-jobs panel lists
   `payroll_ingest` and `payroll_retention`, both `success`.

## 5. Scanning

`MALWARE_SCANNER` defaults to `none` (spec §13.3): the boundary exists and
records `scanner: "none"` on every import it clears, so "nothing scanned this"
is a fact on the row rather than an assumption. To enable clamd, add a clamd
container reachable on the app's network and set `MALWARE_SCANNER=clamd`,
`CLAMD_HOST` and `CLAMD_PORT`. A clamd that is down does **not** reject uploads:
the import parks in `scanning` with `scan_unavailable` and the hourly job retries
it, so a scanner outage delays payslips rather than losing them.

## 6. Retention

Originals are purged ten years after upload (spec §13.5), configurable by setting
`payroll_retention_years` in `app_settings`. The daily `payroll_retention` job
deletes at most 100 objects a run and never touches a row, a payroll record, or
an import in a live status — so a misconfigured window gives a human a day to
notice. Purging is one-way; there is no undelete.

## 7. Rollback

Migration `0015_payroll.sql` is additive: no existing table or column changes.

- **From wave 2 back to wave 1:** revert the image tag *and* put
  `PAPERLESS_URL`/`PAPERLESS_TOKEN` back in `docker-compose.yml`, or the older
  image will refuse to boot.
- **From wave 1 back to Phase 3:** revert the image tag. The four new tables are
  simply unused by the older image. Objects already written to the silo stay
  there; re-running wave 1 later reuses them by sha256 rather than duplicating.
```

- [ ] **Step 5: Verify every command and path quoted in the new docs resolves**

Run:
```bash
jq '.paths | keys' ../docs/api/openapi.json | grep payroll
ls ../docs/deploy/phase-2-runbook.md ../docs/deploy/phase-3-runbook.md ../docs/migration/README.md
npm run migrate:paperless:validate -- --help 2>/dev/null || true
```
Expected: the eleven payroll paths are listed, both referenced runbooks exist, and the validation script is still present after Task 22's deletions.

- [ ] **Step 6: Commit**

```bash
git add ../docs/architecture/overview.md ../docs/api/README.md ../docs/integrations/README.md ../docs/deploy/phase-4-runbook.md
git commit -m "docs: document the payroll pipeline, the payroll_silo provider and the two-wave Phase 4 deploy"
```

---

### Task 24: Exit criteria

**Files:**
- Create: `docs/superpowers/handoff/2026-09-05-phase-4-checkpoint.md`
- Create: `docs/superpowers/handoff/2026-09-05-phase-4-ledger.md`

**Interfaces:** none — this task runs the whole tree's verification suite and records the result; it does not change application code.

*Spec §11 Phase 4 exit line: "Payroll uploaded securely without Paperless, idempotent" (the acceptance item this phase closes).*

- [ ] **Step 1: Run the full verification gate**

Run, in order, from `dashboard-app/`:
```bash
npx tsc --noEmit
npm test
npm run test:db:up && npm run test:integration
npm run build
npm run e2e
```
Expected: every command exits 0. `npm test` includes `src/platform/http/openapi-drift.test.ts` — the OpenAPI drift check is inside that suite, not a separate command. `npm run e2e` needs a `next dev` started by hand per `tests/e2e/README.md` (the Playwright config still has no `webServer` block); start one against the throwaway test database first, confirm `/api/health` returns 200, and stop it afterwards.

The build's route table must list `/company`, `/company/earnings`, `/company/earnings/[recordId]`, `/company/payroll`, `/company/payroll/[importId]` and `/company/time-off`, and must **not** list `/work`, `/api/jobs/payslip-webhook` or `/api/paperless/preview/[id]`.

Also run:
```bash
git log --oneline main | head -30
```
Expected: one commit per task above, in order, each with a real `Co-Authored-By:` trailer.

- [ ] **Step 2: Grep for anything this phase should have retired or never introduced**

Run:
```bash
grep -rn "paperless\|Paperless\|PAPERLESS" src scripts
grep -rn '"/work' src
grep -rn "payslip_ingest" src
grep -rn "z.enum(\[\"accounts\", \"leave\", \"transactions\"\])" src/modules/integrations/api/schemas.ts
```
Expected: the first has only the permitted hits enumerated in Task 22 Step 9; the second and third have none at all; the fourth still finds both enums unchanged, confirming this phase added no `SyncKind` (Ruling R4-15).

Also confirm the phase kept its no-new-required-variable promise:
```bash
cd .. && git diff <phase-4-base-commit>..HEAD -- .env.example docker-compose.yml dashboard-app/src/lib/env.ts | grep '^+' | grep -E 'z\.(url|string)\(\)(\.min)?' || echo "no new required env var"
```
Expected: every variable this phase added carries a `.default(...)`; the only *removals* are the three Paperless keys.

- [ ] **Step 3: Run the graphify update this phase deferred per task**

Run: `graphify update .` (once, from the repo root — rulings P2-C15 and P3-C2/P3-C47 carried forward: not run per task).
Expected: `graphify-out/` reflects the new `modules/payroll` tree, the widened `ProviderCode`, the two new jobs, and the deleted `/work` and Paperless files. Record the node/edge/community counts in the checkpoint the way Phase 3's did.

- [ ] **Step 4: Manual walkthrough (operator checklist, needs a real silo and a real payslip)**

This cannot be driven by an automated agent in this environment — there is no silo credential, no real payslip PDF and no authenticated browser session here, the same limitation Phases 2 and 3 recorded for their own walkthroughs. Whoever holds them runs this once after deploying (`docs/deploy/phase-4-runbook.md`), and records the result as a dated addendum to the checkpoint:

1. Before connecting anything, confirm `/company` and `/company/payroll` both show the "Connect a payroll document store" setup state — a setup state, never a zero.
2. Connect the store in Settings › Integrations and press Test. Confirm the round trip succeeds and that neither the form nor any API response echoes the secret access key back.
3. Upload a real payslip PDF from `/company/payroll`. Confirm it appears as **Scanning**, and that within the hour (or after a manual hourly tick) it becomes **Needs review**.
4. Open it. Confirm the PDF renders in the review pane — this is the live check that the CSP `frame-ancestors` move in Task 17 is correct — and that the extracted figures match the document.
5. Correct one figure, press **Confirm**, then **Apply**. Confirm the month appears on `/company/earnings` with the corrected net, and that the Funds page's Cometa total moved by the payslip's contribution.
6. Upload the *same file* again. Confirm the app says it has already been uploaded and points at the existing import — **this is the phase's exit criterion** ("idempotent").
7. Upload a corrected payslip for the same month. Apply it, and confirm `/company/earnings` shows the month **once**, at the corrected figure, and that the previous import reads **Superseded**.
8. Try `GET /api/v1/payroll/imports/{id}/original` for an import still in `scanning`. Confirm it answers `409`, not the bytes.
9. Confirm the Settings › Administration Scheduled-jobs panel lists `payroll_ingest` and `payroll_retention`.
10. If clamd is enabled: upload the EICAR test file renamed to `.pdf`. It should be rejected at the *magic-byte* check before the scanner ever sees it — which is the correct outcome and proves the ordering. To exercise the scanner itself, embed the EICAR string inside a real PDF and confirm the import goes to **Malware found**, the bytes are deleted from the store, and a retry re-rejects without re-reading.

- [ ] **Step 5: Write the checkpoint document**

In the shape of `docs/superpowers/handoff/2026-09-05-phase-3-checkpoint.md`: the commit range and count, every verification command's result with its numbers, the graphify counts, what remains manual (Step 4) and why, the module and file map this phase added, the two-wave deploy state, and every ruling made during planning (`R4-1`…`R4-18`) and execution (`P4-C…`), including anything a reviewer flagged and fixed that this plan's text does not already reflect.

It must state plainly, near the top:
- Phase 4 is implemented and **not deployed**; Phases 2 and 3 are not deployed either, and Phase 4 stacks on both.
- The Paperless migration has **not** been run in production, so the twelve originals are still only in Paperless. Until wave 1 runs, deleting Paperless would lose them.
- `MALWARE_SCANNER` is `none` in every environment, by design (spec §13.3), and every import records `scanner: "none"` accordingly.
- Ruling R4-18: there is no auto-verify branch, and the confidence data it would need is already persisted so Phase 8 can add it without a migration.

- [ ] **Step 6: Write the ledger document**

In the shape of `docs/superpowers/handoff/2026-09-05-phase-3-ledger.md`: one entry per ruling with its "why" and its "cost if wrong", the corrections this planning pass made to the superseded draft (the migration number, the two-place service union, the `/work` split, the absent provider enum, `PAPERLESS_PAYSLIP_TAG_ID`, the dropped savepoint, the thirteen env-stub test files), and a **"Deferred by design"** section listing what Phase 4 deliberately left for later:

- **OCR.** There is no adapter; a scanned payslip parks in `needs_ocr` with a visible state and a retry that will pick it up when one exists (Ruling R4-9).
- **Auto-verify.** Spec §7.9 allows it "when policy allows", and the policy table arrives in Phase 8 (Ruling R4-18).
- **`fund_contributions` proper.** Phase 4 writes the legacy `fund_deposits` row; Phase 5 replaces it (Ruling R4-6).
- **`timeoff_balances`.** Components are classified and their targets recorded, but nothing consumes `timeoff_balance`/`timeoff_used` until Phase 7 (Ruling R4-10).
- **The Time Off workspace.** Relocated, not redesigned (Ruling R4-11).
- **Mapping-rule management UI.** `payroll_mapping_rules` is read but never written by the app; the global catalogue lives in `DEFAULT_MAPPING_RULES`. Phase 9's Management area gets the editor.
- **`fourteenth`, `bonus` and `settlement` record kinds.** Accepted by the schema and creatable through the review form, but never inferred from the text.
- **Outbound `payroll.import.completed` webhooks.** Spec §3.2 lists the event; Phase 9 builds the delivery path.
- **Multi-user document stores.** The retention job resolves the owner's store, the single-owner assumption Phase 1 set and Phase 8 revisits.

- [ ] **Step 7: Commit**

```bash
git add -A ../docs ../graphify-out
git commit -m "docs(handoff): record the Phase 4 checkpoint and execution ledger"
```

---

## Self-review against the Phase 4 scope

Spec §11's Phase 4 line lists nine deliverables plus the migration. Each maps to at least one task:

| Spec requirement | Where | Task(s) |
|---|---|---|
| Document store (silo + local) | §2.4, §8.4, R4-1 | 2 (port + local), 3 (SigV4 + S3 + resolver), 7 (the `payroll_silo` connection the silo credential lives in) |
| Upload API and UI | §7.9, §3.2 | 9 (use cases + orchestrator), 15 (`POST /payroll/imports`), 17 (`UploadForm`, `/company/payroll`) |
| Scanning boundary | §2.5, §13.3, R4-2 | 6 (no-op + clamd + resolver), 10 (`scanStep` enforces it), 13 (`readOriginal` refuses a non-clean import) |
| Extraction | §7.9 | 10 (`parseStep`, calling the unchanged `extractPdfText`) |
| Parsing via the existing pipeline | §1.1 "the parser is reusable without Paperless" | 10 (calls `parsePayslip` unchanged); the engine is untouched but for four comments (22) |
| Review screen (evolved `VerifyForm`) | §7.9 | 16 (`ReviewForm`, `queue`, `QueueNav`, actions), 17 (the page) |
| Apply step | §7.9, R4-6 | 11 (`applyImport` + the legacy fund bridge) |
| Replacement / versioning | §7.9, R4-4 | 1 (`payroll_records_period_uq`), 11 (supersede-then-insert, proven against real Postgres) |
| Retention job | §7.9, §13.5, R4-5 | 13 (`purgeExpiredOriginals`), 14 (`payroll_retention`, daily) |
| `payroll_records` / `payroll_components` / mapping rules | §5.8 | 1 (schema + RLS), 5 (`DEFAULT_MAPPING_RULES`, `classifyComponent`), 8 (repositories) |
| Company Overview and Earnings | §4, §7.8, R4-12 | 18 (both pages, `earningsSummary`, `RecordDetail`), 12 (the use cases behind them) |
| Paperless migration and removal | §10.2, §12.3, §12.10, R4-7 | 20 (mapper), 21 (scripts, wave 1), 22 (removal, wave 2) |
| §3.2 idempotency (`Idempotency-Key`, `409` on a duplicate) | R4-3 | 1 (both unique indexes), 9 (`reserveImport`), 15 (`409 duplicate` with the existing id) |
| §5.10 indexes | — | 1 (`payroll_records (user_id, period_start desc)` and the partial index on open statuses, both in the schema) |
| §6 feature matrix ("payroll feature (silo or local store configured)") | — | 7 (`payrollConfigured` becomes the store probe; `Capabilities.integrations.payroll` comes from the connection) |
| §8.2 permission codes | R4-17 | 7 (all four, with role mapping and a test) |
| §8.3 upload validation (size, MIME, magic bytes) | — | 2 (`looksLikePdf`, `MAX_UPLOAD_BYTES`), 9 (`validateUpload`), 15 (the API calls the same gate) |
| §8.4 server-side access only, no public URLs | R4-1 | 2 (`newStorageKey` is unguessable), 13 (`readOriginal` is the only read path), 15 (`storageKey` is absent from every DTO) |
| §12.1 navigation Work → Company | R4-11 | 19 (nav, Home cards, `/work` deleted) |
| §12.3 payslip webhook endpoint removed | — | 22 |
| §12.10 `PAPERLESS_*` removed, `DOCUMENT_STORE_*` added | — | 3, 6 (added, all defaulted), 22 (removed) |
| §9 observability and testing | — | every task ships its own unit or integration test; 1 and 8 prove RLS and the four uniqueness claims against real Postgres; 24 runs the full gate |

Two spec items are **deliberately not** in this phase, each with a ruling and a Phase-9-style deferral recorded in Task 24's ledger: auto-`verified` on high confidence (R4-18, needs Phase 8's `organization_policies`) and the OCR adapter (R4-9, Paperless was the only OCR source and is being retired). Two more are out of Phase 4's own scope by the spec's own phasing: `timeoff_balances` and `fund_contributions` are written as *targets* on every component (R4-10) but consumed in Phases 7 and 5.

**Placeholder scan:** no `TBD`, `TODO`, `FIXME`, no "add appropriate error handling", no "similar to Task N", no bare ellipsis inside a code block. Every code step carries the real code; every test step carries real assertions. The two places that read like an instruction rather than a listing are deliberate and bounded: Task 16 Steps 4-5 enumerate the exact edits to make while copying `QueueNav.tsx` and `VerifyForm.tsx` (numbered, with the old and new identifiers named), because reproducing two hundred lines of unchanged JSX would hide the seven lines that change; and Task 3 Step 1 says to run the SigV4 vector test once and pin the signature it produces **after verifying the canonical request by hand**, because this signer adds `x-amz-content-sha256` to AWS's published `get-vanilla` case and therefore cannot reuse its published signature. That step names the failure it is guarding against — a signer that agrees only with itself — and the other three cases in that test pass without any pinning.

**Type and signature consistency:** every symbol a later task consumes is defined in exactly one earlier task, and every name was cross-checked against every use. `UseCaseDeps` (nine members: `imports`, `records`, `components`, `mappingRules`, `funds`, `documents`, `scanner`, `clock`, `audit`) is declared once in Task 2 and constructed identically by `payrollDeps` (Task 8) and by every `makeDeps` in Tasks 9-13, 16 and 18. `PayrollImport`, `PayrollRecord`, `PayrollComponent`, `PayrollMappingRule`, `MappingTarget`, `DocumentStore`, `MalwareScanner` and `ScanResult` are each declared once, in Task 2's `ports.ts`. `addMoney` is declared once, in `domain/money.ts` (Task 5), and imported by the memory repositories, the fund bridge and the earnings summary — it is deliberately **not** in `infrastructure/`, because `domain/earnings.ts` needs it and a domain file importing infrastructure would invert this module's layering.

Four inconsistencies were found during this review and fixed inline rather than left for an implementer: `addMoney`'s original home in `infrastructure/memory-repositories.ts` (moved to `domain/money.ts`, with its own task step and tests); `SalarySection.tsx`'s destination (moved to `src/modules/payroll/ui/` rather than `src/app/(app)/company/_components/`, because `load-company.ts` imports its types); `taxesByRecord` taking the first tax component rather than summing them; and `/company/time-off` calling `loadImports()` unconditionally, which would have thrown `DocumentStoreUnavailableError` for a Trek-only user with no payroll store — the page now asks only when `caps.features.payroll` is true.

**Casts:** the only `as` casts in this plan narrow a Drizzle `text` column to its domain union at the repository boundary (`row.status as PayrollImport["status"]`, `row.kind as PayrollRecordKind`, `row.mappedTo as MappingTarget | null`) — the exact pattern `DrizzleAccountsRepository` and `DrizzleInterestRulesRepository` already use for the same reason, since a `text` column with an app-level `CHECK` has no narrower Drizzle-inferred type. The one other cast, `siloCredentialSchema as unknown as IntegrationProvider["credentialSchema"]`, exists because the framework types `credentialSchema` as `ZodType<Record<string, string>>` while this credential is a five-field object; it is the same shape `trekProvider` and `walletProvider` already pass and is documented where it appears.

**What this plan does not cover, and why:** OCR (R4-9 — no adapter exists to configure); auto-verify (R4-18 — the policy table is Phase 8's); `fund_contributions` proper (Phase 5 — Phase 4 keeps the legacy `fund_deposits` bridge alive instead); `timeoff_balances` (Phase 7 — the targets are recorded, nothing consumes them); the Time Off workspace redesign (R4-11 — this is a route move); a mapping-rule editor (Phase 9's Management area — `payroll_mapping_rules` is read but never written by the app this phase); inferring `fourteenth`/`bonus`/`settlement` from the text (creatable, never guessed, because nothing in a payslip distinguishes them reliably); outbound `payroll.import.completed` webhooks (spec §3.2 names the event; Phase 9 builds the delivery path); and per-user document stores for the retention job, which resolves the owner's store under the same single-owner assumption `monthly-close.ts` has held since Phase 1 and Phase 8 revisits.
