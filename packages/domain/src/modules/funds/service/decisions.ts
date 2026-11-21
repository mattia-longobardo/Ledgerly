// «Accept the difference» (rewrite plan R2, decision 3 of the step of funds): the reviewer gives the
// note, and the difference, the amounts and the lines it is about are the server's own, read from
// its reconciliation of the same instant. The Server Action and the route call this one use case.
import type { Ctx } from "../../../platform/context";
import { decideDifference } from "../pension/service";
import type { Component } from "../pension/rules";
import { fundDetail } from "../queries";
import { FundError } from "./model";

export async function acceptDifference(
  ctx: Pick<Ctx, "userId" | "timeZone">,
  fundId: string,
  input: { year: number; quarter: number; component: Component; note: string },
  now: Date = new Date(),
): Promise<void> {
  const detail = await fundDetail(ctx, fundId, now);
  const quarter = detail.quarters.find((one) => one.year === input.year && one.quarter === input.quarter);
  const line = quarter?.components.find((one) => one.component === input.component);
  if (!line) throw new FundError("invalid");
  await decideDifference(ctx, fundId, {
    year: input.year,
    quarter: input.quarter,
    component: input.component,
    decision: "accepted_difference",
    note: input.note,
    // As the page printed it: a difference nobody can compute yet is accepted as zero.
    differenceCents: line.differenceCents ?? 0n,
    accruedCents: line.accruedCents,
    creditedCents: line.creditedCents,
    competenceIds: line.competenceIds,
    operationIds: line.operationIds,
  });
}
