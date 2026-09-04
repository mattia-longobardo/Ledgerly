# Checkpoint: Phase 2 complete (2026-09-04)

Resume from here with any model. Read this file, then the spec, then the plan.

## State

- Branch: `main`, HEAD after this checkpoint's commit (`docs(handoff): Phase 2 checkpoint and exit criteria`, on top of `d04e917`). Not pushed to `origin`. Not deployed: production still runs the Phase 1 image.
- Range implemented: `12cee69..d04e917` (30 commits, Tasks 1–19) plus this task's own commit (docs only — the runbook fix and this checkpoint/ledger pair). Tag not yet cut.
- Verification on this tree, run fresh by Task 20 (not inherited from an earlier report):
  - `npx tsc --noEmit` — clean.
  - `npm test` — 704 tests / 70 files, all passing. Includes `src/platform/http/openapi-drift.test.ts` (1 test) — the OpenAPI drift check the exit criteria call for is inside this suite, not a separate command.
  - `npm run test:db:up && npm run test:integration` — 48 tests / 19 files, all passing.
  - `npm run build` — succeeds. The route table lists `/finance/expenses`, `/finance/interests`, `/settings/integrations`, `/settings/integrations/[provider]` and `/settings/admin` — every route the exit criteria depend on exists and compiles.
  - `npm run e2e` — 4/4 passing, run against a local `next dev` pointed at the throwaway `dashboard-postgres-test` database (already schema-migrated by the integration suite's own setup). The Playwright config has no `webServer` block, so a server has to be started by hand, per `tests/e2e/README.md`; this was not run against the live production container.
  - `grep -rn "WALLET_TOKEN_FILE\|TREK_TOKEN_FILE\|walletToken\|trekConfig(" dashboard-app/src dashboard-app/scripts docker-compose.yml` — the only hit outside `scripts/import-file-credentials.ts` is a historical doc comment in `src/lib/clients/wallet.ts` explicitly stating the module no longer reads it. `docker-compose.yml` carries none of the three retired variables.
- **Not run: the manual browser walkthrough with a real Budget Makers Wallet/Trek token.** No such token, and no authenticated browser session, exists in this environment (Task 18 flagged the same limit for its own settings pages). What could be checked by automated means instead — routes existing and rendering, the capability-driven nav logic, the webhook path end to end against a real Postgres — was checked and is green; see "What a reader should know before Phase 3" below. The exact steps a token-holder should run by hand are now written out in `docs/deploy/phase-2-runbook.md` §9.
- `graphify-out/` is stale for this phase's changes; that is expected (the phase deliberately did not run `graphify update .` per task, see Ruling P2-C15 below) and is regenerated once by the controller after this task, not by Task 20.

## Documents

- Design spec (binding): `docs/superpowers/specs/2026-09-02-finance-company-platform-design.md`
- Phase 2 task plan (all 20 tasks done): `docs/superpowers/plans/2026-09-04-phase-2-integrations.md`
- Execution ledger with every ruling (P2-C1–P2-C32, P2-1–P2-11) and every deferred minor: `docs/superpowers/handoff/2026-09-04-phase-2-ledger.md` (copied from `.superpowers/sdd/2026-09-04-phase-2-integrations/progress.md`; the full pre-flight conflict scan and every task's brief/report/review diff live in that same `.superpowers/sdd/` directory)
- Deployment runbook: `docs/deploy/phase-2-runbook.md` (§9 is the manual exit-criteria walkthrough a token-holder runs by hand)
- Integration framework guide: `docs/integrations/README.md`
- Architecture: `docs/architecture/overview.md`; API: `docs/api/README.md`, `docs/api/openapi.json`

## Decisions already taken (summary; full text in the ledger and in `task-20-brief.md`'s "Rulings" section)

- Interest posting to Wallet stays behind a per-rule switch in Phase 3; Phase 2 only declares the `interest_posting` capability (Ruling P2-1).
- All non-archived Wallet accounts keep counting toward net worth after disconnect; the per-account toggle already exists (Ruling P2-2).
- `APP_ENCRYPTION_KEY` is `keyId:base64key` entries, active key first; the sealed blob authenticates the key id as AEAD associated data (Ruling P2-3).
- `sync_jobs.schedule` is a dispatch tier (`hourly|daily|monthly`), not a cron string (Ruling P2-4).
- The inbound webhook is `POST /api/v1/webhooks/{provider}`; the receiving connection is found by trying each connected connection's own `webhookSecret` (Ruling P2-5).
- A failed connection test does not discard the credential — it lands the connection in `error` with the provider's message, still editable (Ruling P2-6).
- Owner-only Wallet sync (Phase 0/1 Rulings R10/R18) is retired: `integrations.manage` on one's own connection is the whole check now that connections are per-user (Ruling P2-7).
- Settings › Security lists only the current session (Auth.js JWT sessions, no session table until Phase 8) (Ruling P2-8).
- Scheduled jobs, recent runs and the Payslip AI form moved to Settings › Administration, gated on `admin.users` (Ruling P2-9).
- The Vacation fund setup form moved to Settings › Personal until Phase 6 replaces it with a Budget (Ruling P2-10).
- Trek's `onDisconnect` never deletes leave data under any policy — it is the user's own record, not the provider's (Ruling P2-11).
- The old Settings page's "Funds" list and "Accounts" pointer were **dropped**, not moved (Task 17 Step 4) — `Finance › Funds` and `Finance › Management` already own both; there is nothing left under Settings to look for.
- Implementers did not run `graphify update .` per task and did not commit `graphify-out/` mid-phase (Ruling P2-C15) — the graph is regenerated once, by the controller, after Task 20. This checkpoint's own commit does not touch `graphify-out/` either.

## Deployment status

**Phase 2 is implemented and verified on this tree but NOT deployed.** Production is still the Phase 1 image. Deploying is a separate, deliberate act — follow `docs/deploy/phase-2-runbook.md` end to end; do not skip steps or reorder them, especially around the temporary docker-compose edit in step 3 (see below).

Deployment prerequisites, in order:

1. **`DASHBOARD_APP_ENCRYPTION_KEY` must be generated and set in `.env` before the new image boots.** Confirmed by inspection: the production `.env` on this host is dated 2026-09-01 (before this phase) and defines no such variable. Every commit in this phase from Task 4 onward calls `env()` with `APP_ENCRYPTION_KEY: z.string().min(1)` and no default — the app refuses to start without it. The runbook's step 2 generates it (`printf 'k1:%s' "$(openssl rand -base64 32)"`) and step 2's own warning applies: back this value up somewhere durable, because there is no bulk re-seal path if it is lost.
2. **The file-mounted Wallet and Trek credentials must be imported exactly once**, using the script Task 13 added (`scripts/import-file-credentials.ts`, run in the container as `node /app/import-file-credentials.mjs`). This needs the *old* token files still reachable inside the container for one deploy — but the checked-in `docker-compose.yml` (Task 19) has already permanently removed the `WALLET_TOKEN_FILE`/`TREK_URL`/`TREK_TOKEN_FILE` environment entries and the `./secrets/*-token` volume mounts that used to provide them. The runbook's step 3 (fixed by this task — see below) now gives the exact four lines to add back to `docker-compose.yml` for that one deploy only, then step 6 reverts the edit.
3. Only after the import is confirmed (`{"imported":["wallet","trek"],"skipped":[]}`) and verified in the UI should the token files be removed from the host — the runbook's step 6 onward.

**A runbook defect from Task 19's review was fixed by this task, not deferred.** Task 19's reviewer found that `docs/deploy/phase-2-runbook.md` step 3 told the operator to "not yet remove" the token-file entries, while the `docker-compose.yml` committed in that same task had already removed them for good — there was no step describing how to get them back for the one deploy that needs them, and no mention that the import script also needs `TREK_URL` itself (not just the token file) to build Trek's credential. That fix round was deliberately held until Task 20 because both tasks write the same runbook file. This task closed it: §3 now states plainly that the checked-in file has nothing left to "not yet remove," gives the exact four lines (taken from the diff that removed them, commit `1d96edd`) to add back for one deploy, and §6 says to revert that edit rather than describing a fresh removal. No application code changed for this — docs only.

## What a reader should know before Phase 3

- **The manual token-holder walkthrough is still owed.** Everything reachable without a real Wallet/Trek token has been verified (routes render, capability-driven nav is unit-tested both ways — connected shows Expenses/Interests, `error`/`not_configured` hides them — the webhook path is proven end to end against a real Postgres in `webhook.itest.ts`). What has *not* been driven by a human in a browser with a real token is: connecting Wallet from the UI, seeing the nav update live, a real provider sync, disconnecting under each of the three policies, and the full webhook-to-UI round trip with a live signature. `docs/deploy/phase-2-runbook.md` §9 is the exact numbered checklist for whoever holds the tokens to run once, after deploying — it should be run and its result recorded before this phase is called fully closed, not just implemented.
- **Phase 2's own deferrals, already recorded and not accidental:** transactions, categories and interest rules (Phase 3); the document store and payroll uploads (Phase 4); per-user sync *schedules* are stored and read but still dispatch for the owner only, with no UI to switch a kind off; outbound webhooks (Phase 9); surfacing `rejected` webhook deliveries (no page reads them this phase); database sessions, MFA, personal access tokens and user administration beyond a read-only list (Phase 8); bulk credential re-seal for key rotation (reconnecting each integration is the Phase 2 procedure); rate limiting the public webhook endpoint (Phase 9, needs a key that isn't the principal).
- **Three findings carried forward by name, not swept:** webhook replay protection and `webhook_deliveries` retention (Phase 9 hardening, `payloadHash` already stored to support cheap dedupe later); folding the credential blob's version byte into the AES-GCM AAD would invalidate every already-sealed blob, so it waits for a real migration rather than a tidy-up; cursor-changed detection in the sync engine uses referential inequality, so a handler that mutates its cursor object in place would silently fail to persist it (no handler does this today).
- **Two Wallet accounts remain `unavailable` from the Phase 1 deploy** ("Buddybank - Personal Savings", "Isybank S.p.A - Main" — archived upstream). Unrelated to this phase; still the owner's to archive or exclude from net worth whenever convenient.
- Conventions the code follows, unchanged for Phase 3: use cases in `src/modules/<domain>/application`, ports in `ports.ts`, Drizzle and memory repositories in `infrastructure/`, provider names only in `*-adapter.ts`, UI and API call the same use cases, integration tests as `*.itest.ts`, `drizzle-kit generate --name <name>` for migrations (next free number is `0011`), commit messages end with the executing model's `Co-Authored-By:` trailer, `graphify update .` resumes running per task (Ruling P2-C15 was a phase-2-only exception for graph-size reasons, not a standing change).

## How to continue

- Decide whether to deploy Phase 2 now (run `docs/deploy/phase-2-runbook.md`) before starting Phase 3, and whether to push `main` to `origin` (still not pushed, same as after Phase 0/1).
- Whoever holds the real Wallet/Trek tokens should run `docs/deploy/phase-2-runbook.md` §9 after deploying and record the result — ideally as a short dated addendum to this checkpoint or the ledger, the same way Phase 1's production deploy got its own section in the Phase 0/1 checkpoint.
- To start Phase 3: read this file, the spec (§11 Phase 3 section), and the ledger's open items above, then use `superpowers:writing-plans` to write `docs/superpowers/plans/<date>-phase-3-<name>.md`, and execute with `superpowers:subagent-driven-development` (fresh implementer per task, reviewer per task, whole-branch review at the end) — the same process this phase and Phase 0/1 both used.
