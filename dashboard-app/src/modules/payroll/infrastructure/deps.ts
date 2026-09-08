import type { DbClient } from "@/lib/db/client";
import { recordAudit } from "@/platform/audit/record";
import { payrollContributionSink } from "@/modules/funds/infrastructure/payroll-contribution-sink";
import { payrollTimeoffBalanceSink } from "@/modules/timeoff/infrastructure/payroll-balance-sink";
import type { MappingRuleDeps } from "../application/mapping-rule-deps";
import type { DocumentStore, MalwareScanner, UseCaseDeps } from "../application/ports";
import { DrizzlePayrollComponentsRepository } from "./drizzle-payroll-components-repository";
import { DrizzlePayrollImportsRepository } from "./drizzle-payroll-imports-repository";
import { DrizzlePayrollMappingRulesRepository } from "./drizzle-payroll-mapping-rules-repository";
import { DrizzlePayrollRecordsRepository } from "./drizzle-payroll-records-repository";

export interface PayrollDepsOptions {
  /** Resolved by the caller *before* the transaction opened (Ruling R4-8). */
  documents: DocumentStore;
  /** Resolved by the caller *before* the transaction opened (Ruling R4-8). */
  scanner: MalwareScanner;
  requestId?: string | null;
}

/**
 * The production assembly of `UseCaseDeps`, bound to one transaction. Follows
 * the accounts module's flat shape (the one `interestDeps` and `expenseDeps`
 * also follow): RLS context is opened exactly once by the caller
 * (`withUserContext`/`withSystemContext`), which then builds a fresh deps bag
 * bound to that transaction.
 *
 * `documents` and `scanner` are passed in rather than resolved here, because
 * resolving them is network I/O and decryption — work that must not happen
 * inside the transaction this bag is bound to.
 */
export function payrollDeps(tx: DbClient, opts: PayrollDepsOptions): UseCaseDeps {
  return {
    imports: new DrizzlePayrollImportsRepository(tx),
    records: new DrizzlePayrollRecordsRepository(tx),
    components: new DrizzlePayrollComponentsRepository(tx),
    mappingRules: new DrizzlePayrollMappingRulesRepository(tx),
    funds: payrollContributionSink(tx),
    timeoff: payrollTimeoffBalanceSink(tx),
    documents: opts.documents,
    scanner: opts.scanner,
    clock: { now: () => new Date() },
    audit: (e) => recordAudit(tx, { ...e, requestId: opts.requestId ?? null }),
  };
}

/**
 * The narrow bag the mapping-rule editor runs on — see `MappingRuleDeps` for
 * why it is not `payrollDeps`: those use cases need no document store, and
 * resolving one is decryption plus network I/O that would have to happen
 * before the transaction opens.
 */
export function payrollMappingRuleDeps(tx: DbClient, requestId?: string | null): MappingRuleDeps {
  return {
    mappingRules: new DrizzlePayrollMappingRulesRepository(tx),
    clock: { now: () => new Date() },
    audit: (e) => recordAudit(tx, { ...e, requestId: requestId ?? null }),
  };
}
