# Phase 6: Budgets

> **For agentic workers:** Codex — one task per run, see "How to execute a plan with Codex" in `2026-09-06-phases-5-9-shared-conventions.md`. Claude Code — `superpowers:subagent-driven-development`, one task per subagent. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the Budgets domain (spec §5.6): budgets with a versioned initial amount, **virtual** allocations from a fund or account (or unsourced) that never move money, scopes that decide which transactions count as usage, materialised usages, an event log, pages, API and a Home card. Convert the legacy Vacation money fund into a budget named "Holidays" and retire the vacation pages.

**Architecture:** New module `src/modules/budgets/` in the interests/funds shape. Usage is computed from the expenses module's `transactions` by scope and materialised in `budget_usages` so it is auditable (spec §5.6), refreshed on read and by an explicit action — no new job. Availability in a source (`source balance − Σ virtual allocations against it`) is computed from `account_balances` (for an account source, or a fund's linked account) and never written anywhere.

**Tech stack:** as in the shared conventions. No new npm dependency.

**Spec:** §5.6 (tables and derived figures), §7.5 (Vacation fund → "Holidays" budget), §4 (`/finance/budgets`, `/finance/budgets/[id]`), §7.1 (Home "active budgets" card), §11 Phase 6 (exit: "virtual allocations separated from real balances, availability recalculated"), §12.7. Predecessor: Phase 5 checkpoint (`docs/superpowers/handoff/2026-09-06-phase-5-checkpoint.md`) — this phase reads fund values through the `funds` table's `account_id` link.

**Global Constraints:** see `2026-09-06-phases-5-9-shared-conventions.md`. Phase-specific:

- Migration number **`0017`** (`0017_budgets.sql`). Verify with `ls drizzle/*.sql`.
- New permissions `budgets.read`, `budgets.write`; `member` both, `viewer` read.
- Every allocation is labelled **"planning value"** in the UI (spec §5.6). No use case in this module writes to `accounts`, `account_balances`, `funds` or `fund_contributions`.
- Usage counts only transactions with `type = 'expense'` (transfers and income never count); the usage amount is the absolute value of the transaction amount.

## Scope cut

- No threshold alerts / `budget.threshold.exceeded` webhook (Phase 9 builds the delivery path and adds the emit point).
- No per-period rollover: `period_kind` is stored and displayed but figures are computed over `[start_date, end_date ?? today]` as one window.
- No budget sharing across users.

## Rulings

- **R6-1 Unsourced allocations exist.** Spec §5.6 has `source_kind fund|account`; the migrated Holidays budget's monthly accrual has no real source, so `source_kind` also admits `none` (`source_id` null). Availability is computed only for sourced allocations.
- **R6-2 Recurring allocations.** `budget_allocations.recurrence` is `once | monthly`. A `monthly` allocation contributes `amount × (number of calendar months from effective_from through min(effective_to, asOf))`. This is how "the accrual rate becomes a monthly recurring allocation" (spec §7.5) is represented without a job inserting rows every month.
- **R6-3 Usages are re-derived, never edited.** `refreshUsages` recomputes scope-matched usages for the budget window (insert new, delete stale, update changed amounts) and leaves `matched_by = 'manual'` rows alone. Manual usages are the only ones a user creates or deletes.
- **R6-4 The vacation ledger's accrual rows are not copied.** `vacation_accrual_rate` rows become monthly allocations; the ledger's `accrual` rows are the derived result of those rates and are reproduced by R6-2. Where the migration finds a month where they differ, it inserts a `once` allocation named "migration adjustment" for the difference on that month, so the balance series is preserved to the cent.

## What already exists, and what happens to it

| File | Fate |
|---|---|
| `src/app/(app)/finance/budgets/page.tsx` (placeholder `EmptyState`) | Rewritten in Task 6. |
| `src/app/(app)/finance/vacation/page.tsx`, `_components/WithdrawalFlow.tsx`, `src/app/actions/vacation.ts`, `src/lib/repo/vacation.ts`, `src/lib/calc/vacation-fund.ts` (+tests) | Deleted in Task 6. `/finance/vacation` becomes a page containing only `redirect("/finance/budgets")`, kept one phase for bookmarks. |
| `src/lib/db/schema/legacy.ts` `vacationLedger`, `vacationAccrualRate` | Frozen; read by Task 7's script; dropped in Phase 9. |
| `src/app/(app)/settings/personal/page.tsx:5-8,68`, `settings/_components/SettingsForms.tsx:7` (`setAccrualRate`, `setInitialValue`, `ledger`, `rates`, `effectiveRate` — the "Vacation fund" settings section) | The section is **removed** from Personal settings in Task 6; its two inputs (initial value, monthly accrual rate) are now the Holidays budget's amount version and monthly allocation, edited on `/finance/budgets/[id]`. `HoursPerDayForm` in the same file stays (it is time off, Phase 7). |
| `src/app/(app)/_lib/vacation.ts` (`loadFerie`, `hoursPerDay`) | **Not touched** — that is leave (time off), Phase 7. |
| `src/modules/home/cards.ts` | Gains the `budgets` card key. Task 6. |
| `src/modules/expenses/application/ports.ts` `TransactionsRepository.list` | Not reused: budgets need a scope query, so this module owns a small `TransactionsScopeSource` over the `transactions` tables (Task 3). |

## File structure

```
drizzle/0017_budgets.sql
src/lib/db/schema/budgets.ts                    budgets, budgetAmountVersions, budgetAllocations, budgetScopes, budgetUsages, budgetEvents
src/lib/db/schema/index.ts (modify)
src/lib/db/budgets-rls.itest.ts
src/platform/auth/permissions.ts (modify)
src/modules/budgets/domain/figures.ts (+test)   initialAt, allocatedThrough, usedThrough, figures, availableInSource, monthsInclusive
src/modules/budgets/domain/scopes.ts (+test)    scopeMatches, usageAmount
src/modules/budgets/application/ports.ts, deps.ts, errors.ts
src/modules/budgets/application/{list-budgets,get-budget-detail,create-budget,update-budget,set-initial-amount,add-allocation,end-allocation,set-scopes,add-manual-usage,delete-manual-usage,refresh-usages}.ts (+tests)
src/modules/budgets/infrastructure/drizzle-*.ts, memory-repositories.ts (+test), transactions-scope-source.ts, source-balance-source.ts, deps.ts, repositories.itest.ts
src/modules/budgets/api/schemas.ts, routes.ts, routes.itest.ts
src/modules/budgets/ui/run.ts, deps.ts, load-budgets.ts (+test), BudgetForm.tsx, AllocationForm.tsx, ScopesForm.tsx, ManualUsageForm.tsx, AllocationsTable.tsx, UsagesTable.tsx, BudgetFigures.tsx
src/app/(app)/finance/budgets/page.tsx, [id]/page.tsx, loading.tsx; src/app/(app)/finance/vacation/page.tsx (redirect only)
src/app/actions/budgets.ts
scripts/migrate-vacation-budget.ts, scripts/validate-vacation-budget-migration.ts
docs/deploy/phase-6-runbook.md, docs/superpowers/handoff/2026-09-06-phase-6-checkpoint.md
```

---

### Task 1: Migration 0017 — budget tables and RLS

**Files:** Create `drizzle/0017_budgets.sql`, `src/lib/db/schema/budgets.ts`, `src/lib/db/budgets-rls.itest.ts`. Modify `src/lib/db/schema/index.ts`, `src/platform/auth/permissions.ts` (+`.test.ts`).

- [x] **Step 1: Schema**

```ts
// src/lib/db/schema/budgets.ts
import { check, date, index, integer, jsonb, numeric, pgTable, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { users } from "./identity";
import { transactions } from "./transactions";

const tz = (n: string) => timestamp(n, { withTimezone: true, mode: "date" });
const id = () => uuid("id").primaryKey().default(sql`uuidv7()`);
const money = (n: string) => numeric(n, { precision: 16, scale: 2 });

export const budgets = pgTable("budgets", {
  id: id(),
  userId: uuid("user_id").notNull().references(() => users.id),
  name: text("name").notNull(),
  description: text("description"),
  currency: text("currency").notNull().default("EUR"),
  status: text("status").notNull().default("active"),
  periodKind: text("period_kind").notNull().default("none"),
  startDate: date("start_date").notNull(),
  endDate: date("end_date"),
  goalAmount: money("goal_amount"),
  labels: jsonb("labels").$type<string[]>().notNull().default([]),
  archivedAt: tz("archived_at"),
  version: integer("version").notNull().default(1),
  createdAt: tz("created_at").notNull().defaultNow(),
  updatedAt: tz("updated_at").notNull().defaultNow(),
}, (t) => [
  check("budgets_status_ck", sql`${t.status} IN ('active','archived')`),
  check("budgets_period_ck", sql`${t.periodKind} IN ('none','monthly','quarterly','annual','custom')`),
  check("budgets_dates_ck", sql`${t.endDate} IS NULL OR ${t.startDate} <= ${t.endDate}`),
  index("budgets_user_status_idx").on(t.userId, t.status),
]);

/** Full history of the initial amount (spec §5.6). The row effective at a date is the latest effective_from <= date. */
export const budgetAmountVersions = pgTable("budget_amount_versions", {
  id: id(),
  budgetId: uuid("budget_id").notNull().references(() => budgets.id, { onDelete: "cascade" }),
  initialAmount: money("initial_amount").notNull(),
  effectiveFrom: date("effective_from").notNull(),
  reason: text("reason"),
  actorUserId: uuid("actor_user_id"),
  createdAt: tz("created_at").notNull().defaultNow(),
}, (t) => [uniqueIndex("budget_amount_versions_uq").on(t.budgetId, t.effectiveFrom)]);

/** Virtual. Never moves money (spec §5.6). R6-1: source_kind 'none' allowed; R6-2: recurrence. */
export const budgetAllocations = pgTable("budget_allocations", {
  id: id(),
  budgetId: uuid("budget_id").notNull().references(() => budgets.id, { onDelete: "cascade" }),
  sourceKind: text("source_kind").notNull().default("none"),
  sourceId: uuid("source_id"),
  amount: money("amount").notNull(),
  recurrence: text("recurrence").notNull().default("once"),
  effectiveFrom: date("effective_from").notNull(),
  effectiveTo: date("effective_to"),
  note: text("note"),
  actorUserId: uuid("actor_user_id"),
  version: integer("version").notNull().default(1),
  createdAt: tz("created_at").notNull().defaultNow(),
  updatedAt: tz("updated_at").notNull().defaultNow(),
}, (t) => [
  check("budget_allocations_source_ck", sql`${t.sourceKind} IN ('fund','account','none')`),
  check("budget_allocations_source_id_ck", sql`(${t.sourceKind} = 'none') = (${t.sourceId} IS NULL)`),
  check("budget_allocations_recurrence_ck", sql`${t.recurrence} IN ('once','monthly')`),
  check("budget_allocations_dates_ck", sql`${t.effectiveTo} IS NULL OR ${t.effectiveFrom} <= ${t.effectiveTo}`),
  index("budget_allocations_source_idx").on(t.sourceKind, t.sourceId),
]);

export const budgetScopes = pgTable("budget_scopes", {
  id: id(),
  budgetId: uuid("budget_id").notNull().references(() => budgets.id, { onDelete: "cascade" }),
  kind: text("kind").notNull(),
  refId: uuid("ref_id").notNull(),
}, (t) => [
  check("budget_scopes_kind_ck", sql`${t.kind} IN ('account','category','label','fund')`),
  uniqueIndex("budget_scopes_uq").on(t.budgetId, t.kind, t.refId),
]);

/** Materialised usage link (spec §5.6). R6-3: scope rows are re-derived; manual rows are user-owned. */
export const budgetUsages = pgTable("budget_usages", {
  id: id(),
  budgetId: uuid("budget_id").notNull().references(() => budgets.id, { onDelete: "cascade" }),
  transactionId: uuid("transaction_id").references(() => transactions.id, { onDelete: "cascade" }),
  amount: money("amount").notNull(),
  occurredAt: date("occurred_at").notNull(),
  matchedBy: text("matched_by").notNull(),
  note: text("note"),
  createdAt: tz("created_at").notNull().defaultNow(),
}, (t) => [
  check("budget_usages_matched_ck", sql`${t.matchedBy} IN ('scope','manual')`),
  check("budget_usages_tx_ck", sql`(${t.matchedBy} = 'scope') = (${t.transactionId} IS NOT NULL)`),
  uniqueIndex("budget_usages_tx_uq").on(t.budgetId, t.transactionId).where(sql`transaction_id IS NOT NULL`),
  index("budget_usages_budget_occurred_idx").on(t.budgetId, t.occurredAt),
]);

export const budgetEvents = pgTable("budget_events", {
  id: id(),
  budgetId: uuid("budget_id").notNull().references(() => budgets.id, { onDelete: "cascade" }),
  kind: text("kind").notNull(),
  detail: jsonb("detail").notNull().default({}),
  actorUserId: uuid("actor_user_id"),
  createdAt: tz("created_at").notNull().defaultNow(),
}, (t) => [index("budget_events_budget_created_idx").on(t.budgetId, t.createdAt.desc())]);

export type BudgetRow = typeof budgets.$inferSelect;
export type BudgetAmountVersionRow = typeof budgetAmountVersions.$inferSelect;
export type BudgetAllocationRow = typeof budgetAllocations.$inferSelect;
export type BudgetScopeRow = typeof budgetScopes.$inferSelect;
export type BudgetUsageRow = typeof budgetUsages.$inferSelect;
export type BudgetEventRow = typeof budgetEvents.$inferSelect;
```

- [x] **Step 2: Generate** (`npm run db:generate`, rename to `0017_budgets.sql`) and append RLS: `budgets` gets the owner policy on `user_id`; the five child tables get ENABLE/FORCE plus `USING (app_is_system() OR EXISTS (SELECT 1 FROM budgets b WHERE b.id = <table>.budget_id AND b.user_id = app_current_user_id()))` and the same `WITH CHECK` (the Phase 5 fund-children shape).

- [x] **Step 3: Permissions.** Add `"budgets.read"`, `"budgets.write"` after the funds codes; `member` both, `viewer` read; update `permissions.test.ts`.

- [x] **Step 4: `budgets-rls.itest.ts`** (copy `src/lib/db/funds-rls.itest.ts`): isolation for `budgets` and for an allocation through the `EXISTS` policy; B cannot insert an allocation into A's budget; `budget_usages_tx_uq` rejects a second scope usage for the same transaction; `budget_allocations_source_id_ck` rejects `source_kind = 'account'` with a null `source_id`; `budget_usages_tx_ck` rejects a `manual` usage carrying a `transaction_id`.

- [x] **Verify:** `npm run typecheck && npm test && npm run test:db:up && npm run test:integration -- budgets-rls`.
- [x] **Commit:** `git add drizzle src/lib/db src/platform/auth && git commit -m "feat(budgets): migration 0017 — budgets, amount versions, allocations, scopes, usages, events"`

---

### Task 2: Domain — figures and scopes

**Files:** Create `src/modules/budgets/domain/figures.ts` (+`.test.ts`), `scopes.ts` (+`.test.ts`).

**Interfaces — Produces:**
```ts
// figures.ts  (money as decimal strings; dates "YYYY-MM-DD"; months "YYYY-MM-01")
export interface AmountVersionLike { initialAmount: string; effectiveFrom: string }
export interface AllocationLike { id: string; amount: string; recurrence: "once" | "monthly"; effectiveFrom: string; effectiveTo: string | null; sourceKind: "fund" | "account" | "none"; sourceId: string | null }
export interface UsageLike { amount: string; occurredAt: string }
export function initialAt(versions: readonly AmountVersionLike[], asOf: string): string;          // "0.00" when none effective
export function allocatedThrough(allocations: readonly AllocationLike[], asOf: string): string;  // R6-2
export function usedThrough(usages: readonly UsageLike[], asOf: string): string;
export interface BudgetFigures { initial: string; allocated: string; used: string; remaining: string; goalProgress: number | null }
export function figures(input: { versions: readonly AmountVersionLike[]; allocations: readonly AllocationLike[]; usages: readonly UsageLike[]; goalAmount: string | null }, asOf: string): BudgetFigures; // remaining = initial + allocated − used
export function availableInSource(balance: string | null, allocationsAgainstSource: readonly AllocationLike[], asOf: string): string | null; // balance − allocatedThrough; null when balance is null
export function monthsInclusive(from: string, through: string): number; // calendar months; 0 when through < from
// scopes.ts
export interface ScopeLike { kind: "account" | "category" | "label" | "fund"; refId: string }
export interface TransactionLike { id: string; accountId: string; categoryId: string | null; labelIds: readonly string[]; type: "income" | "expense" | "transfer"; amount: string; occurredAt: string }
export function scopeMatches(scopes: readonly ScopeLike[], tx: TransactionLike): boolean; // any account/category/label scope matches; a 'fund' scope never matches a transaction
export function usageAmount(tx: TransactionLike): string | null; // |amount| for expenses, null otherwise
```

- [x] **Step 1: Tests first** — `figures.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { allocatedThrough, availableInSource, figures, initialAt, monthsInclusive } from "./figures";
const monthly = { id: "a", amount: "100.00", recurrence: "monthly" as const, effectiveFrom: "2026-01-01", effectiveTo: null, sourceKind: "none" as const, sourceId: null };
describe("allocations are planning values (spec §5.6, R6-2)", () => {
  it("counts a monthly allocation once per calendar month from its start through asOf", () => {
    expect(allocatedThrough([monthly], "2026-03-31")).toBe("300.00");
    expect(allocatedThrough([monthly], "2025-12-31")).toBe("0.00");
    expect(allocatedThrough([{ ...monthly, effectiveTo: "2026-02-28" }], "2026-06-30")).toBe("200.00");
  });
  it("counts a once allocation only from its effective date", () => {
    const once = { ...monthly, id: "b", recurrence: "once" as const, amount: "50.00", effectiveFrom: "2026-02-10" };
    expect(allocatedThrough([once], "2026-02-09")).toBe("0.00");
    expect(allocatedThrough([once], "2026-02-10")).toBe("50.00");
  });
  it("picks the initial amount version effective at asOf", () => {
    const v = [{ initialAmount: "1000.00", effectiveFrom: "2026-01-01" }, { initialAmount: "1500.00", effectiveFrom: "2026-04-01" }];
    expect(initialAt(v, "2026-03-31")).toBe("1000.00");
    expect(initialAt(v, "2026-04-01")).toBe("1500.00");
    expect(initialAt([], "2026-04-01")).toBe("0.00");
  });
  it("remaining = initial + allocated − used; goal progress from remaining", () => {
    const f = figures({ versions: [{ initialAmount: "1000.00", effectiveFrom: "2026-01-01" }], allocations: [monthly], usages: [{ amount: "250.00", occurredAt: "2026-02-15" }], goalAmount: "2000.00" }, "2026-03-31");
    expect(f).toEqual({ initial: "1000.00", allocated: "300.00", used: "250.00", remaining: "1050.00", goalProgress: 0.525 });
  });
  it("availability subtracts virtual allocations from the real balance and is null without a balance", () => {
    expect(availableInSource("5000.00", [monthly], "2026-02-28")).toBe("4800.00");
    expect(availableInSource(null, [monthly], "2026-02-28")).toBeNull();
  });
  it("monthsInclusive counts calendar months", () => {
    expect(monthsInclusive("2026-01-15", "2026-03-02")).toBe(3);
    expect(monthsInclusive("2026-03-02", "2026-01-15")).toBe(0);
  });
});
```

`scopes.test.ts`: an account scope matches by `accountId`; a category scope by `categoryId`; a label scope when `labelIds` contains the ref; a `fund` scope never matches; `usageAmount({ type: "expense", amount: "-12.50" })` → `"12.50"`; income and transfer → `null`.

- [x] **Step 2:** `npm test -- modules/budgets/domain` → fails. **Step 3:** implement with `BigInt` cents (copy the helper from `src/modules/funds/domain/totals.ts`). `goalProgress` = remaining ÷ goal as a plain number rounded to 4 decimals (display only, never stored), `null` when `goalAmount` is null or zero.
- [x] **Verify / Commit:** `npm test -- modules/budgets/domain && npm run typecheck`; `git add src/modules/budgets/domain && git commit -m "feat(budgets): domain figures and scope matching"`

---

### Task 3: Ports, repositories, sources

**Files:** Create `src/modules/budgets/application/ports.ts`, `deps.ts`, `errors.ts`; `infrastructure/memory-repositories.ts` (+`.test.ts`), `drizzle-budgets-repository.ts`, `drizzle-allocations-repository.ts`, `drizzle-scopes-usages-repository.ts`, `drizzle-events-repository.ts`, `transactions-scope-source.ts`, `source-balance-source.ts`, `ownership-check.ts`, `deps.ts`, `repositories.itest.ts`.

**Interfaces — Produces** (`ports.ts`; every `id`/`userId`/`budgetId` is `string`, dates `"YYYY-MM-DD"`, money strings):
```ts
export interface Budget { id; userId; name; description: string | null; currency; status: "active" | "archived"; periodKind: "none" | "monthly" | "quarterly" | "annual" | "custom"; startDate: string; endDate: string | null; goalAmount: string | null; labels: string[]; archivedAt: Date | null; version: number; createdAt: Date; updatedAt: Date }
export type NewBudget = Pick<Budget, "userId" | "name" | "description" | "currency" | "periodKind" | "startDate" | "endDate" | "goalAmount" | "labels">;
export type BudgetPatch = Partial<Pick<Budget, "name" | "description" | "periodKind" | "startDate" | "endDate" | "goalAmount" | "labels" | "status" | "archivedAt">>;
export interface AmountVersion extends AmountVersionLike { id; budgetId; reason: string | null; actorUserId: string | null; createdAt: Date }
export interface Allocation extends AllocationLike { budgetId; note: string | null; actorUserId: string | null; version: number; createdAt: Date; updatedAt: Date }
export interface Scope extends ScopeLike { id; budgetId }
export interface Usage extends UsageLike { id; budgetId; transactionId: string | null; matchedBy: "scope" | "manual"; note: string | null; createdAt: Date }
export interface BudgetEvent { id; budgetId; kind: string; detail: Record<string, unknown>; actorUserId: string | null; createdAt: Date }

export interface BudgetsRepository { list(userId, opts?: { includeArchived?: boolean }): Promise<Budget[]> /* name asc */; get(userId, id): Promise<Budget | null>; create(input: NewBudget): Promise<Budget>; update(userId, id, expectedVersion: number, patch: BudgetPatch): Promise<Budget | null> }
export interface AmountVersionsRepository { listForBudget(budgetId): Promise<AmountVersion[]> /* effectiveFrom asc */; add(input: Omit<AmountVersion, "id" | "createdAt">): Promise<AmountVersion> /* upsert on (budgetId, effectiveFrom) */ }
export interface AllocationsRepository { listForBudget(budgetId): Promise<Allocation[]> /* effectiveFrom asc, id asc */; listAgainstSource(userId, sourceKind: "fund" | "account", sourceId): Promise<Allocation[]> /* across all the user's budgets */; get(budgetId, id): Promise<Allocation | null>; create(input: Omit<Allocation, "id" | "version" | "createdAt" | "updatedAt">): Promise<Allocation>; update(budgetId, id, expectedVersion: number, patch: Partial<Pick<Allocation, "effectiveTo" | "note">>): Promise<Allocation | null> }
export interface ScopesRepository { listForBudget(budgetId): Promise<Scope[]>; replace(budgetId, scopes: readonly ScopeLike[]): Promise<Scope[]> }
export interface UsagesRepository { listForBudget(budgetId, opts?: { from?: string; to?: string }): Promise<Usage[]> /* occurredAt asc, id asc */; get(budgetId, id): Promise<Usage | null>; create(input: Omit<Usage, "id" | "createdAt">): Promise<Usage>; delete(budgetId, id): Promise<boolean>; replaceScopeMatched(budgetId, rows: readonly { transactionId: string; amount: string; occurredAt: string }[]): Promise<{ inserted: number; updated: number; deleted: number }> /* R6-3: keyed by transactionId; manual rows untouched */ }
export interface EventsRepository { listForBudget(budgetId, limit?: number): Promise<BudgetEvent[]> /* createdAt desc */; add(input: Omit<BudgetEvent, "id" | "createdAt">): Promise<BudgetEvent> }
export interface TransactionsScopeSource { listExpenses(userId, opts: { from: string; to: string }): Promise<TransactionLike[]> } // type = 'expense', any state; occurredAt as "YYYY-MM-DD" in Europe/Rome; labelIds joined
export interface SourceBalanceSource { latestBalance(userId, source: { kind: "fund" | "account"; id: string }): Promise<string | null> } // account → latest account_balances; fund → its linked account's latest balance; null when unknown or unlinked
export interface OwnershipCheck { accountExists(userId, id): Promise<boolean>; fundExists(userId, id): Promise<boolean> }
export interface Clock { now(): Date }
export interface UseCaseDeps { budgets: BudgetsRepository; versions: AmountVersionsRepository; allocations: AllocationsRepository; scopes: ScopesRepository; usages: UsagesRepository; events: EventsRepository; transactions: TransactionsScopeSource; balances: SourceBalanceSource; ownership: OwnershipCheck; clock: Clock; audit: (e: AuditInput) => Promise<void> }
```

- [x] **Step 1: Memory repositories + test** (mirror `src/modules/funds/infrastructure/memory-repositories.ts`). Test `replaceScopeMatched`: an existing scope row with a changed amount → `updated: 1`; a scope row whose transaction is absent from `rows` → `deleted: 1`; manual rows survive; a new transaction → `inserted: 1`.
- [x] **Step 2: Drizzle repositories** with explicit `user_id`/`budget_id` predicates. `replaceScopeMatched`: select the budget's scope rows → diff in memory → batched insert / update / delete inside the caller's transaction.
- [x] **Step 3: Sources.** `transactions-scope-source.ts`: one query over `transactions` left-joined to `transaction_label_links` with `user_id = ? AND type = 'expense' AND occurred_at >= from AND occurred_at < (to + 1 day)` (bounds as Rome-midnight instants via `monthStartInstant`-style helpers from `@/lib/time`), label ids aggregated per transaction, `occurredAt` rendered with `romeDate`. `source-balance-source.ts`: account → latest `account_balances` row for `(account_id)` joined on `accounts.user_id`; fund → `funds.account_id` then the same query. `ownership-check.ts`: two `SELECT 1 … WHERE id = ? AND user_id = ?` queries.
- [x] **Step 4: `deps.ts`** `budgetDeps(tx, requestId?)`. **Step 5: `repositories.itest.ts`** with `describe.each` over memory and Drizzle for every repository; Drizzle-only: `listAgainstSource` spans two budgets of the same user and excludes another user's allocations against the same account id.
- [x] **Verify / Commit:** `npm run typecheck && npm test -- modules/budgets && npm run test:integration -- modules/budgets`; `git add src/modules/budgets && git commit -m "feat(budgets): ports, repositories, transaction and balance sources"`

---

### Task 4: Use cases

**Files:** `src/modules/budgets/application/{list-budgets,get-budget-detail,create-budget,update-budget,set-initial-amount,add-allocation,end-allocation,set-scopes,add-manual-usage,delete-manual-usage,refresh-usages}.ts` (+`.test.ts` each, memory repos, `testPrincipal()`).

**Interfaces — Produces:**
```ts
export interface BudgetSummary { budget: Budget; figures: BudgetFigures; asOf: string }
listBudgets(deps)(principal, opts?: { includeArchived?: boolean }): Promise<BudgetSummary[]>              // budgets.read; asOf = min(endDate ?? today, today)
export interface AllocationView extends Allocation { sourceLabel: string | null; availableInSource: string | null }
export interface BudgetDetail extends BudgetSummary { versions: AmountVersion[]; allocations: AllocationView[]; scopes: Scope[]; usages: Usage[]; events: BudgetEvent[]; series: { month: string; remaining: string }[] }
getBudgetDetail(deps)(principal, id: string): Promise<BudgetDetail>          // budgets.read; runs refreshUsages first (R6-3); availableInSource per sourced allocation = balances.latestBalance − allocatedThrough(allocations.listAgainstSource(...), asOf)
createBudget(deps)(principal, input: Omit<NewBudget, "userId"> & { initialAmount: string }): Promise<Budget>   // budgets.write; first amount version at startDate; event "created"
updateBudget(deps)(principal, id: string, expectedVersion: number, patch: BudgetPatch): Promise<Budget>          // status "archived" sets archivedAt = clock.now()
setInitialAmount(deps)(principal, budgetId: string, input: { initialAmount: string; effectiveFrom: string; reason?: string | null }): Promise<AmountVersion>
addAllocation(deps)(principal, budgetId: string, input: { sourceKind: "fund" | "account" | "none"; sourceId?: string | null; amount: string; recurrence: "once" | "monthly"; effectiveFrom: string; effectiveTo?: string | null; note?: string | null }): Promise<Allocation>   // amount ≠ 0; a fund/account source must pass deps.ownership else InvalidInputError
endAllocation(deps)(principal, budgetId: string, allocationId: string, expectedVersion: number, effectiveTo: string): Promise<Allocation>
setScopes(deps)(principal, budgetId: string, scopes: readonly ScopeLike[]): Promise<Scope[]>                    // then refreshUsages
addManualUsage(deps)(principal, budgetId: string, input: { amount: string; occurredAt: string; note?: string | null }): Promise<Usage>   // amount > 0
deleteManualUsage(deps)(principal, budgetId: string, usageId: string): Promise<void>                          // NotFoundError for a scope-matched row
refreshUsages(deps)(principal, budgetId: string): Promise<{ inserted: number; updated: number; deleted: number }>   // window [startDate, endDate ?? today]; budgets.read is enough (it is a read-side refresh)
```

- [x] **Step 1: Tests first.** Per use case: viewer denied on writes; `createBudget` writes the version and the event; `addAllocation` with `sourceKind: "account"` and an unknown id → `InvalidInputError`; `getBudgetDetail.allocations[i].availableInSource` equals `balance − Σ allocations against that source across budgets`; `refreshUsages` inserts a scope-matched expense, ignores an income in the same category, deletes the usage after the scope is removed, keeps a manual usage; `deleteManualUsage` on a scope row → `NotFoundError`; every mutation records an audit row (`budgets.budget_created`, `budgets.budget_updated`, `budgets.amount_version_set`, `budgets.allocation_added`, `budgets.allocation_ended`, `budgets.scopes_set`, `budgets.usage_added`, `budgets.usage_deleted`) and a `budget_events` row of the same kind.
- [x] **Step 2: Implement.** `series` in `getBudgetDetail`: one point per month from `startDate` to `asOf`, `remaining = figures(..., lastDayOfMonth).remaining`. `sourceLabel` comes from an optional `deps.labels?: { accountName(userId, id); fundName(userId, id) }` — add `SourceLabels` to `UseCaseDeps` in `ports.ts` and implement with two lookups in `deps.ts`.
- [x] **Verify / Commit:** `npm test -- modules/budgets/application && npm run typecheck`; `git add src/modules/budgets && git commit -m "feat(budgets): use cases"`

---

### Task 5: REST API

**Files:** `src/modules/budgets/api/schemas.ts`, `routes.ts`, `routes.itest.ts`; modify `src/platform/http/app.ts`, `docs/api/openapi.json` (generated), `docs/api/README.md`.

| Method | Path | Use case | Notes |
|---|---|---|---|
| GET | `/budgets` | `listBudgets` | `?includeArchived` |
| POST | `/budgets` | `createBudget` | 201 |
| GET | `/budgets/{id}` | `getBudgetDetail` | |
| PATCH | `/budgets/{id}` | `updateBudget` | `If-Match`, 409 |
| POST | `/budgets/{id}/amount-versions` | `setInitialAmount` | 201 |
| POST | `/budgets/{id}/allocations` | `addAllocation` | 201 |
| PATCH | `/budgets/{id}/allocations/{aid}` | `endAllocation` | body `{ version, effectiveTo }` |
| PUT | `/budgets/{id}/scopes` | `setScopes` | 200 |
| POST | `/budgets/{id}/usages` | `addManualUsage` | **idempotency middleware**, 201 |
| DELETE | `/budgets/{id}/usages/{uid}` | `deleteManualUsage` | 204 |
| POST | `/budgets/{id}/refresh` | `refreshUsages` | 200 |

- [x] Schemas (`BudgetSchema`, `BudgetFiguresSchema`, `BudgetSummarySchema`, `BudgetDetailSchema`, `AllocationSchema`, `ScopeSchema`, `UsageSchema`, `BudgetEventSchema`, request schemas with `amount: z.string().regex(/^-?\d{1,14}(\.\d{1,2})?$/)`), routes mirroring `src/modules/interests/api/routes.ts`, `toApiError`, `routes.itest.ts` (create → allocation → scopes → refresh → manual usage with `Idempotency-Key` replay creates one row → viewer 403 → stale PATCH 409), `npm run openapi:generate`, README section.
- [x] **Verify / Commit:** `npm run typecheck && npm test && npm run test:integration -- budgets`; `git add src/modules/budgets/api src/platform/http/app.ts docs/api && git commit -m "feat(budgets): REST API"`

---

### Task 6: UI — Budgets pages, Home card, Vacation retirement

**Files:** Create `src/modules/budgets/ui/run.ts`, `deps.ts`, `load-budgets.ts` (+`.test.ts`), `BudgetForm.tsx`, `AllocationForm.tsx`, `ScopesForm.tsx`, `ManualUsageForm.tsx`, `AllocationsTable.tsx`, `UsagesTable.tsx`, `BudgetFigures.tsx`; `src/app/(app)/finance/budgets/page.tsx` (rewrite), `[id]/page.tsx`, `loading.tsx`; `src/app/actions/budgets.ts`. Modify `src/modules/home/cards.ts` (`"budgets"` card, `requires: { permission: "budgets.read" }`, href `/finance/budgets`, plus `cards.test.ts`), `src/app/(app)/page.tsx` (card body: count of active budgets and Σ remaining, or an empty state), `src/app/(app)/finance/vacation/page.tsx` (only `redirect("/finance/budgets")`). Delete `src/app/(app)/finance/vacation/_components/**`, `src/app/actions/vacation.ts`, `src/lib/repo/vacation.ts`, `src/lib/calc/vacation-fund.ts` (+tests).

- [x] **Step 1: Loaders** `loadBudgets()`, `loadBudgetDetail(id)` (NotFound → null), pure `activeBudgetsCard(summaries): { count: number; remaining: string | null }` (+test).
- [x] **Step 2: Pages.** List: name, period, remaining, `ProgressRing` of goal progress, status; "New budget" `Sheet` with `BudgetForm`. Detail: `BudgetFigures` (initial / allocated / used / remaining as `MoneyValue`, allocated captioned "planning value"), `TimeSeriesChart` of `series`, `AllocationsTable` (source label, amount, recurrence, dates, **Available in source** column, "End" action), `ScopesForm` (multi-select over the user's accounts, categories, labels and funds — loaders from those modules, called sequentially, never nested), `UsagesTable` (scope rows link to `/finance/expenses/${transactionId}`; manual rows have Delete), amount-version history, events list. Empty states everywhere; no zeros for missing balances.
- [x] **Step 3: Actions** in `src/app/actions/budgets.ts`: one action per use case; `revalidatePath("/finance/budgets")` and the detail path.
- [x] **Step 4: Personal settings.** In `src/app/(app)/settings/personal/page.tsx` remove the vacation-fund `SettingsSection` (and its `ledger`/`rates`/`effectiveRate` reads); in `SettingsForms.tsx` delete the two vacation forms and the `@/app/actions/vacation` import, keeping `HoursPerDayForm`. Add a one-line link "Holidays budget →" to `/finance/budgets` where the section was.
- [x] **Step 5: Delete** the vacation files; `grep -rn "repo/vacation\|calc/vacation-fund\|actions/vacation\|WithdrawalFlow" src` → nothing.
- [x] **Verify / Commit:** `npm run typecheck && npm test && npm run build` (route table has `/finance/budgets/[id]`; `/finance/vacation` present as a redirect); `git add -A src && git commit -m "feat(budgets): pages, Home card, retire the Vacation fund pages"`

---

### Task 7: Vacation ledger → Holidays budget migration

**Files:** `scripts/migrate-vacation-budget.ts`, `scripts/validate-vacation-budget-migration.ts`; `package.json` scripts `migrate:vacation`, `migrate:vacation:validate`.

- [x] **Step 1: Migration script** (idempotent, `withSystemContext`, owner resolution as in `scripts/migrate-funds.ts`):
  1. Exit 0 with "nothing to migrate" when `vacation_ledger` and `vacation_accrual_rate` are both empty.
  2. Upsert the budget `name = "Holidays"`, `period_kind = "none"`, `start_date` = earliest of the `initial` entry month and the first rate `effective_from`, `labels = ["migrated"]`, `description = "Migrated from the Vacation fund"`. Idempotency key: an existing budget with name Holidays and `labels @> '["migrated"]'`.
  3. The `initial` ledger row → amount version (`initial_amount = amount`, `effective_from = month ?? occurred_at::date`, reason `migrated`); no initial row → version `0.00` at `start_date`.
  4. Each `vacation_accrual_rate` row → allocation `{ sourceKind: "none", amount: monthly_amount, recurrence: "monthly", effectiveFrom, effectiveTo = next rate's effective_from − 1 day or null, note: "migrated accrual rate" }`.
  5. `withdrawal` rows → manual usages (`amount = |amount|`, `occurredAt = occurred_at::date`, note). `adjustment` rows → `once` allocations (signed amount, note `migrated adjustment`).
  6. R6-4: for each month from `start_date` to today compare `allocatedThrough(migrated monthly allocations, lastDay)` with Σ ledger `accrual` rows through that month; on a difference insert a `once` allocation for the difference on that month with note `migration adjustment`, and continue.
  7. Print counts.
- [x] **Step 2: Validator:** for every month, `figures(...).remaining` on the new budget must equal the legacy balance through that month (re-implement inline: initial + accruals + adjustments − withdrawals, in cents) — zero tolerance; months examined > 0; exit 1 on mismatch.
- [x] **Verify:** on the test database with a fixture (initial 500, two rates, three accruals, one withdrawal, one adjustment) both scripts run; a second migration run writes nothing; the validator prints `OK (N months examined)`.
- [x] **Commit:** `git add scripts package.json && git commit -m "feat(budgets): migrate the Vacation fund into the Holidays budget"`

---

### Task 8: Exit criteria

- [ ] `npm run typecheck && npm test && npm run test:db:up && npm run test:integration && npm run build && npm run openapi:generate && git diff --exit-code docs/api/openapi.json`.
- [ ] `grep -rn "vacation_ledger\|vacationLedger\|vacation_accrual_rate\|vacationAccrualRate" src` → only `schema/legacy.ts`.
- [ ] Runbook `docs/deploy/phase-6-runbook.md`: dump, deploy, `npm run db:migrate`, `npm run migrate:vacation`, `npm run migrate:vacation:validate`, verify `/finance/budgets` shows Holidays with the old balance as remaining; rollback = restore the dump.
- [ ] Manual walkthrough (record if owed): create a budget with initial 1000, allocate 200 monthly from a real account, confirm that account's balance on `/finance/accounts` is **unchanged** and the allocation row shows available-in-source = balance − 200; add a category scope and see a real expense appear as usage; add a manual usage; end the allocation. **Exit line (spec §11 Phase 6): virtual allocations are separated from real balances, and availability is recalculated.**
- [ ] `graphify update .` (repo root); checkpoint `docs/superpowers/handoff/2026-09-06-phase-6-checkpoint.md`; `docs/architecture/overview.md`; `.superpowers/sdd/MASTER-LEDGER.md`.
- [ ] `git add -A ../docs ../graphify-out ../.superpowers && git commit -m "docs(handoff): Phase 6 checkpoint and runbook"`

---

## Self-review against the spec

- §5.6 tables: all six ✔ (Task 1); `budget_allocations` extended with `recurrence` (R6-2) and `source_kind = 'none'` (R6-1). Derived figures ✔ (Task 2), availability ✔, "planning value" label ✔ (Task 6).
- §7.5: Holidays budget ✔ (Task 7); withdrawals → manual usages ✔; accrual rate → monthly allocation ✔. "Scoped to the Holidays account": no such account exists in the data; the migration sets no scope, and the runbook's walkthrough adds one if the user creates the account.
- §4 routes ✔; §7.1 Home card ✔; §11 exit ✔ (Task 8); §12.7 ✔.
- Type consistency: `AllocationLike` (domain) is the base of `Allocation` (port); `ScopeLike`/`TransactionLike` are shared by domain, ports and the scope source; `BudgetFigures` is the wire shape of `BudgetFiguresSchema`; `OwnershipCheck` and `SourceLabels` are both declared in `ports.ts` (Task 3 adds `OwnershipCheck`; Task 4 adds `SourceLabels`).
