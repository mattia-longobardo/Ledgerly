# Phase 3 deployment runbook — Expenses and Interests

## 1. Pre-checks

- Confirm Phase 2 is deployed and its runbook's §9 walkthrough has been run
  at least once (`docs/deploy/phase-2-runbook.md`) — Phase 3 has no new
  required environment variables, but its Wallet transactions sync and
  interest-posting adapter both assume a working, tested Wallet connection.
- Back up the database: `pg_dump dashboard > backup-pre-phase3-$(date +%F).sql`.

## 2. Deploy

Phase 3 adds four migrations (`0011_transactions.sql`, `0012_interests.sql`,
`0013_expenses_ownership_fixes.sql`, `0014_interest_posting_fixes.sql`) and
no new environment variables. Build and deploy the image as usual; the
entrypoint applies all four on boot.

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

`0011`–`0013` are additive; `0014` changes `interest_entries.transaction_id`
from `uuid` to `text` and replaces `interest_rules_owner`'s policy. Nothing
in `0014` is destructive to data already written (a `uuid` string is always
valid `text`), so reverting the image to the pre-Phase-3 tag remains
sufficient — `transactions`, `transaction_categories`, `transaction_labels`,
`recurring_patterns`, `interest_rules`, `interest_accruals` and
`interest_entries` are simply unused by the older image, and nothing in this
phase touches a table an earlier phase depends on.

## 5. Posting cut-over

Enabling `postingMode: "post_to_provider"` on any rule is a separate,
deliberate, per-rule act — never a consequence of deploying this phase. It
only ever posts the day the daily job is currently running for: there is no
automatic sweep that back-posts a day that failed while posting was already
on, so a Wallet outage during that window needs an operator to notice the
logged skip and act on it, not a later tick to recover it by itself. See
[`docs/migration/wallet-manager-cutover.md`](../migration/wallet-manager-cutover.md).

**Before flipping the first rule to `post_to_provider` against a live Wallet
token, verify the posting round trip by hand**: create the rule in
`analyze_only`, wait for it to accrue a nonzero `net` for a day, then flip it
to `post_to_provider` and confirm — against the real Wallet account, not
just this app's own tables — that (a) exactly one record lands with the
expected amount, dated the accrual's own day, and (b) re-triggering the tick
immediately afterward (`POST /api/jobs/tick`, or waiting for a retried cron
tick) does **not** produce a second record. This exercises
`findPostedRecord`'s `recordDate=eq.<day>` filter against Wallet's actual
`recordDate` column and the actual `note=contains.<marker>` matching for
real — this module's own code comments are explicit that this behaviour has
never been confirmed against a live token, only against the retired
standalone script's own use of the same filter shape. Do this once per Wallet
account before its first rule ever posts for real, not once per rule.
