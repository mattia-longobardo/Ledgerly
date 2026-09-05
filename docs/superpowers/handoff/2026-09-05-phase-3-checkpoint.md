# Checkpoint: Phase 3 complete, whole-branch fix wave closed (2026-09-05)

Resume from here with any model. Read this file, then the spec, then the plan.

This checkpoint supersedes the version committed as `d644471`. That version
was written against `15bfa94`, before the Phase 3 whole-branch review had
reported — it recorded a verification run and a graph the review's fix wave
then invalidated. This is a correction in place, not an addendum: the range,
the verification numbers and the phase's content below are all re-stated as
they stand now, after the fix wave closed.

## State

- Branch: `main`, HEAD after this correction's own commit (`docs(handoff):
  correct the Phase 3 checkpoint for the whole-branch fix wave`, on top of
  `09b5739`). **Not pushed to `origin`** — `origin/main` is still at `5202361
  Initial commit`, now well over 130 commits behind. Not deployed: production
  still runs the Phase 1 image.
- Range implemented: `8b108a2..09b5739` — **56 commits**:
  - `8b108a2..15bfa94` (42 commits) — the pre-flight plan repair plus Tasks
    1–22, including the phase cleanup wave.
  - `d644471` — the original (now-superseded) Task 23 checkpoint commit.
  - `48709aa..09b5739` (13 commits) — the whole-branch review's three
    sequential fix-wave batches: **A** (persistence — `48709aa`, `1e32ff9`,
    `f00c132`, migration `0013`), **B** (the money path — `da41da2`,
    `61c9c1c`, `0a0905b`, `f3f3832`, `ce743b4`, migration `0014`), **C** (sync
    + UI — `aef890a`, `ab25461`, `9497f59`, `60cda52`, `09b5739`, no
    migration). Sequential rather than parallel because A and B each needed
    their own migration number, and the standing rule against concurrent
    implementers held.
  - The whole-branch review itself ran once, over `67747cb..15bfa94` (41
    commits — `67747cb` is the plan-repair commit and changes no code), split
    four ways by area (`wb-1` persistence/RLS, `wb-2` expenses + sync engine,
    `wb-3` interests/the money path, `wb-4` API/UI/docs). It did **not**
    re-run over the enlarged range; instead each fix-wave batch was
    independently re-reviewed against its own diff package (`rr-a`, `rr-b`,
    `rr-c`) and **approved on the first re-review**, all three.
- Verification on this tree, **re-run fresh by this correction task** — the
  fix wave invalidated Task 23's original run (ruling P3-C47), so nothing
  below is inherited from that report:
  - `npx tsc --noEmit` — **clean**, exit 0.
  - `npm test` — **909 tests / 94 files, all passing** (baseline before Task
    1: 706/70; Task 23's pre-fix-wave run: 873/93; after fix-wave batch A:
    882/93; after batch B: 897/93; after batch C: 909/94 — the figure below
    matches the ledger's own count for the closed fix wave). Includes
    `src/platform/http/openapi-drift.test.ts` (1 test, confirmed present in
    the run) — the OpenAPI drift check the exit criteria call for is inside
    this suite, not a separate command.
  - `npm run test:db:up && npm run test:integration` — **119 tests / 31
    files, all passing** (baseline: 49/20; Task 23's pre-fix-wave run:
    103/28; after batch A: 113/30; after batch B: 118/30; after batch C:
    119/31). Ran against the throwaway `dashboard-postgres-test` container
    only; no real database was touched at any point in this task.
  - `npm run build` — **succeeds**. The route table still lists
    `/finance/expenses`, `/finance/expenses/[transactionId]`,
    `/finance/interests` and `/finance/interests/rules/[id]` — every route
    this phase's exit criteria depend on exists and compiles.
  - `npm run e2e` — **4/4 passing** (`smoke.spec.ts` and `settings.spec.ts`,
    each in the mobile and desktop projects). Run against a local `next dev`
    started by hand on `http://localhost:3000` and pointed at the throwaway
    `dashboard-postgres-test` database, using the same fake environment
    `src/test/integration-setup.ts` supplies. `/api/health` was confirmed to
    return 200 (`{"status":"ok","db":"up",...}`) before running the suite.
    The Playwright config still has no `webServer` block, so a server must be
    started by hand per `tests/e2e/README.md`; this was **not** run against
    the live production container. The dev server was stopped afterwards and
    confirmed no longer running.
  - `npm run openapi:generate` — regenerated `docs/api/openapi.json` in place
    and `git status` came back **clean**, so the committed contract still has
    no drift after the fix wave.
  - `src/lib/jobs/interest-accrual.itest.ts` — **8 tests, passing** (was 6 at
    Task 23; the fix wave's money-path hardening added coverage), confirmed
    by name in the integration run.
  - `grep -rn "WALLET_TAX_RATE\|ANNUAL_RATE\|state\.json" dashboard-app/src`
    — still **no hits**. No copy of the legacy container's env-var-driven
    configuration leaked into the dashboard.
  - `grep -rn 'z.enum(\["accounts", "leave"\])' dashboard-app/src` — still
    **no hits**, and both `SyncKind` enums in
    `src/modules/integrations/api/schemas.ts` (lines 43 and 78) still read
    `["accounts", "leave", "transactions"]`.
  - `git diff 8b108a2..09b5739 -- dashboard-app/.env.example
    docker-compose.yml dashboard-app/src/lib/env.ts` — **empty**. The fix
    wave, like the original 22 tasks, added no required environment
    variable.
  - A known, pre-existing `next lint` breakage (noted by the fix wave's own
    batch A report) is unrelated to this phase and was not chased.
- `graphify update .` was run once more from the repo root by this
  correction task, since the fix wave landed after Task 23's regeneration
  (ruling P3-C47, applying the same deferred-until-the-end pattern as ruling
  P3-C2/Phase 2's P2-C15): **3393 nodes, 9750 edges, 166 communities**
  (previous, pre-fix-wave figure: 3317 nodes, 9546 edges, 150 communities).
  `graphify-out/` is committed as part of this correction's commit. Same two
  warning classes as before, one count larger each: 19 JSON/config files
  (was 17) and 16 `.sql` files (was 14 — the two new fix-wave migrations,
  `0013` and `0014`, join the existing untracked set because
  `tree_sitter_sql` is not installed) contribute nothing. Community *names*
  are stale again (`graphify label` was not re-run — it needs an LLM and
  costs money); the structure is current.

## What the whole-branch review found, that 22 passing task reviews had not

Each of Task 23's 22 per-task reviews was individually clean, and Task 23's
original checkpoint was an accurate account of the tree it measured. But a
per-task reviewer cannot see across tasks. The whole-branch review — dispatched
over `67747cb..15bfa94` (41 commits, 129 files), split four ways by area so
each reviewer could carry the phase's own observed defect classes as its
attention lens — found **three Critical defects** and **thirteen Important
findings**.

**Critical 1 (`wb-1`, persistence).** `recurring_patterns_user_payee_uq` was
`(user_id, payee)` while `detectRecurring` groups on payee + currency + sign
by design. One user with the same payee appearing in two currencies (or as
both a recurring income and a recurring expense) would 23505 on `replaceAll`'s
multi-row INSERT. That escapes `apply()`, which the wallet-provider-adapter
runs in **one transaction** together with `syncProviderTransactions` — so the
entire sync run rolls back, and because the detector re-derives its groups
from `listAll()` on every run, it repeats **every hour, forever**. Expenses
sync for that user stops permanently.

**Critical 2 (`wb-3`, the money path).** The interest-posting duplicate-check
queried a date grain it did not write. The POST sent `recordDate` as a full
`"...T00:00:00Z"` timestamp; `findPostedRecord` queried
`recordDate=eq.<bare date>`. If Wallet resolves that filter in Europe/Rome
(as this stack does), the day can resolve a instant earlier and never match —
and since ruling P3-C37 (made earlier in the original run) had already removed
the automatic 30-day backlog sweep, this check was the **only** thing standing
between a mid-post restart and a second real posting to a real external
account. No doc required verifying this round-trip against a live token
before a rule was first flipped to `post_to_provider`.

**Critical 3 (`wb-3`, the money path).** Posting correctness rested on an
advisory lock (`pg_try_advisory_xact_lock`) held open across the Wallet
network round trip — a call whose retry policy can run for minutes. An
`idle_in_transaction_session_timeout`, a pooler kill, or a failover releases
the lock mid-POST; the crontab retries on any failure and a failed daily job
returns 500, so concurrent triggers were routine, not exotic. Two concurrent
ticks could both observe `postedAt: null`, both find nothing via
`findPostedRecord`, and both POST — the same money, twice.

Plus **thirteen Important findings** (full detail in the ledger's whole-branch
section and in `.superpowers/sdd/2026-09-05-phase-3-expenses-and-interests/progress.md`),
including:
- (`wb-1`) Four tables' RLS (`transaction_categories`, `transaction_labels`,
  `transaction_label_links`, `recurring_patterns`) was declared but never
  observed by a running test — every existing cross-user test ran under
  `withSystemContext`, which bypasses the policy; a deleted `CREATE POLICY`
  would have left the suite green and the table failing closed on first
  production deploy.
- (`wb-1`) `list()` `from`/`to` divergence: the fake compares ISO strings
  lexically, Drizzle compares `Date`s, and the wire schema validates no
  format — an offset timestamp silently drops a day's rows in the fake only.
- (`wb-1`) `liveFor()` fake/Drizzle divergence with two providers on one
  account, inverting delete-account and update-account guards — pre-existing
  from Phase 2, made reachable by Phase 3's second provider.
- (`wb-1`) Label/category ownership enforced nowhere: a PATCH with another
  user's `labelIds`/`categoryId` succeeded.
- (`wb-1`) `DrizzleInterestRulesRepository.list()` had no `ORDER BY`; rules
  silently reordered after an edit.
- (`wb-2`) Transfer legs synced more than `RECORDS_LOOKBACK_DAYS` (7) days
  apart never paired — the same movement counted twice as spend.
- (`wb-2`) `wallet.ts`'s `PostRecordInput.amount` was typed `number` while
  every other money field in the module was `string`, forcing a `Number()`
  conversion at the one call site that writes real money externally.
- (`wb-3`) `interest_entries.transaction_id` was typed `uuid` while the
  adapter writes Wallet's opaque provider id (`z.string()`) — a non-UUID id
  throws on `entries.create` and rolls the local write back **after the
  money has already left** for a real external account, with no local record.
- (`wb-3`) "Already posted" was concluded from account + day + marker +
  amount with no per-rule scoping, so two posting rules on one account could
  adopt each other's record — a silent under-post plus a false ledger row.
- (`wb-3`) `netCents` clamps at 0 but `carryAfter` keeps the whole negative
  remainder unbounded — a sustained negative balance silently consumes real
  interest later while reconciling as "matched" throughout.
- (`wb-3`) `dayCount: "actual"` and `compounding: "monthly"`/`"none"` were
  accepted by the schema and the public API but produced a permanently inert
  rule with no log line, no UI signal and no skipped counter.
- (`wb-3`) Nothing validated that a rule's account belongs to the rule's own
  user.
- (`wb-4`) `interest_accrual` is a registered daily job and a `JobName`, but
  was never added to the admin page's Scheduled-jobs panel — the very panel
  both the Phase 3 runbook and the cut-over doc tell the operator to check.
  Cross-cutting by construction: the code half and the docs half were each
  correct within their own task.

All sixteen findings were fixed across the three sequential batches described
above, and **all three batches were independently re-reviewed and approved on
the first re-review.**

## Key design decisions from the fix wave

- **Posting correctness now rests on a durable database claim, not the
  advisory lock.** `claimForPosting` runs `UPDATE interest_accruals SET
  posted_at = $2 WHERE id = $1 AND posted_at IS NULL RETURNING id`,
  **committed before the Wallet call**; a confirmed failure reverts it via
  `releaseClaim`, which is guarded twice so it can never run after an
  ambiguous post error — only after a provably-pre-write read failure. A
  crash between a successful POST and the local write leaves `postedAt` set
  with `entryId` null: a **deliberate, observable in-flight state**.
  `shouldPost`/`claimForPosting` both refuse to post again, and it is
  **never reported as paid** (reconciliation says indeterminate, not
  matched) **and never silently retried**. The advisory lock (`withJobLock`)
  is retained and now documented, in both `jobs.ts` and
  `interest-accrual.ts`, as an optimisation only — not the correctness
  boundary. The re-reviewer proved the claim's durability is real, not
  decorative: `claimForPosting` runs via `withUserContext` on the
  module-level pool-backed `db`, not on the outer job-lock transaction, and a
  pool-backed Drizzle `db.transaction()` acquires its own client rather than
  nesting as a savepoint — so the UPDATE commits independently of whether the
  surrounding lock's transaction later dies.
- **A negative balance now skips visibly rather than writing a `0.00`
  row.** The prior behaviour let an unbounded negative carry accumulate
  silently behind a row that reconciled as "matched" the whole time. This is
  a **deliberate divergence from the legacy `interest.py`**, which handled
  the same case badly, and it is documented as a divergence rather than
  silently changed.
- **Transfer pairing now looks up the counterpart by the provider's own
  counter-record id, rather than rescanning a date window.** The
  brief-specified fix (ruling P3-C45) was a bounded-window rescan of stored
  unpaired legs; the implementer substituted a direct lookup via
  `links.byExternal` against Wallet's `transferCounterRecordId` — no window,
  so no pathologically-late leg is missed either, and the substitution is
  **better than the fix that was specified**. The re-reviewer confirmed the
  equality it relies on (`transferCounterRecordId` == the counterpart's own
  `externalId`) is the *same* invariant same-run pairing already used, not a
  new assumption, and that an absent or unsynced counterpart degrades
  (`continue`) rather than throws. Ruling P3-C45 is superseded by this
  implementation.
- Also landed in the same wave: per-rule note-marker suffixes, so two
  posting rules on one account can no longer adopt each other's record;
  `interest_entries.transaction_id` widened to `text`; a visible skip reason
  plus a counter for both the negative-balance and the inert-rule
  (`dayCount`/`compounding`) cases, threaded through to the admin panel and
  the rule detail page; account-ownership validation for interest rules at
  both the use-case layer and the RLS `WITH CHECK` clause; and
  `recurring_patterns`' unique index widened to `(user_id, payee, currency,
  sign)` to match the detector's own grouping key exactly, rather than
  collapsing the detector's groups to fit the old index.

## One parked minor

**Ruling P3-C48** (not fixed, deliberately): `interest-accrual-notice.ts`
(added in batch C to surface the new skip/in-flight counts in the admin
panel) hardcodes the provider's brand name outside `*-adapter.ts`. This is a
**new instance of a pre-existing violation** — `RulesTable.tsx`'s "Posts to
Wallet" predates the fix wave — not a new violation, so a fourth fix round
was not opened for one string. Parked for whichever later phase reviews
user-facing copy and tightens the provider-name abstraction.

## Not run: the manual walkthrough with a real Wallet token

**This could not be driven by an automated agent in this environment** —
there is no real Budget Makers Wallet token and no authenticated browser
session here, the same limitation Phase 2's checkpoint recorded for its own
walkthrough, and the same limitation this correction still cannot lift.
Nothing below was attempted, and none of it should be read as verified.

Whoever holds a real token runs this once, after deploying
(`docs/deploy/phase-3-runbook.md`), and records the result as a dated
addendum to this checkpoint — the same way Phase 1's production deploy got
its own section in the Phase 0/1 checkpoint:

1. Connect Wallet if not already connected; confirm `/finance/expenses` and
   `/finance/interests` both show their "Connect Budget Makers Wallet" empty
   state beforehand — an empty state, never a zero.
2. Trigger `POST /api/v1/integrations/wallet/sync` with
   `{"kind":"transactions"}`; confirm `/finance/expenses` now lists real
   transactions with real categories. **This is also the first live check of
   ruling P3-10's unverified field guesses** — if BudgetBakers' `/records` or
   `/categories` field names differ from what `wallet-transactions-adapter.ts`
   assumes, this step fails loudly with a Zod parse error naming the field,
   which is the designed outcome; it does not silently import wrong data.
3. Recategorise one transaction and add a note via its detail page; reload
   and confirm both persisted.
4. Confirm a genuinely recurring payee (three or more monthly charges of a
   stable amount) appears under "Recurring" on the Expenses page.
5. Create an interest rule against a real synced Wallet savings/checking
   account using the create-rule form on the Interests list page
   (`/finance/interests` — there is deliberately no separate "new rule"
   route, ruling P3-17), leave `postingMode` at its default `analyze_only`;
   wait for the next daily tick and confirm an accrual appears on the rule's
   detail page with a plausible, non-zero net amount.
6. Confirm the rule's reconciliation for the current month reads
   **`missing`** — accruals exist and nothing has been paid against them,
   because the rule is analyze-only. Before step 5's first accrual lands it
   reads `no_data`, not `missing`: `reconcileInterest` returns `no_data` when
   there are no accrual rows at all, so "the accrual job never ran" is never
   reported as "the books agree"
   (`src/modules/interests/domain/reconciliation.ts:78-80`, ruling P3-C29
   item 5).
7. **Only if comfortable doing so against a real account, and only after
   verifying the posting round-trip:** confirm the amount echo and the
   `findPostedRecord` date-grain match against a live token — this is now a
   **precondition batch B's runbook change added**, not merely a suggestion
   — then flip the rule to `post_to_provider` for one day, confirm a
   matching record appears in the Wallet app with the (now per-rule)
   `auto-interest-<rule>` note, and flip it back to `analyze_only`. Or follow
   the full cut-over in
   `dashboard-app/docs/migration/wallet-manager-cutover.md` if retiring the
   standalone container for real. **Read the "no automatic recovery" note
   below before doing this.**
8. Confirm the Wallet `transactions` sync's `sync_runs` entries read
   `success`, and that the Settings › Administration Scheduled-jobs panel
   now lists `interest_accrual` and shows its skip/in-flight counts (this was
   the `wb-4` Important finding; batch C fixed it, so the runbook's own
   pointer is now correct).

## Behaviours the plan text and the original checkpoint predate

Three things changed after the plan text (and, for the third, after Task 23's
original checkpoint) was written. Any document that describes the old
behaviour is wrong.

1. **There is no automatic back-posting sweep.** `runInterestAccrualJob`
   posts the **current Rome-calendar day's accrual only**. A day that could
   not be posted is logged (`interest_post_skipped`) and counted so an
   operator is alerted; **nothing recovers it automatically**. The only
   in-app lever is re-triggering the daily job on the *same Rome-calendar
   day*, and it expires at the `romeDate` rollover. Ruling **P3-C37** removed
   it outright (during the original 22-task run, before Task 23's checkpoint)
   rather than bounding it, because bounding it correctly needs a "posting
   enabled at" fact the schema does not carry. See
   `src/lib/jobs/interest-accrual.ts:58-88` and
   `docs/deploy/phase-3-runbook.md` §5.
2. **`reconcileInterest` has an explicit `no_data` status.**
   `ReconciliationStatus` is `"matched" | "missing" | "delayed" | "anomalous"
   | "no_data"`. `no_data` means no accrual rows exist for the period — a
   missing basis for comparison, not evidence that nothing was owed.
   `missing` is narrower and different: accruals exist and nothing has been
   paid against them. Ruling **P3-C29 item 5**.
3. **Posting correctness now rests on a durable claim, and duplicate-post
   defence is per-rule.** This is new since Task 23's original checkpoint —
   see "Key design decisions from the fix wave" above. The advisory lock is
   an optimisation, documented as such; the claim is the correctness
   boundary.

## Documents

- Design spec (binding):
  `docs/superpowers/specs/2026-09-02-finance-company-platform-design.md`
- Phase 3 task plan (all 23 tasks done):
  `docs/superpowers/plans/2026-09-05-phase-3-expenses-and-interests.md`
- Execution ledger with every ruling (planning `P3-1`–`P3-18`, execution
  `P3-C1`–`P3-C48`) and every deferred minor:
  `docs/superpowers/handoff/2026-09-05-phase-3-ledger.md`. The full pre-flight
  scan, every task's brief/report/review/fix diff, the whole-branch review
  packages (`wb-1`..`wb-4`) and the fix-wave re-review packages
  (`rr-a`/`rr-b`/`rr-c`) all live in
  `.superpowers/sdd/2026-09-05-phase-3-expenses-and-interests/`.
- Deployment runbook: `docs/deploy/phase-3-runbook.md`
- Posting cut-over (retiring the standalone `wallet-manager` container):
  `dashboard-app/docs/migration/wallet-manager-cutover.md` — both repo-root
  documents that link to it (`docs/deploy/phase-3-runbook.md` and
  `docs/api/README.md`) now resolve correctly; the broken-link finding from
  Task 23's original checkpoint was fixed in fix-wave batch C (ruling C5).
- Architecture: `docs/architecture/overview.md`; API: `docs/api/README.md`,
  `docs/api/openapi.json`; integrations: `docs/integrations/README.md`

## What this phase added

Two new vertical slices, both following the `modules/accounts` shape (ruling
P3-2: flat `UseCaseDeps` bag, RLS context opened once by the caller).

**Database** — four additive migrations, no existing table or column changed
by the original 22 tasks; the fix wave's own two migrations are additive too:
- `0011_transactions.sql` — `transactions`, `transaction_categories`,
  `transaction_labels`, `transaction_label_links`, `recurring_patterns`, all
  with RLS.
- `0012_interests.sql` — `interest_rules`, `interest_accruals`,
  `interest_entries`, all with RLS. `interest_accruals` carries the
  `(rule_id, accrual_date)` unique index that is the single mechanism
  preventing a daily job re-run from double-posting; it is proven by an
  integration test, not by reading generated SQL (ruling P3-C28).
- `0013_expenses_ownership_fixes.sql` (fix-wave batch A) — widens
  `recurring_patterns`' unique index to `(user_id, payee, currency, sign)`
  (Critical 1 above) and adds the column that requires.
- `0014_interest_posting_fixes.sql` (fix-wave batch B) — widens
  `interest_entries.transaction_id` from `uuid` to `text` (Important finding
  above), among other money-path fixes.

**`src/modules/expenses/`** — `domain/` (`transaction.ts`, `recurring.ts`),
`application/` (ports, deps, `list-transactions`, `get-transaction`,
`update-transaction`, `list-categories`, `list-labels`,
`list-recurring-patterns`, `detect-recurring-patterns`,
`sync-provider-transactions`), `infrastructure/` (four Drizzle repositories,
the memory pair, `wallet-transactions-adapter.ts`), `api/` (routes +
schemas), `ui/` (loaders, `TransactionsTable`, `TransactionEditForm`).

**`src/modules/interests/`** — `domain/` (`accrual.ts` — the `BigInt`
fixed-point port of `interest.py`; `reconciliation.ts`), `application/`
(ports, deps, rule CRUD, `run-interest-accrual`, `get-interest-rule-detail`,
`post-interest-entry`, `rule-validation`), `infrastructure/` (three Drizzle
repositories, the memory pair, `account-balance-lookup.ts`,
`wallet-interest-posting-adapter.ts` — the only file in the phase that writes
money to a real external account), `api/`, `ui/` (`RulesTable`, `RuleDetail`,
`RuleForm`).

**Pages** — `/finance/expenses`, `/finance/expenses/[transactionId]`,
`/finance/interests`, `/finance/interests/rules/[id]`, all replacing Phase
2's setup states.

**Jobs** — `lib/jobs/wallet-transactions-sync.ts` (hourly tier) and
`lib/jobs/interest-accrual.ts` (daily tier). No scheduler was invented; both
register on the existing tiers.

**Touched outside the two new modules** — `ProviderLinksRepository.entityType`
widened to `"account" | "transaction" | "category" | "label"` (ruling P3-4);
`SyncKind` widened with `"transactions"`; `run-sync.ts`'s `prepare()` now
ensures the sync job row for the resolved kind rather than merely reading it
(ruling P3-C27, which closed a gap that would have shipped a sync nothing
starts — ruling P3-C20); `lib/db/errors.ts` extracted; one pre-existing
**Phase 1** bug fixed in the original cleanup wave
(`DrizzleGroupsRepository.create/rename` caught a unique-constraint violation
inside an open transaction, leaving it aborted so every later statement in
the same request failed — ruling P3-C16); and, in fix-wave batch A, one
pre-existing **Phase 2** bug the whole-branch review surfaced — `liveFor()`
in the accounts module picked the first matching provider link rather than
the one satisfying `isNull(missingSince)`, silently inverting delete/update
guards once a second provider existed on an account.

## Deployment status

**Phase 3 is implemented, re-verified after the fix wave, and NOT deployed.
Neither is Phase 2.** Phase 3 stacks directly on Phase 2, so **Phase 3 cannot
be deployed until Phase 2's own prerequisites are met**, in this order:

1. **Phase 2 first.** `docs/deploy/phase-2-runbook.md`, end to end. Its two
   hard prerequisites are unchanged: `DASHBOARD_APP_ENCRYPTION_KEY` (also
   referred to as `APP_ENCRYPTION_KEY`) must be generated and set in `.env`
   before the new image boots (every commit from Phase 2's Task 4 onward
   refuses to start without it), and the file-mounted Wallet and Trek
   credentials must be imported exactly once via
   `scripts/import-file-credentials.ts` — which needs the old token files
   temporarily reachable inside the container, since the checked-in
   `docker-compose.yml` has already removed those mounts for good. The
   runbook's step 3 gives the exact four lines to add back for that one
   deploy, and step 6 reverts them.
2. **Phase 2's §9 manual browser walkthrough is still owed** and has never
   been run. Phase 3's own runbook step 1 depends on it: the transactions
   sync and the interest-posting adapter both assume a working, *tested*
   Wallet connection.
3. **Then Phase 3.** `docs/deploy/phase-3-runbook.md`. It adds four
   migrations total (`0011`–`0014`) and **no environment variables**. All
   four are additive, so rollback is reverting the image tag — the new
   tables are simply unused by the older one.
4. **Enabling `postingMode: "post_to_provider"` on any rule is a separate,
   deliberate, per-rule act** and never a consequence of deploying. Follow
   `dashboard-app/docs/migration/wallet-manager-cutover.md`, read the "no
   automatic recovery" note above, and — per batch B's runbook addition —
   verify the posting round-trip against a live token first.

## What remains

- **Ruling P3-10 is still open and cannot be closed here.** The real
  BudgetBakers `/records` and `/categories` field names have never been
  checked against a live token. Every guess is isolated behind
  `wallet-transactions-adapter.ts` and `wallet-interest-posting-adapter.ts`
  and validated by Zod, so a mismatch fails loudly and non-retryably rather
  than mis-mapping data — but it is a *guess* until step 2 of the walkthrough
  above is run. The same caveat covers `postRecords`' amount round-trip, now
  a documented precondition for flipping any rule to `post_to_provider`
  (batch B).
- **`main` has never been pushed to `origin`**, unchanged since Phase 0/1.
  Deciding whether to push is still open.
- **Carried from Phase 2 and still true:** two Wallet accounts remain
  `unavailable` from the Phase 1 deploy ("Buddybank - Personal Savings",
  "Isybank S.p.A - Main", archived upstream); webhook replay protection,
  `webhook_deliveries` retention and rate limiting the public webhook
  endpoint are Phase 9 hardening; folding the credential blob's version byte
  into the AES-GCM AAD waits for a real migration; the sync engine's
  cursor-changed detection uses referential inequality, so a handler that
  mutated its cursor object in place would silently fail to persist it (no
  handler does).
- **Phase 3's own deferrals** are listed in full in the ledger's "Deferred by
  design" section: category/label management UI (Phase 9), `monthly`/`none`
  compounding and `dayCount: "actual"` (accepted by the schema, never
  computed — now with a visible skip signal, per the fix wave), a currency
  column on the interest tables, and the rest.
- **The one parked minor** (ruling P3-C48, above): the provider brand name
  in `interest-accrual-notice.ts`.
- **A known, pre-existing `next lint` breakage** is unrelated to this phase
  and out of scope for it.
- **Conventions, unchanged for Phase 4:** use cases in
  `src/modules/<domain>/application`, ports in `ports.ts`, Drizzle and
  memory repositories in `infrastructure/`, provider names only in
  `*-adapter.ts` (with the one parked exception above), UI and API call the
  same use cases, integration tests as `*.itest.ts`, `drizzle-kit generate
  --name <name>` for migrations (**next free number is `0015`**), commit
  messages end with the executing model's `Co-Authored-By:` trailer.
  `graphify update .` was again deferred to the end of the phase (ruling
  P3-C2/P3-C47); whether Phase 4 resumes per-task regeneration is its own
  call.

## How to continue

- The whole-branch review and its fix wave are closed; there is nothing left
  to append here on that account.
- Decide whether to deploy — and remember the order: Phase 2's runbook and
  its §9 walkthrough first, then Phase 3's. Decide separately whether to
  push `main` to `origin`.
- Whoever holds a real Wallet token should run the walkthrough above once
  after deploying and record the result as a dated addendum here.
- To start Phase 4: read this file, the spec (§11 Phase 4 section), and the
  open items above, then use `superpowers:writing-plans` to write
  `docs/superpowers/plans/<date>-phase-4-<name>.md`, and execute with
  `superpowers:subagent-driven-development` (fresh implementer per task,
  reviewer per task, whole-branch review at the end) — the same process
  Phases 0/1, 2 and 3 all used.
