import type { AuditInput } from "@/platform/audit/record";
import type { Cadence, DetectedPattern, PatternSign } from "../domain/recurring";
import type { RecordSource, Transaction, TransactionCategory, TransactionLabel } from "../domain/transaction";

export type NewTransaction = Omit<Transaction, "id" | "version" | "createdAt" | "updatedAt">;
export type TransactionPatch = Partial<Pick<Transaction, "categoryId" | "note" | "state" | "payee" | "transferGroupId">>;

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

/**
 * `transaction_categories` carries no `version` column, so an update is a plain
 * last-writer-wins patch rather than an optimistic one. Every field here is
 * optional and `undefined` means "leave alone"; `null` on a nullable field
 * means "clear it".
 */
export interface CategoryPatch {
  name?: string;
  color?: string | null;
  parentId?: string | null;
  archivedAt?: Date | null;
}

export interface CategoriesRepository {
  list(userId: string, opts?: { includeArchived?: boolean }): Promise<TransactionCategory[]>;
  get(userId: string, id: string): Promise<TransactionCategory | null>;
  findByName(userId: string, name: string): Promise<TransactionCategory | null>;
  /** `(userId, name)` is unique — a caller creating a name that already exists gets "duplicate_name" back, never a thrown constraint error. */
  create(input: NewCategory): Promise<TransactionCategory | "duplicate_name">;
  /** Null when no such row belongs to the caller; `"duplicate_name"` when the rename collides. */
  update(userId: string, id: string, patch: CategoryPatch): Promise<TransactionCategory | "duplicate_name" | null>;
}

export type NewLabel = Omit<TransactionLabel, "id" | "createdAt" | "updatedAt">;

/** Same shape and same reasoning as `CategoryPatch`: `transaction_labels` has no `version` either. */
export interface LabelPatch {
  name?: string;
  color?: string | null;
}

export interface LabelsRepository {
  list(userId: string): Promise<TransactionLabel[]>;
  get(userId: string, id: string): Promise<TransactionLabel | null>;
  findByName(userId: string, name: string): Promise<TransactionLabel | null>;
  /** `(userId, name)` is unique — a caller creating a name that already exists gets "duplicate_name" back, never a thrown constraint error. */
  create(input: NewLabel): Promise<TransactionLabel | "duplicate_name">;
  /** Null when no such row belongs to the caller; `"duplicate_name"` when the rename collides. */
  update(userId: string, id: string, patch: LabelPatch): Promise<TransactionLabel | "duplicate_name" | null>;
}

export interface RecurringPatternRecord {
  id: string;
  userId: string;
  payee: string;
  cadence: Cadence;
  amountLow: string;
  amountHigh: string;
  currency: string;
  sign: PatternSign;
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
