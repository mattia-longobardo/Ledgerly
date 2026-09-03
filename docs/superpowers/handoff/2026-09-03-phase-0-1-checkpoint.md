# Checkpoint: Phase 0 + Phase 1 complete (2026-09-03)

Resume from here with any model. Read this file, then the spec, then the plan.

## State

- Branch: `main`, HEAD `85f00df` ("fix: close the Phase 0 + Phase 1 whole-branch review findings"). Tag: `checkpoint/phase-0-1-complete`.
- Range implemented: `b2ba47b..85f00df` (29 commits). Not pushed to `origin`. Not deployed: production still runs the pre-Phase-1 image with Teable.
- Verification on this tree: `npm run typecheck` clean; `npm test` 608 tests / 55 files; `npm run test:integration` 33 tests / 12 files (needs `npm run test:db:up`); `npm run build` succeeds; `npm run e2e` smoke passes against a local server.
- `graphify-out/` shows as modified after every session; that is expected (AGENTS.md) and is not part of this work.

## Documents

- Design spec (binding): `docs/superpowers/specs/2026-09-02-finance-company-platform-design.md`
- Phase 0+1 task plan (all 21 tasks done): `docs/superpowers/plans/2026-09-02-phase-0-1-foundations-and-accounts.md`
- Execution ledger with every ruling (R1–R20) and deferred minor: `docs/superpowers/handoff/2026-09-03-phase-0-1-ledger.md`
- Deployment runbook: `docs/deploy/phase-1-runbook.md`
- Architecture: `docs/architecture/overview.md`; API: `docs/api/README.md`, `docs/api/openapi.json`; migration: `docs/migration/README.md`

## Decisions already taken (summary; full text in the ledger)

- Work happens on `main` (a project hook blocks branch/worktree creation).
- "Track" in the brief means Trek. Single organization, many users, per-user RLS.
- Wallet credential is one file-mounted token in this phase, so Wallet sync is owner-only in the job, the API and the UI (R10, R18). Phase 2 replaces this with per-user connections.
- Cookie-authenticated `/api/v1` mutations require `X-Requested-With` (R17).
- RLS on `audit_events`, `idempotency_keys`, `rate_limit_windows` is deferred to Phase 2 (R19), documented in `docs/architecture/overview.md` under "Known deviations".
- Restore is only valid from `archived`; a restored synced account with a missing link becomes `unavailable` (R13).

## Before Phase 2

1. Rehearse `docs/deploy/phase-1-runbook.md` against a restored dump of the `dashboard` database, then run it for real while Teable and the legacy tables still exist (migration 0007 drops them).
2. Decide whether to push `main` to `origin`.
3. Open questions needed later, not now: Phase 3 — should the app take over posting interest to the Wallet (retiring `wallet-manager`)? Phase 4 — ClamAV container acceptable; payroll retention (default 10 years)? Phase 8 — app-level TOTP after an Authentik login, or exempt SSO logins?

## How to continue

- Say "start Phase 2". The process used so far: brainstorming skill already satisfied by the spec; use the `superpowers:writing-plans` skill to write `docs/superpowers/plans/<date>-phase-2-integrations.md` from spec §11 Phase 2 (integration connections, encrypted credentials, connection test, sync jobs/runs, manual trigger, disconnect policies, inbound webhook endpoint, Wallet and Trek adapters ported, Settings split into Personal / Security / Account / Integrations / Administration); then execute with `superpowers:subagent-driven-development` (fresh implementer per task, reviewer per task, whole-branch review at the end).
- Conventions the code follows: use cases in `src/modules/<domain>/application`, ports in `ports.ts`, Drizzle and memory repositories in `infrastructure/`, provider names only in `*-adapter.ts`, UI and API call the same use cases, integration tests as `*.itest.ts`, `drizzle-kit generate --name <name>` for migrations (next is `0008`), commit messages end with the co-author trailer, run `graphify update .` after code changes.
- Deferred minors worth picking up early in Phase 2: Wallet fetched inside the user transaction (sync-provider-accounts), `provider_links` unique key lacks `user_id` (must be fixed before a second user exists), RLS on the platform tables.
