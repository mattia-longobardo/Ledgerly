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

export interface CategoriesRepository {
  list(userId: string, opts?: { includeArchived?: boolean }): Promise<TransactionCategory[]>;
  get(userId: string, id: string): Promise<TransactionCategory | null>;
  findByName(userId: string, name: string): Promise<TransactionCategory | null>;
  /** `(userId, name)` is unique — a caller creating a name that already exists gets "duplicate_name" back, never a thrown constraint error. */
  create(input: NewCategory): Promise<TransactionCategory | "duplicate_name">;
}

export type NewLabel = Omit<TransactionLabel, "id" | "createdAt" | "updatedAt">;

export interface LabelsRepository {
  list(userId: string): Promise<TransactionLabel[]>;
  findByName(userId: string, name: string): Promise<TransactionLabel | null>;
  /** `(userId, name)` is unique — a caller creating a name that already exists gets "duplicate_name" back, never a thrown constraint error. */
  create(input: NewLabel): Promise<TransactionLabel | "duplicate_name">;
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
