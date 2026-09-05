# Checkpoint: Phase 4 complete, whole-branch fix wave closed (2026-09-05)

Resume from here with any model. Read this file, then the spec, then the plan.

This checkpoint supersedes the version committed as `e189714`. That version
was written against Task 24's own commit, before the Phase 4 whole-branch
review had reported — it recorded a verification run and a graph the
review's fix wave then invalidated. This is a correction in place, not an
addendum: the range, the verification numbers and the phase's content below
are all re-stated as they stand now, after the fix wave closed — the same
situation, and the same fix, Phase 3's own checkpoint needed after its
whole-branch review (see `docs/superpowers/handoff/2026-09-05-phase-3-checkpoint.md`'s
own opening section for the precedent).

## State, plainly, up front

- **Phase 4 is implemented and NOT deployed. Phases 2 and 3 are not deployed
  either, and Phase 4 stacks on both** — same order as Phase 3's own
  checkpoint stated: Phase 2's runbook and its still-owed §9 walkthrough
  first, then Phase 3's runbook, then Phase 4's (`docs/deploy/phase-4-runbook.md`).
- **The Paperless migration has not been run in production.** The twelve
  original payslips exist only in Paperless today. `scripts/migrate-paperless.ts`
  (wave 1) has never executed against a real database. Until wave 1 runs and is
  validated, deleting Paperless (wave 2, already committed at `e691078`) would
  lose those twelve originals permanently — this is exactly why the runbook
  insists on two separate deploy waves rather than one.
- **`MALWARE_SCANNER` is `none` in every environment, by design** (spec §13.3).
  The scanning boundary exists unconditionally; nothing has been configured to
  answer it yet. Every import this pipeline clears records `scanner: "none"`
  on its row — "nothing scanned this" is a fact on the data, not an assumption
  a reader has to know to make.
- **Ruling R4-18: there is no auto-verify branch.** Every ingested import lands
  in `needs_review` (or `needs_ocr`); nothing is ever auto-`verified`. The
  confidence data that branch would need (`confidence` jsonb) is already
  persisted per field on every component, so Phase 8 can add the branch
  without a migration when `organization_policies` exists to configure it.
- **`withJobLock` (`src/lib/repo/jobs.ts`) is an OPEN, escalated, platform-wide
  defect — NOT fixed by this phase.** The whole-branch review found that
  `withJobLock` IS `db.transaction` (`pg_try_advisory_xact_lock` is
  transaction-scoped by design), so every job that calls it runs its *entire*
  body — including network I/O — inside one open Postgres transaction. This
  was confirmed to ALSO affect Phase 1's already-deployed jobs
  (`wallet-accounts-sync.ts`, `interest-accrual.ts`, `sync-queue.ts`), not
  just this phase's two new jobs. Phase 4's fix wave corrected only the three
  false Phase-4-authored doc-comments that claimed the opposite; the
  `withJobLock` primitive itself was deliberately **not** rewritten here and
  remains open. See "What the whole-branch review found" below and "What
  remains" for the full detail — do not read this as fixed.

## Range implemented

- Branch: `main`, HEAD after this correction's own commit (`docs(handoff):
  correct the Phase 4 checkpoint for the whole-branch review`, on top of
  `165270a`). **Not pushed to `origin`** — same as every prior phase;
  `origin/main` remains far behind.
- Range: `548143d..165270a` — **56 commits**:
  - `548143d..e189714` (34 commits) — the pre-flight plan repair plus Tasks
    1–24, covering the 24 task briefs and their fix rounds (see the original
    breakdown below), and Task 24's own now-superseded checkpoint/ledger
    commit.
  - The whole-branch review itself ran once, over `e189714..HEAD` conceptually
    (its dispatch produced no commits of its own — it is a review, not a
    code change), split four ways by area (`wb-1` persistence/RLS/infra,
    `wb-2` business logic/jobs, `wb-3` API/UI, `wb-4` Paperless
    retirement/docs), **each dispatched on the most capable model**.
  - `5446ac1..165270a` (**22 commits**) — four sequential fix batches
    closing the review's findings, mirroring Phase 3's own three-batch
    precedent (one implementer at a time, never concurrent, on this
    project's shared `main` branch): **A** (wb-1 — `5446ac1`, `514e51b`,
    `31b56fd`, `683b802`, `14b8815`; 5 commits), **B** (wb-2 —
    `957834c`, `7f72657`, `fbaab6d`, `1ea3959`, `f5259a1`, `dbfb948`,
    `ced0589`, `ae5d526`; 8 commits), **C** (wb-3 — `882f991`, `8a49dae`,
    `9e20ccf`, `ab512c8`, `5f427bc`, `bafb60b`; 6 commits), **D** (wb-4 —
    `f44d976`, `1430fdf`, `165270a`; 3 commits). Sequential rather than
    parallel for the same reason Phase 3's batches were: no worktree
    isolation on this shared branch, and the standing rule against
    concurrent implementers held throughout. Each batch was independently
    re-reviewed against its own diff package and **approved on the first
    re-review**, all four.
  - Within the original `548143d..e189714` range: several tasks carried one
    additional fix commit from the controller's own review process (Task 1:
    1 fix round: RLS split + `version` column; Task 8: 1 fix round:
    real-Postgres proof of `payroll_records_import_uq`; Task 9: 1 fix round:
    `DuplicateImportError` on a lost create-time race; Task 10: 1 fix round:
    split `scanStep`/`parseStep` into DB-only halves plus I/O orchestrators,
    Ruling PH4-C7; Task 11: 1 fix round: merge global mapping rules at the
    repository layer; Task 13: 1 fix round: soften an overclaiming test
    comment; Task 15: 1 fix round: close the `/retry` authorization bypass;
    Task 16: 1 fix round: server-fresh queue advance; Task 17: 1 fix round:
    exact-match `frame-ancestors`). No task needed more than one fix round.
    Task 19 also carried a same-task follow-up commit (`6633b2d`) fixing
    three dangling `/work` references its own mandated grep found.
- `git log --oneline e189714..HEAD` shows the 22 whole-branch-review fix
  commits in order, each carrying a real `Co-Authored-By:` trailer —
  confirmed by direct inspection of several commits (`165270a`, `f44d976`,
  `882f991`, `957834c`, `5446ac1`), not merely trusted from the log listing.

## Verification, **re-run fresh by this correction task**

The fix wave invalidated Task 24's original run, the same way Phase 3's fix
wave invalidated its own Task 23 run (ruling P3-C47) — nothing below is
inherited from Task 24's report:

- `npx tsc --noEmit` — **clean, exit 0, no output.**
- `npm test` — **1183 tests / 123 files, all passing** (Task 24's original
  figure: 1155/123; after fix batch A: 1170/123; after batch B: 1179/123;
  after batch C: 1183/123; batch D touched only docs/scripts so left it
  unchanged at 1183 — the figure below matches the ledger's own count for the
  closed fix wave). Includes `src/platform/http/openapi-drift.test.ts` (1
  test) and `src/middleware.test.ts` (4 tests, new in batch A's precursor
  Task 17 fix round) — the OpenAPI drift check the exit criteria call for is
  inside this suite, not a separate command.
- `npm run test:db:up && npm run test:integration` — **186 tests / 39 files,
  all passing** (Task 24's original figure: 180/39; after fix batch A: 181;
  after batch B: 182; after batch C: 186/39; batch D again docs/scripts-only,
  unchanged), against the throwaway `dashboard-postgres-test` container only;
  no real database was touched at any point in this task. Includes
  `src/lib/db/payroll-rls.itest.ts` (11 tests — 6 original plus the 5 the
  Task 1 fix round added), `src/modules/payroll/infrastructure/ingest.itest.ts`
  (8), `read-original.itest.ts` (6), `purge-expired-originals.itest.ts` (6),
  and `src/modules/payroll/infrastructure/repositories.itest.ts` (10, proving
  all four of the plan's global uniqueness claims against real Postgres).
- `npm run build` — **succeeds.** The route table lists `/company`,
  `/company/earnings`, `/company/earnings/[recordId]`, `/company/payroll`,
  `/company/payroll/[importId]` and `/company/time-off`, and does **not**
  list `/work`, `/api/jobs/payslip-webhook` or `/api/paperless/preview/[id]` —
  confirmed by reading the full printed route table, not by grep alone.
- `npm run e2e` — **NOT re-run in this correction, deliberately.** Task 24
  already ran it once (4/4 passing, `smoke.spec.ts`/`settings.spec.ts` in
  both Playwright projects) against a hand-started `next dev` server. None of
  the four fix batches touched auth, navigation shell, or the settings/smoke
  surfaces those specs exercise — all four batches are scoped to payroll
  internals, job-lock doc comments, and Company/Home pages the e2e suite
  doesn't visit — so nothing in this correction's own diff review found a
  reason to expect a different result, matching how Phase 3's own correction
  handled its one other unchanged verification surface (`npm run
  openapi:generate`, confirmed clean by diff inspection there rather than
  re-run). This is a judgment call, not a hard proof; if a future session
  finds reason to doubt e2e coverage of the fixed pages, it should be re-run
  then. The test database container from the earlier steps was torn down
  with `npm run test:db:down` after the integration run above.

### Grep checks (Step 2)

- `grep -rn "paperless\|Paperless\|PAPERLESS" src scripts` — hits are exactly
  the permitted set from Task 22 Step 9 (the three parser fixtures, the two
  historical-sample comments in `anchors.ts`/`teamsystem.ts`, `legacy.ts`'s
  frozen `paperless_doc_id` column, `paperless-import.ts` and its test, and
  `scripts/validate-paperless-migration.ts`) **plus** the six comment-only
  files Task 22's own review already found and reconciled as harmless
  (`middleware.ts`, `src/lib/repo/payslips.ts`, `domain/period.ts`,
  `infrastructure/ingest.ts`, `api/routes.ts`, and the two migration scripts'
  comments about `PAPERLESS_*` being unnecessary) — zero broken imports, zero
  surviving call sites (confirmed separately by `tsc` passing clean, which is
  the load-bearing proof: any surviving call site would fail to compile since
  `PAPERLESS_*` is out of `env.ts` and `"paperless"` is out of both service
  unions).
- `grep -rn '"/work' src` — one hit, in `navigation.test.ts`, asserting the
  navigation items do **not** contain `"/work"` — a negative assertion
  proving the retirement, not a live reference. No route, import or link
  named `/work` survives.
- `grep -rn "payslip_ingest" src` — **zero hits.**
- `grep -rn 'z.enum(\["accounts", "leave", "transactions"\])' src/modules/integrations/api/schemas.ts`
  — both `SyncKind` occurrences (lines 43 and 78) still read exactly
  `["accounts", "leave", "transactions"]`, confirming this phase added no new
  `SyncKind` (Ruling R4-15: `payroll_silo` is a connection, not a sync).
- `git diff 548143d..HEAD -- .env.example docker-compose.yml dashboard-app/src/lib/env.ts | grep '^+' | grep -E 'z\.(url|string)\(\)(\.min)?'`
  — two matches, both false positives of the grep pattern (it matches the
  substring `z.string()` regardless of what follows): `DOCUMENT_STORE_LOCAL_PATH`
  (`z.preprocess(blankToUndefined, z.string().optional())` — optional, not
  required) and `CLAMD_HOST` (`z.preprocess(blankToUndefined, z.string().default("clamav"))`
  — defaulted). Neither is a bare required `z.string().min(...)`. Confirmed
  separately by inspecting the removed lines: the **only** removals across
  `.env.example`, `docker-compose.yml` and `env.ts` are `PAPERLESS_HOST`,
  `DASHBOARD_PAPERLESS_TOKEN`, `PAPERLESS_URL: z.url()` and `PAPERLESS_TOKEN:
  z.string().min(1)` — both of which *were* required before this phase and are
  gone now. No new required environment variable exists after Phase 4.

## Graphify — NOT re-run for this correction

This correction task deliberately did **not** run `graphify update .` again,
unlike Phase 3's own correction (which did regenerate, because Phase 3's fix
wave added two new migrations and touched files across three modules).
Checked before deciding: `git diff --name-status e189714..HEAD --
dashboard-app/src dashboard-app/docs` shows **zero new files** (no `A` status
lines) across all 22 fix-batch commits — every change is a modification to a
file the graph (below) already indexes; no new module, port, adapter, or page
was introduced. The module *structure* graphify cares about (files, imports,
symbols) is unchanged; only the bodies of existing functions changed. Re-
running would cost an LLM-priced `graphify label` pass for zero structural
gain, so it is deferred, matching this phase's own precedent (Ruling PH4-C3)
of running it once at the very end rather than per change. If a future
session's `graphify query` against this module returns stale-looking results,
re-run it then — the figures below (3979 nodes / 11599 edges / 170
communities) are Task 24's own last-known-good numbers, not re-verified by
this task, and should be treated as approximate until the next real
regeneration.

## Graphify (Step 3 — the one task in this phase permitted to run it, as of Task 24)

`graphify update .` run once from the repo root, per Ruling PH4-C3 (every
implementer from Task 3 onward was told not to run it or stage
`graphify-out/`, deferring the whole phase's regeneration to this task, the
same pattern Phase 2's P2-C15 and Phase 3's P3-C2/P3-C47 established).

**Result: 3979 nodes, 11599 edges, 170 communities** (up from the pre-Phase-4
figure recorded in Phase 3's checkpoint: 3393 nodes, 9750 edges, 166
communities). Spot-checked by query rather than trusted from the summary
line alone:
- `graphify query "payroll module structure"` surfaces the full
  `modules/payroll` tree — ports, domain, infrastructure (including the two
  new orchestrator files `infrastructure/ingest.ts` and
  `infrastructure/read-original.ts`/`purge-expired-originals.ts`), the two
  new jobs (`payroll-ingest.ts`, `payroll-retention.ts`), and both Company
  pages.
- `graphify query "work module"` returns nothing under `src/app/(app)/work` —
  the deleted tree is genuinely gone from the graph, not merely absent from a
  stale cache.
- `graphify query "paperless client provider"` surfaces only
  `paperless-import.ts` (the migration mapper, which the plan keeps by
  design) — no Paperless client, adapter or route survives in the graph.

Same two warning classes as Phase 3's regeneration, one count larger: JSON/
config files producing zero nodes, and `.sql` files uncounted because
`tree_sitter_sql` is not installed (now including migration `0015`).
`graphify-out/` is committed as part of this task's own commit.

## Step 4: the manual walkthrough — not run, and correctly so

**This cannot be driven by an automated agent in this environment** — there is
no real `payroll_silo` credential, no real payslip PDF, and no authenticated
browser session here, the exact same limitation Phase 2's and Phase 3's own
checkpoints recorded for their walkthroughs. Nothing in the brief's Step 4
ten-item checklist was attempted, and none of it should be read as verified.
It is genuinely pending, not skipped for convenience.

Whoever holds a real silo credential and a real payslip PDF runs it once after
deploying (`docs/deploy/phase-4-runbook.md`), and records the result as a
dated addendum to this checkpoint, the same way Phase 1's production deploy
got its own section in the Phase 0/1 checkpoint. The ten items (setup state,
connect + test round-trip with no secret echo, upload → Scanning → Needs
review, PDF renders in the review pane confirming Task 17's CSP fix, correct
one figure → Confirm → Apply → Earnings/Cometa move, re-upload the same file
→ "already uploaded" (**the phase's own exit criterion**), a corrected
payslip → Applied → previous import reads Superseded, `GET .../original` on a
still-scanning import → `409`, the Scheduled-jobs panel lists `payroll_ingest`
and `payroll_retention`, and — if clamd is enabled — the EICAR ordering check)
are reproduced verbatim in the task brief and are not repeated here to avoid
two documents drifting apart.

## What the whole-branch review found, that 24 passing task reviews had not

Each of the 24 tasks' own per-task reviews was individually clean, and Task
24's original checkpoint was an accurate account of the tree it measured. But
a per-task reviewer cannot see across tasks. The whole-branch review —
dispatched over the full `548143d..e189714` range (34 commits) — split **four
ways by area**, so each reviewer could carry the phase's own observed defect
classes as its attention lens, **each dispatched on the most capable model**:

- `wb-1` — persistence / RLS / infra
- `wb-2` — business logic / jobs
- `wb-3` — API / UI
- `wb-4` — Paperless retirement / docs

It found **2 Critical defects** and **22 Important findings** across the four
areas (5 from `wb-1` including its Critical, 8 from `wb-2` including its
Critical, 6 from `wb-3`, 5 from `wb-4`). Both Criticals, in full:

**Critical 1 (`wb-1`, persistence/infra) — FIXED.**
`documentStoreConfigured()` (`document-store-resolver.ts`) returned
`e.DOCUMENT_STORE_DRIVER === "silo" || Boolean(e.DOCUMENT_STORE_LOCAL_PATH)`
— but `DOCUMENT_STORE_DRIVER` **defaults** to `"silo"`, so in **any**
deployment that has not explicitly configured it, this returned `true`
unconditionally, with no `payroll_silo` connection required. `resolve.ts`'s
`payroll` feature falls back to `payrollConfigured()` exactly when
`states.payroll_silo === "not_configured"` — so a fresh, unconfigured
deployment got `features.payroll = true`. Every page that gates on
`!caps.features.payroll` to show the "Connect a payroll document store"
setup state (`/company/payroll`, `/company/time-off`) never showed it —
execution fell through to `loadImports()` → `resolveDocumentStore` returns
`null` → an uncaught `DocumentStoreUnavailableError`. This broke the default,
unconfigured deployment experience entirely — exactly the state the setup UI
was built to handle gracefully. Root cause: `documentStoreConfigured()` and
`resolveDocumentStore()` answered the same underlying question and nothing
ever tested them against each other. **Fixed in fix batch A** (commit
`5446ac1`): `documentStoreConfigured()` now genuinely delegates to the same
resolution logic `resolveDocumentStore()` uses, re-verified with a
`features.payroll === false` test wired to the real function, not a stub.

**Critical 2 (`wb-2`, business logic/jobs) — OPEN, platform-wide, NOT
fixed by this phase. Read this carefully; it must not be read as resolved.**
`withJobLock` (`src/lib/repo/jobs.ts`) **IS** `db.transaction` —
`pg_try_advisory_xact_lock` is transaction-scoped by design. Both
`payroll-ingest.ts` and `payroll-retention.ts` call `withJobLock(key, () =>
ingestOne(...))` / `withJobLock(key, () => purgeExpiredOriginals(...))`, so
the **entire job body** — every `resolveDocumentStore`, `store.get/put/delete`,
`scanner.scan` (clamd), and `parsePayslip`'s LLM HTTP call — runs while a
Postgres transaction is open, holding one of the pool's 8 connections
idle-in-transaction for the duration. Retention is worse: **one** transaction
spans the entire 100-item batch (100 sequential network deletes plus 100
nested `withUserContext` transactions). Three Phase-4-authored doc-comments
explicitly claimed the opposite ("this job never opens a transaction around
either call... exactly the defect Task 10 was fixed to remove"), and both
jobs' unit tests stub `withJobLock` to bypass the transaction entirely — so
nothing in this phase's own test suite could ever have caught this.
**Confirmed NOT a Phase 4 invention**: `wallet-accounts-sync.ts`,
`interest-accrual.ts`, and `sync-queue.ts` — all Phase 1, all already
deployed to production — share the identical `withJobLock` pattern, meaning
this most likely already affects those deployed jobs today. **What this
phase's fix wave actually did (fix batch B, commit `957834c`): corrected only
the three false Phase-4-authored doc-comments that claimed `withJobLock` kept
I/O out of a transaction.** The `withJobLock` primitive itself was
**deliberately not rewritten** inside Phase 4's own fix wave — this is a
platform-wide issue spanning Phases 1 through 4, not something to fix
unilaterally inside one phase's fix loop, and it was escalated directly to
the user rather than improvised under a fix-round's time pressure. It remains
an **open, escalated item** — see "What remains" below. No mitigation beyond
the doc-comment correction has shipped.

**The 22 Important findings**, grouped by area (full detail, including every
finding's own reviewer reasoning, lives in `progress.md`'s `wb-1` through
`wb-4` sections and the four fix-batch sections):

*wb-1 (persistence/infra), 4 fixed in batch A:*
- `S3DocumentStore` didn't validate keys the way `LocalDocumentStore` did
  (defense-in-depth gap, not live given keys are always server-generated
  today) — both adapters now share one key-validation function called on
  every verb.
- `sigv4.ts`'s `canonicalPath` double-encoded an already-percent-encoded
  `URL.pathname` (unreachable today since `newStorageKey` emits only
  unreserved characters, but a live trap for any future key shape) — fixed,
  independently re-verified by hand-recomputing the full canonical-request →
  signature chain for a path with a space.
- The silo provider's `onDisconnect` does real network I/O, falsifying
  `disconnect-integration.ts`'s own documented invariant that no provider
  hook does (inert today only because Ruling PH4-C4 means nothing calls it
  yet) — the doc comment corrected to state the real invariant.
- The legacy fund-deposit bridge's conflict-update field list (`source`,
  `payslipId`) was unmodelled by the Memory fake and untested on a second
  write over an existing row (matches the retiring code's behavior exactly,
  not a regression) — the fake's test now seeds a genuinely different prior
  state rather than a self-matching write; see also the parked note below.

*wb-2 (business logic/jobs), 7 fixed in batch B:*
- The status-transition table (`canTransition`) was defined, tested, and
  never enforced — a rejected import mid-scan could be silently resurrected
  by `applyScanConclusion` patching it back to `extracting`/`clean` — now
  enforced before applying a scan/parse conclusion.
- `"received"` was a dead-end status with no recovery path if a crash landed
  between a successful bytes upload and the DB commit — the retry route can
  now recover a `received` import stuck by a partial upload.
- Aggregate earnings buckets silently presented a partial sum as a total
  (`addMoney(x, null) === x`, so one unparseable month's gross vanished from
  a year total with no signal) — now flagged as a partial figure rather than
  presented as a total.
- A failed partial upload could orphan bytes in the store forever, outside
  every retention path — a best-effort delete now runs before recording the
  upload as failed.
- `payroll_records.corrections` was written as the wrong shape via a double
  `as unknown as` cast (dead today only because nothing read the column
  back) — retyped to match what `applyImport` actually writes.
- Money crossed floating point in three undocumented places (`review-import.ts`'s
  `Number(raw)` on a reviewer's corrected value, `paperless-import.ts`,
  `load-company.ts`'s `averageOf`) — harmless at real payslip magnitudes but
  `DECIMAL_RE` had no bound on integer-part length — bounded to what
  `numeric(16,2)` can hold.
- The ingest job had no failure counter or backoff, so a permanently-failing
  import head-of-line-blocked the entire hourly batch, re-triggering a paid
  LLM call every tick forever — a repeatedly-failing import now sorts to the
  back of the queue.

*wb-3 (API/UI), 6 fixed in batch C:*
- `/company/earnings` and `/company/earnings/[recordId]` had no
  `features.payroll` gate unlike their three siblings — now gated, including
  in `generateMetadata`.
- `/company/payroll/[importId]` was gated only on `payroll.read` while its
  own list page and nav require `payroll.upload`/`.review` — now gated on the
  same permissions as `/company/payroll`.
- Two incompatible queue definitions (`load-payroll.ts`'s `AWAITING` included
  `"verified"`, `actions/payroll.ts`'s `nextInQueue` did not) silently
  stranded a verified-but-not-yet-applied import — unified behind one shared
  `AWAITING_STATUSES`/`queueEntryFrom` helper.
- The `payroll_imports` Home card was declared and fully tested but never
  rendered on the actual Home page — now wired up.
- Italian UI copy outside `component.labelRaw` inverted the retired page's
  own convention and named the thirteenth month three different ways across
  three screens — restored to hint-only Italian and one consistent English
  rendering.
- No negative-permission test existed for the `payroll.review` or
  `payroll.read_original` tiers — viewer-denial coverage added for both.

*wb-4 (Paperless retirement/docs), 5 fixed in batch D:*
- `settings/admin/page.tsx`'s `JOBS`/`JOB_LABEL` never gained
  `payroll_ingest`/`payroll_retention` — both jobs ran but were invisible in
  the only job-health UI — now shown in the admin jobs panel.
- The runbook's migration command had no `--out`, defaulting to a path that
  doesn't exist on the read-only production container (would crash with
  `EROFS` after all DB writes already committed) — fixed, and cross-checked
  against the deleted `migrate-paperless.ts` source (recoverable via `git
  show f349f3b:...`) to confirm the real flag name.
- Root `README.md` (outside the `src scripts` grep scope every retirement
  check used) still documented `PAPERLESS_*` as a required boot variable —
  corrected, retired references dropped.
- The validation script's "OK" message couldn't distinguish "checked twelve
  payslips" from "checked zero" — the wrong shape for an irreversible wave-2
  gate — now reports a trustworthy count.
- The validator never confirmed the migrated bytes actually reached the
  document store (only compared money fields) — a silent `store.put` failure
  would still validate green — closed alongside the other validator fix.

All four batches were independently re-reviewed against their own diff
package and **approved on the first re-review**.

## Deferred and parked findings — none of these were fixed

The whole-branch review also surfaced findings that were deliberately **not**
fixed, and are carried forward here rather than allowed to disappear:

- **The fund-deposit bridge's conflict-update field list note** (`wb-1`,
  above): the underlying production behavior matches the retiring code
  exactly, not a regression — only the *test coverage* for it was improved
  in batch A; the divergence-class risk itself (what a second write preserves
  on `source`/`payslipId`) is not eliminated, just now honestly tested.
- **Three Minor/Low issues introduced by fix batch B's own fixes, parked, not
  fixed** (self-clearing, non-blocking): an undeclared `partial` field is now
  returned by `/payroll/earnings` but is not in the published OpenAPI schema;
  `recordFailure` exposes raw job-internal error text to the client and
  bumps `version` (can cause a spurious `409` for a reviewer mid-session);
  `partial.contributions` will be noisy (true for most ordinary payslips)
  once ever surfaced in the UI.
- **One out-of-scope observation from fix batch C's re-review, parked:** two
  other pending-count displays (`load-company.ts`'s Overview banner,
  `time-off/page.tsx`'s banner) still use the old two-status filter that
  predates the queue-definition fix above, so they can now disagree with the
  corrected queue/Home-card count on the same underlying data. A cosmetic
  display inconsistency, not a correctness or workflow-blocking issue — noted
  for a future pass, not fixed here.
- **Ruling PH4-C4's disconnect-with-purge gap** (unchanged from Task 24's
  original checkpoint — the whole-branch review's `wb-1` result independently
  re-confirmed it, listing the same `onDisconnect` network-I/O invariant
  violation as one of its four Important findings): still a no-op in
  practice, still requires the cross-provider `onDisconnect` fetch/apply
  split described in "What remains" below.
- **`withJobLock`'s transaction-scoping defect itself** (Critical 2 above):
  not fixed, not parked in the small sense — escalated as a standing
  platform-wide item. See "What remains."

## What this phase added

**Database** — one additive migration, `0015_payroll.sql` (regenerated once
in place during Task 1's fix round to correct its RLS policy split — see
Ruling PH4-C2 below — so only one migration number, `0015`, is spent):
`payroll_imports`, `payroll_records`, `payroll_components`,
`payroll_mapping_rules`, all with RLS, plus a `payroll_silo` row seeded into
`integration_providers`.

**`src/modules/payroll/`** — `domain/` (`payroll.ts`, `document.ts`,
`money.ts`, `mapping.ts`, `period.ts`, `components.ts`, `earnings.ts`),
`application/` (`ports.ts` — the nine-member `UseCaseDeps`, `ingest-import.ts`,
`create-import.ts`, `review-import.ts`, `apply-import.ts`, `read-original.ts`,
`purge-expired-originals.ts`, `list-records.ts`), `infrastructure/` (four
Drizzle repositories plus the memory pair, `s3-document-store.ts`,
`local-document-store.ts`, `sigv4.ts`, `document-store-resolver.ts`,
`clamd-scanner.ts`, `scanner-resolver.ts`, `silo-provider-adapter.ts`,
`upload.ts`, `ingest.ts` — the `scanImport`/`parseImport` orchestrators,
`read-original.ts`, `purge-expired-originals.ts`, `legacy-fund-deposits.ts`,
`paperless-import.ts` — the migration mapper, `deps.ts`), `api/` (`routes.ts`,
`schemas.ts`), `ui/` (`load-payroll.ts`, `load-company.ts`, `queue.ts`,
`status.ts`, `SalarySection.tsx`, review form and queue components).

**Pages** — `/company`, `/company/earnings`, `/company/earnings/[recordId]`,
`/company/payroll`, `/company/payroll/[importId]`, `/company/time-off`
(replacing `/work`, deleted).

**Jobs** — `lib/jobs/payroll-ingest.ts` (hourly tier: calls `scanImport`/
`parseImport` as atomic units) and `lib/jobs/payroll-retention.ts` (daily
tier: calls `purgeExpiredOriginals` as an atomic unit). Both `JobName`
entries added by Task 14; `"payslip_ingest"` removed by Task 22.

**Touched outside the new module** — `src/platform/integrations/types.ts`
(`ProviderCode` widened with `"payroll_silo"`), `src/platform/capabilities/`
(probes, resolve, permissions, navigation — the fourth permission code
`payroll.read`, Ruling R4-17), `src/middleware.ts` (CSP `frame-ancestors`
narrowed to the `/original` route, Ruling PH4-C13), `src/lib/contracts.ts`
(`JobName`), `src/lib/clients/http.ts` (`UpstreamService`, `"paperless"`
dropped), `src/lib/env.ts` (`DOCUMENT_STORE_*`, `MALWARE_SCANNER`,
`CLAMD_*` added; `PAPERLESS_*` removed), `src/lib/repo/payslips.ts` (write
functions and dead readers deleted), thirteen test files' `PAPERLESS_*` env
stubs removed.

**Corrected final function names — differ from the plan's original text.**
The plan's Interfaces blocks for Tasks 10 and 13 originally specified
`scanStep`/`parseStep` (Task 10) and literal `readOriginal`/
`purgeExpiredOriginals` operating directly on a shared transactional `deps`
bag (Task 13). Both were found, during execution, to bundle DB reads/writes
together with network or disk I/O (`documents.get`, `scanner.scan`, LLM
calls, `documents.delete`) inside what the only production code path builds
as a single open Postgres transaction (`payrollDeps(tx, opts)` inside
`withUserContext`) — the exact "I/O outside Postgres inside an open
transaction" pattern this plan's own Global Constraints forbid. The functions
Task 14's jobs, Task 15's `/retry` route and every other caller actually call
are:
- **`scanImport(principal, importId, opts?)`** and **`parseImport(principal, importId, opts?)`**,
  from `src/modules/payroll/infrastructure/ingest.ts` (fixed at Task 10, Ruling
  PH4-C7 — the single most consequential fix in this phase; see below).
- **`readOriginal(...)`**, from `src/modules/payroll/infrastructure/read-original.ts`.
- **`purgeExpiredOriginals(...)`**, from
  `src/modules/payroll/infrastructure/purge-expired-originals.ts`.

Each orchestrator resolves `documents`/`scanner` before any transaction opens,
does its DB-only read/guard in one short `withUserContext`/`withSystemContext`,
performs the I/O with no transaction open, then does its DB-only write in a
second short context — mirroring Task 9's `uploadPayslip` exactly. The DB-only
halves (`beginScan`, `applyScanConclusion`, `beginParse`, `applyParseConclusion`)
stay in `application/ingest-import.ts`. Any document that names `scanStep`,
`parseStep`, or describes Task 13's functions as taking a shared `deps`
directly, predates these fixes and is wrong.

## Rulings — planning (R4-1 … R4-18)

All eighteen made before execution, binding on it, taken from the plan's own
`## Rulings` section (`docs/superpowers/plans/2026-09-05-phase-4-payroll-and-company.md:245`).
R4-1…R4-12 were carried forward from a superseded draft and re-verified
against the current tree; R4-13…R4-18 are new to this planning pass.

- **R4-1 — Document bytes never enter Postgres.** Only metadata is stored;
  bytes go to a `DocumentStore` port (`s3-document-store.ts` against the
  silo, `local-document-store.ts` for dev/test). The silo's credentials live
  encrypted in `integration_connections` under the new `payroll_silo`
  provider, not in env vars. Object keys are server-generated, unguessable
  (`payroll/{userId}/{YYYY}/{32 hex}.pdf`), and never derivable from anything
  the client sees. No pre-signed URLs; every read is proxied and
  authorization-checked. *Cost if wrong:* a guessable or client-influenced key
  would let one user read another's payslip by URL manipulation alone —
  the single most sensitive data class in this phase.
- **R4-2 — The scanning boundary is a `MalwareScanner` port**, no-op default
  (`clean`/`none`) plus a clamd adapter. Verdict persisted for audit. An
  `infected` verdict deletes bytes immediately and terminally rejects with no
  re-read; `unavailable` keeps bytes and retries. Parsing is gated on
  `scan_status = 'clean'`; `readOriginal` refuses a non-clean import with
  `409`. *Cost if wrong:* an infected file could reach the parser or be served
  back to the user before it cleared the boundary.
- **R4-3 — Idempotency rests on `(user_id, sha256)` and
  `(user_id, idempotency_key)` unique database indexes**, not an application
  check alone. A `failed` import (bytes never landed) is reused, not
  duplicated. **[corrected]** No savepoint around the reservation insert:
  the upload is split into reserve → write bytes → confirm (Task 9), so the
  reservation transaction holds nothing but the insert and a lost race can
  simply roll back and re-read in a fresh transaction. *Cost if wrong:*
  uploading the same payslip twice could silently create two imports and two
  records — this phase's own exit criterion, named explicitly in the spec.
- **R4-4 — Replacement supersedes, never overwrites.** A correction gets its
  own import; applying it supersedes the old record (`superseded_at`,
  `superseded_by_record_id`) and only then inserts the new one, in one
  transaction, keeping `payroll_records_period_uq` a hard constraint.
  Superseded components are kept as evidence, never deleted. *Cost if wrong:*
  a corrected payslip could silently erase the record of what the pipeline
  originally extracted, or violate the one-live-record-per-period invariant
  under concurrent apply.
- **R4-5 — The daily retention job deletes only bytes, never rows.** Capped at
  100 objects/run, idempotent (skips a row with no `storage_key`), and never
  touches a live-status import. *Cost if wrong:* a misconfigured retention
  window could wipe the entire archive in one tick instead of giving an
  operator a day to notice.
- **R4-6 — Apply is idempotent and re-runnable, never reversible.**
  Re-applying recomputes the record, bumps `version`, replaces components
  wholesale, re-upserts the legacy `fund_deposits` bridge row. No `unapply`;
  the reverse of a wrong apply is a superseding replacement (R4-4). *Cost if
  wrong:* an accidental double-apply could double-count a month's earnings on
  the legacy Funds bridge, or an invented "undo" could leave Earnings with an
  unexplained hole.
- **R4-7 — Paperless removal is two deployment waves, not two phases.** Wave 1
  (Task 21) migrates while the client still exists; wave 2 (Task 22) deletes
  it. `tsc` is the proof nothing still calls the deleted client. *Cost if
  wrong:* deploying wave 2 before wave 1 completes would delete the only
  client capable of downloading the twelve original payslips, losing them
  permanently — this is why the runbook is explicit about ordering.
- **R4-8 — `documents`/`scanner` are resolved by the caller before any
  transaction opens**, because resolving the store may need to decrypt a
  credential (I/O), which must never happen inside an open Postgres
  transaction. *Cost if wrong:* this is the exact defect class Task 10 needed
  a fix round for (PH4-C7) when the rule was violated — a stalled connection
  pool under load, or a transaction held open across a slow S3 round trip.
- **R4-9 — `needs_ocr` is a real, persisted status**, added because the spec's
  status enum omits it but its prose requires it. No OCR adapter exists this
  phase (Paperless was the only source and is being retired); a scanned
  payslip parks visibly rather than being parsed from an empty string. *Cost
  if wrong:* silently parsing nothing would produce a confident-looking
  all-null extraction — exactly the "never invent financial data" failure
  this project's constraints exist to prevent.
- **R4-10 — Mapping targets are recorded on every component, but only
  `fund_contribution` has a Phase 4 consumer.** `timeoff_balance`/
  `timeoff_used` wait for Phase 7; `fund_contributions` proper waits for
  Phase 5. *Cost if wrong:* none stated — this is forward-compatible data,
  not dead code (every target is exercised by `classifyComponent`'s tests).
- **R4-11 — `/work` splits into three destinations along the spec's own page
  map**, not a verbatim move: leave → `/company/time-off`, salary →
  `/company` Overview, payslip list → `/company/payroll`. **[corrected]**
  the superseded draft's "verbatim move" claim was found false during
  verification — `work/page.tsx` mixes three unrelated concerns that a
  verbatim move would have kept mixed on the wrong page. *Cost if wrong:* the
  superseded plan text would have shipped earnings figures on a Time Off page.
- **R4-12 — Earnings reads records, never imports.** `earningsSummary`
  computes gross/net/taxes/contributions from `payroll_records` +
  `payroll_components` with `superseded_at IS NULL`; no page reads
  `payroll_imports` for a financial figure. *Cost if wrong:* a page could show
  a pipeline-state artifact (an import) as if it were settled money.
- **R4-13 — The three signature changes and their tasks. [corrected]** The
  superseded draft misattributed two of three. Verified: `ProviderCode`
  widening and `dataProbes`/`payrollConfigured` replacement both land in Task
  7; dropping `"paperless"` from the service union touches **two unlinked
  places** (`src/lib/clients/http.ts` and `src/lib/contracts.ts`), both
  edited together in Task 22 so the tree never has one compiling against a
  value the other cannot produce. `JobName`'s gain (`payroll_ingest`/
  `payroll_retention`, Task 14) and loss (`payslip_ingest`, Task 22) are
  deliberately split across tasks so the tree type-checks between them. *Cost
  if wrong:* the superseded draft's misattribution would have left one of the
  two service-union call sites compiling against a dead value.
- **R4-14 — `text_source`'s three database values map from the parser's own
  two.** The column carries the spec's `pdf_text|ocr|none`; the parser's
  `TextSource` stays `pdf|ocr` unchanged, mapped by one named function,
  `textSourceColumn()`. `none` is the honest encoding of `needs_ocr`. *Cost if
  wrong:* widening the parser's own type instead would have forced every
  existing `src/lib/payroll/**` test to acknowledge a state the parser can
  never actually produce.
- **R4-15 — `payroll_silo` is a connection, not a sync.** Registers as an
  `IntegrationProvider` for the same credential vault and connect/test/
  disconnect UI as Wallet/Trek, but `syncs` is `{}` and no `SyncKind` is
  added — verified unchanged by this task's own Step 2 grep. `testConnection`
  does a real PUT/GET/DELETE round trip, not a HEAD-only check. `onDisconnect`
  with policy `purge` is specified to delete every object under the user's
  prefix and null their storage keys. *Cost if wrong* (realized in execution,
  see Ruling PH4-C4 below): the purge branch is currently unreachable in
  practice because no caller resolves a `store` onto the disconnect context —
  a real but bounded privacy/retention gap, not a security breach.
- **R4-16 — `local` is a development/test driver, never production.** The
  container runs read-only with tmpfs-only mounts; the resolver refuses
  `DOCUMENT_STORE_DRIVER=local` under `NODE_ENV=production`. *Cost if wrong:*
  a production deploy accidentally configured for the local driver would
  either fail to write originals or silently lose them on every restart.
- **R4-17 — A fourth permission code, `payroll.read`, gates Earnings
  separately from `payroll.upload`/`.review`/`.read_original`.** `viewer`
  gets `payroll.read` only. *Cost if wrong:* reusing `payroll.upload` for a
  read would have denied Earnings to a viewer who may legitimately see
  figures but never a scanned original — realized concretely in Task 15's
  `/retry` bypass (PH4-C11) when a related boundary was, for a time, checked
  too loosely in the other direction.
- **R4-18 — No auto-verify branch this phase.** Spec §7.9 allows it "when
  policy allows"; the policy table (`organization_policies`) is Phase 8's.
  Every import lands in `needs_review`/`needs_ocr`; the confidence data the
  branch would need is already persisted so Phase 8 can add it with no
  migration. *Cost if wrong:* inventing a default policy now would mean
  guessing whether payroll figures should ever post with no human review —
  the spec deliberately leaves that to the organization, not to this phase.

## Rulings — execution (PH4-C1 … PH4-C13, then PH4-C14 … PH4-C22 for the whole-branch review)

Thirteen rulings (PH4-C1 … PH4-C13) made by the controller during the
original 24-task run, none of which the plan's own text anticipated —
carried forward from
`.superpowers/sdd/2026-09-05-phase-4-payroll-and-company/progress.md` with the
same weight as the planning rulings above, **unrenumbered by this
correction**. The whole-branch review and its fix wave added further rulings
— PH4-C14 (the fix-wave batching decision itself) is already recorded in
`progress.md`; the ledger
(`docs/superpowers/handoff/2026-09-05-phase-4-ledger.md`) now also carries
PH4-C15 through PH4-C22, covering both Criticals, each area's Important
findings, the re-verification, and the parked items — read them there rather
than duplicated here.

- **PH4-C1 — pre-flight fix, no code impact.** Task 3's own "Interfaces →
  Produces" block wrongly claimed `resolveDocumentStore`/
  `documentStoreConfigured` as its own output, contradicting its own
  numbered steps, which correctly deferred both to Task 7 (the file cannot
  compile without `SILO_PROVIDER`/`siloCredentialSchema`, written in Task 7).
  Fixed by editing the plan's own text before Task 1 was dispatched. *Cost if
  wrong:* negligible — caught before any code existed, corrects a summary
  header only.
- **PH4-C2 — Task 1's RLS security fix.** `payroll_mapping_rules`'s single
  `USING`/`WITH CHECK` pair let any authenticated user `DELETE` a global
  (`user_id IS NULL`) default mapping rule, or hijack one via `UPDATE ... SET
  user_id = <self>` — Postgres only evaluates `WITH CHECK` for `INSERT` and
  the post-image of `UPDATE`, never for `DELETE`, and `USING` alone gates
  which rows a `DELETE`/`UPDATE` may target. Found independently by an
  automated security-review hook and confirmed by the controller; two more
  Important findings (zero cross-user RLS test coverage for this table; a
  missing `version` column breaking this project's own mutable-entity
  pattern) were found independently by the task reviewer. Fixed by splitting
  the table's RLS into four per-command policies (`SELECT` permissive of
  `user_id IS NULL`; `INSERT`/`UPDATE`/`DELETE` all requiring
  `app_is_system() OR user_id = app_current_user_id()`), adding `version`,
  and adding five new cross-user test cases — with migration `0015`
  regenerated in place (not a new `0016`) since it had not yet been applied
  anywhere. *Cost if wrong:* low to regenerate an unshipped migration; the
  alternative (leaving the authorization gap) was the only costly wrong
  answer.
- **PH4-C3 — every implementer from Task 3 onward was explicitly told not to
  run `graphify update .` and not to stage `graphify-out/`**, overriding
  CLAUDE.md's per-commit instruction for the phase's duration, per the same
  precedent as Phase 2's P2-C15 and Phase 3's P3-C2/P3-C47. This is why
  `graphify-out/` stayed clean (no diff in any task's commit range) until
  this task's own Step 3 regeneration. *Cost if wrong:* none — worst case is
  re-deriving the same regeneration this task already performs.
- **PH4-C4 — Task 7's parked finding: `payroll_silo` disconnect-with-purge
  does not actually delete bytes today.** Ruling R4-15 promises the purge
  branch deletes every object under the user's prefix, and the adapter's own
  `onDisconnect` implements that branch correctly — but
  `disconnectIntegration()` (Phase 2 code, untouched by this plan's 24 tasks)
  never resolves or attaches a `store` to the `DisconnectContext` it builds,
  so the branch is always skipped in practice, and storage-key nulling has no
  caller either. Investigated and confirmed **not safely fixable inside Task
  7**: `onDisconnect` is called inside a single Postgres transaction
  precisely because every other provider's `onDisconnect` does no network
  I/O; wiring a real S3 purge into that same call would reintroduce
  "I/O outside Postgres inside an open transaction" — the same defect class
  fixed at Tasks 10 and 13 (below). The correct fix is a cross-provider
  contract change (splitting `IntegrationProvider.onDisconnect` into an I/O
  phase and a transaction phase, mirroring `SyncHandler`'s `fetch`/`apply`
  split), affecting `wallet` and `trek` too — future work, not a
  payroll-scoped patch. **Parked, not fixed.** *Cost if wrong:* a
  `payroll_silo` disconnect-with-purge silently leaves documents in the store
  when a user expected deletion — a real but bounded privacy/retention gap,
  no cross-user exposure, no credential leak, addressable later without
  reworking any of this phase's other 23 tasks.
- **PH4-C5 — Task 8's missing real-Postgres proof of `payroll_records_import_uq`,
  fixed.** The plan's own Global Constraints name four uniqueness claims
  requiring proof against real Postgres; the brief's itest proved only three,
  leaving the fourth proven only against the Memory fake's hardcoded error
  string — precisely the "invisible to the unit suite because only the fake
  was under test" pattern this project's own retrospective calls its costliest
  defect class. Fixed with one new itest case, isolating the constraint via a
  different `periodStart`/`kind` so only the plain `importId` index can fire.
  *Cost if wrong:* the fix was cheap (one test); the gap it closed was a
  binding global constraint left silently unmet.
- **PH4-C6 — Task 9's concurrent-upload race surfaced as an unhandled error
  instead of the documented `409 duplicate`, fixed.** Two identical uploads
  both observing `findBySha` as not-yet-existing both called `create()`; the
  unique index closed the race at the database level (no duplicate row could
  ever exist), but the loser got a raw Postgres/Drizzle error rather than
  Ruling R4-3's own specified `DuplicateImportError`. Fixed by catching the
  unique-violation narrowly (matched on `payroll_imports_user_sha_uq` in
  `err.cause.message`, not a blanket catch) and re-querying/throwing
  referencing the winning row. *Cost if wrong:* the gap sat between
  "correct at the database" and "correct at the API surface" for one of this
  phase's four load-bearing uniqueness claims — cheap to close, costly to
  leave for a caller that assumed the documented contract.
- **PH4-C7 — Task 10's Critical structural fix: split `scanStep`/`parseStep`
  into DB-only halves plus I/O orchestrators. The single most consequential
  fix in this phase.** As specified, each bundled a DB read, network/disk
  I/O (`documents.get`, `scanner.scan`, text extraction, the LLM call), and a
  DB write into one function operating on a single `UseCaseDeps` — and the
  only production mechanism for building that `UseCaseDeps`
  (`payrollDeps(tx, opts)` inside `withUserContext`) runs the *entire*
  function body, I/O included, inside one open Postgres transaction. This is
  plan-mandated (the brief's own Interfaces block specified this exact
  shape) but load-bearing, since Task 14's jobs and Task 15's `/retry` route
  both call these as atomic units — leaving it unfixed would have meant Task
  14 either inheriting the same defect silently or improvising its own fix
  under time pressure. Fixed by producing new orchestrators
  `scanImport(principal, importId, opts?)` and
  `parseImport(principal, importId, opts?)` in a new file,
  `infrastructure/ingest.ts`: resolve `documents`/`scanner` before any
  transaction, first `withUserContext` is DB-only, I/O runs with no
  transaction open, second `withUserContext` is DB-only — mirroring Task 9's
  already-correct `uploadPayslip` exactly. The old `scanStep`/`parseStep`
  names are fully removed; DB-only halves (`beginScan`,
  `applyScanConclusion`, `beginParse`, `applyParseConclusion`) stay in
  `application/ingest-import.ts`. Re-review traced both orchestrators
  line-by-line and confirmed no I/O-outside-Postgres path runs inside an open
  transaction, and scan-boundary semantics unchanged byte-for-byte. *Cost if
  wrong:* low as a decomposition (no semantics change), but the alternative
  — leaving it — would have shipped a transaction held open across a
  malware-scanner network call and an LLM call, on every scan and parse tick,
  for the life of the phase.
- **PH4-C8 — Task 11's mapping-rules Memory/Drizzle divergence, fixed at the
  repository layer.** `DrizzlePayrollMappingRulesRepository.listFor` never
  returned global (`user_id IS NULL`) rules because no migration seeds any
  via that path, while the Memory fake faked them in from
  `DEFAULT_MAPPING_RULES` — a live instance of this project's own
  costliest recurring bug class, and a contract violation given the port's
  documented "global rules and this user's own" contract. The implementer's
  first fix concatenated the defaults inside `applyImport` itself (correct
  for today, since `applyImport` was the only caller) but left the
  divergence live for any future caller. Fixed by moving the merge into
  `DrizzlePayrollMappingRulesRepository.listFor` itself, so both backends
  genuinely honor the same contract, with a new repository-level test
  including an adversarial user-rule/global-rule `matchCode` collision. *Cost
  if wrong:* the current code worked only because nothing else calls
  `.listFor()` yet; the cost of leaving it would have grown with every future
  task (an admin mapping-rules UI, a classification-preview endpoint) that
  might.
- **PH4-C9 — Task 13's implementer correctly paused before repeating Task
  10's defect.** Before writing code, the implementer identified that the
  brief's literal `readOriginal`/`purgeExpiredOriginals` both bundle
  `deps.documents.get`/`.delete` I/O into a function operating on one
  transaction-bound `deps` — the identical structural defect Task 10 needed
  a fix round for — and asked rather than guessed. Directed to do the full
  split immediately (not the literal brief): DB-only halves plus an I/O
  orchestrator, mirroring `infrastructure/ingest.ts`, landing as
  `readOriginal` in `infrastructure/read-original.ts` and
  `purgeExpiredOriginals` in `infrastructure/purge-expired-originals.ts`.
  This also established the per-item batch-processing shape (read batch
  under system context, each item's I/O plus its own short transaction, one
  item's failure caught and counted) Task 14's retention job depends on.
  This is the plan's **third instance of the same defect class** (Tasks 7,
  10, 13) — flagged explicitly as a pattern for the whole-branch review
  rather than three unrelated incidents. *Cost if wrong:* none realized —
  the implementer's own judgment prevented the defect from landing at all.
- **PH4-C10 — a test-overclaiming pattern found and fixed twice (Tasks 10 and
  13), avoided cleanly by Task 14.** Both tasks' new integration tests
  claimed to "directly prove no transaction spans the fetch/scan/parse," but
  the property each checked (an audit row's absence at a given point) is
  guaranteed by program order alone in both the correct code and the exact
  regression each claims to catch — it would pass identically either way.
  The actual transaction-safety guarantee rests on the direct code-structure
  trace (two visibly separate `withUserContext`/`withSystemContext` calls
  with the I/O between them at plain function scope), independently
  confirmed by two separate reviewers. Fixed by downgrading the claim in the
  test's naming/comments/report rather than engineering a new discriminating
  probe (a `pg_stat_activity` idle-in-transaction check) under time pressure
  for marginal benefit. Task 14's own two new test files were checked
  specifically for this pattern and found clean — they assert only
  observable call counts/results. *Cost if wrong:* the tests' overclaimed
  comments could have misled a future maintainer into trusting test coverage
  that does not actually exist for this property; the real guarantee was
  independently re-verified by code inspection each time regardless.
- **PH4-C11 — Task 15's Critical authorization bypass on `/retry`, fixed.**
  `POST /payroll/imports/{id}/retry` asserted only `payroll.read` (via its
  preliminary `getImport` fetch) before calling `scanImport`/`parseImport` —
  and neither those orchestrators nor the application-layer functions
  underneath them assert any permission at all, since they were designed to
  be invoked only by the internal cron job under a synthetic system
  principal. Task 15 is the first place these functions are exposed to a
  real, arbitrary-role signed-in principal over HTTP; net effect, a
  `viewer`-role principal (holding `payroll.read` only, per R4-17) could
  trigger a genuine re-scan or re-parse — real malware-scanner and LLM
  network calls, real DB writes and audit rows — with zero test coverage of
  any kind for the route. Inherited verbatim from the brief's own hand-rolled
  retry handler (a plan gap, not an implementer deviation), but fixed as
  Critical regardless, with no parking possible for an authorization bypass.
  Fixed by asserting `payroll.upload` before any DB read or mutation, plus
  three new end-to-end tests: happy path, a `viewer` gets a real `403`
  through the app's routing/middleware, and a reject-then-retry sequence
  proves the real `409 conflict` path. *Cost if wrong:* a lower-privilege
  role triggering real side-effecting mutations against a live malware
  scanner and LLM endpoint — exactly the defect class this project's review
  process exists to catch before merge.
- **PH4-C12 — Task 16's queue-advance using stale client data, fixed.**
  `apply()`'s queue-advance used the client-side `props.pending` snapshot
  rather than a server-fresh computation, unlike `confirm()`/`reject()` in
  the same file, which both recompute `next` from a fresh server query.
  Under real concurrent review, another reviewer resolving a different
  import between render and this user's Apply click could send them to an
  already-resolved import — non-destructive (the server rejects with a clear
  `ConflictError`), but a real, self-flagged gap. Fixed by factoring a shared
  `nextInQueue` helper in `app/actions/payroll.ts`, used by all three
  actions, with a new regression test proving the concurrent-reviewer
  scenario is handled correctly. *Cost if wrong:* a confusing but
  non-destructive UX papercut under real concurrent review load, not a data
  integrity issue.
- **PH4-C13 — Task 17's CSP `frame-ancestors` prefix matching more routes than
  intended, narrowed.** `frameAncestorsFor` used
  `startsWith("/api/v1/payroll/imports/")`, matching all six payroll import
  sub-routes (`GET /{id}`, `/verify`, `/reject`, `/apply`, `/retry`,
  `/original`) rather than only the PDF-serving `/original` route the
  comment and plan intent describe. Impact bounded — the policy value stays
  `'self'` either way, never opened to a third party — but real, avoidable
  over-scope. Fixed with an exact-shape regex
  (`/^\/api\/v1\/payroll\/imports\/[^/]+\/original$/`), plus a new dedicated
  `middleware.test.ts` covering all six routes and edge cases (nested/
  trailing-slash false positives) that did not exist before. *Cost if wrong:*
  five JSON action endpoints that have no reason to be frameable would
  remain technically frameable to same-origin content — bounded, but worth
  tightening before the loose-prefix pattern got copied elsewhere.

## What remains

- **`withJobLock` (`src/lib/repo/jobs.ts`) is an OPEN, platform-wide,
  escalated defect — the single most important unresolved item in this
  correction.** It wraps a scheduled job's entire body — including network
  I/O — in one open Postgres transaction, and this is confirmed to affect not
  only this phase's two new jobs (`payroll-ingest.ts`, `payroll-retention.ts`)
  but Phase 1's already-**deployed** jobs (`wallet-accounts-sync.ts`,
  `interest-accrual.ts`, `sync-queue.ts`) as well. This phase's fix wave
  corrected only three false doc-comments claiming the opposite; the
  primitive itself was deliberately not touched. Fixing it needs a
  cross-cutting redesign of `withJobLock`/the job-running infrastructure
  (splitting lock-acquisition from the job body's I/O, likely mirroring the
  `fetch`/`apply` split `SyncHandler` and this phase's own document
  orchestrators already use), affecting every registered job across every
  phase — not a payroll-scoped fix, and not something any future phase should
  attempt inside its own fix loop without dedicated scoping. **This must be
  addressed as its own piece of platform work, tracked outside any single
  phase's plan.**
- **The manual walkthrough (Step 4 above) is genuinely owed**, exactly like
  Phase 2's and Phase 3's before it.
- **The Paperless migration has not been run anywhere real.** Wave 1 and wave
  2 are both committed; neither has executed against a production database.
- **Ruling PH4-C4's parked finding**: `payroll_silo` disconnect-with-purge is
  currently a no-op in practice. Fixing it correctly needs a cross-provider
  `onDisconnect` fetch/apply split affecting `wallet` and `trek` too — future
  work, not scoped to any remaining Phase 4 or Phase 5 task by default. The
  whole-branch review's `wb-1` result independently re-confirmed the same
  underlying `onDisconnect` network-I/O invariant violation.
- **Three Minor/Low issues introduced by fix batch B, parked**: an undeclared
  `partial` field on `/payroll/earnings` missing from the OpenAPI schema;
  `recordFailure` exposing raw job-internal error text to the client (and a
  spurious `409` risk from its `version` bump); `partial.contributions`'s
  eventual noisiness once surfaced in the UI.
- **One out-of-scope display-consistency observation from fix batch C's
  re-review, parked**: `load-company.ts`'s Overview banner and
  `time-off/page.tsx`'s banner still use the old two-status pending filter,
  so they can disagree with the corrected queue/Home-card count on the same
  data — cosmetic, not correctness- or workflow-blocking.
- **The fund-deposit bridge's conflict-update field-list divergence-class
  risk** (`wb-1`): only the test coverage was improved in batch A; the
  underlying "what a second write preserves" question is unchanged from the
  retiring code's own behavior.
- **Every item in the plan's own "Deferred by design" list** — see the ledger
  document for the full section: OCR, auto-verify, `fund_contributions`
  proper, `timeoff_balances` consumption, the Time Off workspace redesign,
  a mapping-rule management UI, `fourteenth`/`bonus`/`settlement` inference,
  outbound `payroll.import.completed` webhooks, and multi-user document
  stores.
- **Minor, deferred findings** (non-blocking, listed by task in the ledger):
  Task 2's `.catch(() => [])` swallowing non-`ENOENT` errors in
  `keysUnder` and `listPrefix("")` throwing; Task 3's `provider: "silo"`
  literal wording tension and the SigV4 percent-encoding test's narrow
  assertion; Task 4's unconsumed `LIVE_STATUSES` export; Task 5's
  `cents()` truncation on 3+ decimal digits; Task 6's dead-code-adjacent
  `!ERRORED.test(line)` guard; Task 9's stale JSDoc about a savepoint that no
  longer exists; Task 10's now-corrected test-comment overclaim (PH4-C10);
  Task 14's duplicated `unreachableStore` guard literal; Task 15's
  inherited `409` vs. `503` inconsistency for `integration_unavailable`
  (cross-module, not this phase's introduction); Task 19's leftover empty
  `work/_lib` directory (no git/build impact); Task 21's per-payslip
  re-query instead of one join and the `sha256`-only exists-check.
- **Two attention-lens classes carried into any future whole-branch review of
  this phase**, per the peer note in `progress.md`: uploaded document bytes
  deserve their own pass anywhere they can be read, served or parsed before
  clearing the scanning boundary; and idempotency claims (this phase's own
  exit criterion) deserve the same "prove it against real Postgres" standard
  Task 1's own RLS test already sets for two of the four uniqueness claims.
- **`main` has never been pushed to `origin`.** Unchanged since Phase 0/1.
- **Conventions carried forward unchanged for Phase 5**: use cases in
  `src/modules/<domain>/application`, ports in `ports.ts`, Drizzle and memory
  repositories in `infrastructure/`, provider names only in `*-adapter.ts`,
  UI and API call the same use cases, integration tests as `*.itest.ts`,
  `drizzle-kit generate --name <name>` for migrations (**next free number is
  `0016`**), commit messages end with the executing model's `Co-Authored-By:`
  trailer, resolve I/O-needing ports before opening any transaction (Ruling
  R4-8 — now proven three times over, per PH4-C7/C9's pattern note, worth
  carrying as a standing review lens for any task touching
  `documents.*`/`scanner.*`-shaped ports in any future phase). `graphify
  update .` is again deferred to the end of the next phase by default; whether
  Phase 5 resumes per-task regeneration is its own call.

## Documents

- Design spec (binding):
  `docs/superpowers/specs/2026-09-02-finance-company-platform-design.md`
- Phase 4 task plan (all 24 tasks done):
  `docs/superpowers/plans/2026-09-05-phase-4-payroll-and-company.md`
- Execution ledger with every ruling (planning `R4-1`–`R4-18`, execution
  `PH4-C1`–`PH4-C13` from the original run plus `PH4-C15`–`PH4-C22` from the
  whole-branch review) and every deferred minor:
  `docs/superpowers/handoff/2026-09-05-phase-4-ledger.md`. The full pre-flight
  scan, every task's brief/report/review/fix diff, the whole-branch review
  packages, and the running execution ledger all live in
  `.superpowers/sdd/2026-09-05-phase-4-payroll-and-company/`.
- Deployment runbook (two waves): `docs/deploy/phase-4-runbook.md`
- Architecture: `docs/architecture/overview.md`; API: `docs/api/README.md`,
  `docs/api/openapi.json`; integrations: `docs/integrations/README.md`

## Deployment status

**Phase 4 is implemented, re-verified after the whole-branch review's fix
wave, and NOT deployed. Neither is Phase 2 or Phase 3.** Whoever deploys this
should also read "What remains" above first — in particular, the
`withJobLock` open item affects Phase 1 jobs already running in production,
independent of whether Phase 4 itself is deployed. Deploy strictly in this
order, per `docs/deploy/phase-4-runbook.md`:

1. Phase 2's runbook, end to end, including its still-owed §9 manual browser
   walkthrough.
2. Phase 3's runbook.
3. Phase 4's runbook, **wave 1** (deploy the migration image, connect the
   payroll document store, run and validate `migrate-paperless`, confirm the
   twelve migrated months on `/company/earnings`) — do not proceed until wave
   1's steps have all passed.
4. Phase 4's runbook, **wave 2** (deploy the removal image, remove the
   `PAPERLESS_*` variables from `docker-compose.yml`/`.env`).

## How to continue

- **Decide how to handle the open `withJobLock` platform item** — it is not
  scoped to any single phase, so it needs its own decision about when and how
  to fix, independent of Phase 5 planning.
- Decide whether to deploy — remembering the order above — and separately
  whether to push `main` to `origin`.
- Whoever holds a real silo credential and a real payslip PDF should run the
  Step 4 walkthrough once after deploying, and record the result as a dated
  addendum to this checkpoint.
- To start Phase 5: read this file, the spec (§11 Phase 5 section), and the
  "What remains" section above (`fund_contributions` proper is named
  explicitly as Phase 5's to build, per R4-6/R4-10), then use
  `superpowers:writing-plans` to write
  `docs/superpowers/plans/<date>-phase-5-<name>.md`, and execute with
  `superpowers:subagent-driven-development` — the same process Phases 0/1, 2,
  3 and 4 all used.
