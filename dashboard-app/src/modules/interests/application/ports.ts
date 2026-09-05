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
  /**
   * Returns whether it actually affected a row — `false` for a wrong owner
   * or simply a wrong id. A caller that posts money to an external provider
   * and then calls this must treat `false` as a failure, not as success:
   * silently doing nothing here is exactly how the same interest gets posted
   * twice on the next run.
   */
  markPosted(id: string, entryId: string, postedAt: Date): Promise<boolean>;
  /**
   * Ruling P3-C39: the actual defence against a double post. Atomically sets
   * `postedAt` only if it is currently null — a durable, committed database
   * row, not the job's in-process advisory lock, which can be released
   * mid-flight by a killed connection while a Wallet POST is still in the
   * air (see `src/lib/jobs/interest-accrual.ts`'s `tryPost`). Returns
   * whether *this* call won the claim; a `false` means another run already
   * claimed (or fully posted) this accrual, and the caller must not proceed
   * to call the provider at all.
   *
   * Called in its own short, already-committed transaction, strictly before
   * any Wallet round trip — never held open across one.
   */
  claimForPosting(id: string, claimedAt: Date): Promise<boolean>;
  /**
   * Releases a claim that provably never reached the provider (a Wallet
   * *read* failed, or the crash-recovery check found nothing and refused a
   * mismatched amount) — reverts `postedAt` to null so a later run may try
   * again. Refuses to touch a row whose `entryId` is already set: that would
   * let a confirmed post be re-attempted. Deliberately does nothing (and
   * reports nothing) for a Wallet *write* failure — that case is ambiguous
   * (the POST may have landed) and must be left as the in-flight state
   * (`postedAt` set, `entryId` still null) for an operator to reconcile,
   * never silently retried.
   */
  releaseClaim(id: string): Promise<void>;
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

/**
 * Ruling P3-C42 (B7): the only thing standing between "a rule's accountId"
 * and "an account owned by someone else" used to be an incidental filter
 * three layers away (the balance lookup's own join). This is the explicit
 * check `createInterestRule` calls before ever persisting a rule.
 */
export interface AccountOwnershipCheck {
  ownedByUser(userId: string, accountId: string): Promise<boolean>;
}

export interface Clock {
  now(): Date;
}

export interface UseCaseDeps {
  rules: InterestRulesRepository;
  accruals: InterestAccrualsRepository;
  entries: InterestEntriesRepository;
  balances: AccountBalanceLookup;
  accounts: AccountOwnershipCheck;
  clock: Clock;
  audit(e: AuditInput): Promise<void>;
}
