# Phase 5: Funds expansion

> **For agentic workers:** Codex — one task per run, see "How to execute a plan with Codex" in `2026-09-06-phases-5-9-shared-conventions.md`. Claude Code — `superpowers:subagent-driven-development`, one task per subagent. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the legacy single-owner Funds island (`funds`, `fund_settings`, `fund_deposits`, value read from `balance_snapshots`) with a `funds` module: typed contributions with reversals and adjustments, effective-dated contribution schedules implementing the quarterly posting rule, plans (initial capital and fixed monthly amount), reconciliation issues, quarterly and annual views, and a value series read from the fund's linked account. Payroll writes `fund_contributions` instead of `fund_deposits`.

**Architecture:** New module `src/modules/funds/` in the shape of `src/modules/interests/` (flat `UseCaseDeps`, ports, Drizzle + memory repositories, Hono routes, loaders). The legacy `funds` table is renamed `legacy_funds` (its FKs from `fund_settings`/`fund_deposits` follow it) and a new uuid `funds` table takes the name; the legacy tables stay frozen until Phase 9 drops them. Fund value is **not** a new table: a fund links to an `accounts` row (spec §5.5 `account_id`) and reads that account's `account_balances`, which the accounts module already lets the user maintain. The payroll module's `LegacyFundDeposits` port becomes a `FundContributionSink` port implemented by this module.

**Tech stack:** as in the shared conventions. No new npm dependency.

**Spec:** `docs/superpowers/specs/2026-09-02-finance-company-platform-design.md` §5.5 (tables), §5.9 (`reconciliation_issues`), §5.10 (index `fund_contributions (fund_id, posted_month)`), §7.4 (what Funds computes), §11 Phase 5 (exit: "Funds manual without payroll + quarterly posting next month"), §12.7. Predecessor: `docs/superpowers/handoff/2026-09-05-phase-4-checkpoint.md` (Rulings R4-6, R4-10: `fund_contributions` proper is Phase 5's to build).

**Global Constraints:** see `2026-09-06-phases-5-9-shared-conventions.md`. Phase-specific:

- Migration number **`0016`** (`0016_funds.sql`). Verify with `ls drizzle/*.sql` before generating.
- New permissions `funds.read`, `funds.write`. `member` gets both, `viewer` gets `funds.read`.
- `fund_contribution_types` is a static catalogue seeded by the migration: add `"fund_contribution_types"` to `STATIC_TABLES` in `src/test/db.ts` in Task 1 or `resetDb()` will truncate it.
- Contribution amounts are **signed** as stored: `fee` and `reversal` rows are negative, `employee`/`employer`/`voluntary` positive, `adjustment` either. "Deposited" is always Σ signed amounts with `posted_month <= month`.
- The value of a fund is the latest `account_balances` row of its linked account. A fund with no linked account has `value: null` and the UI shows "No valuation account linked", never `0.00`.

## Scope cut (what this plan deliberately does not build)

- `fund_valuations` with units/unit price (spec §5.5): deferred. Value comes from the linked account. If units ever matter, add the table then.
- `delayed` and `matched` reconciliation statuses need a receipt signal the app does not have; only `missing`, `duplicate` and `anomalous` issues are detected. Statuses stay in the CHECK so Phase 9 can use them.
- Growth/allocation charts beyond the value-vs-deposited line chart and the per-quarter table.
- A Management page for contribution types (Phase 9).

## Rulings

- **R5-1 Rename, don't mutate.** `ALTER TABLE funds RENAME TO legacy_funds` keeps every legacy FK working and lets the new `funds` follow platform conventions (uuid id, `user_id`, RLS). `src/lib/db/schema/legacy.ts` exports `legacyFunds` (table `legacy_funds`); `fundSettings`/`fundDeposits` reference it. The seed in `src/lib/db/migrate.ts` targets `legacy_funds` unchanged.
- **R5-2 Posting rule.** `posted_month = addMonths(accrualPeriodEnd, posting_lag_months)` where the accrual period is the schedule period containing the accrual month (quarterly with anchor month 1: Jan–Mar → end `03-01`, lag 1 → `04-01`). This reproduces `creditMonthFor` in `src/lib/calc/cometa.ts` exactly; that file is deleted in Task 6.
- **R5-3 Fees are rows.** `fee_per_posting` on the schedule produces one `fee` contribution (`source = 'system'`, amount `-fee`) per `posted_month` the first time a payroll contribution posts into it (unique partial index). The Cometa joining fee (10.32) is a one-off `fee` row written by the migration script, not a constant anywhere in code.
- **R5-4 Supersession.** When payroll applies a record that supersedes another, the sink deletes the superseded record's contributions (by `payroll_record_id`) and writes the new ones in the same transaction. No reversal rows for supersession — a superseded payslip was a mistake, not a fund event.
- **R5-5 Reconciliation is idempotent.** `reconcileFund` computes the issue set from scratch and upserts `reconciliation_issues` keyed by `(user_id, domain, entity_type, entity_id, kind)` among non-resolved rows, resolving open issues that are no longer detected. Acknowledged issues stay acknowledged.

## What already exists, and what happens to it

| File | Fate |
|---|---|
| `src/lib/db/schema/legacy.ts` `funds`, `fundSettings`, `fundDeposits` | `funds` → `legacyFunds` ("legacy_funds"). Others unchanged, frozen. Task 1. |
| `src/lib/db/migrate.ts:23-40` (seed of fideuram/cometa) | Targets `legacy_funds`. Task 1. |
| `src/lib/repo/funds.ts`, `src/lib/calc/funds.ts`, `src/lib/calc/cometa.ts` (+ tests), `src/app/(app)/finance/_lib/funds.ts`, `_lib/gain.ts`, `src/app/actions/funds.ts`, `src/app/(app)/finance/funds/**` | Deleted in Task 6 after the module UI replaces them. `gain.ts`: check `grep -rn "_lib/gain" src` — delete only if the funds pages are its sole consumer. |
| `src/app/(app)/page.tsx:21,66-94` (`loadFunds`, `totalFundValue`) | Reads `loadFundsSummary()` from the module. Task 6. |
| `src/modules/payroll/application/ports.ts` `LegacyFundDepositInput`, `LegacyFundDeposits`, `UseCaseDeps.funds` | Replaced by `FundContributionSink`. Task 7. |
| `src/modules/payroll/infrastructure/legacy-fund-deposits.ts`, its memory fake, `apply-import.ts:17-32,124-149` | Deleted / rewritten. Task 7. |
| `scripts/validate-paperless-migration.ts` | Template for Task 8's validator. |
| `src/modules/interests/infrastructure/account-balance-lookup.ts` | Template for `ValuationSource`. Task 3. |

## File structure

```
drizzle/0016_funds.sql
src/lib/db/schema/funds.ts                      funds, fundContributionTypes, fundContributionSchedules, fundPlans, fundContributions, reconciliationIssues
src/lib/db/schema/legacy.ts (modify)            funds → legacyFunds
src/lib/db/schema/index.ts (modify)             export * from "./funds"
src/lib/db/funds-rls.itest.ts
src/test/db.ts (modify)                         STATIC_TABLES += fund_contribution_types
src/platform/auth/permissions.ts (modify)       funds.read, funds.write

src/modules/funds/domain/schedule.ts (+test)    accrualPeriodFor, postedMonthFor, effectiveRule
src/modules/funds/domain/totals.ts (+test)      depositedThrough, absoluteReturn, quarterlyRows
src/modules/funds/domain/reconcile.ts (+test)   detectIssues
src/modules/funds/application/ports.ts, deps.ts, errors.ts
src/modules/funds/application/{list-funds,get-fund-detail,create-fund,update-fund,set-schedule,set-plan,add-contribution,reverse-contribution,reconcile-fund}.ts (+tests on memory repos)
src/modules/funds/infrastructure/drizzle-funds-repository.ts, drizzle-contributions-repository.ts, drizzle-schedules-plans-repository.ts, drizzle-issues-repository.ts
src/modules/funds/infrastructure/account-valuation-source.ts, payroll-months-source.ts
src/modules/funds/infrastructure/payroll-contribution-sink.ts (+test), memory-contribution-sink.ts
src/modules/funds/infrastructure/memory-repositories.ts (+test), deps.ts, repositories.itest.ts
src/modules/funds/api/schemas.ts, routes.ts, routes.itest.ts
src/modules/funds/ui/run.ts, deps.ts, load-funds.ts (+test), FundForm.tsx, ContributionForm.tsx, ScheduleForm.tsx, PlanForm.tsx, ContributionsTable.tsx, QuarterTable.tsx
src/app/(app)/finance/funds/page.tsx, [id]/page.tsx, loading.tsx
src/app/actions/funds.ts (rewrite)
scripts/migrate-funds.ts, scripts/validate-funds-migration.ts
docs/deploy/phase-5-runbook.md, docs/superpowers/handoff/2026-09-06-phase-5-checkpoint.md
```

---

### Task 1: Migration 0016 — funds tables, RLS, type catalogue, legacy rename

**Files:**
- Create: `drizzle/0016_funds.sql`, `src/lib/db/schema/funds.ts`, `src/lib/db/funds-rls.itest.ts`
- Modify: `src/lib/db/schema/legacy.ts`, `src/lib/db/schema/index.ts`, `src/lib/db/migrate.ts`, `src/test/db.ts`, `src/platform/auth/permissions.ts`, `src/platform/auth/permissions.test.ts`, `src/modules/payroll/infrastructure/legacy-fund-deposits.ts` (import `legacyFunds`), any `*.itest.ts` that inserts into `funds` (`grep -rln "from(funds)\|insert(funds)\|\bfunds\b" src --include=*.itest.ts`)

**Interfaces — Produces:** the Drizzle tables below and `FundRow`, `FundContributionRow`, `FundScheduleRow`, `FundPlanRow`, `ReconciliationIssueRow` (`$inferSelect` types).

- [x] **Step 1: Rename the legacy table in the schema**

In `src/lib/db/schema/legacy.ts` rename `export const funds = pgTable("funds", …)` to `export const legacyFunds = pgTable("legacy_funds", …)` and change the two `references(() => funds.id)` to `legacyFunds.id`. Rename the type `Fund` to `LegacyFund`. Fix every import (`grep -rn "\bfunds\b" src/modules/payroll src/lib/repo/funds.ts src/lib/db/migrate.ts scripts src/app`). In `migrate.ts` the two raw SQL statements change `funds` to `legacy_funds`. The legacy `src/lib/repo/funds.ts` keeps working against `legacyFunds` until Task 6 deletes it.

- [x] **Step 2: Write the new schema file**

```ts
// src/lib/db/schema/funds.ts
import { check, date, index, integer, jsonb, numeric, pgTable, smallint, text, timestamp, uniqueIndex, uuid, type AnyPgColumn } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { users } from "./identity";
import { accounts } from "./accounts";
import { payrollRecords } from "./payroll";

const tz = (n: string) => timestamp(n, { withTimezone: true, mode: "date" });
const id = () => uuid("id").primaryKey().default(sql`uuidv7()`);
const money = (n: string) => numeric(n, { precision: 16, scale: 2 });

export const funds = pgTable("funds", {
  id: id(),
  userId: uuid("user_id").notNull().references(() => users.id),
  slug: text("slug").notNull(),
  name: text("name").notNull(),
  kind: text("kind").notNull(),
  currency: text("currency").notNull().default("EUR"),
  /** The account whose `account_balances` are this fund's value (spec §5.5). Null = unvalued. */
  accountId: uuid("account_id").references(() => accounts.id),
  status: text("status").notNull().default("active"),
  archivedAt: tz("archived_at"),
  version: integer("version").notNull().default(1),
  createdAt: tz("created_at").notNull().defaultNow(),
  updatedAt: tz("updated_at").notNull().defaultNow(),
}, (t) => [
  check("funds_kind_ck", sql`${t.kind} IN ('pension','investment','savings','other')`),
  check("funds_status_ck", sql`${t.status} IN ('active','archived')`),
  uniqueIndex("funds_user_slug_uq").on(t.userId, t.slug),
]);

/** Static catalogue (spec §5.5). Seeded by the migration; no RLS; in STATIC_TABLES. */
export const fundContributionTypes = pgTable("fund_contribution_types", {
  code: text("code").primaryKey(),
  label: text("label").notNull(),
  /** +1 for inflows, -1 for fees and reversals, 0 for adjustments (either sign). */
  sign: smallint("sign").notNull(),
});

export const fundContributionSchedules = pgTable("fund_contribution_schedules", {
  id: id(),
  fundId: uuid("fund_id").notNull().references(() => funds.id, { onDelete: "cascade" }),
  frequency: text("frequency").notNull(),
  periodAnchorMonth: smallint("period_anchor_month").notNull().default(1),
  postingLagMonths: smallint("posting_lag_months").notNull().default(1),
  feePerPosting: money("fee_per_posting").notNull().default("0.00"),
  effectiveFrom: date("effective_from").notNull(),
  createdAt: tz("created_at").notNull().defaultNow(),
}, (t) => [
  check("fund_schedules_frequency_ck", sql`${t.frequency} IN ('monthly','quarterly','annual')`),
  check("fund_schedules_anchor_ck", sql`${t.periodAnchorMonth} BETWEEN 1 AND 12`),
  check("fund_schedules_lag_ck", sql`${t.postingLagMonths} BETWEEN 0 AND 12`),
  uniqueIndex("fund_schedules_fund_effective_uq").on(t.fundId, t.effectiveFrom),
]);

/** Replaces `fund_settings` (initial capital, fixed monthly amount). Effective-dated. */
export const fundPlans = pgTable("fund_plans", {
  id: id(),
  fundId: uuid("fund_id").notNull().references(() => funds.id, { onDelete: "cascade" }),
  effectiveFrom: date("effective_from").notNull(),
  initialCapital: money("initial_capital").notNull().default("0.00"),
  fixedMonthlyAmount: money("fixed_monthly_amount"),
  note: text("note"),
  createdAt: tz("created_at").notNull().defaultNow(),
}, (t) => [uniqueIndex("fund_plans_fund_effective_uq").on(t.fundId, t.effectiveFrom)]);

export const fundContributions = pgTable("fund_contributions", {
  id: id(),
  fundId: uuid("fund_id").notNull().references(() => funds.id, { onDelete: "cascade" }),
  typeCode: text("type_code").notNull().references(() => fundContributionTypes.code),
  accrualPeriodStart: date("accrual_period_start").notNull(),
  accrualPeriodEnd: date("accrual_period_end").notNull(),
  postedMonth: date("posted_month").notNull(),
  valueDate: date("value_date"),
  amount: money("amount").notNull(),
  currency: text("currency").notNull().default("EUR"),
  source: text("source").notNull(),
  payrollRecordId: uuid("payroll_record_id").references(() => payrollRecords.id),
  note: text("note"),
  reversesId: uuid("reverses_id").references((): AnyPgColumn => fundContributions.id),
  reconciliationStatus: text("reconciliation_status").notNull().default("received"),
  version: integer("version").notNull().default(1),
  createdAt: tz("created_at").notNull().defaultNow(),
  updatedAt: tz("updated_at").notNull().defaultNow(),
}, (t) => [
  check("fund_contributions_source_ck", sql`${t.source} IN ('manual','payroll','system','migration')`),
  check("fund_contributions_recon_ck", sql`${t.reconciliationStatus} IN ('expected','received','matched','missing','delayed','duplicate','anomalous')`),
  check("fund_contributions_period_ck", sql`${t.accrualPeriodStart} <= ${t.accrualPeriodEnd}`),
  index("fund_contributions_fund_posted_idx").on(t.fundId, t.postedMonth),
  uniqueIndex("fund_contributions_payroll_uq").on(t.fundId, t.typeCode, t.payrollRecordId).where(sql`payroll_record_id IS NOT NULL`),
  uniqueIndex("fund_contributions_system_fee_uq").on(t.fundId, t.postedMonth).where(sql`type_code = 'fee' AND source = 'system'`),
]);

export const reconciliationIssues = pgTable("reconciliation_issues", {
  id: id(),
  userId: uuid("user_id").notNull().references(() => users.id),
  domain: text("domain").notNull(),
  entityType: text("entity_type").notNull(),
  entityId: text("entity_id").notNull(),
  kind: text("kind").notNull(),
  severity: text("severity").notNull().default("warning"),
  detail: jsonb("detail").notNull().default({}),
  status: text("status").notNull().default("open"),
  resolvedBy: uuid("resolved_by"),
  resolvedAt: tz("resolved_at"),
  createdAt: tz("created_at").notNull().defaultNow(),
  updatedAt: tz("updated_at").notNull().defaultNow(),
}, (t) => [
  check("reconciliation_issues_severity_ck", sql`${t.severity} IN ('info','warning','error')`),
  check("reconciliation_issues_status_ck", sql`${t.status} IN ('open','acknowledged','resolved')`),
  uniqueIndex("reconciliation_issues_live_uq").on(t.userId, t.domain, t.entityType, t.entityId, t.kind).where(sql`status <> 'resolved'`),
  index("reconciliation_issues_user_status_idx").on(t.userId, t.status),
]);

export type FundRow = typeof funds.$inferSelect;
export type FundScheduleRow = typeof fundContributionSchedules.$inferSelect;
export type FundPlanRow = typeof fundPlans.$inferSelect;
export type FundContributionRow = typeof fundContributions.$inferSelect;
export type ReconciliationIssueRow = typeof reconciliationIssues.$inferSelect;
```

Add `export * from "./funds";` to `schema/index.ts`.

- [x] **Step 3: Generate, rename, append the hand-written SQL**

Run `npm run db:generate`, rename the output and journal tag to `drizzle/0016_funds.sql`. Because the final schema still contains `funds`, drizzle-kit 0.31 does not offer a rename: replace its generated `CREATE TABLE legacy_funds` and in-place alterations of `funds` with `ALTER TABLE "funds" RENAME TO "legacy_funds"`, rename the retained primary-key/unique/FK constraints to match the snapshot, and create the new uuid `funds` table before adding its foreign keys. Keep the generated final snapshot. Never cast the legacy smallint ids to uuid or drop legacy data. Then append, one per `--> statement-breakpoint`:

```sql
INSERT INTO fund_contribution_types (code, label, sign) VALUES
  ('employee','Employee contribution',1), ('employer','Employer contribution',1), ('voluntary','Voluntary contribution',1),
  ('adjustment','Adjustment',0), ('reversal','Reversal',-1), ('fee','Fee',-1)
ON CONFLICT (code) DO NOTHING;
--> statement-breakpoint
ALTER TABLE funds ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE funds FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY funds_owner ON funds
  USING (app_is_system() OR user_id = app_current_user_id())
  WITH CHECK (app_is_system() OR user_id = app_current_user_id());
--> statement-breakpoint
ALTER TABLE reconciliation_issues ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE reconciliation_issues FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY reconciliation_issues_owner ON reconciliation_issues
  USING (app_is_system() OR user_id = app_current_user_id())
  WITH CHECK (app_is_system() OR user_id = app_current_user_id());
```

Then for each of `fund_contribution_schedules`, `fund_plans`, `fund_contributions` the same ENABLE/FORCE pair plus:

```sql
CREATE POLICY <table>_owner ON <table>
  USING (app_is_system() OR EXISTS (SELECT 1 FROM funds f WHERE f.id = <table>.fund_id AND f.user_id = app_current_user_id()))
  WITH CHECK (app_is_system() OR EXISTS (SELECT 1 FROM funds f WHERE f.id = <table>.fund_id AND f.user_id = app_current_user_id()));
```

`fund_contribution_types` gets no RLS (static catalogue, like `integration_providers`).

- [x] **Step 4: Permissions and the static-table list**

`permissions.ts`: add `"funds.read"`, `"funds.write"` after `"accounts.delete"`; `member` gets both, `viewer` gets `funds.read`. Update `permissions.test.ts` expectations. `src/test/db.ts`: `STATIC_TABLES = ["integration_providers", "fund_contribution_types"]`.

- [x] **Step 5: RLS and uniqueness proofs**

Write `src/lib/db/funds-rls.itest.ts` by copying `src/lib/db/interests-rls.itest.ts` with these cases:
1. User A sees only A's funds; system sees all; no context sees none.
2. A contribution inserted under A's fund is invisible to B via `withUserContext(db, { userId: b.id })` (the `EXISTS` policy), and B cannot insert a contribution pointing at A's fund (expect rejection: `err.cause.message` contains `row-level security`).
3. Second `(fund_id, type_code, payroll_record_id)` rejects with `fund_contributions_payroll_uq`.
4. Second system fee for the same `(fund_id, posted_month)` rejects with `fund_contributions_system_fee_uq`.
5. Second open issue with the same key rejects with `reconciliation_issues_live_uq`; after the first is `resolved`, a new open one inserts.

- [x] **Verify:** `npm run typecheck && npm test && npm run test:db:up && npm run test:integration`. Expected: green; the payroll itests still pass with `legacyFunds`.
- [x] **Commit:** `git add drizzle src/lib/db src/test/db.ts src/platform/auth src/modules/payroll scripts src/lib/repo && git commit -m "feat(funds): migration 0016 — funds, schedules, plans, contributions, reconciliation issues"`

### Deviation

- 2026-09-06, Task 1 Step 3: observed `npm run db:generate` create `legacy_funds` and alter the existing `funds.id` to uuid without a rename prompt. Step 3 now requires correcting the generated SQL to the R5-1 rename-and-create sequence, including constraint renames (the retained `funds_pkey` otherwise collides with the new table). The final generated snapshot remains authoritative. Verify this migration on populated legacy rows as well as with the integration suite.
- Run `graphify update .` after this task as required by the root AGENTS.md, which takes precedence over the shared convention of updating only at phase exit.

### Execution record — 2026-09-06

Task 1 implemented; not deployed. Tasks 2–9 remain pending, following the one-task-per-Codex-run convention.

- `npm run typecheck`: passed.
- `npm test`: 123 files, 1,184 tests passed.
- `npm run test:db:up && npm run test:integration`: 40 files, 193 tests passed, including seven new Funds tests and the legacy Payroll bridge tests.
- Red/green evidence: the new permissions test failed before the permission changes; all seven new integration cases failed on the pre-0016 schema and passed after migration.
- Populated migration proof: a separate disposable test database was migrated through 0015, seeded with two legacy funds, settings and deposits, then migrated through 0016. Every existing row was preserved, both FKs still reference `legacy_funds`, an additional legacy deposit inserted successfully, new `funds` remained empty, and six contribution types were seeded. The disposable database was removed afterward.
- A second `npm run db:generate` reported no schema changes.
- `graphify update .`: completed. SQL extraction remains unavailable because `tree_sitter_sql` is not installed; 21 JSON/config sources yielded no nodes. This AST update does not semantically refresh planning documents.

---

## Execution rulings (full-phase run)

The user authorized completing Tasks 2–9 and redeploying in this execution, overriding one-task-per-run. Follow the detailed ledger in `.superpowers/sdd/2026-09-06-phase-5-funds/progress.md`.

- R5-C1: `ContributionLike` includes `accrualPeriodEnd`. Posting follows spec §7.4 (quarter end +1). The old display used +2; migration validation must explicitly prove both timelines, reporting this intentional timing change rather than claiming exact monthly display parity.
- R5-C2: opening capital becomes an auditable adjustment contribution, using the earliest legacy setting. Creating a first manual plan also records its opening capital; later planning changes do not silently rewrite contributions. Fixed monthly amount is planning, not proof of payment.
- R5-C3: reversals negate original amounts, including positive reversals of negative fees. Rows linked to payroll remain payroll provenance when migrated with `source=migration`.

### Task 2: Domain — schedule, totals, reconciliation

**Files:** Create `src/modules/funds/domain/schedule.ts` (+`.test.ts`), `totals.ts` (+`.test.ts`), `reconcile.ts` (+`.test.ts`).

**Interfaces — Produces:**
```ts
// schedule.ts
export interface ScheduleRule { frequency: "monthly" | "quarterly" | "annual"; periodAnchorMonth: number; postingLagMonths: number; feePerPosting: string }
export interface AccrualPeriod { start: string; end: string } // "YYYY-MM-01" month keys; end = first day of the period's last month
export function accrualPeriodFor(month: string, rule: ScheduleRule): AccrualPeriod;
export function postedMonthFor(month: string, rule: ScheduleRule): string;
export function effectiveRule<T extends { effectiveFrom: string }>(rules: readonly T[], month: string): T | null; // latest effectiveFrom <= month, else null
// totals.ts
export interface ContributionLike { id: string; typeCode: string; amount: string; postedMonth: string; accrualPeriodStart: string; accrualPeriodEnd: string; payrollAccrualMonth?: string; source: string; payrollRecordId: string | null; reversesId?: string | null }
export function depositedThrough(rows: readonly ContributionLike[], month: string): string; // Σ amount where postedMonth <= month; "0.00" if none
export function absoluteReturn(value: string | null, deposited: string): string | null;    // value − deposited; null when value is null
export interface QuarterRow { quarter: string; accrualMonths: string[]; postedMonth: string; gross: string; fees: string; net: string; posted: boolean }
export function quarterlyRows(rows: readonly ContributionLike[], today: string): QuarterRow[]; // grouped by exact accrual span + postedMonth; posted = postedMonth <= today; ascending
// reconcile.ts
export type IssueKind = "missing" | "duplicate" | "anomalous";
export interface DetectedIssue { kind: IssueKind; entityType: "fund_month" | "fund_contribution"; entityId: string; severity: "warning" | "error"; detail: Record<string, unknown> }
export function detectIssues(input: { fundId: string; payrollMonths: readonly string[]; rows: readonly ContributionLike[]; medianWindow?: number; tolerance?: number }): DetectedIssue[];
```

- [x] **Step 1: Tests first** — `schedule.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { accrualPeriodFor, effectiveRule, postedMonthFor } from "./schedule";
const q = { frequency: "quarterly" as const, periodAnchorMonth: 1, postingLagMonths: 1, feePerPosting: "3.00" };
describe("quarterly posting rule (spec §7.4, R5-2)", () => {
  it("posts the March quarter in April", () => {
    expect(accrualPeriodFor("2026-03-01", q)).toEqual({ start: "2026-01-01", end: "2026-03-01" });
    expect(postedMonthFor("2026-01-01", q)).toBe("2026-04-01");
    expect(postedMonthFor("2026-03-01", q)).toBe("2026-04-01");
  });
  it("posts Q4 in January of the next year", () => { expect(postedMonthFor("2025-12-01", q)).toBe("2026-01-01"); });
  it("honours an anchor month: quarters starting in February", () => {
    expect(accrualPeriodFor("2026-01-01", { ...q, periodAnchorMonth: 2 })).toEqual({ start: "2025-11-01", end: "2026-01-01" });
  });
  it("monthly with lag 0 posts in the accrual month", () => {
    expect(postedMonthFor("2026-05-01", { ...q, frequency: "monthly", postingLagMonths: 0 })).toBe("2026-05-01");
  });
  it("annual with anchor 1 posts the whole year in January + lag", () => {
    expect(postedMonthFor("2026-07-01", { ...q, frequency: "annual" })).toBe("2027-01-01");
  });
  it("picks the latest rule effective at the month, or null", () => {
    const rules = [{ effectiveFrom: "2026-01-01", n: 1 }, { effectiveFrom: "2026-06-01", n: 2 }];
    expect(effectiveRule(rules, "2026-05-01")?.n).toBe(1);
    expect(effectiveRule(rules, "2026-06-01")?.n).toBe(2);
    expect(effectiveRule(rules, "2025-12-01")).toBeNull();
  });
});
```

`totals.test.ts`:
- `depositedThrough` sums only rows with `postedMonth <= month`, includes negative fee rows, returns `"0.00"` for no rows, and is exact (`"0.10"` + `"0.20"` → `"0.30"`).
- `absoluteReturn("2228.13", "2184.06")` → `"44.07"`; `absoluteReturn(null, "10.00")` → `null`.
- `quarterlyRows`: three 2026-Q1 employee/employer rows (`accrualPeriodStart = "2026-01-01"`, `postedMonth = "2026-04-01"`) plus the Q1 system fee produce one row `{ quarter: "2026-Q1", gross: "821.41", fees: "-3.00", net: "818.41", postedMonth: "2026-04-01" }`; `posted` is `true` for `today = "2026-04-01"` and `false` for `"2026-03-01"`; rows ascend by quarter.

`reconcile.test.ts`:
- `missing`: `payrollMonths = ["2026-01-01", "2026-02-01"]`, rows only for January → one issue `{ kind: "missing", entityType: "fund_month", entityId: "<fundId>:2026-02-01", severity: "warning" }`.
- `duplicate`: two `employee` rows with the same `payrollRecordId` → one `duplicate` issue on the later row's id, severity `error`.
- `anomalous`: six months of `"250.00"` then one `"900.00"` → `anomalous` on that row with `detail: { amount: "900.00", median: "250.00", tolerance: 0.3 }`; a seventh month of `"260.00"` → no issue. Fee and reversal rows are excluded from the band.
- No payroll months and no rows → `[]`.

- [x] **Step 2: Run** `npm test -- modules/funds/domain` → fails (modules missing).

- [x] **Step 3: Implement.** Use `addMonths` from `@/lib/time`. Money arithmetic in integer cents via `BigInt` — copy the `cents()`/formatting helper from `src/modules/payroll/domain/money.ts` into `totals.ts` (do not import the `Number`-based `toCents`). Core of `schedule.ts`:

```ts
const MONTHS: Record<ScheduleRule["frequency"], number> = { monthly: 1, quarterly: 3, annual: 12 };
export function accrualPeriodFor(month: string, rule: ScheduleRule): AccrualPeriod {
  const len = MONTHS[rule.frequency];
  if (len === 1) return { start: month, end: month };
  const m = Number(month.slice(5, 7)); // calendar arithmetic only, never money
  const offset = (((m - rule.periodAnchorMonth) % len) + len) % len;
  const start = addMonths(month, -offset);
  return { start, end: addMonths(start, len - 1) };
}
export function postedMonthFor(month: string, rule: ScheduleRule): string {
  return addMonths(accrualPeriodFor(month, rule).end, rule.postingLagMonths);
}
export function effectiveRule<T extends { effectiveFrom: string }>(rules: readonly T[], month: string): T | null {
  return [...rules].filter((r) => r.effectiveFrom <= month).sort((a, b) => (a.effectiveFrom < b.effectiveFrom ? 1 : -1))[0] ?? null;
}
```

`detectIssues`: per `typeCode`, median (in cents) of the last `medianWindow` (default 6) positive payroll-provenance rows before the row under test; `anomalous` when `|amount − median| > tolerance × median` (default `0.3`); `missing` for each payroll month with no payroll-provenance row whose enriched `payrollAccrualMonth` exactly matches the month, falling back to `accrualPeriodStart <= month <= accrualPeriodEnd` only when enrichment is unavailable; `duplicate` for a second row with the same `(typeCode, payrollRecordId)`. A payroll-linked migration row has payroll provenance; system fees and reversals do not. Deterministic order: missing (by month), duplicate (by id), anomalous (by id).

- [x] **Verify:** `npm test -- modules/funds/domain` green; `npm run typecheck`.
- [x] **Commit:** `git add src/modules/funds/domain && git commit -m "feat(funds): domain — posting schedule, totals, reconciliation"`

### Deviation — Task 2

`ContributionLike` gains optional `payrollAccrualMonth`. A quarterly contribution's stored accrual span identifies its posting period, not the single payslip that produced it; treating that span as evidence for every payroll month hides missing payslips. Reconciliation therefore uses exact equality when callers enrich a linked contribution from its payroll record, uses that month to order anomaly history, and retains the span check only as a compatibility fallback for unenriched migration rows. `quarterlyRows` groups by the complete stored period span plus posting month so annual periods expose all accrued months and delayed postings do not merge.

---

### Task 3: Ports, memory and Drizzle repositories, valuation and payroll sources

**Files:** Create `src/modules/funds/application/ports.ts`, `deps.ts`, `errors.ts`; `src/modules/funds/infrastructure/memory-repositories.ts` (+`.test.ts`), `drizzle-funds-repository.ts`, `drizzle-contributions-repository.ts`, `drizzle-schedules-plans-repository.ts`, `drizzle-issues-repository.ts`, `account-valuation-source.ts`, `payroll-months-source.ts`, `deps.ts`, `repositories.itest.ts`.

**Interfaces — Produces** (`ports.ts`; field types follow the schema rows, dates as `"YYYY-MM-DD"` strings, money as strings):
```ts
export type FundKind = "pension" | "investment" | "savings" | "other";
export type FundStatus = "active" | "archived";
export type ContributionTypeCode = "employee" | "employer" | "voluntary" | "adjustment" | "reversal" | "fee";
export type ContributionSource = "manual" | "payroll" | "system" | "migration";
export type ReconciliationStatus = "expected" | "received" | "matched" | "missing" | "delayed" | "duplicate" | "anomalous";
export interface Fund { id: string; userId: string; slug: string; name: string; kind: FundKind; currency: string; accountId: string | null; status: FundStatus; archivedAt: Date | null; version: number; createdAt: Date; updatedAt: Date }
export type NewFund = Pick<Fund, "userId" | "slug" | "name" | "kind" | "currency" | "accountId">;
export type FundPatch = Partial<Pick<Fund, "name" | "kind" | "accountId" | "status" | "archivedAt">>;
export interface FundSchedule { id: string; fundId: string; frequency: "monthly" | "quarterly" | "annual"; periodAnchorMonth: number; postingLagMonths: number; feePerPosting: string; effectiveFrom: string; createdAt: Date }
export interface FundPlan { id: string; fundId: string; effectiveFrom: string; initialCapital: string; fixedMonthlyAmount: string | null; note: string | null; createdAt: Date }
export interface FundContribution { id: string; fundId: string; typeCode: ContributionTypeCode; accrualPeriodStart: string; accrualPeriodEnd: string; postedMonth: string; valueDate: string | null; amount: string; currency: string; source: ContributionSource; payrollRecordId: string | null; note: string | null; reversesId: string | null; reconciliationStatus: ReconciliationStatus; version: number; createdAt: Date; updatedAt: Date }
export type NewFundContribution = Omit<FundContribution, "id" | "version" | "createdAt" | "updatedAt">;
export interface ReconciliationIssue { id: string; userId: string; domain: string; entityType: string; entityId: string; kind: string; severity: "info" | "warning" | "error"; detail: Record<string, unknown>; status: "open" | "acknowledged" | "resolved"; resolvedBy: string | null; resolvedAt: Date | null; createdAt: Date; updatedAt: Date }

export interface FundsRepository {
  list(userId: string, opts?: { includeArchived?: boolean }): Promise<Fund[]>;            // name asc
  get(userId: string, id: string): Promise<Fund | null>;
  lock(userId: string, id: string): Promise<Fund | null>; // SELECT FOR UPDATE; serialize financial writes in caller transaction
  getBySlug(userId: string, slug: string): Promise<Fund | null>;
  create(input: NewFund): Promise<Fund>;
  update(userId: string, id: string, expectedVersion: number, patch: FundPatch): Promise<Fund | null>; // null = not found; throws VersionMismatchError
}
export interface SchedulesRepository { listForFund(fundId: string): Promise<FundSchedule[]>; add(input: Omit<FundSchedule, "id" | "createdAt">): Promise<FundSchedule> } // effectiveFrom asc; add upserts on (fundId, effectiveFrom)
export interface PlansRepository { listForFund(fundId: string): Promise<FundPlan[]>; add(input: Omit<FundPlan, "id" | "createdAt">): Promise<FundPlan> }
export interface ContributionsRepository {
  listForFund(fundId: string, opts?: { from?: string; to?: string }): Promise<FundContribution[]>; // accrualPeriodStart asc, id asc; from/to inclusive on postedMonth
  get(fundId: string, id: string): Promise<FundContribution | null>;
  create(input: NewFundContribution): Promise<FundContribution>;
  deleteByPayrollRecord(fundId: string, payrollRecordId: string): Promise<number>;
  hasSystemFee(fundId: string, postedMonth: string): Promise<boolean>;
}
export interface IssuesRepository {
  listOpen(userId: string, domain: string, entityIdPrefix?: string): Promise<ReconciliationIssue[]>; // open + acknowledged, createdAt asc
  upsertOpen(input: Pick<ReconciliationIssue, "userId" | "domain" | "entityType" | "entityId" | "kind" | "severity" | "detail">): Promise<ReconciliationIssue>; // keeps status if acknowledged, refreshes detail/severity
  resolveMissing(userId: string, domain: string, entityIdPrefix: string, keep: readonly { entityType: string; entityId: string; kind: string }[], by: string | null, at: Date): Promise<number>;
  setStatus(userId: string, id: string, status: "acknowledged" | "resolved", by: string, at: Date): Promise<ReconciliationIssue | null>;
}
export interface ValuationSource {
  latest(userId: string, accountId: string): Promise<{ asOf: string; balance: string } | null>;
  monthly(userId: string, accountId: string): Promise<{ month: string; balance: string }[]>; // "YYYY-MM-01", last balance of each month, asc
}
export interface PayrollMonthsSource { liveMonths(userId: string): Promise<string[]>; liveRecords(userId: string): Promise<{ id: string; month: string }[]> } // period_start of live ordinary payroll_records as "YYYY-MM-01", asc
export interface AccountLinkSource { get(userId: string, accountId: string): Promise<{ currency: string } | null> }
export interface Clock { now(): Date }
export interface UseCaseDeps { accountLinks: AccountLinkSource; funds: FundsRepository; schedules: SchedulesRepository; plans: PlansRepository; contributions: ContributionsRepository; issues: IssuesRepository; valuations: ValuationSource; payrollMonths: PayrollMonthsSource; clock: Clock; audit: (e: AuditInput) => Promise<void> }
```
`AuditInput` comes from `@/platform/audit/record`. `errors.ts`: `NotFoundError`, `VersionMismatchError`, `InvalidInputError(message, issues?)` — copy `src/modules/interests/application/errors.ts`.

- [x] **Step 1: Memory repositories + unit test.** Mirror `src/modules/interests/infrastructure/memory-repositories.ts` (`monotonicId`, `definedEntries`, `normalizeScale(…, 2)` on every money field). `memory-repositories.test.ts`: `list` ordering, `update` bumps `version` and throws `VersionMismatchError` on a stale version, `deleteByPayrollRecord` returns the count, `hasSystemFee`, `upsertOpen` keeps `acknowledged`, `resolveMissing` resolves only issues not in `keep`.

- [x] **Step 2: Drizzle repositories.** Mirror `src/modules/interests/infrastructure/drizzle-interest-rules-repository.ts`: every query carries the `user_id`/`fund_id` predicate in addition to RLS. `update` does `UPDATE … WHERE id = ? AND user_id = ? AND version = ?`; when zero rows change, re-read to distinguish not-found (`null`) from `VersionMismatchError`. `upsertOpen` uses `onConflictDoUpdate` targeting the columns of `reconciliation_issues_live_uq` with `targetWhere: sql\`status <> 'resolved'\`` and `set: { detail, severity, updatedAt }` (status untouched).

- [x] **Step 3: Sources.** `account-valuation-source.ts`: copy the query shape of `src/modules/interests/infrastructure/account-balance-lookup.ts`; `monthly()` is `SELECT DISTINCT ON (date_trunc('month', as_of)) date_trunc('month', as_of) AS month, balance FROM account_balances WHERE account_id = ? ORDER BY 1, as_of DESC` joined to `accounts.user_id = ?`. `payroll-months-source.ts`: `SELECT period_start FROM payroll_records WHERE user_id = ? AND kind = 'ordinary' AND superseded_at IS NULL ORDER BY period_start`, mapped through `monthKeyOf`.

- [x] **Step 4: `deps.ts`** — `fundDeps(tx: DbClient, requestId?: string | null): UseCaseDeps`, exactly like `interestDeps`.

- [x] **Step 5: `repositories.itest.ts`** — for each repository run the **same** assertions against the memory and the Drizzle implementations (`describe.each`): ordering of `list`/`listForFund`, `from`/`to` filter on `postedMonth`, `update` version behaviour, `deleteByPayrollRecord` count, `hasSystemFee`, `upsertOpen`/`resolveMissing`. One Drizzle-only case: user B cannot `get` user A's fund by id.

- [x] **Verify:** `npm run typecheck && npm test -- modules/funds && npm run test:integration -- modules/funds`.
- [x] **Commit:** `git add src/modules/funds && git commit -m "feat(funds): ports, repositories, valuation and payroll sources"`

---

### Deviation — Task 3

Add `FundsRepository.lock(userId,id)` and an owner-scoped `AccountLinkSource` to deps. Parent row locks serialize reversals, opening contributions, schedule updates and payroll fees within the existing transaction. Account linking must reject another user's account and a currency mismatch before persisting the fund. Cover lock ownership and account lookup in repository tests. Use `FOR NO KEY UPDATE` if ordinary FK writes require compatible key-share locks; document the choice.

### Task 4: Use cases

**Files:** Create in `src/modules/funds/application/`: `list-funds.ts`, `get-fund-detail.ts`, `create-fund.ts`, `update-fund.ts`, `set-schedule.ts`, `set-plan.ts`, `add-contribution.ts`, `reverse-contribution.ts`, `reconcile-fund.ts`, `acknowledge-issue.ts`, each with a `.test.ts` over the memory repositories and `testPrincipal()`.

**Interfaces — Produces:**
```ts
export interface FundSummary { fund: Fund; value: string | null; valueAsOf: string | null; deposited: string; absReturn: string | null; lastContributionMonth: string | null; openIssues: number }
listFunds(deps)(principal, opts?: { includeArchived?: boolean }): Promise<FundSummary[]>                   // funds.read
export interface FundDetail extends FundSummary { plan: FundPlan | null; schedule: FundSchedule | null; plans: FundPlan[]; schedules: FundSchedule[]; contributions: FundContribution[]; quarters: QuarterRow[]; valueSeries: { month: string; value: string; deposited: string }[]; issues: ReconciliationIssue[] }
getFundDetail(deps)(principal, id: string): Promise<FundDetail>                                            // funds.read; NotFoundError
createFund(deps)(principal, input: { slug: string; name: string; kind: FundKind; currency?: string; accountId?: string | null }): Promise<Fund>  // funds.write; slug /^[a-z0-9-]{2,40}$/ else InvalidInputError; duplicate slug → InvalidInputError
updateFund(deps)(principal, id: string, expectedVersion: number, patch: FundPatch): Promise<Fund>          // funds.write; status "archived" sets archivedAt = clock.now()
setSchedule(deps)(principal, fundId: string, input: Omit<FundSchedule, "id" | "fundId" | "createdAt">): Promise<FundSchedule>  // funds.write
setPlan(deps)(principal, fundId: string, input: Omit<FundPlan, "id" | "fundId" | "createdAt">): Promise<FundPlan>              // funds.write
addContribution(deps)(principal, fundId: string, input: { typeCode: Exclude<ContributionTypeCode, "reversal">; accrualMonth: string; amount: string; valueDate?: string | null; note?: string | null; postedMonth?: string }): Promise<FundContribution>
   // funds.write; source "manual"; postedMonth defaults to postedMonthFor(accrualMonth, effectiveRule(schedules, accrualMonth)) or accrualMonth when no schedule; sign checked against the type (fee < 0; employee/employer/voluntary > 0; adjustment ≠ 0) else InvalidInputError
reverseContribution(deps)(principal, fundId: string, contributionId: string, note?: string | null): Promise<FundContribution>  // typeCode "reversal", amount = −original, reversesId, same postedMonth/accrual period; reversing a reversal or an already-reversed row → InvalidInputError
reconcileFund(deps)(principal, fundId: string): Promise<{ detected: DetectedIssue[]; resolved: number }>  // funds.write; domain "funds", entityId prefix `${fundId}:`
acknowledgeIssue(deps)(principal, issueId: string): Promise<ReconciliationIssue>                          // funds.write
```

- [x] **Step 1: Tests first.** One `describe` per use case. Minimum cases: a `viewer` principal gets `PermissionDeniedError` on every write; `getFundDetail` returns `value: null` for a fund without `accountId`, and each `valueSeries` entry carries `deposited = depositedThrough(rows, month)`; `addContribution` computes `postedMonth` from the effective schedule (`2026-02-01` accrual, quarterly lag 1 → `2026-04-01`) and rejects a positive `fee`; `reverseContribution` flips the sign and links `reversesId`; `reconcileFund` resolves an issue that disappeared after a contribution was added; every mutation records an audit row with `action` `funds.fund_created` / `funds.fund_updated` / `funds.schedule_set` / `funds.plan_set` / `funds.contribution_added` / `funds.contribution_reversed` / `funds.reconciled` / `funds.issue_acknowledged`.

- [x] **Step 2: Implement** each use case in the curried shape of `src/modules/interests/application/create-interest-rule.ts`. `getFundDetail.valueSeries`: months = union of `valuations.monthly()` months and contribution `postedMonth`s, sorted; `value` carried forward from the last known balance inside the series only (months before the first balance are omitted, never zero). `listFunds` calls `valuations.latest` per fund with an `accountId`.

- [x] **Verify:** `npm test -- modules/funds/application`; `npm run typecheck`.
- [x] **Commit:** `git add src/modules/funds/application && git commit -m "feat(funds): use cases"`

---

### Deviation — Task 4

R5-C7: reconciliation expectations are fund-specific. Extend `PayrollMonthsSource` with `expectedMonths(userId, fundSlug)`, selecting live ordinary payroll records with a component mapped to that fund; unrelated payroll must not generate missing contributions for manual funds. Extend `liveRecords(userId, includeExtraordinary = false)` and request all live records for exact contribution-month enrichment, so extraordinary quarterly rows cannot mask missing ordinary months. Preserve the ordinary default and test both cases.

Apply R5-C2/C4/C6: validate inputs in use cases (including owner/currency account links, actual month/date anchors, signed decimal bounds and schedule fees), not only routes. Lock the owner-scoped fund before plan/schedule/contribution/reversal/reconciliation mutations. The first plan writes its nonzero opening capital as an `adjustment` contribution dated `effectiveFrom` and records that link in the audit; later plans remain planning changes. Enrich reconciliation rows from `payrollMonths.liveRecords`; qualify persisted contribution issue ids with `${fundId}:` so list/resolve-by-prefix works for every issue type. Preserve acknowledged issues. Test positive fee reversal, repeated reversal rejection, opening capital once, invalid/foreign account and currency mismatch, viewer denial and audit behavior.

### Task 5: REST API

**Files:** Create `src/modules/funds/api/schemas.ts`, `routes.ts`, `routes.itest.ts`. Modify `src/platform/http/app.ts` (`registerFundRoutes` in `registerAllRoutes`), `docs/api/openapi.json` (generated), `docs/api/README.md` (a "Funds" section).

**Routes** (all `security: [{ session: [] }]`, tag `Funds`):

| Method | Path | Use case | Notes |
|---|---|---|---|
| GET | `/funds` | `listFunds` | `?includeArchived=true` |
| POST | `/funds` | `createFund` | 201 |
| GET | `/funds/{id}` | `getFundDetail` | |
| PATCH | `/funds/{id}` | `updateFund` | `If-Match`/`version`, 409 |
| POST | `/funds/{id}/schedules` | `setSchedule` | 201 |
| POST | `/funds/{id}/plans` | `setPlan` | 201 |
| GET | `/funds/{id}/contributions` | `getFundDetail(...).contributions` filtered by `from`/`to` | `{ items, nextCursor: null }` |
| POST | `/funds/{id}/contributions` | `addContribution` | **idempotency middleware**, 201 |
| POST | `/funds/{id}/contributions/{cid}/reverse` | `reverseContribution` | **idempotency middleware**, 201 |
| POST | `/funds/{id}/reconcile` | `reconcileFund` | 200 `{ detected, resolved }` |
| POST | `/funds/issues/{issueId}/acknowledge` | `acknowledgeIssue` | 200 |

- [x] **Step 1: Schemas.** `FundSchema`, `FundSummarySchema`, `FundDetailSchema`, `FundScheduleSchema`, `FundPlanSchema`, `FundContributionSchema`, `ReconciliationIssueSchema`, `CreateFundRequestSchema`, `UpdateFundRequestSchema`, `SetScheduleRequestSchema`, `SetPlanRequestSchema`, `AddContributionRequestSchema` (`amount: z.string().regex(/^-?\d{1,14}(\.\d{1,2})?$/)`), `ReconcileResultSchema`. DTO functions pick fields explicitly; `userId` never reaches the wire.

- [x] **Step 2: Routes** mirroring `src/modules/interests/api/routes.ts` (`errorResponse`, `commonErrorResponses`, `toApiError` mapping `NotFoundError`→404, `VersionMismatchError`→409, `InvalidInputError`→422). Register the two idempotency middlewares with `app.on("POST", …)` before the `app.openapi(...)` calls, exactly as `src/modules/accounts/api/routes.ts:351-352`.

- [x] **Step 3: `routes.itest.ts`** copying the harness of `src/modules/accounts/api/routes.itest.ts`: create → get → add contribution with `Idempotency-Key` (replaying the same key returns the same body and creates no second row) → reverse → PATCH with a stale version → 409 → a viewer gets 403 on POST → reconcile on a clean fund returns `{ detected: [], resolved: 0 }`.

- [x] **Step 4:** `npm run openapi:generate`; add the "Funds" section to `docs/api/README.md`.
- [x] **Verify:** `npm run typecheck && npm test && npm run test:integration -- funds`.
- [x] **Commit:** `git add src/modules/funds/api src/platform/http/app.ts docs/api && git commit -m "feat(funds): REST API"`

---

### Task 6: UI — Funds list and detail, forms, Home card, legacy removal

**Files:**
- Create: `src/modules/funds/ui/run.ts`, `deps.ts`, `load-funds.ts` (+`.test.ts` for its pure helpers), `FundForm.tsx`, `ContributionForm.tsx`, `ScheduleForm.tsx`, `PlanForm.tsx`, `ContributionsTable.tsx`, `QuarterTable.tsx`; `src/app/(app)/finance/funds/page.tsx` (rewrite), `src/app/(app)/finance/funds/[id]/page.tsx`, `loading.tsx`; `src/app/actions/funds.ts` (rewrite).
- Modify: `src/app/(app)/page.tsx` (Home funds card), `src/modules/home/cards.ts` (funds card `requires: { permission: "funds.read" }`).
- Delete: `src/app/(app)/finance/funds/[slug]/**`, `src/app/(app)/finance/_lib/funds.ts`, `src/lib/repo/funds.ts`, `src/lib/calc/funds.ts` + test, `src/lib/calc/cometa.ts` + test, `src/app/(app)/finance/_lib/gain.ts` if unreferenced afterwards.

- [x] **Step 1: Loaders.** `run.ts` copied from `src/modules/interests/ui/run.ts` with `fundDeps`. `load-funds.ts`: `loadFundsSummary(): Promise<FundSummary[]>`, `loadFundDetail(id: string): Promise<FundDetail | null>` (maps `NotFoundError` to null) via `runForPrincipal`; pure helper `totalFundValue(summaries: readonly FundSummary[]): { value: string | null; unvalued: number }` (null when every fund is unvalued) with a unit test — this replaces `totalFundValue` in `src/app/(app)/page.tsx`.

- [x] **Step 2: Pages.** List: one `AccountRow`-style row per fund — name, kind, value with `StaleBadge` from `valueAsOf`, deposited, return with `DeltaBadge`, open-issues count; "New fund" opens `FundForm` in a `Sheet`. Detail: `PageHeader` with the fund name; `StatGrid` value / deposited / return; `TimeSeriesChart` of `valueSeries` (series value and deposited); `QuarterTable` when the effective schedule is quarterly or annual, else a monthly table; `ContributionsTable` (each `payroll` row links to `/company/earnings/${payrollRecordId}`; a "Reverse" button on rows that are not reversals and not yet reversed); panels for plan and schedule with their forms; the issues list with an Acknowledge button. Empty states: no funds → `EmptyState` with the create action; no linked account → "Link a valuation account to see its value" pointing at `FundForm`. `FundForm`'s account select lists the principal's accounts through `listAccounts` from `@/modules/accounts/application/list-accounts` (same use-case rule; open its own `runForPrincipal` from the accounts module in the loader, sequentially, never nested).

- [x] **Step 3: Actions** in `src/app/actions/funds.ts` (shape of `src/app/actions/expenses.ts`): `createFundAction`, `updateFundAction`, `setScheduleAction`, `setPlanAction`, `addContributionAction`, `reverseContributionAction`, `reconcileFundAction`, `acknowledgeIssueAction`. Parse money with `parseMoney`/`toNumericString`. `revalidatePath("/finance/funds")` and the detail path.

- [x] **Step 4: Home.** Replace the `loadFunds`/`FundView` import in `src/app/(app)/page.tsx` with `loadFundsSummary` + `totalFundValue`; the card keeps linking to `/finance/funds`.

- [x] **Step 5: Delete the legacy files** listed above. Then `grep -rn "lib/repo/funds\|calc/funds\|calc/cometa\|_lib/funds\|funds/\[slug\]" src scripts` must return nothing.

- [x] **Verify:** `npm run typecheck && npm test && npm run build` (the route table lists `/finance/funds` and `/finance/funds/[id]`, not `[slug]`).
- [x] **Commit:** `git add -A src && git commit -m "feat(funds): module UI, Home card, retire the legacy funds pages"`

### Deviation — Task 6

The specified `totalFundValue` result has no currency field, while the reviewed
Task 6 contract forbids adding or converting unlike currencies. Keep the
specified `{ value, unvalued }` shape: return `value: null` when valued funds
span more than one currency, count only genuinely missing valuations in
`unvalued`, and derive the one display currency separately in the UI. Add a
tested Home-card load predicate so a denied `funds.read` card is rendered
without invoking the funds loader. Add a small funds-specific currency value
component because the shared `MoneyValue` deliberately formats EUR only. The
legacy gain loader's only consumer, `MonthlyGainPanel`, becomes orphaned when
the funds list is rewritten, so remove that component with the loader rather
than leave a dangling type import.

---

### Task 7: Payroll writes fund contributions

**Files:**
- Create: `src/modules/funds/infrastructure/payroll-contribution-sink.ts` (+`.test.ts` on memory repos), `src/modules/funds/infrastructure/memory-contribution-sink.ts` (for payroll unit tests).
- Modify: `src/modules/payroll/application/ports.ts`, `apply-import.ts` (+ test), `src/modules/payroll/infrastructure/deps.ts`, `src/test/integration-deps.ts` if it builds payroll deps, every payroll test that stubs `deps.funds`, `src/modules/payroll/infrastructure/ingest.itest.ts`.
- Delete: `src/modules/payroll/infrastructure/legacy-fund-deposits.ts` and its memory fake (`grep -rn "LegacyFundDeposits\|legacyFundDeposits" src`).

**Interfaces — Produces** (in payroll `ports.ts`, replacing `LegacyFundDepositInput`/`LegacyFundDeposits`):
```ts
export interface FundContributionWrite { fundSlug: string; part: "employee" | "employer"; accrualMonth: string; amount: string | null; currency: string }
export interface FundContributionSink {
  /** Deletes contributions of `supersededRecordId` (R5-4), writes the record's contributions and the posting's system fee (R5-3). */
  writeForRecord(input: { userId: string; payrollRecordId: string; supersededRecordId: string | null; rows: readonly FundContributionWrite[] }): Promise<{ written: number; skipped: { fundSlug: string; reason: "no_fund" | "no_amount" }[] }>;
}
```
`UseCaseDeps.funds: FundContributionSink`. `ApplyImportResult.fundDeposit` becomes `fundContributions: { written: number; skipped: … }`.

- [x] **Step 1: Sink test.** Given fund `cometa` with a quarterly schedule (lag 1, fee `3.00`) and a record for `2026-02-01` with employee `100.00` and employer `150.00`: writes two `payroll` rows with `postedMonth = "2026-04-01"`, `accrualPeriodStart = "2026-01-01"`, `accrualPeriodEnd = "2026-03-01"`, and one system `fee` row `-3.00` for `2026-04-01`; a second record in the same quarter writes no second fee; an unknown slug → `skipped: [{ fundSlug, reason: "no_fund" }]`; a `null` amount → `no_amount`; `supersededRecordId` set → that record's rows are gone afterwards; a zero `feePerPosting` writes no fee row.

- [x] **Step 2: Implement** `payrollContributionSink(tx: DbClient): FundContributionSink` over `DrizzleFundsRepository`, `DrizzleSchedulesRepository`, `DrizzleContributionsRepository` bound to the caller's `tx` (no I/O, same transaction as the payroll record). The memory sink takes the memory repositories. Wire `funds: payrollContributionSink(tx)` in `src/modules/payroll/infrastructure/deps.ts`.

- [x] **Step 3: `apply-import.ts`.** Replace `fundHalves`/`upsertForRecord` with: collect every component whose `mappedTo.kind === "fund_contribution"` into `FundContributionWrite[]` (`accrualMonth = monthOfPeriod(period.periodStart)`, `amount = component.amount`), then one `writeForRecord` call with `supersededRecordId`. Update `apply-import.test.ts`; in `ingest.itest.ts` the assertions on `fund_deposits` rows become assertions on `fund_contributions` rows.

- [x] **Verify:** `npm run typecheck && npm test && npm run test:integration -- payroll`. Then `grep -rn "fund_deposits\|fundDeposits" src` returns only `src/lib/db/schema/legacy.ts`.
- [x] **Commit:** `git add -A src && git commit -m "feat(payroll): apply writes fund_contributions through the funds sink (R4-6 closed)"`

---

### Deviation — Task 7

R5-C8: payroll application also supports re-applying the same verified import. Replace contributions linked to the current `payrollRecordId` as well as a distinct `supersededRecordId`, across all of the owner's funds, before writing the newly mapped parts. Otherwise re-apply violates uniqueness or leaves removed mappings behind. A replaced contribution can have a manual reversal: remove the old original/reversal pair together without violating `reverses_id`, while preserving its existing audit events. Lock affected funds in a consistent order. Test re-apply, removed/changed fund mapping, and replacement after reversal on real Postgres as well as memory.

System-fee replacement policy: a `source = 'system'` fee belongs to an actual posting, so it is retained exactly once while any employee/employer contribution with `payroll_record_id` remains for that fund and posted month, or while a `source = 'migration'` employee/employer row remains even without a payroll link (Task 8 permits that when no live ordinary record matches). Re-apply or supersession removes the fee when it removes the posting's final eligible contribution. Manual rows do not make a payroll fee eligible. When an orphan fee has a manual reversal, cleanup removes the net-zero fee/reversal pair in dependency order while preserving their audit events. This prevents a negative fee from surviving without an actual payroll posting while preserving shared and unlinked-migration postings.

### Task 8: Migration script and validator

**Files:** Create `scripts/migrate-funds.ts`, `scripts/validate-funds-migration.ts`; add `"migrate:funds": "tsx scripts/migrate-funds.ts"` and `"migrate:funds:validate": "tsx scripts/validate-funds-migration.ts"` to `package.json`.

- [ ] **Step 1: `migrate-funds.ts`** (idempotent; every read/write under `withSystemContext`; template `scripts/migrate-paperless.ts`):
  1. Resolve the owner: the single `users` row joined to `user_roles.role_code = 'owner'`; abort with exit 2 if zero or more than one.
  2. For each `legacy_funds` row upsert `funds` on `(user_id, slug)`: `name`, `kind = slug === 'cometa' ? 'pension' : 'investment'`, `account_id` = the owner's `accounts` row with `lower(name) = lower(legacy name)` if exactly one matches, else null (print a warning).
  3. `fund_settings` → `fund_plans` (`effective_from`, `initial_capital`, `fixed_monthly_amount` when `deposit_mode = 'fixed'`, `note = 'migrated from fund_settings#<id>'`), upsert on `(fund_id, effective_from)`.
  4. Schedules: `cometa` → `quarterly, anchor 1, lag 1, fee 3.00`; `fideuram` → `monthly, lag 0, fee 0.00`; `effective_from` = the fund's earliest `fund_settings.effective_from` (or the earliest deposit month). Upsert on `(fund_id, effective_from)`.
  5. `fund_deposits` → `fund_contributions` with `source = 'migration'`, accrual period from `accrualPeriodFor(month, schedule)`, `posted_month = postedMonthFor(month, schedule)`, `note = 'migrated from fund_deposits#<id>'` (skip when a row with that note exists): `source = 'payroll'` rows with both parts present → one `employee` (`employee_part`) and one `employer` (`employer_part`) row; otherwise one `employee` row of `amount`; `payroll_record_id` = the owner's live `payroll_records` row with `period_start = month AND kind = 'ordinary'`, or null. `source = 'fixed' | 'manual'` → one `voluntary` row.
  6. `cometa` only: one system `fee` row `-3.00` per distinct `posted_month` among the migrated payroll rows (skip if `hasSystemFee`), and one `fee` row `-10.32`, `source = 'migration'`, `note = 'joining fee'`, on the earliest posted month (skip if present).
  7. Print counts per table.
- [ ] **Step 2: `validate-funds-migration.ts`** (template `scripts/validate-paperless-migration.ts`): for every legacy fund and every month from its earliest deposit to the current month, compare `depositedThrough(newRows, month)` with the legacy figure. The legacy calculation (`totalDeposited` + `cometaCreditedDeposits`) was deleted in Task 6, so **re-implement it inline in the script from the legacy tables** with the same rules (initial capital from the effective setting; Cometa deposits credited at `creditMonthFor + 1` net of the quarterly fee, joining fee on the first credit) — `git show 6294194:dashboard-app/src/lib/calc/cometa.ts` and `…/calc/funds.ts` are the reference. Zero tolerance, string comparison in cents. Also assert both new funds have an `account_id` with a latest balance, and that the examined-month count is > 0. Exit 1 on the first mismatch, printing fund, month, legacy, new.
- [ ] **Verify:** against the test database: `npm run test:db:up`, `DATABASE_URL=postgresql://app_test:app_test@localhost:55432/dashboard_test npm run db:migrate`, then the fixture SQL from the script's header comment (two legacy funds, one setting each, six deposits, one account per fund with one balance), then `npm run migrate:funds` twice (second run writes nothing) and `npm run migrate:funds:validate` → `OK (2 funds, N months examined)`.
- [ ] **Commit:** `git add scripts package.json && git commit -m "feat(funds): legacy funds migration and validator"`

---

### Deviation — Task 8

Production inspection found no valuation accounts for either legacy fund, but `balance_snapshots` holds both actual histories. If no name match exists, create one manual account of the appropriate kind for the fund and import its legacy monthly snapshot history using the exact `monthlyHistoryQuery` ordering (Europe/Rome month, prefer non-`latest` rows, then captured_at DESC and id DESC; retain selected original dates/values, no synthetic balances), then link it. If multiple name matches exist, fail with a clear ambiguity report. Keep unrelated accounts untouched. Add idempotence and value-parity fixtures. Bundle both scripts into the standalone Docker image and document `node /app/migrate-funds.mjs` and `node /app/validate-funds-migration.mjs`; production has no tsx scripts available.

### Task 9: Exit criteria

**Files:** Create `docs/deploy/phase-5-runbook.md`, `docs/superpowers/handoff/2026-09-06-phase-5-checkpoint.md`; modify `docs/architecture/overview.md`, `.superpowers/sdd/MASTER-LEDGER.md` (Phase 5 → done, plan path).

- [ ] **Step 1:** `npm run typecheck && npm test && npm run test:db:up && npm run test:integration && npm run build && npm run openapi:generate && git diff --exit-code docs/api/openapi.json`. All green; the route table lists `/finance/funds/[id]`.
- [ ] **Step 2:** `grep -rn "legacyFunds\|legacy_funds" src` returns only `schema/legacy.ts`, `migrate.ts` and `scripts/`; `grep -rn "fund_deposits" src` returns only `schema/legacy.ts`; `grep -rn "10.32\|QUARTERLY_FEE\|JOINING_FEE" src` returns nothing.
- [ ] **Step 3: Runbook** — pre-checks (`pg_dump dashboard`, confirm the Phase 4 runbook has run), deploy the image, `npm run db:migrate`, `npm run migrate:funds`, `npm run migrate:funds:validate`, verify `/finance/funds` shows both funds with the same deposited totals as before and Cometa's quarter table shows the next posting month; rollback = restore the dump (the scripts never modify legacy tables).
- [ ] **Step 4: Manual walkthrough** (record as owed if not run): add a manual voluntary contribution for last month and see its posted month; apply a payslip and see its `fund_contributions` rows plus the system fee; reverse a contribution; reconcile and see `missing` for a payroll month without a contribution. **Exit line (spec §11 Phase 5): a fund maintained by hand without payroll works end to end, and a payroll month accrued in March posts in April.**
- [ ] **Step 5:** `graphify update .` from the repo root. Write the checkpoint (state up front: implemented; deployed or not; stacks on Phase 4; verification numbers; rulings R5-1…R5-5; what remains: `fund_valuations`, `delayed`/`matched`, more charts, contribution-type management). Update `docs/architecture/overview.md` (module list gains `modules/funds/`; "What's deferred" drops funds).
- [ ] **Commit:** `git add -A ../docs ../graphify-out ../.superpowers && git commit -m "docs(handoff): Phase 5 checkpoint and runbook"`

---

## Self-review against the spec

- §5.5 tables: `funds` ✔ (Task 1), `fund_contribution_types` ✔, `fund_contribution_schedules` ✔, `fund_contributions` ✔ (with `reverses_id`, `reconciliation_status`, `payroll_record_id`, `attachment_ref` omitted — no attachment store for funds), `fund_plans` ✔ (replaces `fund_settings`), `fund_valuations` ✘ deferred (R5-2: value from the linked account). §5.9 `reconciliation_issues` ✔. §5.10 index ✔.
- §7.4: manual mode ✔ (Tasks 4, 6); reversals and adjustments ✔; quarterly rule ✔ (R5-2); expected-vs-received → issues partial (missing/duplicate/anomalous; delayed deferred); quarterly/annual views ✔ (`QuarterTable`); charts: value vs deposited only; drill-down to the source payroll record ✔ (link in `ContributionsTable`); fees as `fee` contributions ✔ (R5-3).
- §11 exit ✔ (Task 9 Step 4). §12.7 (Vacation fund → budget) is Phase 6.
- Type consistency: `FundSchedule` satisfies `ScheduleRule` structurally, so `postedMonthFor(month, schedule)` accepts a `FundSchedule`; `FundContribution` satisfies `ContributionLike`; `FundContributionWrite.amount` is `string | null` in both the payroll port and the sink test.
