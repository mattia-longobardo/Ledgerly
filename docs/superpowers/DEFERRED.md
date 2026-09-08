# Deferred

Scope the reduced Phases 7–9 plans dropped on purpose, plus the follow-ups the phases found and did not stop for. One line per item: what it is, why it went, and which original plan and task describes it in full. This is the list to reopen with the UI redesign — nothing here is lost, only postponed.

The `2026-09-06-*` plans referenced below were superseded by their reduced replacements and are no longer in the working tree; read one with `git show <rev>:docs/superpowers/plans/<file>`, or `git log --diff-filter=D -- docs/superpowers/plans/` to find the commit that removed it.

## Scope dropped on purpose

- **Time Off workspace UI** (spec §7.8: two-pane layout, URL-driven day detail, variance table, upcoming list, Home card body) — the redesign replaces every component it would use, so Phase 7 ships a bare page instead. Original `2026-09-06-phase-7-time-off.md`, Task 6.
- **`src/modules/timeoff/domain/variance.ts`** (planned vs used per month, from `src/lib/calc/leave-variance.ts`) — its only consumer was the variance table above. `leave-variance.ts` was deleted with its consumers in Phase 7 Task 1; rebuild it on `timeoff_balances.used` when the UI needs it. Original `2026-09-06-phase-7-time-off.md`, Task 2.
- **`updateType` use case and `PATCH /timeoff/types/{id}`** — types are seeded lazily per user (R7-1) with `hours_per_day` from settings, so nothing needs to edit them yet. Original `2026-09-06-phase-7-time-off.md`, Tasks 4 and 6.
- **`scripts/migrate-timeoff.ts` and its validator** — never: R7-5' makes legacy data disposable, so `leave_days` is dropped rather than migrated and production is repopulated by hand. Original `2026-09-06-phase-7-time-off.md`, Task 7.
- **Database session registry with list/revoke** (a `sessions` row per sign-in, `touchSession(sid)` on every principal resolution, `sessions.mfa_verified_at`) — Auth.js still issues JWT sessions and there is one user, so there is nothing to list; the Security page says so rather than inventing rows. Ruling R8-1. Original `2026-09-06-phase-8-security-admin.md`, Task 2.
- **TOTP, recovery codes and step-up** (hand-rolled RFC 6238, `/signin/mfa`, the `mfa_required` error code, the `qrcode` dependency) — Authentik owns the login form and already provides MFA for the single user. Rulings R8-3, R8-4. Original `2026-09-06-phase-8-security-admin.md`, Task 3.
- **Sign-in resolution, invitations, user lifecycle, roles and organization policies** (`resolveSignIn`, `invitations`, `OrganizationPoliciesSchema`, the admin page) — one user, and `AUTHORIZED_SUB` stays the allowlist. Rulings R8-2, R8-6, R8-7. Original `2026-09-06-phase-8-security-admin.md`, Task 5.
- **Audit-log viewer** — the rows are written and readable in the database; a page to browse them waits for the redesign. Original `2026-09-06-phase-8-security-admin.md`, Task 6.
- **Authorization matrix itest** (every route against every role) — reopen when a second role is actually used; today every principal is the owner. Original `2026-09-06-phase-8-security-admin.md`, Task 7 Step 1.
- **Security history** (`security_events` table and the `SecurityHistory` component on the Security page) — token creation and revocation already land in `audit_events`; a second, parallel event stream is not worth carrying for one user. Original `2026-09-06-phase-8-security-admin.md`, Tasks 1 and 4.
- **Outbound webhooks** (`webhook_endpoints`, the outbox in `webhook_deliveries`, the `webhook_delivery` job, HMAC signing, the four events and the endpoint-management UI) — nothing consumes them today, and building a delivery pipeline with no subscriber is carrying a retry schedule and a signing scheme for nobody. Rulings R9-2, R9-3, R9-4. Original `2026-09-06-phase-9-management-hardening.md`, Task 2.
- **Management pages** `/finance/management/{categories,labels,mapping-rules,issues,sync-jobs,contribution-types}` — the API and the server actions exist (Phase 9 Task 3), so the redesign only has to render forms; the pages themselves would be built out of components the redesign replaces. Original `2026-09-06-phase-9-management-hardening.md`, Tasks 3 and 4 (UI parts).
- **Final e2e suite beyond a smoke test** (`budgets`, `funds`, `payroll-upload`, `webhooks`, `home` specs) — the API-level smoke run covers the deployment question these were meant to answer; the browser specs are worth writing against the redesigned UI, not this one. Original `2026-09-06-phase-9-management-hardening.md`, Task 7.

## Follow-ups found while building

Each was found by a task or a review, judged not worth stopping the phase for, and left with the reasoning at the code that carries it.

- **`onDisconnect` network-I/O invariant** (Phase 4 PH4-C4: a provider adapter's `onDisconnect` runs inside the disconnect transaction, so an adapter that made a network call there would hold one open across it) — still not fixed, as in the original plan. No adapter does network I/O there today; the invariant is unenforced rather than violated. Original `2026-09-06-phase-9-management-hardening.md`, header.
- **The TeamSystem parser's two payslip paths disagree on `ferieTakenHours`** — the leave grid reports it cumulative year-to-date, the row-300 fallback per period, so `usedYtdHours` means different things depending on which path read the payslip. Documented at the consumer (`get-workspace.ts`); the real fix belongs in `src/lib/payroll/teamsystem.ts`, not in the view.
- **A push-landed / pull-failed Trek day has no `provider_links` row** — the link is written by the pull half of a sync pass, so in that narrow window this dashboard holds no link for an entry Trek does hold, and removing the day deletes it here while leaving it there. Closing it means writing the link at push time, which needs the entry id Trek only reports on the read. Documented at `removeEvent`.
- **A removal staged after Trek is disconnected never settles** — `provider_links` rows are kept on disconnect, so a day staged `pendingOp: "delete"` waits for a sync pass that will not come. Either purge time-off links on disconnect, or treat a disconnected provider as "no link" when deciding hard-delete vs stage.
- **An orphaned unscoped `trek_year_stats:<year>` row is left in `app_settings`** — Ruling T4-1 made the Trek stats cache user-scoped (`trek_year_stats:<userId>:<year>`), and the reduced phase ships no data migration, so the pre-existing global row is written by nothing and read by nothing. Delete it by hand, or with the next migration that touches `app_settings`.
- **`BalanceView` ignores `TimeoffBalance.unit`** (`get-workspace.ts`) — every balance source writes hours today, so the conversion is unconditional and correct; it becomes a silent misreport the day a source writes a figure already in days.
- **Expenses writes are at `/expenses/…` while reads stay at `/transaction-categories`/`/transaction-labels`** — the reads shipped first and renaming a published path is a breaking change nothing asked for, so both surfaces exist. Worth unifying behind `/expenses/*` at the next `/api/v2`. Recorded in `docs/api/README.md`.
- **`transaction_categories`, `transaction_labels` and `sync_jobs` have no `version` column**, so their `PATCH` routes are last-writer-wins with no `If-Match`, no `428` and no `409` (Ruling P9-4). Adding the columns needs a migration the reduced Phase 9 forbade. Low risk with one user; not with two.

## Minors from the Phases 7–9 review ledgers

Everything the task and review ledgers of the reduced run recorded as
"minor (deferred)" and did not close (Ruling P9-9). Those ledgers live in a
git-ignored workspace and go when it does, so this is the durable copy. One line
each: what it is, why it was left, where it came from.

### Phase 7 (time off)

- **`src/lib/calc/networth.ts` is orphaned** — its last consumer was one of the migration scripts Task 1 deleted, so nothing imports it. Left in place because deleting it was outside that task's brief. Phase 7 review, Task 1.
- **`/api/metrics` hardcodes the review-queue statuses** — the pending-imports gauge inlines `('needs_review','verified','needs_ocr')` in SQL instead of deriving them from `AWAITING_STATUSES` (`src/modules/payroll/ui/queue.ts`), so the two drift the day a status is added. Left because the value is interpolated into raw SQL rather than used as a TypeScript filter. Phase 7 review, Task 1.
- **`rls-matrix.itest.ts` registers `afterAll(closeDb)` once per `describe`** (five times) where one file-level `afterAll` would do. Harmless, so not worth re-running the suite for at the time. Phase 7 review, Task 1.
- **Dead setting key `ferieTakenByMonth`** (`src/lib/repo/settings.ts:20`) — written by nothing since the legacy leave tables went, and read by nothing. Phase 7 review, Task 1.
- **`DROP TABLE … CASCADE` in migration `0018`** is drizzle-kit's generated default; the drop order alone already satisfies the dependencies, so the `CASCADE` is wider than the migration needs. Not edited, because the migration is applied. Phase 7 review, Task 1.
- **`units.ts:18` truncates hundredths instead of rounding them** — normalising `88.256` yields `88.25`, not `88.26`. Left because every source in play today feeds it two-decimal values. Phase 7 review, Tasks 2–3.
- **`addHours` duplicates `addQuantity`** (`src/modules/timeoff/domain/events.ts:50-55`) — two spellings of one operation. Phase 7 review, Tasks 2–3.
- **`latestPerType` is not year-scoped** while the rest of `getWorkspace` is. It matches the port signature, so narrowing it is a port change rather than a one-liner. Phase 7 review, Tasks 2–3.
- **`plannedByMonth` has no ascending-month ordering test** — the dropped `plannedDaysByMonth` tests covered that, and no consumer depends on the order today. Phase 7 review, Tasks 2–3.
- **`clearPending` stamps `syncedAt` on a settled conversion that is no longer synced**, and `conversionRemovals`/`localOnlyUpserts` each re-derive `planPush`'s predicate instead of sharing it. Offered as optional in a fix round and declined. Phase 7 review, Tasks 2–3.
- **`mapError`'s fallback puts a raw `Error.message` into `?error=`** — the text is attacker-influenced, though it is escaped on render, so this is information exposure and not XSS. Phase 7 review, Task 4.
- **Wire schemas type `fraction`, `typeCode`, `status`, `origin` and `pendingOp` as plain strings** while the matching enum schemas already exist, so the published contract is looser than the domain. Phase 7 review, Task 4.
- **`DayForm` defaults the type to the literal `"vacation"`** rather than to `types[0]`, so a user whose seeded types omit vacation gets a wrong default. Phase 7 review, Task 4.
- **`GET /timeoff/events` accepts an unbounded `from`/`to` range** — one caller and one user, so no cap was added. Phase 7 review, Task 4.
- **The year is resolved three different ways** (`toISOString`, `getFullYear`, `getUTCFullYear`) across the time-off code, and the three disagree either side of midnight in a non-UTC zone. Phase 7 whole-branch review.
- **`plannedDaysYtd`'s comment claims comparability with the per-type used figures**, which are computed on a different basis. Phase 7 whole-branch review.

### Phase 8 (personal access tokens)

- **A `pat_`-prefixed credential that fails `TOKEN_PATTERN` falls through to the cookie path** instead of being refused as the malformed token it plainly is. Phase 8 review.
- **A date-only `expiresAt` means 00:00Z on the API and 23:59:59.999Z in the server action** — the same input, a day apart, depending on which surface took it. Phase 8 review.
- **Creating a token without JavaScript mints one nobody sees** — the one-time secret comes back through `useActionState` (Ruling P8-1) with no permalink fallback, so a no-JS submit succeeds silently. Phase 8 review.
- **The `last_used_at` throttle is per-observation, not enforced under concurrency** — two simultaneous requests can both decide to write. Cosmetic, on a timestamp nothing reads transactionally. Phase 8 review.
- **Unauthenticated Bearer requests reach a database transaction before rate limiting** — the token lookup happens first, so a flood of invalid tokens costs one query each. Phase 8 review.

The sixth Phase 8 minor — no route declaring `bearer` in its `security` array — was closed in Phase 9 Task 3 by Ruling P9-3 and is not carried here.

### Phase 9 (hardening and management)

- **Housekeeping ages `job_runs` on `COALESCE(finished_at, started_at)`**, so a row still queued or running 90 days later is purged as though it had finished. Documented as a Deviation when it shipped. Phase 9 review, Tasks 1–3.
- **A rate-limited inbound delivery still writes a `webhook_deliveries` row** — deliberate, because a refusal storm should be visible to an operator, and bounded by the cap itself; it does mean the refusal path writes. Phase 9 review, Tasks 1–3.
- **`updateMappingRuleAction` defaults `version` to `0`** instead of refusing a missing precondition, so a form that omits it reports a version mismatch rather than the real error. Phase 9 review, Tasks 1–3.
- **`update-mapping-rule`'s doc says a global rule id answers `404`** where the uuid path schema answers `422` first. Phase 9 review, Tasks 1–3.
- **`runMappingRulesForPrincipal` has no test seam** — it is reachable only through the job, so its branches are proven indirectly. Phase 9 review, Tasks 1–3.
- **`acknowledgeIssue` still passes ownership fields into its audit `before`/`after`** — `resolveIssue` was brought onto the Phase 6 `stripOwnership` convention in the closing fix wave and its Phase 5 counterpart was left as it was, so the two now disagree. Phase 9 whole-branch review.
