# F1 Accounts + Overview Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement the Accounts and Overview functionality as specified in §7.1 of `docs/specs/2026-09-13-dev-0.1-design.md`. This includes account management, balance tracking, snapshot functionality, and overview dashboard.

**Architecture:** Modular monolith with domain services in `src/modules/accounts/`, following the pattern established in F0.

## Global Constraints

All tasks implicitly include these:
- Working copy: `/home/mattia/docker/projects/personal-dashboard`, branch `dev-0.1`
- Support folders are read-only and never committed
- Clean repository: no file or code copied from the old version on `main`
- Node >=22.12 with exact dependency versions
- Money: `bigint` cents in Postgres and TypeScript (`Cents`)
- Unknown is `null`, never 0
- Dates: civil dates are `date` / instants are `timestamp({ withTimezone: true })`
- Ids: `uuid().primaryKey().default(sql\`uuidv7()\`)`
- User scoping: every user-owned table has `user_id` and queries use `userScoped(ctx)`
- No network I/O inside a database transaction
- Copy: every user-facing string is in `messages/en.json` and `messages/it.json`

## Task 1: Create Account module schema

- [x] Create account tables in `src/modules/accounts/schema.ts`
- [x] Implement `account_groups`, `accounts`, `balance_entries`, `snapshot_runs` tables
- [x] Add proper foreign key relationships and constraints
- [x] Define all required columns as specified in spec §6.1, §7.1

Migration `drizzle/0002_accounts.sql`. The domain constants live in `rules.ts` and the schema imports
them, so a client component never pulls `drizzle-orm/pg-core` into its bundle. `notifications_log`
(spec §6, platform tier) landed with them: the alerts of §7.1 have nowhere to record what was sent
without it.

## Task 2: Create Account module services

- [x] Implement account creation service (`createAccount`)
- [x] Implement account update service (`updateAccountSettings`)
- [x] Implement account deletion service (`removeAccount`: deletes when nothing depends on it, archives otherwise)
- [x] Implement balance entry management (`saveBalanceEntry`, `deleteBalanceEntry`)
- [x] Implement snapshot run functionality (`runSnapshot`, idempotent, plus the monthly job)
- [x] Add proper error handling and validation (`AccountError`, Zod schemas in `rules.ts`)

## Task 3: Create Account module queries

- [x] Implement account list query (`listAccounts`)
- [x] Implement account detail query (`getAccount`, `accountsView`)
- [x] Implement balance entries query (`listBalanceEntries`)
- [x] Implement snapshot runs query (`listSnapshotRuns`)

## Task 4: Create Account module UI components

- [x] Implement account list page (`/accounts`)
- [x] Implement account detail page (Overview, Transactions, Balance entries, Settings)
- [x] Implement account creation form (`/accounts/new`)
- [x] Implement account settings form
- [x] Implement balance entry management UI

The Transactions tab is an empty state: transactions arrive in F2. `src/ui/chart.tsx` (AreaLine,
MultiLine, Sparkline, CompositionBar) was added — F0 shipped no chart components.

## Task 5: Implement Overview dashboard

- [x] Create overview page with KPI cards
- [x] Implement patrimony tracking (month-end series, 3M · 1Y · All, held forward)
- [x] Add account summary cards (Cash, Investments, Savings)
- [x] Implement snapshot log in Settings (`/settings/data`, with "Take snapshot now")

The **Pockets** KPI of the design is not rendered: pockets arrive in F3 and a tile that could only
ever show `—` would state something untrue. F3 adds the fourth tile.

## Task 6: Implement account sync and import functionality

- [x] Add integration connection management — **deferred to F2**
- [x] Implement provider link functionality — **deferred to F2**
- [x] Add account synchronization logic (the account-side rules of §7.1)

Spec §12 puts the credential vault, the sync engine and Settings › Integrations in **F2**. What §7.1
does own is the lifecycle of a provider's accounts, and that is here and tested:
`reconcileProviderAccounts` (adopt a same-named manual account once, follow a provider rename only
while the local name is untouched, keep an archived account archived, turn a vanished account
`unavailable` and revive it) with `applyProviderAccounts` applying the steps. F2's sync engine
fetches outside the transaction and calls it.

## Task 7: Add account validation and business rules

- [x] Implement account type validation (Zod + Postgres check constraints)
- [x] Add account state management (active, unavailable, archived)
- [x] Add balance validation rules (no future dates, one manual balance per day, manual wins)
- [x] Implement account grouping and sorting (`account_groups`, `sortOrder`, deterministic `ORDER BY`)

## Task 8: Add account alerts and notifications

- [x] Implement low balance alerts
- [x] Add synchronization obsolescence alerts (one constant, `DEFAULT_STALE_AFTER_HOURS = 36`)
- [x] Add account status indicators (Unavailable and Stale badges on the list and the detail header)

`accounts-alerts` runs daily at 12:00 (spec §10.2) and sends through `notifyOnce`, which claims the
slot with a single conditional upsert so two runs cannot both send; a condition that clears has its
record dropped, so the next occurrence is reported at once.

## Task 9: Test implementation

- [x] Unit tests for services (`rules.test.ts`, `ui/display.test.ts`, `ui/chart.test.tsx`)
- [x] Integration tests for database operations (`service.itest.ts`, 32 tests, user isolation included)
- [x] End-to-end tests for UI components (`tests/e2e/accounts.spec.ts` at 1440 px, `mobile.spec.ts` at 400 px)

## Task 10: Documentation and cleanup

- [x] Update README with new features
- [x] Verify all translations are in place (`messages/en.json` and `it.json`, checked by `messages.test.ts`)
- [x] Run final validation checks (`format:check`, `lint`, `typecheck`, unit, integration, e2e, `build`)

## Outcome

Landed on branch `f1-accounts-overview`. Changes to F0 files, all deliberate:

- `messages.test.ts` now reads ICU arguments with a small parser instead of a regex — the old one
  read the words inside a plural's branches as placeholder names, so no message could use a plural.
- Overview's empty state says "No accounts yet" and offers **Add account**; the design's "No data
  yet / Open Settings" assumed accounts could only come from a provider, which stopped being true
  the moment manual accounts existed.
- `housekeeping` also prunes `notifications_log`; the daily tier now has a second job.
- `platform/dates.ts` gained `monthsApart`, the month arithmetic the series need.
