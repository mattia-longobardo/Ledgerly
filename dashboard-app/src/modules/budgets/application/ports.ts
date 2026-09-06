import type { AuditInput } from "@/platform/audit/record";
import type { AllocationLike, AmountVersionLike, UsageLike } from "../domain/figures";
import type { ScopeLike, TransactionLike } from "../domain/scopes";

export interface Budget {
  id: string;
  userId: string;
  name: string;
  description: string | null;
  currency: string;
  status: "active" | "archived";
  periodKind: "none" | "monthly" | "quarterly" | "annual" | "custom";
  startDate: string;
  endDate: string | null;
  goalAmount: string | null;
  labels: string[];
  archivedAt: Date | null;
  version: number;
  createdAt: Date;
  updatedAt: Date;
}

export type NewBudget = Pick<
  Budget,
  "userId" | "name" | "description" | "currency" | "periodKind" | "startDate" | "endDate" | "goalAmount" | "labels"
>;

export type BudgetPatch = Partial<
  Pick<Budget, "name" | "description" | "periodKind" | "startDate" | "endDate" | "goalAmount" | "labels" | "status" | "archivedAt">
>;

export interface AmountVersion extends AmountVersionLike {
  id: string;
  budgetId: string;
  reason: string | null;
  actorUserId: string | null;
  createdAt: Date;
}

export interface Allocation extends AllocationLike {
  budgetId: string;
  note: string | null;
  actorUserId: string | null;
  version: number;
  createdAt: Date;
  updatedAt: Date;
}

export interface Scope extends ScopeLike {
  id: string;
  budgetId: string;
}

export interface Usage extends UsageLike {
  id: string;
  budgetId: string;
  transactionId: string | null;
  matchedBy: "scope" | "manual";
  note: string | null;
  createdAt: Date;
}

export interface BudgetEvent {
  id: string;
  budgetId: string;
  kind: string;
  detail: Record<string, unknown>;
  actorUserId: string | null;
  createdAt: Date;
}

export interface BudgetsRepository {
  /** Ordered name asc. */
  list(userId: string, opts?: { includeArchived?: boolean }): Promise<Budget[]>;
  get(userId: string, id: string): Promise<Budget | null>;
  create(input: NewBudget): Promise<Budget>;
  update(userId: string, id: string, expectedVersion: number, patch: BudgetPatch): Promise<Budget | null>;
}

export interface AmountVersionsRepository {
  /** Ordered effectiveFrom asc. */
  listForBudget(budgetId: string): Promise<AmountVersion[]>;
  /** Upsert on (budgetId, effectiveFrom). */
  add(input: Omit<AmountVersion, "id" | "createdAt">): Promise<AmountVersion>;
}

export interface AllocationsRepository {
  /** Ordered effectiveFrom asc, id asc. */
  listForBudget(budgetId: string): Promise<Allocation[]>;
  /** Across all the user's budgets. */
  listAgainstSource(userId: string, sourceKind: "fund" | "account", sourceId: string): Promise<Allocation[]>;
  get(budgetId: string, id: string): Promise<Allocation | null>;
  create(input: Omit<Allocation, "id" | "version" | "createdAt" | "updatedAt">): Promise<Allocation>;
  update(
    budgetId: string,
    id: string,
    expectedVersion: number,
    patch: Partial<Pick<Allocation, "effectiveTo" | "note">>,
  ): Promise<Allocation | null>;
}

export interface ScopesRepository {
  listForBudget(budgetId: string): Promise<Scope[]>;
  replace(budgetId: string, scopes: readonly ScopeLike[]): Promise<Scope[]>;
}

export interface UsagesRepository {
  /** Ordered occurredAt asc, id asc. */
  listForBudget(budgetId: string, opts?: { from?: string; to?: string }): Promise<Usage[]>;
  get(budgetId: string, id: string): Promise<Usage | null>;
  create(input: Omit<Usage, "id" | "createdAt">): Promise<Usage>;
  delete(budgetId: string, id: string): Promise<boolean>;
  /** R6-3: keyed by transactionId; manual rows are never touched. */
  replaceScopeMatched(
    budgetId: string,
    rows: readonly { transactionId: string; amount: string; occurredAt: string }[],
  ): Promise<{ inserted: number; updated: number; deleted: number }>;
}

export interface EventsRepository {
  /** Ordered createdAt desc. */
  listForBudget(budgetId: string, limit?: number): Promise<BudgetEvent[]>;
  add(input: Omit<BudgetEvent, "id" | "createdAt">): Promise<BudgetEvent>;
}

export interface TransactionsScopeSource {
  /** type = 'expense', any state; occurredAt as "YYYY-MM-DD" in Europe/Rome; labelIds joined. */
  listExpenses(userId: string, opts: { from: string; to: string }): Promise<TransactionLike[]>;
}

export interface SourceBalanceSource {
  /** account → latest account_balances; fund → its linked account's latest balance; null when unknown or unlinked. */
  latestBalance(userId: string, source: { kind: "fund" | "account"; id: string }): Promise<string | null>;
}

export interface OwnershipCheck {
  accountExists(userId: string, id: string): Promise<boolean>;
  fundExists(userId: string, id: string): Promise<boolean>;
}

export interface Clock {
  now(): Date;
}

export interface UseCaseDeps {
  budgets: BudgetsRepository;
  versions: AmountVersionsRepository;
  allocations: AllocationsRepository;
  scopes: ScopesRepository;
  usages: UsagesRepository;
  events: EventsRepository;
  transactions: TransactionsScopeSource;
  balances: SourceBalanceSource;
  ownership: OwnershipCheck;
  clock: Clock;
  audit: (e: AuditInput) => Promise<void>;
}
