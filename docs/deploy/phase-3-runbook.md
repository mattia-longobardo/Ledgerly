# Phase 3 deployment runbook — Expenses and Interests

## 1. Pre-checks

- Confirm Phase 2 is deployed and its runbook's §9 walkthrough has been run
  at least once (`docs/deploy/phase-2-runbook.md`) — Phase 3 has no new
  required environment variables, but its Wallet transactions sync and
  interest-posting adapter both assume a working, tested Wallet connection.
- Back up the database: `pg_dump dashboard > backup-pre-phase3-$(date +%F).sql`.

## 2. Deploy

Phase 3 adds two migrations (`0011_transactions.sql`, `0012_interests.sql`)
and no new environment variables. Build and deploy the image as usual; the
entrypoint applies both migrations on boot.

## 3. Verify

1. `curl -s https://$DASHBOARD_HOST/api/v1/openapi.json | jq '.paths | keys' | grep -E "transactions|interest-rules"` —
   confirms the new routes are live.
2. Sign in, visit `/finance/expenses` and `/finance/interests` — if Wallet is
   not connected, both still show the "Connect Budget Makers Wallet" empty
   state (never a zero); if it is connected, both should show the tables
   introduced this phase (likely empty until the next sync tick).
3. Trigger a manual sync: `POST /api/v1/integrations/wallet/sync` with
   `{"kind":"transactions"}` in the body (see `docs/api/README.md`'s
   `X-Requested-With` example for the exact headers) — then reload
   `/finance/expenses` and confirm rows appear.
4. Create one interest rule against a real synced Wallet account using the
   create-rule form on the Interests list page (`/finance/interests` — there
   is no separate "new rule" route), leave `postingMode` at its default
   `analyze_only`, and confirm `job_runs` (Settings › Administration) shows
   an `interest_accrual` success on the next daily tick.
5. Confirm `npm run test:integration -- interest-accrual` was green on the
   tree being deployed — this is the test that proves the job never invents
   a balance for an account with none on file.

## 4. Rollback

Both migrations are additive — no existing table or column changes. Reverting
the image to the pre-Phase-3 tag is sufficient; `transactions`,
`transaction_categories`, `transaction_labels`, `recurring_patterns`,
`interest_rules`, `interest_accruals` and `interest_entries` are simply
unused by the older image, and nothing in this phase touches a table an
earlier phase depends on.

## 5. Posting cut-over

Enabling `postingMode: "post_to_provider"` on any rule is a separate,
deliberate, per-rule act — never a consequence of deploying this phase. It
only ever posts the day the daily job is currently running for: there is no
automatic sweep that back-posts a day that failed while posting was already
on, so a Wallet outage during that window needs an operator to notice the
logged skip and act on it, not a later tick to recover it by itself. See
[`docs/migration/wallet-manager-cutover.md`](../migration/wallet-manager-cutover.md).
