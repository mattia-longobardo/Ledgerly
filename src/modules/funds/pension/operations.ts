import "server-only";
import { and, asc, desc, inArray } from "drizzle-orm";
import type { Ctx } from "@/platform/context";
import type { CivilDate } from "@/platform/dates";
import { type Db, getDb, type Tx } from "@/platform/db/client";
import { userScoped } from "@/platform/db/scope";
import type { Cents } from "@/platform/money";
import { fundOperations, fundValuations, positionSnapshots, unitMovements } from "../schema";

export type Operation = typeof fundOperations.$inferSelect;
export type UnitMovement = typeof unitMovements.$inferSelect;
export type PositionSnapshot = typeof positionSnapshots.$inferSelect;
type Executor = Db | Tx;

/** One valuation recorded for a fund, with what had been paid in by its day. */
export interface ValuationRow {
  id: string;
  balanceEntryId: string;
  on: CivilDate;
  valueCents: Cents;
  units: string | null;
  note: string | null;
  /** What had been paid in by that day. */
  paidInCents: Cents;
}

const grouped = <T extends { fundId: string }>(
  rows: readonly T[],
  fundIds: readonly string[],
): Map<string, T[]> => {
  const byFund = new Map<string, T[]>(fundIds.map((id) => [id, []]));
  for (const row of rows) byFund.get(row.fundId)?.push(row);
  return byFund;
};

/** The register of each fund, oldest first, with the units each operation moved. One read for all. */
export async function operationsOf(
  ctx: Pick<Ctx, "userId">,
  fundIds: readonly string[],
  executor: Executor = getDb(),
): Promise<Map<string, { operations: Operation[]; movements: UnitMovement[] }>> {
  const out = new Map(
    fundIds.map((id) => [id, { operations: [] as Operation[], movements: [] as UnitMovement[] }]),
  );
  if (fundIds.length === 0) return out;
  const operations = await executor
    .select()
    .from(fundOperations)
    .where(and(inArray(fundOperations.fundId, [...fundIds]), userScoped(ctx).owns(fundOperations)))
    .orderBy(asc(fundOperations.operationDate), asc(fundOperations.id));
  if (operations.length === 0) return out;
  const fundOf = new Map(operations.map((operation) => [operation.id, operation.fundId]));
  for (const operation of operations) out.get(operation.fundId)?.operations.push(operation);
  const movements = await executor
    .select()
    .from(unitMovements)
    .where(
      and(
        userScoped(ctx).owns(unitMovements),
        inArray(
          unitMovements.operationId,
          operations.map((operation) => operation.id),
        ),
      ),
    )
    .orderBy(asc(unitMovements.operationId), asc(unitMovements.position));
  for (const movement of movements) out.get(fundOf.get(movement.operationId)!)?.movements.push(movement);
  return out;
}

/** The valuations recorded for each fund: the note and the units a balance entry has no place for. */
export async function valuationsOf(
  ctx: Pick<Ctx, "userId">,
  fundIds: readonly string[],
  executor: Executor = getDb(),
): Promise<Map<string, (typeof fundValuations.$inferSelect)[]>> {
  if (fundIds.length === 0) return new Map();
  const rows = await executor
    .select()
    .from(fundValuations)
    .where(and(inArray(fundValuations.fundId, [...fundIds]), userScoped(ctx).owns(fundValuations)))
    .orderBy(asc(fundValuations.id));
  return grouped(rows, fundIds);
}

/**
 * The valuations recorded for a fund, as the entries of its account date them: the value is the
 * balance entry's, the note and the units are the valuation's.
 */
export function recordedValuations(
  rows: readonly (typeof fundValuations.$inferSelect)[],
  entries: readonly { id: string; on: CivilDate; balanceCents: Cents }[],
  paidInBy: (on: CivilDate) => Cents,
): ValuationRow[] {
  const byEntry = new Map(rows.map((row) => [row.balanceEntryId, row]));
  return entries
    .filter((entry) => byEntry.has(entry.id))
    .map((entry) => {
      const valuation = byEntry.get(entry.id)!;
      return {
        id: valuation.id,
        balanceEntryId: entry.id,
        on: entry.on,
        valueCents: entry.balanceCents,
        units: valuation.units,
        note: valuation.note,
        paidInCents: paidInBy(entry.on),
      };
    });
}

/** The positions a statement stated before release N6, newest first: history, read only. */
export async function snapshotsOf(
  ctx: Pick<Ctx, "userId">,
  fundIds: readonly string[],
  executor: Executor = getDb(),
): Promise<Map<string, PositionSnapshot[]>> {
  if (fundIds.length === 0) return new Map();
  const rows = await executor
    .select()
    .from(positionSnapshots)
    .where(and(inArray(positionSnapshots.fundId, [...fundIds]), userScoped(ctx).owns(positionSnapshots)))
    .orderBy(desc(positionSnapshots.valuationDate), desc(positionSnapshots.id));
  return grouped(rows, fundIds);
}
