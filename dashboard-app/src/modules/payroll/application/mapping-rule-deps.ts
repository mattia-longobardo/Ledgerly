import type { AuditInput } from "@/platform/audit/record";
import type { Clock, PayrollMappingRulesRepository } from "./ports";

/**
 * The slice of `UseCaseDeps` the mapping-rule editor needs.
 *
 * Narrower on purpose: the full payroll bag carries a `DocumentStore` and a
 * `MalwareScanner`, and resolving those is decryption plus network I/O
 * (`withPayroll` in `api/routes.ts` refuses the request outright when no store
 * is configured). Editing a classification rule has nothing to do with
 * documents and must not fail because a store is missing.
 */
export interface MappingRuleDeps {
  mappingRules: PayrollMappingRulesRepository;
  clock: Clock;
  audit(e: AuditInput): Promise<void>;
}
