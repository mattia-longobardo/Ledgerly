# Retiring the standalone `wallet-manager` interest container

The dashboard's interest module (Phase 3) computes the same daily accrual the
standalone `interest.py` container in `Wallet Manager/` computes today, and —
per a rule's `postingMode` — can post it to Wallet itself. This is the
procedure for moving from the standalone container to the dashboard without a
day of double-posted or missed interest.

**Default state after Phase 3 ships: nothing changes.** Every interest rule
defaults to `postingMode: "analyze_only"`; the standalone container keeps
posting exactly as it does today until an operator deliberately flips a rule.
Posting is opt-in, per rule — there is no global switch.

## Before you start: read the container's current configuration

The values live in `Wallet Manager/.env` (and, indirectly, in
`Wallet Manager/data/state.json`, the container's own carry-forward state).
Note these down — the dashboard rule you create must match them exactly, or
the two will compute different numbers and the parallel-run comparison in
step 2 below will not agree:

| Container `.env` variable | Meaning | Dashboard rule field |
| --- | --- | --- |
| `WALLET_ACCOUNT_NAME` | Wallet account the interest is posted to | the dashboard account linked to that same Wallet account |
| `WALLET_ANNUAL_RATE` | Annual rate, decimal fraction (`0.0225` = 2.25%) | `annualRate` |
| `WALLET_TAX_RATE` | Withholding tax rate, decimal fraction | `taxRate` |
| `WALLET_DAY_COUNT` | Day-count basis (almost always `365`) | `dayCount` |
| `WALLET_CATEGORY_NAME` | Category the interest record is filed under | `providerCategoryRef` |
| `NOTE_MARKER` | Prefix on every posted record's note | `noteMarker` |

`NOTE_MARKER` is a code default (`auto-interest`, set in `interest.py` itself)
rather than a variable `Wallet Manager/.env.example` ships — it is not present
in `.env` unless an operator added it there deliberately. Check `.env` first;
if it is absent, the container is using `auto-interest`, which is also the
dashboard rule's own default, so most deployments need no change here.

`Wallet Manager/data/state.json` carries the container's own `last_date` and
sub-cent `carry` — the dashboard does not read this file and does not need
to: its own accrual chain (`interest_accruals.carry_after`) starts fresh from
whatever day its own daily job first runs for the rule, exactly like the
container's chain did the day it was first deployed. A short gap between "the
container's carry" and "the dashboard's carry" is sub-cent and self-corrects
within a few days of ACT/365 accrual — it is not worth trying to seed.

## Steps

1. **Create a dashboard rule matching the container's `.env` today.** Use the
   create-rule form on the Interests list page (`/finance/interests` — there
   is no separate "new rule" route; the form lives on the list page itself),
   using the same account, annual rate, tax rate, and day count from the
   table above. Leave `postingMode` at its default, `analyze_only` — the
   whole point of the next step is that nothing posts twice while both sides
   are running.
2. **Let both run in parallel for at least a week.** The dashboard's daily
   job (`interest_accrual`, scheduled the same way every other daily job in
   this app is) computes and stores an accrual every day; the container
   keeps posting to Wallet as before, unaffected by the dashboard's rule.
   Compare the dashboard's `Finance › Interests › Rules › [id]`
   reconciliation view against the container's own posted records for the
   same days. **If they disagree, check the balance source before anything
   else**: `interest.py` reads the account's *live* balance at
   `WALLET_RUN_AT_UTC` every day, while the dashboard uses the latest
   *synced snapshot* on or before the accrual date (whatever the Wallet
   accounts sync last captured). If the sync and the container's run time
   don't line up — a balance-changing transaction posted between the sync
   and the container's run, or the sync itself lagging by more than a day —
   the two will disagree by design, for a reason that has nothing to do with
   rate, tax, or day-count configuration. Only once that's ruled out is a
   mismatched `annualRate`, `taxRate`, or `dayCount` between the rule and the
   container's `.env` the next thing to check. The two should agree to the
   cent on a day the balance didn't move between the sync and the
   container's run, since both implement the same ACT/365 simple-daily
   formula.
3. **Once satisfied, stop the `wallet-manager` container.** A gentler
   intermediate step, if you want more runway before fully committing, is to
   set `WALLET_DRY_RUN=true` in the container's `.env` and restart it: it
   keeps computing and logging what it would post, without actually posting,
   while you finish validating the dashboard side. When ready to cut over:
   ```
   docker compose -f "/home/mattia/docker/projects/Wallet Manager/docker-compose.yml" stop wallet-manager
   ```
   Stopping the container *before* flipping the dashboard's switch is what
   guarantees no day is ever posted twice: the two are never both
   allowed to post at the same time.
4. **Flip the rule's `postingMode` to `post_to_provider`** in the dashboard
   (same list-page form, or the rule detail page). From the next daily run
   onward, the dashboard posts the accrual itself — but only when three
   conditions all hold, matching the container's own behavior and this
   phase's analyse-only-by-default posture:
   - the account is a currently-live synced Wallet account (a manual account,
     or one whose provider link has gone missing, is never posted to);
   - the dashboard's Wallet connection is `connected`;
   - the computed net amount for the day is greater than zero (the
     container's own "never post a zero" rule — `interest.py`'s
     `if amount <= 0:` guard before it ever calls the post endpoint).
   Any one of these failing for a given day means that day is accrued but
   not posted — visible on the rule's detail page, never silently treated as
   `post_to_provider` having taken effect.
   The posted record uses the same note-marker convention
   (`auto-interest` by default, configurable per rule via `noteMarker`) so it
   looks the same in the Wallet app as a record the container would have
   posted. One visible difference: the container posts `recordDate` as the
   exact moment it ran (e.g. `2026-09-05T05:00:03Z`, whatever `RUN_AT_UTC`
   plus a few seconds of runtime happens to be); the dashboard posts midnight
   UTC of the accrual date (`2026-09-05T00:00:00Z`). Both land on the same
   calendar day in the Wallet app, but if you're comparing timestamps rather
   than dates, expect this shift the day posting cuts over — it is not a
   sign anything is wrong.
5. **Monitor for a few more days.** `Finance › Interests › Rules › [id]`
   shows each day's accrual and whether it posted; `job_runs` (Settings ›
   Administration) shows the `interest_accrual` job's own history, including
   `posted` (accruals actually posted this run), `failed` (an ordinary
   accrual problem — a bad rate, a missing balance) and `postFailed` (a
   post-phase problem specifically, alerted immediately since it can mean
   money already reached Wallet before the local ledger caught up) per run.
6. **Decommission the container** once confident: remove the `wallet-manager`
   service from `Wallet Manager/docker-compose.yml`, its `.env` entries, and
   the `Wallet Manager/data/` volume (`state.json`, `token`, `heartbeat`).
   The dashboard's own ledger (`interest_accruals`, `interest_entries`) is
   now the sole record of this rule's history — nothing in the container's
   `state.json` needs to be migrated, since the dashboard never reads it.

## Rollback

Flip the rule back to `postingMode: "analyze_only"` and restart the
`wallet-manager` container (`docker compose -f ".../Wallet Manager/docker-compose.yml" start wallet-manager`).
Step 3 stops the container before step 4 enables posting, and the two are
never both posting at once, so there is no double-posted day to reconcile
away — restarting the container simply resumes posting from the next day the
container's own `RUN_AT_UTC` schedule fires, using its own `state.json` carry,
which was never touched while it was stopped.

## What a crash leaves behind, and why this procedure avoids relying on it

Posting to Wallet and marking the dashboard's own accrual as posted are two
separate steps (a network call, then a database write). A process crash
between them is possible in principle; the dashboard's own posting adapter
asks Wallet itself for an existing record (the same check `interest.py` uses,
`already_posted_today`) before ever posting again, so a crash there does not
turn into a double-post on the dashboard's next run — see
`.superpowers/sdd/2026-09-05-phase-3-expenses-and-interests/task-19-report.md`
for the full account of that mechanism and what residual risk remains.

This cut-over procedure does not depend on that mechanism anyway: at no point
in steps 1–6 are both the container and the dashboard rule posting at the
same time, so the risk that matters here — the *same* day being posted twice
by two different systems that don't know about each other's note markers —
is structural (stop-then-flip), not a race that has to be tolerated on a
lucky day.
