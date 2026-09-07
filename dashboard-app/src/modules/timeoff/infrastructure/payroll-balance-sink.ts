import type { DbClient } from "@/lib/db/client";
import type { TimeoffBalanceSink } from "@/modules/payroll/application/ports";
import { addQuantity } from "../domain/units";
import { seedDefaultTypes } from "../application/ensure-default-types";
import type { BalancesRepository, TypesRepository } from "../application/ports";
import { DrizzleBalancesRepository } from "./drizzle-balances-repository";
import { DrizzleTypesRepository } from "./drizzle-types-repository";
import { hoursPerDayString } from "./deps";

export interface TimeoffBalanceSinkRepositories {
  types: TypesRepository;
  balances: BalancesRepository;
  hoursPerDay(): Promise<string>;
}

/**
 * R7-4: `timeoff_balances` is written by the payroll apply step and by nothing
 * else. One row per (type, record): `remaining` from the payslip's
 * `timeoff_balance` component, `used` from its `timeoff_used` component, both
 * as of the period end.
 *
 * A code the user has no type for lands in `skipped` rather than throwing — a
 * payslip naming an allowance this install does not model must not fail an
 * apply that is otherwise correct.
 */
export function createTimeoffBalanceSink(
  repositories: TimeoffBalanceSinkRepositories,
): TimeoffBalanceSink {
  return {
    async writeForRecord(input) {
      // A fresh user has no types yet: an apply is often the first thing that
      // ever touches this module for them, so the seed happens here too.
      const types = await seedDefaultTypes(
        repositories.types,
        input.userId,
        await repositories.hoursPerDay(),
      );
      const byCode = new Map(types.map((type) => [type.code as string, type]));

      const grouped = new Map<string, {
        remaining: string | null;
        used: string | null;
        unit: "hours" | "days";
      }>();
      const skipped: string[] = [];

      for (const row of input.rows) {
        if (!byCode.has(row.timeoffCode)) {
          if (!skipped.includes(row.timeoffCode)) skipped.push(row.timeoffCode);
          continue;
        }
        const entry = grouped.get(row.timeoffCode)
          ?? { remaining: null, used: null, unit: row.unit };
        // The parser writes leave quantities with six decimals; the column and
        // every port in this module carry two. `addQuantity` is the one place
        // that scale conversion happens.
        const quantity = addQuantity(row.quantity, null);
        if (row.kind === "balance") entry.remaining = quantity;
        else entry.used = quantity;
        // The payslip states hours for both figures; the last one seen wins the
        // unit, and they only ever disagree if the payslip itself does.
        entry.unit = row.unit;
        grouped.set(row.timeoffCode, entry);
      }

      // Replace wholesale, exactly as the fund sink does: a re-apply whose
      // mapping dropped a code must not leave that code's old row behind.
      const recordIds = [...new Set([
        input.payrollRecordId,
        ...(input.supersededRecordId ? [input.supersededRecordId] : []),
      ])];
      for (const recordId of recordIds) {
        await repositories.balances.deleteByPayrollRecord(input.userId, recordId);
      }

      let written = 0;
      for (const [code, entry] of grouped) {
        const type = byCode.get(code)!;
        await repositories.balances.upsertForRecord({
          userId: input.userId,
          typeId: type.id,
          asOf: input.asOf,
          accrued: null,
          used: entry.used,
          remaining: entry.remaining,
          pending: null,
          unit: entry.unit,
          source: "payroll",
          payrollRecordId: input.payrollRecordId,
        });
        written += 1;
      }

      return { written, skipped };
    },
  };
}

export function payrollTimeoffBalanceSink(tx: DbClient): TimeoffBalanceSink {
  return createTimeoffBalanceSink({
    types: new DrizzleTypesRepository(tx),
    balances: new DrizzleBalancesRepository(tx),
    hoursPerDay: hoursPerDayString,
  });
}
