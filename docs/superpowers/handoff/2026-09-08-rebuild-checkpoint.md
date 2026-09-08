# Rebuild checkpoint — Phases 7–9 (reduced), and the close of the platform rebuild

One checkpoint for the whole reduced run, replacing the per-phase ceremony the
reduced conventions dropped (`2026-09-07-phases-7-9-reduced-conventions.md`:
"no closing ceremony per phase … until the single docs task at the end of
Phase 9").

## State

**Implemented** on `main`, commit range `cc92cbc..HEAD`:

- **Phase 7 (Time Off)** — `cc92cbc..532025f`. Migration `0018`: three
  `timeoff_*` tables created, eight legacy tables dropped (`fund_deposits`,
  `fund_settings`, `legacy_funds`, `payslips`, `vacation_ledger`,
  `vacation_accrual_rate`, `leave_days`, `balance_snapshots`). Module
  `src/modules/timeoff/`, the Trek sync moved into it, the payroll apply step
  writing `timeoff_balances` through a sink, a bare `/company/time-off` page,
  Home and Company consumers, `wallet_refresh` retired, every migration script
  deleted, one parametric `src/lib/db/rls-matrix.itest.ts` in place of the
  per-domain RLS files.
- **Phase 8 (personal access tokens)** — `02ec05d`, `bd2078a`. Migration
  `0019`, `src/platform/auth/pat.ts`, `src/platform/http/authenticate.ts`,
  `src/modules/security/`, Bearer authentication, a Tokens section on
  Settings › Security.
- **Phase 9 (hardening and management)** — `d7eb975..d9012f4`, plus this
  documentation commit. Session-level `withJobLock`, the `housekeeping`
  retention job, inbound replay protection keyed per connection with a 60/min
  limit, the management use cases / routes / server actions (categories,
  labels, payroll mapping rules, reconciliation issues, sync-job toggles), and
  every route's `security` array accepting both schemes.

**Deployed: no.** Production still runs the Phase 6 image. Phase 6 was the last
cutover (2026-09-07; see `docs/superpowers/handoff/2026-09-06-phase-6-checkpoint.md`).
Everything above is implemented and reviewed on `main` and has never run
against production data.

**`main` has never been pushed to `origin`.** That has been true since Phase 0
and is stated here, not acted on: pushing is the owner's decision, not this
task's.

## Gate

Run on the tree this commit records, from `dashboard-app/`:

```
npm run typecheck                          → clean
npm test                                   → 156 files, 1354 tests, all passing
npm run test:db:up                         → dashboard-postgres-test healthy
npm run test:integration                   → 50 files, 373 tests, all passing
npm run build                              → next build succeeds
npm run openapi:generate                   → docs/api/openapi.json written
git diff --exit-code docs/api/openapi.json → no drift
npm run e2e (no E2E_TOKEN)                 → 4 passed, 1 skipped
npm run e2e (with E2E_TOKEN)               → 5 passed
```

**The e2e leg was executed, not documented away** (Ruling P9-2). The
application was built and started locally (`npx next start -p 3000`) against
the throwaway test database with dummy `OIDC_*` values — Authentik is only
contacted at sign-in, so the app boots and serves without it. The run without
`E2E_TOKEN` skips `smoke-api.spec.ts` with a message naming the variable and
the scopes; `smoke.spec.ts` and `settings.spec.ts` pass in both device
projects.

For the token run, a `personal_access_tokens` row was seeded directly
(`withSystemContext`, a known `sha256(token)`, scopes `accounts.read/write`,
`budgets.read/write`, `funds.read/write`, `timeoff.read/write`) for the
bootstrap owner, because signing in is impossible without Authentik. The
seeding script was temporary and is not committed. The smoke then drove, over
Bearer: `GET /accounts`; a manual account with a `1500.00` opening balance; a
budget and a `200.00` allocation sourced from that account, with the account's
balance re-read and **unchanged**; a fund and a manual contribution;
`GET /timeoff/workspace`; `PUT` then `DELETE` on a weekday time-off event.

The local server was stopped afterwards and the seeded token belongs to a
tmpfs-backed test database that does not survive its container.

## Rulings — kept, replaced, deferred

### Phase 7

| Ruling | Outcome |
|---|---|
| R7-1 types seeded lazily per user | **kept** |
| R7-2 Trek code ↔ type code, `permits` never pushed | **kept** — and extended during the phase: a staged `permits` upsert is settled locally before the push and a converted day's Trek entry is removed upstream, otherwise the day would be silently deleted on the next pull |
| R7-3 Trek entry id in `provider_links` | **kept** |
| R7-4 balances from payroll only, no rows → "—" | **kept** |
| R7-5 migrate then freeze `leave_days` | **replaced by R7-5'** |
| **R7-5' drop everything now** | legacy data is disposable, so `0018` creates the replacement and drops all eight legacy tables in one migration and production is repopulated by hand. Absorbs the original Phase 9 Task 6 |

### Phase 8

| Ruling | Outcome |
|---|---|
| R8-5 token format, sha256 storage, scopes ⊆ permissions and re-intersected at use, `last_used_at` throttled | **kept** |
| R8-1 session registry, R8-2 sign-in resolution, R8-3 TOTP, R8-4 step-up, R8-6 user lifecycle, R8-7 organization policies | **deferred** — Authentik owns login and MFA for the single user, and roles/policies only matter with a second one. All in `DEFERRED.md` |

### Phase 9

| Ruling | Outcome |
|---|---|
| R9-1 session-level advisory lock | **kept** |
| R9-5 housekeeping retention, 5,000-row cap | **kept** — `payroll_retention` keeps reading `app_settings` for its window, because the policies R8-7 would have given it are deferred |
| R9-6 inbound replay protection and per-connection rate limit | **kept**, with the key corrected (see P9-5) |
| R9-2, R9-3, R9-4 outbound webhooks | **deferred** — nothing consumes them |
| R9-7 drop the legacy tables | **absorbed** into Phase 7 as R7-5' |

### Controller rulings issued during the run

**Phase 7 pre-flight and execution**

- **PF-1** — Task 1's `npm test` may fail only in the trek-related suites, and the implementer reports the exact files. *The plan itself defers the Trek move to Task 3, so a green unit run at Task 1 was impossible as written.*
- **PF-2** — Task 1 also deletes `vacation-budget-migration.itest.ts` and the orphaned `scripts/*-fixture*.sql`. *They existed only to test scripts the task deletes.*
- **PF-3** — Task 1 deletes `/api/jobs/wallet-refresh/` and removes `wallet_refresh` from `sweep.ts`, `run/route.ts` and `registry.test.ts`. *`JobName` loses the member; anything naming it stops compiling.*
- **PF-4** — `scripts/import-file-credentials.ts` and its npm script stay. *The plan conditioned deletion on its env vars being gone; they are not.*
- **PF-5** — Task 1 updates `migrations.itest.ts` and runs the RLS/migrations/bootstrap itests in its own verify. *The migration changes exactly what those tests assert; waiting for the phase gate would have hidden it.*
- **PF-6** — the "no `payslips`" grep is satisfied when every remaining hit is prose about payslip *documents*. *The payroll module legitimately talks about payslips.*
- **PF-7** — Tasks 1–3, marked as one run, were dispatched as two with a review after each. *Task 1 alone deletes ~30 files and edits the Dockerfile.*
- **PF-8** — a per-domain `*-rls.itest.ts` is deleted only after any constraint proof in it is ported into `rls-matrix.itest.ts`. *Deleting wholesale would have discarded checks that carry business meaning.*
- **T4-1** — the Trek stats cache is user-scoped (`trek_year_stats:<userId>:<year>`). *A global key shows one user's balance to another.* (Leaves one orphaned row; in `DEFERRED.md`.)
- **T4-2** — the Company page gets a bare time-off line and loses its "joins this panel in Phase 7" promise. *The brief names `load-company.ts` as a consumer and the promise would otherwise dangle.*

**Phase 8**

- **P8-1** — the one-time token never travels through `searchParams`. *A secret in a query string lands in browser history, proxies and access logs.*
- **P8-2** — the three `/security/tokens` routes and their server actions require `authMethod === "session"`. *A token that can mint tokens turns one leak into a self-renewing foothold.*
- **P8-3** — `authenticateToken` builds its principal through a by-user-id loader next to `resolvePrincipal`. *The plan named the signature but not the loader; `resolvePrincipal` keys on an identity, not a user id.*
- **P8-4** — the task review and the whole-branch review were one combined review over `532025f..bd2078a`. *The phase is a single dispatch; two passes over the same diff duplicate a seat.*

**Phase 9**

- **P9-1** — `consumeWindow` keeps its `uuid principal_id` column; for inbound webhooks the key is the connection id, under `withSystemContext`. *The column and its policy are user-keyed and the webhook path has no user context; two random uuids cannot collide.*
- **P9-2** — the final gate's `npm run e2e` runs against an app the implementer starts locally, or the exact blocker is recorded. *The plan's gate needed a server it never said how to start.* Executed; see **Gate** above.
- **P9-3** — Task 3 sweeps every `createRoute` `security` array onto one shared both-schemes constant. *Phase 8 left the published contract false for ~60 routes and the smoke drives them with Bearer.*
- **P9-4** — `PATCH` on tables with no `version` column does not require `If-Match`. *Adding the columns needs a migration the reduced plan forbids.* Recorded in `docs/api/README.md` and `DEFERRED.md`.
- **P9-5** — the webhook replay key is `(connection_id, payload_hash)`, not `(provider, payload_hash)`. *A provider payload need carry nothing user-specific, so two connections of one provider routinely hash identically; provider-wide, the second owner's delivery is answered "duplicate" and its sync is dropped behind a 202 — work lost silently.*

## What the owner must do by hand after deploying `0018`

`0018` drops eight tables and migrates nothing out of them first. There is no
down migration; the pre-deploy `pg_dump` is the only way back
(`docs/deploy/README.md` has the sequence and the release notes).

1. **Re-upload payslips** through Company › Payroll and apply each import.
   Applying an import is what writes `timeoff_balances`, so every time-off
   balance reads "—" until at least one payslip has been applied.
2. **Re-enter booked time off** on Company › Time off, or let the Trek sync
   pull it if Trek still holds it.
3. **Check the Holidays budget.** `0018` drops `vacation_ledger` and
   `vacation_accrual_rate` — the tables the Phase 6 migration read *from*, not
   the budget it wrote — so a Holidays budget that already exists is
   untouched. If it was never created, it must be re-created by hand: the
   migration script is gone and will not come back.

## The standing remainder

Two things, and only two:

- **[`docs/superpowers/DEFERRED.md`](../DEFERRED.md)** — the scope the reduced
  plans dropped on purpose, plus the follow-ups the phases found and did not
  stop for, one line each with the original plan and task that specifies it.
  This is the list to reopen with the UI redesign.
- **The `onDisconnect` network-I/O invariant** (Phase 4 PH4-C4) — an adapter's
  `onDisconnect` runs inside the disconnect transaction, so one that made a
  network call there would hold it open across the call. No adapter does today;
  nothing stops one. It is listed in `DEFERRED.md` as well, and it is the one
  item that is a latent defect rather than postponed scope.

One further gap was found while writing these docs and is recorded at the code
rather than fixed here:
`DrizzleAccountsRepository.hasReferences` still answers `false`
unconditionally, which decides hard-delete-vs-archive for an account. Interest
rules cascade-delete with the account and budget allocations and scopes are
left dangling. Fixing it is a behaviour change with its own tests, not a
documentation edit.

## Review record

| Phase | Reviews |
|---|---|
| 7 | A task review after Task 1, another after Tasks 2–3 (two fix rounds — the `permits` conversion path and `planPull`'s `stillPending` guard), a task review of Task 4, and a whole-branch review with its own fix wave. |
| 8 | One combined task + whole-branch review over `532025f..bd2078a` (Ruling P8-4), with a security-focused lens. |
| 9 | A task review after Tasks 1–3, with one fix round that produced Ruling P9-5. A task review of this documentation task follows it. |
| 8–9 whole branch | **Pending** — it runs after this task, over the whole Phases 8–9 diff. Nothing in this checkpoint should be read as "reviewed end to end" until it has. |

`graphify update .` was run from the repository root as part of this task and
the regenerated `graphify-out/` is committed alongside this checkpoint.
