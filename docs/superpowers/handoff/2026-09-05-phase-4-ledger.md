# SDD ledger — plan: docs/superpowers/plans/2026-09-05-phase-4-payroll-and-company.md

Spec: `docs/superpowers/specs/2026-09-02-finance-company-platform-design.md`
(read; binding authority)

This is the Phase 4 execution record, in the shape Phase 3's ledger
(`docs/superpowers/handoff/2026-09-05-phase-3-ledger.md`) established. Five
parts:

1. **Rulings — planning** (`R4-1` … `R4-18`), taken while writing the plan,
   before any code was written. Source: the plan's own `## Rulings` section
   (`docs/superpowers/plans/2026-09-05-phase-4-payroll-and-company.md:245`).
2. **Corrections this planning pass made to the superseded draft** — the
   seven specific fixes the plan's pre-flight verification pass found before
   Task 1 was dispatched.
3. **Rulings — execution** (`PH4-C1` … `PH4-C13`), taken by the controller
   during the 24-task run, on findings no per-task review or planning ruling
   anticipated. Source: the running ledger,
   `.superpowers/sdd/2026-09-05-phase-4-payroll-and-company/progress.md`,
   read in full for this document.
4. **Deferred by design** — what Phase 4 deliberately left for later.
5. **Task-by-task summary** — one paragraph per task, cross-referencing the
   full record (every brief, report, review diff and fix diff) which lives in
   `.superpowers/sdd/2026-09-05-phase-4-payroll-and-company/`.

Baseline before Task 1 (commit `548143d`, the plan's own commit): the
tree carried over from Phase 3's fix wave — 909 unit / 909 files passing
(Phase 3's final figure before this phase's Task 1 landed), typecheck clean,
build ok.

---

## Rulings — planning (R4-1 … R4-18)

Made during planning, binding on execution. R4-1 … R4-12 are carried forward
from a superseded 2026-09-05 draft of this same plan and were each
re-verified against the current tree; where verification changed a premise,
the correction is stated inline and marked **[corrected]** below (see also
part 2, "Corrections to the superseded draft"). R4-13 … R4-18 are new to
this planning pass.

| # | Ruling | Why | Cost if wrong |
|---|---|---|---|
| **R4-1** | Document bytes never enter Postgres. Only metadata (`storage_provider`, `storage_key`, `sha256`, `size_bytes`, `mime`, `file_name`, `pages`) lives in the database; bytes go to a `DocumentStore` port (`s3-document-store.ts` against the existing `silo` container, `local-document-store.ts` for dev/test). The silo's endpoint, bucket and credentials live encrypted in `integration_connections` under a new `payroll_silo` provider, not in env vars. The object key is server-generated and unguessable (`payroll/{userId}/{YYYY}/{32 hex}.pdf`) — never the sha256, the import id or the filename. No pre-signed URLs; every read is proxied and authorization-checked (spec §8.4). | Server-side access only is a spec requirement, and the object key must not double as an access token. | A guessable or client-influenced key would let one user read another's payslip by URL manipulation alone — the single most sensitive data class this phase introduces. |
| **R4-2** | The scanning boundary is a `MalwareScanner` port (`scan(bytes) → {verdict, scanner, signature}`), no-op default (`clean`/`none`) plus a clamd adapter (`zINSTREAM`). The verdict is persisted for audit. `infected` deletes bytes immediately, terminally rejects, and a retry re-rejects without re-reading; `unavailable` keeps bytes, stays retryable. Parsing is gated on `scan_status = 'clean'`; `readOriginal` refuses a non-clean import with `409`. | Spec §2.5/§13.3: the boundary is always there even when no scanner is configured. | An infected file reaching the parser, or being served back to a user, before it cleared the boundary — the exact failure the boundary exists to prevent. |
| **R4-3** | Idempotency rests on two database unique indexes — `(user_id, sha256)` and `(user_id, idempotency_key)` — not an application check alone. A `failed` import (bytes never landed) is reused, not duplicated. **[corrected]** No savepoint around the reservation insert: the upload splits into reserve → write bytes → confirm (Task 9), so the reservation transaction holds nothing but the insert and a lost race simply rolls back and re-reads in a fresh transaction. | Spec §3.2's `Idempotency-Key` requirement, and this phase's own exit criterion ("uploading the same payslip twice" must not duplicate). The platform `idempotency()` middleware hashes the whole request body into text — untenable for a 10 MB binary — so this needed its own mechanism. | Uploading the same payslip twice could silently create two imports and two records — named explicitly in the spec as this phase's exit line. |
| **R4-4** | A correction is a different file (different sha256), gets its own import carrying `replaces_import_id`. Applying it, in one transaction: supersede the old record (`superseded_at`, `superseded_by_record_id`), then insert the new one — keeping `payroll_records_period_uq (user_id, period_start, kind) WHERE superseded_at IS NULL` a hard constraint. Superseded components are kept, never deleted. | Nothing is ever silently recomputed; superseding is an explicit, audited act. | A corrected payslip could erase the record of what the pipeline originally extracted, or the partial unique index could be violated under concurrent apply if superseding and inserting were not ordered inside one transaction. |
| **R4-5** | The daily `payroll_retention` job deletes only document bytes, never a row or a payroll record: for each import past `retention_until`, in a terminal status, with a non-null `storage_key`, delete the object then null the key. Capped at 100/run; idempotent (a null-key row is skipped); never touches a live-status import. `retention_until` defaults to 10 years (spec §13.5, the Italian statutory horizon). | Safe to run unattended against real financial documents with no human in the loop. | A misconfigured retention window could wipe the entire archive in one tick instead of giving an operator a day to notice, if the job were uncapped. |
| **R4-6** | `applyImport` is idempotent and re-runnable (recomputes the record, bumps `version`, replaces components wholesale, re-upserts the legacy `fund_deposits` bridge row) but **not reversible** — no `unapply`. The reverse of a wrong apply is a superseding replacement import (R4-4). Values stay editable while `needs_review`/`verified`, frozen once `applied`. | The derived rows (the legacy fund bridge) have no meaningful pre-state to restore; an invented "undo" would leave Earnings and Funds with an unexplained hole. | An accidental double-apply double-counting a month's earnings on the legacy Funds bridge, or an invented "undo" silently desynchronizing Funds from Earnings. |
| **R4-7** | Paperless removal happens in two deployment waves within this one phase, not two phases: Task 21 migrates while the client still exists; Task 22 deletes the client, preview proxy, webhook route, sweep polling, the ingest job, the write half of `src/lib/repo/payslips.ts`, and the env vars. `tsc` is the proof nothing still calls the deleted client (`PAPERLESS_*` leaves `env.ts`, `"paperless"` leaves both service unions). | Same two-wave shape the repo already learned from the fund-registry seed and Phase 2's credential import. | Deploying wave 2 before wave 1 completes deletes the only client capable of downloading the twelve original payslips — a permanent, unrecoverable loss, which is exactly why the runbook is explicit about ordering. |
| **R4-8** | `documents: DocumentStore` and `scanner: MalwareScanner` in `UseCaseDeps` are resolved by the caller *before* the transaction opens, because resolving the store may need to decrypt a credential — I/O that must never run inside an open Postgres transaction. | Follows the accounts-style flat `UseCaseDeps` bag (P3-2 precedent) plus this phase's own document/scanner I/O surface. | Violating this is the exact defect class Task 10 needed a fix round for (PH4-C7): a transaction held open across a slow S3 round trip or a malware-scanner network call, under load, is a connection-pool exhaustion risk on every scan/parse tick. |
| **R4-9** | `needs_ocr` is a real, persisted `payroll_imports.status` value, added because spec §5.8's enum omits it but §7.9's prose requires it. No OCR adapter exists this phase (Paperless was the only source and is being retired); a scanned payslip parks visibly in `needs_ocr` rather than being parsed from an empty string. | The alternative — silently parsing nothing — produces a confident-looking all-null extraction, the exact "never invent financial data" failure this project's global constraints exist to prevent. | A payslip with no usable text layer would otherwise either crash the pipeline or silently produce a plausible-looking but entirely fabricated set of figures. |
| **R4-10** | `payroll_components.mapped_to` records every mapping target (`earnings`, `fund_contribution`, `timeoff_balance`, `timeoff_used`) on every component, but only `fund_contribution` has a Phase 4 consumer (the legacy `fund_deposits` bridge). `timeoff_balance`/`timeoff_used` wait for Phase 7; `fund_contributions` proper waits for Phase 5. | Forward compatibility recorded in data, not dead code — every target is exercised by `classifyComponent`'s own tests. | None stated; this is intentionally inert data until later phases consume it. |
| **R4-11** | `/work` splits into three destinations along the spec's own page map, not a verbatim move: leave → `/company/time-off`, salary → `/company` Overview, payslip list → `/company/payroll`. **[corrected]** the superseded draft's "verbatim move" claim was found false: `work/page.tsx` mixes three unrelated concerns a verbatim move would keep mixed on the wrong page. Client components move file-for-file (`LeaveCalendar.tsx`, `LeaveByMonth.tsx`, `work/_lib/leave.ts` into `company/`; `SalarySection.tsx` into `modules/payroll/ui/` because `load-company.ts` needs its `SalaryWindow` type, and a module importing from `src/app/` would invert this phase's layering). | Spec §4's page map has no `/work` page at all. | The superseded plan text would have shipped earnings figures rendered on a Time Off page, and kept a dead `allPayslips()` reader alive. |
| **R4-12** | `earningsSummary` computes gross/net/taxes/contributions per month/quarter/year from `payroll_records` + `payroll_components` with `superseded_at IS NULL`. No page reads `payroll_imports` for a financial figure — imports are pipeline state, records are money. | Spec §5.8 describes `earnings_summaries` as a view, not a table; a use case over the authoritative money tables is the equivalent without inventing a table nothing else needs. | A page reading an import (pipeline state) for a financial figure could show an in-flight or rejected value as if it were settled money. |
| **R4-13** | Three signature changes: (a) `ProviderCode` widens with `"payroll_silo"`, forcing `connectionProbes` to return a third key — Task 7; (b) `dataProbes(client).hasPayrollRecords` counts `payroll_records` under `withUserContext` instead of `payslips` on the pool-bound handle, with `payrollConfigured`'s replacement — Task 7; (c) `"paperless"` drops from **two unlinked places** — `src/lib/clients/http.ts`'s `UpstreamService` and `src/lib/contracts.ts`'s separately inlined `UpstreamError` union — both edited together in Task 22. A fourth, additive change: `JobName` gains `payroll_ingest`/`payroll_retention` (Task 14) and loses `payslip_ingest` (Task 22), deliberately split so the tree type-checks between them. **[corrected]** the superseded draft named three signature changes and got two of them wrong (the actual (a)/(b) above, not what it claimed) and additionally claimed `src/modules/integrations/api/schemas.ts` needed a provider enum widened, which does not exist (bare `z.string()` at lines 4, 9, 29 — see part 2 below). | Verified line-by-line against the current tree rather than trusted from the superseded draft. | The superseded draft's misattribution would have left one of the two service-union call sites (`http.ts` or `contracts.ts`) compiling against a `"paperless"` value nothing could ever produce again. |
| **R4-14** | The database's `text_source` carries the spec's three values (`pdf_text|ocr|none`); the parser's own `TextSource` stays `pdf|ocr` unchanged, mapped by one named function, `textSourceColumn()`. `none` is the honest encoding of `needs_ocr`. | Widening the parser's own type instead would force every existing `src/lib/payroll/**` test to acknowledge a state the parser can never actually produce. | A widened parser type would be a larger, riskier diff to an already-working, untouched parsing engine for no behavioral gain. |
| **R4-15** | `payroll_silo` registers as an `IntegrationProvider` (same credential vault, same connect/test/disconnect UI as Wallet/Trek) but `syncs` is `{}` and no `SyncKind` is added — a document store has nothing to pull on a schedule. `testConnection` does a real PUT/GET/DELETE round trip against a probe object, not a HEAD-only check. `onDisconnect` with policy `purge` is specified to delete every object under the user's prefix and null their storage keys. | A document store is fundamentally driven by user action or the ingest job, not a scheduled sync — forcing it through `SyncKind` would be a wrong abstraction. | Realized in execution (Ruling PH4-C4): the purge-on-disconnect branch is currently unreachable in practice because no caller resolves a `store` onto the disconnect context — a real but bounded privacy/retention gap, not a security breach. |
| **R4-16** | `documentStoreResolver` refuses `DOCUMENT_STORE_DRIVER=local` under `NODE_ENV=production`. The `dashboard-app` container runs `read_only: true` with tmpfs-only mounts, so a local store in production would either fail to write or silently lose originals on restart. | Matches the container's actual deployment shape, verified against `docker-compose.yml`. | A production deploy accidentally left on the local driver would either fail to write payroll originals at all, or write into a tmpfs that vanishes on the next restart, silently. |
| **R4-17** | A fourth permission code, `payroll.read`, gates `/company/earnings` separately from `payroll.upload`/`.review`/`.read_original`. Role mapping: `owner`/`admin`/`member` get all four; `viewer` gets `payroll.read` only. | Spec §4's page map gates Earnings on data, not upload/review rights; reusing `payroll.upload` for a read would deny Earnings to a viewer who may legitimately see figures but never a scanned original. | Realized concretely, in the *opposite* direction, at Task 15 (Ruling PH4-C11): `/retry` initially checked only `payroll.read` before triggering a real mutation, letting a viewer perform an upload-tier action. |
| **R4-18** | No auto-verify branch this phase. Spec §7.9 allows auto-`verified` "when policy allows"; the policy table (`organization_policies`) is Phase 8's. Every import lands in `needs_review`/`needs_ocr`. Confidence data (`confidence` jsonb, per field) is already persisted so Phase 8 can add the branch with no migration. | The spec deliberately leaves the auto-verify default to the organization; this phase has no policy row to consult. | Inventing a default policy now would mean guessing whether payroll figures should ever post with no human review — exactly the choice the spec reserves for later. |

---

## Corrections this planning pass made to the superseded draft

Seven specific corrections the pre-flight verification pass found and fixed
in the plan text before Task 1 was dispatched, each because the superseded
2026-09-05 draft made a claim the current tree contradicted:

1. **The migration number.** Re-derived as `0015` by directly listing
   `dashboard-app/drizzle/*.sql` (ends at `0014_interest_posting_fixes.sql`)
   and cross-checked against Phase 3's own checkpoint ("next free number is
   `0015`"), rather than trusted from whatever number the superseded draft
   assumed.
2. **The two-place service union (Ruling R4-13c).** `"paperless"` lives in
   **two unlinked places** — `src/lib/clients/http.ts`'s `UpstreamService`
   and a separately inlined union inside `src/lib/contracts.ts`'s
   `UpstreamError` constructor — not the one place the superseded draft
   implied. Task 22 edits both together.
3. **The `/work` split (Ruling R4-11).** The superseded draft said
   `work/page.tsx` and its `_components`/`_lib` move "verbatim" to
   `/company/time-off`. Verified false: the page mixes leave, salary and a
   payslip list. Corrected to a three-way split along the spec's own page
   map (Tasks 17-19).
4. **The absent provider enum.** The superseded draft claimed
   `src/modules/integrations/api/schemas.ts`'s "provider enum gains
   `payroll_silo`". There is no provider enum to widen — `provider` is a
   bare `z.string()` at lines 4, 9 and 29 — so this file needed **no
   change** at all, confirmed by this task's own Step 2 grep finding the
   `SyncKind` enums unchanged.
5. **`PAPERLESS_PAYSLIP_TAG_ID`.** Verified it *is* already declared in
   `src/lib/env.ts:33` with a schema default (`z.coerce.number().int().default(22)`)
   — it is simply absent from `docker-compose.yml`/`.env.example` because it
   relies on that default. Task 22 removes it from `env.ts` alone and needs
   no compose change for it, correcting an implied assumption in the
   superseded draft that it needed explicit removal from compose too.
6. **The dropped savepoint (Ruling R4-3).** The superseded draft wrapped the
   duplicate-upload reservation insert in a savepoint
   (`tx.transaction(...)`) to protect the enclosing transaction from an
   aborted insert. Verified unnecessary against the design this plan
   actually lands: the reservation transaction contains nothing but the
   insert (Task 9's reserve → write → confirm split), so a lost race can
   simply roll back and re-read in a fresh transaction — there is no partial
   work a savepoint would need to preserve.
7. **The thirteen env-stub test files.** The superseded draft named only two
   files needing their `PAPERLESS_URL`/`PAPERLESS_TOKEN` stubs removed
   (`integration-setup.ts` and `machine.test.ts`). Verified by direct
   inspection that **thirteen** test files assign these keys and every one
   fails `env()` parsing the moment the keys leave the schema; all thirteen
   are named explicitly in the plan's "What already exists" table and
   removed together in Task 22's single commit.

---

## Rulings — execution (PH4-C1 … PH4-C13)

Thirteen rulings made by the controller during the 24-task run, on findings
no planning ruling anticipated. Source:
`.superpowers/sdd/2026-09-05-phase-4-payroll-and-company/progress.md`.

- **PH4-C1 — pre-flight plan-text fix, zero code impact.** Task 3's own
  "Interfaces → Produces" block wrongly claimed `resolveDocumentStore`/
  `documentStoreConfigured` as its own output, contradicting its own
  numbered steps, which correctly deferred both to Task 7 (the file cannot
  compile without `SILO_PROVIDER`/`siloCredentialSchema`, written in Task
  7). *Why:* the task's own text disagreed with itself; caught during the
  pre-flight conflict scan, before Task 1 was dispatched. *Fix:* edited the
  plan's Interfaces block to match the body — Task 3 now lists
  `storeFromDriver`/`StoreFromDriverInput`/`DocumentStoreResolution` and a
  local-stub `SiloCredentials`; Task 7 keeps
  `resolveDocumentStore`/`documentStoreConfigured` unchanged. *Cost if
  wrong:* negligible — corrects a summary header before any code existed;
  no dispatch brief or implementation was affected beyond removing a
  misleading line.
- **PH4-C2 — Task 1's RLS security fix, three findings from two independent
  sources.** (1) *Critical, security, found by an automated background
  security-review hook and confirmed by the controller:*
  `payroll_mapping_rules_owner`'s single `USING`/`WITH CHECK` pair let any
  authenticated user `DELETE` a global (`user_id IS NULL`) default mapping
  rule, or hijack one via `UPDATE ... SET user_id = <self>` — Postgres only
  evaluates `WITH CHECK` for `INSERT` and the post-image of `UPDATE`, never
  for `DELETE`, and `USING` alone gates which rows a `DELETE`/`UPDATE` may
  target. The brief's own commentary ("no user can write one") reasoned only
  about `INSERT` and missed both other commands — this is plan-mandated, not
  an implementer deviation. (2) *Important, found independently by the task
  reviewer:* zero cross-user RLS test coverage existed for
  `payroll_mapping_rules` anywhere in the suite, despite this task's own
  global constraint requiring cross-user isolation proof for every
  RLS-protected table. (3) *Important, found independently by the task
  reviewer:* the table has `updatedAt` (implying mutability) but no
  `version` column, breaking this project's own established pattern for
  mutable entities. *Why fix all three:* all three are real defects on the
  merits regardless of plan-mandated origin — the plan's authorship does not
  grade its own work. *Fix:* split RLS into four per-command policies
  (`SELECT` permissive of `user_id IS NULL`; `INSERT`/`UPDATE`/`DELETE` all
  requiring `app_is_system() OR user_id = app_current_user_id()`, excluding
  `NULL`-owned rows from every write path for non-system actors); added the
  missing `version` column; added five new test cases including one proving
  a normal user cannot `UPDATE` or `DELETE` a global rule. Migration `0015`
  was regenerated in place (not a new `0016`) since it had not yet been
  applied to any real or shared database and no later task's migration
  built on its exact generated content yet, preserving the plan's "exactly
  one migration this phase" constraint. *Cost if wrong:* low to regenerate
  an unshipped, unbuilt-upon migration — the only costly wrong answer would
  have been leaving the authorization gap live.
- **PH4-C3 — standing graphify-deferral instruction.** Every implementer
  dispatch from Task 3 onward was explicitly told not to run `graphify
  update .` and not to stage `graphify-out/`, overriding CLAUDE.md's
  per-commit instruction for this phase's duration — the same precedent as
  Phase 2's P2-C15 and Phase 3's P3-C2/P3-C47. *Why:* per-task regeneration
  rewrites a very large `graph.json` and makes review packages unreadable.
  Confirmed working as intended: `git diff --stat <task-range> --
  graphify-out/` came back empty on every commit through Task 23, and this
  is exactly why `graphify-out/` stayed clean until this Task 24's own
  regeneration. *Cost if wrong:* none — worst case is re-deriving the same
  regeneration this task already performs once, at the end.
- **PH4-C4 — Task 7's parked finding: `payroll_silo` disconnect-with-purge
  is architecturally unreachable today.** Ruling R4-15 promises the purge
  branch deletes every object under the user's `payroll/{userId}/` prefix
  and nulls their `storage_key`s. The adapter's own `onDisconnect`
  implements that branch correctly, gated on `ctx.store` being present —
  but `disconnectIntegration()` (Phase 2 code, untouched by any of this
  plan's 24 tasks) never resolves or attaches a `store` to the
  `DisconnectContext` it builds, so the branch is always skipped in
  practice; storage-key nulling has no caller either (the adapter's own
  comment correctly identifies it as "the caller's job"). *Investigated
  whether Task 7 could close this directly: it cannot, safely.*
  `disconnectIntegration()`'s own doc comment states `onDisconnect` runs
  inside a single Postgres transaction (`deps.inUserContext`) precisely
  because it is "the one provider hook that does no network I/O." Wiring a
  real document-store purge into that same call would mean S3 HTTP round
  trips — potentially many, one per object under the prefix — while holding
  an open Postgres transaction: exactly the "I/O outside Postgres inside an
  open transaction" pattern this plan's own Global Constraints forbid, and
  the same defect class Tasks 10 and 13 needed fix rounds for (PH4-C7,
  PH4-C9). The correct fix is a cross-provider contract change — splitting
  `IntegrationProvider.onDisconnect` into an I/O phase and a transaction
  phase, mirroring `SyncHandler`'s existing `fetch`/`apply` split —
  affecting `wallet` and `trek` too, not a payroll-scoped fix improvised
  under one task's fix loop. *Decision:* park the finding. Confirmed real
  but non-blocking: (a) no task in this plan's remaining 17 tasks depends on
  purge-disconnect actually working (grepped the full plan for any task
  touching `disconnect-integration.ts` — none does); (b) the current shipped
  code is not unsafe — `ctx.store` is always `undefined` today, so the
  branch simply no-ops rather than violating the transaction-I/O invariant;
  nothing corrupts data, leaks a credential, or crosses a user boundary.
  Carried forward explicitly into this checkpoint's "what remains" rather
  than allowed to silently disappear. *Cost if wrong:* a `payroll_silo`
  disconnect-with-purge silently leaves documents in the store when a user
  expected deletion — a real but bounded privacy/retention gap, not a
  security breach, addressable later by a human operator without any of
  this phase's other 23 tasks needing rework.
- **PH4-C5 — Task 8's missing real-Postgres proof of `payroll_records_import_uq`,
  fixed rather than parked.** This plan's Global Constraints name four
  uniqueness claims requiring proof against real Postgres:
  `payroll_imports (user_id, sha256)`, `payroll_imports (user_id,
  idempotency_key)`, `payroll_records (import_id)`, and `payroll_records
  (user_id, period_start, kind) WHERE superseded_at IS NULL`. The brief's
  `repositories.itest.ts` (confirmed verbatim except two implementer-disclosed
  fixes) exercised only three of the four against real Postgres —
  `payroll_records_import_uq` was proven only against the Memory fake's
  hardcoded error string. *Why fix now:* this directly contradicts a global
  constraint the plan itself states as binding for exactly this claim; the
  fix is cheap; leaving it unproven repeats precisely the "invisible to the
  unit suite because only the fake was under test" pattern this project's
  own Phase 2/3 retrospective identified as its costliest defect class.
  *Fix:* one new itest case, using a different `periodStart`/`kind` between
  two inserts so only the plain `importId` unique index can fire (not the
  partial period/kind one), asserted against the real wrapped
  Drizzle/Postgres error. All four of the plan's global uniqueness claims
  are now proven against real Postgres. *Cost if wrong:* the fix cost one
  test case; the gap it closed was a binding global constraint left
  silently unmet.
- **PH4-C6 — Task 9's concurrent-upload race surfaced as an unhandled error,
  fixed.** The reviewer independently traced the full transaction/I/O call
  graph and confirmed the core property (no transaction is ever open while
  `documents.put()` executes) but flagged, as unverifiable from the diff
  alone, whether a genuine concurrent-upload race (two identical uploads
  both observe `findBySha` as not-yet-existing, both call `create()`)
  surfaces as the documented `409 duplicate` or an unhandled error. The
  controller resolved this by reading Task 8's
  `DrizzlePayrollImportsRepository.create()`: a raw `.insert().returning()`
  with no unique-violation handling, and `reserveImport` never caught one
  either. *Confirmed real*: the race is closed at the database level (the
  unique index guarantees no duplicate row can ever exist), but the loser of
  the race got an unhandled Postgres/Drizzle error instead of the `409
  duplicate` Ruling R4-3 explicitly specifies. *Why fix now:* named word for
  word in a ruling this task's own brief cites; the fix is cheap; it closes
  the gap between "correct at the database" and "correct at the API
  surface" for one of this phase's four load-bearing uniqueness claims.
  *Fix:* catch the unique-violation narrowly (scoped to
  `payroll_imports_user_sha_uq` in `err.cause.message`, not a blanket
  catch), re-query `findBySha`, throw `DuplicateImportError` referencing the
  winning import's id; any other error still propagates. *Cost if wrong:*
  the gap would sit between "correct at the database" and "correct at the
  API surface" indefinitely — cheap to close now, costly to leave for a
  caller trusting the documented `409` contract.
- **PH4-C7 — Task 10's Critical structural fix; the single most consequential
  fix in this phase.** `scanStep`/`parseStep`, exactly as the brief's own
  Interfaces block specified, each bundled a DB read, network/disk I/O
  (`documents.get`, `scanner.scan`, text extraction, the LLM call), and a DB
  write into one function operating on a single `UseCaseDeps`. The only
  production mechanism for building that `UseCaseDeps`
  (`payrollDeps(tx, opts)` inside one `withUserContext` transaction
  callback, confirmed by inspecting `infrastructure/deps.ts` and
  `platform/db/context.ts`) means the *entire* function body — I/O included
  — runs while a Postgres transaction is open: exactly the "I/O outside
  Postgres inside an open transaction" pattern this plan's own Global
  Constraints forbid, and a direct contradiction of the decomposition Task
  9 was specifically reviewed and praised for. *Why load-bearing, unlike
  Task 7's parked finding:* Task 14's jobs and Task 15's `/retry` route both
  call `scanStep`/`parseStep` as atomic units — leaving this unfixed would
  mean Task 14 either silently inheriting the defect or improvising its own
  fix under time pressure with less context than the controller had right
  then. *Fix:* split each step into a DB-only half (status check/read, or
  the terminal DB write) and a new infrastructure-layer orchestrator that
  resolves `documents`/`scanner` before any transaction (per Ruling R4-8),
  opens a short `withUserContext` for the DB-only read/guard, does the I/O
  with no transaction open, then opens a second short `withUserContext` for
  the DB-only write — mirroring `infrastructure/upload.ts`'s `uploadPayslip`
  exactly. Landed as `scanImport(principal, importId, opts?)` and
  `parseImport(principal, importId, opts?)` in new file
  `infrastructure/ingest.ts` — the names Task 14 and all later callers
  actually use, fully replacing `scanStep`/`parseStep` (confirmed zero
  remaining references anywhere). DB-only halves (`beginScan`,
  `applyScanConclusion`, `beginParse`, `applyParseConclusion`) stay in
  `application/ingest-import.ts`. Re-review traced both orchestrators
  line-by-line: documents/scanner resolved before any transaction, first
  `withUserContext` DB-only, I/O with no transaction open between the two
  `withUserContext` calls, second `withUserContext` DB-only. Scan-boundary
  semantics (infected/unavailable/clean, terminal rejection, parse gate,
  `needs_ocr`) independently re-verified byte-for-byte unchanged. New
  `ingest.itest.ts` (8 tests) exercises the real orchestrators against real
  Postgres. *Cost if wrong:* low as a pure decomposition of already-correct
  logic with no scan-boundary semantics change; the cost of *not* fixing it
  would have been a transaction held open across a malware-scanner network
  call and an LLM call on every scan/parse tick for the rest of the phase's
  life.
- **PH4-C8 — Task 11's mapping-rules Memory/Drizzle divergence, fixed at the
  repository layer, not the use-case layer.**
  `DrizzlePayrollMappingRulesRepository.listFor` (Task 8) never returns
  global (`user_id IS NULL`) mapping rules because no migration seeds any
  via that path, while `MemoryPayrollMappingRulesRepository.listFor` fakes
  them in from `DEFAULT_MAPPING_RULES` — a live instance of this project's
  own retrospective-identified costliest recurring bug class, and a
  contract violation given the port's own doc comment ("Global rules and
  this user's own"). The implementer's own first fix concatenated
  `DEFAULT_MAPPING_RULES` inside `applyImport` itself — verified correct for
  today (no double-count, since `classifyComponent` is first-match-wins per
  field, and priority sorting is unaffected by concatenation order) but
  scoped to one call site; any future caller trusting the documented port
  contract (an admin mapping-rules UI, a classification-preview endpoint)
  would silently get the full catalogue against the Memory fake and an
  incomplete one against real Postgres, indistinguishable in unit tests.
  *Why fix at the repository layer:* exactly the defect class this
  project's own retrospective and a peer session's attention-lens note both
  call out; the current code works today only because nothing else calls
  `.listFor()` yet, and the cost of leaving it grows with every future task
  that might. *Fix:* moved the `DEFAULT_MAPPING_RULES` merge into
  `DrizzlePayrollMappingRulesRepository.listFor` itself, mirroring the
  Memory fake's id scheme and sort exactly; `apply-import.ts` simplified
  back to a thin `deps.mappingRules.listFor()` call. New repository-level
  test proves the merge against real Postgres, including an adversarial
  case (a user rule's `matchCode` colliding with a global rule's). *Cost if
  wrong:* the cost would compound with every future caller of `.listFor()`
  that trusted the documented contract and silently got two different
  answers depending on which backend was live.
- **PH4-C9 — Task 13's implementer correctly paused before repeating Task
  10's defect.** Before writing any code, the implementer identified that
  the brief's literal `readOriginal`/`purgeExpiredOriginals` both bundle
  `deps.documents.get`/`.delete` I/O into a function operating on one
  transaction-bound `deps` — the identical structural defect Task 10 needed
  a fix round for — and paused to ask rather than guess or silently follow
  the brief. Independently confirmed via `platform/db/context.ts`
  (`withUserContext`/`withSystemContext` always wrap in `db.transaction`)
  and the plan's own future wiring (the route helper and Task 14's job both
  bundle the whole call in one transaction). *Why:* this is the plan's
  **third instance of the same defect class** (Tasks 7, 10, 13) — worth
  flagging to the final whole-branch review as a pattern, not three
  unrelated incidents: any task touching `documents.*`/`scanner.*` deserves
  this same scrutiny by default from here on. *Decision:* do the full split
  now (DB-only halves + I/O orchestrator, mirroring
  `infrastructure/ingest.ts`), not the literal brief. This also established
  the per-item batch-processing shape (read batch under system context, each
  item's I/O plus its own short transaction, one item's failure caught and
  counted so it can't jam the rest) Task 14's retention job depends on.
  Landed as `readOriginal` in `infrastructure/read-original.ts` and
  `purgeExpiredOriginals` in `infrastructure/purge-expired-originals.ts` —
  both manage their own per-item/short transactions internally, so Task
  14's job wrapper does NOT re-wrap either call in its own
  `withSystemContext`/`withUserContext`. *Cost if wrong:* none realized —
  the implementer's own judgment prevented the defect from landing at all,
  which is the cheapest possible outcome for this defect class.
- **PH4-C10 — a test-overclaiming pattern found and fixed twice (Tasks 10
  and 13), avoided cleanly by Task 14.** Task 10's `ingest.itest.ts` and
  Task 13's read-original test both included a new integration test
  claiming to "directly prove no transaction spans" the I/O in question —
  but the property each checked (an audit row's absence at fetch/scan time)
  is guaranteed by program order alone in both the correct code and the
  exact regression each claims to catch: it would pass identically either
  way, giving it zero actual discriminating power. Stated more confidently
  on Task 13's instance (the report and commit message both called it
  "direct proof"/"direct evidence") than on Task 10's (recorded there as a
  deferred Minor). *Why fix the claim rather than engineer a new
  mechanism:* the actual transaction-safety guarantee rests on the direct
  code-structure trace (two visibly separate `withUserContext`/
  `withSystemContext` calls with the I/O between them at plain function
  scope), independently confirmed by two separate reviewers now (Task 10
  and Task 13) — not on either test. A genuine discriminating test would
  need a pool-exhaustion or `pg_stat_activity` idle-in-transaction probe,
  which risks its own flakiness for marginal benefit given the code-trace
  evidence already stands on its own. *Fix:* renamed the misleading
  variables (`observingStore`/`sawAuditBeforeFetch` →
  `orderObservingStore`/`auditRowExistedAtFetchTime`), rewrote the doc
  comment to explicitly state this is a call-order sanity check, not a
  transaction-isolation proof, and to name the actual guarantee (code
  structure, verified by inspection) as the real evidence. Pure
  rename/comment fix, no logic change. Flagged explicitly for the final
  whole-branch review as a two-for-two pattern worth checking across every
  remaining task writing a similar test — Task 14's own two new test files
  were checked specifically for this pattern on review and found clean
  (they assert only observable call counts/results). *Cost if wrong:* the
  overclaimed comments could have misled a future maintainer into trusting
  test coverage for a property that has no actual test coverage; the real
  guarantee stands independently of the comment either way.
- **PH4-C11 — Task 15's Critical authorization bypass on `/retry`, fixed, no
  parking possible.** `POST /payroll/imports/{id}/retry` asserted only
  `payroll.read` (via its preliminary `getImport` fetch) before calling
  `scanImport`/`parseImport` — and neither those orchestrators nor the
  `application/ingest-import.ts` functions underneath them (`beginScan`,
  `applyScanConclusion`, `beginParse`, `applyParseConclusion`) assert any
  permission at all, because they were designed to be invoked only by the
  internal cron job under a synthetic system principal. Task 15 is the
  first place these functions are exposed to a real, arbitrary-role
  signed-in principal over HTTP. *Net effect:* a `viewer`-role principal
  (who holds `payroll.read` only, per Ruling R4-17) could call `/retry` and
  trigger a genuine re-scan (real malware-scanner network call) or re-parse
  (real LLM call), with real DB writes and audit rows, despite having no
  upload/review rights anywhere else in this module — inherited verbatim
  from the brief's own hand-rolled retry handler (a plan gap, not an
  implementer deviation), shipped with zero test coverage of any kind for
  the route. *Why fix now, no parking:* an authorization bypass letting a
  lower-privilege role trigger real side-effecting mutations is exactly the
  class of defect this project's review process exists to catch before
  merge — there is no bounded/low-severity reading of this finding the way
  PH4-C4's parked finding has. *Fix:* assert `payroll.upload` (retry is
  functionally "try uploading through the pipeline again") in the route
  handler before branching on status — before any DB read or mutation. Add
  the missing test coverage: happy path (a member retries a stuck import,
  real HTTP round trip proving the import actually transitions status), a
  `viewer` gets a real `403` through the app's routing/middleware, and a
  reject-then-retry sequence proves the real `409 conflict` path. *Cost if
  wrong:* a lower-privilege role triggering real side-effecting mutations
  against a live malware scanner and LLM endpoint, with real audit rows
  recording actions the principal had no right to take — the exact defect
  class this project's whole review process exists to prevent from
  reaching `main`.
- **PH4-C12 — Task 16's queue-advance using stale client data, fixed.**
  `apply()`'s queue-advance used the client-side `props.pending` snapshot
  rather than a server-fresh computation, unlike `confirm()`/`reject()` in
  the same file, which both recompute `next` from a fresh server query
  after their mutation succeeds. *Why real, not hypothetical:* under real
  concurrent review — a plausible scenario for a shared review queue —
  another reviewer resolving a different import between render and this
  user's Apply click could send them to an already-resolved import.
  Non-destructive (the server rejects with a clear `ConflictError`, never
  corrupting anything), but a genuine, self-flagged gap. *Why fix now
  rather than park:* the fix is entirely contained to
  `app/actions/payroll.ts` (already in this task's file scope), mirroring
  the pattern `verifyPayslipAction`/`rejectPayslipAction` already use,
  rather than requiring any change to Task 11's `apply-import.ts`. *Fix:*
  factored a shared `nextInQueue` helper; `verifyPayslipAction`/
  `rejectPayslipAction` refactored onto it (confirmed byte-for-byte
  equivalent to their pre-refactor inline logic — no behavior change);
  `applyPayslipAction` now returns `{recordId, next}` computed the same
  way; `ReviewForm.tsx`'s `apply()` consumes the server-fresh `next`
  instead of the client-side `pending` snapshot. New regression test proves
  the concurrent-reviewer scenario is now handled correctly. *Cost if
  wrong:* a confusing but non-destructive UX papercut under real concurrent
  review load — a reviewer occasionally landing on the wrong queue item,
  never data corruption.
- **PH4-C13 — Task 17's CSP `frame-ancestors` over-scope, narrowed.**
  `middleware.ts`'s `frameAncestorsFor` used
  `startsWith("/api/v1/payroll/imports/")`, which matches all six payroll
  import sub-routes (`GET /{id}`, `/verify`, `/reject`, `/apply`, `/retry`,
  `/original`), not just the PDF-serving `/original` route the comment and
  plan intent describe. *Impact bounded:* the policy value stays `'self'`
  either way — never opened to a third party — so this is not a broad CSP
  weakening, but it is real, avoidable over-scope: five JSON action
  endpoints with no reason to be frameable technically could be. *Why fix
  now:* cheap (a regex/exact-suffix match instead of a prefix match), and
  worth tightening before this loose-prefix pattern got copied by a later
  task. *Fix:* replaced the prefix match with an exact-shape regex
  (`/^\/api\/v1\/payroll\/imports\/[^/]+\/original$/`), verified against all
  six routes — only `/original` resolves to `'self'`, the five JSON action
  routes resolve to `'none'`. New dedicated `middleware.test.ts` (none
  existed before) covers all six routes plus edge cases (nested/
  trailing-slash false positives). *Cost if wrong:* five JSON action
  endpoints that have no reason to be frameable would remain technically
  frameable to same-origin content — bounded (never third-party), but worth
  tightening before the pattern spread to a later task's copy-paste.

---

## Deferred by design

What Phase 4 deliberately left for later, and why, per the plan's own
Rulings section:

- **OCR.** There is no adapter; a scanned payslip parks in `needs_ocr` with a
  visible state and a retry that will pick it up when one exists (Ruling
  R4-9).
- **Auto-verify.** Spec §7.9 allows it "when policy allows", and the policy
  table arrives in Phase 8 (Ruling R4-18).
- **`fund_contributions` proper.** Phase 4 writes the legacy `fund_deposits`
  row; Phase 5 replaces it (Ruling R4-6).
- **`timeoff_balances`.** Components are classified and their targets
  recorded, but nothing consumes `timeoff_balance`/`timeoff_used` until
  Phase 7 (Ruling R4-10).
- **The Time Off workspace.** Relocated, not redesigned (Ruling R4-11).
- **Mapping-rule management UI.** `payroll_mapping_rules` is read but never
  written by the app; the global catalogue lives in `DEFAULT_MAPPING_RULES`.
  Phase 9's Management area gets the editor.
- **`fourteenth`, `bonus` and `settlement` record kinds.** Accepted by the
  schema and creatable through the review form, but never inferred from the
  text.
- **Outbound `payroll.import.completed` webhooks.** Spec §3.2 lists the
  event; Phase 9 builds the delivery path.
- **Multi-user document stores.** The retention job resolves the owner's
  store, the single-owner assumption Phase 1 set and Phase 8 revisits.

Plus one item surfaced only during execution, not anticipated by any
planning ruling:

- **`payroll_silo` disconnect-with-purge** (Ruling PH4-C4, parked). Correctly
  fixing it needs a cross-provider `IntegrationProvider.onDisconnect`
  fetch/apply split (mirroring `SyncHandler`'s existing shape), affecting
  `wallet` and `trek` too — not a payroll-scoped patch, and not something to
  improvise under a single task's fix loop.

---

## Task-by-task summary

Full detail — every brief, implementer report, reviewer report and fix-round
diff — lives in
`.superpowers/sdd/2026-09-05-phase-4-payroll-and-company/progress.md` and its
sibling task files. Below is a one-line-per-task index; commit hashes are the
task's landing commit, then (if any) its fix-round commit.

| Task | Landing → fix commit(s) | Result |
|---|---|---|
| 1 | `ad502b9` → `e24437e` | Migration `0015`: imports/records/components/mapping rules with RLS. 1 fix round (PH4-C2: RLS split + `version` column, security). |
| 2 | `6b9b2c4` | Ports, document domain, local document store. Review clean; 2 minors deferred. |
| 3 | `46219c7` | SigV4 signer, S3 document store, driver resolver. Review clean; 3 minors deferred. |
| 4 | `3e93924` | Import status machine, pay-period domain. Review clean; found and fixed a pre-existing regex bug in the brief's own reference code (ported from `payslip-ingest.ts`, out of scope until Task 22). |
| 5 | `793ce17` | Component classification, `addMoney` decimal-safe arithmetic. Review clean, byte-for-byte brief match. |
| 6 | `0539135` | Malware-scanning boundary: no-op default + clamd adapter. Review clean. |
| 7 | `73561f7` | `payroll_silo` provider, capabilities, permissions. 1 parked finding (PH4-C4: disconnect-purge unreachable). |
| 8 | `1983ee4` → `2549d99` | Memory/Drizzle repositories, fund bridge, deps bag. 1 fix round (PH4-C5: real-Postgres proof of the fourth uniqueness claim). |
| 9 | `ab0a605` → `c8b4eb3` | Upload as reserve/write/confirm. 1 fix round (PH4-C6: `DuplicateImportError` on a lost race). |
| 10 | `fb60d10` → `1fcedd0` | Scan and parse through the existing engine. 1 fix round (PH4-C7, Critical: `scanImport`/`parseImport` orchestrators replace `scanStep`/`parseStep`). |
| 11 | `f5555d1` → `b4836ee` | Review, verify, apply into records/components. 1 fix round (PH4-C8: mapping-rule merge moved to the repository layer). |
| 12 | `7e779bf` | Read imports/records, earnings summary. Review clean. |
| 13 | `9b2cb8b` → `784e928` | Read-gated original, purge expired originals. Implementer paused pre-code (PH4-C9); 1 fix round (PH4-C10: test-comment overclaim). |
| 14 | `23f2a48` | Hourly ingest job, daily retention job. Review clean — first task to call `scanImport`/`parseImport`/`purgeExpiredOriginals` correctly on the first attempt. |
| 15 | `e1c93e4` → `fd2753f` | Payroll pipeline over `/api/v1`. 1 fix round (PH4-C11, Critical: `/retry` authorization bypass closed). |
| 16 | `4c73c60` → `978ac1b` | Review queue/form moved into the payroll module. 1 fix round (PH4-C12: server-fresh queue advance). |
| 17 | `5223df1` → `85d10c6` | Company payroll upload/list/review pages. 1 fix round (PH4-C13: CSP `frame-ancestors` narrowed). |
| 18 | `098e37e` | Company Overview and Earnings pages. Review clean. |
| 19 | `d786716` + `6633b2d` | `/work` retired, Time Off relocated, navigation rewired. Review clean; implementer's own mandated grep found and fixed three dangling `/work` references in a same-task follow-up commit. |
| 20 | `35535e3` | Paperless-to-payroll mapper (`mapLegacyPayslip`). Review clean. |
| 21 | `f349f3b` | Migration and validation scripts (wave 1). Review clean; implementer self-flagged and fixed a transaction/I/O restructuring and an RLS-blind-read defect in the validator. |
| 22 | `e691078` | Paperless retirement: client, routes, env, thirteen test stubs (wave 2). Review clean. |
| 23 | `a45ac45` | Docs: pipeline, provider, two-wave runbook. Review clean. |
| 24 | (this task) | Verification gate, checkpoint, this ledger. |

**Attention-lens note for any future whole-branch review of this phase**, per
a peer session's advice recorded in `progress.md`: the classes that
transported from Phase 3 and recurred here are memory-fake-vs-Drizzle
divergence (PH4-C8), constraints asserted in prose but never proven against
real Postgres (PH4-C5), and — new to this phase — the "I/O inside an open
transaction" defect class appearing three separate times (Tasks 7, 10, 13)
and a test-overclaiming pattern appearing twice (Tasks 10, 13). Any future
phase touching `documents.*`/`scanner.*`-shaped ports, or writing a test that
claims to prove transaction isolation, should carry these as a standing
review lens.
