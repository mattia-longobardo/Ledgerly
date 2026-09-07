import type { AuditInput } from "@/platform/audit/record";
import { testPrincipal } from "@/test/principal";
import type { TransactionLike } from "../domain/scopes";
import {
  MemoryAllocationsRepository,
  MemoryAmountVersionsRepository,
  MemoryBudgetsRepository,
  MemoryEventsRepository,
  MemoryScopesRepository,
  MemoryUsagesRepository,
} from "../infrastructure/memory-repositories";
import type { Budget, NewBudget, UseCaseDeps } from "./ports";

/**
 * Wires the budgets memory repositories (Task 3) plus fake source/ownership/label
 * lookups, the way `fundHarness()` wires the funds module's memory repositories.
 */
export function budgetHarness() {
  const audits: AuditInput[] = [];
  const accountOwners = new Set<string>();
  const fundOwners = new Set<string>();
  const balances = new Map<string, string>();
  const accountNames = new Map<string, string>();
  const fundNames = new Map<string, string>();
  /** `currency` defaults to EUR, matching the column default the real rows carry. */
  let expenses: (TransactionLike & { currency?: string })[] = [];
  const listExpensesCalls: { from: string; to: string; currency: string }[] = [];

  const budgets = new MemoryBudgetsRepository();
  const allocations = new MemoryAllocationsRepository(budgets);

  const deps: UseCaseDeps = {
    budgets,
    versions: new MemoryAmountVersionsRepository(),
    allocations,
    scopes: new MemoryScopesRepository(),
    usages: new MemoryUsagesRepository(),
    events: new MemoryEventsRepository(),
    transactions: {
      listExpenses: async (_userId, opts) => {
        listExpensesCalls.push({ ...opts });
        return expenses
          .filter((tx) => tx.occurredAt >= opts.from && tx.occurredAt <= opts.to && (tx.currency ?? "EUR") === opts.currency)
          .map(({ currency: _currency, ...tx }) => tx);
      },
    },
    balances: {
      latestBalance: async (_userId, source) => balances.get(`${source.kind}:${source.id}`) ?? null,
    },
    ownership: {
      accountExists: async (_userId, id) => accountOwners.has(id),
      fundExists: async (_userId, id) => fundOwners.has(id),
    },
    clock: { now: () => new Date("2026-09-06T10:00:00.000Z") },
    audit: async (event) => {
      audits.push(event);
    },
    labels: {
      accountName: async (_userId, id) => accountNames.get(id) ?? null,
      fundName: async (_userId, id) => fundNames.get(id) ?? null,
    },
  };

  return {
    deps,
    audits,
    accountOwners,
    fundOwners,
    balances,
    accountNames,
    fundNames,
    listExpensesCalls,
    setExpenses: (rows: (TransactionLike & { currency?: string })[]) => {
      expenses = rows;
    },
  };
}

export async function seedBudget(deps: UseCaseDeps, overrides: Partial<NewBudget> = {}): Promise<Budget> {
  const principal = testPrincipal();
  return deps.budgets.create({
    userId: overrides.userId ?? principal.userId,
    name: overrides.name ?? "Groceries",
    description: overrides.description ?? null,
    currency: overrides.currency ?? "EUR",
    periodKind: overrides.periodKind ?? "monthly",
    startDate: overrides.startDate ?? "2026-01-01",
    endDate: overrides.endDate ?? null,
    goalAmount: overrides.goalAmount ?? null,
    labels: overrides.labels ?? [],
  });
}
