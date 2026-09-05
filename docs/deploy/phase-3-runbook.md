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
[`dashboard-app/docs/migration/wallet-manager-cutover.md`](../../dashboard-app/docs/migration/wallet-manager-cutover.md).

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

## 6. Known failure mode — Wallet sync page ceilings

`assertPageNotTruncated` (`src/lib/clients/wallet.ts`) refuses to treat a
Wallet `/categories` or `/records` page as complete once it comes back at
exactly 200 categories or 500 records — Wallet's pagination has never been
confirmed against a live token, so a full page is treated as a possibly-cut
listing rather than guessed at. This is a deliberate trade-off, not a bug: it
fails loudly (`UpstreamError`, surfaced as a `wallet_accounts_sync` or
`wallet_transactions_sync` job failure in Settings › Administration) instead
of silently under-reporting a busy account's transactions.

There is no automatic recovery — the sync cursor (`sync_jobs.cursor` for that
connection/kind) only advances on success, so the same window is retried,
and fails, on every subsequent tick until an operator intervenes:

1. Confirm the failure from `job_runs.error` — it names the endpoint, the
   count and the limit.
2. If this is a transactions sync and the account is simply busy (e.g. many
   small transactions in one `RECORDS_LOOKBACK_DAYS` window), reduce what one
   window has to cover for that account in Wallet itself where practical
   (e.g. archive or merge duplicate categories for the 200-category
   ceiling), then let the next tick retry.
3. If the count cannot be reduced, advancing `sync_jobs.cursor` for that
   `(connection_id, kind)` past the affected window by hand unblocks later
   ticks, but accepts a permanent gap: transactions dated inside the skipped
   window are never imported by a later run (the sync only ever reads
   forward from its cursor). Treat this as a last resort and record which
   window was skipped.
4. Implementing real pagination against a live token is the actual fix, and
   is out of scope for this phase.
