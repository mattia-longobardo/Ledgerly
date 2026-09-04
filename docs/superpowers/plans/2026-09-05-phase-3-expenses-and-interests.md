# Phase 3: Expenses and Interests

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Sync Wallet transactions through the existing integration framework with an incremental cursor, replace the Expenses and Interests setup states with real modules (transactions/categories/labels, recurring-pattern detection, interest rules/accruals/entries with reconciliation and projections), and add an optional per-rule interest-posting adapter — analysis-only by default, per spec §13.2.

**Architecture:** Two new peer domain modules, `src/modules/expenses/` and `src/modules/interests/`, built in the exact shape of `src/modules/accounts/` (`domain/`, `application/` with `ports.ts`, `infrastructure/` with Drizzle and memory repositories, `api/`, `ui/`) — a flat `UseCaseDeps` bag per module, RLS context opened once by the caller via `withUserContext`/`withSystemContext`, never inside a use case. Wallet transactions become a new `SyncKind` on the existing `walletProvider` (`src/modules/integrations/infrastructure/wallet-provider-adapter.ts`), running through the unmodified sync engine (`run-sync.ts`) with a two-phase fetch/apply handler and a persisted cursor. Interest accrual is a new job (`src/lib/jobs/interest-accrual.ts`) in the shape of `monthly-close.ts`: passive, idempotent, one `job_runs` row per tick, iterating every user who has a rule rather than a single owner.

**Tech Stack:** Next.js 16.3, React 19, TypeScript 5.7 strict, Drizzle ORM 0.45 + drizzle-kit 0.31, Postgres 18, Zod 4, Hono 4 + `@hono/zod-openapi` 1.x, vitest 3, Playwright.

**Spec:** `docs/superpowers/specs/2026-09-02-finance-company-platform-design.md` (§4 page map, §5.4 transactions, §5.7 interests, §6 integration framework, §7.6 interests reuse/change/deprecate, §7.7 expenses, §11 Phase 3, §13.2 posting default).

## Global Constraints

- All UI copy, labels, errors and docs in English.
- **No new required environment variables this phase.** `WALLET_API_URL` already exists and needs no change; interest-rule parameters (rate, tax rate, day count) live in `interest_rules` rows, not env vars — this is a deliberate change from the legacy `interest.py`, which read them from the environment.
- Cookie-authenticated `/api/v1` mutations require the `X-Requested-With` header with any non-empty value, else `403 csrf_required` — already enforced globally in `src/platform/http/app.ts`; no route in this plan is exempt.
- Module layout: use cases in `src/modules/<domain>/application`, ports in `ports.ts`, Drizzle and memory repositories in `infrastructure/`, Hono routes in `api/`, loaders and components in `ui/`. UI and API call the same use cases.
- **Two distinct deps-bag shapes already coexist in this codebase and this plan uses both, on purpose, matching what each module already does:**
  - `src/modules/accounts/` and (per this plan) `src/modules/expenses/` and `src/modules/interests/` use a **flat `UseCaseDeps` bag** (`{ <repositories>, clock, audit }`, no `db`, no context-opening method). RLS context is opened exactly once by the *caller* — an API route handler, a job, or a `ui/run.ts`-style helper — via `withUserContext`/`withSystemContext` from `src/platform/db/context.ts`, which then constructs a fresh deps bag bound to that transaction (e.g. `expenseDeps(tx)`). A use case in these modules never imports `withUserContext` itself.
  - `src/modules/integrations/` uses `IntegrationDeps`, which carries its own bound `inUserContext`/`inSystemContext` methods and is *not* touched by this plan except to add the `transactions` `SyncKind` and its handler — the existing pattern there is not changed.
  - Whichever shape a task's file is in, **no provider round trip ever happens inside an open database transaction.** The Wallet transactions sync handler follows this exactly like the existing accounts handler: `fetch` gets no `db`, `apply` gets one.
- **`withUserContext`/`withSystemContext` are called sequentially, never nested** — both open a transaction on the same pool.
- **Provider names appear only in `*-adapter.ts`.** This plan adds `src/modules/expenses/infrastructure/wallet-transactions-adapter.ts` and `src/modules/interests/infrastructure/wallet-interest-posting-adapter.ts` to the existing allow-list (`wallet-provider-adapter.ts`, `trek-provider-adapter.ts`, `wallet-adapter.ts`). Nothing else names a Wallet field.
- Use cases take a `Principal` and assert a permission (`src/platform/auth/permissions.ts`); RLS is the second wall. New tables carry `user_id` (directly, or reached by an `EXISTS` join through a table that does) and `FORCE ROW LEVEL SECURITY` with policies of the shape `app_is_system() OR user_id = app_current_user_id()`.
- New tables use `uuid` primary keys defaulting to `uuidv7()` and carry `created_at`/`updated_at` timestamptz (`defaultNow()`; there is no update trigger anywhere in this codebase — the application sets `updated_at` on every write, matching every existing module). Every mutable entity carries `version integer not null default 1`; a PATCH requires the expected version (`If-Match` header or body `version`, via `src/platform/http/versioning.ts`'s existing `parseExpectedVersion`) and answers `409 version_mismatch` on conflict — never swallowed.
- **Never invent financial data.** A transaction the sync has not yet fetched, a rule with no accrual yet, an account with no balance — every one of these renders an empty state, never a zero. The Expenses and Interests pages keep their existing "Connect Wallet" empty state (`src/components/ui/EmptyState`) when `Capabilities.features.expenses` / `.interests` is `false` — this plan only replaces what renders when it is `true`.
- **Migrations:** from `dashboard-app/`, run `npm run db:generate` (this repo's `drizzle-kit generate` has no `--name` flag wired up; it auto-names the file from a word list), then rename the output to a descriptive name, then append RLS statements by hand, one per `--> statement-breakpoint`, exactly as `drizzle/0006_accounts.sql` does. **The next migration number is `0011`**; this plan adds `0011_transactions.sql` and `0012_interests.sql`. Neither migration needs a hand-crafted snapshot (unlike Phase 2's RLS-only `0009`) — both add real tables, so `drizzle-kit generate` produces a correct snapshot on its own; only the RLS block is appended by hand afterward.
- **`docs/api/openapi.json` is regenerated in the same task that changes a route** (`npm run openapi:generate`), so the OpenAPI drift test (`src/platform/http/openapi-drift.test.ts`) is green at every commit. No task ends on a knowingly-red suite.
- Unit tests are `*.test.ts` next to the source and run with `npm test`. Integration tests are `*.itest.ts`, run with `npm run test:db:up && npm run test:integration`, and use the shared harnesses already in the repo: `src/test/db.ts` (`testDb`/`resetDb`/`closeDb`) and `src/test/principal.ts` (`testPrincipal`) for the accounts-shaped modules (expenses, interests); `src/test/integration-deps.ts` (`testIntegrationDeps`) only for the one task that touches the integrations module itself. Never hand-roll a `makeDeps`.
- **Whenever a memory repository is written, it is tested against the same filtering, ordering and conflict-upsert semantics as its Drizzle counterpart, in the same task** (Phase 2's ledger records three separate bugs from these two implementations diverging — `list()` ordering, a status filter, and a conflict target — each caught late). Every repository pair in this plan (transactions, categories, labels, recurring patterns, interest rules, interest accruals, interest entries) gets an explicit "same order as Drizzle" assertion in its unit test, not just an assertion that both return the right rows.
- **A signature change and every one of its call sites land in the same task.** The one signature change in this plan — widening `ProviderLinksRepository`'s `entityType` parameter from the literal `"account"` to a union — is Task 2, and Task 2 updates the port, both repository implementations, and every existing call site that passes the literal `"account"`, in one commit.
- Dead exports and casts used to silence a type error do not survive review; none are planned here.
- Do not create git branches or worktrees (a project hook blocks it). Commit on the checked-out branch after every task.
- Run `graphify update .` once, after the last task, not per task (Phase 2 Ruling P2-C15: per-task updates produced an unreviewable 9.5 MB diff).
- All commands run from `dashboard-app/` unless stated otherwise. Every commit message ends with the executing agent's own `Co-Authored-By:` trailer (and a `Claude-Session:` line if the harness provides one) — this plan does not hardcode one model's trailer.

---

## File Structure

Every file this phase creates or modifies, relative to `dashboard-app/` unless stated otherwise.

```
Migrations and schema
  drizzle/0011_transactions.sql                                     transactions, categories, labels, join table, recurring_patterns + RLS
  drizzle/0012_interests.sql                                        interest_rules, interest_accruals, interest_entries + RLS
  src/lib/db/schema/transactions.ts                                 Drizzle tables: transactionCategories, transactionLabels, transactions, transactionLabelLinks, recurringPatterns
  src/lib/db/schema/interests.ts                                    Drizzle tables: interestRules, interestAccruals, interestEntries
  src/lib/db/schema/index.ts (modify)                                re-export the two new schema files
  src/lib/db/transactions-rls.itest.ts                              RLS proof for the transactions tables
  src/lib/db/interests-rls.itest.ts                                 RLS proof for the interests tables

Cross-cutting widening (Task 2)
  src/modules/accounts/application/ports.ts (modify)                ProviderLink.entityType widened to "account" | "transaction" | "category" | "label"
  src/modules/accounts/infrastructure/drizzle-provider-links-repository.ts (modify)   same widening, same methods
  src/modules/accounts/infrastructure/memory-repositories.ts (modify)                 same widening in MemoryProviderLinksRepository
  src/modules/accounts/infrastructure/*.test.ts, repositories.itest.ts (modify)       call sites updated to pass the widened type where relevant

Wallet client (Task 6)
  src/lib/clients/wallet.ts (modify)                                getRecords, getCategories, postRecords
  src/lib/clients/wallet.test.ts (modify)                            tests for the three new functions

Expenses module
  src/modules/expenses/domain/transaction.ts                        Transaction, TransactionCategory, TransactionLabel types; pairTransfers
  src/modules/expenses/domain/transaction.test.ts
  src/modules/expenses/domain/recurring.ts                          detectRecurring pure function
  src/modules/expenses/domain/recurring.test.ts
  src/modules/expenses/application/ports.ts                         TransactionsRepository, CategoriesRepository, LabelsRepository, RecurringPatternsRepository, TransactionsSource
  src/modules/expenses/application/deps.ts                          UseCaseDeps
  src/modules/expenses/application/errors.ts                        NotFoundError, VersionMismatchError, InvalidInputError
  src/modules/expenses/application/list-transactions.ts             listTransactions
  src/modules/expenses/application/get-transaction.ts                getTransaction
  src/modules/expenses/application/update-transaction.ts             updateTransaction
  src/modules/expenses/application/list-categories.ts                 listCategories
  src/modules/expenses/application/list-labels.ts                     listLabels
  src/modules/expenses/application/sync-provider-transactions.ts     syncProviderTransactions (mirrors sync-provider-accounts.ts)
  src/modules/expenses/application/detect-recurring-patterns.ts      detectRecurringPatterns use case, persists to recurring_patterns
  src/modules/expenses/application/*.test.ts                        one per use case above
  src/modules/expenses/infrastructure/memory-repositories.ts         Memory* for all four repositories
  src/modules/expenses/infrastructure/memory-repositories.test.ts
  src/modules/expenses/infrastructure/drizzle-transactions-repository.ts
  src/modules/expenses/infrastructure/drizzle-categories-repository.ts
  src/modules/expenses/infrastructure/drizzle-labels-repository.ts
  src/modules/expenses/infrastructure/drizzle-recurring-repository.ts
  src/modules/expenses/infrastructure/deps.ts                        expenseDeps(tx, requestId) factory
  src/modules/expenses/infrastructure/wallet-transactions-adapter.ts  mapWalletRecord, mapWalletCategory, walletTransactionsSource, prefetchedWalletTransactionsSource
  src/modules/expenses/infrastructure/repositories.itest.ts
  src/modules/expenses/api/schemas.ts                                DTO + request Zod schemas
  src/modules/expenses/api/routes.ts                                 registerExpenseRoutes
  src/modules/expenses/api/routes.itest.ts
  src/modules/expenses/ui/run.ts                                     runForPrincipal (accounts' ui/run.ts pattern)
  src/modules/expenses/ui/deps.ts                                    re-exports
  src/modules/expenses/ui/load-transactions.ts                       page loaders
  src/modules/expenses/ui/TransactionsTable.tsx
  src/modules/expenses/ui/TransactionEditForm.tsx
  src/app/(app)/finance/expenses/page.tsx (modify)                   real list page behind the existing capability gate
  src/app/(app)/finance/expenses/loading.tsx
  src/app/(app)/finance/expenses/[transactionId]/page.tsx
  src/app/(app)/finance/expenses/[transactionId]/loading.tsx
  src/app/actions/expenses.ts                                       server action wrapping updateTransaction

Integrations: transactions as a SyncKind (Tasks 7-8)
  src/platform/integrations/types.ts (modify)                       SyncKind gains "transactions"
  src/modules/integrations/api/schemas.ts (modify)                  the two hardcoded SyncKind enums gain "transactions"
  src/modules/integrations/infrastructure/wallet-provider-adapter.ts (modify)   transactionsSync handler added to walletProvider.syncs; capabilities unchanged (already declared)
  src/modules/integrations/infrastructure/wallet-provider-adapter.test.ts (modify)
  docs/api/openapi.json (regenerated)

Interests module
  src/modules/interests/domain/accrual.ts                           dailyInterest, projectInterest (ported from interest.py)
  src/modules/interests/domain/accrual.test.ts
  src/modules/interests/domain/reconciliation.ts                    reconcileInterest
  src/modules/interests/domain/reconciliation.test.ts
  src/modules/interests/application/ports.ts                        InterestRulesRepository, InterestAccrualsRepository, InterestEntriesRepository, AccountBalancesPort
  src/modules/interests/application/deps.ts                         UseCaseDeps
  src/modules/interests/application/errors.ts
  src/modules/interests/application/create-interest-rule.ts
  src/modules/interests/application/update-interest-rule.ts
  src/modules/interests/application/list-interest-rules.ts
  src/modules/interests/application/get-interest-rule-detail.ts     rule + accruals + entries + reconciliation + projection
  src/modules/interests/application/run-interest-accrual.ts         one day, one rule, idempotent
  src/modules/interests/application/post-interest-entry.ts          optional posting, per-rule switch
  src/modules/interests/application/*.test.ts
  src/modules/interests/infrastructure/memory-repositories.ts
  src/modules/interests/infrastructure/memory-repositories.test.ts
  src/modules/interests/infrastructure/drizzle-interest-rules-repository.ts
  src/modules/interests/infrastructure/drizzle-interest-accruals-repository.ts
  src/modules/interests/infrastructure/drizzle-interest-entries-repository.ts
  src/modules/interests/infrastructure/deps.ts                      interestDeps(tx, requestId) factory
  src/modules/interests/infrastructure/wallet-interest-posting-adapter.ts   postWalletInterestEntry (the only file naming a Wallet field for posting)
  src/modules/interests/infrastructure/repositories.itest.ts
  src/modules/interests/api/schemas.ts
  src/modules/interests/api/routes.ts                                registerInterestRoutes
  src/modules/interests/api/routes.itest.ts
  src/modules/interests/ui/run.ts, deps.ts, load-interests.ts
  src/modules/interests/ui/RulesTable.tsx, RuleForm.tsx, RuleDetail.tsx
  src/app/(app)/finance/interests/page.tsx (modify)
  src/app/(app)/finance/interests/loading.tsx
  src/app/(app)/finance/interests/rules/[id]/page.tsx
  src/app/(app)/finance/interests/rules/[id]/loading.tsx
  src/app/actions/interests.ts

Job
  src/lib/contracts.ts (modify)                                     JobName gains "interest_accrual"
  src/lib/jobs/interest-accrual.ts                                  runInterestAccrual, mirrors monthly-close.ts
  src/lib/jobs/interest-accrual.test.ts
  src/platform/jobs/register-all.ts (modify)                        registers interest_accrual on the daily tier

Docs
  docs/architecture/overview.md (modify)                            adds the two new modules and the transactions SyncKind
  docs/api/README.md (modify)                                       Expenses and Interests sections
  docs/integrations/README.md (modify)                              documents the transactions SyncKind and the posting adapter
  docs/deploy/phase-3-runbook.md                                    deployment steps, manual walkthrough checklist
  docs/migration/wallet-manager-cutover.md                          the retirement procedure for the standalone interest.py container
  docs/superpowers/handoff/2026-09-05-phase-3-checkpoint.md         written by the exit-criteria task
  docs/superpowers/handoff/2026-09-05-phase-3-ledger.md             written by the exit-criteria task
```

---

### Task 1: Migration 0011 — transactions, categories, labels, recurring patterns

**Files:**
- Create: `src/lib/db/schema/transactions.ts`
- Modify: `src/lib/db/schema/index.ts`
- Create: `drizzle/0011_transactions.sql` (generated, then hand-edited)
- Create: `src/lib/db/transactions-rls.itest.ts`

**Interfaces:**
- Consumes: `users` from `./identity`, `accounts` from `./accounts` (existing).
- Produces:
```ts
export const transactionCategories: PgTable; // id, userId, name, groupName, kind, color, parentId, source, archivedAt, createdAt, updatedAt
export const transactionLabels: PgTable;      // id, userId, name, color, source, createdAt, updatedAt
export const transactions: PgTable;           // id, userId, accountId, occurredAt, bookedAt, amount, currency, type, state, categoryId, payee, note, transferGroupId, source, syncRunId, version, createdAt, updatedAt
export const transactionLabelLinks: PgTable;  // transactionId, labelId (composite PK)
export const recurringPatterns: PgTable;      // id, userId, payee, cadence, amountLow, amountHigh, currency, lastSeenAt, nextExpectedAt, occurrenceCount, createdAt, updatedAt
export type TransactionCategoryRow = typeof transactionCategories.$inferSelect;
export type TransactionLabelRow = typeof transactionLabels.$inferSelect;
export type TransactionRow = typeof transactions.$inferSelect;
export type RecurringPatternRow = typeof recurringPatterns.$inferSelect;
```

- [ ] **Step 1: Write the failing RLS test**

```ts
// src/lib/db/transactions-rls.itest.ts
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { closeDb, resetDb, testDb } from "@/test/db";
import { accounts, organizations, transactions, users } from "@/lib/db/schema";
import { withSystemContext, withUserContext } from "@/platform/db/context";

describe("transactions RLS", () => {
  beforeEach(resetDb);
  afterAll(closeDb);

  it("a user sees only their own transactions; system sees all; no context sees none", async () => {
    const db = await testDb();
    const [org] = await db.insert(organizations).values({ name: "P" }).returning();
    const [a] = await db.insert(users).values({ organizationId: org!.id, displayName: "A" }).returning();
    const [b] = await db.insert(users).values({ organizationId: org!.id, displayName: "B" }).returning();
    const [accA] = await withSystemContext(db, (tx) =>
      tx.insert(accounts).values({ userId: a!.id, name: "A cash", type: "cash", origin: "manual" }).returning(),
    );
    const [accB] = await withSystemContext(db, (tx) =>
      tx.insert(accounts).values({ userId: b!.id, name: "B cash", type: "cash", origin: "manual" }).returning(),
    );
    await withSystemContext(db, (tx) =>
      tx.insert(transactions).values([
        { userId: a!.id, accountId: accA!.id, occurredAt: new Date(), amount: "-10.00", type: "expense" },
        { userId: b!.id, accountId: accB!.id, occurredAt: new Date(), amount: "-20.00", type: "expense" },
      ]),
    );
    const mine = await withUserContext(db, { userId: a!.id }, (tx) => tx.select().from(transactions));
    expect(mine.map((r) => r.amount)).toEqual(["-10.00"]);
    expect((await withSystemContext(db, (tx) => tx.select().from(transactions))).length).toBe(2);
    expect(await db.select().from(transactions)).toEqual([]);
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `npm run test:db:up && npm run test:integration -- transactions-rls`
Expected: FAIL — `relation "transactions" does not exist`.

- [ ] **Step 3: Write the Drizzle schema**

```ts
// src/lib/db/schema/transactions.ts
import { check, index, integer, pgTable, primaryKey, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { numeric } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { users } from "./identity";
import { accounts } from "./accounts";

const tz = (n: string) => timestamp(n, { withTimezone: true, mode: "date" });
const id = () => uuid("id").primaryKey().default(sql`uuidv7()`);
const money = (n: string) => numeric(n, { precision: 16, scale: 2 });

export const transactionCategories = pgTable(
  "transaction_categories",
  {
    id: id(),
    userId: uuid("user_id").notNull().references(() => users.id),
    name: text("name").notNull(),
    groupName: text("group_name"),
    kind: text("kind").notNull().default("expense"),
    color: text("color"),
    // Not FK-constrained: a self-reference would need a circular Drizzle type,
    // and no Phase 3 use case reads a category hierarchy. Enforced at the
    // application layer once a later phase manages one.
    parentId: uuid("parent_id"),
    source: text("source").notNull().default("manual"),
    archivedAt: tz("archived_at"),
    createdAt: tz("created_at").notNull().defaultNow(),
    updatedAt: tz("updated_at").notNull().defaultNow(),
  },
  (t) => [
    check("transaction_categories_kind_ck", sql`${t.kind} IN ('income','expense','transfer','system')`),
    check("transaction_categories_source_ck", sql`${t.source} IN ('manual','provider','system','migration')`),
    uniqueIndex("transaction_categories_user_name_uq").on(t.userId, t.name),
  ],
);

export const transactionLabels = pgTable(
  "transaction_labels",
  {
    id: id(),
    userId: uuid("user_id").notNull().references(() => users.id),
    name: text("name").notNull(),
    color: text("color"),
    source: text("source").notNull().default("manual"),
    createdAt: tz("created_at").notNull().defaultNow(),
    updatedAt: tz("updated_at").notNull().defaultNow(),
  },
  (t) => [
    check("transaction_labels_source_ck", sql`${t.source} IN ('manual','provider','system','migration')`),
    uniqueIndex("transaction_labels_user_name_uq").on(t.userId, t.name),
  ],
);

export const transactions = pgTable(
  "transactions",
  {
    id: id(),
    userId: uuid("user_id").notNull().references(() => users.id),
    accountId: uuid("account_id").notNull().references(() => accounts.id, { onDelete: "cascade" }),
    occurredAt: tz("occurred_at").notNull(),
    bookedAt: tz("booked_at"),
    amount: money("amount").notNull(),
    currency: text("currency").notNull().default("EUR"),
    type: text("type").notNull().default("expense"),
    state: text("state").notNull().default("cleared"),
    categoryId: uuid("category_id").references(() => transactionCategories.id, { onDelete: "set null" }),
    payee: text("payee"),
    note: text("note"),
    transferGroupId: uuid("transfer_group_id"),
    source: text("source").notNull().default("manual"),
    // No FK, matching account_balances.sync_run_id's existing precedent: the
    // integrations module owns sync_runs and this table does not depend on it.
    syncRunId: uuid("sync_run_id"),
    version: integer("version").notNull().default(1),
    createdAt: tz("created_at").notNull().defaultNow(),
    updatedAt: tz("updated_at").notNull().defaultNow(),
  },
  (t) => [
    check("transactions_type_ck", sql`${t.type} IN ('income','expense','transfer')`),
    check("transactions_state_ck", sql`${t.state} IN ('pending','cleared','reconciled')`),
    check("transactions_currency_ck", sql`char_length(${t.currency}) = 3`),
    index("transactions_user_occurred_idx").on(t.userId, t.occurredAt.desc()),
    index("transactions_account_occurred_idx").on(t.accountId, t.occurredAt.desc()),
    index("transactions_user_category_idx").on(t.userId, t.categoryId, t.occurredAt),
  ],
);

export const transactionLabelLinks = pgTable(
  "transaction_label_links",
  {
    transactionId: uuid("transaction_id").notNull().references(() => transactions.id, { onDelete: "cascade" }),
    labelId: uuid("label_id").notNull().references(() => transactionLabels.id, { onDelete: "cascade" }),
  },
  (t) => [primaryKey({ columns: [t.transactionId, t.labelId] })],
);

export const recurringPatterns = pgTable(
  "recurring_patterns",
  {
    id: id(),
    userId: uuid("user_id").notNull().references(() => users.id),
    payee: text("payee").notNull(),
    cadence: text("cadence").notNull(),
    amountLow: money("amount_low").notNull(),
    amountHigh: money("amount_high").notNull(),
    currency: text("currency").notNull().default("EUR"),
    lastSeenAt: tz("last_seen_at").notNull(),
    nextExpectedAt: tz("next_expected_at"),
    occurrenceCount: integer("occurrence_count").notNull().default(0),
    createdAt: tz("created_at").notNull().defaultNow(),
    updatedAt: tz("updated_at").notNull().defaultNow(),
  },
  (t) => [
    check("recurring_patterns_cadence_ck", sql`${t.cadence} IN ('weekly','biweekly','monthly','quarterly','annual')`),
    uniqueIndex("recurring_patterns_user_payee_uq").on(t.userId, t.payee),
  ],
);

export type TransactionCategoryRow = typeof transactionCategories.$inferSelect;
export type TransactionLabelRow = typeof transactionLabels.$inferSelect;
export type TransactionRow = typeof transactions.$inferSelect;
export type RecurringPatternRow = typeof recurringPatterns.$inferSelect;
```

Add to `src/lib/db/schema/index.ts`:
```ts
export * from "./transactions";
```

- [ ] **Step 4: Generate the migration, rename it, append RLS by hand**

Run: `npm run db:generate`
This writes a new file under `drizzle/` with an auto-generated name (e.g. `drizzle/0011_<random>.sql`). Rename it:
```bash
mv drizzle/0011_*.sql drizzle/0011_transactions.sql
```
Append to the end of `drizzle/0011_transactions.sql` (each statement its own `--> statement-breakpoint`, exactly as `drizzle/0006_accounts.sql` does):
```sql
--> statement-breakpoint
ALTER TABLE transaction_categories ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE transaction_categories FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY transaction_categories_owner ON transaction_categories
  USING (app_is_system() OR user_id = app_current_user_id())
  WITH CHECK (app_is_system() OR user_id = app_current_user_id());
--> statement-breakpoint
ALTER TABLE transaction_labels ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE transaction_labels FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY transaction_labels_owner ON transaction_labels
  USING (app_is_system() OR user_id = app_current_user_id())
  WITH CHECK (app_is_system() OR user_id = app_current_user_id());
--> statement-breakpoint
ALTER TABLE transactions ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE transactions FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY transactions_owner ON transactions
  USING (app_is_system() OR user_id = app_current_user_id())
  WITH CHECK (app_is_system() OR user_id = app_current_user_id());
--> statement-breakpoint
ALTER TABLE transaction_label_links ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE transaction_label_links FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY transaction_label_links_owner ON transaction_label_links
  USING (app_is_system() OR EXISTS (
    SELECT 1 FROM transactions t WHERE t.id = transaction_id AND t.user_id = app_current_user_id()
  ))
  WITH CHECK (app_is_system() OR EXISTS (
    SELECT 1 FROM transactions t WHERE t.id = transaction_id AND t.user_id = app_current_user_id()
  ));
--> statement-breakpoint
ALTER TABLE recurring_patterns ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE recurring_patterns FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY recurring_patterns_owner ON recurring_patterns
  USING (app_is_system() OR user_id = app_current_user_id())
  WITH CHECK (app_is_system() OR user_id = app_current_user_id());
```

- [ ] **Step 5: Apply the migration and run the test**

Run: `npm run db:migrate && npm run test:integration -- transactions-rls`
Expected: PASS.

- [ ] **Step 6: Typecheck**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 7: Commit**

```bash
git add drizzle/0011_transactions.sql drizzle/meta src/lib/db/schema/transactions.ts src/lib/db/schema/index.ts src/lib/db/transactions-rls.itest.ts
git commit -m "feat(db): add transactions, categories, labels and recurring_patterns with RLS"
```

---

### Task 2: Widen `ProviderLinksRepository.entityType` for transactions, categories and labels

**Files:**
- Modify: `src/modules/accounts/application/ports.ts`
- Modify: `src/modules/accounts/infrastructure/drizzle-provider-links-repository.ts`
- Modify: `src/modules/accounts/infrastructure/memory-repositories.ts`
- Modify: `src/modules/accounts/infrastructure/repositories.itest.ts` (add one widened-type case)

**Interfaces:**
- Consumes: `providerLinks` Drizzle table (unchanged — `entity_type` is already a plain `text` column with no CHECK constraint, confirmed by reading `src/lib/db/schema/accounts.ts`; this task is TypeScript-only, no migration).
- Produces:
```ts
export type ProviderLinkEntityType = "account" | "transaction" | "category" | "label";
export interface ProviderLink {
  provider: string;
  entityType: ProviderLinkEntityType; // was: "account"
  entityId: string;
  externalId: string;
  metadata: Record<string, unknown>;
  missingSince: Date | null;
}
export interface ProviderLinksRepository {
  byExternal(userId: string, provider: string, entityType: ProviderLinkEntityType, externalIds: string[]): Promise<Map<string, ProviderLink>>;
  liveFor(entityType: ProviderLinkEntityType, entityId: string): Promise<ProviderLink | null>;
  upsertSeen(userId: string, link: Omit<ProviderLink, "missingSince">, seenAt: Date): Promise<void>;
  markMissing(userId: string, provider: string, entityType: ProviderLinkEntityType, seenExternalIds: string[], at: Date): Promise<string[]>;
}
```
Every existing call site in `src/modules/accounts/**` and `src/modules/integrations/infrastructure/wallet-provider-adapter.ts` already passes the literal `"account"`, which is assignable to the widened union without any call-site edit — confirmed by grepping every call site below before writing this task.

- [ ] **Step 1: Write the failing test — a non-account entity type round-trips**

```ts
// src/modules/accounts/infrastructure/memory-repositories.test.ts (add to the existing ProviderLinks describe block)
it("round-trips a non-account entity type", async () => {
  const repo = new MemoryProviderLinksRepository();
  const now = new Date("2026-09-05T00:00:00Z");
  await repo.upsertSeen(
    "user-1",
    { provider: "wallet", entityType: "transaction", entityId: "tx-1", externalId: "ext-1", metadata: {} },
    now,
  );
  const found = await repo.byExternal("user-1", "wallet", "transaction", ["ext-1"]);
  expect(found.get("ext-1")?.entityType).toBe("transaction");
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `npm test -- memory-repositories`
Expected: FAIL — TypeScript error, `"transaction"` is not assignable to `"account"`.

- [ ] **Step 3: Widen the port**

In `src/modules/accounts/application/ports.ts`, replace every literal `"account"` type in the `ProviderLink`/`ProviderLinksRepository` block with:
```ts
export type ProviderLinkEntityType = "account" | "transaction" | "category" | "label";

export interface ProviderLink {
  provider: string;
  entityType: ProviderLinkEntityType;
  entityId: string;
  externalId: string;
  metadata: Record<string, unknown>;
  missingSince: Date | null;
}

export interface ProviderLinksRepository {
  byExternal(userId: string, provider: string, entityType: ProviderLinkEntityType, externalIds: string[]): Promise<Map<string, ProviderLink>>;
  liveFor(entityType: ProviderLinkEntityType, entityId: string): Promise<ProviderLink | null>;
  upsertSeen(userId: string, link: Omit<ProviderLink, "missingSince">, seenAt: Date): Promise<void>;
  markMissing(userId: string, provider: string, entityType: ProviderLinkEntityType, seenExternalIds: string[], at: Date): Promise<string[]>;
}
```

- [ ] **Step 4: Widen both implementations**

In `src/modules/accounts/infrastructure/drizzle-provider-links-repository.ts`, replace every `entityType: "account"` parameter type with `entityType: ProviderLinkEntityType` (import the type), and in `toLink()` replace `row.entityType as "account"` with `row.entityType as ProviderLinkEntityType`.

In `src/modules/accounts/infrastructure/memory-repositories.ts`, replace every `entityType: "account"` parameter type in `MemoryProviderLinksRepository`'s methods with `entityType: ProviderLinkEntityType` (import the type).

- [ ] **Step 5: Run the test suite and typecheck**

Run: `npm test -- memory-repositories && npx tsc --noEmit`
Expected: PASS, no type errors.

- [ ] **Step 6: Run the accounts integration suite to confirm nothing regressed**

Run: `npm run test:db:up && npm run test:integration -- accounts`
Expected: PASS (unchanged behavior for `entityType: "account"`).

- [ ] **Step 7: Commit**

```bash
git add src/modules/accounts/application/ports.ts src/modules/accounts/infrastructure/drizzle-provider-links-repository.ts src/modules/accounts/infrastructure/memory-repositories.ts src/modules/accounts/infrastructure/memory-repositories.test.ts
git commit -m "refactor(accounts): widen ProviderLinksRepository.entityType for transactions, categories and labels"
```

---

### Task 3: Expenses domain — types, transfer pairing, recurring detection

**Files:**
- Create: `src/modules/expenses/domain/transaction.ts`
- Create: `src/modules/expenses/domain/transaction.test.ts`
- Create: `src/modules/expenses/domain/recurring.ts`
- Create: `src/modules/expenses/domain/recurring.test.ts`

**Interfaces:**
- Consumes: nothing (pure domain layer, no IO, mirrors `src/modules/accounts/domain/account.ts`).
- Produces:
```ts
export type TransactionType = "income" | "expense" | "transfer";
export type TransactionState = "pending" | "cleared" | "reconciled";
export type CategoryKind = "income" | "expense" | "transfer" | "system";
export type RecordSource = "manual" | "provider" | "system" | "migration";

export interface Transaction {
  id: string; userId: string; accountId: string; occurredAt: Date; bookedAt: Date | null;
  amount: string; currency: string; type: TransactionType; state: TransactionState;
  categoryId: string | null; payee: string | null; note: string | null;
  transferGroupId: string | null; source: RecordSource; syncRunId: string | null;
  version: number; createdAt: Date; updatedAt: Date;
}
export interface TransactionCategory {
  id: string; userId: string; name: string; groupName: string | null; kind: CategoryKind;
  color: string | null; parentId: string | null; source: RecordSource; archivedAt: Date | null;
  createdAt: Date; updatedAt: Date;
}
export interface TransactionLabel {
  id: string; userId: string; name: string; color: string | null; source: RecordSource;
  createdAt: Date; updatedAt: Date;
}
export interface TransferCandidate { id: string; accountId: string; amount: string; occurredAt: Date; externalTransferRef: string | null; }
export function pairTransfers(candidates: readonly TransferCandidate[]): Map<string, string>;

export type Cadence = "weekly" | "biweekly" | "monthly" | "quarterly" | "annual";
export interface RecurringCandidate { payee: string; amount: string; currency: string; occurredAt: Date; }
export interface DetectedPattern {
  payee: string; cadence: Cadence; amountLow: string; amountHigh: string; currency: string;
  lastSeenAt: Date; nextExpectedAt: Date; occurrenceCount: number;
}
export function detectRecurring(transactions: readonly RecurringCandidate[]): DetectedPattern[];
```

- [ ] **Step 1: Write the failing test for transfer pairing**

```ts
// src/modules/expenses/domain/transaction.test.ts
import { describe, expect, it } from "vitest";
import { pairTransfers, type TransferCandidate } from "./transaction";

describe("pairTransfers", () => {
  it("pairs two legs sharing an external transfer reference, deterministically", () => {
    const candidates: TransferCandidate[] = [
      { id: "11111111-0000-7000-8000-000000000001", accountId: "acc-a", amount: "-50.00", occurredAt: new Date("2026-09-01"), externalTransferRef: "xfer-1" },
      { id: "22222222-0000-7000-8000-000000000002", accountId: "acc-b", amount: "50.00", occurredAt: new Date("2026-09-01"), externalTransferRef: "xfer-1" },
      { id: "33333333-0000-7000-8000-000000000003", accountId: "acc-c", amount: "-10.00", occurredAt: new Date("2026-09-01"), externalTransferRef: null },
    ];
    const groups = pairTransfers(candidates);
    expect(groups.get("11111111-0000-7000-8000-000000000001")).toBe("11111111-0000-7000-8000-000000000001");
    expect(groups.get("22222222-0000-7000-8000-000000000002")).toBe("11111111-0000-7000-8000-000000000001");
    expect(groups.has("33333333-0000-7000-8000-000000000003")).toBe(false);
  });

  it("does not pair a lone leg even if it carries a reference", () => {
    const candidates: TransferCandidate[] = [
      { id: "id-1", accountId: "acc-a", amount: "-50.00", occurredAt: new Date(), externalTransferRef: "xfer-solo" },
    ];
    expect(pairTransfers(candidates).size).toBe(0);
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `npm test -- transaction.test`
Expected: FAIL — `Cannot find module './transaction'`.

- [ ] **Step 3: Implement the domain types and `pairTransfers`**

```ts
// src/modules/expenses/domain/transaction.ts
export type TransactionType = "income" | "expense" | "transfer";
export type TransactionState = "pending" | "cleared" | "reconciled";
export type CategoryKind = "income" | "expense" | "transfer" | "system";
export type RecordSource = "manual" | "provider" | "system" | "migration";

export interface Transaction {
  id: string;
  userId: string;
  accountId: string;
  occurredAt: Date;
  bookedAt: Date | null;
  amount: string;
  currency: string;
  type: TransactionType;
  state: TransactionState;
  categoryId: string | null;
  payee: string | null;
  note: string | null;
  transferGroupId: string | null;
  source: RecordSource;
  syncRunId: string | null;
  version: number;
  createdAt: Date;
  updatedAt: Date;
}

export interface TransactionCategory {
  id: string;
  userId: string;
  name: string;
  groupName: string | null;
  kind: CategoryKind;
  color: string | null;
  parentId: string | null;
  source: RecordSource;
  archivedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface TransactionLabel {
  id: string;
  userId: string;
  name: string;
  color: string | null;
  source: RecordSource;
  createdAt: Date;
  updatedAt: Date;
}

export interface TransferCandidate {
  id: string;
  accountId: string;
  amount: string;
  occurredAt: Date;
  externalTransferRef: string | null;
}

/**
 * Pairs transfer legs that share an explicit provider transfer reference.
 * Two legs with no shared reference are never merged on an amount/date
 * coincidence — an unmatched transfer stays two separate transactions. The
 * group id is the lexicographically smaller of the paired transaction ids,
 * so it is always a real, already-existing uuid and needs no extra column.
 */
export function pairTransfers(candidates: readonly TransferCandidate[]): Map<string, string> {
  const byRef = new Map<string, TransferCandidate[]>();
  for (const c of candidates) {
    if (!c.externalTransferRef) continue;
    const list = byRef.get(c.externalTransferRef) ?? [];
    list.push(c);
    byRef.set(c.externalTransferRef, list);
  }
  const groupOf = new Map<string, string>();
  for (const legs of byRef.values()) {
    if (legs.length < 2) continue;
    const groupId = [...legs].map((l) => l.id).sort()[0]!;
    for (const leg of legs) groupOf.set(leg.id, groupId);
  }
  return groupOf;
}
```

- [ ] **Step 4: Run it and watch it pass**

Run: `npm test -- transaction.test`
Expected: PASS.

- [ ] **Step 5: Write the failing test for recurring detection**

```ts
// src/modules/expenses/domain/recurring.test.ts
import { describe, expect, it } from "vitest";
import { detectRecurring, type RecurringCandidate } from "./recurring";

function monthly(payee: string, amount: string, months: number[]): RecurringCandidate[] {
  return months.map((m) => ({ payee, amount, currency: "EUR", occurredAt: new Date(Date.UTC(2026, m, 1)) }));
}

describe("detectRecurring", () => {
  it("detects a monthly payee with a stable amount across three or more occurrences", () => {
    const patterns = detectRecurring(monthly("Netflix", "-15.99", [4, 5, 6, 7]));
    expect(patterns).toHaveLength(1);
    expect(patterns[0]).toMatchObject({ payee: "Netflix", cadence: "monthly", occurrenceCount: 4 });
  });

  it("does not report a payee seen only twice", () => {
    expect(detectRecurring(monthly("One-off", "-5.00", [4, 5]))).toHaveLength(0);
  });

  it("does not report a payee whose amount varies by more than the band", () => {
    const candidates: RecurringCandidate[] = [
      { payee: "Variable", amount: "-10.00", currency: "EUR", occurredAt: new Date(Date.UTC(2026, 4, 1)) },
      { payee: "Variable", amount: "-30.00", currency: "EUR", occurredAt: new Date(Date.UTC(2026, 5, 1)) },
      { payee: "Variable", amount: "-10.00", currency: "EUR", occurredAt: new Date(Date.UTC(2026, 6, 1)) },
    ];
    expect(detectRecurring(candidates)).toHaveLength(0);
  });
});
```

- [ ] **Step 6: Run it and watch it fail**

Run: `npm test -- recurring.test`
Expected: FAIL — `Cannot find module './recurring'`.

- [ ] **Step 7: Implement `detectRecurring`**

```ts
// src/modules/expenses/domain/recurring.ts
export type Cadence = "weekly" | "biweekly" | "monthly" | "quarterly" | "annual";

export interface RecurringCandidate {
  payee: string;
  amount: string;
  currency: string;
  occurredAt: Date;
}

export interface DetectedPattern {
  payee: string;
  cadence: Cadence;
  amountLow: string;
  amountHigh: string;
  currency: string;
  lastSeenAt: Date;
  nextExpectedAt: Date;
  occurrenceCount: number;
}

const DAY_MS = 86_400_000;

const CADENCE_DAY_BANDS: Record<Cadence, [number, number]> = {
  weekly: [5, 9],
  biweekly: [12, 16],
  monthly: [26, 34],
  quarterly: [80, 100],
  annual: [350, 380],
};

/**
 * Groups by payee (case-insensitive), then looks for three or more gaps that
 * all land in the same cadence's day band, with amounts within 10% of their
 * own median — the same median-band shape `payroll/confidence.ts` uses for
 * fund reconciliation. Two occurrences are never enough: one repeat is a
 * coincidence, not a pattern.
 */
export function detectRecurring(transactions: readonly RecurringCandidate[]): DetectedPattern[] {
  const byPayee = new Map<string, RecurringCandidate[]>();
  for (const t of transactions) {
    const key = t.payee.trim().toLowerCase();
    if (!key) continue;
    const list = byPayee.get(key) ?? [];
    list.push(t);
    byPayee.set(key, list);
  }

  const patterns: DetectedPattern[] = [];
  for (const group of byPayee.values()) {
    if (group.length < 3) continue;
    const sorted = [...group].sort((a, b) => a.occurredAt.getTime() - b.occurredAt.getTime());
    const gaps: number[] = [];
    for (let i = 1; i < sorted.length; i += 1) {
      gaps.push((sorted[i]!.occurredAt.getTime() - sorted[i - 1]!.occurredAt.getTime()) / DAY_MS);
    }
    const cadence = (Object.entries(CADENCE_DAY_BANDS) as [Cadence, [number, number]][]).find(([, [lo, hi]]) =>
      gaps.every((g) => g >= lo && g <= hi),
    )?.[0];
    if (!cadence) continue;

    const amounts = sorted.map((t) => Math.abs(Number(t.amount))).sort((a, b) => a - b);
    const median = amounts[Math.floor(amounts.length / 2)]!;
    const withinBand = amounts.every((a) => Math.abs(a - median) <= median * 0.1);
    if (!withinBand) continue;

    const last = sorted[sorted.length - 1]!;
    const avgGap = gaps.reduce((s, g) => s + g, 0) / gaps.length;
    patterns.push({
      payee: last.payee,
      cadence,
      amountLow: Math.min(...amounts).toFixed(2),
      amountHigh: Math.max(...amounts).toFixed(2),
      currency: last.currency,
      lastSeenAt: last.occurredAt,
      nextExpectedAt: new Date(last.occurredAt.getTime() + avgGap * DAY_MS),
      occurrenceCount: sorted.length,
    });
  }
  return patterns;
}
```

- [ ] **Step 8: Run it and watch it pass**

Run: `npm test -- recurring.test`
Expected: PASS.

- [ ] **Step 9: Typecheck and commit**

Run: `npx tsc --noEmit`
Expected: no errors.

```bash
git add src/modules/expenses/domain
git commit -m "feat(expenses): add domain types, transfer pairing and recurring detection"
```

---

### Task 4: Expenses application ports, errors and in-memory repositories

**Files:**
- Create: `src/modules/expenses/application/ports.ts`
- Create: `src/modules/expenses/application/deps.ts`
- Create: `src/modules/expenses/application/errors.ts`
- Create: `src/modules/expenses/infrastructure/memory-repositories.ts`
- Create: `src/modules/expenses/infrastructure/memory-repositories.test.ts`

**Interfaces:**
- Consumes: `Transaction`, `TransactionCategory`, `TransactionLabel`, `RecordSource` from `../domain/transaction`; `Cadence`, `DetectedPattern` from `../domain/recurring`; `AuditInput` from `@/platform/audit/record`.
- Produces:
```ts
export type NewTransaction = Omit<Transaction, "id" | "version" | "createdAt" | "updatedAt">;
export type TransactionPatch = Partial<Pick<Transaction, "categoryId" | "note" | "state" | "payee">>;
export interface ListTransactionsOptions {
  accountId?: string; categoryId?: string; labelId?: string; type?: Transaction["type"];
  from?: string; to?: string; cursor?: string | null; limit?: number;
}
export interface ListTransactionsPage { items: Transaction[]; labelsByTransaction: Map<string, string[]>; nextCursor: string | null; }
export interface TransactionsRepository {
  list(userId: string, opts: ListTransactionsOptions): Promise<ListTransactionsPage>;
  get(userId: string, id: string): Promise<Transaction | null>;
  create(input: NewTransaction): Promise<Transaction>;
  update(userId: string, id: string, expectedVersion: number, patch: TransactionPatch): Promise<Transaction | "version_mismatch" | null>;
  setLabels(userId: string, id: string, labelIds: string[]): Promise<void>;
  labelsFor(userId: string, ids: string[]): Promise<Map<string, string[]>>;
  listAll(userId: string): Promise<Transaction[]>;
}
export type NewCategory = Omit<TransactionCategory, "id" | "createdAt" | "updatedAt">;
export interface CategoriesRepository {
  list(userId: string, opts?: { includeArchived?: boolean }): Promise<TransactionCategory[]>;
  get(userId: string, id: string): Promise<TransactionCategory | null>;
  findByName(userId: string, name: string): Promise<TransactionCategory | null>;
  create(input: NewCategory): Promise<TransactionCategory>;
}
export type NewLabel = Omit<TransactionLabel, "id" | "createdAt" | "updatedAt">;
export interface LabelsRepository {
  list(userId: string): Promise<TransactionLabel[]>;
  findByName(userId: string, name: string): Promise<TransactionLabel | null>;
  create(input: NewLabel): Promise<TransactionLabel>;
}
export interface RecurringPatternRecord {
  id: string; userId: string; payee: string; cadence: Cadence; amountLow: string; amountHigh: string;
  currency: string; lastSeenAt: Date; nextExpectedAt: Date | null; occurrenceCount: number;
}
export interface RecurringPatternsRepository {
  list(userId: string): Promise<RecurringPatternRecord[]>;
  replaceAll(userId: string, patterns: readonly DetectedPattern[]): Promise<void>;
}
export interface Clock { now(): Date; }
export interface UseCaseDeps {
  transactions: TransactionsRepository;
  categories: CategoriesRepository;
  labels: LabelsRepository;
  recurring: RecurringPatternsRepository;
  clock: Clock;
  audit(e: AuditInput): Promise<void>;
}
```

- [ ] **Step 1: Write the failing test — memory list matches Drizzle's intended ordering and pagination**

```ts
// src/modules/expenses/infrastructure/memory-repositories.test.ts
import { describe, expect, it } from "vitest";
import { MemoryTransactionsRepository, MemoryCategoriesRepository, MemoryLabelsRepository, MemoryRecurringPatternsRepository } from "./memory-repositories";

function tx(overrides: Partial<Parameters<MemoryTransactionsRepository["create"]>[0]> = {}) {
  return {
    userId: "u1",
    accountId: "acc-1",
    occurredAt: new Date("2026-09-01T00:00:00Z"),
    bookedAt: null,
    amount: "-10.00",
    currency: "EUR",
    type: "expense" as const,
    state: "cleared" as const,
    categoryId: null,
    payee: "Shop",
    note: null,
    transferGroupId: null,
    source: "manual" as const,
    syncRunId: null,
    ...overrides,
  };
}

describe("MemoryTransactionsRepository", () => {
  it("lists newest-occurred-first, tied by id descending, matching the Drizzle repository's ORDER BY", async () => {
    const repo = new MemoryTransactionsRepository();
    const a = await repo.create(tx({ occurredAt: new Date("2026-09-01T00:00:00Z") }));
    const b = await repo.create(tx({ occurredAt: new Date("2026-09-03T00:00:00Z") }));
    const c = await repo.create(tx({ occurredAt: new Date("2026-09-02T00:00:00Z") }));
    const page = await repo.list("u1", {});
    expect(page.items.map((t) => t.id)).toEqual([b.id, c.id, a.id]);
  });

  it("paginates with a cursor that is the last item's id, and reports nextCursor only when more remain", async () => {
    const repo = new MemoryTransactionsRepository();
    for (let i = 0; i < 3; i += 1) {
      await repo.create(tx({ occurredAt: new Date(Date.UTC(2026, 8, i + 1)) }));
    }
    const first = await repo.list("u1", { limit: 2 });
    expect(first.items).toHaveLength(2);
    expect(first.nextCursor).not.toBeNull();
    const second = await repo.list("u1", { limit: 2, cursor: first.nextCursor });
    expect(second.items).toHaveLength(1);
    expect(second.nextCursor).toBeNull();
  });

  it("update rejects a stale version without applying the patch", async () => {
    const repo = new MemoryTransactionsRepository();
    const created = await repo.create(tx());
    const result = await repo.update("u1", created.id, created.version + 1, { note: "x" });
    expect(result).toBe("version_mismatch");
  });

  it("setLabels and labelsFor round-trip", async () => {
    const repo = new MemoryTransactionsRepository();
    const created = await repo.create(tx());
    await repo.setLabels("u1", created.id, ["label-1", "label-2"]);
    const map = await repo.labelsFor("u1", [created.id]);
    expect(map.get(created.id)?.sort()).toEqual(["label-1", "label-2"]);
  });
});

describe("MemoryCategoriesRepository and MemoryLabelsRepository", () => {
  it("finds an existing category or label by case-sensitive exact name", async () => {
    const categories = new MemoryCategoriesRepository();
    await categories.create({ userId: "u1", name: "Groceries", groupName: null, kind: "expense", color: null, parentId: null, source: "manual", archivedAt: null });
    expect(await categories.findByName("u1", "Groceries")).not.toBeNull();
    expect(await categories.findByName("u1", "groceries")).toBeNull();

    const labels = new MemoryLabelsRepository();
    await labels.create({ userId: "u1", name: "Recurring", color: null, source: "manual" });
    expect(await labels.findByName("u1", "Recurring")).not.toBeNull();
  });
});

describe("MemoryRecurringPatternsRepository", () => {
  it("replaceAll discards the previous set for that user only", async () => {
    const repo = new MemoryRecurringPatternsRepository();
    await repo.replaceAll("u1", [
      { payee: "Netflix", cadence: "monthly", amountLow: "-15.99", amountHigh: "-15.99", currency: "EUR", lastSeenAt: new Date(), nextExpectedAt: new Date(), occurrenceCount: 4 },
    ]);
    await repo.replaceAll("u1", []);
    expect(await repo.list("u1")).toEqual([]);
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `npm test -- memory-repositories`
Expected: FAIL — `Cannot find module './memory-repositories'`.

- [ ] **Step 3: Write `ports.ts`, `deps.ts` and `errors.ts`**

```ts
// src/modules/expenses/application/ports.ts
import type { AuditInput } from "@/platform/audit/record";
import type { Cadence, DetectedPattern } from "../domain/recurring";
import type { RecordSource, Transaction, TransactionCategory, TransactionLabel } from "../domain/transaction";

export type NewTransaction = Omit<Transaction, "id" | "version" | "createdAt" | "updatedAt">;
export type TransactionPatch = Partial<Pick<Transaction, "categoryId" | "note" | "state" | "payee">>;

export interface ListTransactionsOptions {
  accountId?: string;
  categoryId?: string;
  labelId?: string;
  type?: Transaction["type"];
  from?: string;
  to?: string;
  cursor?: string | null;
  limit?: number;
}

export interface ListTransactionsPage {
  items: Transaction[];
  labelsByTransaction: Map<string, string[]>;
  nextCursor: string | null;
}

export interface TransactionsRepository {
  list(userId: string, opts: ListTransactionsOptions): Promise<ListTransactionsPage>;
  get(userId: string, id: string): Promise<Transaction | null>;
  create(input: NewTransaction): Promise<Transaction>;
  update(userId: string, id: string, expectedVersion: number, patch: TransactionPatch): Promise<Transaction | "version_mismatch" | null>;
  setLabels(userId: string, id: string, labelIds: string[]): Promise<void>;
  labelsFor(userId: string, ids: string[]): Promise<Map<string, string[]>>;
  listAll(userId: string): Promise<Transaction[]>;
}

export type NewCategory = Omit<TransactionCategory, "id" | "createdAt" | "updatedAt">;

export interface CategoriesRepository {
  list(userId: string, opts?: { includeArchived?: boolean }): Promise<TransactionCategory[]>;
  get(userId: string, id: string): Promise<TransactionCategory | null>;
  findByName(userId: string, name: string): Promise<TransactionCategory | null>;
  create(input: NewCategory): Promise<TransactionCategory>;
}

export type NewLabel = Omit<TransactionLabel, "id" | "createdAt" | "updatedAt">;

export interface LabelsRepository {
  list(userId: string): Promise<TransactionLabel[]>;
  findByName(userId: string, name: string): Promise<TransactionLabel | null>;
  create(input: NewLabel): Promise<TransactionLabel>;
}

export interface RecurringPatternRecord {
  id: string;
  userId: string;
  payee: string;
  cadence: Cadence;
  amountLow: string;
  amountHigh: string;
  currency: string;
  lastSeenAt: Date;
  nextExpectedAt: Date | null;
  occurrenceCount: number;
}

export interface RecurringPatternsRepository {
  list(userId: string): Promise<RecurringPatternRecord[]>;
  replaceAll(userId: string, patterns: readonly DetectedPattern[]): Promise<void>;
}

export interface ProviderTransaction {
  externalId: string;
  accountExternalId: string;
  occurredAt: Date;
  amount: string;
  currency: string;
  type: Transaction["type"];
  state: Transaction["state"];
  payee: string | null;
  note: string | null;
  categoryExternalId: string | null;
  labelExternalIds: readonly string[];
  externalTransferRef: string | null;
  updatedAt: Date | null;
}

export interface ProviderCategory {
  externalId: string;
  name: string;
  groupName: string | null;
  kind: TransactionCategory["kind"];
}

export interface TransactionsSource {
  provider: string;
  fetchTransactions(sinceDate: string | null): Promise<ProviderTransaction[]>;
  fetchCategories(): Promise<ProviderCategory[]>;
}

export interface Clock {
  now(): Date;
}

export interface UseCaseDeps {
  transactions: TransactionsRepository;
  categories: CategoriesRepository;
  labels: LabelsRepository;
  recurring: RecurringPatternsRepository;
  clock: Clock;
  audit(e: AuditInput): Promise<void>;
}

export type { RecordSource };
```

```ts
// src/modules/expenses/application/deps.ts
export type { UseCaseDeps } from "./ports";
```

```ts
// src/modules/expenses/application/errors.ts
export class NotFoundError extends Error {
  constructor(message = "Transaction not found") {
    super(message);
    this.name = "NotFoundError";
  }
}

export class VersionMismatchError extends Error {
  constructor(message = "This transaction changed since you opened it. Reload and try again.") {
    super(message);
    this.name = "VersionMismatchError";
  }
}

export class InvalidInputError extends Error {
  constructor(
    message: string,
    readonly issues?: unknown,
  ) {
    super(message);
    this.name = "InvalidInputError";
  }
}
```

- [ ] **Step 4: Implement the four in-memory repositories**

```ts
// src/modules/expenses/infrastructure/memory-repositories.ts
import type { DetectedPattern } from "../domain/recurring";
import type { Transaction, TransactionCategory, TransactionLabel } from "../domain/transaction";
import type {
  CategoriesRepository,
  ListTransactionsOptions,
  ListTransactionsPage,
  NewCategory,
  NewLabel,
  NewTransaction,
  RecurringPatternRecord,
  RecurringPatternsRepository,
  TransactionPatch,
  TransactionsRepository,
  LabelsRepository,
} from "../application/ports";

function randomId(): string {
  return crypto.randomUUID();
}

/** In-memory stand-in for the Drizzle-backed repository, used by unit tests. */
export class MemoryTransactionsRepository implements TransactionsRepository {
  private rows: Transaction[] = [];
  private labelLinks = new Map<string, Set<string>>();

  private sorted(userId: string): Transaction[] {
    return this.rows
      .filter((t) => t.userId === userId)
      .sort((a, b) => b.occurredAt.getTime() - a.occurredAt.getTime() || b.id.localeCompare(a.id));
  }

  async list(userId: string, opts: ListTransactionsOptions): Promise<ListTransactionsPage> {
    const limit = Math.min(Math.max(opts.limit ?? 50, 1), 200);
    let filtered = this.sorted(userId);
    if (opts.accountId) filtered = filtered.filter((t) => t.accountId === opts.accountId);
    if (opts.categoryId) filtered = filtered.filter((t) => t.categoryId === opts.categoryId);
    if (opts.type) filtered = filtered.filter((t) => t.type === opts.type);
    if (opts.from) filtered = filtered.filter((t) => t.occurredAt.toISOString() >= opts.from!);
    if (opts.to) filtered = filtered.filter((t) => t.occurredAt.toISOString() < opts.to!);
    if (opts.labelId) filtered = filtered.filter((t) => this.labelLinks.get(t.id)?.has(opts.labelId!));

    const startIndex = opts.cursor ? filtered.findIndex((t) => t.id === opts.cursor) + 1 : 0;
    const page = filtered.slice(startIndex, startIndex + limit);
    const nextCursor = startIndex + limit < filtered.length ? page[page.length - 1]!.id : null;
    const labelsByTransaction = new Map<string, string[]>();
    for (const t of page) labelsByTransaction.set(t.id, [...(this.labelLinks.get(t.id) ?? [])]);
    return { items: page, labelsByTransaction, nextCursor };
  }

  async get(userId: string, id: string): Promise<Transaction | null> {
    return this.rows.find((t) => t.userId === userId && t.id === id) ?? null;
  }

  async create(input: NewTransaction): Promise<Transaction> {
    const now = new Date();
    const row: Transaction = { ...input, id: randomId(), version: 1, createdAt: now, updatedAt: now };
    this.rows.push(row);
    return row;
  }

  async update(
    userId: string,
    id: string,
    expectedVersion: number,
    patch: TransactionPatch,
  ): Promise<Transaction | "version_mismatch" | null> {
    const index = this.rows.findIndex((t) => t.userId === userId && t.id === id);
    if (index === -1) return null;
    const current = this.rows[index]!;
    if (current.version !== expectedVersion) return "version_mismatch";
    const updated: Transaction = { ...current, ...patch, version: current.version + 1, updatedAt: new Date() };
    this.rows[index] = updated;
    return updated;
  }

  async setLabels(userId: string, id: string, labelIds: string[]): Promise<void> {
    if (!this.rows.some((t) => t.userId === userId && t.id === id)) return;
    this.labelLinks.set(id, new Set(labelIds));
  }

  async labelsFor(_userId: string, ids: string[]): Promise<Map<string, string[]>> {
    const out = new Map<string, string[]>();
    for (const id of ids) out.set(id, [...(this.labelLinks.get(id) ?? [])]);
    return out;
  }

  async listAll(userId: string): Promise<Transaction[]> {
    return this.sorted(userId);
  }
}

export class MemoryCategoriesRepository implements CategoriesRepository {
  private rows: TransactionCategory[] = [];

  async list(userId: string, opts?: { includeArchived?: boolean }): Promise<TransactionCategory[]> {
    const includeArchived = opts?.includeArchived ?? false;
    return this.rows
      .filter((c) => c.userId === userId && (includeArchived || c.archivedAt === null))
      .sort((a, b) => a.name.localeCompare(b.name));
  }

  async get(userId: string, id: string): Promise<TransactionCategory | null> {
    return this.rows.find((c) => c.userId === userId && c.id === id) ?? null;
  }

  async findByName(userId: string, name: string): Promise<TransactionCategory | null> {
    return this.rows.find((c) => c.userId === userId && c.name === name) ?? null;
  }

  async create(input: NewCategory): Promise<TransactionCategory> {
    const now = new Date();
    const row: TransactionCategory = { ...input, id: randomId(), createdAt: now, updatedAt: now };
    this.rows.push(row);
    return row;
  }
}

export class MemoryLabelsRepository implements LabelsRepository {
  private rows: TransactionLabel[] = [];

  async list(userId: string): Promise<TransactionLabel[]> {
    return this.rows.filter((l) => l.userId === userId).sort((a, b) => a.name.localeCompare(b.name));
  }

  async findByName(userId: string, name: string): Promise<TransactionLabel | null> {
    return this.rows.find((l) => l.userId === userId && l.name === name) ?? null;
  }

  async create(input: NewLabel): Promise<TransactionLabel> {
    const now = new Date();
    const row: TransactionLabel = { ...input, id: randomId(), createdAt: now, updatedAt: now };
    this.rows.push(row);
    return row;
  }
}

export class MemoryRecurringPatternsRepository implements RecurringPatternsRepository {
  private rows: RecurringPatternRecord[] = [];

  async list(userId: string): Promise<RecurringPatternRecord[]> {
    return this.rows.filter((r) => r.userId === userId).sort((a, b) => a.payee.localeCompare(b.payee));
  }

  async replaceAll(userId: string, patterns: readonly DetectedPattern[]): Promise<void> {
    this.rows = this.rows.filter((r) => r.userId !== userId);
    for (const p of patterns) {
      this.rows.push({ ...p, id: randomId(), userId });
    }
  }
}
```

- [ ] **Step 5: Run the tests**

Run: `npm test -- memory-repositories`
Expected: PASS.

- [ ] **Step 6: Typecheck and commit**

Run: `npx tsc --noEmit`
Expected: no errors.

```bash
git add src/modules/expenses/application/ports.ts src/modules/expenses/application/deps.ts src/modules/expenses/application/errors.ts src/modules/expenses/infrastructure/memory-repositories.ts src/modules/expenses/infrastructure/memory-repositories.test.ts
git commit -m "feat(expenses): add application ports and in-memory repositories"
```

---

### Task 5: Expenses Drizzle repositories and the production deps bag

**Files:**
- Create: `src/modules/expenses/infrastructure/drizzle-transactions-repository.ts`
- Create: `src/modules/expenses/infrastructure/drizzle-categories-repository.ts`
- Create: `src/modules/expenses/infrastructure/drizzle-labels-repository.ts`
- Create: `src/modules/expenses/infrastructure/drizzle-recurring-repository.ts`
- Create: `src/modules/expenses/infrastructure/deps.ts`
- Create: `src/modules/expenses/infrastructure/repositories.itest.ts`

**Interfaces:**
- Consumes: `transactions`, `transactionCategories`, `transactionLabels`, `transactionLabelLinks`, `recurringPatterns` from `@/lib/db/schema` (Task 1); `TransactionsRepository`, `CategoriesRepository`, `LabelsRepository`, `RecurringPatternsRepository`, `UseCaseDeps` from `../application/ports` (Task 4); `recordAudit` from `@/platform/audit/record`; `DbClient` from `@/lib/db/client`.
- Produces:
```ts
export class DrizzleTransactionsRepository implements TransactionsRepository { constructor(db: DbClient); /* ...ports.ts methods */ }
export class DrizzleCategoriesRepository implements CategoriesRepository { constructor(db: DbClient); /* ... */ }
export class DrizzleLabelsRepository implements LabelsRepository { constructor(db: DbClient); /* ... */ }
export class DrizzleRecurringRepository implements RecurringPatternsRepository { constructor(db: DbClient); /* ... */ }
export function expenseDeps(tx: DbClient, requestId?: string | null): UseCaseDeps;
```

- [ ] **Step 1: Write the failing integration test**

```ts
// src/modules/expenses/infrastructure/repositories.itest.ts
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { accounts, organizations, users } from "@/lib/db/schema";
import { withUserContext } from "@/platform/db/context";
import { closeDb, resetDb, testDb } from "@/test/db";
import { DrizzleTransactionsRepository } from "./drizzle-transactions-repository";
import { DrizzleCategoriesRepository } from "./drizzle-categories-repository";
import { DrizzleLabelsRepository } from "./drizzle-labels-repository";

async function seed() {
  const db = await testDb();
  const [org] = await db.insert(organizations).values({ name: "P" }).returning();
  const [user] = await db.insert(users).values({ organizationId: org!.id, displayName: "A" }).returning();
  const [account] = await db.insert(accounts).values({ userId: user!.id, name: "Cash", type: "cash", origin: "manual" }).returning();
  return { userId: user!.id, accountId: account!.id };
}

describe("DrizzleTransactionsRepository", () => {
  beforeEach(resetDb);
  afterAll(closeDb);

  it("lists newest-occurred-first, tied by id descending — same order the memory repository asserts", async () => {
    const { userId, accountId } = await seed();
    const db = await testDb();
    await withUserContext(db, { userId }, async (tx) => {
      const repo = new DrizzleTransactionsRepository(tx);
      await repo.create({ userId, accountId, occurredAt: new Date("2026-09-01"), bookedAt: null, amount: "-10.00", currency: "EUR", type: "expense", state: "cleared", categoryId: null, payee: "A", note: null, transferGroupId: null, source: "manual", syncRunId: null });
      const b = await repo.create({ userId, accountId, occurredAt: new Date("2026-09-03"), bookedAt: null, amount: "-20.00", currency: "EUR", type: "expense", state: "cleared", categoryId: null, payee: "B", note: null, transferGroupId: null, source: "manual", syncRunId: null });
      const page = await repo.list(userId, {});
      expect(page.items[0]!.id).toBe(b.id);
    });
  });

  it("update rejects a stale version, matching the memory repository's contract", async () => {
    const { userId, accountId } = await seed();
    const db = await testDb();
    await withUserContext(db, { userId }, async (tx) => {
      const repo = new DrizzleTransactionsRepository(tx);
      const created = await repo.create({ userId, accountId, occurredAt: new Date(), bookedAt: null, amount: "-5.00", currency: "EUR", type: "expense", state: "cleared", categoryId: null, payee: null, note: null, transferGroupId: null, source: "manual", syncRunId: null });
      const result = await repo.update(userId, created.id, created.version + 1, { note: "x" });
      expect(result).toBe("version_mismatch");
    });
  });

  it("setLabels replaces the full set for a transaction", async () => {
    const { userId, accountId } = await seed();
    const db = await testDb();
    await withUserContext(db, { userId }, async (tx) => {
      const labels = new DrizzleLabelsRepository(tx);
      const l1 = await labels.create({ userId, name: "Recurring", color: null, source: "manual" });
      const l2 = await labels.create({ userId, name: "Work", color: null, source: "manual" });
      const repo = new DrizzleTransactionsRepository(tx);
      const created = await repo.create({ userId, accountId, occurredAt: new Date(), bookedAt: null, amount: "-5.00", currency: "EUR", type: "expense", state: "cleared", categoryId: null, payee: null, note: null, transferGroupId: null, source: "manual", syncRunId: null });
      await repo.setLabels(userId, created.id, [l1.id, l2.id]);
      const map = await repo.labelsFor(userId, [created.id]);
      expect(map.get(created.id)?.sort()).toEqual([l1.id, l2.id].sort());
      await repo.setLabels(userId, created.id, [l1.id]);
      expect((await repo.labelsFor(userId, [created.id])).get(created.id)).toEqual([l1.id]);
    });
  });
});

describe("DrizzleCategoriesRepository", () => {
  beforeEach(resetDb);
  afterAll(closeDb);

  it("finds by exact name only, case-sensitive, matching the memory repository's contract", async () => {
    const { userId } = await seed();
    const db = await testDb();
    await withUserContext(db, { userId }, async (tx) => {
      const repo = new DrizzleCategoriesRepository(tx);
      await repo.create({ userId, name: "Groceries", groupName: null, kind: "expense", color: null, parentId: null, source: "manual", archivedAt: null });
      expect(await repo.findByName(userId, "Groceries")).not.toBeNull();
      expect(await repo.findByName(userId, "groceries")).toBeNull();
    });
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `npm run test:db:up && npm run test:integration -- expenses/infrastructure/repositories`
Expected: FAIL — `Cannot find module './drizzle-transactions-repository'`.

- [ ] **Step 3: Implement the Drizzle repositories**

```ts
// src/modules/expenses/infrastructure/drizzle-transactions-repository.ts
import { and, desc, eq, gte, inArray, lt, sql } from "drizzle-orm";
import type { DbClient } from "@/lib/db/client";
import { transactionLabelLinks, transactions, type TransactionRow } from "@/lib/db/schema";
import type {
  ListTransactionsOptions,
  ListTransactionsPage,
  NewTransaction,
  TransactionPatch,
  TransactionsRepository,
} from "../application/ports";
import type { Transaction } from "../domain/transaction";

function toTransaction(row: TransactionRow): Transaction {
  return {
    id: row.id,
    userId: row.userId,
    accountId: row.accountId,
    occurredAt: row.occurredAt,
    bookedAt: row.bookedAt,
    amount: row.amount,
    currency: row.currency,
    type: row.type as Transaction["type"],
    state: row.state as Transaction["state"],
    categoryId: row.categoryId,
    payee: row.payee,
    note: row.note,
    transferGroupId: row.transferGroupId,
    source: row.source as Transaction["source"],
    syncRunId: row.syncRunId,
    version: row.version,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

export class DrizzleTransactionsRepository implements TransactionsRepository {
  constructor(private readonly db: DbClient) {}

  async list(userId: string, opts: ListTransactionsOptions): Promise<ListTransactionsPage> {
    const limit = Math.min(Math.max(opts.limit ?? 50, 1), 200);
    const conditions = [eq(transactions.userId, userId)];
    if (opts.accountId) conditions.push(eq(transactions.accountId, opts.accountId));
    if (opts.categoryId) conditions.push(eq(transactions.categoryId, opts.categoryId));
    if (opts.type) conditions.push(eq(transactions.type, opts.type));
    if (opts.from) conditions.push(gte(transactions.occurredAt, new Date(opts.from)));
    if (opts.to) conditions.push(lt(transactions.occurredAt, new Date(opts.to)));
    if (opts.labelId) {
      conditions.push(
        sql`EXISTS (SELECT 1 FROM transaction_label_links l WHERE l.transaction_id = ${transactions.id} AND l.label_id = ${opts.labelId})`,
      );
    }
    if (opts.cursor) {
      const [anchor] = await this.db
        .select({ occurredAt: transactions.occurredAt, id: transactions.id })
        .from(transactions)
        .where(eq(transactions.id, opts.cursor))
        .limit(1);
      if (anchor) {
        conditions.push(sql`(${transactions.occurredAt}, ${transactions.id}) < (${anchor.occurredAt}, ${anchor.id})`);
      }
    }
    const rows = await this.db
      .select()
      .from(transactions)
      .where(and(...conditions))
      .orderBy(desc(transactions.occurredAt), desc(transactions.id))
      .limit(limit + 1);
    const hasMore = rows.length > limit;
    const items = (hasMore ? rows.slice(0, limit) : rows).map(toTransaction);
    const nextCursor = hasMore ? items[items.length - 1]!.id : null;
    const labelsByTransaction = await this.labelsFor(
      userId,
      items.map((t) => t.id),
    );
    return { items, labelsByTransaction, nextCursor };
  }

  async get(userId: string, id: string): Promise<Transaction | null> {
    const [row] = await this.db
      .select()
      .from(transactions)
      .where(and(eq(transactions.userId, userId), eq(transactions.id, id)))
      .limit(1);
    return row ? toTransaction(row) : null;
  }

  async create(input: NewTransaction): Promise<Transaction> {
    const [row] = await this.db.insert(transactions).values(input).returning();
    return toTransaction(row!);
  }

  async update(
    userId: string,
    id: string,
    expectedVersion: number,
    patch: TransactionPatch,
  ): Promise<Transaction | "version_mismatch" | null> {
    const [row] = await this.db
      .update(transactions)
      .set({ ...patch, version: sql`${transactions.version} + 1`, updatedAt: new Date() })
      .where(and(eq(transactions.userId, userId), eq(transactions.id, id), eq(transactions.version, expectedVersion)))
      .returning();
    if (row) return toTransaction(row);
    const existing = await this.get(userId, id);
    return existing === null ? null : "version_mismatch";
  }

  async setLabels(userId: string, id: string, labelIds: string[]): Promise<void> {
    await this.db.transaction(async (tx) => {
      const [owned] = await tx
        .select({ id: transactions.id })
        .from(transactions)
        .where(and(eq(transactions.userId, userId), eq(transactions.id, id)))
        .limit(1);
      if (!owned) return;
      await tx.delete(transactionLabelLinks).where(eq(transactionLabelLinks.transactionId, id));
      if (labelIds.length > 0) {
        await tx.insert(transactionLabelLinks).values(labelIds.map((labelId) => ({ transactionId: id, labelId })));
      }
    });
  }

  async labelsFor(_userId: string, ids: string[]): Promise<Map<string, string[]>> {
    const map = new Map<string, string[]>();
    for (const id of ids) map.set(id, []);
    if (ids.length === 0) return map;
    const rows = await this.db
      .select()
      .from(transactionLabelLinks)
      .where(inArray(transactionLabelLinks.transactionId, ids));
    for (const r of rows) map.get(r.transactionId)?.push(r.labelId);
    return map;
  }

  async listAll(userId: string): Promise<Transaction[]> {
    const rows = await this.db
      .select()
      .from(transactions)
      .where(eq(transactions.userId, userId))
      .orderBy(desc(transactions.occurredAt), desc(transactions.id));
    return rows.map(toTransaction);
  }
}
```

```ts
// src/modules/expenses/infrastructure/drizzle-categories-repository.ts
import { and, asc, eq } from "drizzle-orm";
import type { DbClient } from "@/lib/db/client";
import { transactionCategories, type TransactionCategoryRow } from "@/lib/db/schema";
import type { CategoriesRepository, NewCategory } from "../application/ports";
import type { TransactionCategory } from "../domain/transaction";
import { isNull } from "drizzle-orm";

function toCategory(row: TransactionCategoryRow): TransactionCategory {
  return {
    id: row.id,
    userId: row.userId,
    name: row.name,
    groupName: row.groupName,
    kind: row.kind as TransactionCategory["kind"],
    color: row.color,
    parentId: row.parentId,
    source: row.source as TransactionCategory["source"],
    archivedAt: row.archivedAt,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

export class DrizzleCategoriesRepository implements CategoriesRepository {
  constructor(private readonly db: DbClient) {}

  async list(userId: string, opts?: { includeArchived?: boolean }): Promise<TransactionCategory[]> {
    const conditions = [eq(transactionCategories.userId, userId)];
    if (!opts?.includeArchived) conditions.push(isNull(transactionCategories.archivedAt));
    const rows = await this.db
      .select()
      .from(transactionCategories)
      .where(and(...conditions))
      .orderBy(asc(transactionCategories.name));
    return rows.map(toCategory);
  }

  async get(userId: string, id: string): Promise<TransactionCategory | null> {
    const [row] = await this.db
      .select()
      .from(transactionCategories)
      .where(and(eq(transactionCategories.userId, userId), eq(transactionCategories.id, id)))
      .limit(1);
    return row ? toCategory(row) : null;
  }

  async findByName(userId: string, name: string): Promise<TransactionCategory | null> {
    const [row] = await this.db
      .select()
      .from(transactionCategories)
      .where(and(eq(transactionCategories.userId, userId), eq(transactionCategories.name, name)))
      .limit(1);
    return row ? toCategory(row) : null;
  }

  async create(input: NewCategory): Promise<TransactionCategory> {
    const [row] = await this.db.insert(transactionCategories).values(input).returning();
    return toCategory(row!);
  }
}
```

```ts
// src/modules/expenses/infrastructure/drizzle-labels-repository.ts
import { and, asc, eq } from "drizzle-orm";
import type { DbClient } from "@/lib/db/client";
import { transactionLabels, type TransactionLabelRow } from "@/lib/db/schema";
import type { LabelsRepository, NewLabel } from "../application/ports";
import type { TransactionLabel } from "../domain/transaction";

function toLabel(row: TransactionLabelRow): TransactionLabel {
  return {
    id: row.id,
    userId: row.userId,
    name: row.name,
    color: row.color,
    source: row.source as TransactionLabel["source"],
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

export class DrizzleLabelsRepository implements LabelsRepository {
  constructor(private readonly db: DbClient) {}

  async list(userId: string): Promise<TransactionLabel[]> {
    const rows = await this.db
      .select()
      .from(transactionLabels)
      .where(eq(transactionLabels.userId, userId))
      .orderBy(asc(transactionLabels.name));
    return rows.map(toLabel);
  }

  async findByName(userId: string, name: string): Promise<TransactionLabel | null> {
    const [row] = await this.db
      .select()
      .from(transactionLabels)
      .where(and(eq(transactionLabels.userId, userId), eq(transactionLabels.name, name)))
      .limit(1);
    return row ? toLabel(row) : null;
  }

  async create(input: NewLabel): Promise<TransactionLabel> {
    const [row] = await this.db.insert(transactionLabels).values(input).returning();
    return toLabel(row!);
  }
}
```

```ts
// src/modules/expenses/infrastructure/drizzle-recurring-repository.ts
import { asc, eq } from "drizzle-orm";
import type { DbClient } from "@/lib/db/client";
import { recurringPatterns } from "@/lib/db/schema";
import type { RecurringPatternRecord, RecurringPatternsRepository } from "../application/ports";
import type { DetectedPattern } from "../domain/recurring";

export class DrizzleRecurringRepository implements RecurringPatternsRepository {
  constructor(private readonly db: DbClient) {}

  async list(userId: string): Promise<RecurringPatternRecord[]> {
    const rows = await this.db
      .select()
      .from(recurringPatterns)
      .where(eq(recurringPatterns.userId, userId))
      .orderBy(asc(recurringPatterns.payee));
    return rows.map((r) => ({
      id: r.id,
      userId: r.userId,
      payee: r.payee,
      cadence: r.cadence as RecurringPatternRecord["cadence"],
      amountLow: r.amountLow,
      amountHigh: r.amountHigh,
      currency: r.currency,
      lastSeenAt: r.lastSeenAt,
      nextExpectedAt: r.nextExpectedAt,
      occurrenceCount: r.occurrenceCount,
    }));
  }

  /** Full recompute per run: the detector re-derives every pattern from all transactions, so the previous set is discarded first. */
  async replaceAll(userId: string, patterns: readonly DetectedPattern[]): Promise<void> {
    await this.db.transaction(async (tx) => {
      await tx.delete(recurringPatterns).where(eq(recurringPatterns.userId, userId));
      if (patterns.length === 0) return;
      await tx.insert(recurringPatterns).values(
        patterns.map((p) => ({
          userId,
          payee: p.payee,
          cadence: p.cadence,
          amountLow: p.amountLow,
          amountHigh: p.amountHigh,
          currency: p.currency,
          lastSeenAt: p.lastSeenAt,
          nextExpectedAt: p.nextExpectedAt,
          occurrenceCount: p.occurrenceCount,
        })),
      );
    });
  }
}
```

```ts
// src/modules/expenses/infrastructure/deps.ts
import type { DbClient } from "@/lib/db/client";
import { recordAudit } from "@/platform/audit/record";
import type { UseCaseDeps } from "../application/ports";
import { DrizzleCategoriesRepository } from "./drizzle-categories-repository";
import { DrizzleLabelsRepository } from "./drizzle-labels-repository";
import { DrizzleRecurringRepository } from "./drizzle-recurring-repository";
import { DrizzleTransactionsRepository } from "./drizzle-transactions-repository";

export function expenseDeps(tx: DbClient, requestId?: string | null): UseCaseDeps {
  return {
    transactions: new DrizzleTransactionsRepository(tx),
    categories: new DrizzleCategoriesRepository(tx),
    labels: new DrizzleLabelsRepository(tx),
    recurring: new DrizzleRecurringRepository(tx),
    clock: { now: () => new Date() },
    audit: (e) => recordAudit(tx, { ...e, requestId: requestId ?? null }),
  };
}
```

- [ ] **Step 4: Run the integration tests**

Run: `npm run test:integration -- expenses/infrastructure/repositories`
Expected: PASS.

- [ ] **Step 5: Typecheck and commit**

Run: `npx tsc --noEmit`
Expected: no errors.

```bash
git add src/modules/expenses/infrastructure
git commit -m "feat(expenses): add Drizzle repositories and the production deps bag"
```

---

### Task 6: Wallet client — `getRecords`, `getCategories`, `postRecords`

**Files:**
- Modify: `src/lib/clients/wallet.ts`
- Modify: `src/lib/clients/wallet.test.ts`

**Interfaces:**
- Consumes: `requestJson`, `withRetry`, `HttpError` from `./http` (unchanged); `WalletCallOptions`, `baseUrl()`, `headers()`, `retryPolicy()`, `translate()` already in `wallet.ts` (unchanged, reused).
- Produces:
```ts
export interface WalletCategory { id: string; name: string; group: string | null; isIncome?: boolean; }
export async function getCategories(opts: WalletCallOptions): Promise<WalletCategory[]>;

export interface WalletRecord {
  id: string; accountId: string; amount: number; currencyCode: string;
  categoryId?: string | null; labels?: string[]; recordType?: string; recordState?: string;
  note?: string | null; recordDate: string; updatedAt?: string;
  partyName?: string | null; transferCounterRecordId?: string | null;
}
export interface GetRecordsOptions extends WalletCallOptions { sinceDate?: string; }
export async function getRecords(opts: GetRecordsOptions): Promise<WalletRecord[]>;

export interface PostRecordInput { accountId: string; amount: number; recordDate: string; note: string; categoryId?: string; }
export async function postRecords(opts: WalletCallOptions, records: PostRecordInput[]): Promise<void>;
```

Ruling: the real BudgetBakers `/records` endpoint's exact field names have not been verified against a live token in this environment (same limitation the Phase 2 checkpoint recorded for the UI walkthrough). `getRecords`/`getCategories` isolate every field guess behind a Zod schema so a shape mismatch fails loudly and non-retryably at `requestJson`, exactly like every other Wallet call — never a silent wrong mapping. `docs/deploy/phase-3-runbook.md` (Task 22) carries a manual verification step for whoever holds a real token, matching Phase 2's practice.

- [ ] **Step 1: Write the failing tests**

```ts
// src/lib/clients/wallet.test.ts — add to the existing file, reusing its fetchMock/json() helpers
describe("getCategories", () => {
  it("returns the category list", async () => {
    fetchMock.mockResolvedValueOnce(
      json({ categories: [{ id: "c1", name: "Interest, dividends", group: "Income" }] }),
    );
    const categories = await getCategories({ token: "t" });
    expect(categories).toEqual([{ id: "c1", name: "Interest, dividends", group: "Income" }]);
  });
});

describe("getRecords", () => {
  it("appends a recordDate gte filter when sinceDate is given", async () => {
    fetchMock.mockResolvedValueOnce(json({ records: [] }));
    await getRecords({ token: "t", sinceDate: "2026-08-01" });
    const url = fetchMock.mock.calls[0]![0] as string;
    expect(url).toContain("recordDate=gte.2026-08-01");
  });

  it("omits the filter when sinceDate is not given", async () => {
    fetchMock.mockResolvedValueOnce(json({ records: [] }));
    await getRecords({ token: "t" });
    const url = fetchMock.mock.calls[0]![0] as string;
    expect(url).not.toContain("recordDate");
  });

  it("parses a record with the fields the sync handler needs", async () => {
    fetchMock.mockResolvedValueOnce(
      json({
        records: [
          {
            id: "r1",
            accountId: "a1",
            amount: -12.5,
            currencyCode: "EUR",
            categoryId: "c1",
            labels: ["l1"],
            recordType: "expense",
            recordState: "cleared",
            note: "Coffee",
            recordDate: "2026-09-01T08:00:00Z",
            updatedAt: "2026-09-01T08:00:00Z",
          },
        ],
      }),
    );
    const records = await getRecords({ token: "t" });
    expect(records).toHaveLength(1);
    expect(records[0]!.amount).toBe(-12.5);
  });
});

describe("postRecords", () => {
  it("POSTs the records array with a bearer header", async () => {
    fetchMock.mockResolvedValueOnce(json({}));
    await postRecords({ token: "t" }, [{ accountId: "a1", amount: 0.63, recordDate: "2026-09-01T00:00:00Z", note: "auto-interest" }]);
    const [, init] = fetchMock.mock.calls[0]!;
    expect((init as RequestInit).method).toBe("POST");
    expect((init as RequestInit).headers).toMatchObject({ authorization: "Bearer t" });
    expect(JSON.parse((init as RequestInit).body as string)).toEqual([
      { accountId: "a1", amount: 0.63, recordDate: "2026-09-01T00:00:00Z", note: "auto-interest" },
    ]);
  });
});
```
Also add the corresponding imports at the top of the test file: `getCategories, getRecords, postRecords` alongside the existing `getAccounts` import.

- [ ] **Step 2: Run it and watch it fail**

Run: `npm test -- wallet.test`
Expected: FAIL — `getCategories is not a function` (and similarly for the other two).

- [ ] **Step 3: Implement the three functions in `wallet.ts`**

Append to `src/lib/clients/wallet.ts` (after `getBalances`):

```ts
const categorySchema = z.object({
  id: z.string(),
  name: z.string(),
  group: z.string().nullable().optional(),
  isIncome: z.boolean().optional(),
});
const categoriesSchema = z.object({ categories: z.array(categorySchema) });
export type WalletCategory = z.infer<typeof categorySchema>;

export async function getCategories(opts: WalletCallOptions): Promise<WalletCategory[]> {
  try {
    const body = await withRetry(
      () =>
        requestJson("wallet", `${baseUrl()}/categories?limit=200`, categoriesSchema, {
          headers: headers(opts),
          signal: opts.signal,
        }),
      retryPolicy(opts),
    );
    return body.categories;
  } catch (err) {
    throw translate(err);
  }
}

const recordSchema = z.object({
  id: z.string(),
  accountId: z.string(),
  amount: z.number(),
  currencyCode: z.string(),
  categoryId: z.string().nullable().optional(),
  labels: z.array(z.string()).optional().default([]),
  recordType: z.string().optional(),
  recordState: z.string().optional(),
  note: z.string().nullable().optional(),
  recordDate: z.string(),
  updatedAt: z.string().optional(),
  partyName: z.string().nullable().optional(),
  transferCounterRecordId: z.string().nullable().optional(),
});
const recordsSchema = z.object({ records: z.array(recordSchema) });
export type WalletRecord = z.infer<typeof recordSchema>;

export interface GetRecordsOptions extends WalletCallOptions {
  /** ISO date; the API defaults to a three-month window when this is omitted. */
  sinceDate?: string;
}

export async function getRecords(opts: GetRecordsOptions): Promise<WalletRecord[]> {
  try {
    const filter = opts.sinceDate ? `&recordDate=gte.${opts.sinceDate}` : "";
    const body = await withRetry(
      () =>
        requestJson("wallet", `${baseUrl()}/records?limit=500${filter}`, recordsSchema, {
          headers: headers(opts),
          signal: opts.signal,
        }),
      retryPolicy(opts),
    );
    return body.records;
  } catch (err) {
    throw translate(err);
  }
}

export interface PostRecordInput {
  accountId: string;
  amount: number;
  recordDate: string;
  note: string;
  categoryId?: string;
}

/** Used only by the optional interest-posting adapter (Task 19), behind a per-rule switch. */
export async function postRecords(opts: WalletCallOptions, records: PostRecordInput[]): Promise<void> {
  try {
    await withRetry(
      () =>
        requestJson("wallet", `${baseUrl()}/records`, z.unknown(), {
          method: "POST",
          headers: { ...headers(opts), "content-type": "application/json" },
          body: JSON.stringify(records),
          signal: opts.signal,
        }),
      retryPolicy(opts),
    );
  } catch (err) {
    throw translate(err);
  }
}
```

- [ ] **Step 4: Run the tests**

Run: `npm test -- wallet.test`
Expected: PASS.

- [ ] **Step 5: Typecheck and commit**

Run: `npx tsc --noEmit`
Expected: no errors.

```bash
git add src/lib/clients/wallet.ts src/lib/clients/wallet.test.ts
git commit -m "feat(wallet): add getRecords, getCategories and postRecords"
```

---

### Task 7: Wallet transactions adapter and the provider-reconciliation use case

**Files:**
- Modify: `src/modules/expenses/application/ports.ts` (add `transferGroupId` to `TransactionPatch`; add `ProviderTransaction`/`ProviderCategory`/`TransactionsSource`, already stubbed in Task 4 — no change needed there beyond the patch widening)
- Create: `src/modules/expenses/application/sync-provider-transactions.ts`
- Create: `src/modules/expenses/application/sync-provider-transactions.test.ts`
- Create: `src/modules/expenses/infrastructure/wallet-transactions-adapter.ts`
- Create: `src/modules/expenses/infrastructure/wallet-transactions-adapter.test.ts`

**Interfaces:**
- Consumes: `getRecords`, `getCategories`, `WalletRecord`, `WalletCategory` from `@/lib/clients/wallet` (Task 6); `ProviderLinksRepository`, `ProviderLink`, `ProviderLinkEntityType` from `@/modules/accounts/application/ports` (Task 2); `pairTransfers`, `TransferCandidate` from `../domain/transaction` (Task 3); `UseCaseDeps`, `TransactionsSource`, `ProviderTransaction`, `ProviderCategory` from `./ports` (Task 4).
- Produces:
```ts
export type SyncProviderTransactionsDeps = UseCaseDeps & { links: ProviderLinksRepository; source: TransactionsSource };
export interface SyncProviderTransactionsResult {
  transactionsCreated: number; transactionsUpdated: number; categoriesCreated: number; labelsCreated: number; skippedNoAccount: number;
}
export function syncProviderTransactions(deps: SyncProviderTransactionsDeps):
  (userId: string, sinceDate: string | null) => Promise<SyncProviderTransactionsResult>;

export const WALLET_PROVIDER = "wallet"; // re-declared locally, matching accounts/infrastructure/wallet-adapter.ts's own constant — no shared import, so a rename in one module cannot silently affect the other
export function mapWalletCategory(raw: WalletCategory): ProviderCategory;
export function mapWalletRecord(raw: WalletRecord): ProviderTransaction;
export function walletTransactionsSource(token: string): TransactionsSource;
export function prefetchedWalletTransactionsSource(transactions: readonly ProviderTransaction[], categories: readonly ProviderCategory[]): TransactionsSource;
```

- [ ] **Step 1: Widen `TransactionPatch`**

In `src/modules/expenses/application/ports.ts`, change:
```ts
export type TransactionPatch = Partial<Pick<Transaction, "categoryId" | "note" | "state" | "payee">>;
```
to:
```ts
export type TransactionPatch = Partial<Pick<Transaction, "categoryId" | "note" | "state" | "payee" | "transferGroupId">>;
```
No other file changes: both `MemoryTransactionsRepository.update` and `DrizzleTransactionsRepository.update` already spread `patch` generically.

- [ ] **Step 2: Write the failing adapter test**

```ts
// src/modules/expenses/infrastructure/wallet-transactions-adapter.test.ts
import { describe, expect, it } from "vitest";
import { mapWalletCategory, mapWalletRecord } from "./wallet-transactions-adapter";
import type { WalletCategory, WalletRecord } from "@/lib/clients/wallet";

describe("mapWalletCategory", () => {
  it("marks a category income when the provider flags it so", () => {
    const raw: WalletCategory = { id: "c1", name: "Interest, dividends", group: "Income", isIncome: true };
    expect(mapWalletCategory(raw)).toMatchObject({ externalId: "c1", name: "Interest, dividends", kind: "income" });
  });

  it("falls back to a name hint when the provider gives no explicit flag", () => {
    const raw: WalletCategory = { id: "c2", name: "Salary", group: null };
    expect(mapWalletCategory(raw).kind).toBe("income");
  });

  it("defaults to expense", () => {
    const raw: WalletCategory = { id: "c3", name: "Groceries", group: null };
    expect(mapWalletCategory(raw).kind).toBe("expense");
  });
});

describe("mapWalletRecord", () => {
  it("maps a plain expense", () => {
    const raw: WalletRecord = {
      id: "r1", accountId: "a1", amount: -12.5, currencyCode: "eur", categoryId: "c1",
      labels: ["work"], recordType: "expense", recordState: "cleared", note: "Coffee",
      recordDate: "2026-09-01T08:00:00Z", updatedAt: "2026-09-01T08:00:00Z",
    };
    expect(mapWalletRecord(raw)).toMatchObject({
      externalId: "r1", accountExternalId: "a1", amount: "-12.50", currency: "EUR",
      type: "expense", state: "cleared", note: "Coffee", labelExternalIds: ["work"], categoryExternalId: "c1",
    });
  });

  it("infers type from the amount sign when recordType is absent", () => {
    const raw: WalletRecord = { id: "r2", accountId: "a1", amount: 100, currencyCode: "EUR", recordDate: "2026-09-01T00:00:00Z" };
    expect(mapWalletRecord(raw).type).toBe("income");
  });

  it("carries the transfer counter-record id through", () => {
    const raw: WalletRecord = { id: "r3", accountId: "a1", amount: -50, currencyCode: "EUR", recordDate: "2026-09-01T00:00:00Z", transferCounterRecordId: "r4" };
    expect(mapWalletRecord(raw).externalTransferRef).toBe("r4");
  });
});
```

- [ ] **Step 3: Run it and watch it fail**

Run: `npm test -- wallet-transactions-adapter`
Expected: FAIL — `Cannot find module './wallet-transactions-adapter'`.

- [ ] **Step 4: Implement the adapter**

```ts
// src/modules/expenses/infrastructure/wallet-transactions-adapter.ts
import { getCategories, getRecords, type WalletCategory, type WalletRecord } from "@/lib/clients/wallet";
import type { ProviderCategory, ProviderTransaction, TransactionsSource } from "../application/ports";
import type { CategoryKind, TransactionState, TransactionType } from "../domain/transaction";

export const WALLET_PROVIDER = "wallet";

const INCOME_HINTS = ["salary", "income", "refund", "interest", "dividend", "bonus"];

function categoryKind(raw: WalletCategory): CategoryKind {
  if (raw.isIncome) return "income";
  const name = raw.name.toLowerCase();
  return INCOME_HINTS.some((hint) => name.includes(hint)) ? "income" : "expense";
}

function transactionType(raw: WalletRecord): TransactionType {
  const t = (raw.recordType ?? "").toLowerCase();
  if (t === "transfer") return "transfer";
  if (t === "income") return "income";
  if (t === "expense") return "expense";
  return raw.amount >= 0 ? "income" : "expense";
}

function transactionState(raw: WalletRecord): TransactionState {
  const s = (raw.recordState ?? "").toLowerCase();
  if (s === "pending") return "pending";
  if (s === "reconciled") return "reconciled";
  return "cleared";
}

export function mapWalletCategory(raw: WalletCategory): ProviderCategory {
  return { externalId: raw.id, name: raw.name.trim(), groupName: raw.group ?? null, kind: categoryKind(raw) };
}

export function mapWalletRecord(raw: WalletRecord): ProviderTransaction {
  return {
    externalId: raw.id,
    accountExternalId: raw.accountId,
    occurredAt: new Date(raw.recordDate),
    amount: raw.amount.toFixed(2),
    currency: raw.currencyCode.toUpperCase(),
    type: transactionType(raw),
    state: transactionState(raw),
    payee: raw.partyName?.trim() || null,
    note: raw.note?.trim() || null,
    categoryExternalId: raw.categoryId ?? null,
    labelExternalIds: raw.labels ?? [],
    externalTransferRef: raw.transferCounterRecordId ?? null,
    updatedAt: raw.updatedAt ? new Date(raw.updatedAt) : null,
  };
}

/**
 * `token` is passed in, never read here: the credential lives in the
 * encrypted vault (Phase 2) and is resolved by the sync engine's `fetch`
 * phase, which carries no database handle.
 */
export function walletTransactionsSource(token: string): TransactionsSource {
  return {
    provider: WALLET_PROVIDER,
    async fetchTransactions(sinceDate) {
      const raw = await getRecords({ token, sinceDate: sinceDate ?? undefined });
      return raw.map(mapWalletRecord);
    },
    async fetchCategories() {
      const raw = await getCategories({ token });
      return raw.map(mapWalletCategory);
    },
  };
}

/** An already-fetched source, for the sync engine's `apply` phase, which has the rows but no credential. */
export function prefetchedWalletTransactionsSource(
  transactions: readonly ProviderTransaction[],
  categories: readonly ProviderCategory[],
): TransactionsSource {
  return {
    provider: WALLET_PROVIDER,
    fetchTransactions: async () => [...transactions],
    fetchCategories: async () => [...categories],
  };
}
```

- [ ] **Step 5: Run it and watch it pass**

Run: `npm test -- wallet-transactions-adapter`
Expected: PASS.

- [ ] **Step 6: Write the failing use-case test**

```ts
// src/modules/expenses/application/sync-provider-transactions.test.ts
import { describe, expect, it } from "vitest";
import { MemoryProviderLinksRepository } from "@/modules/accounts/infrastructure/memory-repositories";
import {
  MemoryCategoriesRepository,
  MemoryLabelsRepository,
  MemoryRecurringPatternsRepository,
  MemoryTransactionsRepository,
} from "../infrastructure/memory-repositories";
import { syncProviderTransactions } from "./sync-provider-transactions";
import type { ProviderCategory, ProviderTransaction } from "./ports";

function harness() {
  const links = new MemoryProviderLinksRepository();
  const audit: unknown[] = [];
  const deps = {
    transactions: new MemoryTransactionsRepository(),
    categories: new MemoryCategoriesRepository(),
    labels: new MemoryLabelsRepository(),
    recurring: new MemoryRecurringPatternsRepository(),
    links,
    clock: { now: () => new Date("2026-09-05T09:00:00Z") },
    audit: async (e: unknown) => {
      audit.push(e);
    },
  };
  return { deps, audit };
}

const category: ProviderCategory = { externalId: "wc-1", name: "Groceries", groupName: null, kind: "expense" };

function record(overrides: Partial<ProviderTransaction> = {}): ProviderTransaction {
  return {
    externalId: "wr-1",
    accountExternalId: "wallet-acc-1",
    occurredAt: new Date("2026-09-01T08:00:00Z"),
    amount: "-12.50",
    currency: "EUR",
    type: "expense",
    state: "cleared",
    payee: "Shop",
    note: null,
    categoryExternalId: "wc-1",
    labelExternalIds: ["work"],
    externalTransferRef: null,
    updatedAt: new Date("2026-09-01T08:00:00Z"),
    ...overrides,
  };
}

describe("syncProviderTransactions", () => {
  it("skips a record whose account has not been synced yet", async () => {
    const { deps } = harness();
    const source = { provider: "wallet", fetchTransactions: async () => [record()], fetchCategories: async () => [category] };
    const result = await syncProviderTransactions({ ...deps, source })("user-1", null);
    expect(result.skippedNoAccount).toBe(1);
    expect(await deps.transactions.listAll("user-1")).toHaveLength(0);
  });

  it("creates a category, a label and a transaction on first sync, then is idempotent on a second run", async () => {
    const { deps } = harness();
    await deps.links.upsertSeen(
      "user-1",
      { provider: "wallet", entityType: "account", entityId: "local-acc-1", externalId: "wallet-acc-1", metadata: {} },
      new Date(),
    );
    const source = { provider: "wallet", fetchTransactions: async () => [record()], fetchCategories: async () => [category] };
    const run = syncProviderTransactions({ ...deps, source });

    const first = await run("user-1", null);
    expect(first).toMatchObject({ transactionsCreated: 1, categoriesCreated: 1, labelsCreated: 1, skippedNoAccount: 0 });

    const second = await run("user-1", null);
    expect(second.transactionsCreated).toBe(0);
    const all = await deps.transactions.listAll("user-1");
    expect(all).toHaveLength(1);
    expect(all[0]!.categoryId).not.toBeNull();
  });

  it("pairs two legs of a transfer sharing a counter-record id", async () => {
    const { deps } = harness();
    await deps.links.upsertSeen("user-1", { provider: "wallet", entityType: "account", entityId: "local-acc-1", externalId: "wallet-acc-1", metadata: {} }, new Date());
    await deps.links.upsertSeen("user-1", { provider: "wallet", entityType: "account", entityId: "local-acc-2", externalId: "wallet-acc-2", metadata: {} }, new Date());
    const legA = record({ externalId: "wr-a", accountExternalId: "wallet-acc-1", amount: "-50.00", type: "transfer", categoryExternalId: null, labelExternalIds: [], externalTransferRef: "wr-b" });
    const legB = record({ externalId: "wr-b", accountExternalId: "wallet-acc-2", amount: "50.00", type: "transfer", categoryExternalId: null, labelExternalIds: [], externalTransferRef: "wr-a" });
    const source = { provider: "wallet", fetchTransactions: async () => [legA, legB], fetchCategories: async () => [] };
    await syncProviderTransactions({ ...deps, source })("user-1", null);
    const all = await deps.transactions.listAll("user-1");
    expect(all).toHaveLength(2);
    expect(all[0]!.transferGroupId).not.toBeNull();
    expect(all[0]!.transferGroupId).toBe(all[1]!.transferGroupId);
  });
});
```

- [ ] **Step 7: Run it and watch it fail**

Run: `npm test -- sync-provider-transactions`
Expected: FAIL — `Cannot find module './sync-provider-transactions'`.

- [ ] **Step 8: Implement `syncProviderTransactions`**

```ts
// src/modules/expenses/application/sync-provider-transactions.ts
import type { ProviderLinksRepository } from "@/modules/accounts/application/ports";
import { pairTransfers, type TransferCandidate } from "../domain/transaction";
import type { TransactionPatch, TransactionsSource, UseCaseDeps } from "./ports";

export interface SyncProviderTransactionsResult {
  transactionsCreated: number;
  transactionsUpdated: number;
  categoriesCreated: number;
  labelsCreated: number;
  skippedNoAccount: number;
}

export type SyncProviderTransactionsDeps = UseCaseDeps & {
  links: ProviderLinksRepository;
  source: TransactionsSource;
};

export function syncProviderTransactions(deps: SyncProviderTransactionsDeps) {
  return async (userId: string, sinceDate: string | null): Promise<SyncProviderTransactionsResult> => {
    const { provider } = deps.source;
    const now = deps.clock.now();
    const result: SyncProviderTransactionsResult = {
      transactionsCreated: 0,
      transactionsUpdated: 0,
      categoriesCreated: 0,
      labelsCreated: 0,
      skippedNoAccount: 0,
    };

    // 1. Categories, mirrored first so every transaction below can resolve one.
    const incomingCategories = await deps.source.fetchCategories();
    const categoryLinks = await deps.links.byExternal(
      userId,
      provider,
      "category",
      incomingCategories.map((c) => c.externalId),
    );
    const categoryIdByExternal = new Map<string, string>();
    for (const c of incomingCategories) {
      const link = categoryLinks.get(c.externalId);
      if (link) {
        categoryIdByExternal.set(c.externalId, link.entityId);
        continue;
      }
      const existing = await deps.categories.findByName(userId, c.name);
      const local =
        existing ??
        (await (async () => {
          const created = await deps.categories.create({
            userId,
            name: c.name,
            groupName: c.groupName,
            kind: c.kind,
            color: null,
            parentId: null,
            source: "provider",
            archivedAt: null,
          });
          result.categoriesCreated += 1;
          return created;
        })());
      await deps.links.upsertSeen(userId, { provider, entityType: "category", entityId: local.id, externalId: c.externalId, metadata: { name: c.name } }, now);
      categoryIdByExternal.set(c.externalId, local.id);
    }

    // 2. Transactions. An account must already be linked by the accounts
    // SyncKind — this handler never creates an account.
    const incoming = await deps.source.fetchTransactions(sinceDate);
    const accountLinks = await deps.links.byExternal(
      userId,
      provider,
      "account",
      [...new Set(incoming.map((t) => t.accountExternalId))],
    );
    const transactionLinks = await deps.links.byExternal(
      userId,
      provider,
      "transaction",
      incoming.map((t) => t.externalId),
    );

    const transferCandidates: TransferCandidate[] = [];

    for (const t of incoming) {
      const accountLink = accountLinks.get(t.accountExternalId);
      if (!accountLink) {
        result.skippedNoAccount += 1;
        continue;
      }
      const categoryId = t.categoryExternalId ? categoryIdByExternal.get(t.categoryExternalId) ?? null : null;
      const link = transactionLinks.get(t.externalId);
      const current = link ? await deps.transactions.get(userId, link.entityId) : null;

      let localId: string;
      if (link && current) {
        const patch: TransactionPatch = {};
        if (current.categoryId !== categoryId) patch.categoryId = categoryId;
        if (current.note !== t.note) patch.note = t.note;
        if (current.state !== t.state) patch.state = t.state;
        if (current.payee !== t.payee) patch.payee = t.payee;
        if (Object.keys(patch).length > 0) {
          await deps.transactions.update(userId, current.id, current.version, patch);
          result.transactionsUpdated += 1;
        }
        localId = current.id;
      } else {
        const created = await deps.transactions.create({
          userId,
          accountId: accountLink.entityId,
          occurredAt: t.occurredAt,
          bookedAt: t.updatedAt,
          amount: t.amount,
          currency: t.currency,
          type: t.type,
          state: t.state,
          categoryId,
          payee: t.payee,
          note: t.note,
          transferGroupId: null,
          source: "provider",
          syncRunId: null,
        });
        result.transactionsCreated += 1;
        localId = created.id;
      }
      await deps.links.upsertSeen(userId, { provider, entityType: "transaction", entityId: localId, externalId: t.externalId, metadata: {} }, now);

      const labelIds: string[] = [];
      for (const labelName of t.labelExternalIds) {
        let label = await deps.labels.findByName(userId, labelName);
        if (!label) {
          label = await deps.labels.create({ userId, name: labelName, color: null, source: "provider" });
          result.labelsCreated += 1;
        }
        // Wallet exposes a label only as a name, never a stable id, so the
        // name itself stands in for the external id here.
        await deps.links.upsertSeen(userId, { provider, entityType: "label", entityId: label.id, externalId: labelName, metadata: {} }, now);
        labelIds.push(label.id);
      }
      await deps.transactions.setLabels(userId, localId, labelIds);

      if (t.externalTransferRef) {
        transferCandidates.push({ id: localId, accountId: accountLink.entityId, amount: t.amount, occurredAt: t.occurredAt, externalTransferRef: t.externalTransferRef });
      }
    }

    // 3. Transfer pairing, once every leg above has a local id.
    const groups = pairTransfers(transferCandidates);
    for (const [transactionId, groupId] of groups) {
      const row = await deps.transactions.get(userId, transactionId);
      if (row && row.transferGroupId !== groupId) {
        await deps.transactions.update(userId, transactionId, row.version, { transferGroupId: groupId });
      }
    }

    await deps.audit({
      actorUserId: userId,
      action: "expenses.sync",
      entityType: "provider_connection",
      entityId: provider,
      after: { ...result },
    });

    return result;
  };
}
```

- [ ] **Step 9: Run the tests**

Run: `npm test -- sync-provider-transactions`
Expected: PASS.

- [ ] **Step 10: Typecheck and commit**

Run: `npx tsc --noEmit`
Expected: no errors.

```bash
git add src/modules/expenses/application/ports.ts src/modules/expenses/application/sync-provider-transactions.ts src/modules/expenses/application/sync-provider-transactions.test.ts src/modules/expenses/infrastructure/wallet-transactions-adapter.ts src/modules/expenses/infrastructure/wallet-transactions-adapter.test.ts
git commit -m "feat(expenses): add the Wallet transactions adapter and the provider-reconciliation use case"
```

---

### Task 8: Transactions as a new `SyncKind` on the Wallet provider

**Files:**
- Modify: `src/platform/integrations/types.ts`
- Modify: `src/modules/integrations/api/schemas.ts`
- Modify: `src/modules/integrations/infrastructure/wallet-provider-adapter.ts`
- Modify: `src/modules/integrations/infrastructure/wallet-provider-adapter.test.ts`
- Regenerate: `docs/api/openapi.json`

**Interfaces:**
- Consumes: `walletTransactionsSource`, `prefetchedWalletTransactionsSource` from `@/modules/expenses/infrastructure/wallet-transactions-adapter` (Task 7); `syncProviderTransactions` from `@/modules/expenses/application/sync-provider-transactions` (Task 7); `expenseDeps` from `@/modules/expenses/infrastructure/deps` (Task 5); `accountDeps` from `@/modules/accounts/infrastructure/deps` (existing, reused for its `.links` repository so this task needs no new mock target); `romeDate` from `@/lib/time` (existing).
- Produces:
```ts
// src/platform/integrations/types.ts
export type SyncKind = "accounts" | "leave" | "transactions"; // was: "accounts" | "leave"
```
Every call site of `SyncKind` that pattern-matches or hardcodes the union is updated in this same task: `src/modules/integrations/api/schemas.ts`'s two `z.enum([...])` literals. All other consumers (`run-sync.ts`, both repositories, the registry) already type against `SyncKind` generically and need no change — confirmed by reading every file that imports `SyncKind` before writing this task.

- [ ] **Step 1: Widen `SyncKind` and its two hardcoded schema enums**

In `src/platform/integrations/types.ts`:
```ts
export type SyncKind = "accounts" | "leave" | "transactions";
```

In `src/modules/integrations/api/schemas.ts`, change both occurrences of:
```ts
z.enum(["accounts", "leave"])
```
to:
```ts
z.enum(["accounts", "leave", "transactions"])
```

- [ ] **Step 2: Run the integrations test suite and confirm it still passes (no behavior change yet)**

Run: `npm test -- integrations`
Expected: PASS (this step only widens a union; nothing consumes `"transactions"` yet).

- [ ] **Step 3: Write the failing test for the new sync handler**

Extend `src/modules/integrations/infrastructure/wallet-provider-adapter.test.ts`. First, widen the existing `@/lib/clients/wallet` mock to add the two new client functions:

```ts
vi.mock("@/lib/clients/wallet", () => ({
  getAccounts: vi.fn(async (opts: { token: string }) => {
    if (opts.token !== "good") throw new Error("401 from the Wallet API");
    return [
      { id: "w1", name: "ING - Salary", currencyCode: "EUR", archived: false, accountType: "general", balance: { currentBalance: 1234.5 } },
    ];
  }),
  getRecords: vi.fn(async () => [
    { id: "r1", accountId: "w1", amount: -12.5, currencyCode: "EUR", recordType: "expense", recordState: "cleared", recordDate: "2026-09-04T08:00:00Z", categoryId: "c1", labels: [] },
  ]),
  getCategories: vi.fn(async () => [{ id: "c1", name: "Groceries", group: null }]),
}));
```

Then add a mock for the expenses deps (mirroring the existing accounts one) and a test:

```ts
vi.mock("@/modules/expenses/infrastructure/deps", async () => {
  const { MemoryCategoriesRepository, MemoryLabelsRepository, MemoryRecurringPatternsRepository, MemoryTransactionsRepository } = await import(
    "@/modules/expenses/infrastructure/memory-repositories"
  );
  const transactions = new MemoryTransactionsRepository();
  const categories = new MemoryCategoriesRepository();
  const labels = new MemoryLabelsRepository();
  const recurring = new MemoryRecurringPatternsRepository();
  return {
    expenseDeps: () => ({
      transactions,
      categories,
      labels,
      recurring,
      clock: { now: () => new Date("2026-09-04T09:00:00Z") },
      audit: async () => {},
    }),
    __expenseFixture: { transactions },
  };
});

// add near the other describe blocks:
describe("wallet provider adapter — transactions sync", () => {
  it("declares a transactions sync handler and links a fetched record to an already-synced account", async () => {
    const fixture = await disconnectFixture(); // reuses the accounts memory links repository already seeded by the existing accountDeps mock
    await fixture.links.upsertSeen("u1", { provider: "wallet", entityType: "account", entityId: "local-1", externalId: "w1", metadata: {} }, new Date());

    expect(walletProvider.syncs.transactions).toBeDefined();
    const payload = await walletProvider.syncs.transactions!.fetch({
      connection: connectionFixture(),
      credentials: { token: "good" },
      runId: "run-1",
      clock: { now: () => new Date("2026-09-04T09:00:00Z") },
      cursor: null,
    });
    const stats = await walletProvider.syncs.transactions!.apply(
      {
        connection: connectionFixture(),
        runId: "run-1",
        db: unusedDb,
        clock: { now: () => new Date("2026-09-04T09:00:00Z") },
        cursor: null,
        setCursor: () => {},
        audit: async () => {},
      },
      payload,
    );
    expect(stats.transactionsCreated).toBe(1);
    expect(stats.skippedNoAccount).toBe(0);
  });
});
```

- [ ] **Step 4: Run it and watch it fail**

Run: `npm test -- wallet-provider-adapter`
Expected: FAIL — `walletProvider.syncs.transactions` is `undefined`.

- [ ] **Step 5: Add the `transactionsSync` handler and wire it in**

In `src/modules/integrations/infrastructure/wallet-provider-adapter.ts`, add the imports and the handler, then add it to `syncs`:

```ts
import { accountDeps } from "@/modules/accounts/infrastructure/deps";
import { expenseDeps } from "@/modules/expenses/infrastructure/deps";
import { syncProviderTransactions } from "@/modules/expenses/application/sync-provider-transactions";
import {
  prefetchedWalletTransactionsSource,
  walletTransactionsSource,
} from "@/modules/expenses/infrastructure/wallet-transactions-adapter";
import { romeDate } from "@/lib/time";
import type { ProviderCategory, ProviderTransaction } from "@/modules/expenses/application/ports";

interface TransactionsSyncPayload {
  transactions: ProviderTransaction[];
  categories: ProviderCategory[];
  nextSinceDate: string;
}

const RECORDS_LOOKBACK_DAYS = 7;

/** Re-fetches a short overlap before the last cursor to catch late edits; the sync is idempotent so overlap never duplicates anything. */
function lookback(dateStr: string, days: number): string {
  const d = new Date(`${dateStr}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() - days);
  return d.toISOString().slice(0, 10);
}

/**
 * Incremental, cursor-based, exactly like `accountsSync` splits where the
 * network is: `fetch` makes the Wallet round trips (records + categories)
 * with no transaction open, `apply` does the whole reconciliation inside one.
 * The cursor is the Rome date this pass ran; the next pass re-requests from
 * `RECORDS_LOOKBACK_DAYS` before that, so a record whose `updatedAt` moved
 * after the fact is still picked up.
 */
const transactionsSync: SyncHandler<TransactionsSyncPayload> = {
  schedule: "hourly",

  async fetch(ctx: SyncFetchContext): Promise<TransactionsSyncPayload> {
    const cursor = ctx.cursor as { sinceDate: string } | null;
    const sinceDate = cursor ? lookback(cursor.sinceDate, RECORDS_LOOKBACK_DAYS) : null;
    const source = walletTransactionsSource(ctx.credentials.token!);
    const [transactions, categories] = await Promise.all([source.fetchTransactions(sinceDate), source.fetchCategories()]);
    return { transactions, categories, nextSinceDate: romeDate(ctx.clock.now()) };
  },

  async apply(ctx: SyncApplyContext, payload: TransactionsSyncPayload): Promise<Record<string, number>> {
    const expenses = expenseDeps(ctx.db);
    const links = accountDeps(ctx.db).links;
    const source = prefetchedWalletTransactionsSource(payload.transactions, payload.categories);
    const result = await syncProviderTransactions({ ...expenses, links, source })(ctx.connection.userId, null);
    ctx.setCursor({ sinceDate: payload.nextSinceDate });
    return { ...result };
  },
};
```

Then change:
```ts
syncs: { accounts: accountsSync },
```
to:
```ts
syncs: { accounts: accountsSync, transactions: transactionsSync },
```

- [ ] **Step 6: Run the tests**

Run: `npm test -- wallet-provider-adapter`
Expected: PASS.

- [ ] **Step 7: Regenerate the OpenAPI document**

Run: `npm run openapi:generate`
Expected: `docs/api/openapi.json written`; `SyncKind`'s two enum sites now list `transactions`.

- [ ] **Step 8: Run the full unit suite, the OpenAPI drift test, and typecheck**

Run: `npm test && npx tsc --noEmit`
Expected: all PASS, including `src/platform/http/openapi-drift.test.ts`.

- [ ] **Step 9: Commit**

```bash
git add src/platform/integrations/types.ts src/modules/integrations/api/schemas.ts src/modules/integrations/infrastructure/wallet-provider-adapter.ts src/modules/integrations/infrastructure/wallet-provider-adapter.test.ts docs/api/openapi.json
git commit -m "feat(integrations): add transactions as a SyncKind on the Wallet provider"
```

---

### Task 9: Expenses use cases — list, get, update a transaction; list categories and labels

**Files:**
- Modify: `src/platform/auth/permissions.ts`
- Create: `src/modules/expenses/application/list-transactions.ts`
- Create: `src/modules/expenses/application/list-transactions.test.ts`
- Create: `src/modules/expenses/application/get-transaction.ts`
- Create: `src/modules/expenses/application/get-transaction.test.ts`
- Create: `src/modules/expenses/application/update-transaction.ts`
- Create: `src/modules/expenses/application/update-transaction.test.ts`
- Create: `src/modules/expenses/application/list-categories.ts`
- Create: `src/modules/expenses/application/list-labels.ts`
- Create: `src/modules/expenses/application/list-categories-and-labels.test.ts`

**Interfaces:**
- Consumes: `UseCaseDeps`, `TransactionPatch` from `./ports` (Task 4); `NotFoundError`, `VersionMismatchError` from `./errors` (Task 4); `Principal`, `assertPermission` from `@/platform/auth/principal`; `testPrincipal` from `@/test/principal`.
- Produces:
```ts
export interface TransactionListItem { transaction: Transaction; category: TransactionCategory | null; labelIds: string[]; }
export interface ListTransactionsResult { items: TransactionListItem[]; nextCursor: string | null; }
export function listTransactions(deps: UseCaseDeps): (principal: Principal, opts: ListTransactionsOptions) => Promise<ListTransactionsResult>;

export interface TransactionDetail { transaction: Transaction; category: TransactionCategory | null; labelIds: string[]; }
export function getTransaction(deps: UseCaseDeps): (principal: Principal, id: string) => Promise<TransactionDetail>;

export interface UpdateTransactionInput { categoryId?: string | null; note?: string | null; state?: Transaction["state"]; labelIds?: string[]; }
export function updateTransaction(deps: UseCaseDeps): (principal: Principal, id: string, expectedVersion: number, input: UpdateTransactionInput) => Promise<Transaction>;

export function listCategories(deps: UseCaseDeps): (principal: Principal) => Promise<TransactionCategory[]>;
export function listLabels(deps: UseCaseDeps): (principal: Principal) => Promise<TransactionLabel[]>;
```
- Permission catalogue gains `"expenses.read"` and `"expenses.write"`, granted to `owner`/`admin` (already, via the full `PERMISSIONS` spread) and to `member`; `viewer` gets `"expenses.read"` only.

- [ ] **Step 1: Add the two new permissions**

In `src/platform/auth/permissions.ts`:
```ts
export const PERMISSIONS = [
  "accounts.read",
  "accounts.write",
  "accounts.delete",
  "finance.manage",
  "integrations.manage",
  "jobs.run",
  "expenses.read",
  "expenses.write",
  "admin.users",
  "admin.audit",
] as const;
```
and widen the `member`/`viewer` rows:
```ts
member: [
  "accounts.read", "accounts.write", "accounts.delete",
  "finance.manage", "integrations.manage", "jobs.run",
  "expenses.read", "expenses.write",
],
viewer: ["accounts.read", "expenses.read"],
```

- [ ] **Step 2: Write the failing tests**

```ts
// src/modules/expenses/application/list-transactions.test.ts
import { describe, expect, it } from "vitest";
import { testPrincipal } from "@/test/principal";
import { MemoryCategoriesRepository, MemoryLabelsRepository, MemoryRecurringPatternsRepository, MemoryTransactionsRepository } from "../infrastructure/memory-repositories";
import { listTransactions } from "./list-transactions";

function harness() {
  return {
    transactions: new MemoryTransactionsRepository(),
    categories: new MemoryCategoriesRepository(),
    labels: new MemoryLabelsRepository(),
    recurring: new MemoryRecurringPatternsRepository(),
    clock: { now: () => new Date("2026-09-05T00:00:00Z") },
    audit: async () => {},
  };
}

describe("listTransactions", () => {
  it("attaches each transaction's category and labels", async () => {
    const deps = harness();
    const category = await deps.categories.create({ userId: "u1", name: "Groceries", groupName: null, kind: "expense", color: null, parentId: null, source: "manual", archivedAt: null });
    const created = await deps.transactions.create({ userId: "u1", accountId: "acc-1", occurredAt: new Date(), bookedAt: null, amount: "-10.00", currency: "EUR", type: "expense", state: "cleared", categoryId: category.id, payee: null, note: null, transferGroupId: null, source: "manual", syncRunId: null });
    await deps.transactions.setLabels("u1", created.id, ["label-1"]);

    const result = await listTransactions(deps)(testPrincipal(), {});
    expect(result.items).toHaveLength(1);
    expect(result.items[0]!.category?.name).toBe("Groceries");
    expect(result.items[0]!.labelIds).toEqual(["label-1"]);
  });

  it("denies a principal without expenses.read", async () => {
    const deps = harness();
    await expect(listTransactions(deps)(testPrincipal({ roles: [] }), {})).rejects.toThrow();
  });
});
```

```ts
// src/modules/expenses/application/get-transaction.test.ts
import { describe, expect, it } from "vitest";
import { testPrincipal } from "@/test/principal";
import { MemoryCategoriesRepository, MemoryLabelsRepository, MemoryRecurringPatternsRepository, MemoryTransactionsRepository } from "../infrastructure/memory-repositories";
import { NotFoundError } from "./errors";
import { getTransaction } from "./get-transaction";

function harness() {
  return {
    transactions: new MemoryTransactionsRepository(),
    categories: new MemoryCategoriesRepository(),
    labels: new MemoryLabelsRepository(),
    recurring: new MemoryRecurringPatternsRepository(),
    clock: { now: () => new Date() },
    audit: async () => {},
  };
}

describe("getTransaction", () => {
  it("throws NotFoundError for a transaction belonging to someone else", async () => {
    const deps = harness();
    const created = await deps.transactions.create({ userId: "other-user", accountId: "acc-1", occurredAt: new Date(), bookedAt: null, amount: "-1.00", currency: "EUR", type: "expense", state: "cleared", categoryId: null, payee: null, note: null, transferGroupId: null, source: "manual", syncRunId: null });
    await expect(getTransaction(deps)(testPrincipal(), created.id)).rejects.toThrow(NotFoundError);
  });
});
```

```ts
// src/modules/expenses/application/update-transaction.test.ts
import { describe, expect, it } from "vitest";
import { testPrincipal } from "@/test/principal";
import { MemoryCategoriesRepository, MemoryLabelsRepository, MemoryRecurringPatternsRepository, MemoryTransactionsRepository } from "../infrastructure/memory-repositories";
import { VersionMismatchError } from "./errors";
import { updateTransaction } from "./update-transaction";

function harness() {
  return {
    transactions: new MemoryTransactionsRepository(),
    categories: new MemoryCategoriesRepository(),
    labels: new MemoryLabelsRepository(),
    recurring: new MemoryRecurringPatternsRepository(),
    clock: { now: () => new Date() },
    audit: async () => {},
  };
}

describe("updateTransaction", () => {
  it("recategorises, sets a note and replaces labels in one call", async () => {
    const deps = harness();
    const created = await deps.transactions.create({ userId: "u1", accountId: "acc-1", occurredAt: new Date(), bookedAt: null, amount: "-1.00", currency: "EUR", type: "expense", state: "cleared", categoryId: null, payee: null, note: null, transferGroupId: null, source: "manual", syncRunId: null });
    const category = await deps.categories.create({ userId: "u1", name: "Coffee", groupName: null, kind: "expense", color: null, parentId: null, source: "manual", archivedAt: null });
    const updated = await updateTransaction(deps)(testPrincipal(), created.id, created.version, { categoryId: category.id, note: "Morning coffee", labelIds: ["l1"] });
    expect(updated.categoryId).toBe(category.id);
    expect(updated.note).toBe("Morning coffee");
    expect((await deps.transactions.labelsFor("u1", [created.id])).get(created.id)).toEqual(["l1"]);
  });

  it("throws VersionMismatchError on a stale version", async () => {
    const deps = harness();
    const created = await deps.transactions.create({ userId: "u1", accountId: "acc-1", occurredAt: new Date(), bookedAt: null, amount: "-1.00", currency: "EUR", type: "expense", state: "cleared", categoryId: null, payee: null, note: null, transferGroupId: null, source: "manual", syncRunId: null });
    await expect(updateTransaction(deps)(testPrincipal(), created.id, created.version + 1, { note: "x" })).rejects.toThrow(VersionMismatchError);
  });
});
```

```ts
// src/modules/expenses/application/list-categories-and-labels.test.ts
import { describe, expect, it } from "vitest";
import { testPrincipal } from "@/test/principal";
import { MemoryCategoriesRepository, MemoryLabelsRepository, MemoryRecurringPatternsRepository, MemoryTransactionsRepository } from "../infrastructure/memory-repositories";
import { listCategories } from "./list-categories";
import { listLabels } from "./list-labels";

function harness() {
  return {
    transactions: new MemoryTransactionsRepository(),
    categories: new MemoryCategoriesRepository(),
    labels: new MemoryLabelsRepository(),
    recurring: new MemoryRecurringPatternsRepository(),
    clock: { now: () => new Date() },
    audit: async () => {},
  };
}

describe("listCategories and listLabels", () => {
  it("return only the caller's own rows, alphabetised", async () => {
    const deps = harness();
    await deps.categories.create({ userId: "u1", name: "Zoo", groupName: null, kind: "expense", color: null, parentId: null, source: "manual", archivedAt: null });
    await deps.categories.create({ userId: "u1", name: "Air travel", groupName: null, kind: "expense", color: null, parentId: null, source: "manual", archivedAt: null });
    await deps.categories.create({ userId: "other", name: "Middle", groupName: null, kind: "expense", color: null, parentId: null, source: "manual", archivedAt: null });
    const categories = await listCategories(deps)(testPrincipal());
    expect(categories.map((c) => c.name)).toEqual(["Air travel", "Zoo"]);

    await deps.labels.create({ userId: "u1", name: "Work", color: null, source: "manual" });
    const labels = await listLabels(deps)(testPrincipal());
    expect(labels.map((l) => l.name)).toEqual(["Work"]);
  });
});
```

- [ ] **Step 3: Run the tests and watch them fail**

Run: `npm test -- expenses/application`
Expected: FAIL — the five use-case modules do not exist yet.

- [ ] **Step 4: Implement the five use cases**

```ts
// src/modules/expenses/application/list-transactions.ts
import type { Principal } from "@/platform/auth/principal";
import { assertPermission } from "@/platform/auth/principal";
import type { TransactionCategory } from "../domain/transaction";
import type { Transaction } from "../domain/transaction";
import type { ListTransactionsOptions, UseCaseDeps } from "./ports";

export interface TransactionListItem {
  transaction: Transaction;
  category: TransactionCategory | null;
  labelIds: string[];
}

export interface ListTransactionsResult {
  items: TransactionListItem[];
  nextCursor: string | null;
}

export function listTransactions(deps: UseCaseDeps) {
  return async (principal: Principal, opts: ListTransactionsOptions): Promise<ListTransactionsResult> => {
    assertPermission(principal, "expenses.read");
    const page = await deps.transactions.list(principal.userId, opts);
    const categories = await deps.categories.list(principal.userId, { includeArchived: true });
    const categoryById = new Map(categories.map((c) => [c.id, c]));
    const items = page.items.map((t) => ({
      transaction: t,
      category: t.categoryId ? categoryById.get(t.categoryId) ?? null : null,
      labelIds: page.labelsByTransaction.get(t.id) ?? [],
    }));
    return { items, nextCursor: page.nextCursor };
  };
}
```

```ts
// src/modules/expenses/application/get-transaction.ts
import type { Principal } from "@/platform/auth/principal";
import { assertPermission } from "@/platform/auth/principal";
import type { TransactionCategory, Transaction } from "../domain/transaction";
import type { UseCaseDeps } from "./ports";
import { NotFoundError } from "./errors";

export interface TransactionDetail {
  transaction: Transaction;
  category: TransactionCategory | null;
  labelIds: string[];
}

export function getTransaction(deps: UseCaseDeps) {
  return async (principal: Principal, id: string): Promise<TransactionDetail> => {
    assertPermission(principal, "expenses.read");
    const transaction = await deps.transactions.get(principal.userId, id);
    if (!transaction) throw new NotFoundError();
    const category = transaction.categoryId ? await deps.categories.get(principal.userId, transaction.categoryId) : null;
    const labelIds = (await deps.transactions.labelsFor(principal.userId, [id])).get(id) ?? [];
    return { transaction, category, labelIds };
  };
}
```

```ts
// src/modules/expenses/application/update-transaction.ts
import type { Principal } from "@/platform/auth/principal";
import { assertPermission } from "@/platform/auth/principal";
import type { Transaction } from "../domain/transaction";
import type { TransactionPatch, UseCaseDeps } from "./ports";
import { NotFoundError, VersionMismatchError } from "./errors";

export interface UpdateTransactionInput {
  categoryId?: string | null;
  note?: string | null;
  state?: Transaction["state"];
  labelIds?: string[];
}

export function updateTransaction(deps: UseCaseDeps) {
  return async (
    principal: Principal,
    id: string,
    expectedVersion: number,
    input: UpdateTransactionInput,
  ): Promise<Transaction> => {
    assertPermission(principal, "expenses.write");
    const patch: TransactionPatch = {};
    if (input.categoryId !== undefined) patch.categoryId = input.categoryId;
    if (input.note !== undefined) patch.note = input.note;
    if (input.state !== undefined) patch.state = input.state;
    const result = await deps.transactions.update(principal.userId, id, expectedVersion, patch);
    if (result === null) throw new NotFoundError();
    if (result === "version_mismatch") throw new VersionMismatchError();
    if (input.labelIds !== undefined) await deps.transactions.setLabels(principal.userId, id, input.labelIds);
    await deps.audit({
      actorUserId: principal.userId,
      action: "expenses.transaction_updated",
      entityType: "transaction",
      entityId: id,
      after: input,
    });
    return result;
  };
}
```

```ts
// src/modules/expenses/application/list-categories.ts
import type { Principal } from "@/platform/auth/principal";
import { assertPermission } from "@/platform/auth/principal";
import type { TransactionCategory } from "../domain/transaction";
import type { UseCaseDeps } from "./ports";

export function listCategories(deps: UseCaseDeps) {
  return async (principal: Principal): Promise<TransactionCategory[]> => {
    assertPermission(principal, "expenses.read");
    return deps.categories.list(principal.userId);
  };
}
```

```ts
// src/modules/expenses/application/list-labels.ts
import type { Principal } from "@/platform/auth/principal";
import { assertPermission } from "@/platform/auth/principal";
import type { TransactionLabel } from "../domain/transaction";
import type { UseCaseDeps } from "./ports";

export function listLabels(deps: UseCaseDeps) {
  return async (principal: Principal): Promise<TransactionLabel[]> => {
    assertPermission(principal, "expenses.read");
    return deps.labels.list(principal.userId);
  };
}
```

- [ ] **Step 5: Run the tests**

Run: `npm test -- expenses/application`
Expected: PASS.

- [ ] **Step 6: Typecheck and commit**

Run: `npx tsc --noEmit`
Expected: no errors.

```bash
git add src/platform/auth/permissions.ts src/modules/expenses/application/list-transactions.ts src/modules/expenses/application/list-transactions.test.ts src/modules/expenses/application/get-transaction.ts src/modules/expenses/application/get-transaction.test.ts src/modules/expenses/application/update-transaction.ts src/modules/expenses/application/update-transaction.test.ts src/modules/expenses/application/list-categories.ts src/modules/expenses/application/list-labels.ts src/modules/expenses/application/list-categories-and-labels.test.ts
git commit -m "feat(expenses): add list/get/update transaction and list categories/labels use cases"
```

---

### Task 10: Expenses REST API

**Files:**
- Create: `src/modules/expenses/api/schemas.ts`
- Create: `src/modules/expenses/api/routes.ts`
- Create: `src/modules/expenses/api/routes.itest.ts`
- Modify: `src/platform/http/app.ts:141-145` (`registerAllRoutes`: add the one call to `registerExpenseRoutes(app, deps)`)
- Regenerate: `docs/api/openapi.json`

**Interfaces:**
- Consumes: `listTransactions`, `getTransaction`, `updateTransaction`, `listCategories`, `listLabels` from `../application/*` (Task 9); `expenseDeps` from `../infrastructure/deps` (Task 5); `withUserContext` from `@/platform/db/context`; `ApiApp`, `ApiDeps` from `@/platform/http/app`; `ApiError`, `toErrorBody` from `@/platform/http/errors`; `parseExpectedVersion` from `@/platform/http/versioning`; `NotFoundError`, `VersionMismatchError` from `../application/errors`; `ErrorResponseSchema` from `@/modules/accounts/api/schemas` (existing — the app's one shared copy, imported rather than redeclared; see the corrected Ruling P3-11).
- Produces:
```ts
export function registerExpenseRoutes(app: ApiApp, deps: ApiDeps): void;
// Routes: GET /transactions, GET /transactions/{id}, PATCH /transactions/{id},
//         GET /transaction-categories, GET /transaction-labels
```
- Modifies `registerAllRoutes` in `src/platform/http/app.ts` to also call `registerExpenseRoutes(app, deps)` — the one call site for this new export.

- [ ] **Step 1: Write the failing integration test**

```ts
// src/modules/expenses/api/routes.itest.ts
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { accounts, organizations, users } from "@/lib/db/schema";
import { db } from "@/lib/db";
import { createApiApp } from "@/platform/http/app";
import { permissionsForRoles } from "@/platform/auth/permissions";
import { closeDb, resetDb, testDb } from "@/test/db";

async function seedUser() {
  const testdb = await testDb();
  const [org] = await testdb.insert(organizations).values({ name: "P" }).returning();
  const [user] = await testdb.insert(users).values({ organizationId: org!.id, displayName: "A" }).returning();
  const [account] = await testdb.insert(accounts).values({ userId: user!.id, name: "Cash", type: "cash", origin: "manual" }).returning();
  return { userId: user!.id, organizationId: org!.id, accountId: account!.id };
}

function appFor(userId: string, organizationId: string) {
  return createApiApp({
    db,
    now: () => new Date("2026-09-05T09:00:00Z"),
    rateLimitEnabled: false,
    authenticate: async () => ({
      principal: { userId, organizationId, roles: ["owner"], permissions: permissionsForRoles(["owner"]) },
      method: "session",
    }),
  });
}

describe("expenses API", () => {
  beforeEach(resetDb);
  afterAll(closeDb);

  it("lists no transactions for a fresh account, then the one just created via direct repository seed", async () => {
    const { userId, organizationId } = await seedUser();
    const app = appFor(userId, organizationId);
    const res = await app.request("/api/v1/transactions", { headers: { "x-requested-with": "test" } });
    expect(res.status).toBe(200);
    expect((await res.json()) as { items: unknown[] }).toMatchObject({ items: [] });
  });

  it("rejects a PATCH with no Idempotency concerns but a stale version as 409 version_mismatch", async () => {
    const { userId, organizationId, accountId } = await seedUser();
    const { withUserContext } = await import("@/platform/db/context");
    const { DrizzleTransactionsRepository } = await import("@/modules/expenses/infrastructure/drizzle-transactions-repository");
    const created = await withUserContext(db, { userId }, (tx) =>
      new DrizzleTransactionsRepository(tx).create({
        userId, accountId, occurredAt: new Date(), bookedAt: null, amount: "-5.00", currency: "EUR",
        type: "expense", state: "cleared", categoryId: null, payee: null, note: null,
        transferGroupId: null, source: "manual", syncRunId: null,
      }),
    );
    const app = appFor(userId, organizationId);
    const res = await app.request(`/api/v1/transactions/${created.id}`, {
      method: "PATCH",
      headers: { "x-requested-with": "test", "content-type": "application/json", "if-match": String(created.version + 1) },
      body: JSON.stringify({ note: "x" }),
    });
    expect(res.status).toBe(409);
    expect(((await res.json()) as { error: { code: string } }).error.code).toBe("version_mismatch");
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `npm run test:integration -- expenses/api/routes`
Expected: FAIL — `GET /api/v1/transactions` returns `404 not_found` (route not registered).

- [ ] **Step 3: Write the Zod schemas**

```ts
// src/modules/expenses/api/schemas.ts
import { z } from "@hono/zod-openapi";

export const TransactionTypeSchema = z.enum(["income", "expense", "transfer"]).openapi("TransactionType");
export const TransactionStateSchema = z.enum(["pending", "cleared", "reconciled"]).openapi("TransactionState");
export const CategoryKindSchema = z.enum(["income", "expense", "transfer", "system"]).openapi("CategoryKind");
export const RecordSourceSchema = z.enum(["manual", "provider", "system", "migration"]).openapi("RecordSource");

export const TransactionSchema = z
  .object({
    id: z.string().uuid(),
    accountId: z.string().uuid(),
    occurredAt: z.string(),
    bookedAt: z.string().nullable(),
    amount: z.string(),
    currency: z.string(),
    type: TransactionTypeSchema,
    state: TransactionStateSchema,
    categoryId: z.string().uuid().nullable(),
    payee: z.string().nullable(),
    note: z.string().nullable(),
    transferGroupId: z.string().uuid().nullable(),
    source: RecordSourceSchema,
    version: z.number(),
    createdAt: z.string(),
    updatedAt: z.string(),
  })
  .openapi("Transaction");

export const TransactionCategorySchema = z
  .object({
    id: z.string().uuid(),
    name: z.string(),
    groupName: z.string().nullable(),
    kind: CategoryKindSchema,
    color: z.string().nullable(),
    source: RecordSourceSchema,
    archivedAt: z.string().nullable(),
  })
  .openapi("TransactionCategory");

export const TransactionLabelSchema = z
  .object({ id: z.string().uuid(), name: z.string(), color: z.string().nullable(), source: RecordSourceSchema })
  .openapi("TransactionLabel");

export const TransactionListItemSchema = z
  .object({ transaction: TransactionSchema, category: TransactionCategorySchema.nullable(), labelIds: z.array(z.string().uuid()) })
  .openapi("TransactionListItem");

export const TransactionListResponseSchema = z
  .object({ items: z.array(TransactionListItemSchema), nextCursor: z.string().nullable() })
  .openapi("TransactionListResponse");

export const ListTransactionsQuerySchema = z.object({
  accountId: z.string().uuid().optional(),
  categoryId: z.string().uuid().optional(),
  labelId: z.string().uuid().optional(),
  type: TransactionTypeSchema.optional(),
  from: z.string().optional(),
  to: z.string().optional(),
  cursor: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(200).optional(),
});

export const UpdateTransactionRequestSchema = z.object({
  categoryId: z.string().uuid().nullable().optional(),
  note: z.string().nullable().optional(),
  state: TransactionStateSchema.optional(),
  labelIds: z.array(z.string().uuid()).optional(),
  version: z.number().int().optional(),
});

export const CategoryListResponseSchema = z.object({ items: z.array(TransactionCategorySchema) }).openapi("CategoryListResponse");
export const LabelListResponseSchema = z.object({ items: z.array(TransactionLabelSchema) }).openapi("LabelListResponse");

// `ErrorResponseSchema` itself is NOT declared here: it is imported from
// `@/modules/accounts/api/schemas` in routes.ts, the app's one existing
// `.openapi("ErrorResponse")` registration. Every route in this app shares
// one `OpenAPIHono` instance, so a second module-local declaration tagged
// with the same OpenAPI component name would collide with it at
// `npm run openapi:generate` time — see the corrected Ruling P3-11.
```

- [ ] **Step 4: Write `routes.ts`**

```ts
// src/modules/expenses/api/routes.ts
import { createRoute, z } from "@hono/zod-openapi";
import type { ApiApp, ApiDeps } from "@/platform/http/app";
import { ApiError } from "@/platform/http/errors";
import { parseExpectedVersion } from "@/platform/http/versioning";
import { withUserContext } from "@/platform/db/context";
import { getTransaction } from "../application/get-transaction";
import { listCategories } from "../application/list-categories";
import { listLabels } from "../application/list-labels";
import { listTransactions } from "../application/list-transactions";
import { updateTransaction } from "../application/update-transaction";
import { NotFoundError, VersionMismatchError } from "../application/errors";
import { expenseDeps } from "../infrastructure/deps";
import { ErrorResponseSchema } from "@/modules/accounts/api/schemas";
import {
  CategoryListResponseSchema,
  LabelListResponseSchema,
  ListTransactionsQuerySchema,
  TransactionListItemSchema,
  TransactionListResponseSchema,
  UpdateTransactionRequestSchema,
} from "./schemas";

const IdParamSchema = z.object({ id: z.string().uuid() });
const IfMatchHeaderSchema = z.object({ "if-match": z.string().optional() });

function errorResponse(description: string) {
  return { description, content: { "application/json": { schema: ErrorResponseSchema } } };
}

/**
 * `ErrorResponseSchema` itself is the one shared copy, imported from
 * `@/modules/accounts/api/schemas` above — not redeclared here. Only this
 * `errorResponse()`/`commonErrorResponses` wiring is duplicated per module
 * (accounts, integrations, and now expenses each define their own), the way
 * accounts and integrations already do; that part is a plain object of route
 * descriptions, not an OpenAPI component registration, so duplicating it
 * carries none of `ErrorResponseSchema`'s collision risk.
 */
const commonErrorResponses = {
  401: errorResponse("Not signed in (`unauthorized`)."),
  403: errorResponse("Missing permission (`permission_denied`), or a cookie-authenticated write sent without `X-Requested-With` (`csrf_required`)."),
  404: errorResponse("Not found (`not_found`)."),
  409: errorResponse("Version conflict (`version_mismatch`)."),
  422: errorResponse("Validation failed (`validation_failed`)."),
  428: errorResponse("The version precondition is missing (`precondition_required`)."),
  429: errorResponse("Over the per-minute rate limit (`rate_limited`)."),
};

function toApiError(err: unknown): ApiError {
  if (err instanceof NotFoundError) return new ApiError(404, "not_found", err.message);
  if (err instanceof VersionMismatchError) return new ApiError(409, "version_mismatch", err.message);
  throw err;
}

const listRoute = createRoute({
  method: "get",
  path: "/transactions",
  tags: ["Expenses"],
  security: [{ session: [] }],
  request: { query: ListTransactionsQuerySchema },
  responses: { 200: { content: { "application/json": { schema: TransactionListResponseSchema } }, description: "OK" }, ...commonErrorResponses },
});

const getRoute = createRoute({
  method: "get",
  path: "/transactions/{id}",
  tags: ["Expenses"],
  security: [{ session: [] }],
  request: { params: IdParamSchema },
  responses: {
    200: { content: { "application/json": { schema: TransactionListItemSchema } }, description: "OK" },
    ...commonErrorResponses,
  },
});

const patchRoute = createRoute({
  method: "patch",
  path: "/transactions/{id}",
  tags: ["Expenses"],
  security: [{ session: [] }],
  request: {
    params: IdParamSchema,
    headers: IfMatchHeaderSchema,
    body: { content: { "application/json": { schema: UpdateTransactionRequestSchema } } },
  },
  responses: {
    200: { content: { "application/json": { schema: TransactionListItemSchema } }, description: "OK" },
    ...commonErrorResponses,
  },
});

const categoriesRoute = createRoute({
  method: "get",
  path: "/transaction-categories",
  tags: ["Expenses"],
  security: [{ session: [] }],
  responses: { 200: { content: { "application/json": { schema: CategoryListResponseSchema } }, description: "OK" }, ...commonErrorResponses },
});

const labelsRoute = createRoute({
  method: "get",
  path: "/transaction-labels",
  tags: ["Expenses"],
  security: [{ session: [] }],
  responses: { 200: { content: { "application/json": { schema: LabelListResponseSchema } }, description: "OK" }, ...commonErrorResponses },
});

export function registerExpenseRoutes(app: ApiApp, deps: ApiDeps): void {
  app.openapi(listRoute, async (c) => {
    const principal = c.get("principal");
    const q = c.req.valid("query");
    try {
      const result = await withUserContext(deps.db, { userId: principal.userId }, (tx) =>
        listTransactions(expenseDeps(tx, c.get("requestId")))(principal, q),
      );
      return c.json(
        {
          items: result.items.map((i) => ({
            transaction: { ...i.transaction, occurredAt: i.transaction.occurredAt.toISOString(), bookedAt: i.transaction.bookedAt?.toISOString() ?? null, createdAt: i.transaction.createdAt.toISOString(), updatedAt: i.transaction.updatedAt.toISOString() },
            category: i.category ? { ...i.category, archivedAt: i.category.archivedAt?.toISOString() ?? null } : null,
            labelIds: i.labelIds,
          })),
          nextCursor: result.nextCursor,
        },
        200,
      );
    } catch (err) {
      throw toApiError(err);
    }
  });

  app.openapi(getRoute, async (c) => {
    const principal = c.get("principal");
    const { id } = c.req.valid("param");
    try {
      const detail = await withUserContext(deps.db, { userId: principal.userId }, (tx) => getTransaction(expenseDeps(tx, c.get("requestId")))(principal, id));
      return c.json(
        {
          transaction: { ...detail.transaction, occurredAt: detail.transaction.occurredAt.toISOString(), bookedAt: detail.transaction.bookedAt?.toISOString() ?? null, createdAt: detail.transaction.createdAt.toISOString(), updatedAt: detail.transaction.updatedAt.toISOString() },
          category: detail.category ? { ...detail.category, archivedAt: detail.category.archivedAt?.toISOString() ?? null } : null,
          labelIds: detail.labelIds,
        },
        200,
      );
    } catch (err) {
      throw toApiError(err);
    }
  });

  app.openapi(patchRoute, async (c) => {
    const principal = c.get("principal");
    const { id } = c.req.valid("param");
    const body = c.req.valid("json");
    const expectedVersion = parseExpectedVersion({ ifMatch: c.req.header("if-match") ?? null, body });
    try {
      const updated = await withUserContext(deps.db, { userId: principal.userId }, (tx) =>
        updateTransaction(expenseDeps(tx, c.get("requestId")))(principal, id, expectedVersion, body),
      );
      const detail = await withUserContext(deps.db, { userId: principal.userId }, (tx) => getTransaction(expenseDeps(tx, c.get("requestId")))(principal, id));
      return c.json(
        {
          transaction: { ...updated, occurredAt: updated.occurredAt.toISOString(), bookedAt: updated.bookedAt?.toISOString() ?? null, createdAt: updated.createdAt.toISOString(), updatedAt: updated.updatedAt.toISOString() },
          category: detail.category ? { ...detail.category, archivedAt: detail.category.archivedAt?.toISOString() ?? null } : null,
          labelIds: detail.labelIds,
        },
        200,
      );
    } catch (err) {
      throw toApiError(err);
    }
  });

  app.openapi(categoriesRoute, async (c) => {
    const principal = c.get("principal");
    const items = await withUserContext(deps.db, { userId: principal.userId }, (tx) => listCategories(expenseDeps(tx, c.get("requestId")))(principal));
    return c.json({ items: items.map((i) => ({ ...i, archivedAt: i.archivedAt?.toISOString() ?? null })) }, 200);
  });

  app.openapi(labelsRoute, async (c) => {
    const principal = c.get("principal");
    const items = await withUserContext(deps.db, { userId: principal.userId }, (tx) => listLabels(expenseDeps(tx, c.get("requestId")))(principal));
    return c.json({ items }, 200);
  });
}
```

- [ ] **Step 5: Register the routes**

In `src/platform/http/app.ts`:
```ts
import { registerExpenseRoutes } from "@/modules/expenses/api/routes";
// ...
export function registerAllRoutes(app: ApiApp, deps: ApiDeps): void {
  registerAccountRoutes(app, deps);
  registerIntegrationRoutes(app, deps);
  registerExpenseRoutes(app, deps);
}
```

- [ ] **Step 6: Run the tests**

Run: `npm run test:integration -- expenses/api/routes`
Expected: PASS.

- [ ] **Step 7: Regenerate the OpenAPI document and run the drift test**

Run: `npm run openapi:generate && npm test -- openapi-drift`
Expected: `docs/api/openapi.json written`; drift test PASS.

- [ ] **Step 8: Typecheck and commit**

Run: `npx tsc --noEmit`
Expected: no errors.

```bash
git add src/modules/expenses/api src/platform/http/app.ts docs/api/openapi.json
git commit -m "feat(expenses): add the REST API for transactions, categories and labels"
```

---

### Task 11: Expenses pages — list and detail, replacing the setup state

**Files:**
- Create: `src/modules/expenses/ui/run.ts`
- Create: `src/modules/expenses/ui/deps.ts`
- Create: `src/modules/expenses/ui/load-transactions.ts`
- Create: `src/modules/expenses/ui/TransactionsTable.tsx`
- Create: `src/modules/expenses/ui/TransactionEditForm.tsx`
- Create: `src/app/actions/expenses.ts`
- Modify: `src/app/(app)/finance/expenses/page.tsx`
- Create: `src/app/(app)/finance/expenses/loading.tsx`
- Create: `src/app/(app)/finance/expenses/[transactionId]/page.tsx`
- Create: `src/app/(app)/finance/expenses/[transactionId]/loading.tsx`

**Interfaces:**
- Consumes: `listTransactions`, `getTransaction`, `updateTransaction` from `../application/*` (Task 9); `expenseDeps` from `../infrastructure/deps` (Task 5); `resolveCapabilities`, `realProbes` from `@/platform/capabilities/*` (existing, unchanged this task); `requirePrincipalOrRedirect` from `@/platform/auth/require-principal` (existing); `withUserContext` from `@/platform/db/context`.
- Produces:
```ts
export function runForPrincipal<T>(fn: (deps: UseCaseDeps, principal: Principal) => Promise<T>): Promise<T>;
export interface TransactionRow { id: string; occurredAt: string; amount: string; currency: string; type: string; state: string; payee: string | null; note: string | null; categoryId: string | null; categoryName: string | null; labelIds: string[]; version: number; }
export function loadTransactionsPage(opts: ListTransactionsOptions): Promise<{ rows: TransactionRow[]; nextCursor: string | null }>;
export function loadTransactionDetail(id: string): Promise<{ row: TransactionRow; categories: { id: string; name: string }[]; labels: { id: string; name: string }[] } | null>;
```
`TransactionRow` carries both `categoryId` (the raw foreign key, needed by `TransactionEditForm`'s `<select>` default value) and `categoryName` (the display label) — the same pair Step 4's implementation and both loader functions below actually return.
The Expenses page keeps its existing "Connect Budget Makers Wallet" empty state when `Capabilities.features.expenses` is `false` — this task adds the `false`/`true` branch around the existing markup; it does not replace the empty-state copy.

- [ ] **Step 1: Write the failing test — the page renders the setup state when disconnected, and the table when connected**

There is no dedicated Vitest unit test for a Next.js Server Component page in this codebase (`AccountsTable.tsx` and friends are tested indirectly, and page-level behavior is covered by Playwright, per `docs/superpowers/handoff/2026-09-04-phase-2-checkpoint.md`). This task's directly-testable unit is the loader; write that test first:

```ts
// src/modules/expenses/ui/load-transactions.test.ts
import { describe, expect, it } from "vitest";
import { MemoryCategoriesRepository, MemoryLabelsRepository, MemoryRecurringPatternsRepository, MemoryTransactionsRepository } from "../infrastructure/memory-repositories";
import { testPrincipal } from "@/test/principal";
import { setExpenseDepsFactoryForTests, setPrincipalForTests } from "./run";
import { loadTransactionsPage } from "./load-transactions";

describe("loadTransactionsPage", () => {
  it("flattens dates to ISO strings and carries the category name", async () => {
    const deps = {
      transactions: new MemoryTransactionsRepository(),
      categories: new MemoryCategoriesRepository(),
      labels: new MemoryLabelsRepository(),
      recurring: new MemoryRecurringPatternsRepository(),
      clock: { now: () => new Date("2026-09-05T00:00:00Z") },
      audit: async () => {},
    };
    const category = await deps.categories.create({ userId: "00000000-0000-7000-8000-000000000001", name: "Groceries", groupName: null, kind: "expense", color: null, parentId: null, source: "manual", archivedAt: null });
    await deps.transactions.create({ userId: "00000000-0000-7000-8000-000000000001", accountId: "acc-1", occurredAt: new Date("2026-09-01T08:00:00Z"), bookedAt: null, amount: "-10.00", currency: "EUR", type: "expense", state: "cleared", categoryId: category.id, payee: "Shop", note: null, transferGroupId: null, source: "manual", syncRunId: null });

    setExpenseDepsFactoryForTests(() => deps);
    setPrincipalForTests(testPrincipal());
    const page = await loadTransactionsPage({});
    expect(page.rows).toHaveLength(1);
    expect(page.rows[0]).toMatchObject({ amount: "-10.00", categoryName: "Groceries" });
    expect(typeof page.rows[0]!.occurredAt).toBe("string");
    setExpenseDepsFactoryForTests(null);
    setPrincipalForTests(null);
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `npm test -- load-transactions`
Expected: FAIL — `Cannot find module './run'`.

- [ ] **Step 3: Write `run.ts` and `deps.ts`**

```ts
// src/modules/expenses/ui/run.ts
import { db } from "@/lib/db";
import { withUserContext } from "@/platform/db/context";
import type { Principal } from "@/platform/auth/principal";
import { expenseDeps } from "../infrastructure/deps";
import type { UseCaseDeps } from "../application/ports";

let depsFactoryForTests: (() => UseCaseDeps) | null = null;
let principalForTests: Principal | null = null;

export function setExpenseDepsFactoryForTests(factory: (() => UseCaseDeps) | null): void {
  depsFactoryForTests = factory;
}

export function setPrincipalForTests(principal: Principal | null): void {
  principalForTests = principal;
}

export async function runForPrincipal<T>(fn: (deps: UseCaseDeps, principal: Principal) => Promise<T>): Promise<T> {
  if (process.env.NODE_ENV === "test" && depsFactoryForTests && principalForTests) {
    return fn(depsFactoryForTests(), principalForTests);
  }
  const { requirePrincipal } = await import("@/platform/auth/require-principal");
  const principal = await requirePrincipal();
  return withUserContext(db, { userId: principal.userId }, (tx) => fn(expenseDeps(tx), principal));
}
```

```ts
// src/modules/expenses/ui/deps.ts
export { expenseDeps } from "../infrastructure/deps";
export { runForPrincipal, setExpenseDepsFactoryForTests, setPrincipalForTests } from "./run";
```

- [ ] **Step 4: Write `load-transactions.ts`**

```ts
// src/modules/expenses/ui/load-transactions.ts
import { getTransaction } from "../application/get-transaction";
import { listCategories } from "../application/list-categories";
import { listLabels } from "../application/list-labels";
import { listTransactions } from "../application/list-transactions";
import type { ListTransactionsOptions } from "../application/ports";
import { runForPrincipal } from "./run";

export interface TransactionRow {
  id: string;
  occurredAt: string;
  amount: string;
  currency: string;
  type: string;
  state: string;
  payee: string | null;
  note: string | null;
  categoryId: string | null;
  categoryName: string | null;
  labelIds: string[];
  version: number;
}

export async function loadTransactionsPage(
  opts: ListTransactionsOptions,
): Promise<{ rows: TransactionRow[]; nextCursor: string | null }> {
  return runForPrincipal(async (deps, principal) => {
    const result = await listTransactions(deps)(principal, opts);
    const rows = result.items.map((i) => ({
      id: i.transaction.id,
      occurredAt: i.transaction.occurredAt.toISOString(),
      amount: i.transaction.amount,
      currency: i.transaction.currency,
      type: i.transaction.type,
      state: i.transaction.state,
      payee: i.transaction.payee,
      note: i.transaction.note,
      categoryId: i.category?.id ?? null,
      categoryName: i.category?.name ?? null,
      labelIds: i.labelIds,
      version: i.transaction.version,
    }));
    return { rows, nextCursor: result.nextCursor };
  });
}

export async function loadTransactionDetail(id: string): Promise<{
  row: TransactionRow;
  categories: { id: string; name: string }[];
  labels: { id: string; name: string }[];
} | null> {
  return runForPrincipal(async (deps, principal) => {
    const detail = await getTransaction(deps)(principal, id).catch(() => null);
    if (!detail) return null;
    const [categories, labels] = await Promise.all([listCategories(deps)(principal), listLabels(deps)(principal)]);
    return {
      row: {
        id: detail.transaction.id,
        occurredAt: detail.transaction.occurredAt.toISOString(),
        amount: detail.transaction.amount,
        currency: detail.transaction.currency,
        type: detail.transaction.type,
        state: detail.transaction.state,
        payee: detail.transaction.payee,
        note: detail.transaction.note,
        categoryId: detail.category?.id ?? null,
        categoryName: detail.category?.name ?? null,
        labelIds: detail.labelIds,
        version: detail.transaction.version,
      },
      categories: categories.map((c) => ({ id: c.id, name: c.name })),
      labels: labels.map((l) => ({ id: l.id, name: l.name })),
    };
  });
}
```

- [ ] **Step 5: Run the test**

Run: `npm test -- load-transactions`
Expected: PASS.

- [ ] **Step 6: Write the table and edit-form client components**

```tsx
// src/modules/expenses/ui/TransactionsTable.tsx
"use client";

import Link from "next/link";
import { MoneyValue } from "@/components/ui/MoneyValue";
import type { TransactionRow } from "./load-transactions";

export interface TransactionsTableProps {
  rows: readonly TransactionRow[];
}

export function TransactionsTable({ rows }: TransactionsTableProps) {
  if (rows.length === 0) {
    return <p className="py-8 text-center text-body-sm text-muted">No transactions yet — the next sync will fill this in.</p>;
  }
  return (
    <table className="w-full text-body-sm">
      <thead>
        <tr className="text-left text-muted">
          <th className="py-2">Date</th>
          <th>Payee</th>
          <th>Category</th>
          <th className="text-right">Amount</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((r) => (
          <tr key={r.id} className="border-t border-border">
            <td className="py-2">{new Date(r.occurredAt).toLocaleDateString()}</td>
            <td>
              <Link href={`/finance/expenses/${r.id}`} className="hover:underline">
                {r.payee ?? "—"}
              </Link>
            </td>
            <td>{r.categoryName ?? "Uncategorized"}</td>
            <td className="text-right">
              <MoneyValue amount={r.amount} currency={r.currency} />
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
```

```tsx
// src/modules/expenses/ui/TransactionEditForm.tsx
"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { updateTransactionAction } from "@/app/actions/expenses";
import type { TransactionRow } from "./load-transactions";

export interface TransactionEditFormProps {
  row: TransactionRow;
  categories: readonly { id: string; name: string }[];
}

export function TransactionEditForm({ row, categories }: TransactionEditFormProps) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  return (
    <form
      action={(formData) => {
        formData.set("id", row.id);
        formData.set("version", String(row.version));
        startTransition(async () => {
          const result = await updateTransactionAction(formData);
          if (!result.ok) {
            setError(result.error);
            return;
          }
          setError(null);
          router.refresh();
        });
      }}
      className="flex flex-col gap-4"
    >
      <label className="flex flex-col gap-1">
        <span className="text-body-sm text-muted">Category</span>
        <select name="categoryId" defaultValue={row.categoryId ?? ""} className="rounded-md border border-border px-3 py-2">
          <option value="">Uncategorized</option>
          {categories.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </select>
      </label>
      <label className="flex flex-col gap-1">
        <span className="text-body-sm text-muted">Note</span>
        <input name="note" defaultValue={row.note ?? ""} className="rounded-md border border-border px-3 py-2" />
      </label>
      {error ? <p className="text-body-sm text-danger">{error}</p> : null}
      <button type="submit" disabled={pending} className="inline-flex min-h-11 items-center justify-center rounded-md bg-accent px-4 text-body-sm font-medium text-accent-contrast">
        Save
      </button>
    </form>
  );
}
```

- [ ] **Step 7: Write the server action**

```ts
// src/app/actions/expenses.ts
"use server";

import { revalidatePath } from "next/cache";
import { updateTransaction, type UpdateTransactionInput } from "@/modules/expenses/application/update-transaction";
import { NotFoundError, VersionMismatchError } from "@/modules/expenses/application/errors";
import { runForPrincipal } from "@/modules/expenses/ui/deps";
import { PermissionDeniedError } from "@/platform/auth/principal";
import { errorMessage, fail, succeed, text, type ActionResult } from "./types";
import type { Transaction } from "@/modules/expenses/domain/transaction";

function mapError(err: unknown): string {
  if (err instanceof PermissionDeniedError) return "You do not have permission to change transactions.";
  if (err instanceof VersionMismatchError) return "This transaction changed in the meantime. Reload and try again.";
  if (err instanceof NotFoundError) return "This transaction no longer exists.";
  return errorMessage(err);
}

export async function updateTransactionAction(formData: FormData): Promise<ActionResult<Transaction>> {
  const id = text(formData.get("id")) ?? "";
  const version = Number(text(formData.get("version")) ?? "0");
  const patch: UpdateTransactionInput = {
    categoryId: formData.has("categoryId") ? text(formData.get("categoryId")) : undefined,
    note: formData.has("note") ? text(formData.get("note")) : undefined,
  };
  try {
    const updated = await runForPrincipal((deps, principal) => updateTransaction(deps)(principal, id, version, patch));
    revalidatePath("/finance/expenses");
    revalidatePath(`/finance/expenses/${id}`);
    return succeed(updated);
  } catch (err) {
    return fail(mapError(err));
  }
}
```

- [ ] **Step 8: Wire the pages**

```tsx
// src/app/(app)/finance/expenses/page.tsx
import Link from "next/link";
import { PageHeader } from "@/components/layout/PageHeader";
import { EmptyState } from "@/components/ui/EmptyState";
import { requirePrincipalOrRedirect } from "@/platform/auth/require-principal";
import { realProbes } from "@/platform/capabilities/probes";
import { resolveCapabilities } from "@/platform/capabilities/resolve";
import { loadTransactionsPage } from "@/modules/expenses/ui/load-transactions";
import { TransactionsTable } from "@/modules/expenses/ui/TransactionsTable";

export const dynamic = "force-dynamic";
export const metadata = { title: "Expenses" };

export default async function ExpensesPage() {
  const principal = await requirePrincipalOrRedirect();
  const caps = await resolveCapabilities(principal, realProbes);

  if (!caps.features.expenses) {
    return (
      <>
        <PageHeader title="Expenses" />
        <div className="max-w-xl pt-6">
          <EmptyState
            title="Connect Budget Makers Wallet"
            description="Expenses are read from your Wallet transactions. Connect the integration and the first sync will fill this page."
            action={
              <Link
                href="/settings/integrations/wallet"
                className="inline-flex min-h-11 items-center rounded-md bg-accent px-4 text-body-sm font-medium text-accent-contrast transition-colors hover:bg-accent-hover"
              >
                Go to Integrations
              </Link>
            }
          />
        </div>
      </>
    );
  }

  const page = await loadTransactionsPage({ limit: 50 });
  return (
    <>
      <PageHeader title="Expenses" />
      <div className="pt-6">
        <TransactionsTable rows={page.rows} />
      </div>
    </>
  );
}
```

```tsx
// src/app/(app)/finance/expenses/loading.tsx
export default function Loading() {
  return <div className="animate-pulse pt-6 text-body-sm text-muted">Loading expenses…</div>;
}
```

```tsx
// src/app/(app)/finance/expenses/[transactionId]/page.tsx
import { notFound } from "next/navigation";
import { PageHeader } from "@/components/layout/PageHeader";
import { requirePrincipalOrRedirect } from "@/platform/auth/require-principal";
import { loadTransactionDetail } from "@/modules/expenses/ui/load-transactions";
import { TransactionEditForm } from "@/modules/expenses/ui/TransactionEditForm";

export const dynamic = "force-dynamic";

export default async function TransactionDetailPage({ params }: { params: Promise<{ transactionId: string }> }) {
  await requirePrincipalOrRedirect();
  const { transactionId } = await params;
  const detail = await loadTransactionDetail(transactionId);
  if (!detail) notFound();

  return (
    <>
      <PageHeader title={detail.row.payee ?? "Transaction"} />
      <div className="max-w-md pt-6">
        <TransactionEditForm row={detail.row} categories={detail.categories} />
      </div>
    </>
  );
}
```

```tsx
// src/app/(app)/finance/expenses/[transactionId]/loading.tsx
export default function Loading() {
  return <div className="animate-pulse pt-6 text-body-sm text-muted">Loading…</div>;
}
```

- [ ] **Step 9: Build and typecheck**

Run: `npx tsc --noEmit && npm run build`
Expected: no errors; the route table lists `/finance/expenses` and `/finance/expenses/[transactionId]`.

- [ ] **Step 10: Commit**

```bash
git add src/modules/expenses/ui src/app/actions/expenses.ts src/app/\(app\)/finance/expenses
git commit -m "feat(expenses): add list and detail pages, replacing the setup state"
```

---

### Task 12: Recurring-pattern persistence wired into the transactions sync

**Files:**
- Create: `src/modules/expenses/application/detect-recurring-patterns.ts`
- Create: `src/modules/expenses/application/detect-recurring-patterns.test.ts`
- Create: `src/modules/expenses/application/list-recurring-patterns.ts`
- Modify: `src/modules/integrations/infrastructure/wallet-provider-adapter.ts` (transactionsSync.apply calls `detectRecurringPatterns` after `syncProviderTransactions`)
- Modify: `src/modules/integrations/infrastructure/wallet-provider-adapter.test.ts`
- Modify: `src/modules/expenses/api/schemas.ts` (add `RecurringPatternSchema` + list response)
- Modify: `src/modules/expenses/api/routes.ts` (add `GET /transactions/recurring-patterns`)
- Modify: `src/modules/expenses/api/routes.itest.ts`
- Modify: `src/modules/expenses/ui/load-transactions.ts` (add `loadRecurringPatterns`)
- Modify: `src/app/(app)/finance/expenses/page.tsx` (render the detected patterns beneath the table)
- Regenerate: `docs/api/openapi.json`

**Interfaces:**
- Consumes: `detectRecurring`, `DetectedPattern` from `../domain/recurring` (Task 3); `UseCaseDeps`, `RecurringPatternRecord` from `./ports` (Task 4); `assertPermission` from `@/platform/auth/principal`; `runForPrincipal` from `../ui/run` (Task 11).
- Produces:
```ts
export function detectRecurringPatterns(deps: UseCaseDeps): (userId: string) => Promise<DetectedPattern[]>;
export function listRecurringPatterns(deps: UseCaseDeps): (principal: Principal) => Promise<RecurringPatternRecord[]>;
export function loadRecurringPatterns(): Promise<RecurringPatternRow[]>;
```
- Modifies `transactionsSync.apply` (Task 8) to add one call site: `await detectRecurringPatterns(expenses)(ctx.connection.userId);` right after `syncProviderTransactions(...)`, and folds its count into the returned stats as `patternsDetected`.

- [ ] **Step 1: Write the failing test**

```ts
// src/modules/expenses/application/detect-recurring-patterns.test.ts
import { describe, expect, it } from "vitest";
import { MemoryCategoriesRepository, MemoryLabelsRepository, MemoryRecurringPatternsRepository, MemoryTransactionsRepository } from "../infrastructure/memory-repositories";
import { testPrincipal } from "@/test/principal";
import { detectRecurringPatterns } from "./detect-recurring-patterns";
import { listRecurringPatterns } from "./list-recurring-patterns";

function harness() {
  return {
    transactions: new MemoryTransactionsRepository(),
    categories: new MemoryCategoriesRepository(),
    labels: new MemoryLabelsRepository(),
    recurring: new MemoryRecurringPatternsRepository(),
    clock: { now: () => new Date("2026-09-05T00:00:00Z") },
    audit: async () => {},
  };
}

describe("detectRecurringPatterns", () => {
  it("persists what the domain detector finds, replacing the previous set", async () => {
    const deps = harness();
    for (const month of [4, 5, 6, 7]) {
      await deps.transactions.create({
        userId: "u1", accountId: "acc-1", occurredAt: new Date(Date.UTC(2026, month, 1)), bookedAt: null,
        amount: "-15.99", currency: "EUR", type: "expense", state: "cleared", categoryId: null,
        payee: "Netflix", note: null, transferGroupId: null, source: "provider", syncRunId: null,
      });
    }
    const patterns = await detectRecurringPatterns(deps)("u1");
    expect(patterns).toHaveLength(1);
    const stored = await listRecurringPatterns(deps)(testPrincipal({ userId: "u1" }));
    expect(stored).toHaveLength(1);
    expect(stored[0]!.payee).toBe("Netflix");

    // A second run with no transactions clears the previous set rather than appending.
    await deps.transactions.create({ userId: "u1", accountId: "acc-1", occurredAt: new Date(), bookedAt: null, amount: "-1.00", currency: "EUR", type: "expense", state: "cleared", categoryId: null, payee: null, note: null, transferGroupId: null, source: "manual", syncRunId: null });
    // (re-detecting over just the unrelated one-off transaction finds nothing)
    const secondDeps = { ...deps, transactions: new MemoryTransactionsRepository() };
    await secondDeps.recurring.replaceAll("u1", []);
    await detectRecurringPatterns(secondDeps)("u1");
    expect(await listRecurringPatterns(secondDeps)(testPrincipal({ userId: "u1" }))).toHaveLength(0);
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `npm test -- detect-recurring-patterns`
Expected: FAIL — `Cannot find module './detect-recurring-patterns'`.

- [ ] **Step 3: Implement both use cases**

```ts
// src/modules/expenses/application/detect-recurring-patterns.ts
import { detectRecurring, type DetectedPattern } from "../domain/recurring";
import type { UseCaseDeps } from "./ports";

export function detectRecurringPatterns(deps: UseCaseDeps) {
  return async (userId: string): Promise<DetectedPattern[]> => {
    const all = await deps.transactions.listAll(userId);
    const candidates = all
      .filter((t) => t.type !== "transfer" && t.payee)
      .map((t) => ({ payee: t.payee!, amount: t.amount, currency: t.currency, occurredAt: t.occurredAt }));
    const patterns = detectRecurring(candidates);
    await deps.recurring.replaceAll(userId, patterns);
    return patterns;
  };
}
```

```ts
// src/modules/expenses/application/list-recurring-patterns.ts
import type { Principal } from "@/platform/auth/principal";
import { assertPermission } from "@/platform/auth/principal";
import type { RecurringPatternRecord, UseCaseDeps } from "./ports";

export function listRecurringPatterns(deps: UseCaseDeps) {
  return async (principal: Principal): Promise<RecurringPatternRecord[]> => {
    assertPermission(principal, "expenses.read");
    return deps.recurring.list(principal.userId);
  };
}
```

- [ ] **Step 4: Run the tests**

Run: `npm test -- detect-recurring-patterns`
Expected: PASS.

- [ ] **Step 5: Wire detection into the transactions sync**

In `src/modules/integrations/infrastructure/wallet-provider-adapter.ts`, add the import `import { detectRecurringPatterns } from "@/modules/expenses/application/detect-recurring-patterns";` and change `transactionsSync.apply` (Task 8) from:
```ts
const result = await syncProviderTransactions({ ...expenses, links, source })(ctx.connection.userId, null);
ctx.setCursor({ sinceDate: payload.nextSinceDate });
return { ...result };
```
to:
```ts
const result = await syncProviderTransactions({ ...expenses, links, source })(ctx.connection.userId, null);
const patterns = await detectRecurringPatterns(expenses)(ctx.connection.userId);
ctx.setCursor({ sinceDate: payload.nextSinceDate });
return { ...result, patternsDetected: patterns.length };
```

Extend the transactions-sync test from Task 8 in `wallet-provider-adapter.test.ts` to assert `stats.patternsDetected` is a number (the fixture's single record is not itself recurring, so `0` is the correct value — asserting `typeof stats.patternsDetected === "number"` keeps the test from silently passing if the field disappears):
```ts
expect(typeof stats.patternsDetected).toBe("number");
```

- [ ] **Step 6: Run the integrations suite**

Run: `npm test -- wallet-provider-adapter`
Expected: PASS.

- [ ] **Step 7: Add the read-only API endpoint**

In `src/modules/expenses/api/schemas.ts`, add:
```ts
export const RecurringPatternSchema = z
  .object({
    id: z.string().uuid(),
    payee: z.string(),
    cadence: z.enum(["weekly", "biweekly", "monthly", "quarterly", "annual"]),
    amountLow: z.string(),
    amountHigh: z.string(),
    currency: z.string(),
    lastSeenAt: z.string(),
    nextExpectedAt: z.string().nullable(),
    occurrenceCount: z.number(),
  })
  .openapi("RecurringPattern");
export const RecurringPatternListResponseSchema = z.object({ items: z.array(RecurringPatternSchema) }).openapi("RecurringPatternListResponse");
```

In `src/modules/expenses/api/routes.ts`, add the import `import { listRecurringPatterns } from "../application/list-recurring-patterns";`, add `RecurringPatternListResponseSchema` to the schema import list, add a route:
```ts
const recurringRoute = createRoute({
  method: "get",
  path: "/transactions/recurring-patterns",
  tags: ["Expenses"],
  security: [{ session: [] }],
  responses: { 200: { content: { "application/json": { schema: RecurringPatternListResponseSchema } }, description: "OK" }, ...commonErrorResponses },
});
```
and register it inside `registerExpenseRoutes`:
```ts
app.openapi(recurringRoute, async (c) => {
  const principal = c.get("principal");
  const items = await withUserContext(deps.db, { userId: principal.userId }, (tx) => listRecurringPatterns(expenseDeps(tx, c.get("requestId")))(principal));
  return c.json(
    { items: items.map((p) => ({ ...p, lastSeenAt: p.lastSeenAt.toISOString(), nextExpectedAt: p.nextExpectedAt?.toISOString() ?? null })) },
    200,
  );
});
```

Add one integration test to `routes.itest.ts`:
```ts
it("lists recurring patterns for the caller", async () => {
  const { userId, organizationId } = await seedUser();
  const { withUserContext } = await import("@/platform/db/context");
  const { DrizzleRecurringRepository } = await import("@/modules/expenses/infrastructure/drizzle-recurring-repository");
  await withUserContext(db, { userId }, (tx) =>
    new DrizzleRecurringRepository(tx).replaceAll(userId, [
      { payee: "Netflix", cadence: "monthly", amountLow: "-15.99", amountHigh: "-15.99", currency: "EUR", lastSeenAt: new Date(), nextExpectedAt: new Date(), occurrenceCount: 4 },
    ]),
  );
  const app = appFor(userId, organizationId);
  const res = await app.request("/api/v1/transactions/recurring-patterns", { headers: { "x-requested-with": "test" } });
  expect(res.status).toBe(200);
  const body = (await res.json()) as { items: { payee: string }[] };
  expect(body.items.map((i) => i.payee)).toEqual(["Netflix"]);
});
```

- [ ] **Step 8: Run the integration tests, regenerate OpenAPI**

Run: `npm run test:integration -- expenses/api/routes && npm run openapi:generate && npm test -- openapi-drift`
Expected: PASS.

- [ ] **Step 9: Surface it on the Expenses page**

In `src/modules/expenses/ui/load-transactions.ts`, add the import `import { listRecurringPatterns } from "../application/list-recurring-patterns";` and a new loader, following the same `runForPrincipal` shape as `loadTransactionsPage`/`loadTransactionDetail`:

```ts
export interface RecurringPatternRow {
  id: string;
  payee: string;
  cadence: string;
  amountLow: string;
  amountHigh: string;
  currency: string;
  lastSeenAt: string;
  nextExpectedAt: string | null;
  occurrenceCount: number;
}

export async function loadRecurringPatterns(): Promise<RecurringPatternRow[]> {
  return runForPrincipal(async (deps, principal) => {
    const patterns = await listRecurringPatterns(deps)(principal);
    return patterns.map((p) => ({
      id: p.id,
      payee: p.payee,
      cadence: p.cadence,
      amountLow: p.amountLow,
      amountHigh: p.amountHigh,
      currency: p.currency,
      lastSeenAt: p.lastSeenAt.toISOString(),
      nextExpectedAt: p.nextExpectedAt?.toISOString() ?? null,
      occurrenceCount: p.occurrenceCount,
    }));
  });
}
```

In `src/app/(app)/finance/expenses/page.tsx`, fetch it alongside `page` with `Promise.all` and render it below the table:

```tsx
import Link from "next/link";
import { PageHeader } from "@/components/layout/PageHeader";
import { EmptyState } from "@/components/ui/EmptyState";
import { requirePrincipalOrRedirect } from "@/platform/auth/require-principal";
import { realProbes } from "@/platform/capabilities/probes";
import { resolveCapabilities } from "@/platform/capabilities/resolve";
import { loadRecurringPatterns, loadTransactionsPage } from "@/modules/expenses/ui/load-transactions";
import { TransactionsTable } from "@/modules/expenses/ui/TransactionsTable";

export const dynamic = "force-dynamic";
export const metadata = { title: "Expenses" };

export default async function ExpensesPage() {
  const principal = await requirePrincipalOrRedirect();
  const caps = await resolveCapabilities(principal, realProbes);

  if (!caps.features.expenses) {
    return (
      <>
        <PageHeader title="Expenses" />
        <div className="max-w-xl pt-6">
          <EmptyState
            title="Connect Budget Makers Wallet"
            description="Expenses are read from your Wallet transactions. Connect the integration and the first sync will fill this page."
            action={
              <Link
                href="/settings/integrations/wallet"
                className="inline-flex min-h-11 items-center rounded-md bg-accent px-4 text-body-sm font-medium text-accent-contrast transition-colors hover:bg-accent-hover"
              >
                Go to Integrations
              </Link>
            }
          />
        </div>
      </>
    );
  }

  const [page, patterns] = await Promise.all([loadTransactionsPage({ limit: 50 }), loadRecurringPatterns()]);
  return (
    <>
      <PageHeader title="Expenses" />
      <div className="pt-6">
        <TransactionsTable rows={page.rows} />
        {patterns.length > 0 ? (
          <div className="pt-8">
            <h2 className="text-body-sm font-medium text-muted">Recurring</h2>
            <ul className="mt-2 flex flex-col gap-1 text-body-sm">
              {patterns.map((p) => (
                <li key={p.id}>
                  {p.payee} — {p.cadence}, {p.amountLow === p.amountHigh ? p.amountLow : `${p.amountLow}–${p.amountHigh}`} {p.currency}
                </li>
              ))}
            </ul>
          </div>
        ) : null}
      </div>
    </>
  );
}
```

- [ ] **Step 10: Build and typecheck**

Run: `npx tsc --noEmit && npm run build`
Expected: no errors.

- [ ] **Step 11: Commit**

```bash
git add src/modules/expenses/application/detect-recurring-patterns.ts src/modules/expenses/application/detect-recurring-patterns.test.ts src/modules/expenses/application/list-recurring-patterns.ts src/modules/integrations/infrastructure/wallet-provider-adapter.ts src/modules/integrations/infrastructure/wallet-provider-adapter.test.ts src/modules/expenses/api src/modules/expenses/ui/load-transactions.ts src/app/\(app\)/finance/expenses/page.tsx docs/api/openapi.json
git commit -m "feat(expenses): persist recurring-pattern detection and surface it on the Expenses page"
```

---

### Task 13: Migration 0012 — interest rules, accruals and entries

**Files:**
- Create: `src/lib/db/schema/interests.ts`
- Modify: `src/lib/db/schema/index.ts`
- Create: `drizzle/0012_interests.sql` (generated, then hand-edited)
- Create: `src/lib/db/interests-rls.itest.ts`

**Interfaces:**
- Consumes: `users` from `./identity`, `accounts` from `./accounts` (existing).
- Produces:
```ts
export const interestRules: PgTable;     // id, userId, accountId, annualRate, taxRate, dayCount, compounding, effectiveFrom, effectiveTo, postingMode, providerCategoryRef, noteMarker, version, createdAt, updatedAt
export const interestAccruals: PgTable;  // id, ruleId, accrualDate, balanceBasis, gross, tax, net, carryAfter, source, postedAt, entryId, createdAt
export const interestEntries: PgTable;   // id, userId, accountId, occurredAt, gross, net, kind, transactionId, ruleId, source, createdAt
export type InterestRuleRow = typeof interestRules.$inferSelect;
export type InterestAccrualRow = typeof interestAccruals.$inferSelect;
export type InterestEntryRow = typeof interestEntries.$inferSelect;
```

- [ ] **Step 1: Write the failing RLS test**

```ts
// src/lib/db/interests-rls.itest.ts
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { closeDb, resetDb, testDb } from "@/test/db";
import { accounts, interestEntries, interestRules, organizations, users } from "@/lib/db/schema";
import { withSystemContext, withUserContext } from "@/platform/db/context";

describe("interests RLS", () => {
  beforeEach(resetDb);
  afterAll(closeDb);

  it("a user sees only their own rules and entries; system sees all; no context sees none", async () => {
    const db = await testDb();
    const [org] = await db.insert(organizations).values({ name: "P" }).returning();
    const [a] = await db.insert(users).values({ organizationId: org!.id, displayName: "A" }).returning();
    const [b] = await db.insert(users).values({ organizationId: org!.id, displayName: "B" }).returning();
    const [accA] = await withSystemContext(db, (tx) => tx.insert(accounts).values({ userId: a!.id, name: "A", type: "savings", origin: "manual" }).returning());
    const [accB] = await withSystemContext(db, (tx) => tx.insert(accounts).values({ userId: b!.id, name: "B", type: "savings", origin: "manual" }).returning());

    await withSystemContext(db, (tx) =>
      tx.insert(interestRules).values([
        { userId: a!.id, accountId: accA!.id, annualRate: "0.0225", taxRate: "0.26", effectiveFrom: "2026-01-01" },
        { userId: b!.id, accountId: accB!.id, annualRate: "0.01", taxRate: "0.26", effectiveFrom: "2026-01-01" },
      ]),
    );
    const mine = await withUserContext(db, { userId: a!.id }, (tx) => tx.select().from(interestRules));
    expect(mine).toHaveLength(1);
    expect((await withSystemContext(db, (tx) => tx.select().from(interestRules))).length).toBe(2);
    expect(await db.select().from(interestRules)).toEqual([]);

    await withSystemContext(db, (tx) =>
      tx.insert(interestEntries).values({ userId: a!.id, accountId: accA!.id, occurredAt: new Date(), gross: "1.00", net: "0.74", kind: "projected" }),
    );
    expect((await withUserContext(db, { userId: a!.id }, (tx) => tx.select().from(interestEntries))).length).toBe(1);
    expect((await withUserContext(db, { userId: b!.id }, (tx) => tx.select().from(interestEntries))).length).toBe(0);
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `npm run test:db:up && npm run test:integration -- interests-rls`
Expected: FAIL — `relation "interest_rules" does not exist`.

- [ ] **Step 3: Write the Drizzle schema**

```ts
// src/lib/db/schema/interests.ts
import { check, date, index, integer, numeric, pgTable, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { users } from "./identity";
import { accounts } from "./accounts";

const tz = (n: string) => timestamp(n, { withTimezone: true, mode: "date" });
const id = () => uuid("id").primaryKey().default(sql`uuidv7()`);
const money = (n: string) => numeric(n, { precision: 16, scale: 2 });

export const interestRules = pgTable(
  "interest_rules",
  {
    id: id(),
    userId: uuid("user_id").notNull().references(() => users.id),
    accountId: uuid("account_id").notNull().references(() => accounts.id, { onDelete: "cascade" }),
    // 6-decimal precision: a rate like 0.022500 needs more than the 2-decimal
    // money() columns give, and the carry in interest_accruals needs it too.
    annualRate: numeric("annual_rate", { precision: 10, scale: 6 }).notNull(),
    taxRate: numeric("tax_rate", { precision: 10, scale: 6 }).notNull().default("0"),
    dayCount: text("day_count").notNull().default("365"),
    compounding: text("compounding").notNull().default("simple_daily"),
    effectiveFrom: date("effective_from").notNull(),
    effectiveTo: date("effective_to"),
    postingMode: text("posting_mode").notNull().default("analyze_only"),
    providerCategoryRef: text("provider_category_ref"),
    noteMarker: text("note_marker").notNull().default("auto-interest"),
    version: integer("version").notNull().default(1),
    createdAt: tz("created_at").notNull().defaultNow(),
    updatedAt: tz("updated_at").notNull().defaultNow(),
  },
  (t) => [
    check("interest_rules_day_count_ck", sql`${t.dayCount} IN ('365','360','actual')`),
    check("interest_rules_compounding_ck", sql`${t.compounding} IN ('simple_daily','monthly','none')`),
    check("interest_rules_posting_mode_ck", sql`${t.postingMode} IN ('analyze_only','post_to_provider')`),
    index("interest_rules_user_idx").on(t.userId),
  ],
);

export const interestAccruals = pgTable(
  "interest_accruals",
  {
    id: id(),
    ruleId: uuid("rule_id").notNull().references(() => interestRules.id, { onDelete: "cascade" }),
    accrualDate: date("accrual_date").notNull(),
    balanceBasis: money("balance_basis").notNull(),
    gross: numeric("gross", { precision: 16, scale: 6 }).notNull(),
    tax: numeric("tax", { precision: 16, scale: 6 }).notNull(),
    net: money("net").notNull(),
    carryAfter: numeric("carry_after", { precision: 16, scale: 6 }).notNull(),
    source: text("source").notNull().default("computed"),
    postedAt: tz("posted_at"),
    entryId: uuid("entry_id"),
    createdAt: tz("created_at").notNull().defaultNow(),
  },
  (t) => [
    check("interest_accruals_source_ck", sql`${t.source} IN ('computed')`),
    uniqueIndex("interest_accruals_rule_date_uq").on(t.ruleId, t.accrualDate),
  ],
);

export const interestEntries = pgTable(
  "interest_entries",
  {
    id: id(),
    userId: uuid("user_id").notNull().references(() => users.id),
    accountId: uuid("account_id").notNull().references(() => accounts.id, { onDelete: "cascade" }),
    occurredAt: tz("occurred_at").notNull(),
    gross: money("gross").notNull(),
    net: money("net").notNull(),
    kind: text("kind").notNull(),
    // No FK: a transaction may not exist locally yet (a projected entry has
    // none at all), matching transactions.sync_run_id's existing precedent.
    transactionId: uuid("transaction_id"),
    ruleId: uuid("rule_id"),
    source: text("source").notNull().default("computed"),
    createdAt: tz("created_at").notNull().defaultNow(),
  },
  (t) => [
    check("interest_entries_kind_ck", sql`${t.kind} IN ('paid','projected','adjustment')`),
    index("interest_entries_user_occurred_idx").on(t.userId, t.occurredAt.desc()),
  ],
);

export type InterestRuleRow = typeof interestRules.$inferSelect;
export type InterestAccrualRow = typeof interestAccruals.$inferSelect;
export type InterestEntryRow = typeof interestEntries.$inferSelect;
```

Add to `src/lib/db/schema/index.ts`:
```ts
export * from "./interests";
```

- [ ] **Step 4: Generate the migration, rename it, append RLS by hand**

Run: `npm run db:generate`
```bash
mv drizzle/0012_*.sql drizzle/0012_interests.sql
```
Append:
```sql
--> statement-breakpoint
ALTER TABLE interest_rules ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE interest_rules FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY interest_rules_owner ON interest_rules
  USING (app_is_system() OR user_id = app_current_user_id())
  WITH CHECK (app_is_system() OR user_id = app_current_user_id());
--> statement-breakpoint
ALTER TABLE interest_accruals ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE interest_accruals FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY interest_accruals_owner ON interest_accruals
  USING (app_is_system() OR EXISTS (
    SELECT 1 FROM interest_rules r WHERE r.id = rule_id AND r.user_id = app_current_user_id()
  ))
  WITH CHECK (app_is_system() OR EXISTS (
    SELECT 1 FROM interest_rules r WHERE r.id = rule_id AND r.user_id = app_current_user_id()
  ));
--> statement-breakpoint
ALTER TABLE interest_entries ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE interest_entries FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY interest_entries_owner ON interest_entries
  USING (app_is_system() OR user_id = app_current_user_id())
  WITH CHECK (app_is_system() OR user_id = app_current_user_id());
```

- [ ] **Step 5: Apply and run the test**

Run: `npm run db:migrate && npm run test:integration -- interests-rls`
Expected: PASS.

- [ ] **Step 6: Typecheck and commit**

Run: `npx tsc --noEmit`
Expected: no errors.

```bash
git add drizzle/0012_interests.sql drizzle/meta src/lib/db/schema/interests.ts src/lib/db/schema/index.ts src/lib/db/interests-rls.itest.ts
git commit -m "feat(db): add interest_rules, interest_accruals and interest_entries with RLS"
```

---

### Task 14: Interests domain — accrual math, reconciliation and projection

**Files:**
- Create: `src/modules/interests/domain/accrual.ts`
- Create: `src/modules/interests/domain/accrual.test.ts`
- Create: `src/modules/interests/domain/reconciliation.ts`
- Create: `src/modules/interests/domain/reconciliation.test.ts`

**Interfaces:**
- Consumes: nothing (pure domain layer, no IO).
- Produces:
```ts
export interface DailyAccrualInput { balance: string; annualRate: string; taxRate: string; dayCount: 360 | 365; carry: string; }
export interface DailyAccrualResult { gross: string; tax: string; net: string; carryAfter: string; }
export function dailyInterest(input: DailyAccrualInput): DailyAccrualResult;

export interface ProjectionPoint { date: string; net: string; cumulativeNet: string; }
export function projectInterest(input: { balance: string; annualRate: string; taxRate: string; dayCount: 360 | 365 }, fromDate: Date, days: number): ProjectionPoint[];

export type ReconciliationStatus = "matched" | "missing" | "delayed" | "anomalous";
export interface AccrualPeriodPoint { accrualDate: string; net: string; }
export interface PaidEntryPoint { occurredAt: Date; net: string; }
export interface ReconciliationSummary { periodStart: string; periodEnd: string; accruedTotal: string; paidTotal: string; status: ReconciliationStatus; differenceCents: number; }
export function reconcileInterest(accruals: readonly AccrualPeriodPoint[], paidEntries: readonly PaidEntryPoint[], period: { start: string; end: string }): ReconciliationSummary;
```

Ruling: this is a from-scratch TypeScript port of `interest.py`'s `daily_interest` (`/home/mattia/docker/projects/Wallet Manager/app/interest.py:192-200`), reusing its exact algorithm — ACT/day-count simple daily accrual, tax withheld before rounding, HALF_UP to the cent, sub-cent remainder carried forward — but not its arithmetic engine: Python's `Decimal` has no direct JavaScript equivalent in this codebase's dependencies, so the port fixes every value at a 1e12 internal scale via `BigInt`, exactly enough headroom above the 6-decimal `numeric` columns (Task 13) to make float-style rounding error impossible at the cent boundary. `interest.py`'s own `selftest()` (lines 261–274) asserts self-consistency and two concrete edge cases rather than a fixed hardcoded result; both edge cases are reproduced verbatim below with the same input values, so this port is checked against the same behavior the legacy script checks itself against.

- [ ] **Step 1: Write the failing tests**

```ts
// src/modules/interests/domain/accrual.test.ts
import { describe, expect, it } from "vitest";
import { dailyInterest, projectInterest } from "./accrual";

describe("dailyInterest", () => {
  it("returns zero for a zero balance", () => {
    const r = dailyInterest({ balance: "0", annualRate: "0.0225", taxRate: "0.26", dayCount: 365, carry: "0" });
    expect(r).toEqual({ gross: "0.000000", tax: "0.000000", net: "0.00", carryAfter: "0.000000" });
  });

  it("rounds a tiny accrual to zero but keeps the remainder as carry (ported from interest.py's selftest)", () => {
    const r = dailyInterest({ balance: "1.00", annualRate: "0.0225", taxRate: "0.26", dayCount: 365, carry: "0" });
    expect(r.net).toBe("0.00");
    expect(Number(r.carryAfter)).toBeGreaterThan(0);
  });

  it("a prior carry can push a tiny accrual up to a full cent (ported from interest.py's selftest)", () => {
    const r = dailyInterest({ balance: "1.00", annualRate: "0.0225", taxRate: "0.26", dayCount: 365, carry: "0.0099" });
    expect(r.net).toBe("0.01");
  });

  it("withholds tax before rounding: net is within a cent of gross times (1 - taxRate)", () => {
    const r = dailyInterest({ balance: "10000.00", annualRate: "0.02", taxRate: "0.26", dayCount: 365, carry: "0" });
    const netBeforeRounding = Number(r.gross) * 0.74;
    expect(Math.abs(Number(r.net) - netBeforeRounding)).toBeLessThan(0.01);
  });

  it("floors a negative result at zero", () => {
    const r = dailyInterest({ balance: "-100.00", annualRate: "0.02", taxRate: "0", dayCount: 365, carry: "0" });
    expect(r.net).toBe("0.00");
  });
});

describe("projectInterest", () => {
  it("produces one point per day with a non-decreasing cumulative total", () => {
    const points = projectInterest({ balance: "10000.00", annualRate: "0.0225", taxRate: "0.26", dayCount: 365 }, new Date("2026-09-01"), 5);
    expect(points).toHaveLength(5);
    for (let i = 1; i < points.length; i += 1) {
      expect(Number(points[i]!.cumulativeNet)).toBeGreaterThanOrEqual(Number(points[i - 1]!.cumulativeNet));
    }
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `npm test -- accrual.test`
Expected: FAIL — `Cannot find module './accrual'`.

- [ ] **Step 3: Implement `dailyInterest` and `projectInterest`**

```ts
// src/modules/interests/domain/accrual.ts
const SCALE = 1_000_000_000_000n; // 1e12 internal fixed-point precision
const CENT_SCALE = SCALE / 100n;

function parseDecimal(value: string): bigint {
  const trimmed = value.trim();
  const negative = trimmed.startsWith("-");
  const unsigned = trimmed.replace(/^-/, "");
  const [intPart = "0", fracPart = ""] = unsigned.split(".");
  const frac = (fracPart + "0".repeat(12)).slice(0, 12);
  const n = BigInt(intPart || "0") * SCALE + BigInt(frac || "0");
  return negative ? -n : n;
}

function formatDecimal(value: bigint, decimals: number): string {
  const negative = value < 0n;
  const abs = negative ? -value : value;
  const whole = abs / SCALE;
  const frac = (abs % SCALE).toString().padStart(12, "0").slice(0, decimals);
  const sign = negative ? "-" : "";
  return decimals > 0 ? `${sign}${whole}.${frac}` : `${sign}${whole}`;
}

/** HALF_UP rounding to the cent, matching Python's `Decimal.quantize(..., ROUND_HALF_UP)`. */
function roundToCents(value: bigint): bigint {
  const quotient = value / CENT_SCALE;
  const remainder = value % CENT_SCALE;
  const half = CENT_SCALE / 2n;
  const roundedCents = remainder >= half ? quotient + 1n : quotient;
  return roundedCents * CENT_SCALE;
}

export interface DailyAccrualInput {
  balance: string;
  annualRate: string;
  taxRate: string;
  dayCount: 360 | 365;
  carry: string;
}

export interface DailyAccrualResult {
  gross: string;
  tax: string;
  net: string;
  carryAfter: string;
}

/**
 * ACT/day-count simple daily accrual, ported from `interest.py`'s
 * `daily_interest`: gross = balance × annualRate / dayCount; net = gross ×
 * (1 − taxRate), rounded HALF_UP to the cent with the previous day's
 * sub-cent remainder folded in first; the new remainder is `carryAfter`. A
 * result that would be negative (only reachable from a negative balance)
 * floors to zero, matching the legacy script.
 */
export function dailyInterest(input: DailyAccrualInput): DailyAccrualResult {
  const balance = parseDecimal(input.balance);
  const annualRate = parseDecimal(input.annualRate);
  const taxRate = parseDecimal(input.taxRate);
  const priorCarry = parseDecimal(input.carry);

  const grossRaw = (balance * annualRate) / SCALE / BigInt(input.dayCount);
  const netFactor = SCALE - taxRate;
  const netRaw = (grossRaw * netFactor) / SCALE;
  const totalRaw = netRaw + priorCarry;

  let rounded = roundToCents(totalRaw);
  if (rounded < 0n) rounded = 0n;
  const carryAfter = totalRaw - rounded;
  const taxWithheld = grossRaw - netRaw;

  return {
    gross: formatDecimal(grossRaw, 6),
    tax: formatDecimal(taxWithheld, 6),
    net: formatDecimal(rounded, 2),
    carryAfter: formatDecimal(carryAfter, 6),
  };
}

export interface ProjectionPoint {
  date: string;
  net: string;
  cumulativeNet: string;
}

/**
 * Projects forward assuming the balance stays constant — a documented
 * simplification (spec §7.6: "projections from current balance and rule").
 */
export function projectInterest(
  input: { balance: string; annualRate: string; taxRate: string; dayCount: 360 | 365 },
  fromDate: Date,
  days: number,
): ProjectionPoint[] {
  const points: ProjectionPoint[] = [];
  let carry = "0";
  let cumulativeCents = 0n;
  for (let i = 0; i < days; i += 1) {
    const day = dailyInterest({ ...input, carry });
    carry = day.carryAfter;
    cumulativeCents += BigInt(Math.round(Number(day.net) * 100));
    const date = new Date(fromDate.getTime() + i * 86_400_000);
    points.push({ date: date.toISOString().slice(0, 10), net: day.net, cumulativeNet: (Number(cumulativeCents) / 100).toFixed(2) });
  }
  return points;
}
```

- [ ] **Step 4: Run it and watch it pass**

Run: `npm test -- accrual.test`
Expected: PASS.

- [ ] **Step 5: Write the failing reconciliation test**

```ts
// src/modules/interests/domain/reconciliation.test.ts
import { describe, expect, it } from "vitest";
import { reconcileInterest } from "./reconciliation";

const period = { start: "2026-09-01", end: "2026-10-01" };

describe("reconcileInterest", () => {
  it("matches when the paid total equals the accrued total within a cent", () => {
    const summary = reconcileInterest(
      [{ accrualDate: "2026-09-01", net: "0.63" }, { accrualDate: "2026-09-02", net: "0.63" }],
      [{ occurredAt: new Date("2026-09-30"), net: "1.26" }],
      period,
    );
    expect(summary).toMatchObject({ status: "matched", accruedTotal: "1.26", paidTotal: "1.26" });
  });

  it("reports missing when nothing was paid but interest accrued", () => {
    const summary = reconcileInterest([{ accrualDate: "2026-09-01", net: "0.63" }], [], period);
    expect(summary.status).toBe("missing");
  });

  it("reports delayed when less was paid than accrued but something did land", () => {
    const summary = reconcileInterest(
      [{ accrualDate: "2026-09-01", net: "0.63" }, { accrualDate: "2026-09-02", net: "0.63" }],
      [{ occurredAt: new Date("2026-09-15"), net: "0.63" }],
      period,
    );
    expect(summary.status).toBe("delayed");
  });

  it("reports anomalous when more was paid than accrued", () => {
    const summary = reconcileInterest([{ accrualDate: "2026-09-01", net: "0.63" }], [{ occurredAt: new Date("2026-09-15"), net: "5.00" }], period);
    expect(summary.status).toBe("anomalous");
  });
});
```

- [ ] **Step 6: Run it and watch it fail**

Run: `npm test -- reconciliation.test`
Expected: FAIL — `Cannot find module './reconciliation'`.

- [ ] **Step 7: Implement `reconcileInterest`**

```ts
// src/modules/interests/domain/reconciliation.ts
export interface AccrualPeriodPoint {
  accrualDate: string;
  net: string;
}

export interface PaidEntryPoint {
  occurredAt: Date;
  net: string;
}

export type ReconciliationStatus = "matched" | "missing" | "delayed" | "anomalous";

export interface ReconciliationSummary {
  periodStart: string;
  periodEnd: string;
  accruedTotal: string;
  paidTotal: string;
  status: ReconciliationStatus;
  differenceCents: number;
}

/**
 * Compares what the accrual ledger says was earned in a period against what
 * actually landed as a paid entry. A difference of one cent or less is
 * rounding noise, not a discrepancy — a real provider posting rounds its own
 * running total its own way, independent of this ledger's day-by-day carry.
 */
export function reconcileInterest(
  accruals: readonly AccrualPeriodPoint[],
  paidEntries: readonly PaidEntryPoint[],
  period: { start: string; end: string },
): ReconciliationSummary {
  const accruedCents = accruals.reduce((sum, a) => sum + Math.round(Number(a.net) * 100), 0);
  const paidCents = paidEntries.reduce((sum, e) => sum + Math.round(Number(e.net) * 100), 0);
  const differenceCents = paidCents - accruedCents;

  let status: ReconciliationStatus;
  if (Math.abs(differenceCents) <= 1) status = "matched";
  else if (paidCents === 0 && accruedCents > 0) status = "missing";
  else if (paidCents < accruedCents) status = "delayed";
  else status = "anomalous";

  return {
    periodStart: period.start,
    periodEnd: period.end,
    accruedTotal: (accruedCents / 100).toFixed(2),
    paidTotal: (paidCents / 100).toFixed(2),
    status,
    differenceCents,
  };
}
```

- [ ] **Step 8: Run it and watch it pass**

Run: `npm test -- reconciliation.test`
Expected: PASS.

- [ ] **Step 9: Typecheck and commit**

Run: `npx tsc --noEmit`
Expected: no errors.

```bash
git add src/modules/interests/domain
git commit -m "feat(interests): port the accrual math from interest.py and add reconciliation"
```

---

### Task 15: Interests application ports, errors and in-memory repositories

**Files:**
- Create: `src/modules/interests/application/ports.ts`
- Create: `src/modules/interests/application/deps.ts`
- Create: `src/modules/interests/application/errors.ts`
- Create: `src/modules/interests/infrastructure/memory-repositories.ts`
- Create: `src/modules/interests/infrastructure/memory-repositories.test.ts`

**Interfaces:**
- Consumes: `AuditInput` from `@/platform/audit/record`.
- Produces:
```ts
export type DayCount = 360 | 365 | "actual";
export type Compounding = "simple_daily" | "monthly" | "none";
export type PostingMode = "analyze_only" | "post_to_provider";

export interface InterestRule {
  id: string; userId: string; accountId: string; annualRate: string; taxRate: string;
  dayCount: DayCount; compounding: Compounding; effectiveFrom: string; effectiveTo: string | null;
  postingMode: PostingMode; providerCategoryRef: string | null; noteMarker: string;
  version: number; createdAt: Date; updatedAt: Date;
}
export type NewInterestRule = Omit<InterestRule, "id" | "version" | "createdAt" | "updatedAt">;
export type InterestRulePatch = Partial<Pick<InterestRule, "annualRate" | "taxRate" | "dayCount" | "compounding" | "effectiveTo" | "postingMode" | "providerCategoryRef" | "noteMarker">>;
export interface InterestRulesRepository {
  list(userId: string): Promise<InterestRule[]>;
  get(userId: string, id: string): Promise<InterestRule | null>;
  listActiveForAllUsers(asOf: string): Promise<InterestRule[]>;
  create(input: NewInterestRule): Promise<InterestRule>;
  update(userId: string, id: string, expectedVersion: number, patch: InterestRulePatch): Promise<InterestRule | "version_mismatch" | null>;
}

export interface InterestAccrual {
  id: string; ruleId: string; accrualDate: string; balanceBasis: string; gross: string; tax: string; net: string;
  carryAfter: string; source: "computed"; postedAt: Date | null; entryId: string | null;
}
export type NewInterestAccrual = Omit<InterestAccrual, "id">;
export interface InterestAccrualsRepository {
  forRule(ruleId: string, from: string, to: string): Promise<InterestAccrual[]>;
  latestCarry(ruleId: string): Promise<{ accrualDate: string; carryAfter: string } | null>;
  upsert(input: NewInterestAccrual): Promise<InterestAccrual>;
  markPosted(id: string, entryId: string, postedAt: Date): Promise<void>;
}

export interface InterestEntry {
  id: string; userId: string; accountId: string; occurredAt: Date; gross: string; net: string;
  kind: "paid" | "projected" | "adjustment"; transactionId: string | null; ruleId: string | null;
  source: "computed" | "provider" | "manual";
}
export type NewInterestEntry = Omit<InterestEntry, "id">;
export interface InterestEntriesRepository {
  listForRule(ruleId: string, kind?: InterestEntry["kind"]): Promise<InterestEntry[]>;
  create(input: NewInterestEntry): Promise<InterestEntry>;
}

export interface AccountBalanceLookup { latestBalanceAsOf(userId: string, accountId: string, asOf: string): Promise<string | null>; }
export interface Clock { now(): Date; }
export interface UseCaseDeps {
  rules: InterestRulesRepository;
  accruals: InterestAccrualsRepository;
  entries: InterestEntriesRepository;
  balances: AccountBalanceLookup;
  clock: Clock;
  audit(e: AuditInput): Promise<void>;
}
```
Ruling: entity types live directly in `application/ports.ts` rather than a separate `domain/rule.ts`, unlike the accounts and expenses modules — the interests module's entities carry no invariants of their own beyond what `dailyInterest`/`reconcileInterest` (Task 14, already pure and IO-free) already express, so a third domain file would hold only flat field lists with no behavior.

- [ ] **Step 1: Write the failing test**

```ts
// src/modules/interests/infrastructure/memory-repositories.test.ts
import { describe, expect, it } from "vitest";
import { MemoryInterestAccrualsRepository, MemoryInterestEntriesRepository, MemoryInterestRulesRepository } from "./memory-repositories";

function rule(overrides: Partial<Parameters<MemoryInterestRulesRepository["create"]>[0]> = {}) {
  return {
    userId: "u1", accountId: "acc-1", annualRate: "0.0225", taxRate: "0.26",
    dayCount: 365 as const, compounding: "simple_daily" as const,
    effectiveFrom: "2026-01-01", effectiveTo: null, postingMode: "analyze_only" as const,
    providerCategoryRef: null, noteMarker: "auto-interest",
    ...overrides,
  };
}

describe("MemoryInterestRulesRepository", () => {
  it("update rejects a stale version", async () => {
    const repo = new MemoryInterestRulesRepository();
    const created = await repo.create(rule());
    const result = await repo.update("u1", created.id, created.version + 1, { annualRate: "0.03" });
    expect(result).toBe("version_mismatch");
  });

  it("listActiveForAllUsers excludes a rule whose effectiveTo has passed", async () => {
    const repo = new MemoryInterestRulesRepository();
    await repo.create(rule({ effectiveTo: "2026-06-30" }));
    await repo.create(rule({ effectiveTo: null }));
    const active = await repo.listActiveForAllUsers("2026-09-05");
    expect(active).toHaveLength(1);
  });
});

describe("MemoryInterestAccrualsRepository", () => {
  it("upsert on (ruleId, accrualDate) replaces the same day rather than duplicating", async () => {
    const repo = new MemoryInterestAccrualsRepository();
    const first = await repo.upsert({ ruleId: "r1", accrualDate: "2026-09-01", balanceBasis: "1000.00", gross: "0.061644", tax: "0.016027", net: "0.05", carryAfter: "-0.005617", source: "computed", postedAt: null, entryId: null });
    const second = await repo.upsert({ ruleId: "r1", accrualDate: "2026-09-01", balanceBasis: "1000.00", gross: "0.061644", tax: "0.016027", net: "0.05", carryAfter: "0.000000", source: "computed", postedAt: null, entryId: null });
    expect(first.id).toBe(second.id);
    expect(await repo.forRule("r1", "2026-09-01", "2026-09-02")).toHaveLength(1);
  });

  it("forRule orders by accrualDate ascending, matching the Drizzle repository's ORDER BY", async () => {
    const repo = new MemoryInterestAccrualsRepository();
    await repo.upsert({ ruleId: "r1", accrualDate: "2026-09-02", balanceBasis: "1000.00", gross: "0", tax: "0", net: "0.00", carryAfter: "0", source: "computed", postedAt: null, entryId: null });
    await repo.upsert({ ruleId: "r1", accrualDate: "2026-09-01", balanceBasis: "1000.00", gross: "0", tax: "0", net: "0.00", carryAfter: "0", source: "computed", postedAt: null, entryId: null });
    const rows = await repo.forRule("r1", "2026-09-01", "2026-09-03");
    expect(rows.map((r) => r.accrualDate)).toEqual(["2026-09-01", "2026-09-02"]);
  });

  it("upsert on a re-accrued day preserves postedAt/entryId set by markPosted, rather than resetting them to null (Ruling P3-16)", async () => {
    const repo = new MemoryInterestAccrualsRepository();
    const created = await repo.upsert({ ruleId: "r1", accrualDate: "2026-09-01", balanceBasis: "1000.00", gross: "0.061644", tax: "0.016027", net: "0.05", carryAfter: "-0.005617", source: "computed", postedAt: null, entryId: null });
    const postedAt = new Date("2026-09-02T06:00:00Z");
    await repo.markPosted(created.id, "entry-1", postedAt);

    // `runInterestAccrual` always calls `upsert` with `postedAt: null, entryId: null`
    // regardless of whether the accrual was posted earlier — the same call shape
    // a re-run of the job makes on a day it already accrued and posted.
    const reUpserted = await repo.upsert({
      ruleId: "r1",
      accrualDate: "2026-09-01",
      balanceBasis: "1200.00",
      gross: "0.09",
      tax: "0.02",
      net: "0.07",
      carryAfter: "0.000000",
      source: "computed",
      postedAt: null,
      entryId: null,
    });

    expect(reUpserted.id).toBe(created.id);
    expect(reUpserted.postedAt).toEqual(postedAt);
    expect(reUpserted.entryId).toBe("entry-1");
    expect(reUpserted.net).toBe("0.07");
  });
});

describe("MemoryInterestEntriesRepository", () => {
  it("filters listForRule by kind when given", async () => {
    const repo = new MemoryInterestEntriesRepository();
    await repo.create({ userId: "u1", accountId: "acc-1", occurredAt: new Date(), gross: "1.00", net: "0.74", kind: "projected", transactionId: null, ruleId: "r1", source: "computed" });
    await repo.create({ userId: "u1", accountId: "acc-1", occurredAt: new Date(), gross: "1.00", net: "0.74", kind: "paid", transactionId: null, ruleId: "r1", source: "provider" });
    expect(await repo.listForRule("r1", "paid")).toHaveLength(1);
    expect(await repo.listForRule("r1")).toHaveLength(2);
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `npm test -- interests/infrastructure/memory-repositories`
Expected: FAIL — `Cannot find module './memory-repositories'`.

- [ ] **Step 3: Write `ports.ts`, `deps.ts` and `errors.ts`**

```ts
// src/modules/interests/application/ports.ts
import type { AuditInput } from "@/platform/audit/record";

export type DayCount = 360 | 365 | "actual";
export type Compounding = "simple_daily" | "monthly" | "none";
export type PostingMode = "analyze_only" | "post_to_provider";

export interface InterestRule {
  id: string;
  userId: string;
  accountId: string;
  annualRate: string;
  taxRate: string;
  dayCount: DayCount;
  compounding: Compounding;
  effectiveFrom: string;
  effectiveTo: string | null;
  postingMode: PostingMode;
  providerCategoryRef: string | null;
  noteMarker: string;
  version: number;
  createdAt: Date;
  updatedAt: Date;
}

export type NewInterestRule = Omit<InterestRule, "id" | "version" | "createdAt" | "updatedAt">;
export type InterestRulePatch = Partial<
  Pick<InterestRule, "annualRate" | "taxRate" | "dayCount" | "compounding" | "effectiveTo" | "postingMode" | "providerCategoryRef" | "noteMarker">
>;

export interface InterestRulesRepository {
  list(userId: string): Promise<InterestRule[]>;
  get(userId: string, id: string): Promise<InterestRule | null>;
  listActiveForAllUsers(asOf: string): Promise<InterestRule[]>;
  create(input: NewInterestRule): Promise<InterestRule>;
  update(userId: string, id: string, expectedVersion: number, patch: InterestRulePatch): Promise<InterestRule | "version_mismatch" | null>;
}

export interface InterestAccrual {
  id: string;
  ruleId: string;
  accrualDate: string;
  balanceBasis: string;
  gross: string;
  tax: string;
  net: string;
  carryAfter: string;
  source: "computed";
  postedAt: Date | null;
  entryId: string | null;
}

export type NewInterestAccrual = Omit<InterestAccrual, "id">;

export interface InterestAccrualsRepository {
  forRule(ruleId: string, from: string, to: string): Promise<InterestAccrual[]>;
  latestCarry(ruleId: string): Promise<{ accrualDate: string; carryAfter: string } | null>;
  upsert(input: NewInterestAccrual): Promise<InterestAccrual>;
  markPosted(id: string, entryId: string, postedAt: Date): Promise<void>;
}

export interface InterestEntry {
  id: string;
  userId: string;
  accountId: string;
  occurredAt: Date;
  gross: string;
  net: string;
  kind: "paid" | "projected" | "adjustment";
  transactionId: string | null;
  ruleId: string | null;
  source: "computed" | "provider" | "manual";
}

export type NewInterestEntry = Omit<InterestEntry, "id">;

export interface InterestEntriesRepository {
  listForRule(ruleId: string, kind?: InterestEntry["kind"]): Promise<InterestEntry[]>;
  create(input: NewInterestEntry): Promise<InterestEntry>;
}

export interface AccountBalanceLookup {
  latestBalanceAsOf(userId: string, accountId: string, asOf: string): Promise<string | null>;
}

export interface Clock {
  now(): Date;
}

export interface UseCaseDeps {
  rules: InterestRulesRepository;
  accruals: InterestAccrualsRepository;
  entries: InterestEntriesRepository;
  balances: AccountBalanceLookup;
  clock: Clock;
  audit(e: AuditInput): Promise<void>;
}
```

```ts
// src/modules/interests/application/deps.ts
export type { UseCaseDeps } from "./ports";
```

```ts
// src/modules/interests/application/errors.ts
export class NotFoundError extends Error {
  constructor(message = "Interest rule not found") {
    super(message);
    this.name = "NotFoundError";
  }
}

export class VersionMismatchError extends Error {
  constructor(message = "This rule changed since you opened it. Reload and try again.") {
    super(message);
    this.name = "VersionMismatchError";
  }
}

export class InvalidInputError extends Error {
  constructor(
    message: string,
    readonly issues?: unknown,
  ) {
    super(message);
    this.name = "InvalidInputError";
  }
}
```

- [ ] **Step 4: Implement the three in-memory repositories**

```ts
// src/modules/interests/infrastructure/memory-repositories.ts
import type {
  InterestAccrual,
  InterestAccrualsRepository,
  InterestEntriesRepository,
  InterestEntry,
  InterestRule,
  InterestRulePatch,
  InterestRulesRepository,
  NewInterestAccrual,
  NewInterestEntry,
  NewInterestRule,
} from "../application/ports";

function randomId(): string {
  return crypto.randomUUID();
}

export class MemoryInterestRulesRepository implements InterestRulesRepository {
  private rows: InterestRule[] = [];

  async list(userId: string): Promise<InterestRule[]> {
    return this.rows.filter((r) => r.userId === userId);
  }

  async get(userId: string, id: string): Promise<InterestRule | null> {
    return this.rows.find((r) => r.userId === userId && r.id === id) ?? null;
  }

  async listActiveForAllUsers(asOf: string): Promise<InterestRule[]> {
    return this.rows.filter((r) => r.effectiveFrom <= asOf && (r.effectiveTo === null || r.effectiveTo >= asOf));
  }

  async create(input: NewInterestRule): Promise<InterestRule> {
    const now = new Date();
    const row: InterestRule = { ...input, id: randomId(), version: 1, createdAt: now, updatedAt: now };
    this.rows.push(row);
    return row;
  }

  async update(
    userId: string,
    id: string,
    expectedVersion: number,
    patch: InterestRulePatch,
  ): Promise<InterestRule | "version_mismatch" | null> {
    const index = this.rows.findIndex((r) => r.userId === userId && r.id === id);
    if (index === -1) return null;
    const current = this.rows[index]!;
    if (current.version !== expectedVersion) return "version_mismatch";
    const updated: InterestRule = { ...current, ...patch, version: current.version + 1, updatedAt: new Date() };
    this.rows[index] = updated;
    return updated;
  }
}

export class MemoryInterestAccrualsRepository implements InterestAccrualsRepository {
  private rows: InterestAccrual[] = [];

  async forRule(ruleId: string, from: string, to: string): Promise<InterestAccrual[]> {
    return this.rows
      .filter((a) => a.ruleId === ruleId && a.accrualDate >= from && a.accrualDate <= to)
      .sort((a, b) => a.accrualDate.localeCompare(b.accrualDate));
  }

  async latestCarry(ruleId: string): Promise<{ accrualDate: string; carryAfter: string } | null> {
    const rows = this.rows.filter((a) => a.ruleId === ruleId).sort((a, b) => b.accrualDate.localeCompare(a.accrualDate));
    const latest = rows[0];
    return latest ? { accrualDate: latest.accrualDate, carryAfter: latest.carryAfter } : null;
  }

  async upsert(input: NewInterestAccrual): Promise<InterestAccrual> {
    const index = this.rows.findIndex((a) => a.ruleId === input.ruleId && a.accrualDate === input.accrualDate);
    if (index === -1) {
      const row: InterestAccrual = { ...input, id: randomId() };
      this.rows.push(row);
      return row;
    }
    // Mirrors DrizzleInterestAccrualsRepository.upsert's onConflictDoUpdate `set`
    // list exactly: only the computed fields are replaced on conflict.
    // `postedAt`/`entryId` are never touched here — every caller (including
    // `runInterestAccrual`) always passes `postedAt: null, entryId: null`, so
    // spreading `input` over them would silently un-post an accrual that
    // `markPosted` already posted, and `shouldPost`'s idempotency check would
    // then post it to Wallet a second time (Ruling P3-16).
    const existing = this.rows[index]!;
    const updated: InterestAccrual = {
      ...existing,
      balanceBasis: input.balanceBasis,
      gross: input.gross,
      tax: input.tax,
      net: input.net,
      carryAfter: input.carryAfter,
    };
    this.rows[index] = updated;
    return updated;
  }

  async markPosted(id: string, entryId: string, postedAt: Date): Promise<void> {
    const index = this.rows.findIndex((a) => a.id === id);
    if (index === -1) return;
    this.rows[index] = { ...this.rows[index]!, postedAt, entryId };
  }
}

export class MemoryInterestEntriesRepository implements InterestEntriesRepository {
  private rows: InterestEntry[] = [];

  async listForRule(ruleId: string, kind?: InterestEntry["kind"]): Promise<InterestEntry[]> {
    return this.rows
      .filter((e) => e.ruleId === ruleId && (kind === undefined || e.kind === kind))
      .sort((a, b) => a.occurredAt.getTime() - b.occurredAt.getTime());
  }

  async create(input: NewInterestEntry): Promise<InterestEntry> {
    const row: InterestEntry = { ...input, id: randomId() };
    this.rows.push(row);
    return row;
  }
}
```

- [ ] **Step 5: Run the tests**

Run: `npm test -- interests/infrastructure/memory-repositories`
Expected: PASS.

- [ ] **Step 6: Typecheck and commit**

Run: `npx tsc --noEmit`
Expected: no errors.

```bash
git add src/modules/interests/application/ports.ts src/modules/interests/application/deps.ts src/modules/interests/application/errors.ts src/modules/interests/infrastructure/memory-repositories.ts src/modules/interests/infrastructure/memory-repositories.test.ts
git commit -m "feat(interests): add application ports and in-memory repositories"
```

---

### Task 16: Interests Drizzle repositories and the production deps bag

**Files:**
- Create: `src/modules/interests/infrastructure/drizzle-interest-rules-repository.ts`
- Create: `src/modules/interests/infrastructure/drizzle-interest-accruals-repository.ts`
- Create: `src/modules/interests/infrastructure/drizzle-interest-entries-repository.ts`
- Create: `src/modules/interests/infrastructure/account-balance-lookup.ts`
- Create: `src/modules/interests/infrastructure/deps.ts`
- Create: `src/modules/interests/infrastructure/repositories.itest.ts`

**Interfaces:**
- Consumes: `interestRules`, `interestAccruals`, `interestEntries` from `@/lib/db/schema` (Task 13); `InterestRulesRepository`, `InterestAccrualsRepository`, `InterestEntriesRepository`, `AccountBalanceLookup`, `UseCaseDeps` from `../application/ports` (Task 15); `DrizzleAccountsRepository` from `@/modules/accounts/infrastructure/drizzle-accounts-repository` (existing, reused); `recordAudit` from `@/platform/audit/record`.
- Produces:
```ts
export class DrizzleInterestRulesRepository implements InterestRulesRepository { constructor(db: DbClient); /* ... */ }
export class DrizzleInterestAccrualsRepository implements InterestAccrualsRepository { constructor(db: DbClient); /* ... */ }
export class DrizzleInterestEntriesRepository implements InterestEntriesRepository { constructor(db: DbClient); /* ... */ }
export function drizzleAccountBalanceLookup(db: DbClient): AccountBalanceLookup;
export function interestDeps(tx: DbClient, requestId?: string | null): UseCaseDeps;
```

- [ ] **Step 1: Write the failing integration test**

```ts
// src/modules/interests/infrastructure/repositories.itest.ts
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { accounts, organizations, users } from "@/lib/db/schema";
import { withUserContext } from "@/platform/db/context";
import { closeDb, resetDb, testDb } from "@/test/db";
import { DrizzleInterestRulesRepository } from "./drizzle-interest-rules-repository";
import { DrizzleInterestAccrualsRepository } from "./drizzle-interest-accruals-repository";

async function seed() {
  const db = await testDb();
  const [org] = await db.insert(organizations).values({ name: "P" }).returning();
  const [user] = await db.insert(users).values({ organizationId: org!.id, displayName: "A" }).returning();
  const [account] = await db.insert(accounts).values({ userId: user!.id, name: "Savings", type: "savings", origin: "manual" }).returning();
  return { userId: user!.id, accountId: account!.id };
}

describe("DrizzleInterestRulesRepository", () => {
  beforeEach(resetDb);
  afterAll(closeDb);

  it("update rejects a stale version, matching the memory repository's contract", async () => {
    const { userId, accountId } = await seed();
    const db = await testDb();
    await withUserContext(db, { userId }, async (tx) => {
      const repo = new DrizzleInterestRulesRepository(tx);
      const created = await repo.create({ userId, accountId, annualRate: "0.0225", taxRate: "0.26", dayCount: 365, compounding: "simple_daily", effectiveFrom: "2026-01-01", effectiveTo: null, postingMode: "analyze_only", providerCategoryRef: null, noteMarker: "auto-interest" });
      const result = await repo.update(userId, created.id, created.version + 1, { annualRate: "0.03" });
      expect(result).toBe("version_mismatch");
    });
  });
});

describe("DrizzleInterestAccrualsRepository", () => {
  beforeEach(resetDb);
  afterAll(closeDb);

  it("upsert on (ruleId, accrualDate) replaces rather than duplicates", async () => {
    const { userId, accountId } = await seed();
    const db = await testDb();
    await withUserContext(db, { userId }, async (tx) => {
      const rules = new DrizzleInterestRulesRepository(tx);
      const rule = await rules.create({ userId, accountId, annualRate: "0.0225", taxRate: "0.26", dayCount: 365, compounding: "simple_daily", effectiveFrom: "2026-01-01", effectiveTo: null, postingMode: "analyze_only", providerCategoryRef: null, noteMarker: "auto-interest" });
      const accruals = new DrizzleInterestAccrualsRepository(tx);
      await accruals.upsert({ ruleId: rule.id, accrualDate: "2026-09-01", balanceBasis: "1000.00", gross: "0.061644", tax: "0.016027", net: "0.05", carryAfter: "-0.005617", source: "computed", postedAt: null, entryId: null });
      await accruals.upsert({ ruleId: rule.id, accrualDate: "2026-09-01", balanceBasis: "1000.00", gross: "0.061644", tax: "0.016027", net: "0.05", carryAfter: "0.000000", source: "computed", postedAt: null, entryId: null });
      const rows = await accruals.forRule(rule.id, "2026-09-01", "2026-09-02");
      expect(rows).toHaveLength(1);
      expect(rows[0]!.carryAfter).toBe("0.000000");
    });
  });

  it("upsert on a re-accrued day preserves postedAt/entryId set by markPosted, rather than resetting them to null (Ruling P3-16)", async () => {
    const { userId, accountId } = await seed();
    const db = await testDb();
    await withUserContext(db, { userId }, async (tx) => {
      const rules = new DrizzleInterestRulesRepository(tx);
      const rule = await rules.create({ userId, accountId, annualRate: "0.0225", taxRate: "0.26", dayCount: 365, compounding: "simple_daily", effectiveFrom: "2026-01-01", effectiveTo: null, postingMode: "analyze_only", providerCategoryRef: null, noteMarker: "auto-interest" });
      const accruals = new DrizzleInterestAccrualsRepository(tx);
      const created = await accruals.upsert({ ruleId: rule.id, accrualDate: "2026-09-01", balanceBasis: "1000.00", gross: "0.061644", tax: "0.016027", net: "0.05", carryAfter: "-0.005617", source: "computed", postedAt: null, entryId: null });
      const postedAt = new Date("2026-09-02T06:00:00Z");
      const entryId = crypto.randomUUID();
      await accruals.markPosted(created.id, entryId, postedAt);

      // The daily job re-upserts today's accrual with `postedAt: null, entryId:
      // null` every time it runs, even on a day it already posted — the
      // conflict path must not undo `markPosted`'s write.
      const reUpserted = await accruals.upsert({ ruleId: rule.id, accrualDate: "2026-09-01", balanceBasis: "1200.00", gross: "0.09", tax: "0.02", net: "0.07", carryAfter: "0.000000", source: "computed", postedAt: null, entryId: null });

      expect(reUpserted.id).toBe(created.id);
      expect(reUpserted.postedAt?.toISOString()).toBe(postedAt.toISOString());
      expect(reUpserted.entryId).toBe(entryId);
      expect(reUpserted.net).toBe("0.07");
    });
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `npm run test:integration -- interests/infrastructure/repositories`
Expected: FAIL — `Cannot find module './drizzle-interest-rules-repository'`.

- [ ] **Step 3: Implement the repositories and the deps factory**

```ts
// src/modules/interests/infrastructure/drizzle-interest-rules-repository.ts
import { and, eq, sql } from "drizzle-orm";
import { lte, or, isNull, gte } from "drizzle-orm";
import type { DbClient } from "@/lib/db/client";
import { interestRules, type InterestRuleRow } from "@/lib/db/schema";
import type { InterestRule, InterestRulePatch, InterestRulesRepository, NewInterestRule } from "../application/ports";

function toRule(row: InterestRuleRow): InterestRule {
  return {
    id: row.id,
    userId: row.userId,
    accountId: row.accountId,
    annualRate: row.annualRate,
    taxRate: row.taxRate,
    dayCount: (row.dayCount === "actual" ? "actual" : Number(row.dayCount)) as InterestRule["dayCount"],
    compounding: row.compounding as InterestRule["compounding"],
    effectiveFrom: row.effectiveFrom,
    effectiveTo: row.effectiveTo,
    postingMode: row.postingMode as InterestRule["postingMode"],
    providerCategoryRef: row.providerCategoryRef,
    noteMarker: row.noteMarker,
    version: row.version,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

export class DrizzleInterestRulesRepository implements InterestRulesRepository {
  constructor(private readonly db: DbClient) {}

  async list(userId: string): Promise<InterestRule[]> {
    const rows = await this.db.select().from(interestRules).where(eq(interestRules.userId, userId));
    return rows.map(toRule);
  }

  async get(userId: string, id: string): Promise<InterestRule | null> {
    const [row] = await this.db.select().from(interestRules).where(and(eq(interestRules.userId, userId), eq(interestRules.id, id))).limit(1);
    return row ? toRule(row) : null;
  }

  async listActiveForAllUsers(asOf: string): Promise<InterestRule[]> {
    const rows = await this.db
      .select()
      .from(interestRules)
      .where(and(lte(interestRules.effectiveFrom, asOf), or(isNull(interestRules.effectiveTo), gte(interestRules.effectiveTo, asOf))));
    return rows.map(toRule);
  }

  async create(input: NewInterestRule): Promise<InterestRule> {
    const [row] = await this.db.insert(interestRules).values({ ...input, dayCount: String(input.dayCount) }).returning();
    return toRule(row!);
  }

  async update(
    userId: string,
    id: string,
    expectedVersion: number,
    patch: InterestRulePatch,
  ): Promise<InterestRule | "version_mismatch" | null> {
    const [row] = await this.db
      .update(interestRules)
      .set({ ...patch, dayCount: patch.dayCount !== undefined ? String(patch.dayCount) : undefined, version: sql`${interestRules.version} + 1`, updatedAt: new Date() })
      .where(and(eq(interestRules.userId, userId), eq(interestRules.id, id), eq(interestRules.version, expectedVersion)))
      .returning();
    if (row) return toRule(row);
    const existing = await this.get(userId, id);
    return existing === null ? null : "version_mismatch";
  }
}
```

```ts
// src/modules/interests/infrastructure/drizzle-interest-accruals-repository.ts
import { and, asc, desc, eq, gte, lte } from "drizzle-orm";
import type { DbClient } from "@/lib/db/client";
import { interestAccruals, type InterestAccrualRow } from "@/lib/db/schema";
import type { InterestAccrual, InterestAccrualsRepository, NewInterestAccrual } from "../application/ports";

function toAccrual(row: InterestAccrualRow): InterestAccrual {
  return {
    id: row.id,
    ruleId: row.ruleId,
    accrualDate: row.accrualDate,
    balanceBasis: row.balanceBasis,
    gross: row.gross,
    tax: row.tax,
    net: row.net,
    carryAfter: row.carryAfter,
    source: row.source as "computed",
    postedAt: row.postedAt,
    entryId: row.entryId,
  };
}

export class DrizzleInterestAccrualsRepository implements InterestAccrualsRepository {
  constructor(private readonly db: DbClient) {}

  async forRule(ruleId: string, from: string, to: string): Promise<InterestAccrual[]> {
    const rows = await this.db
      .select()
      .from(interestAccruals)
      .where(and(eq(interestAccruals.ruleId, ruleId), gte(interestAccruals.accrualDate, from), lte(interestAccruals.accrualDate, to)))
      .orderBy(asc(interestAccruals.accrualDate));
    return rows.map(toAccrual);
  }

  async latestCarry(ruleId: string): Promise<{ accrualDate: string; carryAfter: string } | null> {
    const [row] = await this.db
      .select({ accrualDate: interestAccruals.accrualDate, carryAfter: interestAccruals.carryAfter })
      .from(interestAccruals)
      .where(eq(interestAccruals.ruleId, ruleId))
      .orderBy(desc(interestAccruals.accrualDate))
      .limit(1);
    return row ?? null;
  }

  async upsert(input: NewInterestAccrual): Promise<InterestAccrual> {
    // `set` deliberately omits `postedAt`/`entryId`: every caller (including
    // `runInterestAccrual`) always passes `postedAt: null, entryId: null` on
    // `input`, and this repository's contract is that a conflict never resets
    // what `markPosted` already recorded — `MemoryInterestAccrualsRepository.upsert`
    // preserves the same two columns identically on conflict (Ruling P3-16).
    const [row] = await this.db
      .insert(interestAccruals)
      .values(input)
      .onConflictDoUpdate({
        target: [interestAccruals.ruleId, interestAccruals.accrualDate],
        set: {
          balanceBasis: input.balanceBasis,
          gross: input.gross,
          tax: input.tax,
          net: input.net,
          carryAfter: input.carryAfter,
        },
      })
      .returning();
    return toAccrual(row!);
  }

  async markPosted(id: string, entryId: string, postedAt: Date): Promise<void> {
    await this.db.update(interestAccruals).set({ entryId, postedAt }).where(eq(interestAccruals.id, id));
  }
}
```

```ts
// src/modules/interests/infrastructure/drizzle-interest-entries-repository.ts
import { and, asc, eq } from "drizzle-orm";
import type { DbClient } from "@/lib/db/client";
import { interestEntries, type InterestEntryRow } from "@/lib/db/schema";
import type { InterestEntriesRepository, InterestEntry, NewInterestEntry } from "../application/ports";

function toEntry(row: InterestEntryRow): InterestEntry {
  return {
    id: row.id,
    userId: row.userId,
    accountId: row.accountId,
    occurredAt: row.occurredAt,
    gross: row.gross,
    net: row.net,
    kind: row.kind as InterestEntry["kind"],
    transactionId: row.transactionId,
    ruleId: row.ruleId,
    source: row.source as InterestEntry["source"],
  };
}

export class DrizzleInterestEntriesRepository implements InterestEntriesRepository {
  constructor(private readonly db: DbClient) {}

  async listForRule(ruleId: string, kind?: InterestEntry["kind"]): Promise<InterestEntry[]> {
    const conditions = [eq(interestEntries.ruleId, ruleId)];
    if (kind) conditions.push(eq(interestEntries.kind, kind));
    const rows = await this.db
      .select()
      .from(interestEntries)
      .where(and(...conditions))
      .orderBy(asc(interestEntries.occurredAt));
    return rows.map(toEntry);
  }

  async create(input: NewInterestEntry): Promise<InterestEntry> {
    const [row] = await this.db.insert(interestEntries).values(input).returning();
    return toEntry(row!);
  }
}
```

```ts
// src/modules/interests/infrastructure/account-balance-lookup.ts
import { DrizzleAccountsRepository } from "@/modules/accounts/infrastructure/drizzle-accounts-repository";
import type { DbClient } from "@/lib/db/client";
import type { AccountBalanceLookup } from "../application/ports";

/** `latestBalancesBefore` is exclusive of its bound, so `asOf` is included by asking for the day after it. */
function dayAfter(asOf: string): string {
  const d = new Date(`${asOf}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
}

export function drizzleAccountBalanceLookup(db: DbClient): AccountBalanceLookup {
  return {
    async latestBalanceAsOf(userId, accountId, asOf) {
      const repo = new DrizzleAccountsRepository(db);
      const map = await repo.latestBalancesBefore(userId, [accountId], dayAfter(asOf));
      return map.get(accountId)?.balance ?? null;
    },
  };
}
```

```ts
// src/modules/interests/infrastructure/deps.ts
import type { DbClient } from "@/lib/db/client";
import { recordAudit } from "@/platform/audit/record";
import type { UseCaseDeps } from "../application/ports";
import { drizzleAccountBalanceLookup } from "./account-balance-lookup";
import { DrizzleInterestAccrualsRepository } from "./drizzle-interest-accruals-repository";
import { DrizzleInterestEntriesRepository } from "./drizzle-interest-entries-repository";
import { DrizzleInterestRulesRepository } from "./drizzle-interest-rules-repository";

export function interestDeps(tx: DbClient, requestId?: string | null): UseCaseDeps {
  return {
    rules: new DrizzleInterestRulesRepository(tx),
    accruals: new DrizzleInterestAccrualsRepository(tx),
    entries: new DrizzleInterestEntriesRepository(tx),
    balances: drizzleAccountBalanceLookup(tx),
    clock: { now: () => new Date() },
    audit: (e) => recordAudit(tx, { ...e, requestId: requestId ?? null }),
  };
}
```

- [ ] **Step 4: Run the integration tests**

Run: `npm run test:integration -- interests/infrastructure/repositories`
Expected: PASS.

- [ ] **Step 5: Typecheck and commit**

Run: `npx tsc --noEmit`
Expected: no errors.

```bash
git add src/modules/interests/infrastructure
git commit -m "feat(interests): add Drizzle repositories and the production deps bag"
```

---

### Task 17: Interests use cases — rules CRUD, accrual run, rule detail

**Files:**
- Modify: `src/platform/auth/permissions.ts`
- Create: `src/modules/interests/application/create-interest-rule.ts`
- Create: `src/modules/interests/application/update-interest-rule.ts`
- Create: `src/modules/interests/application/list-interest-rules.ts`
- Create: `src/modules/interests/application/get-interest-rule-detail.ts`
- Create: `src/modules/interests/application/run-interest-accrual.ts`
- Create: `src/modules/interests/application/rules.test.ts`
- Create: `src/modules/interests/application/run-interest-accrual.test.ts`
- Create: `src/modules/interests/application/get-interest-rule-detail.test.ts`

**Interfaces:**
- Consumes: `UseCaseDeps`, `InterestRule`, `NewInterestRule`, `InterestRulePatch` from `./ports` (Task 15); `dailyInterest`, `projectInterest` from `../domain/accrual` (Task 14); `reconcileInterest` from `../domain/reconciliation` (Task 14); `NotFoundError`, `VersionMismatchError` from `./errors` (Task 15).
- Produces:
```ts
export interface CreateInterestRuleInput {
  accountId: string; annualRate: string; taxRate: string; dayCount: DayCount; compounding?: Compounding;
  effectiveFrom: string; effectiveTo?: string | null; postingMode?: PostingMode;
  providerCategoryRef?: string | null; noteMarker?: string;
}
export function createInterestRule(deps: UseCaseDeps): (principal: Principal, input: CreateInterestRuleInput) => Promise<InterestRule>;
export function updateInterestRule(deps: UseCaseDeps): (principal: Principal, id: string, expectedVersion: number, patch: InterestRulePatch) => Promise<InterestRule>;
export function listInterestRules(deps: UseCaseDeps): (principal: Principal) => Promise<InterestRule[]>;

export interface InterestRuleDetail { rule: InterestRule; accruals: InterestAccrual[]; entries: InterestEntry[]; reconciliation: ReconciliationSummary; projection: ProjectionPoint[]; }
export function getInterestRuleDetail(deps: UseCaseDeps): (principal: Principal, id: string, opts: { periodStart: string; periodEnd: string; projectionDays?: number }) => Promise<InterestRuleDetail>;

export interface RunInterestAccrualResult { accrued: boolean; }
export function runInterestAccrual(deps: UseCaseDeps): (rule: InterestRule, accrualDate: string) => Promise<RunInterestAccrualResult>;
```
- Permission catalogue gains `"interests.read"` and `"interests.write"`, following the same `member`/`viewer` shape Task 9 gave `expenses.*`.

- [ ] **Step 1: Add the two new permissions**

In `src/platform/auth/permissions.ts`:
```ts
export const PERMISSIONS = [
  "accounts.read",
  "accounts.write",
  "accounts.delete",
  "finance.manage",
  "integrations.manage",
  "jobs.run",
  "expenses.read",
  "expenses.write",
  "interests.read",
  "interests.write",
  "admin.users",
  "admin.audit",
] as const;
```
and widen `member`/`viewer`:
```ts
member: [
  "accounts.read", "accounts.write", "accounts.delete",
  "finance.manage", "integrations.manage", "jobs.run",
  "expenses.read", "expenses.write", "interests.read", "interests.write",
],
viewer: ["accounts.read", "expenses.read", "interests.read"],
```

- [ ] **Step 2: Write the failing tests for the CRUD use cases**

```ts
// src/modules/interests/application/rules.test.ts
import { describe, expect, it } from "vitest";
import { testPrincipal } from "@/test/principal";
import {
  MemoryInterestAccrualsRepository,
  MemoryInterestEntriesRepository,
  MemoryInterestRulesRepository,
} from "../infrastructure/memory-repositories";
import { createInterestRule } from "./create-interest-rule";
import { listInterestRules } from "./list-interest-rules";
import { updateInterestRule } from "./update-interest-rule";
import { VersionMismatchError } from "./errors";

function harness() {
  return {
    rules: new MemoryInterestRulesRepository(),
    accruals: new MemoryInterestAccrualsRepository(),
    entries: new MemoryInterestEntriesRepository(),
    balances: { latestBalanceAsOf: async () => "1000.00" },
    clock: { now: () => new Date("2026-09-05T00:00:00Z") },
    audit: async () => {},
  };
}

describe("createInterestRule, updateInterestRule, listInterestRules", () => {
  it("creates a rule with analyze_only as the default posting mode", async () => {
    const deps = harness();
    const rule = await createInterestRule(deps)(testPrincipal(), { accountId: "acc-1", annualRate: "0.0225", taxRate: "0.26", dayCount: 365, effectiveFrom: "2026-01-01" });
    expect(rule.postingMode).toBe("analyze_only");
    expect(await listInterestRules(deps)(testPrincipal())).toHaveLength(1);
  });

  it("update rejects a stale version", async () => {
    const deps = harness();
    const rule = await createInterestRule(deps)(testPrincipal(), { accountId: "acc-1", annualRate: "0.0225", taxRate: "0.26", dayCount: 365, effectiveFrom: "2026-01-01" });
    await expect(updateInterestRule(deps)(testPrincipal(), rule.id, rule.version + 1, { annualRate: "0.03" })).rejects.toThrow(VersionMismatchError);
  });
});
```

- [ ] **Step 3: Run it and watch it fail**

Run: `npm test -- interests/application/rules`
Expected: FAIL — the three use-case modules do not exist yet.

- [ ] **Step 4: Implement the three CRUD use cases**

```ts
// src/modules/interests/application/create-interest-rule.ts
import type { Principal } from "@/platform/auth/principal";
import { assertPermission } from "@/platform/auth/principal";
import type { Compounding, DayCount, InterestRule, PostingMode, UseCaseDeps } from "./ports";

export interface CreateInterestRuleInput {
  accountId: string;
  annualRate: string;
  taxRate: string;
  dayCount: DayCount;
  compounding?: Compounding;
  effectiveFrom: string;
  effectiveTo?: string | null;
  postingMode?: PostingMode;
  providerCategoryRef?: string | null;
  noteMarker?: string;
}

export function createInterestRule(deps: UseCaseDeps) {
  return async (principal: Principal, input: CreateInterestRuleInput): Promise<InterestRule> => {
    assertPermission(principal, "interests.write");
    const rule = await deps.rules.create({
      userId: principal.userId,
      accountId: input.accountId,
      annualRate: input.annualRate,
      taxRate: input.taxRate,
      dayCount: input.dayCount,
      compounding: input.compounding ?? "simple_daily",
      effectiveFrom: input.effectiveFrom,
      effectiveTo: input.effectiveTo ?? null,
      postingMode: input.postingMode ?? "analyze_only",
      providerCategoryRef: input.providerCategoryRef ?? null,
      noteMarker: input.noteMarker ?? "auto-interest",
    });
    await deps.audit({ actorUserId: principal.userId, action: "interests.rule_created", entityType: "interest_rule", entityId: rule.id, after: rule });
    return rule;
  };
}
```

```ts
// src/modules/interests/application/update-interest-rule.ts
import type { Principal } from "@/platform/auth/principal";
import { assertPermission } from "@/platform/auth/principal";
import type { InterestRule, InterestRulePatch, UseCaseDeps } from "./ports";
import { NotFoundError, VersionMismatchError } from "./errors";

export function updateInterestRule(deps: UseCaseDeps) {
  return async (principal: Principal, id: string, expectedVersion: number, patch: InterestRulePatch): Promise<InterestRule> => {
    assertPermission(principal, "interests.write");
    const result = await deps.rules.update(principal.userId, id, expectedVersion, patch);
    if (result === null) throw new NotFoundError();
    if (result === "version_mismatch") throw new VersionMismatchError();
    await deps.audit({ actorUserId: principal.userId, action: "interests.rule_updated", entityType: "interest_rule", entityId: id, after: patch });
    return result;
  };
}
```

```ts
// src/modules/interests/application/list-interest-rules.ts
import type { Principal } from "@/platform/auth/principal";
import { assertPermission } from "@/platform/auth/principal";
import type { InterestRule, UseCaseDeps } from "./ports";

export function listInterestRules(deps: UseCaseDeps) {
  return async (principal: Principal): Promise<InterestRule[]> => {
    assertPermission(principal, "interests.read");
    return deps.rules.list(principal.userId);
  };
}
```

- [ ] **Step 5: Run the tests**

Run: `npm test -- interests/application/rules`
Expected: PASS.

- [ ] **Step 6: Write the failing test for `runInterestAccrual`**

```ts
// src/modules/interests/application/run-interest-accrual.test.ts
import { describe, expect, it } from "vitest";
import { MemoryInterestAccrualsRepository, MemoryInterestEntriesRepository, MemoryInterestRulesRepository } from "../infrastructure/memory-repositories";
import { runInterestAccrual } from "./run-interest-accrual";

function harness(balance: string | null = "1000.00") {
  return {
    rules: new MemoryInterestRulesRepository(),
    accruals: new MemoryInterestAccrualsRepository(),
    entries: new MemoryInterestEntriesRepository(),
    balances: { latestBalanceAsOf: async () => balance },
    clock: { now: () => new Date("2026-09-05T00:00:00Z") },
    audit: async () => {},
  };
}

const rule = {
  id: "r1", userId: "u1", accountId: "acc-1", annualRate: "0.0225", taxRate: "0.26",
  dayCount: 365 as const, compounding: "simple_daily" as const, effectiveFrom: "2026-01-01",
  effectiveTo: null, postingMode: "analyze_only" as const, providerCategoryRef: null,
  noteMarker: "auto-interest", version: 1, createdAt: new Date(), updatedAt: new Date(),
};

describe("runInterestAccrual", () => {
  it("computes and stores today's accrual, carrying yesterday's remainder forward", async () => {
    const deps = harness();
    await deps.accruals.upsert({ ruleId: "r1", accrualDate: "2026-09-04", balanceBasis: "1000.00", gross: "0.061644", tax: "0.016027", net: "0.05", carryAfter: "-0.004617", source: "computed", postedAt: null, entryId: null });
    const result = await runInterestAccrual(deps)(rule, "2026-09-05");
    expect(result.accrued).toBe(true);
    const rows = await deps.accruals.forRule("r1", "2026-09-05", "2026-09-05");
    expect(rows).toHaveLength(1);
  });

  it("does nothing and never invents a balance when the account has none on file", async () => {
    const deps = harness(null);
    const result = await runInterestAccrual(deps)(rule, "2026-09-05");
    expect(result.accrued).toBe(false);
    expect(await deps.accruals.forRule("r1", "2026-09-05", "2026-09-05")).toHaveLength(0);
  });

  it("is idempotent: running twice for the same day produces one row, not two", async () => {
    const deps = harness();
    await runInterestAccrual(deps)(rule, "2026-09-05");
    await runInterestAccrual(deps)(rule, "2026-09-05");
    expect(await deps.accruals.forRule("r1", "2026-09-05", "2026-09-05")).toHaveLength(1);
  });

  it("skips a rule whose compounding is not simple_daily", async () => {
    const deps = harness();
    const result = await runInterestAccrual(deps)({ ...rule, compounding: "monthly" }, "2026-09-05");
    expect(result.accrued).toBe(false);
  });
});
```

- [ ] **Step 7: Run it and watch it fail**

Run: `npm test -- run-interest-accrual`
Expected: FAIL — `Cannot find module './run-interest-accrual'`.

- [ ] **Step 8: Implement `runInterestAccrual`**

```ts
// src/modules/interests/application/run-interest-accrual.ts
import { dailyInterest } from "../domain/accrual";
import type { InterestRule, UseCaseDeps } from "./ports";

function previousDay(dateStr: string): string {
  const d = new Date(`${dateStr}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() - 1);
  return d.toISOString().slice(0, 10);
}

export interface RunInterestAccrualResult {
  accrued: boolean;
}

/**
 * One rule, one day, idempotent via `accruals.upsert`'s conflict target.
 * Only `simple_daily` compounding over a fixed `dayCount` is computed in
 * Phase 3 (spec §7.6 reuses the legacy script's exact algorithm, which is
 * simple daily only) — a rule using another value is accepted by the schema
 * for forward compatibility but produces no accrual here. A missing account
 * balance produces no accrual either: never invent financial data.
 */
export function runInterestAccrual(deps: UseCaseDeps) {
  return async (rule: InterestRule, accrualDate: string): Promise<RunInterestAccrualResult> => {
    if (rule.compounding !== "simple_daily" || rule.dayCount === "actual") return { accrued: false };
    const balance = await deps.balances.latestBalanceAsOf(rule.userId, rule.accountId, accrualDate);
    if (balance === null) return { accrued: false };

    const prior = await deps.accruals.latestCarry(rule.id);
    // Only an unbroken daily chain's carry is trusted; a gap (a missed run, a
    // brand-new rule) restarts the sub-cent carry at zero rather than
    // guessing what happened on the missing days.
    const carry = prior && prior.accrualDate === previousDay(accrualDate) ? prior.carryAfter : "0";

    const computed = dailyInterest({ balance, annualRate: rule.annualRate, taxRate: rule.taxRate, dayCount: rule.dayCount, carry });
    await deps.accruals.upsert({
      ruleId: rule.id,
      accrualDate,
      balanceBasis: balance,
      gross: computed.gross,
      tax: computed.tax,
      net: computed.net,
      carryAfter: computed.carryAfter,
      source: "computed",
      postedAt: null,
      entryId: null,
    });
    await deps.audit({
      actorUserId: rule.userId,
      action: "interests.accrued",
      entityType: "interest_rule",
      entityId: rule.id,
      after: { accrualDate, net: computed.net },
    });
    return { accrued: true };
  };
}
```

- [ ] **Step 9: Run the tests**

Run: `npm test -- run-interest-accrual`
Expected: PASS.

- [ ] **Step 10: Write the failing test for `getInterestRuleDetail`**

```ts
// src/modules/interests/application/get-interest-rule-detail.test.ts
import { describe, expect, it } from "vitest";
import { testPrincipal } from "@/test/principal";
import { MemoryInterestAccrualsRepository, MemoryInterestEntriesRepository, MemoryInterestRulesRepository } from "../infrastructure/memory-repositories";
import { createInterestRule } from "./create-interest-rule";
import { getInterestRuleDetail } from "./get-interest-rule-detail";

function harness() {
  return {
    rules: new MemoryInterestRulesRepository(),
    accruals: new MemoryInterestAccrualsRepository(),
    entries: new MemoryInterestEntriesRepository(),
    balances: { latestBalanceAsOf: async () => "1000.00" },
    clock: { now: () => new Date("2026-09-05T00:00:00Z") },
    audit: async () => {},
  };
}

describe("getInterestRuleDetail", () => {
  it("combines the rule, its accruals, its entries, a reconciliation and a projection", async () => {
    const deps = harness();
    const rule = await createInterestRule(deps)(testPrincipal(), { accountId: "acc-1", annualRate: "0.0225", taxRate: "0.26", dayCount: 365, effectiveFrom: "2026-01-01" });
    await deps.accruals.upsert({ ruleId: rule.id, accrualDate: "2026-09-01", balanceBasis: "1000.00", gross: "0.061644", tax: "0.016027", net: "0.05", carryAfter: "-0.004617", source: "computed", postedAt: null, entryId: null });

    const detail = await getInterestRuleDetail(deps)(testPrincipal(), rule.id, { periodStart: "2026-09-01", periodEnd: "2026-09-30", projectionDays: 3 });
    expect(detail.accruals).toHaveLength(1);
    expect(detail.reconciliation.status).toBe("missing");
    expect(detail.projection).toHaveLength(3);
  });
});
```

- [ ] **Step 11: Run it and watch it fail**

Run: `npm test -- get-interest-rule-detail`
Expected: FAIL — `Cannot find module './get-interest-rule-detail'`.

- [ ] **Step 12: Implement `getInterestRuleDetail`**

```ts
// src/modules/interests/application/get-interest-rule-detail.ts
import type { Principal } from "@/platform/auth/principal";
import { assertPermission } from "@/platform/auth/principal";
import { projectInterest, type ProjectionPoint } from "../domain/accrual";
import { reconcileInterest, type ReconciliationSummary } from "../domain/reconciliation";
import type { InterestAccrual, InterestEntry, InterestRule, UseCaseDeps } from "./ports";
import { NotFoundError } from "./errors";

export interface InterestRuleDetail {
  rule: InterestRule;
  accruals: InterestAccrual[];
  entries: InterestEntry[];
  reconciliation: ReconciliationSummary;
  projection: ProjectionPoint[];
}

export function getInterestRuleDetail(deps: UseCaseDeps) {
  return async (
    principal: Principal,
    id: string,
    opts: { periodStart: string; periodEnd: string; projectionDays?: number },
  ): Promise<InterestRuleDetail> => {
    assertPermission(principal, "interests.read");
    const rule = await deps.rules.get(principal.userId, id);
    if (!rule) throw new NotFoundError();

    const accruals = await deps.accruals.forRule(rule.id, opts.periodStart, opts.periodEnd);
    const entries = await deps.entries.listForRule(rule.id);
    const paid = entries.filter((e) => e.kind === "paid").map((e) => ({ occurredAt: e.occurredAt, net: e.net }));
    const reconciliation = reconcileInterest(
      accruals.map((a) => ({ accrualDate: a.accrualDate, net: a.net })),
      paid,
      { start: opts.periodStart, end: opts.periodEnd },
    );

    const currentBalance = await deps.balances.latestBalanceAsOf(principal.userId, rule.accountId, opts.periodEnd);
    const projection =
      currentBalance !== null && rule.dayCount !== "actual"
        ? projectInterest(
            { balance: currentBalance, annualRate: rule.annualRate, taxRate: rule.taxRate, dayCount: rule.dayCount },
            new Date(`${opts.periodEnd}T00:00:00Z`),
            opts.projectionDays ?? 30,
          )
        : [];

    return { rule, accruals, entries, reconciliation, projection };
  };
}
```

- [ ] **Step 13: Run the tests**

Run: `npm test -- get-interest-rule-detail`
Expected: PASS.

- [ ] **Step 14: Typecheck and commit**

Run: `npx tsc --noEmit`
Expected: no errors.

```bash
git add src/platform/auth/permissions.ts src/modules/interests/application
git commit -m "feat(interests): add rule CRUD, accrual run and rule-detail use cases"
```

---

### Task 18: The daily interest accrual job

**Files:**
- Modify: `src/lib/contracts.ts` (`JobName` gains `"interest_accrual"`)
- Create: `src/lib/jobs/interest-accrual.ts`
- Create: `src/lib/jobs/interest-accrual.itest.ts`
- Modify: `src/platform/jobs/register-all.ts`

**Interfaces:**
- Consumes: `interestDeps` from `@/modules/interests/infrastructure/deps` (Task 16); `runInterestAccrual` from `@/modules/interests/application/run-interest-accrual` (Task 17); `withUserContext`, `withSystemContext` from `@/platform/db/context`; `startRun`, `finishRun`, `withJobLock` from `@/lib/repo/jobs`; `romeDate` from `@/lib/time`; `registerJob` from `@/platform/jobs/registry`.
- Produces:
```ts
// src/lib/contracts.ts
export type JobName = "payslip_ingest" | "sweep" | "wallet_refresh" | "trek_sync" | "monthly_close" | "wallet_accounts_sync" | "sync_queue" | "interest_accrual"; // was missing "interest_accrual"

export const JOB_NAME = "interest_accrual" as const;
export interface RunInterestAccrualJobInput { trigger: "cron" | "manual"; now: Date; }
export async function runInterestAccrualJob(input: RunInterestAccrualJobInput): Promise<JobResult>;
```
- Registers on the `daily` tier in `src/platform/jobs/register-all.ts`'s `ensureJobsRegistered()` — the one call site for the new export.

Ruling: unlike `monthly-close.ts` (one owner, per the Phase 0/1-era single-user assumption still baked into that job), this job iterates **every user who has an active rule** — `InterestRulesRepository.listActiveForAllUsers` (Task 15/16) is read once under `withSystemContext` (RLS's `app_is_system()` bypass), then each rule's actual accrual runs inside its own `withUserContext` for that rule's `userId`. One rule's failure is caught and logged per-rule (Phase 2 ledger's "a loop over many owners needs per-item error isolation" lesson) rather than aborting the whole run.

- [ ] **Step 1: Add the job name**

In `src/lib/contracts.ts`:
```ts
export type JobName =
  | "payslip_ingest"
  | "sweep"
  | "wallet_refresh"
  | "trek_sync"
  | "monthly_close"
  | "wallet_accounts_sync"
  | "sync_queue"
  | "interest_accrual";
```

- [ ] **Step 2: Write the failing integration test**

```ts
// src/lib/jobs/interest-accrual.itest.ts
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { accounts, accountBalances, organizations, users } from "@/lib/db/schema";
import { withSystemContext } from "@/platform/db/context";
import { closeDb, resetDb, testDb } from "@/test/db";
import { DrizzleInterestRulesRepository } from "@/modules/interests/infrastructure/drizzle-interest-rules-repository";
import { DrizzleInterestAccrualsRepository } from "@/modules/interests/infrastructure/drizzle-interest-accruals-repository";
import { runInterestAccrualJob } from "./interest-accrual";

describe("runInterestAccrualJob", () => {
  beforeEach(resetDb);
  afterAll(closeDb);

  it("accrues today for every user with an active rule and a recorded balance", async () => {
    const db = await testDb();
    const [org] = await db.insert(organizations).values({ name: "P" }).returning();
    const [user] = await db.insert(users).values({ organizationId: org!.id, displayName: "A" }).returning();
    const [account] = await db.insert(accounts).values({ userId: user!.id, name: "Savings", type: "savings", origin: "manual" }).returning();
    await db.insert(accountBalances).values({ accountId: account!.id, asOf: "2026-09-05", balance: "1000.00", source: "manual" });
    await withSystemContext(db, (tx) =>
      new DrizzleInterestRulesRepository(tx).create({
        userId: user!.id, accountId: account!.id, annualRate: "0.0225", taxRate: "0.26", dayCount: 365,
        compounding: "simple_daily", effectiveFrom: "2026-01-01", effectiveTo: null,
        postingMode: "analyze_only", providerCategoryRef: null, noteMarker: "auto-interest",
      }),
    );

    const result = await runInterestAccrualJob({ trigger: "manual", now: new Date("2026-09-05T12:00:00Z") });
    expect(result.status).toBe("success");
    expect(result.detail).toMatchObject({ rulesConsidered: 1, accrued: 1, failed: 0 });

    const [rule] = await withSystemContext(db, (tx) => new DrizzleInterestRulesRepository(tx).list(user!.id));
    const accrued = await withSystemContext(db, (tx) => new DrizzleInterestAccrualsRepository(tx).forRule(rule!.id, "2026-09-05", "2026-09-05"));
    expect(accrued).toHaveLength(1);
    expect(accrued[0]!.net).not.toBe("0.00");
  });

  it("running the job twice for the same day does not duplicate the accrual", async () => {
    const db = await testDb();
    const [org] = await db.insert(organizations).values({ name: "P" }).returning();
    const [user] = await db.insert(users).values({ organizationId: org!.id, displayName: "A" }).returning();
    const [account] = await db.insert(accounts).values({ userId: user!.id, name: "Savings", type: "savings", origin: "manual" }).returning();
    await db.insert(accountBalances).values({ accountId: account!.id, asOf: "2026-09-05", balance: "1000.00", source: "manual" });
    await withSystemContext(db, (tx) =>
      new DrizzleInterestRulesRepository(tx).create({
        userId: user!.id, accountId: account!.id, annualRate: "0.0225", taxRate: "0.26", dayCount: 365,
        compounding: "simple_daily", effectiveFrom: "2026-01-01", effectiveTo: null,
        postingMode: "analyze_only", providerCategoryRef: null, noteMarker: "auto-interest",
      }),
    );
    await runInterestAccrualJob({ trigger: "manual", now: new Date("2026-09-05T12:00:00Z") });
    await runInterestAccrualJob({ trigger: "manual", now: new Date("2026-09-05T18:00:00Z") });
    const [rule] = await withSystemContext(db, (tx) => new DrizzleInterestRulesRepository(tx).list(user!.id));
    const accrued = await withSystemContext(db, (tx) => new DrizzleInterestAccrualsRepository(tx).forRule(rule!.id, "2026-09-05", "2026-09-05"));
    expect(accrued).toHaveLength(1);
  });
});
```

- [ ] **Step 3: Run it and watch it fail**

Run: `npm run test:integration -- interest-accrual`
Expected: FAIL — `Cannot find module './interest-accrual'`.

- [ ] **Step 4: Implement the job**

```ts
// src/lib/jobs/interest-accrual.ts
/**
 * Daily interest accrual, in the shape of `monthly-close.ts` — passive,
 * idempotent, one `job_runs` row per tick — but iterating every user with an
 * active rule rather than a single owner, since interest rules are per-user
 * from the start (unlike the accounts module's Phase-1-era single-owner
 * jobs).
 */
import { alertJobFailure } from "@/lib/clients/gotify";
import { errorMessage } from "@/lib/clients/http";
import type { JobResult } from "@/lib/contracts";
import { db } from "@/lib/db";
import { romeDate } from "@/lib/time";
import { finishRun, startRun, withJobLock } from "@/lib/repo/jobs";
import { withSystemContext, withUserContext } from "@/platform/db/context";
import { runInterestAccrual } from "@/modules/interests/application/run-interest-accrual";
import type { InterestRule } from "@/modules/interests/application/ports";
import { interestDeps } from "@/modules/interests/infrastructure/deps";

export const JOB_NAME = "interest_accrual" as const;
export const LOCK_KEY = JOB_NAME;

export interface RunInterestAccrualJobInput {
  trigger: "cron" | "manual";
  now: Date;
}

async function activeRules(asOf: string): Promise<InterestRule[]> {
  return withSystemContext(db, (tx) => interestDeps(tx).rules.listActiveForAllUsers(asOf));
}

async function accrueRule(rule: InterestRule, accrualDate: string): Promise<{ accrued: boolean }> {
  return withUserContext(db, { userId: rule.userId, role: "system" }, (tx) => runInterestAccrual(interestDeps(tx))(rule, accrualDate));
}

/**
 * Never throws past this function. Every path ends in a `job_runs` row and a
 * `JobResult`. One rule's failure is caught and logged per-rule so it cannot
 * jam every other user's accrual for the day.
 */
export async function runInterestAccrualJob(input: RunInterestAccrualJobInput): Promise<JobResult> {
  const run = await startRun({ jobName: JOB_NAME, trigger: input.trigger });
  try {
    const asOf = romeDate(input.now);
    const rules = await activeRules(asOf);
    let accrued = 0;
    let failed = 0;
    for (const rule of rules) {
      try {
        const outcome = await withJobLock(`${LOCK_KEY}:${rule.id}`, () => accrueRule(rule, asOf));
        if (outcome?.accrued) accrued += 1;
      } catch (err) {
        failed += 1;
        console.error(
          JSON.stringify({ level: "error", event: "interest_accrual_rule_failed", ruleId: rule.id, error: errorMessage(err) }),
        );
      }
    }
    const detail = { rulesConsidered: rules.length, accrued, failed };
    await finishRun(run.id, "success", { detail });
    return { job: JOB_NAME, status: "success", detail };
  } catch (err) {
    const error = errorMessage(err);
    await finishRun(run.id, "failed", { error });
    await alertJobFailure({ job: JOB_NAME, error });
    return { job: JOB_NAME, status: "failed", error };
  }
}
```

- [ ] **Step 5: Register the job**

In `src/platform/jobs/register-all.ts`:
```ts
import { runInterestAccrualJob } from "@/lib/jobs/interest-accrual";
// ...
registerJob({ name: "interest_accrual", tier: "daily", run: (i) => runInterestAccrualJob({ trigger: i.trigger, now: i.now }) });
```

- [ ] **Step 6: Run the tests**

Run: `npm run test:integration -- interest-accrual`
Expected: PASS.

- [ ] **Step 7: Typecheck and commit**

Run: `npx tsc --noEmit`
Expected: no errors.

```bash
git add src/lib/contracts.ts src/lib/jobs/interest-accrual.ts src/lib/jobs/interest-accrual.itest.ts src/platform/jobs/register-all.ts
git commit -m "feat(interests): add the daily interest accrual job"
```

---

### Task 19: The optional posting adapter and the wallet-manager cut-over document

**Files:**
- Create: `src/modules/interests/application/post-interest-entry.ts`
- Create: `src/modules/interests/application/post-interest-entry.test.ts`
- Create: `src/modules/interests/infrastructure/wallet-interest-posting-adapter.ts`
- Create: `src/modules/interests/infrastructure/wallet-interest-posting-adapter.test.ts`
- Modify: `src/lib/jobs/interest-accrual.ts` (wires posting in after a successful accrual)
- Modify: `src/lib/jobs/interest-accrual.itest.ts` (one posting-mode test)
- Create: `docs/migration/wallet-manager-cutover.md`

**Interfaces:**
- Consumes: `InterestRule`, `InterestAccrual`, `UseCaseDeps` from `../application/ports` (Task 15); `getCategories`, `postRecords` from `@/lib/clients/wallet` (Task 6); `accountDeps` from `@/modules/accounts/infrastructure/deps` (existing, reused for `.links.liveFor`); `integrationDeps` from `@/modules/integrations/infrastructure/deps` (existing); `openConnection` from `@/modules/integrations/application/open-connection` (existing, returns `{ connection, credentials } | null`).
- Produces:
```ts
export function shouldPost(rule: InterestRule, accrual: InterestAccrual): boolean;
export function recordPostedEntry(deps: UseCaseDeps): (rule: InterestRule, accrual: InterestAccrual, postedNote: string) => Promise<InterestEntry>;

export interface PostWalletInterestInput { token: string; walletAccountId: string; rule: InterestRule; accrual: InterestAccrual; }
export async function postWalletInterestEntry(input: PostWalletInterestInput): Promise<{ note: string }>;
```
- Modifies `accrueRule` in `src/lib/jobs/interest-accrual.ts` (Task 18) to call a new `tryPost` helper after a successful accrual, and folds a `posted` count into the job's `detail`.

Ruling (spec §13.2, adopted as-is): **the dashboard only analyses interest in Phase 3.** Posting to the provider is opt-in per rule (`postingMode: "post_to_provider"`, default `"analyze_only"`), and even then, posting happens only when: the account is a currently-live synced Wallet account (`ProviderLinksRepository.liveFor` finds no missing link), the Wallet connection is `connected`, and the computed net amount is greater than zero (matching `interest.py`'s own "never post a zero" rule). Nothing in this task changes that default; it only makes the switch functional for whoever flips it. The Wallet network call happens with no transaction open — the job reads what it needs (the accrual row, the account's provider link, the opened connection) in short, sequential, never-nested transactions first, calls the provider, then writes the result in one final short transaction — exactly the fetch/apply split every other provider call in this codebase already follows.

- [ ] **Step 1: Write the failing test for `shouldPost` and `recordPostedEntry`**

```ts
// src/modules/interests/application/post-interest-entry.test.ts
import { describe, expect, it } from "vitest";
import { MemoryInterestAccrualsRepository, MemoryInterestEntriesRepository, MemoryInterestRulesRepository } from "../infrastructure/memory-repositories";
import { recordPostedEntry, shouldPost } from "./post-interest-entry";
import type { InterestAccrual, InterestRule } from "./ports";

const rule: InterestRule = {
  id: "r1", userId: "u1", accountId: "acc-1", annualRate: "0.0225", taxRate: "0.26",
  dayCount: 365, compounding: "simple_daily", effectiveFrom: "2026-01-01", effectiveTo: null,
  postingMode: "post_to_provider", providerCategoryRef: null, noteMarker: "auto-interest",
  version: 1, createdAt: new Date(), updatedAt: new Date(),
};

const accrual: InterestAccrual = {
  id: "a1", ruleId: "r1", accrualDate: "2026-09-05", balanceBasis: "1000.00",
  gross: "0.061644", tax: "0.016027", net: "0.05", carryAfter: "-0.000617",
  source: "computed", postedAt: null, entryId: null,
};

describe("shouldPost", () => {
  it("is true only when posting is enabled, nothing has posted yet, and the net amount is positive", () => {
    expect(shouldPost(rule, accrual)).toBe(true);
    expect(shouldPost({ ...rule, postingMode: "analyze_only" }, accrual)).toBe(false);
    expect(shouldPost(rule, { ...accrual, postedAt: new Date() })).toBe(false);
    expect(shouldPost(rule, { ...accrual, net: "0.00" })).toBe(false);
  });
});

describe("recordPostedEntry", () => {
  it("creates a paid entry and marks the accrual posted", async () => {
    const deps = {
      rules: new MemoryInterestRulesRepository(),
      accruals: new MemoryInterestAccrualsRepository(),
      entries: new MemoryInterestEntriesRepository(),
      balances: { latestBalanceAsOf: async () => null },
      clock: { now: () => new Date("2026-09-05T09:00:00Z") },
      audit: async () => {},
    };
    await deps.accruals.upsert(accrual);
    const entry = await recordPostedEntry(deps)(rule, accrual, "auto-interest 2.25%/y (net 1.67%, -26% tax) on 1000.00");
    expect(entry.kind).toBe("paid");
    expect(await deps.entries.listForRule("r1", "paid")).toHaveLength(1);
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `npm test -- post-interest-entry`
Expected: FAIL — `Cannot find module './post-interest-entry'`.

- [ ] **Step 3: Implement `shouldPost` and `recordPostedEntry`**

```ts
// src/modules/interests/application/post-interest-entry.ts
import type { InterestAccrual, InterestEntry, InterestRule, UseCaseDeps } from "./ports";

/** The rule's own switch, our own ledger as the idempotency source of truth, and the legacy script's "never post a zero" rule — all three, not just one. */
export function shouldPost(rule: InterestRule, accrual: InterestAccrual): boolean {
  return rule.postingMode === "post_to_provider" && accrual.postedAt === null && Number(accrual.net) > 0;
}

export function recordPostedEntry(deps: UseCaseDeps) {
  return async (rule: InterestRule, accrual: InterestAccrual, postedNote: string): Promise<InterestEntry> => {
    const entry = await deps.entries.create({
      userId: rule.userId,
      accountId: rule.accountId,
      occurredAt: new Date(`${accrual.accrualDate}T00:00:00Z`),
      gross: Number(accrual.gross).toFixed(2),
      net: accrual.net,
      kind: "paid",
      transactionId: null,
      ruleId: rule.id,
      source: "provider",
    });
    await deps.accruals.markPosted(accrual.id, entry.id, deps.clock.now());
    await deps.audit({
      actorUserId: rule.userId,
      action: "interests.posted",
      entityType: "interest_rule",
      entityId: rule.id,
      after: { accrualDate: accrual.accrualDate, net: accrual.net, note: postedNote },
    });
    return entry;
  };
}
```

- [ ] **Step 4: Run it and watch it pass**

Run: `npm test -- post-interest-entry`
Expected: PASS.

- [ ] **Step 5: Write the failing test for the Wallet posting adapter**

```ts
// src/modules/interests/infrastructure/wallet-interest-posting-adapter.test.ts
import { describe, expect, it, vi } from "vitest";
import { postWalletInterestEntry } from "./wallet-interest-posting-adapter";
import type { InterestAccrual, InterestRule } from "../application/ports";

const postRecordsMock = vi.fn(async () => {});
vi.mock("@/lib/clients/wallet", () => ({
  getCategories: vi.fn(async () => [{ id: "c1", name: "Interest, dividends", group: "Income" }]),
  postRecords: (...args: unknown[]) => postRecordsMock(...args),
}));

const rule: InterestRule = {
  id: "r1", userId: "u1", accountId: "acc-1", annualRate: "0.0225", taxRate: "0.26",
  dayCount: 365, compounding: "simple_daily", effectiveFrom: "2026-01-01", effectiveTo: null,
  postingMode: "post_to_provider", providerCategoryRef: null, noteMarker: "auto-interest",
  version: 1, createdAt: new Date(), updatedAt: new Date(),
};

const accrual: InterestAccrual = {
  id: "a1", ruleId: "r1", accrualDate: "2026-09-05", balanceBasis: "1000.00",
  gross: "0.061644", tax: "0.016027", net: "0.05", carryAfter: "-0.000617",
  source: "computed", postedAt: null, entryId: null,
};

describe("postWalletInterestEntry", () => {
  it("posts against the resolved Wallet account id with the matched category and the legacy note format", async () => {
    const result = await postWalletInterestEntry({ token: "t", walletAccountId: "w1", rule, accrual });
    expect(result.note).toContain("auto-interest 2.25%/y (net 1.67%, -26% tax) on 1000.00");
    expect(postRecordsMock).toHaveBeenCalledWith(
      { token: "t" },
      [{ accountId: "w1", amount: 0.05, recordDate: "2026-09-05T00:00:00Z", note: result.note, categoryId: "c1" }],
    );
  });

  it("posts uncategorised, not failing, when the named category is not found", async () => {
    const result = await postWalletInterestEntry({ token: "t", walletAccountId: "w1", rule: { ...rule, providerCategoryRef: "Nonexistent" }, accrual });
    expect(result.note).toBeTruthy();
    const [, records] = postRecordsMock.mock.calls.at(-1)!;
    expect((records as { categoryId?: string }[])[0]!.categoryId).toBeUndefined();
  });
});
```

- [ ] **Step 6: Run it and watch it fail**

Run: `npm test -- wallet-interest-posting-adapter`
Expected: FAIL — `Cannot find module './wallet-interest-posting-adapter'`.

- [ ] **Step 7: Implement the posting adapter**

```ts
// src/modules/interests/infrastructure/wallet-interest-posting-adapter.ts
import { getCategories, postRecords } from "@/lib/clients/wallet";
import type { InterestAccrual, InterestRule } from "../application/ports";

export const WALLET_PROVIDER = "wallet";

export interface PostWalletInterestInput {
  token: string;
  walletAccountId: string;
  rule: InterestRule;
  accrual: InterestAccrual;
}

/**
 * Reuses `interest.py`'s exact note format and its "post uncategorised
 * rather than fail" behavior when the named category is not found
 * (`Wallet Manager/app/interest.py:163-164`). The only file in this task
 * that names a Wallet field.
 */
export async function postWalletInterestEntry(input: PostWalletInterestInput): Promise<{ note: string }> {
  const categories = await getCategories({ token: input.token });
  const wanted = (input.rule.providerCategoryRef ?? "Interest, dividends").trim().toLowerCase();
  const category = categories.find((c) => c.name.trim().toLowerCase() === wanted);

  const ratePct = (Number(input.rule.annualRate) * 100).toFixed(2);
  const netRatePct = (Number(input.rule.annualRate) * (1 - Number(input.rule.taxRate)) * 100).toFixed(2);
  const taxPct = (Number(input.rule.taxRate) * 100).toFixed(0);
  const note = `${input.rule.noteMarker} ${ratePct}%/y (net ${netRatePct}%, -${taxPct}% tax) on ${input.accrual.balanceBasis}`;

  await postRecords({ token: input.token }, [
    {
      accountId: input.walletAccountId,
      amount: Number(input.accrual.net),
      recordDate: `${input.accrual.accrualDate}T00:00:00Z`,
      note,
      ...(category ? { categoryId: category.id } : {}),
    },
  ]);
  return { note };
}
```

- [ ] **Step 8: Run it and watch it pass**

Run: `npm test -- wallet-interest-posting-adapter`
Expected: PASS.

- [ ] **Step 9: Wire posting into the job**

In `src/lib/jobs/interest-accrual.ts`, add the imports and a `tryPost` helper, then change `accrueRule` and the job's detail:

```ts
import { accountDeps } from "@/modules/accounts/infrastructure/deps";
import { integrationDeps } from "@/modules/integrations/infrastructure/deps";
import { openConnection } from "@/modules/integrations/application/open-connection";
import { recordPostedEntry, shouldPost } from "@/modules/interests/application/post-interest-entry";
import { postWalletInterestEntry } from "@/modules/interests/infrastructure/wallet-interest-posting-adapter";

/**
 * Every read here is its own short transaction, sequential and never nested;
 * the Wallet call itself runs with none of them open.
 */
async function tryPost(rule: InterestRule, accrualDate: string): Promise<boolean> {
  const [accrual] = await withUserContext(db, { userId: rule.userId, role: "system" }, (tx) =>
    interestDeps(tx).accruals.forRule(rule.id, accrualDate, accrualDate),
  );
  if (!accrual || !shouldPost(rule, accrual)) return false;

  const link = await withUserContext(db, { userId: rule.userId, role: "system" }, (tx) => accountDeps(tx).links.liveFor("account", rule.accountId));
  if (!link) return false; // not a currently-live synced Wallet account: analyse only

  const opened = await openConnection(integrationDeps(db))(rule.userId, "wallet");
  if (!opened) return false; // Wallet not connected: analyse only

  const posted = await postWalletInterestEntry({ token: opened.credentials.token!, walletAccountId: link.externalId, rule, accrual });

  await withUserContext(db, { userId: rule.userId, role: "system" }, (tx) => recordPostedEntry(interestDeps(tx))(rule, accrual, posted.note));
  return true;
}

async function accrueRule(rule: InterestRule, accrualDate: string): Promise<{ accrued: boolean; posted: boolean }> {
  const result = await withUserContext(db, { userId: rule.userId, role: "system" }, (tx) => runInterestAccrual(interestDeps(tx))(rule, accrualDate));
  if (!result.accrued) return { accrued: false, posted: false };
  const posted = await tryPost(rule, accrualDate);
  return { accrued: true, posted };
}
```

Then in `runInterestAccrualJob`'s loop, add a `posted` counter alongside `accrued`/`failed` and fold it into `detail`.

- [ ] **Step 10: Add one posting-mode integration test**

Add to `src/lib/jobs/interest-accrual.itest.ts`:
```ts
it("does not post when the rule's postingMode is post_to_provider but the account has no live Wallet link", async () => {
  const db = await testDb();
  const [org] = await db.insert(organizations).values({ name: "P" }).returning();
  const [user] = await db.insert(users).values({ organizationId: org!.id, displayName: "A" }).returning();
  const [account] = await db.insert(accounts).values({ userId: user!.id, name: "Savings", type: "savings", origin: "manual" }).returning();
  await db.insert(accountBalances).values({ accountId: account!.id, asOf: "2026-09-05", balance: "1000.00", source: "manual" });
  await withSystemContext(db, (tx) =>
    new DrizzleInterestRulesRepository(tx).create({
      userId: user!.id, accountId: account!.id, annualRate: "0.0225", taxRate: "0.26", dayCount: 365,
      compounding: "simple_daily", effectiveFrom: "2026-01-01", effectiveTo: null,
      postingMode: "post_to_provider", providerCategoryRef: null, noteMarker: "auto-interest",
    }),
  );
  const result = await runInterestAccrualJob({ trigger: "manual", now: new Date("2026-09-05T12:00:00Z") });
  expect(result.detail).toMatchObject({ accrued: 1, posted: 0 });
});
```
This account is a manual account with no `provider_links` row at all, so `accountDeps(tx).links.liveFor("account", ...)` returns `null` and posting is skipped without ever reaching the Wallet client — no mock is needed for this test.

- [ ] **Step 11: Run the job tests**

Run: `npm run test:integration -- interest-accrual`
Expected: PASS.

- [ ] **Step 12: Write the wallet-manager cut-over document**

```markdown
// docs/migration/wallet-manager-cutover.md
# Retiring the standalone `wallet-manager` interest container

The dashboard's interest module (Phase 3) can now compute the same daily
accrual the standalone `interest.py` container in `Wallet Manager/` computes,
and — per a rule's `postingMode` — can post it to Wallet itself. This is the
procedure for moving from the standalone container to the dashboard without a
day of double-posted or missed interest.

**Default state after Phase 3 ships: nothing changes.** Every interest rule
defaults to `postingMode: "analyze_only"`; the standalone container keeps
posting exactly as it does today until an operator deliberately flips a rule.

## Steps

1. **Create a dashboard rule matching the container's `.env` today**, using
   the create-rule form on the Interests list page (`/finance/interests` —
   there is no separate "new rule" route): the same account, `ANNUAL_RATE`,
   tax rate (from `TAX_RATE`/`WALLET_TAX_RATE`), and day count (`DAY_COUNT`,
   almost always `365`). Leave `postingMode` at its default, `analyze_only`.
2. **Let both run in parallel for at least a week.** The dashboard's daily job
   computes and stores an accrual every day; the container keeps posting to
   Wallet as before. Compare the dashboard's `Finance › Interests › Rules ›
   [id]` reconciliation view against the container's own posted records for
   the same days — the two should agree to the cent, since both implement the
   same ACT/365 simple-daily formula.
3. **Once satisfied, stop the `wallet-manager` container** (`docker compose
   -f <path-to-Wallet-Manager-compose> stop interest` or equivalent) —
   stopping it before flipping the dashboard's switch guarantees no day is
   ever posted twice.
4. **Flip the rule's `postingMode` to `post_to_provider`** in the dashboard.
   From the next daily run onward, the dashboard posts the accrual itself,
   using the same note-marker convention (`auto-interest` by default,
   configurable per rule) so the record looks the same in the Wallet app.
5. **Monitor for a few more days.** `Finance › Interests › Rules › [id]`
   shows each day's accrual and whether it posted; `job_runs` (Settings ›
   Administration) shows the job's own success/failure history.
6. **Decommission the container** once confident: remove its compose service,
   its `.env`, and its `data/state.json` volume. The dashboard's own ledger
   (`interest_accruals`, `interest_entries`) is now the sole record — nothing
   in the container's `state.json` needs to be migrated, since the dashboard
   never reads it.

## Rollback

Flip the rule back to `postingMode: "analyze_only"` and restart the
`wallet-manager` container. The two never ran with posting enabled on both
sides at once (step 3 stops the container before step 4 enables posting), so
there is no double-posted day to reconcile away — restarting the container
resumes exactly where the dashboard's `analyze_only` rule leaves off, at the
next un-posted day.
```

- [ ] **Step 13: Typecheck and commit**

Run: `npx tsc --noEmit`
Expected: no errors.

```bash
git add src/modules/interests/application/post-interest-entry.ts src/modules/interests/application/post-interest-entry.test.ts src/modules/interests/infrastructure/wallet-interest-posting-adapter.ts src/modules/interests/infrastructure/wallet-interest-posting-adapter.test.ts src/lib/jobs/interest-accrual.ts src/lib/jobs/interest-accrual.itest.ts docs/migration/wallet-manager-cutover.md
git commit -m "feat(interests): add the optional per-rule posting adapter and the wallet-manager cut-over doc"
```

---

### Task 20: Interests REST API

**Files:**
- Create: `src/modules/interests/api/schemas.ts`
- Create: `src/modules/interests/api/routes.ts`
- Create: `src/modules/interests/api/routes.itest.ts`
- Modify: `src/platform/http/app.ts` (register the new routes)
- Regenerate: `docs/api/openapi.json`

**Interfaces:**
- Consumes: `createInterestRule`, `updateInterestRule`, `listInterestRules`, `getInterestRuleDetail` from `../application/*` (Task 17); `interestDeps` from `../infrastructure/deps` (Task 16); `NotFoundError`, `VersionMismatchError` from `../application/errors` (Task 15); `ErrorResponseSchema` from `@/modules/accounts/api/schemas` (existing — the app's one shared copy, imported rather than redeclared; see the corrected Ruling P3-11).
- Produces:
```ts
export function registerInterestRoutes(app: ApiApp, deps: ApiDeps): void;
// Routes: GET /interest-rules, POST /interest-rules, GET /interest-rules/{id}, PATCH /interest-rules/{id}
```
- Modifies `registerAllRoutes` in `src/platform/http/app.ts` to also call `registerInterestRoutes(app, deps)`.

- [ ] **Step 1: Write the failing integration test**

```ts
// src/modules/interests/api/routes.itest.ts
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { accounts, organizations, users } from "@/lib/db/schema";
import { db } from "@/lib/db";
import { createApiApp } from "@/platform/http/app";
import { permissionsForRoles } from "@/platform/auth/permissions";
import { closeDb, resetDb, testDb } from "@/test/db";

async function seedUser() {
  const testdb = await testDb();
  const [org] = await testdb.insert(organizations).values({ name: "P" }).returning();
  const [user] = await testdb.insert(users).values({ organizationId: org!.id, displayName: "A" }).returning();
  const [account] = await testdb.insert(accounts).values({ userId: user!.id, name: "Savings", type: "savings", origin: "manual" }).returning();
  return { userId: user!.id, organizationId: org!.id, accountId: account!.id };
}

function appFor(userId: string, organizationId: string) {
  return createApiApp({
    db,
    now: () => new Date("2026-09-05T09:00:00Z"),
    rateLimitEnabled: false,
    authenticate: async () => ({ principal: { userId, organizationId, roles: ["owner"], permissions: permissionsForRoles(["owner"]) }, method: "session" }),
  });
}

describe("interests API", () => {
  beforeEach(resetDb);
  afterAll(closeDb);

  it("creates a rule defaulting to analyze_only, then reads it back with a reconciliation and a projection", async () => {
    const { userId, organizationId, accountId } = await seedUser();
    const app = appFor(userId, organizationId);
    const createRes = await app.request("/api/v1/interest-rules", {
      method: "POST",
      headers: { "x-requested-with": "test", "content-type": "application/json" },
      body: JSON.stringify({ accountId, annualRate: "0.0225", taxRate: "0.26", dayCount: 365, effectiveFrom: "2026-01-01" }),
    });
    expect(createRes.status).toBe(200);
    const created = (await createRes.json()) as { id: string; postingMode: string };
    expect(created.postingMode).toBe("analyze_only");

    const getRes = await app.request(`/api/v1/interest-rules/${created.id}?periodStart=2026-09-01&periodEnd=2026-09-30&projectionDays=5`, {
      headers: { "x-requested-with": "test" },
    });
    expect(getRes.status).toBe(200);
    const detail = (await getRes.json()) as { reconciliation: { status: string }; projection: unknown[] };
    expect(detail.reconciliation.status).toBe("missing");
    expect(detail.projection).toHaveLength(5);
  });

  it("rejects a PATCH with a stale version as 409 version_mismatch", async () => {
    const { userId, organizationId, accountId } = await seedUser();
    const app = appFor(userId, organizationId);
    const createRes = await app.request("/api/v1/interest-rules", {
      method: "POST",
      headers: { "x-requested-with": "test", "content-type": "application/json" },
      body: JSON.stringify({ accountId, annualRate: "0.0225", taxRate: "0.26", dayCount: 365, effectiveFrom: "2026-01-01" }),
    });
    const created = (await createRes.json()) as { id: string; version: number };
    const patchRes = await app.request(`/api/v1/interest-rules/${created.id}`, {
      method: "PATCH",
      headers: { "x-requested-with": "test", "content-type": "application/json", "if-match": String(created.version + 1) },
      body: JSON.stringify({ annualRate: "0.03" }),
    });
    expect(patchRes.status).toBe(409);
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `npm run test:integration -- interests/api/routes`
Expected: FAIL — `404 not_found` (route not registered).

- [ ] **Step 3: Write the Zod schemas**

```ts
// src/modules/interests/api/schemas.ts
import { z } from "@hono/zod-openapi";

export const DayCountSchema = z.union([z.literal(360), z.literal(365), z.literal("actual")]).openapi("DayCount");
export const CompoundingSchema = z.enum(["simple_daily", "monthly", "none"]).openapi("Compounding");
export const PostingModeSchema = z.enum(["analyze_only", "post_to_provider"]).openapi("PostingMode");

export const InterestRuleSchema = z
  .object({
    id: z.string().uuid(),
    accountId: z.string().uuid(),
    annualRate: z.string(),
    taxRate: z.string(),
    dayCount: DayCountSchema,
    compounding: CompoundingSchema,
    effectiveFrom: z.string(),
    effectiveTo: z.string().nullable(),
    postingMode: PostingModeSchema,
    providerCategoryRef: z.string().nullable(),
    noteMarker: z.string(),
    version: z.number(),
    createdAt: z.string(),
    updatedAt: z.string(),
  })
  .openapi("InterestRule");

export const InterestAccrualSchema = z
  .object({
    id: z.string().uuid(),
    accrualDate: z.string(),
    balanceBasis: z.string(),
    gross: z.string(),
    tax: z.string(),
    net: z.string(),
    carryAfter: z.string(),
    postedAt: z.string().nullable(),
  })
  .openapi("InterestAccrual");

export const InterestEntrySchema = z
  .object({
    id: z.string().uuid(),
    occurredAt: z.string(),
    gross: z.string(),
    net: z.string(),
    kind: z.enum(["paid", "projected", "adjustment"]),
    source: z.enum(["computed", "provider", "manual"]),
  })
  .openapi("InterestEntry");

export const ReconciliationSummarySchema = z
  .object({
    periodStart: z.string(),
    periodEnd: z.string(),
    accruedTotal: z.string(),
    paidTotal: z.string(),
    status: z.enum(["matched", "missing", "delayed", "anomalous"]),
    differenceCents: z.number(),
  })
  .openapi("ReconciliationSummary");

export const ProjectionPointSchema = z.object({ date: z.string(), net: z.string(), cumulativeNet: z.string() }).openapi("ProjectionPoint");

export const InterestRuleDetailSchema = InterestRuleSchema.extend({
  accruals: z.array(InterestAccrualSchema),
  entries: z.array(InterestEntrySchema),
  reconciliation: ReconciliationSummarySchema,
  projection: z.array(ProjectionPointSchema),
}).openapi("InterestRuleDetail");

export const InterestRuleListResponseSchema = z.object({ items: z.array(InterestRuleSchema) }).openapi("InterestRuleListResponse");

export const CreateInterestRuleRequestSchema = z.object({
  accountId: z.string().uuid(),
  annualRate: z.string(),
  taxRate: z.string(),
  dayCount: DayCountSchema,
  compounding: CompoundingSchema.optional(),
  effectiveFrom: z.string(),
  effectiveTo: z.string().nullable().optional(),
  postingMode: PostingModeSchema.optional(),
  providerCategoryRef: z.string().nullable().optional(),
  noteMarker: z.string().optional(),
});

export const UpdateInterestRuleRequestSchema = z.object({
  annualRate: z.string().optional(),
  taxRate: z.string().optional(),
  dayCount: DayCountSchema.optional(),
  compounding: CompoundingSchema.optional(),
  effectiveTo: z.string().nullable().optional(),
  postingMode: PostingModeSchema.optional(),
  providerCategoryRef: z.string().nullable().optional(),
  noteMarker: z.string().optional(),
  version: z.number().int().optional(),
});

export const GetRuleDetailQuerySchema = z.object({
  periodStart: z.string(),
  periodEnd: z.string(),
  projectionDays: z.coerce.number().int().min(1).max(365).optional(),
});

// `ErrorResponseSchema` itself is NOT declared here: it is imported from
// `@/modules/accounts/api/schemas` in routes.ts, the app's one existing
// `.openapi("ErrorResponse")` registration — see the corrected Ruling P3-11.
```

- [ ] **Step 4: Write `routes.ts`**

```ts
// src/modules/interests/api/routes.ts
import { createRoute, z } from "@hono/zod-openapi";
import type { ApiApp, ApiDeps } from "@/platform/http/app";
import { ApiError } from "@/platform/http/errors";
import { parseExpectedVersion } from "@/platform/http/versioning";
import { withUserContext } from "@/platform/db/context";
import { createInterestRule } from "../application/create-interest-rule";
import { getInterestRuleDetail } from "../application/get-interest-rule-detail";
import { listInterestRules } from "../application/list-interest-rules";
import { updateInterestRule } from "../application/update-interest-rule";
import { NotFoundError, VersionMismatchError } from "../application/errors";
import { interestDeps } from "../infrastructure/deps";
import { ErrorResponseSchema } from "@/modules/accounts/api/schemas";
import {
  CreateInterestRuleRequestSchema,
  GetRuleDetailQuerySchema,
  InterestRuleDetailSchema,
  InterestRuleListResponseSchema,
  InterestRuleSchema,
  UpdateInterestRuleRequestSchema,
} from "./schemas";

const IdParamSchema = z.object({ id: z.string().uuid() });
const IfMatchHeaderSchema = z.object({ "if-match": z.string().optional() });

function errorResponse(description: string) {
  return { description, content: { "application/json": { schema: ErrorResponseSchema } } };
}

/**
 * `ErrorResponseSchema` itself is the one shared copy, imported above from
 * `@/modules/accounts/api/schemas` — not redeclared here. Only this
 * `errorResponse()`/`commonErrorResponses` wiring is duplicated per module,
 * matching accounts, integrations and expenses; it is a plain object of
 * route descriptions, not an OpenAPI component registration.
 */
const commonErrorResponses = {
  401: errorResponse("Not signed in (`unauthorized`)."),
  403: errorResponse("Missing permission (`permission_denied`), or a cookie-authenticated write sent without `X-Requested-With` (`csrf_required`)."),
  404: errorResponse("Not found (`not_found`)."),
  409: errorResponse("Version conflict (`version_mismatch`)."),
  422: errorResponse("Validation failed (`validation_failed`)."),
  428: errorResponse("The version precondition is missing (`precondition_required`)."),
  429: errorResponse("Over the per-minute rate limit (`rate_limited`)."),
};

function toApiError(err: unknown): ApiError {
  if (err instanceof NotFoundError) return new ApiError(404, "not_found", err.message);
  if (err instanceof VersionMismatchError) return new ApiError(409, "version_mismatch", err.message);
  throw err;
}

const listRoute = createRoute({
  method: "get",
  path: "/interest-rules",
  tags: ["Interests"],
  security: [{ session: [] }],
  responses: { 200: { content: { "application/json": { schema: InterestRuleListResponseSchema } }, description: "OK" }, ...commonErrorResponses },
});

const createRoute_ = createRoute({
  method: "post",
  path: "/interest-rules",
  tags: ["Interests"],
  security: [{ session: [] }],
  request: { body: { content: { "application/json": { schema: CreateInterestRuleRequestSchema } } } },
  responses: { 200: { content: { "application/json": { schema: InterestRuleSchema } }, description: "OK" }, ...commonErrorResponses },
});

const getRoute = createRoute({
  method: "get",
  path: "/interest-rules/{id}",
  tags: ["Interests"],
  security: [{ session: [] }],
  request: { params: IdParamSchema, query: GetRuleDetailQuerySchema },
  responses: { 200: { content: { "application/json": { schema: InterestRuleDetailSchema } }, description: "OK" }, ...commonErrorResponses },
});

const patchRoute = createRoute({
  method: "patch",
  path: "/interest-rules/{id}",
  tags: ["Interests"],
  security: [{ session: [] }],
  request: { params: IdParamSchema, headers: IfMatchHeaderSchema, body: { content: { "application/json": { schema: UpdateInterestRuleRequestSchema } } } },
  responses: { 200: { content: { "application/json": { schema: InterestRuleSchema } }, description: "OK" }, ...commonErrorResponses },
});

function toWireRule(rule: Awaited<ReturnType<ReturnType<typeof createInterestRule>>>) {
  return { ...rule, createdAt: rule.createdAt.toISOString(), updatedAt: rule.updatedAt.toISOString() };
}

export function registerInterestRoutes(app: ApiApp, deps: ApiDeps): void {
  app.openapi(listRoute, async (c) => {
    const principal = c.get("principal");
    const items = await withUserContext(deps.db, { userId: principal.userId }, (tx) => listInterestRules(interestDeps(tx, c.get("requestId")))(principal));
    return c.json({ items: items.map(toWireRule) }, 200);
  });

  app.openapi(createRoute_, async (c) => {
    const principal = c.get("principal");
    const body = c.req.valid("json");
    const rule = await withUserContext(deps.db, { userId: principal.userId }, (tx) => createInterestRule(interestDeps(tx, c.get("requestId")))(principal, body));
    return c.json(toWireRule(rule), 200);
  });

  app.openapi(getRoute, async (c) => {
    const principal = c.get("principal");
    const { id } = c.req.valid("param");
    const query = c.req.valid("query");
    try {
      const detail = await withUserContext(deps.db, { userId: principal.userId }, (tx) =>
        getInterestRuleDetail(interestDeps(tx, c.get("requestId")))(principal, id, query),
      );
      return c.json(
        {
          ...toWireRule(detail.rule),
          accruals: detail.accruals.map((a) => ({ ...a, postedAt: a.postedAt?.toISOString() ?? null })),
          entries: detail.entries.map((e) => ({ ...e, occurredAt: e.occurredAt.toISOString() })),
          reconciliation: detail.reconciliation,
          projection: detail.projection,
        },
        200,
      );
    } catch (err) {
      throw toApiError(err);
    }
  });

  app.openapi(patchRoute, async (c) => {
    const principal = c.get("principal");
    const { id } = c.req.valid("param");
    const body = c.req.valid("json");
    const expectedVersion = parseExpectedVersion({ ifMatch: c.req.header("if-match") ?? null, body });
    try {
      const rule = await withUserContext(deps.db, { userId: principal.userId }, (tx) =>
        updateInterestRule(interestDeps(tx, c.get("requestId")))(principal, id, expectedVersion, body),
      );
      return c.json(toWireRule(rule), 200);
    } catch (err) {
      throw toApiError(err);
    }
  });
}
```

- [ ] **Step 5: Register the routes**

In `src/platform/http/app.ts`:
```ts
import { registerInterestRoutes } from "@/modules/interests/api/routes";
// ...
export function registerAllRoutes(app: ApiApp, deps: ApiDeps): void {
  registerAccountRoutes(app, deps);
  registerIntegrationRoutes(app, deps);
  registerExpenseRoutes(app, deps);
  registerInterestRoutes(app, deps);
}
```

- [ ] **Step 6: Run the tests**

Run: `npm run test:integration -- interests/api/routes`
Expected: PASS.

- [ ] **Step 7: Regenerate the OpenAPI document and run the drift test**

Run: `npm run openapi:generate && npm test -- openapi-drift`
Expected: PASS.

- [ ] **Step 8: Typecheck and commit**

Run: `npx tsc --noEmit`
Expected: no errors.

```bash
git add src/modules/interests/api src/platform/http/app.ts docs/api/openapi.json
git commit -m "feat(interests): add the REST API for interest rules"
```

---

### Task 21: Interests pages — list and rule detail, replacing the setup state

**Files:**
- Create: `src/modules/interests/ui/run.ts`
- Create: `src/modules/interests/ui/deps.ts`
- Create: `src/modules/interests/ui/load-interests.ts`
- Create: `src/modules/interests/ui/load-interests.test.ts`
- Create: `src/modules/interests/ui/RulesTable.tsx`
- Create: `src/modules/interests/ui/RuleForm.tsx`
- Create: `src/modules/interests/ui/RuleDetail.tsx`
- Create: `src/app/actions/interests.ts`
- Modify: `src/app/(app)/finance/interests/page.tsx`
- Create: `src/app/(app)/finance/interests/loading.tsx`
- Create: `src/app/(app)/finance/interests/rules/[id]/page.tsx`
- Create: `src/app/(app)/finance/interests/rules/[id]/loading.tsx`

**Interfaces:**
- Consumes: `createInterestRule`, `updateInterestRule`, `listInterestRules`, `getInterestRuleDetail` from `../application/*` (Task 17); `interestDeps` from `../infrastructure/deps` (Task 16); `resolveCapabilities`, `realProbes` from `@/platform/capabilities/*` (existing, unchanged); `requirePrincipalOrRedirect` from `@/platform/auth/require-principal` (existing); `listAccounts` from `@/modules/accounts/application/list-accounts` (existing) and `accountDeps` from `@/modules/accounts/infrastructure/deps` (existing) — reused here the same way Task 19's job wiring reuses `accountDeps`, to populate the create-rule form's account dropdown; the interests module has no accounts repository of its own.
- Produces:
```ts
export function runForPrincipal<T>(fn: (deps: UseCaseDeps, principal: Principal) => Promise<T>): Promise<T>;
export interface RuleRow { id: string; accountId: string; annualRate: string; taxRate: string; postingMode: string; effectiveFrom: string; version: number; }
export function loadInterestRules(): Promise<RuleRow[]>;
export function loadInterestRuleDetail(id: string, opts: { periodStart: string; periodEnd: string }): Promise<{ rule: RuleRow; accruals: unknown[]; reconciliationStatus: string; projection: unknown[] } | null>;
export interface EligibleAccount { id: string; name: string; }
export function loadEligibleAccounts(): Promise<EligibleAccount[]>;
```
The Interests page keeps its existing "Connect Budget Makers Wallet" empty state when `Capabilities.features.interests` is `false` — same shape as Task 11's Expenses page change. When capable, the list page also renders `RuleForm` as its create-rule affordance (Ruling P3-17): the spec's page map (§4) has no separate "new rule" route, so `RuleForm` and `createInterestRuleAction` (Step 6/7 below) get their one real caller here instead of on a route this plan does not build.

- [ ] **Step 1: Write the failing loader test**

```ts
// src/modules/interests/ui/load-interests.test.ts
import { describe, expect, it } from "vitest";
import { testPrincipal } from "@/test/principal";
import { MemoryInterestAccrualsRepository, MemoryInterestEntriesRepository, MemoryInterestRulesRepository } from "../infrastructure/memory-repositories";
import { setInterestDepsFactoryForTests, setPrincipalForTests } from "./run";
import { loadInterestRules } from "./load-interests";

describe("loadInterestRules", () => {
  it("flattens a created rule into a plain row", async () => {
    const deps = {
      rules: new MemoryInterestRulesRepository(),
      accruals: new MemoryInterestAccrualsRepository(),
      entries: new MemoryInterestEntriesRepository(),
      balances: { latestBalanceAsOf: async () => "1000.00" },
      clock: { now: () => new Date("2026-09-05T00:00:00Z") },
      audit: async () => {},
    };
    await deps.rules.create({ userId: "00000000-0000-7000-8000-000000000001", accountId: "acc-1", annualRate: "0.0225", taxRate: "0.26", dayCount: 365, compounding: "simple_daily", effectiveFrom: "2026-01-01", effectiveTo: null, postingMode: "analyze_only", providerCategoryRef: null, noteMarker: "auto-interest" });

    setInterestDepsFactoryForTests(() => deps);
    setPrincipalForTests(testPrincipal());
    const rows = await loadInterestRules();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ accountId: "acc-1", postingMode: "analyze_only" });
    setInterestDepsFactoryForTests(null);
    setPrincipalForTests(null);
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `npm test -- load-interests`
Expected: FAIL — `Cannot find module './run'`.

- [ ] **Step 3: Write `run.ts`, `deps.ts` and `load-interests.ts`**

```ts
// src/modules/interests/ui/run.ts
import { db } from "@/lib/db";
import { withUserContext } from "@/platform/db/context";
import type { Principal } from "@/platform/auth/principal";
import { interestDeps } from "../infrastructure/deps";
import type { UseCaseDeps } from "../application/ports";

let depsFactoryForTests: (() => UseCaseDeps) | null = null;
let principalForTests: Principal | null = null;

export function setInterestDepsFactoryForTests(factory: (() => UseCaseDeps) | null): void {
  depsFactoryForTests = factory;
}

export function setPrincipalForTests(principal: Principal | null): void {
  principalForTests = principal;
}

export async function runForPrincipal<T>(fn: (deps: UseCaseDeps, principal: Principal) => Promise<T>): Promise<T> {
  if (process.env.NODE_ENV === "test" && depsFactoryForTests && principalForTests) {
    return fn(depsFactoryForTests(), principalForTests);
  }
  const { requirePrincipal } = await import("@/platform/auth/require-principal");
  const principal = await requirePrincipal();
  return withUserContext(db, { userId: principal.userId }, (tx) => fn(interestDeps(tx), principal));
}
```

```ts
// src/modules/interests/ui/deps.ts
export { interestDeps } from "../infrastructure/deps";
export { runForPrincipal, setInterestDepsFactoryForTests, setPrincipalForTests } from "./run";
```

```ts
// src/modules/interests/ui/load-interests.ts
import { db } from "@/lib/db";
import { withUserContext } from "@/platform/db/context";
import { accountDeps } from "@/modules/accounts/infrastructure/deps";
import { listAccounts } from "@/modules/accounts/application/list-accounts";
import { getInterestRuleDetail } from "../application/get-interest-rule-detail";
import { listInterestRules } from "../application/list-interest-rules";
import { runForPrincipal } from "./run";

export interface RuleRow {
  id: string;
  accountId: string;
  annualRate: string;
  taxRate: string;
  postingMode: string;
  effectiveFrom: string;
  version: number;
}

function toRow(rule: Awaited<ReturnType<ReturnType<typeof listInterestRules>>>[number]): RuleRow {
  return {
    id: rule.id,
    accountId: rule.accountId,
    annualRate: rule.annualRate,
    taxRate: rule.taxRate,
    postingMode: rule.postingMode,
    effectiveFrom: rule.effectiveFrom,
    version: rule.version,
  };
}

export async function loadInterestRules(): Promise<RuleRow[]> {
  return runForPrincipal(async (deps, principal) => (await listInterestRules(deps)(principal)).map(toRow));
}

export async function loadInterestRuleDetail(
  id: string,
  opts: { periodStart: string; periodEnd: string },
): Promise<{ rule: RuleRow; accruals: { accrualDate: string; net: string }[]; reconciliationStatus: string; projection: { date: string; net: string }[] } | null> {
  return runForPrincipal(async (deps, principal) => {
    const detail = await getInterestRuleDetail(deps)(principal, id, { ...opts, projectionDays: 30 }).catch(() => null);
    if (!detail) return null;
    return {
      rule: toRow(detail.rule),
      accruals: detail.accruals.map((a) => ({ accrualDate: a.accrualDate, net: a.net })),
      reconciliationStatus: detail.reconciliation.status,
      projection: detail.projection.map((p) => ({ date: p.date, net: p.net })),
    };
  });
}

export interface EligibleAccount {
  id: string;
  name: string;
}

/**
 * The interests module has no accounts repository of its own, so this loader
 * reuses the accounts module's own use case and deps bag directly — the same
 * cross-module reuse Task 19's job wiring already relies on (`accountDeps`),
 * not a new pattern. It opens its own `withUserContext`, never nested inside
 * `runForPrincipal`'s.
 */
export async function loadEligibleAccounts(): Promise<EligibleAccount[]> {
  const { requirePrincipal } = await import("@/platform/auth/require-principal");
  const principal = await requirePrincipal();
  const items = await withUserContext(db, { userId: principal.userId }, (tx) => listAccounts(accountDeps(tx))(principal, { months: 1 }));
  return items.map((i) => ({ id: i.account.id, name: i.account.name }));
}
```

- [ ] **Step 4: Run the test**

Run: `npm test -- load-interests`
Expected: PASS.

- [ ] **Step 5: Write the table, form and detail client components**

```tsx
// src/modules/interests/ui/RulesTable.tsx
"use client";

import Link from "next/link";
import type { RuleRow } from "./load-interests";

export function RulesTable({ rows }: { rows: readonly RuleRow[] }) {
  if (rows.length === 0) {
    return <p className="py-8 text-center text-body-sm text-muted">No interest rules yet.</p>;
  }
  return (
    <table className="w-full text-body-sm">
      <thead>
        <tr className="text-left text-muted">
          <th className="py-2">Account</th>
          <th>Annual rate</th>
          <th>Posting</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((r) => (
          <tr key={r.id} className="border-t border-border">
            <td className="py-2">
              <Link href={`/finance/interests/rules/${r.id}`} className="hover:underline">
                {r.accountId}
              </Link>
            </td>
            <td>{(Number(r.annualRate) * 100).toFixed(2)}%</td>
            <td>{r.postingMode === "post_to_provider" ? "Posts to Wallet" : "Analyse only"}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
```

```tsx
// src/modules/interests/ui/RuleForm.tsx
"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { createInterestRuleAction } from "@/app/actions/interests";

export function RuleForm({ accounts }: { accounts: readonly { id: string; name: string }[] }) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  return (
    <form
      action={(formData) => {
        startTransition(async () => {
          const result = await createInterestRuleAction(formData);
          if (!result.ok) {
            setError(result.error);
            return;
          }
          setError(null);
          router.push(`/finance/interests/rules/${result.data.id}`);
        });
      }}
      className="flex flex-col gap-4"
    >
      <label className="flex flex-col gap-1">
        <span className="text-body-sm text-muted">Account</span>
        <select name="accountId" className="rounded-md border border-border px-3 py-2">
          {accounts.map((a) => (
            <option key={a.id} value={a.id}>
              {a.name}
            </option>
          ))}
        </select>
      </label>
      <label className="flex flex-col gap-1">
        <span className="text-body-sm text-muted">Annual rate (e.g. 0.0225 for 2.25%)</span>
        <input name="annualRate" defaultValue="0.0225" className="rounded-md border border-border px-3 py-2" />
      </label>
      <label className="flex flex-col gap-1">
        <span className="text-body-sm text-muted">Tax rate (e.g. 0.26 for 26%)</span>
        <input name="taxRate" defaultValue="0.26" className="rounded-md border border-border px-3 py-2" />
      </label>
      <label className="flex flex-col gap-1">
        <span className="text-body-sm text-muted">Effective from</span>
        <input type="date" name="effectiveFrom" className="rounded-md border border-border px-3 py-2" />
      </label>
      {error ? <p className="text-body-sm text-danger">{error}</p> : null}
      <button type="submit" disabled={pending} className="inline-flex min-h-11 items-center justify-center rounded-md bg-accent px-4 text-body-sm font-medium text-accent-contrast">
        Create rule
      </button>
    </form>
  );
}
```

```tsx
// src/modules/interests/ui/RuleDetail.tsx
"use client";

import { MoneyValue } from "@/components/ui/MoneyValue";

export interface RuleDetailProps {
  accruals: readonly { accrualDate: string; net: string }[];
  reconciliationStatus: string;
  projection: readonly { date: string; net: string }[];
}

export function RuleDetail({ accruals, reconciliationStatus, projection }: RuleDetailProps) {
  return (
    <div className="flex flex-col gap-6">
      <p className="text-body-sm">
        Reconciliation this period: <strong>{reconciliationStatus}</strong>
      </p>
      <div>
        <h2 className="text-body-sm font-medium text-muted">Accrued</h2>
        <ul className="mt-2 flex flex-col gap-1 text-body-sm">
          {accruals.map((a) => (
            <li key={a.accrualDate} className="flex justify-between">
              <span>{a.accrualDate}</span>
              <MoneyValue amount={a.net} currency="EUR" />
            </li>
          ))}
        </ul>
      </div>
      <div>
        <h2 className="text-body-sm font-medium text-muted">Projected (next 30 days, current balance held constant)</h2>
        <ul className="mt-2 flex flex-col gap-1 text-body-sm">
          {projection.slice(0, 5).map((p) => (
            <li key={p.date} className="flex justify-between">
              <span>{p.date}</span>
              <MoneyValue amount={p.net} currency="EUR" />
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
```

- [ ] **Step 6: Write the server action**

```ts
// src/app/actions/interests.ts
"use server";

import { revalidatePath } from "next/cache";
import { createInterestRule, type CreateInterestRuleInput } from "@/modules/interests/application/create-interest-rule";
import { runForPrincipal } from "@/modules/interests/ui/deps";
import { PermissionDeniedError } from "@/platform/auth/principal";
import { errorMessage, fail, succeed, text, type ActionResult } from "./types";
import type { InterestRule } from "@/modules/interests/application/ports";

function mapError(err: unknown): string {
  if (err instanceof PermissionDeniedError) return "You do not have permission to manage interest rules.";
  return errorMessage(err);
}

export async function createInterestRuleAction(formData: FormData): Promise<ActionResult<InterestRule>> {
  const input: CreateInterestRuleInput = {
    accountId: text(formData.get("accountId")) ?? "",
    annualRate: text(formData.get("annualRate")) ?? "0",
    taxRate: text(formData.get("taxRate")) ?? "0",
    dayCount: 365,
    effectiveFrom: text(formData.get("effectiveFrom")) ?? new Date().toISOString().slice(0, 10),
  };
  try {
    const rule = await runForPrincipal((deps, principal) => createInterestRule(deps)(principal, input));
    revalidatePath("/finance/interests");
    return succeed(rule);
  } catch (err) {
    return fail(mapError(err));
  }
}
```

- [ ] **Step 7: Wire the pages**

```tsx
// src/app/(app)/finance/interests/page.tsx
import Link from "next/link";
import { PageHeader } from "@/components/layout/PageHeader";
import { EmptyState } from "@/components/ui/EmptyState";
import { requirePrincipalOrRedirect } from "@/platform/auth/require-principal";
import { realProbes } from "@/platform/capabilities/probes";
import { resolveCapabilities } from "@/platform/capabilities/resolve";
import { loadEligibleAccounts, loadInterestRules } from "@/modules/interests/ui/load-interests";
import { RuleForm } from "@/modules/interests/ui/RuleForm";
import { RulesTable } from "@/modules/interests/ui/RulesTable";

export const dynamic = "force-dynamic";
export const metadata = { title: "Interests" };

export default async function InterestsPage() {
  const principal = await requirePrincipalOrRedirect();
  const caps = await resolveCapabilities(principal, realProbes);

  if (!caps.features.interests) {
    return (
      <>
        <PageHeader title="Interests" />
        <div className="max-w-xl pt-6">
          <EmptyState
            title="Connect Budget Makers Wallet"
            description="Interest is accrued from a Wallet account's daily balance. Connect the integration to start tracking rules."
            action={
              <Link
                href="/settings/integrations/wallet"
                className="inline-flex min-h-11 items-center rounded-md bg-accent px-4 text-body-sm font-medium text-accent-contrast transition-colors hover:bg-accent-hover"
              >
                Go to Integrations
              </Link>
            }
          />
        </div>
      </>
    );
  }

  const [rows, accounts] = await Promise.all([loadInterestRules(), loadEligibleAccounts()]);
  return (
    <>
      <PageHeader title="Interests" />
      <div className="flex flex-col gap-8 pt-6">
        <RulesTable rows={rows} />
        <div className="max-w-md">
          <h2 className="text-body-sm font-medium text-muted">New rule</h2>
          <div className="pt-4">
            <RuleForm accounts={accounts} />
          </div>
        </div>
      </div>
    </>
  );
}
```
There is no separate "new rule" route: the spec's page map (§4) lists only `/finance/interests` and `/finance/interests/rules/[id]`, so the create-rule form (`RuleForm`, wired to `createInterestRuleAction` in Step 6) lives on the list page itself (Ruling P3-17).

```tsx
// src/app/(app)/finance/interests/loading.tsx
export default function Loading() {
  return <div className="animate-pulse pt-6 text-body-sm text-muted">Loading interest rules…</div>;
}
```

```tsx
// src/app/(app)/finance/interests/rules/[id]/page.tsx
import { notFound } from "next/navigation";
import { PageHeader } from "@/components/layout/PageHeader";
import { requirePrincipalOrRedirect } from "@/platform/auth/require-principal";
import { loadInterestRuleDetail } from "@/modules/interests/ui/load-interests";
import { RuleDetail } from "@/modules/interests/ui/RuleDetail";
import { romeDate } from "@/lib/time";

export const dynamic = "force-dynamic";

function monthStart(now: Date): string {
  return `${romeDate(now).slice(0, 7)}-01`;
}

export default async function InterestRulePage({ params }: { params: Promise<{ id: string }> }) {
  await requirePrincipalOrRedirect();
  const { id } = await params;
  const now = new Date();
  const detail = await loadInterestRuleDetail(id, { periodStart: monthStart(now), periodEnd: romeDate(now) });
  if (!detail) notFound();

  return (
    <>
      <PageHeader title="Interest rule" />
      <div className="max-w-lg pt-6">
        <RuleDetail accruals={detail.accruals} reconciliationStatus={detail.reconciliationStatus} projection={detail.projection} />
      </div>
    </>
  );
}
```

```tsx
// src/app/(app)/finance/interests/rules/[id]/loading.tsx
export default function Loading() {
  return <div className="animate-pulse pt-6 text-body-sm text-muted">Loading…</div>;
}
```

- [ ] **Step 8: Build and typecheck**

Run: `npx tsc --noEmit && npm run build`
Expected: no errors; the route table lists `/finance/interests` and `/finance/interests/rules/[id]`.

- [ ] **Step 9: Commit**

```bash
git add src/modules/interests/ui src/app/actions/interests.ts src/app/\(app\)/finance/interests
git commit -m "feat(interests): add list and rule-detail pages, replacing the setup state"
```

---

### Task 22: Documentation — architecture, API, integrations guide, Phase 3 runbook

**Files:**
- Modify: `docs/architecture/overview.md`
- Modify: `docs/api/README.md`
- Modify: `docs/integrations/README.md`
- Create: `docs/deploy/phase-3-runbook.md`

**Interfaces:** none (docs only; no code changes in this task).

- [ ] **Step 1: Update `docs/architecture/overview.md`**

Add two new module blocks to the "Module layout" tree (after the `modules/integrations/` block) and a sentence to the paragraph beneath it:

```
  modules/expenses/
    domain/             Transaction, TransactionCategory, TransactionLabel, transfer pairing, recurring detection — no IO
    application/         list/get/update transaction, list categories/labels, sync-provider-transactions, detect-recurring-patterns, ports.ts
    infrastructure/       Drizzle repositories, the Wallet transactions adapter
    api/                   Hono routes (routes.ts) + Zod schemas (schemas.ts)
    ui/                     Expenses list/detail loaders and components
  modules/interests/
    domain/             dailyInterest, projectInterest, reconcileInterest — no IO, ported from Wallet Manager's interest.py
    application/         rule CRUD, run-interest-accrual, get-interest-rule-detail, post-interest-entry, ports.ts
    infrastructure/       Drizzle repositories, the Wallet interest-posting adapter
    api/                   Hono routes (routes.ts) + Zod schemas (schemas.ts)
    ui/                     Interests list/rule-detail loaders and components
```

Update the paragraph immediately below the tree from "Only `accounts` is a full module today" to:

```
`accounts`, `expenses` and `interests` are full modules; everything payroll/trek/paperless-related still lives under `src/lib/*` and moves into its own module in a later phase (§11 Phase 4 and after). Transactions sync through the same `IntegrationProvider`/`SyncKind` framework as accounts (`transactions` on the Wallet provider, cursor-based and incremental — Task 8 of the Phase 3 plan), and interest accrual is a new daily job (`src/lib/jobs/interest-accrual.ts`) in the shape of `monthly-close.ts`, but iterating every user with an active rule rather than a single owner.
```

- [ ] **Step 2: Update `docs/api/README.md`**

Add two new sections after the existing "Integrations" section, following the same structure and tone as the rest of the file:

```markdown
## Expenses

`GET /transactions`, `GET /transactions/{id}`, `PATCH /transactions/{id}`,
`GET /transaction-categories`, `GET /transaction-labels`,
`GET /transactions/recurring-patterns`. Transactions, categories and labels
are read-only from the Wallet sync's point of view — the sync creates and
updates them; a user can only recategorise, label and annotate what already
exists. `PATCH /transactions/{id}` follows the same `If-Match`/`version`
convention as `PATCH /accounts/{id}`.

## Interests

`GET /interest-rules`, `POST /interest-rules`, `GET /interest-rules/{id}`
(accepts `periodStart`, `periodEnd`, `projectionDays` query parameters and
returns the rule together with its accruals, entries, a reconciliation
summary for the period, and a forward projection), `PATCH /interest-rules/{id}`.
Every rule defaults to `postingMode: "analyze_only"`; flipping it to
`"post_to_provider"` is the only way this API ever writes to Wallet, and only
for a rule whose account is still a live synced Wallet account with a
connected integration — see
[`docs/migration/wallet-manager-cutover.md`](../migration/wallet-manager-cutover.md)
for the operational procedure.
```

- [ ] **Step 3: Update `docs/integrations/README.md`**

Add a subsection after the description of `SyncKind` (wherever the existing "accounts" and "leave" kinds are described):

```markdown
### `transactions` (Wallet)

Incremental and cursor-based, unlike the `accounts` `SyncKind`'s full listing:
the cursor is `{ sinceDate: string }`, the Rome date the last successful pass
ran. Each pass re-requests from a week before that date (`RECORDS_LOOKBACK_DAYS`
in `wallet-provider-adapter.ts`) rather than exactly from it, so a record whose
`updatedAt` changed after the cursor moved past it is still picked up on the
next pass — safe because every write this handler makes is an idempotent
upsert keyed by `provider_links`, never an append. `fetch` makes two Wallet
round trips (`/records`, `/categories`) with no transaction open; `apply`
delegates the whole reconciliation — transactions, categories, labels,
transfer pairing — to `syncProviderTransactions` in the expenses module, the
same fetch/apply split `accountsSync` uses.

### The optional interest-posting adapter

Not a `SyncKind` — it is a push, not a pull, so it does not go through the
sync engine at all. `src/lib/jobs/interest-accrual.ts`, after computing a
day's accrual, calls `openConnection` and a live `provider_links` lookup in
short, sequential, un-nested transactions, then calls
`postWalletInterestEntry` (`src/modules/interests/infrastructure/
wallet-interest-posting-adapter.ts`) with no transaction open, exactly like
every other Wallet network call in this codebase. It only fires when a rule's
`postingMode` is `"post_to_provider"` — the default is `"analyze_only"`
(spec §13.2).
```

- [ ] **Step 4: Write the Phase 3 runbook**

```markdown
// docs/deploy/phase-3-runbook.md
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
deliberate, per-rule act — never a consequence of deploying this phase. See
[`docs/migration/wallet-manager-cutover.md`](../migration/wallet-manager-cutover.md).
```

- [ ] **Step 5: Verify every command quoted in the new docs actually resolves against this tree**

Run: `npm run openapi:generate && curl -s http://localhost:3000/api/v1/openapi.json 2>/dev/null | jq '.paths | keys' | grep -E "transactions|interest-rules" || jq '.paths | keys' docs/api/openapi.json | grep -E "transactions|interest-rules"`
Expected: at least `/transactions`, `/transactions/{id}`, `/transaction-categories`, `/transaction-labels`, `/transactions/recurring-patterns`, `/interest-rules`, `/interest-rules/{id}` are listed.

- [ ] **Step 6: Commit**

```bash
git add docs/architecture/overview.md docs/api/README.md docs/integrations/README.md docs/deploy/phase-3-runbook.md
git commit -m "docs: document Expenses, Interests and the Phase 3 deployment procedure"
```

---

### Task 23: Exit criteria

**Files:**
- Create: `docs/superpowers/handoff/2026-09-05-phase-3-checkpoint.md`
- Create: `docs/superpowers/handoff/2026-09-05-phase-3-ledger.md`

**Interfaces:** none — this task runs the whole tree's verification suite and records the result; it does not change application code.

*Spec §11 Phase 3 exit line: "Expenses and Interests only with Wallet" (the acceptance item this phase closes).*

- [ ] **Step 1: Run the full verification gate**

Run, in order, from `dashboard-app/`:
```bash
npx tsc --noEmit
npm test
npm run test:db:up && npm run test:integration
npm run build
npm run e2e
```
Expected: every command exits 0. `npm test` includes `src/platform/http/openapi-drift.test.ts` — the OpenAPI drift check is inside that suite, not a separate command. `npm run e2e` needs a running `next dev` per `tests/e2e/README.md` (no `webServer` block in the Playwright config, per Phase 2's own note) — start one against the throwaway test database before running it.

Also run:
```bash
git log --oneline main | head -30
```
Expected: one commit per task above, in order, each with a real `Co-Authored-By:` trailer.

- [ ] **Step 2: Run the graphify update this phase deferred per task**

Run: `graphify update .` (once, from the repo root — Ruling P2-C15 carried forward: not run per task).
Expected: `graphify-out/` reflects the two new modules and the widened `SyncKind`/`ProviderLinksRepository` types.

- [ ] **Step 3: Manual walkthrough (operator checklist, needs a real Wallet token)**

Repeats the caveat Phase 2's checkpoint recorded: this cannot be driven by an automated agent in this environment (no real Wallet token, no authenticated browser session). Whoever holds a real token runs this after deploying (`docs/deploy/phase-3-runbook.md`):

1. Connect Wallet if not already connected; confirm `/finance/expenses` and `/finance/interests` both show their "Connect Budget Makers Wallet" empty state beforehand.
2. Trigger `POST /api/v1/integrations/wallet/sync` with `{"kind":"transactions"}`; confirm `/finance/expenses` now lists real transactions with real categories.
3. Recategorise one transaction and add a note via its detail page; reload and confirm both persisted.
4. Confirm a genuinely recurring payee (three or more monthly charges of a stable amount) appears under "Recurring" on the Expenses page.
5. Create an interest rule against a real synced Wallet savings/checking account, `postingMode: analyze_only`; wait for the next daily tick (or trigger the job manually if there's an admin control for it); confirm an accrual appears on the rule's detail page with a plausible, non-zero net amount.
6. Confirm the rule's reconciliation for the current month reads `missing` (nothing has posted yet, since `analyze_only`).
7. Only if comfortable doing so against a real account: flip the rule to `post_to_provider` for one day, confirm a matching record appears in the Wallet app with the `auto-interest` note, then flip it back to `analyze_only` (or follow the full cut-over in `docs/migration/wallet-manager-cutover.md` if retiring the standalone container for real).
8. Confirm `job_runs` (Settings › Administration) shows `interest_accrual` and the Wallet `transactions` sync's `sync_runs` entries, both `success`.

Record the result as a dated addendum to this checkpoint, the same way Phase 1's production deploy got its own section in the Phase 0/1 checkpoint.

- [ ] **Step 4: Grep for anything this phase should have retired or never introduced**

Run:
```bash
grep -rn "WALLET_TAX_RATE\|ANNUAL_RATE\|state\.json" dashboard-app/src
grep -rn "z.enum(\[\"accounts\", \"leave\"\])\|z.enum(\[\"accounts\",\"leave\"\])" dashboard-app/src
```
Expected: no hits — the first confirms no accidental copy of the legacy container's env-var-driven config leaked into the dashboard; the second confirms both hardcoded `SyncKind` enums in `src/modules/integrations/api/schemas.ts` were actually updated in Task 8, not left stale.

- [ ] **Step 5: Write the checkpoint document**

In the shape of `docs/superpowers/handoff/2026-09-04-phase-2-checkpoint.md`: current commit range, every verification command's result, what remains manual (Step 3 above) and why, the module/file map this phase added, and every ruling made during planning and execution (posting default analyze-only; entity types living in `interests/application/ports.ts` rather than a domain file; the `transactions` `SyncKind`'s cursor shape; the accounts-style flat-deps-bag choice for `expenses`/`interests` versus the integrations module's bound-context shape; anything a reviewer flagged and fixed during execution that is not yet reflected in this plan text).

- [ ] **Step 6: Write the ledger document**

In the shape of `docs/superpowers/handoff/2026-09-04-phase-2-ledger.md`: one entry per ruling with its "why" and "cost if wrong," and a "Deferred by design" section listing what Phase 3 deliberately left for later — full category/label management UI (Phase 9's Management area), `monthly`/`none` compounding (accepted by the schema, never computed), reconciliation persisted as `reconciliation_issues` rows (computed on read only in Phase 3), a `SyncSchedule` finer than `hourly` for transactions, bulk re-post/backfill tooling for a rule enabled after existing history has accrued.

- [ ] **Step 7: Commit**

```bash
git add -A ../docs
git commit -m "docs(handoff): record the Phase 3 checkpoint and execution ledger"
```

---

## Rulings

- **P3-1 (spec §13.2 default, adopted as-is):** interest posting to Wallet stays behind a per-rule switch. Every rule defaults to `postingMode: "analyze_only"`; `"post_to_provider"` is opt-in and only takes effect for a rule whose account is a currently-live synced Wallet account with a connected integration (Task 19).
- **P3-2:** `expenses` and `interests` use the accounts module's flat `UseCaseDeps` bag (repositories + clock + audit, no `db`, no context-opening method), with RLS context opened once by the caller via `withUserContext`/`withSystemContext` — not the integrations module's `IntegrationDeps.inUserContext`/`inSystemContext` shape. The assignment names `modules/accounts` as the reference vertical slice for new domains; the integrations module's different shape is left exactly as Phase 2 built it.
- **P3-3:** interest rule/accrual/entry entity types live directly in `interests/application/ports.ts` rather than a separate `domain/rule.ts` — unlike `accounts`/`expenses`, this module's entities carry no invariants beyond what the already-pure `dailyInterest`/`reconcileInterest`/`projectInterest` (Task 14) express.
- **P3-4:** `ProviderLinksRepository.entityType` widens to `"account" | "transaction" | "category" | "label"` (Task 2). Wallet exposes a label only as a name, never a stable id, so the label's own name stands in for its external id in `provider_links` — documented at the one call site that relies on it (`sync-provider-transactions.ts`).
- **P3-5:** the `transactions` `SyncKind`'s cursor is `{ sinceDate: string }` — the Rome date the last successful pass ran — refetched with a 7-day lookback overlap (`RECORDS_LOOKBACK_DAYS`) rather than exactly from the cursor, so a record edited after the cursor moved past it is still caught. Safe because the sync is a pure upsert keyed by `provider_links`, never an append: redundant overlap produces zero duplicates.
- **P3-6:** the accrual math (Task 14) is a from-scratch TypeScript port of `interest.py`'s exact algorithm, using `BigInt`-based fixed-point arithmetic at a 1e12 internal scale rather than a decimal-library dependency (none exists in this codebase's `package.json`) — enough headroom above the 6-decimal `numeric` columns to make float-style rounding error impossible at the cent boundary.
- **P3-7:** only `compounding: "simple_daily"` over `dayCount: 360 | 365` is computed by `runInterestAccrual` in Phase 3, matching `interest.py`'s own algorithm exactly. `"monthly"`/`"none"` compounding and `dayCount: "actual"` are accepted by the schema (spec §5.7 fidelity) but produce no accrual — forward compatibility for a later phase, not a Phase 3 feature.
- **P3-8:** the daily interest-accrual job (Task 18) iterates **every user with an active rule** (`InterestRulesRepository.listActiveForAllUsers`, read once under `withSystemContext`), unlike `monthly-close.ts`'s Phase-0/1-era single-owner assumption — interest rules are per-user from the start, and one rule's failure is caught and logged per-rule so it cannot jam every other user's run.
- **P3-9:** posting to the provider is a push, never a `SyncKind` — it does not go through the sync engine. The job reads what it needs (the stored accrual, the account's live provider link, the opened connection) in short, sequential, never-nested transactions, then calls the Wallet API with no transaction open, then records the result in one final short transaction — the same fetch/apply discipline every pull sync in this codebase already follows, applied to a push.
- **P3-10:** the real BudgetBakers `/records` and `/categories` field names have not been verified against a live token in this environment (same limitation Phase 2's checkpoint recorded for its own UI walkthrough). Every field guess is isolated behind `wallet-transactions-adapter.ts` and `wallet-interest-posting-adapter.ts` and validated by Zod, so a shape mismatch fails loudly and non-retryably rather than silently mis-mapping data; `docs/deploy/phase-3-runbook.md` carries a manual verification step for whoever holds a real token.
- **P3-11 (corrected — see P3-15):** the earlier version of this ruling claimed `ErrorResponseSchema` is duplicated per-module today and that "no shared copy exists" — that claim is false: `src/modules/integrations/api/routes.ts:27` already imports `ErrorResponseSchema` from `@/modules/accounts/api/schemas`, the app's one existing `.openapi("ErrorResponse")` registration. The real, established convention is share-by-import for `ErrorResponseSchema` itself; only the `errorResponse()`/`commonErrorResponses` wiring around it (plain route-description objects, not OpenAPI component registrations) is duplicated per module, matching accounts and integrations. Tasks 10, 12 and 20 are written to import the shared schema — see P3-15.
- **P3-12:** `TransactionPatch` is widened to include `transferGroupId` in Task 7, the task that first needs to write it (transfer pairing), rather than speculatively in Task 4 where it would have had no caller yet.
- **P3-13:** recurring-pattern detection (Task 12) runs as the last step of the transactions sync's `apply` phase — a full recompute from every transaction on file, replacing the previous set — rather than as a separately scheduled job. It is cheap (pure in-memory grouping over what the sync already loaded) and always reflects the latest sync.
- **P3-14:** no new required environment variables this phase. Interest-rule parameters (rate, tax rate, day count, posting mode) live in per-rule database rows, a deliberate change from `interest.py`'s single env-var-configured account — this is exactly what spec §7.6 calls out as the "changed" behavior versus the legacy script.
- **P3-15 (pre-flight repair; supersedes P3-11):** `ErrorResponseSchema` is imported from `@/modules/accounts/api/schemas` — the app's one existing `.openapi("ErrorResponse")` registration — in Tasks 10, 12 and 20, not redeclared. All routes across all four modules (accounts, integrations, expenses, interests) register onto the same shared `ApiApp`/`OpenAPIHono` instance, so a second module-local schema tagged with the same OpenAPI component name would collide at `npm run openapi:generate` time rather than merely duplicate. Only the per-module `errorResponse()`/`commonErrorResponses` wiring around it stays duplicated, matching the accounts/integrations precedent exactly — that wiring is a plain object of route descriptions, not an OpenAPI component registration, so it carries none of the schema's collision risk.
- **P3-16 (pre-flight repair):** both `InterestAccrualsRepository.upsert` implementations (Tasks 15, 16) preserve `postedAt`/`entryId` on conflict, identically: `MemoryInterestAccrualsRepository.upsert` now sets only `balanceBasis`/`gross`/`tax`/`net`/`carryAfter` from `input` on an existing row, the same field list `DrizzleInterestAccrualsRepository.upsert`'s `onConflictDoUpdate` `set` already used. Before this fix, the memory repository spread `...input` last, and since every caller (`runInterestAccrual`) always upserts with `postedAt: null, entryId: null`, a second upsert of an already-posted accrual made it look unposted to `shouldPost` (Task 19) under the fake — a real double-post risk that no test caught. Tasks 15 and 16 each now carry a test that upserts an accrual, marks it posted, upserts the same accrual again with changed amounts, and asserts it stays posted with the same `entryId`.
- **P3-17 (pre-flight repair):** the Interests list page (`/finance/interests`, Task 21) renders `RuleForm` as its create-rule affordance, giving `RuleForm` and `createInterestRuleAction` a real caller. The spec's page map (§4) lists only `/finance/interests` and `/finance/interests/rules/[id]` — no create route — so this plan does not invent one; a later phase can move rule creation to its own page if the list page becomes crowded. `docs/deploy/phase-3-runbook.md` (Task 22) and `docs/migration/wallet-manager-cutover.md` (Task 19) both point the operator at the list page's form rather than a "Finance › Interests › New rule" path that no task builds.
- **P3-18 (pre-flight repair, mechanical):** four small factual corrections made in the same pass: Task 10's file reference for `registerAllRoutes` corrected from `app.ts:157-161` to the real `app.ts:141-145` (the file is 145 lines total); Task 11's `TransactionRow` **Produces** block now includes `categoryId`, matching its own Step 4 implementation and both loader functions; the top-level **File Structure** block now names the expenses source port `TransactionsSource`, matching every consumer (Task 4's own code, Task 7) instead of the stray `ProviderTransactionsSource`; Task 12's Step 9 now gives the actual `loadRecurringPatterns` code and the full updated `page.tsx`, replacing the plan's one prose-only code step.

## Self-review against the Phase 3 scope

1. **Migration 0011 (transactions/categories/labels/join tables), RLS shape, uuidv7, created/updated_at** — Task 1.
2. **`ProviderLinksRepository` widening needed by transactions/categories/labels sync** — Task 2 (a prerequisite the spec's scope list does not name directly but Task 7/8 cannot work without).
3. **Transaction sync as a new `SyncKind` on the Wallet adapter, through the existing sync engine, cursor-based incremental fetch** — Tasks 6 (client), 7 (adapter + reconciliation use case), 8 (wiring into `SyncKind`/`syncs`).
4. **Expenses domain, use cases, REST API and pages, replacing the setup state** — Tasks 3, 4, 5, 9, 10, 11.
5. **Recurring-transaction detection** — Task 3 (pure domain function), Task 12 (persistence, wiring into the sync, surfaced on the page).
6. **Interest rules, the accrual job, entries, reconciliation and projections; Interests pages and API** — Tasks 13 (schema), 14 (math), 15–16 (ports/repositories), 17 (use cases), 18 (job), 20 (API), 21 (pages).
7. **The optional posting adapter behind a per-rule switch, plus the wallet-manager cut-over document** — Task 19; the ruling adopting spec §13.2's default is P3-1.
8. **Docs: architecture, API README + regenerated `openapi.json`, Phase 3 runbook** — Task 22, with `openapi.json` also regenerated inside every task that changes a route (8's schema enum widening needs no route change so no regen there; 10, 12, 20 each regenerate in place).
9. **Exit-criteria task** — Task 23.

**Placeholder scan:** no `TBD`/`TODO`, no "add appropriate error handling"-style steps, no test whose only assertion is a vague bound — the two loosest assertions (`expect(Number(r.carryAfter)).toBeGreaterThan(0)` in Task 14, mirrored again where it is reused) are a deliberate, named port of `interest.py`'s own self-test assertion for that exact edge case, not an accidentally weak check.

**Type/signature consistency check:** `TransactionPatch`, `ListTransactionsOptions`, `UseCaseDeps` (expenses) and `UseCaseDeps` (interests), `InterestRule`/`InterestAccrual`/`InterestEntry`, and `SyncKind` are each defined exactly once (Tasks 4, 15, and the modification to `platform/integrations/types.ts` in Task 8) and referenced identically by every later task that imports them — verified by re-reading each producing task's **Produces:** block against every later **Consumes:** block while writing this plan.

**Casts:** the only `as` casts in this plan narrow a Drizzle text column to its domain union at the repository boundary (e.g. `row.type as Transaction["type"]`, `row.kind as InterestEntry["kind"]`) — the exact pattern `DrizzleAccountsRepository`/`DrizzleProviderLinksRepository` already use for the same reason (a `text` column with an app-level `CHECK` constraint has no narrower a Drizzle-inferred type), not a cast introduced to silence an unrelated type error.

**What this plan does not cover, and why:** full category/label management UI (rename, merge, hierarchy) is Phase 9's Management area, not Phase 3's; `reconciliation_issues` rows are not written this phase — reconciliation is computed on read only (`reconcileInterest`), matching the spec's Funds section's later, more elaborate reconciliation-issue model rather than pre-empting it; a `SyncSchedule` finer than `hourly` for transactions (per-minute, say) is not exposed — Phase 2 already noted per-connection schedule toggles have no UI yet, and this phase does not add one; bulk re-post or backfill tooling for a rule enabled after months of unposted history does not exist — the job only ever computes "today," so enabling `post_to_provider` on an old rule starts posting from the next tick forward, not retroactively (documented in the cut-over doc's step 4).

