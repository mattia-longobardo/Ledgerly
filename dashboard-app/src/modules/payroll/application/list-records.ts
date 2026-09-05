import type { Principal } from "@/platform/auth/principal";
import { assertPermission } from "@/platform/auth/principal";
import { summariseEarnings, type EarningsSummary } from "../domain/earnings";
import type { ListRecordsOptions, PayrollComponent, PayrollRecord, UseCaseDeps } from "./ports";
import { NotFoundError } from "./errors";

export interface RecordDetail {
  record: PayrollRecord;
  components: PayrollComponent[];
}

export function listRecords(deps: UseCaseDeps) {
  return async (principal: Principal, opts: ListRecordsOptions = {}): Promise<PayrollRecord[]> => {
    assertPermission(principal, "payroll.read");
    return deps.records.list(principal.userId, opts);
  };
}

export function getRecord(deps: UseCaseDeps) {
  return async (principal: Principal, id: string): Promise<RecordDetail> => {
    assertPermission(principal, "payroll.read");
    const record = await deps.records.get(principal.userId, id);
    if (!record) throw new NotFoundError("Payroll record not found");
    return { record, components: await deps.components.listForRecord(record.id) };
  };
}

/**
 * Spec §5.8 calls `earnings_summaries` a view over records and components; here
 * it is a use case, because the buckets it produces (month, quarter, year) are
 * the shape the Earnings page and the Company Overview both want and a view
 * would have to be queried three times to give.
 *
 * Superseded records are excluded by `listRecords`'s default, which is what
 * makes a corrected month appear exactly once (Ruling R4-4).
 */
export function earningsSummary(deps: UseCaseDeps) {
  return async (principal: Principal, opts: ListRecordsOptions = {}): Promise<EarningsSummary> => {
    assertPermission(principal, "payroll.read");
    const records = await deps.records.list(principal.userId, opts);
    const components = await deps.components.listForRecords(records.map((r) => r.id));
    return summariseEarnings(records, components);
  };
}
