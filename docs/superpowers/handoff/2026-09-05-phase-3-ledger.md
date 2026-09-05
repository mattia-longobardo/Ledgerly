# SDD ledger — plan: docs/superpowers/plans/2026-09-05-phase-3-expenses-and-interests.md
Spec: docs/superpowers/specs/2026-09-02-finance-company-platform-design.md (read; binding authority)

This is the Phase 3 execution record, in the shape Phase 2's ledger
(`docs/superpowers/handoff/2026-09-04-phase-2-ledger.md`) established. This
version corrects the one committed as `d644471`: that copy was written before
the Phase 3 whole-branch review had reported, so it stopped at Task 22 and
never recorded the review's three Critical defects, its thirteen Important
findings, or the three-batch fix wave that closed all of them. The correction
lands before anything is deployed, so this file is rewritten to be right
rather than given a contradicting addendum. Four parts:

1. **Rulings — planning** (`P3-1` … `P3-18`), taken while writing and
   repairing the plan, before any code was written. Source: the plan's own
   Rulings section, reproduced in `.superpowers/sdd/2026-09-05-phase-3-expenses-and-interests/task-23-brief.md`.
2. **Rulings — execution** (`P3-C1` … `P3-C48`), taken by the controller
   during the 22-task run and the whole-branch review's fix wave. Source: the
   running ledger, quoted below.
3. **Deferred by design** — what Phase 3 deliberately left for later.
4. **The running ledger, verbatim** — the full record, including the
   whole-branch review's four area reports (`wb-1`..`wb-4`), the rulings made
   on their findings, the three fix-wave batches, and their independent
   re-reviews (`rr-a`/`rr-b`/`rr-c`), all **APPROVED**.

The pre-flight conflict scan is
`.superpowers/sdd/2026-09-05-phase-3-expenses-and-interests/preflight-scan.md`;
every per-task brief, report, review diff and fix diff, the whole-branch
review's four diff packages, and the three re-review packages all live in
that same directory.

Baseline before Task 1 (commit `8b108a2`): typecheck clean, 706 unit / 70
files, 49 itest / 20 files, build ok.

---

## Rulings — planning (P3-1 … P3-18)

These were made before execution. **None of them records an explicit "cost if
wrong"** — that discipline was applied to the execution rulings, not the
planning ones. Rather than invent a cost for each, the consequence column below
states only what the ruling itself states. Where a ruling was later superseded
or contradicted by execution, that is called out.

| # | Ruling | Why | Consequence recorded by the plan |
|---|---|---|---|
| **P3-1** | Interest posting to Wallet stays behind a per-rule switch: every rule defaults to `postingMode: "analyze_only"`; `"post_to_provider"` is opt-in and only takes effect for a rule whose account is a currently-live synced Wallet account with a connected integration. | Adopts spec §13.2's own default as-is. Posting writes real money to a real external account; nothing should start doing that as a side effect of a deploy. | None stated. Held through execution — see P3-C33/C34/C37 for how the posting path was then hardened. |
| **P3-2** | `expenses` and `interests` use the accounts module's flat `UseCaseDeps` bag (repositories + clock + audit, no `db`, no context-opening method), with RLS context opened once by the caller via `withUserContext`/`withSystemContext` — not the integrations module's `IntegrationDeps.inUserContext`/`inSystemContext` shape. | The assignment names `modules/accounts` as the reference vertical slice for new domains; the integrations module's different shape is left exactly as Phase 2 built it. | None stated. Verified in execution at Tasks 9, 10, 11, 20, 21 — every route handler and loader constructs deps only inside an open context. |
| **P3-3** | Interest rule/accrual/entry entity types live directly in `interests/application/ports.ts` rather than a separate `domain/rule.ts`. | Unlike `accounts`/`expenses`, this module's entities carry no invariants beyond what the already-pure `dailyInterest`/`reconcileInterest`/`projectInterest` express. | None stated. |
| **P3-4** | `ProviderLinksRepository.entityType` widens to `"account" \| "transaction" \| "category" \| "label"`. Wallet exposes a label only as a name, never a stable id, so the label's own name stands in for its external id in `provider_links`. | The transactions/categories/labels sync cannot key its upserts without it. | Documented at the one call site that relies on the name-as-id substitution (`sync-provider-transactions.ts`). |
| **P3-5** | The `transactions` `SyncKind`'s cursor is `{ sinceDate: string }` — the Rome date the last successful pass ran — refetched with a 7-day lookback overlap (`RECORDS_LOOKBACK_DAYS`) rather than exactly from the cursor. | A record edited after the cursor moved past it is still caught. Safe because the sync is a pure upsert keyed by `provider_links`, never an append: redundant overlap produces zero duplicates. | None stated. **Qualified in execution** (Task 8, minor folded into its fix round): the client filters on `recordDate`, not `updatedAt`, so the overlap recovers late edits only for recently *dated* records — an old record edited today is still missed. The doc comment was corrected to say so. |
| **P3-6** | The accrual math is a from-scratch TypeScript port of `interest.py`'s exact algorithm, using `BigInt` fixed-point arithmetic at a 1e12 internal scale rather than a decimal-library dependency. | No decimal library exists in this codebase's `package.json`; 1e12 is enough headroom above the 6-decimal `numeric` columns to make float-style rounding error impossible at the cent boundary. | None stated. Independently re-derived from first principles by Task 14's reviewer against the real `interest.py`. |
| **P3-7** | Only `compounding: "simple_daily"` over `dayCount: 360 \| 365` is computed by `runInterestAccrual`. `"monthly"`/`"none"` compounding and `dayCount: "actual"` are accepted by the schema but produce no accrual. | Matches `interest.py`'s own algorithm exactly; schema acceptance is spec §5.7 fidelity, forward compatibility for a later phase, not a Phase 3 feature. | None stated. **Extended in execution** by P3-C32: the *projection* had to be gated on the same condition, or a rule the job will never accrue would still receive a confident forecast. |
| **P3-8** | The daily interest-accrual job iterates **every user with an active rule** (`InterestRulesRepository.listActiveForAllUsers`, read once under `withSystemContext`), unlike `monthly-close.ts`'s single-owner assumption. One rule's failure is caught and logged per-rule. | Interest rules are per-user from the start; one rule's failure must not jam every other user's run. | None stated. Proven in execution by Task 18's itest: an invalid rule fails alone while another user's rule still accrues, and the run still reports success with a failure count. |
| **P3-9** | Posting to the provider is a push, never a `SyncKind` — it does not go through the sync engine. Reads happen in short, sequential, never-nested transactions; the Wallet call happens with no transaction open; the result is recorded in one final short transaction. | The same fetch/apply discipline every pull sync in this codebase already follows, applied to a push. | None stated. **Partly corrected in execution** by P3-C35: the surrounding job lock *is* deliberately held across the network call (that is what prevents a concurrent double-post); it was the comment that overstated the claim, and the comment was fixed rather than the lock narrowed. |
| **P3-10** | The real BudgetBakers `/records` and `/categories` field names have not been verified against a live token in this environment. Every field guess is isolated behind `wallet-transactions-adapter.ts` and `wallet-interest-posting-adapter.ts` and validated by Zod. | A shape mismatch must fail loudly and non-retryably rather than silently mis-mapping financial data. | `docs/deploy/phase-3-runbook.md` carries a manual verification step for whoever holds a real token. **Still true at the end of the phase** — see "What is still unverified" in the checkpoint. |
| **P3-11** | *(superseded — see P3-15)* Claimed `ErrorResponseSchema` is duplicated per-module and no shared copy exists. | — | **The claim was false**, caught by the pre-flight scan (P3-C5) and corrected in place before execution. Recorded here because the plan text carries the correction rather than deleting the error. |
| **P3-12** | `TransactionPatch` is widened to include `transferGroupId` in Task 7, the task that first needs to write it, rather than speculatively in Task 4. | A field added where it has no caller yet is a field nothing checks. | None stated. |
| **P3-13** | Recurring-pattern detection runs as the last step of the transactions sync's `apply` phase — a full recompute replacing the previous set — rather than as a separately scheduled job. | Cheap (pure in-memory grouping over what the sync already loaded) and always reflects the latest sync. | None stated. |
| **P3-14** | No new required environment variables this phase. Interest-rule parameters (rate, tax rate, day count, posting mode) live in per-rule database rows. | A deliberate change from `interest.py`'s single env-var-configured account — exactly what spec §7.6 calls out as "changed" versus the legacy script. | None stated. **Verified at the gate**: `git diff 8b108a2..HEAD -- .env.example docker-compose.yml src/lib/env.ts` is empty. |
| **P3-15** | *(pre-flight repair; supersedes P3-11)* `ErrorResponseSchema` is imported from `@/modules/accounts/api/schemas` in Tasks 10, 12 and 20, not redeclared. Only the per-module `errorResponse()`/`commonErrorResponses` wiring stays duplicated. | All routes across all four modules register onto the same shared `ApiApp`/`OpenAPIHono` instance, so a second module-local schema tagged with the same OpenAPI component name would *collide* at `npm run openapi:generate` time, not merely duplicate. The wiring is a plain object of route descriptions, not a component registration, so it carries none of that risk. | None stated. Verified by Task 10's reviewer: one `ErrorResponse` component in the generated document, no collision. |
| **P3-16** | *(pre-flight repair)* Both `InterestAccrualsRepository.upsert` implementations preserve `postedAt`/`entryId` on conflict, identically. | Before this, the memory repository spread `...input` last; since every caller upserts with `postedAt: null, entryId: null`, a second upsert of an already-posted accrual made it look unposted to `shouldPost` — a real double-post risk no test caught. | None stated as a cost, but the defect it prevents is stated: posting interest to a real financial account twice. Tasks 15 and 16 each carry a test that re-upserts an already-posted accrual and asserts it stays posted with the same `entryId`. |
| **P3-17** | *(pre-flight repair)* The Interests list page renders `RuleForm` as its create-rule affordance. | `RuleForm` and `createInterestRuleAction` would otherwise be dead exports, and Task 22's runbook pointed at a "Finance › Interests › New rule" path no task builds. The spec's page map (§4) lists no create route, so the plan does not invent one. | None stated. `docs/deploy/phase-3-runbook.md` and `docs/migration/wallet-manager-cutover.md` both point at the list page's form. |
| **P3-18** | *(pre-flight repair, mechanical)* Four factual corrections: Task 10's `registerAllRoutes` line reference `app.ts:157-161` → `app.ts:141-145`; Task 11's **Produces** block gains `categoryId`; the File Structure block renamed `ProviderTransactionsSource` → `TransactionsSource`; Task 12 Step 9 replaced prose with concrete code. | Each was a place the plan contradicted itself or the real tree. | None stated. |

---

## Rulings — execution (P3-C1 … P3-C48)

49 rulings under 48 numbers. **`P3-C38` was assigned twice** — once to Task 21's
stale-brief-line finding and once to the Task-23-vs-whole-branch-review ordering
decision. Both are recorded below as *(first use)* and *(second use)*; the
numbers are left as the running ledger assigned them so that ledger citations
still resolve, rather than renumbered here and made to disagree with the source.
`P3-C39` … `P3-C48` were made after Task 23's original checkpoint, on the
whole-branch review's findings — see the new "Whole-branch review and fix-wave
rulings" section below the Interests rulings.

Where the ledger recorded no explicit "cost if wrong", this table says
**not recorded** rather than supplying one.

### Process rulings

- **P3-C1 — implementation proceeds on `main` with no worktree.**
  *Why:* the project hook blocks branch/worktree creation; same precedent as Phases 0-2.
  *Cost if wrong:* not recorded.
- **P3-C2 — implementers do NOT run `graphify update .` and do NOT commit `graphify-out/`; the graph is regenerated once at the end of the phase.**
  *Why:* carries Phase 2's ruling P2-C15 forward — per-task regeneration rewrites a very large `graph.json` and made review packages unreadable.
  *Cost if wrong:* not recorded. (The graph was stale for 22 tasks and was regenerated by Task 23; see the checkpoint.)
- **P3-C3 — tasks are pipelined: the next implementer is dispatched while the previous task's reviewer runs; only one implementer writes at a time.**
  *Why:* carries Phase 2's ruling P2-C16 forward. Reviewers are read-only, so there is no write conflict.
  *Cost if wrong:* not recorded.
- **P3-C19 — dispatches move to whichever model tier is not currently throttled rather than stalling the loop; the per-task review gate is unchanged regardless of tier.**
  *Why:* both opus and sonnet hit provider session limits during this run (opus twice, sonnet once).
  *Cost if wrong:* some tasks are implemented or reviewed a tier away from the ideal choice.
- **P3-C38 *(second use)* — Task 23 writes the checkpoint against the tree as it stands at `15bfa94`, and the Phase 3 whole-branch review runs after it. Any fix wave that review produces is appended to the checkpoint as a dated addendum rather than rewriting its commit range.**
  *Why:* the same shape Phase 1's production-deploy addendum used.
  *Cost if wrong:* the checkpoint's headline range needs one appended section instead of being correct in a single pass.

### Pre-flight repair rulings

- **P3-C4 — repair the plan before executing.**
  *Why:* only 7 findings, but two are load-bearing and one would ship a financial defect.
  *Cost if wrong:* one short planning pass.
- **P3-C5 — `ErrorResponseSchema` is shared by import, not redeclared per module.**
  *Why:* the plan's claim that per-module duplication is this codebase's convention is FALSE — `src/modules/integrations/api/routes.ts:27` already imports it from `@/modules/accounts/api/schemas`. Three fresh schemas all tagged `.openapi("ErrorResponse")` on one shared app is a generation collision, not cosmetic duplication.
  *Cost if wrong:* not recorded. (Became plan ruling P3-15.)
- **P3-C6 — both `InterestAccrualsRepository.upsert` implementations must preserve `postedAt`/`entryId` on conflict, with a test that re-upserts an already-posted accrual.**
  *Why:* the memory fake spread `...input` last, resetting those fields; `shouldPost` reads exactly them; no test in Tasks 15, 16 or 19 re-upserted a posted accrual. Same memory-vs-Drizzle divergence class that bit Phase 2 three times, except here the consequence is posting interest to a real financial account twice.
  *Cost if wrong:* not recorded — this is the one pre-flight finding that would have shipped a real financial defect. (Became plan ruling P3-16.)
- **P3-C7 — render `RuleForm` on the Interests list page as the create affordance, and correct the runbook wording.**
  *Why:* `RuleForm.tsx` and `createInterestRuleAction` were created but never imported, and the runbook pointed at a route no task builds. The spec's page map has no create route.
  *Cost if wrong:* rule creation sits on the list page rather than its own page, which a later phase can move.
- **P3-C8 — the four remaining pre-flight findings are mechanical and fixed in the same pass.**
  *Why:* wrong line reference, an omitted `categoryId`, a stray type name, and a prose-only code step.
  *Cost if wrong:* not recorded. (Became plan ruling P3-18.)

### Expenses rulings

- **P3-C9 — the unguarded `l.entityType as "account"` cast in `accounts/api/routes.ts` joins the phase cleanup wave rather than a fix round.**
  *Why:* it is true today (one private caller, hardcoded `"account"` literal) but has no runtime backstop, so a later generalisation of `getAccountDetail`'s `liveFor` call would silently mislabel a transaction link as an account with no compile-time signal.
  *Cost if wrong:* the cast stands unguarded until the cleanup wave.
- **P3-C10 — fix all three Important findings on recurring detection.**
  *Why:* (a) only the monthly cadence was exercised — weekly, biweekly, quarterly and annual bands had no test, and a typo in a band literal ships silently; (b) `lastSeenAt`/`nextExpectedAt` were never asserted, and `nextExpectedAt` is shown to the user as a prediction; (c) `Math.abs` discarded the sign before the amount-band check, so a recurring debit and an unrelated same-magnitude refund grouped into one "recurring" pattern. Brief-inherited, but the task's own brief says a false positive is worse than a miss, and the plan does not get to grade its own work.
  *Cost if wrong:* not recorded.
- **P3-C11 — `detectRecurring` groups by `(payee, currency)` inside the function rather than relying on a caller that does not exist yet.**
  *Why:* grouping by payee alone would compare mixed-currency candidates by raw magnitude as if commensurable. A function that is safe on its own inputs beats a documented precondition nobody enforces.
  *Cost if wrong:* one extra grouping key.
- **P3-C12 — the Minor "test titles overstate their assertions" is promoted into the fix round.**
  *Why:* "update rejects a stale version without applying the patch" never checked the patch was not applied, and "replaceAll discards the previous set for that user only" never created a second user. A test that asserts less than its name claims is the failure mode this phase had already hit twice.
  *Cost if wrong:* two short assertions.
- **P3-C13 — the FAKE changes to match the REAL on cursor/filter interaction, not the other way round.**
  *Why:* Drizzle anchors on the row's `(occurredAt, id)` tuple regardless of the other filters; the fake computed position within the already-filtered array. Keyset pagination anchoring on the sort key is the standard and the cheap-in-SQL behaviour, so the real implementation is the source of truth.
  *Cost if wrong:* a caller that changes filters mid-pagination gets a page boundary computed from a row the new filters exclude — which is why it must be documented.
- **P3-C16 — the pre-existing Phase 1 `DrizzleGroupsRepository.create/rename` transaction-abort bug is assigned to the phase cleanup wave with the savepoint pattern.**
  *Why:* it catches a unique-constraint violation inside an open transaction, which in Postgres leaves the transaction aborted so every later statement in the same request fails. Out of Phase 3's scope, but "it predates this phase" is a poor reason to leave a known transaction-abort bug in shipping code when the fix is now established in this codebase.
  *Cost if wrong:* a Phase 1 module gains a fix in a Phase 3 commit, which the commit message will explain.
- **P3-C17 — prove idempotence of the transactions reconciliation by assertion, not by inspection.**
  *Why:* the implementation IS idempotent, but the committed test only asserted no duplicate rows — not `transactionsUpdated === 0`, `version` or `updatedAt`. The cursor deliberately re-fetches an overlapping window every run, so idempotence is load-bearing and an over-eager patch bumping `version` on every sync would pass undetected.
  *Cost if wrong:* not recorded.
- **P3-C18 — fix the duplicate-external-id-inside-one-batch hole, and do not let "the accounts module does the same" settle it.**
  *Why:* `transactionLinks` is a snapshot Map fetched before the loop and never updated within the run, so two records sharing an `externalId` both take the create branch: two local transactions, spending counted twice, and the first link orphaned. Accounts tolerate that shape because a balance snapshot is idempotent by nature; transactions are additive, so the duplicate directly overstates spend.
  *Cost if wrong:* the fix is to update the map as records are processed, which is contained.
- **P3-C20 — the transactions sync's missing trigger and inert cursor is a PHASE-LEVEL GAP, assigned to Task 12.**
  *Why:* `sync_jobs` rows are created only at connect time, so an already-connected production user has an accounts job row and no transactions one; with no row, `prepare` sets `jobId: null`, `run-sync.ts` guards the cursor write on it, `setCursor` is silently discarded, and every run re-fetches the provider default window. No dispatcher enumerated `sync_jobs` by schedule. As it stood, the phase would ship a sync nothing starts.
  *Cost if wrong:* Expenses would populate only via a hand-made API call, failing the phase's own exit criterion.
- **P3-C21 — the transactions cursor window gets real test coverage.**
  *Why:* the test passed `cursor: null` with a no-op `setCursor` and a mocked `getRecords` that ignored its arguments. A sign flip turning minus seven days into plus seven would skip a week of records on every run and leave all 761 tests green — precisely this phase's worst failure mode.
  *Cost if wrong:* not recorded.
- **P3-C22 — the plan-mandated DTO widening is FIXED, not accepted.**
  *Why:* `Transaction` leaked `userId` and `syncRunId`; `TransactionCategory` leaked `userId`, `parentId`, `createdAt`, `updatedAt`; `TransactionLabel` was a raw pass-through with no DTO at all. "Nothing validates outgoing responses" explains why this is invisible, not why it is harmless: the published OpenAPI contract described a narrower shape than the API returned, and `syncRunId`/`parentId` are internal foreign keys, not product data.
  *Cost if wrong:* three small mapping functions where a spread used to be.
- **P3-C23 — surface `nextCursor` on the Expenses page.**
  *Why:* the loader computed and returned it precisely so callers could act on it, and the page never read it. A user with more than 50 transactions saw the first 50 with no count, no "load more" and no notice — the third instance of "incomplete presented as complete" in this phase and the first one a person would actually see.
  *Cost if wrong:* not recorded.
- **P3-C24 — narrow `getTransaction(...).catch(() => null)` to `NotFoundError` and rethrow the rest.**
  *Why:* it converted EVERY error into `notFound()`, so a database failure or a bug in the use case rendered as a plain 404 with the real cause erased.
  *Cost if wrong:* not recorded.
- **P3-C25 — the edit form renders the row's current category as an explicit option when it is not among the listed ones.**
  *Why:* `defaultValue={row.categoryId ?? ""}` with no matching option makes the browser silently select a different one — visually misrepresenting the transaction's category, and a save would then write that wrong category.
  *Cost if wrong:* not recorded.
- **P3-C26 — the missing `loadTransactionDetail` rethrow test goes to the cleanup wave rather than costing another fix round.**
  *Why:* the re-reviewer rejected the implementer's justification and the controller accepted that: the loader is a plain function in the same file as one that IS unit-tested, with the seams already in place, so the test was about ten lines. The behaviour was verified correct by inspection, making it a coverage gap rather than an open finding.
  *Cost if wrong:* the substance of a finding the controller raised ships without a direct test until the cleanup wave.
- **P3-C27 — ensure the sync job row inside `prepare()` rather than at the two manual call sites.**
  *Why:* patching the callers closes today's two paths and leaves the next one to rediscover the same defect; ensuring the row for the resolved kind inside `prepare()` closes every current and future path at once.
  *Cost if wrong:* `prepare()` gains a write on a path that previously only read, which the tests must cover.

### Interests rulings

- **P3-C28 — both unproven schema properties are proven here, not deferred.**
  *Why:* the `(rule_id, accrual_date)` unique index is the single mechanism standing between a daily job re-run and double-posting real money, and it was asserted only by reading generated SQL. Same for `interest_accruals_owner`, verified only by textual analogy to `account_balances_owner`. This phase had already produced one real defect from a property assumed by analogy rather than tested.
  *Cost if wrong:* eight lines of test.
- **P3-C29 — fix all five Important findings in the accrual kernel.**
  *Why:* this is the money kernel and every one is a place the code produces a wrong or over-confident number rather than an absent one.
  1. `parseDecimal("")` returned `0n`, so an absent balance yielded net `"0.00"` — an affirmative claim that nothing accrued, the exact failure mode the "never invent financial data" constraint names.
  2. `parseDecimal("1.2.3")` silently returned `1.2` — the one malformed shape producing a wrong number instead of an absent one, for the cost of one regex.
  3. No conservation invariant test: `net + carryAfter == netRaw + priorCarry` was never asserted. That is the test that generalises past hand-picked inputs.
  4. A negative `annualRate` or a `taxRate` above 1 made `totalRaw` negative, `net` floored to zero, and the negative remainder rolled forward forever, silently consuming later positive periods. *(The implementer chose to **reject** such inputs rather than pin the behaviour — the stricter and better choice.)*
  5. `reconcileInterest([], [], period)` returned `"matched"` — an affirmative claim that the books agree, made from zero evidence. The `ReconciliationStatus` union had no member able to say "cannot compute", so this was a PLAN defect; the union was widened with **`no_data`**.
  *Cost if wrong:* not recorded.
- **P3-C30 — fix both repository test gaps (Task 15).**
  *Why:* (a) `listForRule` had no ordering assertion, and the phase's own global constraints name interest entries among the repository pairs requiring an explicit "same order as Drizzle" assertion; (b) the `listActiveForAllUsers` test asserted only `toHaveLength(1)`, so a reversed date comparison would still yield one row — the wrong one — and pass.
  *Cost if wrong:* not recorded.
- **P3-C31 — `markPosted` must report whether it actually affected a row, and the posting adapter must treat "affected nothing" as a failure; assigned to Task 19.**
  *Why:* `markPosted` silently no-oped on a non-matching id (wrong owner, or a typo), and neither implementation reported it. If the posting adapter believes it marked an accrual that in fact stayed unposted, the next run posts the same interest AGAIN.
  *Cost if wrong:* a port signature widens by a return value, touching the fake and the Drizzle side together in the task that consumes them.
- **P3-C32 — gate the projection on `compounding === "simple_daily"`, matching the job's own guard.**
  *Why:* `runInterestAccrual` skips non-`simple_daily` rules, but `getInterestRuleDetail`'s projection guard checked only balance and `dayCount`. Since the create schema accepts `"monthly"` and `"none"`, a caller could create such a rule and receive a confident multi-day projection of currency amounts computed with the simple-daily formula — a forecast of interest the job has promised never to post.
  *Cost if wrong:* one condition added to a guard.
- **P3-C33 *(Critical)* — pass `attempts: 1` to `postRecords`.**
  *Why:* it retried five times on 429, 409 and any 5xx with no idempotency key, and 409 on a write endpoint usually MEANS "already exists". The "inherited from Task 6" defence fails on the codebase's own evidence: `postRecords` had zero call sites until this commit, so this task is what makes a dormant function fire at a financial API.
  *Cost if wrong:* not recorded.
- **P3-C34 *(Critical)* — add the provider-side pre-check before posting.**
  *Why:* the report closed the crash window on the premise that no provider dedup exists, but `interest.py:167-173` — in the very script this task retires — implements `already_posted_today()` against the live Wallet API using the same note marker this adapter writes, as a second line of defence after its own state check. A `GET /records` filtered by account, date and note marker closes both criticals with no human in the loop. Also stop discarding the POST response so the provider record id can land on the entry.
  *Cost if wrong:* not recorded.
- **P3-C35 — do NOT narrow the job lock; fix the comment instead.**
  *Why:* holding the lock across the network call is exactly what prevents the concurrent double-post, and the codebase documents that shape as deliberate elsewhere. `tryPost` does correctly close its own user-context transactions before the call, and that is what the comment should say.
  *Cost if wrong:* not recorded.
- **P3-C36 — add the missing 422 test on the interests API.**
  *Why:* the mapping is correct by inspection, but reachable by a real caller — the wire schema types `annualRate`/`taxRate` as plain strings, so a `taxRate` of `"1.5"` passes OpenAPI validation and is rejected only by the use case's stricter check. User-facing behaviour with no coverage, in a phase whose own rubric required proof-by-test for exactly this class elsewhere.
  *Cost if wrong:* one test.
- **P3-C37 — REMOVE the automatic 30-day posting sweep rather than bounding it.**
  *Why:* `shouldPost` reads the CURRENT posting mode, so every accrual written while a rule was analyze-only carried `postedAt: null` and `net > 0` and became eligible the instant `postingMode` flipped — at exactly step 4 of the cut-over procedure, after the doc's own step 2 prescribes a week or more of parallel running during which the standalone container posted those same days. The only thing between that and duplicated real money was `findPostedRecord` matching the container's records, which rests on an unverified semantic (whether Wallet's `recordDate=eq.<day>` filter is day-grained against the container's full-timestamp `recordDate`). Bounding it correctly needs a "posting enabled at" fact the schema does not carry, and every alternative adds surface to the one task in the phase that writes real money, at the end of a long phase. Removing it eliminates the Critical outright instead of narrowing it.
  *Cost if wrong:* a genuine outage still loses that day until someone acts on the logged skip.
- **P3-C38 *(first use)* — the brief's `updateInterestRule` Consumes line is a STALE BRIEF LINE, not a dropped requirement.**
  *Why:* the API provides the update path (Task 20's PATCH, tested), the spec's page map has only the list and detail routes, and a UI edit affordance would today be the natural home for a posting-mode toggle — which is deliberately absent while the adapter's flip-the-switch hazard is being removed. A rule-edit surface belongs to a later phase that can ship it together with a safe posting-mode control.
  *Cost if wrong:* editing a rule requires the API until then.

### Whole-branch review and fix-wave rulings (P3-C39 … P3-C48)

Made after Task 23's original checkpoint (`d644471`), on the findings of the
whole-branch review dispatched over `67747cb..15bfa94` (41 commits, split
`wb-1` persistence/RLS, `wb-2` expenses + sync engine, `wb-3` interests/the
money path, `wb-4` API/UI/docs). That review found **three Critical defects**
and **thirteen Important findings** — see "The whole-branch review's
findings" below for the full list. These rulings decided how to fix them,
before dispatching the three-batch fix wave.

- **P3-C39 (posting claim) — adopt `wb-3`'s committed-claim fix, shaped so it
  fails toward NOT paying.** `markPosting` does a conditional `UPDATE
  interest_accruals SET posted_at = now() WHERE id = $1 AND posted_at IS NULL
  RETURNING id` **before** the Wallet call; a confirmed success then writes
  `entry_id`; a confirmed failure reverts `posted_at` to null. A crash in
  between leaves `posted_at` set with `entry_id` null — an observable
  in-flight state, which reconciliation and the UI must surface as
  indeterminate, never as paid and never as nothing.
  *Why:* under-paying is visible and recoverable; double-paying real money is
  neither.
  *Cost if wrong:* an interrupted post needs an operator to resolve one
  clearly-flagged row instead of resolving nothing.
- **P3-C40 (date grain) — post the bare `accrualDate`, not a timestamp, so
  the write and the duplicate-check read use the same grain.**
  *Why:* removes the timezone question entirely instead of documenting it.
  *Cost if wrong:* Wallet stores a date where it previously got midnight
  UTC — the same instant it was already resolving to.
- **P3-C41 (marker) — the note marker gets a per-rule suffix, and the
  duplicate check matches on the suffixed marker.**
  *Why:* two rules on one account can then never adopt each other's record.
  Safe to change freely — nothing has posted in production, Phase 3 is not
  deployed.
  *Cost if wrong:* not recorded.
- **P3-C42 (recurring index) — the DETECTOR's grouping key is the truth;
  widen the constraint to `(user_id, payee, currency, sign)` rather than
  collapsing the detector's groups.**
  *Why:* a EUR series and a USD series genuinely are two series and the UI
  should show both; collapsing them would hide one.
  *Cost if wrong:* `recurring_patterns` carries two columns it would not
  otherwise need.
- **P3-C43 (negative balance) — do not accrue at all on a negative balance;
  record a visible skip with its reason, rather than writing net `0.00` and
  carrying an unbounded negative remainder.**
  *Why:* the prior behaviour silently consumed later real interest, and
  "never invent financial data" cuts against writing a `0.00` row that
  reconciles as matched while a debt accumulates behind it. A deliberate
  divergence from `interest.py`, which handled this case badly; documented as
  such.
  *Cost if wrong:* a negative-balance day is absent rather than
  present-as-zero — the more honest of the two.
- **P3-C44 (inert rules) — keep `dayCount: "actual"` and `compounding:
  "monthly"/"none"` accepted by the schema (spec §5.7 fidelity, P3-7), but
  make the inertness visible: a per-rule skip reason in the job detail, a
  skipped counter, and a UI signal on the rule.**
  *Why:* rejecting them at the write boundary would contradict the schema
  the spec asked for.
  *Cost if wrong:* a forward-compat placeholder is visible as unsupported
  rather than unavailable.
- **P3-C45 (transfer pairing) — pairing must reconsider already-stored
  unpaired legs, not only this run's incoming batch — bounded to a window
  rather than a full-table scan.** *(Superseded in implementation — see
  batch C1 below: the implementer substituted a lookup by the provider's own
  counter-record id, judged better on its merits and approved by the
  re-reviewer.)*
  *Cost if wrong (as specified):* a bounded window still misses a
  pathologically late leg, which is strictly better than today's guaranteed
  miss beyond 7 days.
- **P3-C46 (fix-wave batching) — three SEQUENTIAL dispatches, not parallel.**
  *Why:* the standing rule against concurrent implementers holds, and two of
  the three batches need their own migration, which would collide. Order: A
  persistence (owns the next migration number), B the money path (owns the
  one after), C sync + UI (no migration).
  *Cost if wrong:* not recorded.
- **P3-C47 (re-verification) — the fix wave invalidates Task 23's gate run
  and its graphify regeneration; both re-run after the wave, and the
  checkpoint gets its commit range corrected rather than an addendum, since
  the correction lands before anything is deployed.**
  *Why:* stated in the ruling itself.
  *Cost if wrong:* not recorded. (This is the ruling this correction task
  executes.)
- **P3-C48 (parked, not fixed) — `interest-accrual-notice.ts` hardcodes the
  provider's brand name outside `*-adapter.ts`.**
  *Why:* it is a NEW INSTANCE of an existing violation
  (`RulesTable.tsx`'s "Posts to Wallet" predates the fix wave), not a new
  violation, so opening a fourth fix round for UI copy was judged not worth
  it. Parked for whichever later phase reviews user-facing copy.
  *Cost if wrong:* one more string to change when the provider abstraction
  is tightened.

### The whole-branch review's findings (for reference)

**Three Critical defects**, none of which 22 individually-clean per-task
reviews had caught, because a per-task reviewer cannot see across tasks:

1. **`wb-1`** — `recurring_patterns_user_payee_uq` was `(user_id, payee)`
   while `detectRecurring` groups on payee + currency + sign. Two groups
   sharing a payee (a currency split, or an income/expense sign split) 23505
   on `replaceAll`'s multi-row INSERT, which escapes `apply()` — and
   `wallet-provider-adapter` runs that in the SAME transaction as
   `syncProviderTransactions`, so the entire sync run rolls back. The
   detector re-derives from `listAll()` every run, so it repeats forever:
   expenses sync stops permanently for that user.
2. **`wb-3`** — the posting duplicate-check queried a date grain it did not
   write (a full timestamp written, a bare date read), which — after the
   automatic backlog sweep had already been removed (P3-C37) — was the ONLY
   thing between a mid-post restart and a second real posting, unverified
   against a live token.
3. **`wb-3`** — posting correctness rested on an advisory lock held open
   across the Wallet network round trip (a call that can run for minutes).
   A pooler kill, timeout, or failover releases the lock mid-POST; the
   crontab retries on failure, so concurrent triggers were routine. Two
   concurrent ticks could both post.

**Thirteen Important findings**, closed in the same fix wave: four tables'
RLS declared but unobserved by any real test (`wb-1`); a fake/real `list()`
`from`/`to` divergence and an unvalidated wire format (`wb-1`); a fake/real
`liveFor()` divergence with two providers on one account, pre-existing from
Phase 2 (`wb-1`); label/category ownership enforced nowhere (`wb-1`);
`DrizzleInterestRulesRepository.list()` with no `ORDER BY` (`wb-1`); transfer
legs more than 7 days apart never pairing, double-counting spend (`wb-2`);
`PostRecordInput.amount` typed `number` against every other money field being
`string` (`wb-2`); `interest_entries.transaction_id` typed `uuid` while
receiving Wallet's opaque provider id, so money could leave while the local
row rolled back (`wb-3`); "already posted" concluded with no per-rule scoping,
letting two rules on one account adopt each other's record (`wb-3`);
`netCents` clamping to zero while `carryAfter` carries an unbounded negative
remainder (`wb-3`); `dayCount`/`compounding` combinations accepted by the
schema producing a permanently inert rule with no signal (`wb-3`); nothing
validating a rule's account belongs to the rule's user (`wb-3`); and
`interest_accrual` missing from the admin panel's Scheduled-jobs arrays that
two shipped documents told operators to check (`wb-4`).

### Fix wave — three sequential batches, all approved on first re-review

- **Batch A — persistence** (commits `48709aa`, `1e32ff9`, `f00c132`;
  migration `0013_expenses_ownership_fixes.sql`). Unit 873→882/93 files;
  integration 103→113/30 files; tsc clean. Closed A1 (Critical 1, the
  recurring-patterns index, proven with a real-Postgres test inserting two
  same-payee groups differing only by currency and only by sign), A2 (RLS for
  the four unobserved tables, proven by deliberately re-weakening the policy
  on a scratch database and confirming the new test fails before restoring
  it), A3–A7 (the remaining `wb-1` Important findings). Re-reviewed as
  `rr-a` — **APPROVED**, with file:line evidence for every item.
- **Batch B — the money path** (commits `da41da2`, `61c9c1c`, `0a0905b`,
  `f3f3832`, `ce743b4`; migration `0014_interest_posting_fixes.sql`). Unit
  882→897/93 files; integration 113→118/30 files; tsc clean. Closed both
  remaining Criticals (the durable posting claim per P3-C39, and the
  date-grain fix per P3-C40) plus B3–B9 (per-rule markers, negative-balance
  skip, visible skip reasons and counters, account-ownership validation, and
  a money-safety batch: decimal-string amounts, no silent response-shape
  swallowing, a single cent-rounding point). The runbook now requires
  verifying the posting round-trip against a live token before any rule is
  first flipped to `post_to_provider`. Re-reviewed as `rr-b` — **APPROVED**;
  the re-reviewer independently confirmed the claim commits before the
  Wallet call regardless of the surrounding lock's transaction, and that
  `releaseClaim` cannot revert a claim after the money has left.
- **Batch C — sync + UI, no migration** (commits `aef890a`, `ab25461`,
  `9497f59`, `60cda52`, `09b5739`). Unit 897→909/94 files; integration
  118→119/31 files; tsc clean. C1 (transfer pairing) was **not** implemented
  as briefed by P3-C45 — the substitution (lookup by Wallet's own
  `transferCounterRecordId` rather than a bounded-window rescan) is judged
  better and is proven with legs synced 10 days apart across two separate
  runs. C2 added `interest_accrual` to the admin panel. C3–C7 closed the
  remaining `wb-2`/`wb-4` findings, including both broken cut-over doc links.
  Re-reviewed as `rr-c` — **APPROVED**; ruling P3-C48 (the one parked minor)
  was recorded during this re-review.

**Phase 3 fix wave: CLOSED. All three batches approved on the first
re-review.** Final counts after the fix wave: **909 unit tests / 94 files**,
**119 integration tests / 31 files**, `tsc --noEmit` clean, `npm run build`
succeeds, `npm run e2e` 4/4, `npm run openapi:generate` produces no drift —
all re-confirmed by this correction task on `09b5739` (see the checkpoint).

### Consequences of P3-C37 and P3-C29 that later work must not contradict

Two behaviours changed late in the phase, after most of the plan text was
written. Any document that describes the old behaviour is wrong:

1. **There is no automatic back-posting sweep.** `runInterestAccrualJob` posts
   the current Rome-calendar day's accrual only. A day that could not be posted
   is logged (`interest_post_skipped`) and counted for an operator; nothing
   recovers it automatically. The only in-app lever is re-triggering the daily
   job on the **same Rome-calendar day**, and it expires at the `romeDate`
   rollover. `docs/deploy/phase-3-runbook.md` §5 and
   `dashboard-app/docs/migration/wallet-manager-cutover.md` both say so.
2. **`reconcileInterest` has an explicit `no_data` status.** A period with
   *no accrual rows at all* returns `no_data`, never `matched` — "the accrual
   job never ran" and "nothing was owed" are different facts. `missing` means
   something different and narrower: accruals exist, and nothing has been paid
   against them (`paidCents === 0 && accruedCents > 0`). Verified in
   `src/modules/interests/domain/reconciliation.ts:78-80` at the exit gate.

A third change landed later still, in the whole-branch review's fix wave, and
any document written against Task 23's original checkpoint predates it too:

3. **Posting correctness rests on a durable database claim, not the advisory
   lock.** `claimForPosting` commits `UPDATE interest_accruals SET posted_at
   = $2 WHERE id = $1 AND posted_at IS NULL RETURNING id` before the Wallet
   call. The lock (`withJobLock`) is retained and documented as an
   optimisation only. A crash between a successful post and the local write
   leaves `postedAt` set with `entryId` null — an observable in-flight state,
   never reported as paid and never silently retried. Rulings **P3-C39** and
   **P3-C40**; proven in `rr-b`.

---

## Deferred by design

What Phase 3 deliberately left for later. None of these is an oversight; each
was decided and recorded while the phase ran.

- **Full category/label management UI** (rename, merge, hierarchy) — Phase 9's
  Management area. Phase 3 reads categories and labels and lets a transaction be
  recategorised; it does not let you curate the category tree.
- **`monthly`/`none` compounding, and `dayCount: "actual"`** — accepted by the
  schema for spec §5.7 fidelity, never computed (P3-7). The accrual job skips
  such a rule and, since P3-C32, so does the projection. A rule created with
  them produces no accrual and no forecast, by design. Since the fix wave's
  **P3-C44**, this inertness is also visible: a per-rule skip reason in the
  job detail, a skipped counter, and a signal on the rule's own page — it is
  no longer a silent no-op.
- **Reconciliation persisted as `reconciliation_issues` rows** — reconciliation
  is computed on read only in Phase 3 (`reconcileInterest`), matching the spec's
  Funds section's later, more elaborate reconciliation-issue model rather than
  pre-empting it.
- **A `SyncSchedule` finer than `hourly` for transactions** — Phase 2 already
  noted per-connection schedule toggles have no UI; this phase does not add one.
  The transactions sync runs on the existing hourly tier.
- **Bulk re-post or backfill tooling for a rule enabled after existing history
  has accrued** — the job only ever computes and posts "today", so enabling
  `post_to_provider` on an old rule starts posting from the next tick forward,
  not retroactively. Documented in the cut-over doc's step 4. Since P3-C37 this
  also covers the narrower case of a *single* day that failed to post: it is
  logged and counted, and recovering it needs an operator, not a later tick.
- **A rule-edit UI surface** (P3-C38 first use) — the PATCH endpoint exists and
  is tested; no page calls it. It belongs to a later phase that can ship it
  together with a safe posting-mode control.
- **A currency column on `interest_accruals` / `interest_entries`** — consistent
  with `account_balances`, the closer analog, so not drift; but the shape of gap
  that becomes expensive once accounts can differ in currency.
- **`postRecords` amount round-trip verification, and the Wallet `/records` and
  `/categories` field names generally** — unverifiable without a live token
  (P3-10). Every guess fails loudly behind Zod rather than mis-mapping silently.
  The fix wave's batch B turned the amount round-trip and the posting
  date-grain match into a documented **precondition** in the runbook: verify
  both against a live token before any rule is first switched to
  `post_to_provider`.

---

## The running ledger, verbatim

Copied from
`.superpowers/sdd/2026-09-05-phase-3-expenses-and-interests/progress.md`
without edit, per the Phase 0/1 and Phase 2 precedent. The version committed
as `d644471` copied only as far as the running ledger had reached at that
moment — Tasks 1–22 plus the start of the whole-branch review, with only its
`wb-4` package having reported. This correction replaces that partial copy
with the **complete** record: all four whole-branch review packages
(`wb-1`..`wb-4`), the rulings made on their findings (`P3-C39`..`P3-C48`,
reproduced in full above), the three fix-wave batches, and their independent
re-reviews (`rr-a`/`rr-b`/`rr-c`), ending where the source file itself ends —
"Phase 3 fix wave: CLOSED. All three batches approved on the first
re-review." Nothing follows that line in the source at the time of this
correction, so there is no further addendum owed here.

---

# SDD ledger — plan: docs/superpowers/plans/2026-09-05-phase-3-expenses-and-interests.md
Spec: docs/superpowers/specs/2026-09-02-finance-company-platform-design.md (read; binding authority)
Baseline before Task 1 (commit 8b108a2): typecheck clean, 706 unit / 70 files, 49 itest / 20 files, build ok.
Ruling P3-C1: implementation proceeds on `main` with no worktree — the project hook blocks branch/worktree creation; same precedent as Phases 0-2.
Ruling P3-C2: implementers do NOT run `graphify update .` and do NOT commit `graphify-out/`; the graph is regenerated once at the end of the phase (Phase 2 ruling P2-C15 — per-task regeneration made review packages unreadable).
Ruling P3-C3: tasks are pipelined — the next implementer is dispatched while the previous task's reviewer runs; only one implementer writes at a time (Phase 2 ruling P2-C16).
Risk carried from the planner: the Wallet `/records` and `/categories` response schemas are best-effort and were NOT verified against a live token. Everything in the transactions sync depends on them. Flagged to the pre-flight scan and to every reviewer of tasks 6-8; the Phase 3 runbook must tell the operator to verify the shapes on first sync.

## Pre-flight scan
(pending — scanner dispatched)

## Progress

### Pre-flight rulings (2026-09-05)
Scan: preflight-scan.md — 15 pair rows, 6 task rows, 7 findings. Spec §11 coverage clean. Three of the four named hazards verified CLEAR against real code: RLS discipline (every repository call sits inside inUserContext/inSystemContext), transaction/network discipline including the posting adapter's push, and fail-safe handling of the unverified Wallet response shapes. Far better than Phase 2's 38 findings.

Ruling P3-C4: repair the plan before executing. Only 7 findings, but two are load-bearing and one would ship a financial defect — cost if wrong: one short planning pass.
Ruling P3-C5 (ErrorResponseSchema): the plan's claim that per-module duplication is this codebase's convention is FALSE — src/modules/integrations/api/routes.ts:27 imports ErrorResponseSchema from @/modules/accounts/api/schemas, so the real convention is share-by-import. Tasks 10, 12 and 20 each declaring a fresh schema still tagged .openapi("ErrorResponse") would put up to four distinct objects behind one OpenAPI component name on a single shared app — a generation collision, not cosmetic duplication. All three import the existing shared schema instead.
Ruling P3-C6 (accrual upsert divergence — the one that would ship a real defect): MemoryInterestAccrualsRepository.upsert spreads `...input` last, resetting postedAt/entryId to null on every re-upsert, while the Drizzle onConflictDoUpdate omits those columns and preserves them. The posting adapter's `shouldPost` idempotency check reads exactly those fields, so under the fake an already-posted accrual looks unposted — and no test in tasks 15, 16 or 19 re-upserts a posted accrual. This is the memory-vs-Drizzle divergence class that bit Phase 2 three times, except here the consequence is posting interest to a real financial account twice. Both implementations must preserve postedAt/entryId on conflict, with a test that re-upserts an already-posted accrual and asserts it stays posted.
Ruling P3-C7 (dead export + a runbook pointing at a UI that does not exist): RuleForm.tsx and createInterestRuleAction are created but never imported, and Task 22's runbook tells the operator to visit "Finance › Interests › New rule", a path no task builds. The spec's page map (§4) lists only /finance/interests and /finance/interests/rules/[id] — no create route. Resolution: render RuleForm on the Interests LIST page as the create affordance, giving both exports a real caller without inventing a route the spec does not have, and correct the runbook wording to match — cost if wrong: rule creation sits on the list page rather than its own page, which a later phase can move.
Ruling P3-C8: the four remaining findings are mechanical and fixed in the same repair pass — Task 10's wrong line reference for registerAllRoutes (app.ts is 145 lines, not 157-161); Task 11's Produces block omitting categoryId that its own implementation includes; the File Structure naming ProviderTransactionsSource where every consumer says TransactionsSource; and Task 12 Step 9 being prose where every other step in the plan gives concrete code.

## Progress
Task 1: implemented (commit e73d32f), under review. Caught the journal-tag inconsistency the brief warned about (drizzle auto-named the file 0011_worried_bloodstrike, which did not match the renamed 0011_transactions.sql) and fixed _journal.json by hand, verifying the full migration chain applies.
Task 2: dispatched (base e73d32f).
Task 1: complete (commits 67747cb..e73d32f, review clean — 0 Critical, 0 Important, 2 Minor). Schema, generated SQL and snapshot verified in exact lockstep across all five tables; prevId chain to 0010 confirmed; the RLS itest proves genuine isolation (A sees one row, system sees both, no-context sees none — the last assertion is what demonstrates FORCE RLS is doing real work). The indirect-ownership table uses the correct EXISTS pattern.
Task 1: controller resolved the reviewer's ⚠️ — ran `npm run db:generate` on this tree: "No schema changes, nothing to migrate". The hand-edited journal left no drift, so Task 13's migration 0012 starts from a clean base.
Task 1: minor (deferred): recurring_patterns.currency has no char_length=3 check while transactions.currency does (brief-inherited); only transactions has an RLS itest — the other four tables' policies are verified by reading SQL, not by a running test.
Task 2: implemented (commit 6470dc3, DONE_WITH_CONCERNS), under review. Concern: providerLinkDto in accounts/api/routes.ts needed a narrowing cast `l.entityType as "account"` to stay tsc-clean, because the accounts API response schema keeps `z.literal("account")`. Flagged to the reviewer with the specific question that decides it: does the query feeding that DTO actually filter to account links? If not, the cast is a lie and the API can emit a transaction link typed as an account.
Task 3: dispatched (base 6470dc3).
Task 2: complete (commits e73d32f..6470dc3, review clean — 0 Critical, 0 Important, 2 Minor). Reviewer traced the cast question to a conclusion: providerLinkDto is private with exactly one caller, and getAccountDetail passes a hardcoded "account" literal to liveFor, so the cast states something true today. Both repository implementations verified in lockstep (same signatures, same predicates, same conflict target) and the unique key still leads with user_id.
Task 2: Ruling P3-C9: the unguarded cast joins the phase cleanup wave rather than a fix round. It is true today but has no runtime backstop, so if a later task ever generalises getAccountDetail's liveFor call it would silently mislabel a transaction link as an account with no compile-time signal — the exact hazard this task existed to prevent elsewhere. A two-line runtime guard closes it — cost if wrong: the cast stands unguarded until the cleanup wave.
CLEANUP WAVE (batch before Task 22):
- accounts/api/routes.ts:99-101 — replace `l.entityType as "account"` with a runtime-checked narrowing.
- recurring_patterns.currency lacks the char_length=3 check that transactions.currency has.
- no RLS itest for transaction_categories, transaction_labels, transaction_label_links, recurring_patterns.
Task 3: review 1 — spec compliant on every export and signature; pairTransfers implements the brief's rule verbatim with genuinely good ambiguous-case tests (lone legs, two references, >2 legs, empty). The money deviation verified correct against the real helpers: toCents parses via regex into an exact integer, never through Number(). 3 Important, 2 Minor.
Task 3: Ruling P3-C10: fix all three Important findings. (a) Only the monthly cadence is exercised — weekly, biweekly, quarterly and annual bands have no test at all, and this is pure cheap-to-test logic where a typo in a band literal ships silently. (b) lastSeenAt and nextExpectedAt are never asserted, and nextExpectedAt is shown to the user as a prediction. (c) Math.abs discards the sign before the amount-band check, so a recurring debit and an unrelated same-magnitude refund group into one "recurring" pattern — brief-inherited, but this task's own brief says a false positive is worse than a miss, and the plan does not get to grade its own work.
Task 3: Ruling P3-C11 (resolves the reviewer's ⚠️ rather than deferring it to an unwritten caller): detectRecurring groups by payee alone and reports last.currency, so mixed-currency candidates under one payee would be compared by raw magnitude as if commensurable. Group by (payee, currency) inside the function instead of relying on a caller that does not exist yet — a function that is safe on its own inputs beats a documented precondition nobody enforces — cost if wrong: one extra grouping key.
Task 3: minor (deferred): the 10% band multiplies by the float literal 0.1 (verified safe up to ~EUR 20,000, but not literally float-free — an all-integer form is `diff * 10 <= median`); pairTransfers does not validate that paired legs have opposite signs or distinct accounts, so a duplicate-ingest anomaly sharing one reference would be grouped as a transfer.
Task 3: fix round 1 held until Task 4's implementer reports (one writer at a time).
Task 4: implemented (commit c6b9abf), under review. CARRY INTO TASK 5: the implementer noted the Drizzle list() cursor-anchor lookup does not filter by userId, reasoning "RLS covers it". That reasoning is what produced Phase 2's import bug — RLS only covers a query that actually runs inside a user context, and a bare-pool read silently returns zero rows instead. Task 5 must filter by userId explicitly AND run inside inUserContext; belt and braces, not either.
Task 4: review 1 — spec compliant, every file matches the brief's literal code, and the reviewer independently confirmed ProviderTransaction/ProviderCategory/TransactionsSource are consumed by Task 7 rather than dead exports. 2 Important, 3 Minor.
Task 4: Important 1 (fix) — the fake generates ids with crypto.randomUUID (v4, random) while production defaults to uuidv7 (time-ordered), and list()/listAll() tie-break on desc(id). So for transactions sharing an occurredAt the fake's order is random where production's is chronological, and date-only precision makes such ties common in financial imports. Latent today because no test constructs a tie — but pagination is built on this fake in later tasks. Fix with a monotonic id generator in the fake, plus a same-occurredAt tie-break test.
Task 4: Important 2 — the cursor-anchor scope divergence is ALREADY CARRIED into Task 5, whose dispatch instructs adding the explicit userId predicate. The reviewer sharpened why it matters: if RLS fails closed the anchor select finds nothing for a legitimate cursor, `anchor` is undefined, and the keyset condition is silently skipped — pagination quietly resets to page one rather than erroring. Every other query in that file already filters explicitly; the anchor is the lone exception.
Task 4: Ruling P3-C12: the Minor "test titles overstate their assertions" is promoted into the fix round — "update rejects a stale version without applying the patch" never checks the patch was not applied, and "replaceAll discards the previous set for that user only" never creates a second user. Both are brief-inherited, but a test that asserts less than its name claims is the failure mode this phase has already hit twice, and both are cheap — cost if wrong: two short assertions.
Task 4: minor (deferred): localeCompare tie-breaks are locale-sensitive and not provably identical to Postgres collation (very unlikely to diverge for lowercase-hex UUIDs); randomId() is a one-line wrapper adding nothing.
Task 4: fix round 1 held until Task 5's implementer reports (both write in src/modules/expenses/infrastructure/).
Task 3: fix round 1/5 (4 addressed, 0 open — all four cadences tested with gaps verified against the band literals and confirmed not to straddle a neighbouring band; lastSeenAt/nextExpectedAt asserted with values derivable from the fixtures rather than back-filled from output; grouping key now folds in sign and currency, with both regression tests confirmed to produce a specific wrong result pre-fix; commits c6b9abf..fb6c686)
Task 3: complete (commits 6470dc3..fb6c686, review clean)
Task 3: NOTE FOR THE WHOLE-BRANCH REVIEW — an undocumented behaviour change rode along with the fix: parsing moved earlier so the failure unit changed from "one unparseable amount voids the whole payee group" to "one unparseable or zero amount is dropped, the rest still evaluated". Arguably more correct, but untested either side and never stated. Also: the grouping key is built by unescaped string concatenation, so a payee ending in something like "... eur -" could in principle collide with another (payee, currency, sign) triple.
Task 5: implemented (commit debcde0), under review. Fixed the carried cursor-anchor userId omission, and independently found a second instance of the same class in the brief's own test fixture (an RLS-protected accounts row seeded on the bare connection, fixed with withSystemContext). That is the third RLS-blind construct this phase. Note for the reviewer: Task 5's implementer reports "no divergence found in Task 4's fakes", but Task 4's reviewer DID find one (randomUUID vs uuidv7 changing the desc(id) tie-break order) — so that claim is not independently corroborated and the fake fix is still pending.
Task 5: review 1 — spec compliant; deps bag verified to follow the accounts module's flat shape as ruled; both disclosed fixes correct and well tested (the cursor-anchor test runs under withSystemContext with RLS bypassed, which is the right way to prove app-level filtering independent of the policy). 3 Important, 3 Minor.
Task 5: Important 1 — labelsFor has NO explicit userId predicate in either implementation, relying entirely on the RLS EXISTS policy. Not exploitable today because its only call site pre-scopes the ids, but the port signature takes a userId that neither implementation enforces, and under a system context there is nothing left checking. This is the "explicit filter AND context, not either" rule; this one query is "either".
Task 5: Important 2 — a real fake/real divergence the implementer's "no divergence" claim missed: transaction_categories and transaction_labels carry unique indexes on (user_id, name), so the Drizzle create() throws on a duplicate name while the memory create() silently makes a second row. A test written against the fake for that path would pass and then fail in production. Untested on either side.
Task 5: Ruling P3-C13 (Important 3, cursor/filter interaction): the FAKE changes to match the REAL, not the other way round. The Drizzle implementation anchors on the row's (occurredAt, id) tuple regardless of the other filters, while the fake computes position within the already-filtered array; they agree for the normal calling pattern and diverge when filters change between pages. Keyset pagination anchoring on the sort key is the standard and the cheap-in-SQL behaviour, so the real implementation is the source of truth and the fake must mirror it, with a test pinning it and a note that changing filters invalidates a cursor — cost if wrong: a caller that changes filters mid-pagination gets a page boundary computed from a row the new filters exclude, which is why it must be documented.
Task 5: minor (deferred): asc(name) relies on Postgres collation while the fakes use localeCompare (accepted convention elsewhere in the codebase); the three brief-carried itests inline the same object literal three times where a helper now exists; no dedicated test for a cursor naming a deleted transaction (same code path as the cross-user case, already covered).
Task 5: fix round 1 held until Task 6's implementer reports.
Task 4: fix round 1/5 (2 addressed, 0 open — monotonicId is zero-padded fixed-width so it is lexicographically monotonic under plain string comparison as well as localeCompare, verified by hand-computation including the hex-digit boundary; both under-asserting tests now check what their titles claim; commits debcde0..f59621e)
Task 4: complete (commits 76858c4..f59621e, review clean)
CLEANUP WAVE addition: the tie-break test uses only two same-occurredAt rows, so a regression to a random id generator would still pass it about half the time. Strengthen it to five or six rows, where a random comparator would pass with probability 1/120 rather than 1/2.
Task 6: implemented (commit 901c758, DONE_WITH_CONCERNS), under review. Two concerns raised, both real: (1) recordType/recordState are optional, so a wrong field name yields undefined rather than a parse error — the silent failure the task was explicitly told to avoid; (2) no pagination handling on either endpoint, so if Wallet paginates /records we would import page one and present it as the complete set.
Task 6: Ruling P3-C14 (pending the review's input, to be folded into the fix round): a wholly-optional field cannot distinguish "absent for this record" from "we guessed the field name wrong". The fix is not to force the field required — it may legitimately be absent on some records — but to assert at the adapter boundary that a NON-EMPTY page contains at least one record carrying it. An entire page where every record lacks the field is near-certain evidence of a wrong guess and must error loudly rather than importing everything as an unknown type.
Task 6: Ruling P3-C15: silently importing only the first page would present an incomplete import as complete, which is the "never invent financial data" constraint in a different dress. If the client does not paginate, it must at minimum detect a full page and fail with a clear error rather than truncating quietly.
Task 6: review 1 — spec compliant, byte-for-byte match of the brief with no scope creep; token-leak paths all traced to dead ends (HttpError and UpstreamError capture only response data, no request/header field exists on either class); postRecords confirmed to have zero call sites, matching the analyse-only default; the new tests genuinely exercise the real Zod parse because globalThis.fetch is replaced and httpRequest calls fetch directly, so the same-module mock hazard from Phase 2 does not apply here. 2 Important, 2 Minor.
Task 6: the reviewer ENDORSED both controller rulings (P3-C14, P3-C15) and sharpened where they belong: in the client, not the future adapter — the parsed data already exists at that point, this file already enforces post-fetch invariants (reduceBalances throws on missing or wrong-currency accounts), and the adapter would have to re-derive "was this the whole page" context it does not otherwise need. It also argued the runbook alone is insufficient because a manual step catches the problem only the first time a human is watching, not on every subsequent sync. Both rulings stand and enter Task 6's fix round.
Task 6: minor (deferred): the report's confident/inferred field list omits accountId, a required unverified field name (a wrong guess there fails loudly by construction, but the list must be complete for the Task 22 runbook); `.optional().default([])` on labels is redundant.
Task 6: fix round 1 held until Task 5's implementer reports.
Task 5: fix round 1 dispatched -> commit d87e76a. Scoped re-review dispatched (base 901c758).
Task 5: Ruling P3-C16 (a real pre-existing bug the implementer found and correctly did not fix in place): DrizzleGroupsRepository.create/rename in the ACCOUNTS module (Phase 1 code) catches a unique-constraint violation inside an open transaction. In Postgres that leaves the transaction aborted, so every later statement in the same request fails — a user renaming a group to a name already in use would break the rest of that request. Untested. It is out of Phase 3's scope, but "it predates this phase" is a poor reason to leave a known transaction-abort bug in shipping code when the fix is now established in this codebase (Task 5 wrapped its own insert in a savepoint). Assigned to the phase CLEANUP WAVE with the savepoint pattern — cost if wrong: a Phase 1 module gains a fix in a Phase 3 commit, which the commit message will explain.
CLEANUP WAVE addition: DrizzleGroupsRepository.create/rename savepoint fix + a test that renames to a duplicate name and then issues another statement in the same transaction.
Task 5: fix round 1/5 (3 addressed, 0 open; commits 901c758..d87e76a). Both surfaces now return the identical "duplicate_name" literal on collision rather than one throwing and one succeeding, so callers observe one contract. labelsFor gained the explicit predicate in both implementations, with the new test run under withSystemContext (RLS bypassed) so it proves the app-level filter. The fake now anchors on the (occurredAt, id) tuple like the real one, and the re-reviewer traced by hand that the old findIndex code would have returned both filtered rows where the fixed code returns one — so the test genuinely fails on revert.
Task 5: the savepoint question answered properly — the re-reviewer read drizzle's node-postgres session source and confirmed that calling .transaction() on an already-open transaction issues SAVEPOINT and ROLLBACK TO SAVEPOINT on error, clearing Postgres's aborted-transaction state. The tests prove it non-vacuously by calling list() after the caught collision inside the same transaction, which would itself throw if the transaction were aborted.
Task 5: complete (commits fb6c686..d87e76a, review clean)
CLEANUP WAVE addition: isUniqueViolation is now duplicated verbatim in three files (drizzle-categories, drizzle-labels, and the pre-existing drizzle-groups) — extract it once.
Task 6: fix round 1/5 (4 addressed, 0 open; commits d87e76a..e60691a). assertFieldSeenSomewhere throws a non-retryable UpstreamError naming the field only when a NON-EMPTY page has zero records carrying it, leaving the fields optional; assertPageNotTruncated throws when count equals the limit, and guard and query string read the same constants so they cannot drift. Both guards early-return on an empty page, so a legitimately quiet day is not an error. All four failing-case tests assert the error type, a message substring and retryable === false rather than merely that something threw. Neither error detail touches the token or the response body, and both pass through translate() unchanged.
Task 6: complete (commits f59621e..e60691a, review clean)
Task 7: dispatched (base e60691a) — Wallet transactions adapter + reconciliation use case.
Task 7: review 1 — approved with 2 Important. All three brief-bug fixes independently verified correct: the create() union really does not compile as the brief wrote it and the implementer re-reads via findByName rather than casting; the transfer-pairing canonical key is correct in BOTH directions (the reviewer worked the sort through for each leg), and Wallet's transferCounterRecordId genuinely never matches when passed through raw, so without this fix transfers would not pair and spending would be double-counted; the missing labels fixtures are a real Zod output-type consequence of .default(). Wallet vocabulary confined to the adapter, no client guard swallowed, nothing deleted.
Task 7: Ruling P3-C17 (idempotence proof): fix. The implementation IS idempotent — the reviewer traced the two no-op guards — but the committed test only asserts no duplicate rows, not transactionsUpdated === 0, version or updatedAt. The cursor deliberately re-fetches an overlapping window every run, so idempotence is load-bearing and an over-eager patch bumping version on every sync would pass this test undetected. Plan-mandated, but the plan does not grade its own work.
Task 7: Ruling P3-C18 (duplicate external id inside one batch): fix, and do not let "the accounts module does the same" settle it. transactionLinks is a snapshot Map fetched before the loop and never updated within the run, so two records sharing an externalId both take the create branch: two local transactions, spending counted twice, and the first link orphaned when the second upsertSeen overwrites it. Accounts tolerate this shape because a balance snapshot is idempotent by nature; transactions are additive, so the duplicate directly overstates spend — cost if wrong: the fix is to update the map as records are processed, which is contained.
Task 7: minor (deferred): a category removed upstream silently nulls categoryId on the next patch touching that transaction, with no signal; the categoryKind/transactionType/transactionState fallback heuristics are brief-copied guesses with the same unverified-shape caveat as recordType/recordState.
Task 7: the reviewer's ⚠️ (does the job wiring call fetch outside a transaction and pass the prefetched source inside one) is Task 8's responsibility and Task 8's dispatch instructs exactly that — carry it to Task 8's review to confirm.
Task 7: fix round 1 held until Task 8's implementer reports.
Task 8: implemented (commit e9befb9). Its agent was terminated by the sonnet session limit AFTER committing, during its own self-review — so the self-review did not happen, but the independent review replaces it. Controller verified the tree directly: typecheck clean, 761 unit / 75 files, 66 itest / 22 files, working tree clean.
Ruling P3-C19: both opus and sonnet have now hit session limits during this run (opus twice, sonnet once). Dispatches move to whichever tier is not currently throttled rather than stalling the loop; the per-task review gate is unchanged regardless of tier — cost if wrong: some tasks are implemented or reviewed a tier away from the ideal choice.
Task 8: review 1 (opus) — approved. All four load-bearing properties verified against engine and adapter source, not the report: the two-phase split is TYPE-enforced (SyncFetchContext has no db field, SyncApplyContext no credentials), the cursor cannot advance on failure (proved by the pre-existing run-sync.test.ts:145-171, which sets a cursor then throws and asserts the old value persists), no context is nested, and no client guard is caught anywhere in fetch or apply. The carried wiring question is settled: walletTransactionsSource is called only inside fetch and prefetchedWalletTransactionsSource only inside apply, with no second wiring site in the repo. 2 Important, 5 Minor.
Task 8: Ruling P3-C20 (Important 1 — PHASE-LEVEL GAP, not a Task 8 defect): the transactions sync has no automated trigger and its cursor is inert for the already-connected production user. sync_jobs rows are created only at connect time, so an existing Wallet connection has an accounts job row and no transactions one; with no row, prepare sets jobId: null and run-sync.ts guards the cursor write on prepared.jobId, so setCursor is silently discarded and every run re-fetches the provider default window. No dispatcher enumerates sync_jobs by schedule, wallet-accounts-sync.ts pins kind: "accounts", and the Wallet webhook emits only accounts. As it stands the phase would ship a sync nothing starts. This is assigned to TASK 12, which already wires the transactions sync: it must ensure a transactions sync_jobs row exists for connections that predate this phase, and give the sync a real trigger — cost if wrong: Expenses would populate only via a hand-made API call, failing the phase's own exit criterion.
Task 8: Ruling P3-C21 (Important 2): fix. The handler's cursor behaviour has zero coverage — the test passes cursor: null and a no-op setCursor, and the mocked getRecords ignores its arguments. The reviewer verified the lookback arithmetic by hand (correct across month and year boundaries, pure UTC on a civil date so no DST hazard), but a sign flip turning minus seven days into plus seven would skip a week of records on every run and leave all 761 tests green. That is precisely this phase's worst failure mode.
Task 8: minor -> folded into the same fix round: the handler doc comment claims the overlap recovers a record whose updatedAt moved, but the client filters on recordDate, so it recovers late edits only for recently DATED records — an old record edited today is still missed, and the comment justifies a design choice it overstates. Also: first-run behaviour needs a written decision — with no cursor the client omits the filter and the API defaults to about three months, then the cursor jumps to today, so anything older is never imported by any later run. That may be intended, but nothing says so and the operator needs to know.
Task 8: minor (deferred): ctx.cursor is an unchecked cast that would throw RangeError on a malformed shape (fails loudly, loses nothing, but the message would not name the problem); __expenseFixture is a dead exported fixture (brief-mandated); accountDeps(ctx.db).links builds three repositories to use one (brief-mandated).
Task 8: fix round 1 held until Task 9's implementer reports.
Task 7: fix round 1/5 (2 addressed, 0 open; commits e9befb9..81a72e8). The idempotence assertions are non-circular — version/updatedAt are captured from a fresh read after run one and compared to a fresh read after run two, not to values run two returned — and both are load-bearing against the two no-op guards, so removing either would fail the test. The duplicate-externalId fix updates the in-run map after each record, and the test proves the second occurrence takes the UPDATE branch and its data wins rather than being skipped, with no orphaned link.
Task 7: complete (commits 503de63..81a72e8, review clean)
CLEANUP WAVE addition: the category-mirroring loop (categoryLinks, sync-provider-transactions.ts:53-99) still has the pre-fix snapshot-map shape and the analogous duplicate-externalId exposure. Less harmful than the transaction case — a duplicate category rather than duplicated spend — but the same defect one loop over, and the fix pattern is now established.
Task 9: complete (commits 81a72e8..e950966, review clean — 0 Critical, 0 Important, 2 Minor, both plan-mandated). All four binding properties verified against both the diff and the accounts module's established pattern: assertPermission is the first line of every use case, every repository call passes principal.userId and the repositories filter on it internally, not-found and version-mismatch stay distinct typed errors with no retry loop, and the audit fires only after both checks pass so a failed update leaves no misleading trail. The fixture-bug diagnosis was verified legitimate — testPrincipal()'s default userId is a UUID, not "u1" — and the fix touches only test data, relaxing no production assertion.
Task 9: another user's transaction collapses to NotFoundError, indistinguishable from a nonexistent id — the correct non-leaking 404 shape, matching getAccountDetail, and distinct from the empty-list case that would mean "you have none".
Task 9: CARRY INTO TASK 10's REVIEW — the reviewer could not verify from its own diff that route handlers open withUserContext before constructing expenseDeps(tx). The use cases deliberately do not open a context themselves (flat deps-bag pattern), so Task 10 is where that must be true.
Task 9: minor (deferred): no happy-path test asserting getTransaction attaches category and labelIds for the caller's own row (the brief specified exactly one test here); updateTransaction audits `after: input`, the raw patch, rather than the before/after domain snapshot updateAccount uses.
Task 8: fix round 1/5 (3 addressed, 0 open; commits e950966..6e12e76). The sign-flip question answered by tracing the real call path: getRecords is a vi.fn so Vitest records actual arguments, and a flipped sign would send 2026-09-11 where the test asserts 2026-08-28 — the implementer also verified this empirically by flipping the sign, watching the new test fail, and reverting. Not circular: the mock's return does not depend on sinceDate, so the assertion checks a value the real lookback produced. First-run (cursor null) and subsequent-run (stored cursor) paths are exercised as distinct tests. The production hunk is comment-only.
Task 8: complete (commits 503de63..6e12e76, review clean)
Task 10: review 1 — approved; all five required properties verified by reading. Every one of the five handlers builds expenseDeps only inside withUserContext, with deps.db never passed directly — the bug class Task 9's reviewer carried forward does not recur. CSRF proven by an itest asserting 403 csrf_required by content, not just status. Routes carry no permission checks; the use cases assert. ErrorResponseSchema imported from accounts, one component in the generated document, no collision. The seedUser fix verified correct and non-weakening: accounts really does carry FORCE RLS with a WITH CHECK policy reading app.user_id, and withUserContext sets exactly that, so the helper creates a legitimately owned row through the same mechanism production writes use.
Task 10: Ruling P3-C22: the plan-mandated DTO widening is FIXED, not accepted. The reviewer enumerated what actually reaches the wire across three response shapes — Transaction leaks userId and syncRunId; TransactionCategory leaks userId, parentId, createdAt, updatedAt; TransactionLabel leaks userId, createdAt, updatedAt through a raw pass-through with no DTO at all. The implementer disclosed only the category case. "Nothing validates outgoing responses" explains why this is invisible, not why it is harmless: the published OpenAPI contract describes a narrower shape than the API returns, and syncRunId and parentId are internal foreign keys, not product data. userId matching the caller today is an accident of every response being single-user scoped, not a documented guarantee. Fix by constructing explicit DTOs that pick the declared fields — cost if wrong: three small mapping functions where a spread used to be.
Task 10: minor (deferred): the TransactionCategory OpenAPI component is itself marked nullable because zod-openapi bakes .nullable() into the shared named component, so every $ref inherits it including the list items where a category is never null (errs permissive); the PATCH handler opens two sequential user contexts so the response-assembly read is not atomic with the write (brief's own pattern).
Task 10: fix round 1 held until Task 11's implementer reports.
Task 11: review 1 — spec compliant; the two properties this phase weighs most heavily both hold. runForPrincipal opens withUserContext exactly once and is the SOLE construction site of expenseDeps against a live tx, so the RLS-blind pattern does not recur. No fabricated financial data anywhere: the reviewer tabulated every displayed value and its absent-source behaviour — payee null renders an em dash, category null renders "Uncategorized", and the zero-rows case says "the next sync will fill this in" rather than showing a zero. The two setup states are genuinely distinct in copy, component and intent. 2 Important (both plan-mandated), 3 Minor.
Task 11: Ruling P3-C23 (silent truncation): fix. page.tsx calls the loader with limit 50 and renders page.rows, but page.nextCursor — which the loader computes and returns precisely so callers can act on it — is never read. A user with more than 50 transactions sees the first 50 with no count, no "load more", no notice. The brief's own snippet has the gap, but this is the third instance of "incomplete presented as complete" in this phase and the first one a person would actually see.
Task 11: Ruling P3-C24 (swallowed errors): fix. `getTransaction(...).catch(() => null)` converts EVERY error into notFound(), so a database failure or a bug in the use case renders as a plain 404 with the real cause erased. Narrow it to NotFoundError — already imported in this task's own actions file — and rethrow the rest.
Task 11: Ruling P3-C25 (resolves the reviewer's ⚠️): the edit form's category select uses defaultValue={row.categoryId ?? ""}, so if listCategories excludes an archived-but-still-referenced category there is no matching option and the browser silently selects a different one — visually misrepresenting the transaction's category, and a save would then write that wrong category. Fix inside the form rather than relying on listCategories' filtering: if the row's current categoryId is not among the options, render it as an explicit current option instead of letting the browser choose.
Task 11: minor (deferred): the session is resolved twice per request (page gate plus runForPrincipal); generateMetadata re-runs the whole detail load, doubling the transaction and use-case round trips; TransactionRow carries currency, state and labelIds that this task's UI never renders.
Task 10: fix round 1/5 (1 addressed, 0 open; commits bcaa479..6b541ae). All three DTOs pick exactly the declared field sets (16 / 7 / 4), independently recomputed from the domain types and cross-checked against the generated OpenAPI components. All eight call sites converted — three transaction, four category (three nested plus the standalone list), and the label pass-through — with a grep confirming the only remaining spreads are unrelated route metadata. The new test asserts the EXACT sorted key set rather than a subset, so a reintroduced spread would fail it. openapi.json correctly unchanged: the documented contract was already the narrower shape, only the runtime body needed narrowing.
Task 10: complete (commits 6e12e76..6b541ae, review clean)
CLEANUP WAVE addition: the exact-key test covers the list, categories and labels endpoints but not GET /transactions/{id} or PATCH /transactions/{id} directly — those rest on sharing the same DTO functions. Not a leak, just a narrower regression net.
Task 11: fix round 1/5 (3 addressed, 0 open; commits 6b541ae..85d1f91). "Load more" genuinely fetches the next page rather than merely announcing one, and the reviewer verified end-to-end that the query schema accepts what the client sends and that keyset pagination excludes the anchor row, so no duplicates. The detail catch is narrowed by TYPE (instanceof NotFoundError), not by message string, and the page component adds no further catch so a rethrow reaches the error boundary. The archived-category fallback option carries the real category name — traced: categories.get does not filter archivedAt — so an untouched Save resubmits the same id and writes it unchanged.
Task 11: complete (commits baa189d..85d1f91, review clean)
Task 11: Ruling P3-C26: the re-reviewer rejected the implementer's justification for leaving the rethrow untested, and I accept that. loadTransactionDetail is not a page or client component — it is a plain loader in the same file as loadTransactionsPage, which IS unit-tested, with the deps and principal seams already in place; overriding transactions.get to throw a plain Error and asserting the call rejects rather than resolving to null was about ten lines. The behaviour was verified correct by inspection, so this is a coverage gap rather than an open finding, and it goes to the CLEANUP WAVE rather than costing another fix round — cost if wrong: the substance of a finding I raised ships without a direct test until the cleanup wave.
CLEANUP WAVE additions: (a) the ~10-line test proving loadTransactionDetail rethrows a non-NotFoundError; (b) generateMetadata in the transaction detail page still does .catch(() => null), re-swallowing exactly the error class Important 2 fixed — it only affects the title tag and the page body still throws correctly, but it is the same defect one function over.
Task 12: implemented (commit d120975), under review. Carried gap reported closed: a new hourly job ensure()s the transactions sync_jobs row before syncing, with an itest seeding a connection that has no job row and showing the second run derives its window from the first run's persisted cursor. Residual disclosed: the manual Sync trigger does not call ensure(), so clicking it before the first cron tick would still hit the null-jobId cursor discard — flagged to the reviewer as the same defect on the path a human actually uses.
Task 13: implemented (commit dac8ba9), under review. Disclosed: the (rule_id, accrual_date) unique constraint and the accruals EXISTS-based RLS policy are NOT runtime-proven — the brief's test covers only interest_rules and interest_entries — and rest on analogy with the account_balances pattern. db:generate reports no pending changes, so the journal and snapshot are consistent.
Task 12: review 1 — approved. The carried gap is genuinely closed: ensure() reuses the same idempotent ON CONFLICT DO NOTHING path connectIntegration uses so it reaches a pre-existing connection, the trigger is the existing hourly tier and cron dispatch with no new scheduling invented, and the itest is NON-CIRCULAR — it creates the connection directly to bypass connect-time ensure(), asserts no job row exists first, then reads the actual persisted cursor back from the database and derives the second run's expected window from that. The implementer also caught a real Hono route-ordering bug via the itest rather than by inspection, and avoided a userId leak the brief's own snippet would have introduced by mapping DTO fields explicitly instead of spreading.
Task 12: the reviewer CORRECTED the implementer's framing of its own residual, which is worth recording: the Settings "Sync now" button never sends a kind, so runSync defaults to the provider's first sync, which is accounts — the UI cannot trigger the bug. But POST /api/v1/integrations/{provider}/sync with an explicit {"kind":"transactions"} body is live, documented and reachable today by any caller with integrations.manage, and hits the same prepared.jobId null guard. Important, not Critical, because likelihood is far lower than claimed.
Task 12: Ruling P3-C27: fix it in prepare() rather than at the two manual call sites. Patching the callers closes today's two paths and leaves the next one to rediscover the same defect; ensuring the job row for the resolved kind inside prepare() closes every current and future path at once. Task 8's run-sync tests mock deps.jobs.find and will need updating to match — cost if wrong: prepare() gains a write on a path that previously only read, which the tests must cover.
Task 12: also fix the stale OpenAPI description on syncRoute — it still says kind "defaults to the provider's only sync", but Wallet has had two kinds since this phase, so a bare call silently targets accounts.
Task 12: minor (deferred): the itest hand-duplicates the lookback formula rather than importing it — deliberate, to keep the assertion independent of the source it checks, but it can drift.
Task 13: review 1 — spec compliant; schema, migration SQL and RLS block match the brief column-for-column, verified against the generated SQL rather than trusted. The 0012 prevId was checked directly against 0011's snapshot id, and db:migrate and testDb were confirmed to call the identical drizzle migrator, so the report's "same code path" claim holds. The precision split is deliberate and correct: gross/tax/carryAfter at numeric(16,6) and only net at currency precision — the reviewer worked the arithmetic (10 EUR at 1% annual is about 0.000274/day, which rounds to zero at 2dp) and confirmed this is what avoids the zero-accrual failure mode. The RLS test that exists is a genuine two-user isolation proof, asserting length both ways plus system-sees-all and no-context-sees-none. 2 Important, 1 Minor.
Task 13: Ruling P3-C28: both unproven properties must be proven here, not deferred. The (rule_id, accrual_date) unique index is the single mechanism standing between a daily job re-run and double-posting real money to a real account, and it is currently asserted by reading generated SQL. The reviewer costed the proof at about four lines with testDb, withSystemContext and resetDb already imported in the very file that needs them. Same for interest_accruals_owner, whose EXISTS policy is verified only by textual analogy to account_balances_owner — the analogy is exact, but a copy-paste column-name error would not surface until Task 14 or later. This phase has already produced one real defect from a property assumed by analogy rather than tested — cost if wrong: eight lines of test.
Task 13: minor (deferred, worth carrying to a future multi-currency phase): neither interest_accruals nor interest_entries carries a currency column beside its money columns. The reviewer checked precedent and found this consistent — account_balances, the closer analog, also omits it — so it is not drift, but it is the shape of gap that becomes expensive once accounts can differ in currency.
Task 13: fix round 1 held until Task 12's implementer reports.
Task 12: fix round 1/5 (2 addressed, 0 open; commits dac8ba9..f2a977f). Fixed at the root: prepare() now calls jobs.ensure instead of jobs.find, so the REST route, the server action and the drained queue path are all covered from one place. All five of the controller's questions about moving a write into prepare() answered concretely — the transaction boundary is unchanged because prepare() already ran inside inUserContext and only the read was swapped; handler.fetch remains entirely outside it, so the two-phase contract holds; resolve() throws SyncNotSupportedError BEFORE prepare() runs, so ensure() can never create a row for a kind the provider does not implement; the row shape matches connect-time ensure() exactly, hitting the same ON CONFLICT DO NOTHING path, so a pre-existing disabled row is never re-enabled; and Task 8's mocks were re-targeted to stub ensure with the same conditional fallback rather than loosened, still asserting the same failure behaviour.
Task 12: complete (commits 85d1f91..f2a977f, review clean)
Task 13: fix round 1/5 (2 addressed, 0 open; commits f2a977f..18f907e). The unique-constraint test asserts on the literal constraint name in err.cause.message, following the pattern already used elsewhere in this codebase for this drizzle version, so a not-null, foreign-key or RLS failure would NOT satisfy it; and the first insert is unguarded, so an invalid fixture fails there rather than passing vacuously. The fixture supplies every non-nullable column honestly and omits only the genuinely nullable postedAt/entryId, which is what an unposted accrual actually looks like. The RLS test inserts under system context and reads back under two real user contexts with both a positive (exactly 1) and negative (exactly 0) assertion, ruling out both a fully-closed and a fully-open policy.
Task 13: complete (commits d120975..18f907e, review clean)
Task 14: dispatched (base 18f907e) — the accrual arithmetic ported from the legacy interest.py. Instructed to read the legacy implementation before writing, to declare every deliberate divergence with its reason, and to finish with a pass asking only where the code could produce a wrong number rather than an absent one.
Task 14: review 1 (opus) — APPROVED, and the most rigorous review of this run. The reviewer read the real legacy interest.py (found at /home/mattia/docker/projects/Wallet Manager/app/interest.py, lines 192-200 and the selftest at 261-274) and money.ts in full, then independently re-derived SIX cases from first principles — including both half-cent ties and the legacy selftest values — and every one matched the assertion. Day-count divisor, the single rounding point, tax-applied-before-carry, and clamp-then-subtract carry semantics all match the legacy exactly. Every divergence was declared; no silent one exists. It also PROVED (not merely checked) that the brief's rounding helper and toCents are observationally identical on every input, because the clamp forces both to zero on negatives and truncation equals floor on positives — so the implementer's deviation was correct and behaviour-neutral. The precision bound was verified real and non-compounding: the carry is only ever ADDED, never multiplied by the rate, so there is no feedback path and errors accumulate linearly, not geometrically. 5 Important, 7 Minor.
Task 14: Ruling P3-C29: fix all five Important findings. This is the money kernel and every one of them is a place the code produces a wrong or over-confident number rather than an absent one.
  (1) parseDecimal("") returns 0n, so an absent balance yields net "0.00" — an affirmative claim that nothing accrued, which is exactly constraint 4's failure mode, and asymmetric with reconciliation.ts where the implementer DID throw on an unparseable amount. Validate balance/annualRate/taxRate strictly; keep the empty-string leniency for carry alone, where "no prior carry" genuinely is zero.
  (2) parseDecimal("1.2.3") silently returns 1.2 — the destructure drops the third segment. Every other malformed input throws via BigInt, so this is the one shape producing a wrong number instead of an absent one, in the money kernel, for the cost of one regex.
  (3) No conservation invariant test. All 17 tests are point assertions on hand-picked inputs; net + carryAfter == netRaw + priorCarry is never asserted. That is the test that generalises — it would catch a carry-threading regression, a sign error in the clamp or a changed rounding direction on inputs nobody hand-picked. Highest-value missing test on the phase's most consequential file.
  (4) A negative annualRate or a taxRate above 1 makes totalRaw negative, net floors to zero, and the negative remainder rolls forward FOREVER, silently consuming later positive periods. The legacy does the same so it is not a divergence, but numeric(10,6) does not prevent a negative rate and nothing says this is intended. Pin it with a test and a comment, or reject out-of-range inputs.
  (5) reconcileInterest([], [], period) returns "matched" — an affirmative claim that the books agree, made from zero evidence, where "the accrual job never ran" and "nothing was owed" are different facts. The ReconciliationStatus union has no member able to express it, so this is a PLAN defect and the implementer picked the only available status. Widen the union so the domain can say "cannot compute", since Tasks 17, 20 and 21 all consume this.
Task 14: also fold in two Minors that prevent wrong values rather than polish: document toCents' magnitude ceiling where the whole-currency part passes through a double, and document or normalise projectInterest's UTC precondition — a local-midnight Date in a positive-offset zone shifts every label a day earlier, which is a wrong date, not an absent one.
Task 14: minor (deferred): the leap-day test asserts calendar labels rather than the financial consequence (a fixed /365 divisor accrues 366 daily amounts in a leap year, about 100.27% of nominal — deliberate and inherited, but asserted nowhere); dayCount is a TypeScript-only guarantee; non-integer days over-runs by one; gross/tax are truncated by the same lossy formatter as carry but only the carry truncation was disclosed; the report's derivation cites the wrong third decimal digit for one case (right answer, wrong reason).
Task 14: fix round 1 held until Task 16's implementer reports.
Task 15: review 1 — APPROVED. The double-posting property is correct and genuinely proven: the fake's upsert overwrites only balanceBasis/gross/tax/net/carryAfter and preserves id, ruleId, accrualDate, source, postedAt and entryId — a field-for-field match to Task 16's brief, including the subtle shared omission of `source` — and the test marks the accrual posted BEFORE re-upserting with changed amounts, so it proves the property rather than a no-op. Every other method was cross-checked against Task 16's brief and matches. The id generator correctly follows this phase's monotonic precedent rather than the brief's stale randomUUID sample. 1 Important, 1 Minor.
Task 15: Ruling P3-C30: fix both test gaps. (a) listForRule has no ordering assertion, and the phase's own global constraints name interest entries among the repository pairs requiring an explicit "same order as Drizzle" assertion — the implementation is correct, but the constraint is binding regardless of the brief's sample omitting it, and this divergence class has bitten the codebase twice. (b) The listActiveForAllUsers test asserts only toHaveLength(1), so a reversed date comparison would still yield one row — the wrong one — and pass. Assert WHICH rule survives. Both are brief-inherited and both are cheap.
Task 15: fix round 1 queued behind Task 14's, both held until Task 16's implementer reports (one writer at a time).
Task 16: review 1 — APPROVED. The double-posting property has exact field-level parity with the fake (both set only balanceBasis/gross/tax/net/carryAfter and both carry the same ruling citation in a comment) and is proven against real Postgres by a test that marks posted, re-upserts with different amounts, asserts the same entryId and postedAt survive, and then RE-READS through forRule rather than trusting the upsert return value. Every other method matches its fake counterpart. No divergence found anywhere in the pair.
Task 16: the missing-userId question was answered by tracing, not asserted: interestDeps has no callers anywhere yet, so no path can reach these repositories on a pool-bound client; a cross-owner ruleId under a user context returns empty for reads and is REJECTED by the WITH CHECK clause for upsert; under system context it is readable by design, which the cross-user daily accrual job requires; and with no context at all the tables fail CLOSED (proven by the pre-existing schema-level itest), so an unscoped call looks like "no data" and can never leak across tenants. Widening the port would ripple into Task 15's merged port, its fake and every consumer, which is the ripple the one-task-per-signature-change rule exists to prevent. Accepted.
Task 16: Ruling P3-C31 — the follow-up the reviewer surfaced matters more than the task: markPosted silently no-ops when the id does not match (wrong owner, or simply a typo), inherited from Task 15's port, and neither implementation reports it. If the posting adapter believes it marked an accrual that in fact stayed unposted, the next run posts the same interest AGAIN — the double-posting path one step over from the one this phase has been guarding. This is assigned to TASK 19, the posting adapter, which both depends on it and can verify it end to end: markPosted must report whether it actually affected a row, and the adapter must treat "affected nothing" as a failure rather than success — cost if wrong: a port signature widens by a return value, touching the fake and the Drizzle side together in the task that consumes them.
Task 16: minor -> CLEANUP WAVE: no repository-level cross-user RLS test for interest entries, where accruals and rules each have one — schema-level coverage exists, so the residual risk is low, but it leaves a two-of-three asymmetry.
Task 14: fix round 1 dispatched -> commit f3969b1. On Important 4 the implementer chose to REJECT rather than pin: dailyInterest now throws on a negative annualRate or a taxRate outside [0,1], instead of documenting the silent negative-carry-forever behaviour. That is the stricter and better choice.
CARRY INTO TASKS 17-21 (raised by the Task 14 implementer): reconcileInterest now has a "no data" status member, so every caller needs a branch for it — a period with no accrual rows must not render as "matched"; and dailyInterest now throws on an out-of-range rate or tax, so callers reading rule parameters from the database must handle that rather than assuming a number comes back.
Task 14: fix round 1/5 (5 addressed, 0 open; commits 83a20c9..f3969b1). THE ARITHMETIC DID NOT CHANGE — the re-reviewer confirmed the computation path is byte-identical and the fix only added parsing and validation ahead of it, with all five pre-existing arithmetic expectations untouched; the only changed expectations are the two reconcileInterest statuses, which is the requested behaviour change. The rejection's boundaries are all correct: zero rate, zero tax, tax of exactly 1, zero balance and NEGATIVE balance (an overdraft, which must not throw) are all accepted, and only a negative rate or an out-of-range tax throws. The conservation invariant is genuinely non-trivial — a non-zero prior carry on the single-day check and a real 365-day threading loop whose measured discrepancy is non-zero and well inside the asserted bound, so the tolerance is not vacuous. The no_data boundary is right: accruals that exist but sum to zero remain "matched", proven by its own test.
Task 14: complete (commits 18f907e..f3969b1, review clean)
Task 15: fix round 1/5 (2 addressed, 0 open; commits f3969b1..5d38754). The listForRule fixture is inserted in an order that is neither ascending nor descending (third, first, second), so it discriminates all three plausible bugs — no sort, reversed sort, correct sort — independently of the implementer's own mutation run. The listActiveForAllUsers assertion now identifies the survivor by id, a value unique to that row.
Task 15: NOTE ON REPORT ACCURACY — the re-reviewer re-derived the mutation the implementer claimed to have run and found the narrative wrong: swapping >= for <= would return BOTH rows, not one wrong row, because the effectiveTo === null short-circuit is untouched. The test still catches that mutation, via a length mismatch rather than the wrong identity the report described. The code is correct and the finding is satisfied; the self-reported evidence was imprecise. Worth remembering that a report citing specific mutation output is itself a claim to check.
Task 15: complete (commits 33923af..5d38754, review clean)
Task 17: review 1 — spec compliant; both contract changes handled soundly (reject-at-write-boundary with regex and refine matching dailyInterest's own throw conditions exactly, legitimate edges like rate "0" and tax "1" proven accepted; the throw left uncaught at the read boundary so a pre-existing bad row surfaces as a real error rather than a false "not accrued"). The self-found entries-scoping bug was verified real: the port has no date-range parameter and reconciliation.ts explicitly documents that the CALLER must scope both lists, which the brief's own sample violated — an out-of-period paid entry would have flipped "missing" into a false "matched", and the fix is test-proven. Idempotence proven in the STRONG form: the test marks the accrual posted, re-runs, and asserts the same id with postedAt and entryId unchanged. 1 Important, 2 Minor.
Task 17: Ruling P3-C32: fix the projection's missing compounding guard. runInterestAccrual gates on rule.compounding !== "simple_daily" and skips — its own comment says it produces no accrual for those — but getInterestRuleDetail's projection guard checks only the balance and dayCount, never compounding. Since createInterestRuleSchema accepts "monthly" and "none", a caller can create such a rule and receive a confident multi-day projection of currency amounts computed with the simple-daily formula: a forecast of interest the job has promised never to post. That is a wrong number presented as a real forecast, reachable through the public input surface this same task defines, and it is the phase's sharpest constraint. Brief-inherited, but the plan does not grade its own work — cost if wrong: one condition added to a guard.
Task 17: also fold in the date-regex Minor — /^\d{4}-\d{2}-\d{2}$/ accepts "2026-13-45", so a rule can carry a calendar-invalid effective date that nothing rejects and no test covers.
Task 17: minor (deferred): RATE_RE and DATE_RE are duplicated verbatim between the create and update use cases, so a future edit to one would silently diverge the validation bounds.
Task 17: CARRY INTO TASK 20's REVIEW — the reviewer could not verify how an uncaught dailyInterest throw from a pre-existing invalid-rate row surfaces to an API caller; that depends on Task 20's error mapping. Confirm it becomes a clean 5xx rather than a hang or an unhandled rejection.
Task 17: fix round 1 held until Task 18's implementer reports.
Task 18: complete (commits 117cd6f..7e0c678, review clean — 0 Critical, 0 Important, 2 Minor). Both properties this project has repeatedly regressed on are proven against real Postgres with content-checking assertions: a second run over an already-posted day leaves postedAt and entryId exactly as markPosted wrote them, and a genuinely invalid rule inserted through the repository (bypassing use-case validation) fails alone while the other user's rule still accrues, with the run still reporting success and surfacing the failure count. Registered on the existing daily tier, no scheduler invented.
Task 18: controller RESOLVED the reviewer's ⚠️ by reading run-interest-accrual.ts directly: line 41 is `if (balance === null) return { accrued: false }` — it returns WITHOUT writing anything, so a day with no balance basis produces no accrual row rather than a fabricated zero, and the file's own comment says so. The reasoning for leaving the invalid-rate throw uncaught is also sound and documented in place: catching it would make a bad row indistinguishable from "no balance on file" or "unsupported compounding" and hide it.
Task 18: minor (deferred, CLEANUP WAVE): the job folds "no balance basis" and "lock not acquired" into the same silent non-count, so detail exposes only accrued and failed and a skipped-for-no-data day is indistinguishable from a skipped-for-contention one; and only the negative-annualRate invalid path is tested, not the out-of-range taxRate one (the catch is generic, so low risk).
Task 17: fix round 1 dispatched -> commits 280f61e (projection compounding gate + real calendar-date validation, both verified failing without the fix) and c131752 (documentation only). The addendum I sent mid-round was answered independently and agrees with my own check: run-interest-accrual.ts already returns { accrued: false } before dailyInterest or accruals.upsert are reached when the balance is null, so a day with no basis writes NO row rather than a zero one. The behaviour was correct but undocumented; the implementer strengthened the function's doc comment and the test's comment to pin it, with no logic change. NOTE: the scoped re-review is running against 7e0c678..280f61e and will not see c131752, which is comment-only.
Task 19: dispatched (base 280f61e) — the posting adapter, the only task in the phase that writes money to a real external account. Carries the markPosted signature change (port, fake and Drizzle together, with the adapter treating "affected nothing" as failure) and must walk every double-posting path including a crash between the provider call and the mark.
Task 17: fix round 1/5 (2 addressed, 0 open; commits 7e0c678..280f61e plus the comment-only c131752). The re-reviewer negated the job's skip condition and confirmed the two guards are now LOGICALLY IDENTICAL on compounding and dayCount, not merely a partial match on a different pair. Date boundaries verified analytically: 2028-02-29 accepted, 2027-02-29 rejected because Date.UTC rolls it into March. It also confirmed the update patch type carries only effectiveTo, so validating just that field is the full surface rather than a hole, and that the empty-projection fallback keeps the response shape coherent.
Task 17: complete (commits 5d38754..c131752, review clean)
CLEANUP WAVE addition: isValidDateOnly is now a third piece of logic duplicated verbatim between the create and update use cases, alongside RATE_RE and DATE_RE. All three copies are currently identical, but that is three chances for a future edit to diverge silently.
Task 19: review 1 (opus) — NEEDS FIXES. The best review of this run. The carried markPosted requirement is closed properly (port, fake, Drizzle, every call site, three tests proving the boolean is HONEST at both ends including that a mismatched call left postedAt null, plus an assertion that no success-shaped audit event is written on failure — a step past what was asked). The implementer's catch of the brief's id-mismatch was verified and is the difference between doing the task and appearing to: NewInterestAccrual omits id, the memory upsert assigns its own, so the brief's test would have passed WHILE the silent no-op defect was fully present. Token leakage traced to dead ends on every path. But two live double-post paths ship, both closable here.
Task 19: Ruling P3-C33 (CRITICAL 1): pass attempts: 1 to postRecords. It currently retries five times on 429, 409 and any 5xx with no idempotency key, and 409 on a write endpoint usually MEANS "already exists". The "inherited from Task 6" defence fails on the codebase's own evidence — wallet.ts's comment records that postRecords had zero call sites until this commit, so this task is what makes a dormant function fire at a financial API. WalletCallOptions.attempts is already plumbed, so this is one argument at one call site.
Task 19: Ruling P3-C34 (CRITICAL 2): add the provider-side pre-check. The report closes the crash window on the premise that no provider dedup exists; interest.py:167-173 — in the very script this task retires, which the report says it read — implements already_posted_today() against the live Wallet API using the same note marker this adapter already writes, and uses it as a second line of defence after its own state check. Add GET /records filtered by account, date and note marker before posting, skip if it returns anything. This closes BOTH criticals with no human in the loop, and is why I am not accepting the pending-marker-plus-reconciliation alternative the report rejected. Also stop discarding the POST response so the provider record id can land on the entry.
Task 19: Ruling P3-C35 (the "no transaction open" claim): do NOT narrow the job lock — holding it across the network call is exactly what prevents the concurrent double-post, and the codebase documents that shape as deliberate elsewhere. Fix the COMMENT instead, which currently claims something false. tryPost does correctly close its own user-context transactions before the call, and that is what it should say.
Task 19: also fix — the post-phase failure that guarantees a next-run duplicate raises no alert and still reports success; liveFor does not filter by provider, so it is one new provider away from posting money against a foreign external id; a post_to_provider rule that cannot post is silently skipped with no log and never retried, so a one-day Wallet outage loses that day permanently; the dead WALLET_PROVIDER export and the `token!` assertion that would post "Bearer undefined" and then translate the 401 into an actively misleading diagnosis; and cut-over step 2, which compares the container's LIVE balance against the dashboard's latest SYNCED SNAPSHOT and tells the operator not to proceed until they understand a discrepancy whose most likely cause it never lists.
Task 19: minor (deferred): the entry stores gross rounded to 2dp while the accrual keeps 6; getCategories is refetched per post and throws at exactly 200 categories; no unique constraint on interest_entries; no exclusion constraint stopping two overlapping post_to_provider rules on one account; no test reaches tryPost's happy path.
Task 19: fix round 1 held until Task 20's implementer reports.
Task 20: implemented (commit 0bd5ddc, DONE_WITH_CONCERNS), under review. It ANSWERED the question Task 17's reviewer carried forward: a stored rule with an invalid rate makes the domain throw, and an API caller receives a clean 500 with the internal error code, proven by an integration test — not a hang and not an unhandled rejection. It also corrected two stale literals in its own brief (the reconciliation no_data enum plus a test expectation, and an un-seeded-balance projection assertion) — the third and fourth time this phase's brief text has contradicted itself. It added an InvalidInputError to 422 mapping matching the Accounts module and noted that EXPENSES still lacks it.
CLEANUP WAVE addition: the Expenses API has no InvalidInputError -> 422 mapping, where Accounts and now Interests both do. Same phase, two halves, inconsistent error contracts.
Task 19: fix round 1 dispatched — two Criticals (postRecords' five-attempt retry on a write endpoint with no idempotency key, and the provider-side dedup the legacy script already implements) plus six Importants.
Task 20: review 1 — APPROVED. All four handlers construct interestDeps only inside withUserContext, never against the pool-bound client — and the reviewer confirmed why that matters here specifically: the accruals and entries repositories take no userId parameter at all, so the context is genuinely the only wall. DTOs are explicit field-pickers from the start with an exact-key-set test, and the reviewer enumerated every response shape against its domain type and found no leak; the two shapes that ARE spread were checked and are field-identical to their schemas, so there is nothing to leak. The regenerated openapi.json was diff-checked as purely additive. Both self-reported brief corrections independently verified correct against already-reviewed code. 1 Important, 1 Minor.
Task 20: Ruling P3-C36: add the missing 422 test. The mapping is correct by inspection, but it is reachable by a real caller — the wire schema types annualRate and taxRate as plain strings, so a taxRate of "1.5" passes OpenAPI validation and is rejected only by the use case's stricter check. That is user-facing behaviour with no coverage, in a phase whose own rubric required proof-by-test for exactly this class elsewhere — cost if wrong: one test.
Task 20: fix round 1 held until Task 19's implementer reports.
Task 20: fix round 1/5 (1 addressed, 0 open; commits 06b2123..d51ca76). The re-reviewer traced the full chain: the wire schema types taxRate as a bare string so "1.5" genuinely reaches the use case rather than being rejected earlier; the if-match header satisfies the version parser so the request is not intercepted by a 428 first; no other field in the patch is invalid, so the 422 is attributable solely to the bad rate; and removing the mapping would produce a 500 from the global handler, which the status assertion would catch immediately. Additive test-only diff.
Task 20: complete (commits a9bdcf2..d51ca76, review clean)
Task 19: fix round 1/5 — all EIGHT original findings ADDRESSED with evidence (attempts:1 scoped to the POST only with reads left at five; findPostedRecord verified to build exactly the four query params interest.py uses; the pre-check confirmed to FAIL SAFE — a 5xx, a schema mismatch or a 401 all propagate past getCategories and postRecords and become a PostFailedError, never degrading to "nothing found, post anyway"; the lock comment corrected without narrowing the lock; post-phase failures now alert per rule and are counted separately; the provider assertion added with an itest seeding a live trek link; the token assertion replaced with an explicit skip; the cut-over doc now names the balance-source difference first). BUT the fix introduced new breakage on the money path.
Task 19: NEW CRITICAL introduced by the fix — the 30-day sweep back-posts the analyze_only backlog the moment postingMode flips. shouldPost reads the CURRENT mode, so every accrual written while the rule was analyze-only carries postedAt: null and net > 0 and becomes eligible at once — at exactly step 4 of the cut-over procedure, after the doc's own step 2 prescribes a week or more of parallel running during which the container posted those same days. The only thing between that and duplicated real money is findPostedRecord matching the CONTAINER's records, which rests on an unverified semantic: interest.py posts recordDate as a full run timestamp while the filter is recordDate=eq.<day>. If eq is day-grained it reconciles; if it is exact equality the dashboard posts up to a month of duplicates. The doc was not updated for the sweep at all and its Rollback section still asserts stop-then-flip means "there is no double-posted day to reconcile away" — an argument the sweep invalidates for every parallel-run day.
Task 19: Ruling P3-C37: REMOVE the automatic sweep rather than bounding it. Bounding it correctly needs a "posting enabled at" fact the schema does not carry, and every alternative (a new column, an operator-triggered backlog action) adds surface to the one task in the phase that writes real money, at the end of a long phase. My original instruction said to log and count the skip and to CONSIDER a sweep — the log-and-count half is what Important 4 actually required, and it turns a missed day into a visible recorded skip an operator can act on deliberately. Removing the sweep eliminates the Critical outright instead of narrowing it, and leaves the day-recovery question to a later phase that can add the column and the runbook step together — cost if wrong: a genuine outage still loses that day until someone acts on the logged skip.
Task 19: also fix — the pre-check is marker-scoped rather than rule-scoped, so with two posting rules on one account rule B finds rule A's record, skips its own post AND marks itself posted against A's Wallet id: a silent under-post plus a false ledger row. Detect that case and refuse rather than marking. And swept or not, buildNote reads the rule's CURRENT rates while the amount was computed under whatever version produced it, so a rate change inside the window mislabels the money.
Task 19: fix round 2 held until Task 21's implementer reports.
Task 21: complete (commits d51ca76..5b999e4, review clean — 0 Critical, 0 Important, 2 Minor). Every financial-honesty rule verified down to the domain rather than at the loader: reconciliation checks no_data BEFORE the matched branch so an empty period cannot fall through to "the books agree"; an unrecognised status falls back to the raw string rather than to something reassuring; an empty projection renders as "no projection available" and an empty accrual list as "no accrual recorded", never a fabricated zero row. The loader's catch is narrowed to NotFoundError with a dedicated regression test asserting a non-NotFoundError rethrows — the exact Expenses-precedent fix, applied in advance. The truncation bug class cannot recur here because the rules list has no cursor.
Task 21: Ruling P3-C38 (resolves the reviewer's ⚠️): the brief's Consumes line names updateInterestRule but no step or UI surface uses it. This is a STALE BRIEF LINE, not a dropped requirement. The API provides the update path (Task 20's PATCH, tested), the spec's page map has only the list and detail routes, and a UI edit affordance would today be the natural home for a posting-mode toggle — which is deliberately absent while the adapter's flip-the-switch hazard is being removed. Recording it here so it is not silently lost: a rule-edit surface belongs to a later phase that can ship it together with a safe posting-mode control — cost if wrong: editing a rule requires the API until then.
Task 21: minor (deferred): the account renders as a raw UUID on both pages, though loadEligibleAccounts already loads {id, name} for the form and could resolve it.
Task 19: fix round 2/5 (3 addressed, 0 open; commits 5b999e4..98e0ed7). The sweep is GENUINELY gone, not bounded — the query's from and to are the same variable, so re-arming it would need a new date expression AND a loop, not a widened constant, and the dead helper was removed too. The ownership check fails safe in both directions: the throw sits before getCategories and postRecords so a rejected match cannot post, and recordPostedEntry is on the next line inside the same try so a rejection cannot mark either. Everything round 1 closed survived — all three skip paths still log, counters and per-rule alerting intact. The note-from-accrual fix is pinned by a test that mutates the rule's rates and asserts a byte-identical note. The reviewer also verified against the real container that interest.py never back-fills from its state file, so the Rollback argument is structurally sound in both directions now that the dashboard is single-day too.
Task 19: fix round 3 dispatched for three Minors, the first of which MY OWN RULING created: the runbook never tells an operator that a day which did not post will now never post by itself, nor that re-triggering the job the same calendar day is the only in-app lever and that it expires at the Rome-date rollover. Removing automatic recovery without documenting the manual one is half a decision. Also: the Rollback claim is absolute where the rollback-day restart makes it timing-conditional, and the note's gross/tax/net do not reconcile arithmetically (unavoidable given 6dp inputs rounded to 2dp, but an operator will notice).
Task 19: minor (deferred): the amount round-trip's sign and scale are as unverified as the rest of the client, so a different echo shape turns crash-recovery into a hard stop (fail-closed and alerted); PostFailedError's contract over-alarms on the amount-mismatch path where nothing was sent; no test pins the single-day scope.
Task 19: fix round 3/5 (3 addressed, 0 open; commits 98e0ed7..74b29ac). The runbook now states plainly that a day which did not post will not post itself, names the only lever (re-trigger the daily job on the same Rome-calendar day) as its own bolded paragraph, and ties the deadline to the same romeDate boundary the job actually uses rather than a vague midnight — the reviewer verified that against the code and confirmed it reads correctly for an operator alerted at 23:40. The Rollback claim is narrowed to days before the rollback and now names the real condition and remedy. Dropping gross and tax from the note is display-only: both remain at six decimals on the accrual row, are exposed by the API, and are still written into the entry — the reviewer checked each.
Task 19: complete (commits 280f61e..74b29ac, review clean after three rounds — the most-worked task of the phase, and the only one that writes money to a real external account)
Task 22: complete (commits c0b2818..15bfa94, review approved first round — no fixes). All 9 batched cleanup items landed, including the pre-existing Phase 1 groups-repository savepoint bug; its itest issues a further statement on the same transaction, so it fails without the fix. Docs correctly describe the system as it now is (no posting sweep, reconciliation no_data state) rather than the brief's stale draft. Two reviewer WARNs are verification-only with no diff artifact (openapi:generate, interest-accrual itest) — both are inside Task 23's gate.
Ruling P3-C38 (ordering of Task 23 vs the whole-branch review): Task 23 writes the checkpoint against the tree as it stands at 15bfa94, and the Phase 3 whole-branch review runs after it. Any fix wave the whole-branch review produces gets appended to the checkpoint as a dated addendum rather than rewriting its commit range — the same shape Phase 1's production-deploy addendum used. Cost if wrong: the checkpoint's headline range needs one appended section instead of being correct in a single pass.

## Phase 3 whole-branch review — dispatched
Range 67747cb..15bfa94 (41 commits, 129 files, +17273/-85 excluding graphify-out).
A single package would exceed a reviewer's context, so it is split four ways by area, with coverage verified file-by-file against `git diff --name-only`: 134 of 134 changed files land in exactly one package, none uncovered.
  wb-1-data.diff      (346k) migrations 0011/0012, schema, lib/db, every repository + fake + itest    [opus]
  wb-2-expenses.diff  (132k) expenses domain/application, wallet transactions adapter, lib/clients, integrations sync engine  [sonnet]
  wb-3-interests.diff (134k) accrual math, interests use cases, posting adapter, lib/jobs, lib/calc — the money path  [opus]
  wb-4-api-ui.diff    (308k) all routes/schemas, all UI + loaders, src/app, src/platform, e2e, docs   [sonnet]
Each reviewer carries the phase's own observed defect classes as its attention lens rather than a generic rubric: memory-fake vs Drizzle divergence (five instances so far), RLS-blind reads that return zero rows instead of erroring, and the double-post question for the money path.

### wb-4 (API/UI/docs) — Needs fixes
- IMPORTANT: interest_accrual is a registered daily job (register-all.ts) and a JobName (contracts.ts:124) but was never added to the admin page's JOBS/JOB_LABEL arrays (settings/admin/page.tsx:22-40), so the Scheduled-jobs panel never lists it — while phase-3-runbook step 4 and wallet-manager-cutover step 5 both tell the operator to verify its health there. Recent-runs shows only the last 20 across all jobs and four hourly jobs push a daily entry off within ~5h. Cross-cutting by construction: the code half and the docs half were each correct in their own task.
- MINOR: RulesTable renders the raw accountId UUID as the row label; multiple rules are indistinguishable without opening each.
- MINOR: generateMetadata on the transaction detail page does not use requirePrincipalOrRedirect, so an unauthenticated direct hit gets a framework error page where the body would redirect to /signin. No data leak.
- Clean: no secret exposure, no cross-user leak (every new route scoped + adversarial itest), no OpenAPI collision, no provider-name leak, error mapping consistent across all three modules, empty states never fabricate a zero, no_data threaded correctly through all five layers.

### wb-2 (expenses domain + sync engine) — Needs fixes
- IMPORTANT: transfer pairing is batch-local. transferCandidates is built only from this run's `incoming`, and pairTransfers never reconsiders already-created transactions with transferGroupId IS NULL. Two legs whose recordDates are more than RECORDS_LOOKBACK_DAYS=7 apart (delayed clearing, or an account linked later) never pair: by the time leg B arrives, leg A has scrolled out of the lookback and is never refetched. Both stay type="transfer" with no shared group — the double-counted-spend shape pairing exists to prevent. Untested: the transfer test only exercises both legs in one run.
- IMPORTANT: wallet.ts PostRecordInput.amount is typed `number` while every read-side money field in the same module is `string`, and the body ships via bare JSON.stringify with no 2dp formatting. The signature forces a Number() conversion at the one call site that writes real money externally. Cross-check with wb-3 (the call site is its quarter) before ruling on the fix shape.
- MINOR: mapWalletRecord takes amount from a JSON float via toFixed(2); sync never re-patches amount on update, so a misround at creation is permanent. Mirrors the pre-Phase-3 getAccounts pattern.
- MINOR: assertPageNotTruncated's 200/500 ceilings hard-fail a busy account's sync with no auto-recovery (cursor only advances on success). Self-documented trade-off; operational watch-item.
- MINOR: transactionsUpdated increments even when update() returns "version_mismatch" or null. Stats only.
- Clean: upsert-only verified branch by branch (the overlap cannot duplicate), in-run dedup correct in all three loops, two-phase fetch/apply enforced at type level, token never in a URL/error/audit, redactCredentials on every failure path.

### wb-1 (persistence/RLS) — Needs fixes
- CRITICAL 1: recurring_patterns_user_payee_uq is (user_id,payee) but detectRecurring groups on payee+currency+sign by design, emitting payee: last.payee per group. Two groups -> same payee -> 23505 on replaceAll's multi-row INSERT -> escapes apply(), which wallet-provider-adapter runs in ONE transaction with syncProviderTransactions -> the entire run rolls back, and the detector re-derives from listAll() every run, so it repeats forever. Expenses sync stops permanently. Also reachable via the sign split (recurring income + recurring expense, same payee). No test anywhere inserts two same-payee patterns.
- IMPORTANT 2: transaction_categories, transaction_labels, transaction_label_links, recurring_patterns have RLS declared but nothing observes it. The four cross-user tests that exist run under withSystemContext, where app_is_system() short-circuits the policy. Deleting a CREATE POLICY leaves the suite green; the table then fails closed in production on first deploy.
- IMPORTANT 3: list() from/to divergence — fake compares ISO strings lexically, Drizzle compares Dates; schema declares from as z.string() with no format validation. An offset timestamp drops a day's rows in the fake only; "banana" is an empty 200 in the fake and a 500 in production. Untested on both sides.
- IMPORTANT 4: liveFor() — fake picks the first matching link then checks missingSince; Drizzle puts isNull(missingSince) in the WHERE. With two providers on one account (a state interest-accrual.itest.ts already anticipates), the fake returns null where production returns the live link, inverting delete-account and update-account guards. Pre-existing from Phase 2, made reachable by Phase 3's second provider.
- IMPORTANT 5: label/category ownership enforced nowhere — setLabels checks the transaction's owner, not the labels'; the transaction_label_links policy joins transactions only; categoryId's FK is satisfied by any user's category. PATCH with another user's labelIds/categoryId succeeds. Integrity, not disclosure, today.
- IMPORTANT 6: DrizzleInterestRulesRepository.list() has no ORDER BY while the fake returns insertion order; every other list in the phase orders explicitly. Rules reorder after an edit.
- MINOR 7-11: fakes echo numeric strings without column-scale normalisation; fake update() lets an explicit undefined null a field (Drizzle strips it); the two EXISTS policies reference the outer column unqualified (a future same-named column silently rebinds them); an unresolvable cursor restarts at page 1 with a non-null nextCursor (infinite loop for a follower); fakes hand out references into their own store.
- Clean: migrations 0011/0012 verified column-by-column against schema AND snapshots, zero drift; all 8 tables ENABLE+FORCE with policies; the savepoint fix is complete and its tests genuinely prove it; the accrual precision chain is lossless; the postedAt/entryId conflict-set omission is correct in both implementations and proven through a re-read.

### wb-3 (interests / the money path) — Needs fixes
- CRITICAL 1: the crash-window guard queries a grain it does not write. POST sends recordDate "T00:00:00Z"; findPostedRecord queries recordDate=eq.<bare date>. If Wallet casts that in its own timezone (Europe/Rome, like this stack), the day resolves to the previous 22:00Z and never matches. Since the sweep-removal ruling, this check is the ONLY thing between a mid-post restart and a second real posting — and no doc requires verifying it before flipping a rule to post_to_provider. Both existing tests assert against mocks this repo wrote.
- CRITICAL 2: withJobLock takes pg_try_advisory_xact_lock then sits idle-in-transaction across the whole Wallet round trip (default retryPolicy: 5 attempts, 20s timeout, 2->32s backoff = minutes). idle_in_transaction_session_timeout / pooler kill / failover releases the lock while the POST is in flight. The crontab uses curl --retry 3, and the tick returns 500 if ANY daily job fails, so concurrent triggers are routine. Both runs see postedAt null, both findPostedRecord empty, both POST. No test exercises lock contention for this job at all; a lock-skipped rule is also invisible (outcome null, no skipped counter).
- IMPORTANT 3: interest_entries.transaction_id is uuid; the adapter writes Wallet's opaque record id (z.string(); every other provider id in the codebase is text). A non-UUID id throws on entries.create, the transaction rolls back, and real money is at Wallet with NO local record. No test in the package writes a posted entry to Postgres.
- IMPORTANT 4: "already posted" concluded from account+day+marker+amount. noteMarker defaults to "auto-interest" for every rule and nothing stops two rules per account. Two rules computing the same cent: B adopts A's record and never posts (ledger claims 2x what landed). Differing by more than a cent: B throws PostFailedError forever.
- IMPORTANT 5: netCents clamps at 0 but carryAfter keeps the whole negative remainder unbounded. 60 days at -2000.00 builds a -5.47 carry that silently eats ~12 days of real interest after a top-up, reconciling as matched throughout. The file's own doc comment names this pathology as the reason to reject negative rates; a negative balance reaches it by another door.
- IMPORTANT 6: dayCount "actual" and compounding "monthly"/"none" are accepted by the schema, the DB checks and the public API, and produce a permanently inert rule with no log line, no UI signal, and no skipped counter in the job detail.
- IMPORTANT 7: nothing validates that a rule's account belongs to the rule's user. createInterestRule takes accountId: z.string().min(1); the interest_rules policy checks user_id only. Today a foreign account yields balance === null via an incidental join in the balance lookup, so it never accrues — the right outcome by accident. liveFor runs under role: system with RLS bypassed and no userId of its own.
- MINOR: post-interest-entry.ts:34 rounds gross through Number().toFixed(2) — a second rounding point, against the regex-never-Number constraint; PostFailedError also wraps findPostedRecord/getCategories, so a pre-POST read failure pages the operator with "money may already be at Wallet"; lock-skipped rules uncounted; postRecordsResponseSchema.catch([]) silently drops Wallet linkage on a shape change.
- Clean: the math is a faithful single-rounding port with a 365-day conservation invariant test; strict parsing refuses to invent money; NO sweep survives (grep-verified: re-arming needs a loop, not a constant); the note is built from stored accrual values, proven by a test that edits the rate; attempts:1 on the write; failure isolation real; no credential anywhere; markPosted's boolean + throw-before-audit landed correctly.

## Rulings on the whole-branch findings (made before dispatching the fix wave)
- Ruling P3-C39 (posting claim): adopt wb-3's committed-claim fix, but shaped so it fails toward NOT paying. `markPosting` does a conditional `UPDATE interest_accruals SET posted_at = now() WHERE id = $1 AND posted_at IS NULL RETURNING id` BEFORE the Wallet call; a confirmed success then writes entry_id; a confirmed failure reverts posted_at to null. A crash in between leaves posted_at set with entry_id null — an observable in-flight state reconciliation and the UI must surface as indeterminate, not as paid and not as nothing. Why: under-paying is visible and recoverable, double-paying real money is neither. Cost if wrong: an interrupted post needs an operator to resolve one clearly-flagged row instead of resolving nothing.
- Ruling P3-C40 (date grain): post the bare `accrualDate` so the write and the duplicate-check read use the same grain, rather than writing a timestamp and querying a day. Why: it removes the timezone question entirely instead of documenting it. Cost if wrong: Wallet stores a date where it previously got midnight UTC — the same instant it was already resolving to.
- Ruling P3-C41 (marker): the note marker gets a per-rule suffix and the duplicate check matches on the suffixed marker, so two rules on one account can never adopt each other's record. Safe to change freely: nothing has posted in production, Phase 3 is not deployed.
- Ruling P3-C42 (recurring index): the DETECTOR's grouping key is the truth — widen the constraint to match it (payee + currency + sign), adding the columns if the table lacks them, not collapse the detector's groups. Why: a EUR series and a USD series genuinely are two series and the UI should show both; collapsing them would hide one. Cost if wrong: recurring_patterns carries two columns it would not otherwise need.
- Ruling P3-C43 (negative balance): do not accrue at all on a negative balance — record a visible skip with its reason — rather than writing net 0.00 and carrying an unbounded negative remainder. Why: the current behaviour silently consumes later real interest, and "never invent financial data" cuts against writing a 0.00 row that reconciles as matched while a debt accumulates behind it. This is a deliberate divergence from interest.py, which handled this case badly; document it. Cost if wrong: a negative-balance day is absent rather than present-as-zero, which is the more honest of the two.
- Ruling P3-C44 (inert rules): keep `dayCount: "actual"` and `compounding: "monthly"/"none"` accepted by the schema — spec §5.7 fidelity is deliberate (P3-7) — but make the inertness visible: a per-rule skip reason in the job detail, a skipped counter, and a UI signal on the rule. Rejecting them at the write boundary would contradict the schema the spec asked for. Cost if wrong: a forward-compat placeholder is visible as unsupported rather than unavailable.
- Ruling P3-C45 (transfer pairing): pairing must reconsider already-stored unpaired legs, not only this run's incoming batch — bounded to a window rather than a full-table scan. Cost if wrong: a bounded window still misses a pathologically late leg, which is strictly better than today's guaranteed miss beyond 7 days.
- Ruling P3-C46 (fix-wave batching): the wave is three SEQUENTIAL dispatches, not parallel — the standing rule against concurrent implementers holds, and two of the three need their own migration, which would collide. Order: A persistence (owns the next migration number), B money path (owns the one after), C sync + UI (no migration).
- Ruling P3-C47 (re-verification): the fix wave invalidates Task 23's gate run and its graphify regeneration. Both re-run after the wave, and the checkpoint gets its commit range corrected rather than an addendum, since the correction lands before anything is deployed.

### Fix wave batch A — DONE (48709aa, 1e32ff9, f00c132)
Unit 873->882 / 93 files; integration 103->113 / 30 files; tsc clean.
- A1 closed by widening recurring_patterns uniqueness to (user_id, payee, currency, sign) per P3-C42, adding a `sign` column in new migration 0013_expenses_ownership_fixes.sql, proven by a real-Postgres test inserting two same-payee groups differing only by currency and only by sign.
- A2 closed with src/lib/db/expenses-rls.itest.ts, and — the part that matters — the gap was proven empirically: the label-links policy was weakened back to its pre-fix shape on a fully re-migrated scratch database, the new test was confirmed FAILING, then the policy was restored and confirmed green. That is the proof the four tables never had.
- A3, A4, A5, A6, A7 (expenses side) closed with matching fake/real changes and tests on both sides.
- A7's two interests-side sub-items were left to batch B per the brief's scope restriction, and reported as a deliberate scope decision rather than silently dropped. Carried into fix-b-brief.md as B9.
- Noted: a pre-existing `next lint` breakage, unrelated to the phase.

### Fix wave batch B — DONE (da41da2, 61c9c1c, 0a0905b, f3f3832, ce743b4; migration 0014_interest_posting_fixes.sql)
Unit 882->897 / 93 files; integration 113->118 / 30 files; tsc clean.
- B1: the POST and the duplicate check now use the same grain, and the runbook requires verifying the round-trip against a live token before a rule is first flipped to post_to_provider.
- B2: correctness moved off the advisory lock and onto a durable database claim — claimForPosting does `UPDATE interest_accruals SET posted_at = $2 WHERE id = $1 AND posted_at IS NULL RETURNING id`, committed BEFORE the Wallet call, with releaseClaim reverting on a confirmed failure. Proven by a repository-level test racing two concurrent claims with NO lock in the code path: removing the WHERE guard makes both resolve true. withJobLock is retained and documented in both jobs.ts and interest-accrual.ts as an optimisation, not the correctness boundary. Honest limitation reported: the end-to-end concurrent-job test probably has the lock resolve the race before the claim is exercised twice, which is exactly why the lock-free repository test exists.
- Crash between a successful POST and the local write now leaves postedAt set with entryId null — the deliberate observable in-flight state, never retried (shouldPost and claimForPosting both refuse) and never reported as paid (reconciliation says indeterminate, not matched).
- B3: interest_entries.transaction_id widened to text, with the first test in the codebase that drives a successful post all the way through to Postgres.
- B4-B9: per-rule note markers, negative-balance skip (P3-C43), visible skip reasons + counter, account-ownership validation in both the use case and the policy's WITH CHECK, and the B8 money-safety batch (decimal-string amounts, no silent response-shape swallowing, single cent-rounding point).
- Two deviations reported rather than hidden: schema/interests.ts edited (required by B3's own instruction, limited to the one column), and RuleDetail's new ruleInert prop left unwired because src/app/** belongs to batch C. Carried into fix-c-brief.md as C7.

### Fix wave batch C — DONE (aef890a, ab25461, 9497f59, 60cda52, 09b5739; no migration)
Unit 897->909 / 94 files; integration 118->119 / 31 files; tsc clean.
- C1 was NOT implemented as briefed: instead of P3-C45's bounded-window rescan of stored unpaired legs, it looks the counterpart up directly by Wallet's own transferCounterRecordId (claimed equal to the counterpart's externalId) via a single links.byExternal lookup — no date window, no scan, so no pathologically-late leg is missed either. Proven with legs synced 10 days apart in two separate runs, unit plus a new real-Postgres test. Ruling P3-C45 is superseded by the implementation; the re-reviewer is asked to judge the substitution on its merits, specifically whether the externalId equality is established or assumed and whether an absent/unsynced counterpart degrades rather than throws.
- C2: interest_accrual added to the admin JOBS/JOB_LABEL arrays, and its row surfaces batch B's skip and in-flight counts via a new pure interest-accrual-notice.ts.
- C3, C4, C6, C7 closed; C7 wires batch B's ruleInert through the page so an inert rule visibly says so.
- C5: both broken cut-over links fixed; whole tree scanned, remaining hits are historical planning snapshots.
- Also added: a runbook section for the assertPageNotTruncated ceiling failure mode and its manual recovery (behaviour untouched, as instructed).
- Concern reported: a genuinely thrown Postgres error mid-transaction still poisons that SQL transaction regardless of JS-level try/catch — inherent, mitigated by writing every new path so it cannot throw under expected conditions.

### Fix-wave re-review dispatched
Three packages, one per batch, each paired with its own brief and report: rr-a.diff (190k), rr-b.diff (252k, the money path), rr-c.diff (59k).

#### rr-a — APPROVED
A1-A7 all closed with file:line evidence. A1's new constraint matches the detector's grouping key exactly (not merely differently), and its itest would genuinely 23505 against the old index. A2's four tests all run under withUserContext and assert on err.cause.message, so they can actually fail. A3/A4/A6 each changed both implementations with a test that would fail if only one had. A5 refused at all three layers, each proven by a refusal test. No migration/snapshot/journal drift; no savepoint hazard introduced; the one changed pre-existing test was strengthened, not weakened.

#### rr-c — APPROVED
C1-C7 all closed with file:line evidence. The C1 substitution is judged sound: mapWalletRecord sets externalTransferRef from transferCounterRecordId while externalId is the record's own id, so the equality the lookup relies on is the SAME invariant the pre-existing in-run pairKey already used — inherited, not invented. Absent/null/unsynced counterpart all `continue` rather than throw. The new tests split the legs across two runs 10 days apart (beyond the 7-day lookback) and assert the shared group, and would fail against the batch-local code. Group-id minting matches pairTransfers' own scheme, so a late-found leg joins the canonical group a same-run pair would have gotten. Nothing in the new path can throw a Postgres error under an expected condition (update() returns "version_mismatch" rather than throwing; transferGroupId carries no FK), so the transaction-poisoning concern stays theoretical.
Ruling P3-C48 (parked, not fixed): interest-accrual-notice.ts hardcodes the provider's brand name outside *-adapter.ts. It is a NEW instance of an existing violation, not a new violation — RulesTable.tsx's "Posts to Wallet" predates the fix wave — so opening a fourth round for UI copy is not worth it. Parked for whichever later phase reviews user-facing copy. Cost if wrong: one more string to change when the provider abstraction is tightened.

#### rr-b — APPROVED (the money path)
B1-B9 all closed with file:line evidence. The two things that most needed proving both hold:
- The claim genuinely commits before the provider call: claimForPosting runs via withUserContext on the module-level pool-backed db, not on the tx the outer withJobLock transaction holds open, and a Pool-backed Drizzle db.transaction() acquires its own client rather than nesting as a savepoint. So the UPDATE commits independently, the durability is real, not decorative.
- releaseClaim cannot revert a claim after the money left: guarded twice, at the DB level by `WHERE entry_id IS NULL` and at the call level by never being called after an ambiguous post error, only after a provably-pre-write read failure.
Also confirmed: accountId is immutable in InterestRulePatch, so update() cannot reopen B7's ownership hole; the WITH CHECK constrains account_id, not just user_id; PostRecordInput.amount is now a decimal string converted once at the wire boundary.
No new problems. The reviewer named one nuance explicitly as not-a-bug: tryPost opens a second pool connection inside the still-open job-lock transaction — the pre-existing pattern in this file, and precisely what makes the claim durable.

## Phase 3 fix wave: CLOSED. All three batches approved on the first re-review.
