import type { Principal } from "@/platform/auth/principal";
import { assertPermission } from "@/platform/auth/principal";
import { componentsFromExtraction, grossOf, netOf } from "../domain/components";
import { monthOfPeriod, periodFor, recordKindOf } from "../domain/period";
import type { PayrollComponent, PayrollImport, PayrollRecord, UseCaseDeps } from "./ports";
import { ConflictError, InvalidInputError, NotFoundError } from "./errors";

export interface AppliedImport {
  import: PayrollImport;
  record: PayrollRecord;
  components: PayrollComponent[];
  /** The record this apply superseded, or null when the period was free. */
  supersededRecordId: string | null;
  fundContributions: {
    written: number;
    skipped: { fundSlug: string; reason: "no_fund" | "no_amount" }[];
  };
  /** R7-4: one `timeoff_balances` row per (type, record), written by the sink. */
  timeoffBalances: {
    written: number;
    /** Codes the payslip named that this user has no type for. */
    skipped: string[];
  };
}

/**
 * Turns a verified import into the money: one `payroll_record`, its
 * `payroll_components`, and the mapped `fund_contributions` rows.
 *
 * Every write here is Postgres-only, so this is the one use case in the module
 * that runs start to finish inside the caller's single transaction — which is
 * exactly what makes the supersede-then-insert of Ruling R4-4 safe against
 * `payroll_records_period_uq`: the old record is marked superseded and the new
 * one inserted with no committed moment in between where either two live
 * records or none exist.
 *
 * Idempotent and re-runnable, not reversible. Re-applying recomputes the
 * record's fields, bumps its version and replaces its components wholesale.
 * There is no `unapply`: the reverse of a wrong apply is a replacement import
 * that supersedes it, because the derived rows have no pre-state to restore.
 */
export function applyImport(deps: UseCaseDeps) {
  return async (principal: Principal, importId: string): Promise<AppliedImport> => {
    assertPermission(principal, "payroll.review");
    const found = await deps.imports.get(principal.userId, importId);
    if (!found) throw new NotFoundError();
    if (found.status !== "verified") {
      throw new ConflictError("Only a verified import can be applied.", "not_verified");
    }
    if (!found.extraction) throw new ConflictError("This import has no extraction to apply.", "not_verified");
    const month = found.extraction.month;
    if (!month) {
      throw new InvalidInputError("This payslip has no pay period. Set the month on the review screen first.");
    }

    const period = periodFor(month);
    const kind = recordKindOf(found.extraction.isThirteenth);
    // `listFor` already returns the global catalogue plus this user's own
    // rules (both backends honor that contract — see
    // `DrizzlePayrollMappingRulesRepository.listFor`), so there is nothing to
    // merge here.
    const rules = await deps.mappingRules.listFor(principal.userId);
    const components = componentsFromExtraction(found.extraction, rules);
    const now = deps.clock.now();

    const existing = await deps.records.getByImport(principal.userId, importId);
    let record: PayrollRecord;
    let supersededRecordId: string | null = null;

    if (existing) {
      // A re-apply. The period is already this record's own, so nothing is
      // superseded and `payroll_records_period_uq` is untouched.
      const updated = await deps.records.update(principal.userId, existing.id, {
        periodEnd: period.periodEnd,
        gross: grossOf(components),
        net: netOf(components),
        corrections: found.extraction.fields,
      });
      if (!updated) throw new NotFoundError();
      record = updated;
    } else {
      const live = await deps.records.liveForPeriod(principal.userId, period.periodStart, kind);
      if (live) {
        // Ruling R4-4. Marking the old record superseded *first* is what frees
        // the partial unique index for the insert below, inside this one
        // transaction.
        supersededRecordId = live.id;
        await deps.records.supersede(principal.userId, live.id, live.id, now);
      }
      record = await deps.records.create({
        userId: principal.userId,
        importId,
        periodStart: period.periodStart,
        periodEnd: period.periodEnd,
        payDate: null,
        kind,
        currency: "EUR",
        gross: grossOf(components),
        net: netOf(components),
        verifiedAt: now,
        verifiedBy: principal.userId,
        corrections: found.extraction.fields,
      });
      if (supersededRecordId) {
        // The forward pointer needs the new record's id, which did not exist a
        // moment ago. Same transaction, so no reader ever sees the gap.
        await deps.records.supersede(principal.userId, supersededRecordId, record.id, now);
        await deps.imports.patch(principal.userId, live!.importId, { status: "superseded" });
      }
    }

    const written = await deps.components.replaceForRecord(record.id, components);

    const accrualMonth = monthOfPeriod(period.periodStart);
    const fundContributions = await deps.funds.writeForRecord({
      userId: principal.userId,
      payrollRecordId: record.id,
      supersededRecordId,
      rows: components.flatMap((component) => {
        const target = component.mappedTo;
        return target?.kind === "fund_contribution" ? [{
          fundSlug: target.fundSlug,
          part: target.part,
          accrualMonth,
          amount: component.amount,
          currency: component.currency,
        }] : [];
      }),
    });

    // R7-4. After the fund sink and inside the same transaction, so a record
    // and the balances derived from it are never separately visible.
    const timeoffBalances = await deps.timeoff.writeForRecord({
      userId: principal.userId,
      payrollRecordId: record.id,
      supersededRecordId,
      asOf: period.periodEnd,
      rows: components.flatMap((component) => {
        const target = component.mappedTo;
        if (target?.kind !== "timeoff_balance" && target?.kind !== "timeoff_used") return [];
        return [{
          timeoffCode: target.timeoffCode,
          kind: target.kind === "timeoff_balance" ? "balance" as const : "used" as const,
          // A leave figure is a quantity; `amount` is the fallback for a
          // payslip that states it in the money column.
          quantity: component.quantity ?? component.amount,
          unit: component.unit === "days" ? "days" as const : "hours" as const,
        }];
      }),
    });

    const updatedImport = await deps.imports.patch(principal.userId, importId, { status: "applied", error: null });
    if (!updatedImport) throw new NotFoundError();

    await deps.audit({
      actorUserId: principal.userId,
      action: "payroll.import_applied",
      entityType: "payroll_import",
      entityId: importId,
      // Ids and counts. The amounts are on the record; repeating them here would
      // make `audit_events` a second, unredacted copy of the payslip.
      after: {
        recordId: record.id,
        periodStart: period.periodStart,
        kind,
        componentCount: written.length,
        supersededRecordId,
        fundContributions,
        timeoffBalances,
      },
    });

    return {
      import: updatedImport,
      record,
      components: written,
      supersededRecordId,
      fundContributions,
      timeoffBalances,
    };
  };
}
