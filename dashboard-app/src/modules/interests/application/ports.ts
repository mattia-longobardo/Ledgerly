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
