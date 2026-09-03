# SDD ledger — plan: docs/superpowers/plans/2026-09-02-phase-0-1-foundations-and-accounts.md
Spec: docs/superpowers/specs/2026-09-02-finance-company-platform-design.md (read; binding authority)

## Pre-flight scan (2026-09-02)

| Pair / task | Produces vs consumes | Finding |
|---|---|---|
| T2 → all | schema.ts moved to schema/legacy.ts + index | `@/lib/db/schema` resolves to the directory index under moduleResolution bundler; drizzle-kit takes the index path. OK |
| T3 → T5/T13 | Principal, assertPermission, PermissionDeniedError | names identical across tasks. OK |
| T5 → T7 | ApiDeps.rateLimitEnabled declared in T5, used in T7 | consistent. OK |
| T5 → T6/T7 itests | ApiError/toErrorBody used in test onError | exported by T5. OK |
| T8 → T3 | scripts/openapi.ts imports @/test/principal | exists from T3; tsx honours tsconfig paths. OK |
| T9 | JobName union must contain sweep/trek_sync/wallet_refresh/monthly_snapshot | brief tells implementer to verify actual names in contracts.ts. OK |
| T12 → T15 | AccountPatch includes origin/provider (adoption) | present in T12 ports. OK |
| T13 | romeDate from @/lib/time | exists (time.ts:11). OK |
| T15 | wallet accountSchema gains fields | zod strips unknown keys by default; additive. OK |
| T16 ↔ T17 | validate script imports netWorthSeries (T17) but T16 runs first | CONFLICT — see ruling R3 |
| T18 | GroupsRepository + groups use cases defined in T18 itself | self-consistent. OK |
| T19 → T17 | runForPrincipal seams live in ui/deps.ts (T17) | T19 adds seams; consistent. OK |
| T20 → T16 | deletes _lib/accounts.ts used by validate script | plan moves legacy series into the script (legacySeriesFromSnapshots). OK |
| Global | plan says commit on checked-out branch; SDD skill says never on main without consent | see ruling R1 |
| T1 | test Postgres on host port 55432, container dashboard-postgres-test | no conflict with running containers (checked docker ps). OK |

Ruling R1: implementation proceeds on `main` with no worktree — the project hook blocks branch and worktree creation, and the owner said "Proceed with a multi agent implementation" on this checkout — cost if wrong: commits land on main directly; each task commits separately so they can be reverted individually.
Ruling R2: todos are tracked in this ledger only (no TaskCreate calls) — the ledger survives compaction, todo tools do not add recovery value here — cost if wrong: none material.
Ruling R3: execute Task 17 before Task 16 — Task 16's validation script depends on netWorthSeries from Task 17 — cost if wrong: none; Task 16 has no other consumer before Task 20.

## Progress
Task 1: minor (deferred): resetDb `NOT LIKE '__drizzle%'` clause is redundant (drizzle bookkeeping lives in schema `drizzle`); resetDb has no automated test; testDb assigns `db` before migrations finish (theoretical race).
Task 1: complete (commits b2ba47b..815f6a8, review clean)
Task 2: Ruling R4: `roles.code` stays a natural text primary key (a seeded catalogue; spec §5 says UUID keys "where appropriate") and `roles` carries no timestamps; `user_roles` gains a composite PRIMARY KEY (user_id, role_code) replacing the unique index and keeps `granted_at` as its creation stamp; `audit_events` is append-only and carries only created_at — cost if wrong: a later migration adds surrogate keys/timestamps, no data loss.
Task 2: Ruling R5: the owner bootstrap moves out of migrate.ts into `src/lib/db/bootstrap.ts` as `bootstrapOwner(db, { subject, email })` so it can be integration-tested; migrate.ts calls it — cost if wrong: none.
Task 2: fix round 1/5 dispatched (2 open — user_roles has no PK; owner bootstrap untested)
Task 2: fix round 1/5 (2 addressed, 0 open — user_roles composite PK; bootstrapOwner extracted + itest; commits 7561fb6..54370da)
Task 2: minor (deferred): audit_events has no updated_at (append-only, ruled fine); bootstrapOwner returns created:false when no organization row exists, indistinguishable from "owner exists".
Task 2: note for later tasks: drizzle 0.45 wraps pg errors — assert on `err.cause.message`, not `toThrow(/regex/)` (affects Task 11 RLS test).
Task 2: complete (commits 815f6a8..54370da, review clean)
Task 3: Ruling R6: reviewer's Important finding "report fabricates a brief quotation" is parked — the quoted "Resolution of ambiguities" text was in the controller's dispatch prompt, not the brief; the report is accurate relative to what the implementer received — cost if wrong: none (code unaffected).
Task 3: minor (deferred): permissionsForRoles silently yields no permissions for an unknown role code; resolvePrincipal casts DB role strings to RoleCode without validation.
Task 3: note: requirePrincipal lives in `src/platform/auth/require-principal.ts` (principal.ts stays free of Next/Auth.js imports).
Task 3: complete (commits 54370da..0c526ee, review clean)
Task 4: minor (deferred): `tx as unknown as DbClient` double cast (plan-mandated); no rollback/role-default tests.
Task 4: complete (commits 0c526ee..269b5ef, review clean)
Task 5: first implementer dispatch (opus) terminated by a provider rate limit after the RED step; re-dispatching on sonnet from the partial working tree.
Security-review note on context.ts (withSystemContext bypass): Ruling R7: the `system` role context is intentional for cross-user jobs; it is only settable by server code and RLS policies (Task 11) check `app.role = 'system'` explicitly — cost if wrong: a job could read across users, which is its purpose; no client path can set the GUC.
Task 5: minor (deferred): `err.status as 400` cast in app.ts onError; registerAllRoutes stub untested until Task 18.
Task 5: note: hono@4.13.5, @hono/zod-openapi@1.6.2 installed; app.ts must not import @/auth.
Task 5: complete (commits 269b5ef..e7670cd, review clean)
Task 6: Ruling R8: plan-mandated defect confirmed — the idempotency upsert must also set request_hash and expires_at so a key reused after expiry starts a fresh 24 h window (spec §3.2 replay guarantee) — cost if wrong: none.
Task 6: fix round 1/5 dispatched (1 open — upsert omits expiresAt/requestHash)
Task 6: fix round 1/5 (1 addressed, 0 open — upsert refreshes requestHash/expiresAt + expiry test; commits 5e96b8b..35c0000)
Task 6: minor (deferred): `existing.statusCode as 200` cast; non-JSON response bodies stored as null and never replayed (undocumented).
Task 6: complete (commits e7670cd..35c0000, review clean)
Task 7: minor (deferred): redundant Number()/?? 0 around RETURNING count in rate-limit.ts.
Task 7: complete (commits 35c0000..67bdde0, review clean)
Task 8: complete (commits 67bdde0..14598ad, review clean)
Task 9: minor (deferred): tick route casts `tier` before the includes() check.
Task 9: complete (commits 14598ad..23ebd26, review clean)
Task 10: Ruling R9: the app layout must redirect to /signin (not throw) when the session has no active user row — add `requirePrincipalOrRedirect()` next to `requirePrincipal()` mirroring `requireUserOrRedirect`, and use it in `(app)/layout.tsx` — cost if wrong: none.
Task 10: fix round 1/5 dispatched (1 open — layout throws instead of redirecting)
Task 10: fix round 1/5 (1 addressed, 0 open — requirePrincipalOrRedirect in layout; commits 3503b83..ffa7edd)
Task 10: minor (deferred): AppShell `sidebarFooter` prop has no call sites; realProbes untested; IntegrationState `error|disconnected` never produced yet; five /finance/* nav links 404 until Task 17.
Task 10: complete (commits 23ebd26..ffa7edd, review clean)
Phase 0 exit: all tasks complete at ffa7edd.
Task 11: minor (deferred): withUserContext({ role: "system" }) is application-trust only (already covered by Ruling R7).
Task 11: complete (commits ffa7edd..5d4a38c, review clean)
Task 12: minor (deferred): history() sinceAsOf boundary untested; memory link repo returns superset objects (Task 14 should normalise); localeCompare vs PG collation ordering parity to check in Task 14.
Task 12: complete (commits 5d4a38c..57c2674, review clean)
Task 13: minor (deferred): staleness/trend helpers live in list-accounts.ts and are imported by get-account-detail.ts (belong in domain); account.balance audit lacks `before` (needs a single-balance lookup port); detail fetches all latest balances; history tie-break on same asOf.
Task 13: complete (commits 57c2674..9ed3301, review clean)
Task 14: minor (deferred): repositories.itest.ts has two describe blocks each tearing down the pool; upsertSeen re-pointing an external id to an entity already linked raises a unique violation (memory repo overwrites) — Task 15 must never re-point.
Task 14: complete (commits 9ed3301..ddbbfd5, review clean)
Task 15: Ruling R10: while the Wallet credential is a single file-mounted token (Phase 1), `wallet_accounts_sync` syncs only the owner (the user holding role `owner`), never every active user; the header comment claiming RLS scopes system-role statements must be corrected — cost if wrong: none now; Phase 2 replaces this with per-user connections.
Task 15: Ruling R11: a provider link whose local account no longer exists is treated as unlinked: the sync falls through to adopt/create and `upsertSeen` re-points that stale row to the new entity (safe: the new entity has no link) — cost if wrong: none.
Task 15: fix round 1/5 dispatched (2 open — cross-user link clobber via all-users loop; stale link dead end)
Task 15: fix round 1/5 (2 addressed, 0 open — owner-only sync + corrected comment; stale-link re-point; commits c84c635..91bf2f3)
Task 15: minor (deferred): version-race patches dropped without a `skipped` count; `updated` counts every linked account seen; Wallet fetched inside the user transaction; adoption filters on origin only (not liveFor); no integration test for the sync path; owner lookup outside the job lock (accepted).
Task 15: complete (commits ddbbfd5..91bf2f3, review clean)
Order note: executing Task 17 before Task 16 per Ruling R3.
Task 17: minor (deferred): netWorthSeries reads latestBalances for all accounts; Wallet freshness driven by all synced accounts' staleness (intended); placeholder routes not yet in FinanceTabs (Task 19 handles the tabs).
Task 17: complete (commits 91bf2f3..d3083a2, review clean)
Task 16: Ruling R12: docs/migration/teable-reconciliation.md contains real balances and must be git-ignored like the JSON export (the repo already ignores .work/ and PDFs for the same reason) — cost if wrong: none.
Task 16: minor (deferred): planner relies on ascending point order for same-month duplicates (document); migration-sourced month-end rows always outrank same-month provider rows in monthlySeries (runbook must say so); R12 gitignore of teable-reconciliation.md to be applied in Task 21.
Task 16: complete (commits d3083a2..8d0a4e5, review clean)
Task 18: first dispatch (opus) terminated by a provider rate limit before any work; re-dispatching on sonnet.
Task 18: minor (deferred): balances list handler bypasses the application layer (inline pagination + permission); recordBalance route re-reads history to build its response; OpenAPI under-documents 403/428/503 responses.
Task 18: complete (commits 8d0a4e5..f87d559, review clean)
Task 19: Ruling R13: a `status: "active"` patch is accepted only when the account is currently `archived` (restore); when restoring a synced account whose provider link has `missingSince` set, the resulting status is `unavailable`, not `active` — cost if wrong: none.
Task 19: fix round 1/5 dispatched (1 open — restore transition unguarded / stale link metadata)
Task 19: fix round 1/5 (1 addressed, 0 open — restore transition guarded; commits a11d9b2..b0d7d7d)
Task 19: minor (deferred): opening balance silently dropped when only one of date/amount is filled; group rename/delete does not revalidate detail paths; GroupsManager inline confirm lacks role=group; no test with an `unavailable` fixture for the restore guard.
Task 19: complete (commits f87d559..b0d7d7d, review clean)
Task 20: Ruling R14: `schema/legacy.ts` must not declare `balance_snapshots_source_ck` once migration 0007 drops it (otherwise the next drizzle-kit generate re-creates it); remove the check from the Drizzle schema — cost if wrong: none.
Task 20: Ruling R15: the Home page must render through the card registry (`visibleCards`/`cardState`), per spec §3.3/§7.1 — an implemented-but-unwired registry does not satisfy "Home composed dynamically from enabled modules" — cost if wrong: a small amount of UI rework.
Task 20: fix round 1/5 dispatched (2 open — Home not wired to the card registry (R15); legacy schema still declares the dropped check (R14))
Task 20: fix round 1/5 (2 addressed, 0 open — Home wired to card registry; legacy schema check removed and 0007 regenerated; commits 9bb6c75..911fae0)
Task 20: minor (deferred): mobile panel ordering changed (account strip now before Leave); no HOME_CARDS entry declares a permission yet; migrate-teable live fallback has no retry; comment rewording in ~14 files to satisfy the grep gate.
Task 20: complete (commits b0d7d7d..911fae0, review clean)
Task 21: Ruling R16: the migration and validation scripts must not import `@/lib/db` (whose lazy env() validation requires the whole app env); they build their own Drizzle client from `DATABASE_URL` like migrate.ts does, so the runbook's one-off containers need only DATABASE_URL (+ MIGRATION_OUT_DIR, + Teable vars for live fetch) — cost if wrong: none.
Task 21: fix round 1/5 dispatched (1 open — one-off containers crash on env validation)
Task 21: fix round 1/5 (1 addressed, 0 open — scripts build their own DATABASE_URL client; runbook one-off commands minimal; commits 3955703..f7d84f6)
Task 21: minor (deferred): migrate.ts has no try/finally around pool.end(); runbook migration ordering unrehearsed against a production-shaped stack.
Task 21: complete (commits 911fae0..f7d84f6, review clean)
All 21 tasks complete at f7d84f6. Dispatching final whole-branch review (b2ba47b..f7d84f6).
Final review (b2ba47b..f7d84f6): 0 Critical, 7 Important, minors; verdict "with fixes".
Ruling R17: spec §8.3's CSRF control is implemented now — cookie-authenticated mutating requests to /api/v1 must carry `X-Requested-With` (any value); missing → 403 with new error code `csrf_required` — cost if wrong: an external cookie-based client must add one header.
Ruling R18: extending R10 — while the Wallet credential is a single token, the API sync route and the UI sync action are owner-only too (403 `permission_denied` for non-owners) — cost if wrong: none now; Phase 2 replaces it with per-user connections.
Ruling R19: RLS on `audit_events`, `idempotency_keys`, `rate_limit_windows` is deferred to Phase 2 (they are accessed by middleware outside a user context; adding policies now would require restructuring the middleware); documented as a deviation in docs/architecture/overview.md — cost if wrong: a second user could read another's idempotency rows via SQL only, not via the API.
Ruling R20: probes take the user id (`hasAccounts(userId)`, `hasPayrollRecords(userId)`) and run inside the user context — cost if wrong: none.
Final fix wave dispatched (Important #1–#7 minus #7 deferred; triaged minors T19 opening balance, T18 OpenAPI errors, T10 probe test; runbook --force-recreate).
Final fix wave: 9 addressed, 1 deferred as ruled (R19); scoped re-review clean; final gate green at 85f00df (608 unit / 33 integration / build). Branch complete.
