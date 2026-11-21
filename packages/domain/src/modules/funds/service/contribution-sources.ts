// Funds · the sources of contributions: added, changed, paused, removed and put back.
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import type { Ctx } from "../../../platform/context";
import { getDb } from "../../../platform/db/client";
import { hasPgError, UNIQUE_VIOLATION } from "../../../platform/db/errors";
import { userScoped } from "../../../platform/db/scope";
import { fundContributionSources, fundFees, fundOperations } from "../schema";
import { type AccrualPeriod, parseDueEntries, type SourceState } from "../sources";
import { matchDebits } from "./debits";
import {
  feeInputSchema,
  type FeeInput,
  FundError,
  type FundFee,
  type FundOperation,
  type FundSource,
  type SourceInput,
  sourceInputSchema,
} from "./model";
import {
  feesOf,
  requireAccount,
  requireFreeComponents,
  requireOpenFund,
  requireSource,
  sourcesOf,
  sourceValues,
  takenComponents,
} from "./reads";

// ——— Sources ————————————————————————————————————————————————————————————————————————————————

/**
 * One active payslip source per fund: a second one — another employer — is added once the first is
 * paused, so that the fund's periods are counted one way at a time.
 */
async function requireOnePayroll(
  ctx: Pick<Ctx, "userId">,
  fundId: string,
  source: { kind: string },
  exceptSourceId?: string,
): Promise<void> {
  if (source.kind !== "payroll") return;
  const active = (await sourcesOf(ctx, [fundId])).some(
    (one) => one.kind === "payroll" && one.state === "active" && one.id !== exceptSourceId,
  );
  if (active) throw new FundError("payroll_active");
}

/** A source added from Settings. More than one debit and more than one payslip source may exist. */
export async function addSource(
  ctx: Pick<Ctx, "userId" | "timeZone">,
  fundId: string,
  input: SourceInput,
): Promise<FundSource> {
  await requireOpenFund(ctx, fundId);
  const parsed = sourceInputSchema.parse(input);
  await requireFreeComponents(ctx, [parsed], { fundId });
  await requireOnePayroll(ctx, fundId, parsed);
  if (parsed.kind === "bank_debit") await requireAccount(ctx, parsed.accountId);
  const [row] = await getDb()
    .insert(fundContributionSources)
    .values(userScoped(ctx).stamp({ fundId, ...sourceValues(parsed) }))
    .returning()
    .catch((error: unknown) => {
      // One "payments by hand" per fund: it only says where the button is.
      if (hasPgError(error, UNIQUE_VIOLATION, "fund_contribution_sources_manual_uq")) {
        throw new FundError("invalid");
      }
      throw error;
    });
  if (parsed.kind === "bank_debit") await matchDebits(ctx, [fundId]);
  return row;
}

/** A source corrected. Its kind stays: a debit does not become a payslip. */
export async function updateSource(
  ctx: Pick<Ctx, "userId" | "timeZone">,
  sourceId: string,
  input: SourceInput,
): Promise<FundSource> {
  const current = await requireSource(ctx, sourceId);
  await requireOpenFund(ctx, current.fundId);
  const parsed = sourceInputSchema.parse(input);
  if (parsed.kind !== current.kind) throw new FundError("invalid");
  if (current.state === "active") await requireFreeComponents(ctx, [parsed], { fundId: current.fundId });
  if (parsed.kind === "bank_debit") await requireAccount(ctx, parsed.accountId);
  const [row] = await getDb()
    .update(fundContributionSources)
    .set(sourceValues(parsed, current))
    .where(and(eq(fundContributionSources.id, sourceId), userScoped(ctx).owns(fundContributionSources)))
    .returning();
  if (parsed.kind === "bank_debit" && row.state === "active") await matchDebits(ctx, [row.fundId]);
  return row;
}

/** Pause a source, or bring it back. A paused debit expects nothing and finds nothing. */
export async function setSourceState(
  ctx: Pick<Ctx, "userId" | "timeZone">,
  sourceId: string,
  state: SourceState,
): Promise<void> {
  const current = await requireSource(ctx, sourceId);
  await requireOpenFund(ctx, current.fundId);
  if (state === "active" && current.kind === "payroll") {
    const holder = (await takenComponents(ctx, { fundId: current.fundId })).get("worker");
    if (holder !== undefined) throw new FundError("component_taken", holder);
    await requireOnePayroll(ctx, current.fundId, { kind: "payroll" }, sourceId);
  }
  await getDb()
    .update(fundContributionSources)
    .set({ state })
    .where(and(eq(fundContributionSources.id, sourceId), userScoped(ctx).owns(fundContributionSources)));
  if (state === "active" && current.kind === "bank_debit") await matchDebits(ctx, [current.fundId]);
}

/**
 * How many contributions each source has. Those of a payslip source are the operations tied to it
 * and the fund's contributions and enrolments tied to no source: the ones a document wrote before
 * release N6 came from the payslips too. With several payslip sources, the untied ones count for
 * the oldest: it was there first.
 */
export function contributionsBySource(
  sources: readonly Pick<FundSource, "id" | "fundId" | "kind">[],
  operations: readonly Pick<FundOperation, "fundId" | "sourceId" | "classification">[],
): Map<string, number> {
  const counts = new Map<string, number>(sources.map((source) => [source.id, 0]));
  for (const operation of operations) {
    if (operation.sourceId !== null) {
      if (counts.has(operation.sourceId)) counts.set(operation.sourceId, counts.get(operation.sourceId)! + 1);
      continue;
    }
    if (operation.classification !== "contribution" && operation.classification !== "enrollment") continue;
    const payroll = sources.find((source) => source.fundId === operation.fundId && source.kind === "payroll");
    if (payroll) counts.set(payroll.id, counts.get(payroll.id)! + 1);
  }
  return counts;
}

interface RemovedSource {
  source: FundSource;
  /** The fees that applied to it alone: they go with it, and come back with it. */
  fees: FundFee[];
}

/**
 * A source with no contribution is removed, with the fees that applied to it alone. One with
 * contributions is not: it is paused, so that its contributions keep their origin.
 */
export async function removeSource(ctx: Pick<Ctx, "userId">, sourceId: string): Promise<RemovedSource> {
  const source = await requireSource(ctx, sourceId);
  await requireOpenFund(ctx, source.fundId);
  const siblings = await sourcesOf(ctx, [source.fundId]);
  const operations = await getDb()
    .select({
      fundId: fundOperations.fundId,
      sourceId: fundOperations.sourceId,
      classification: fundOperations.classification,
    })
    .from(fundOperations)
    .where(and(userScoped(ctx).owns(fundOperations), eq(fundOperations.fundId, source.fundId)));
  const counts = contributionsBySource(siblings, operations);
  if ((counts.get(sourceId) ?? 0) > 0) throw new FundError("has_contributions");
  const fees = (await feesOf(ctx, [source.fundId])).filter((fee) => fee.sourceId === sourceId);
  await getDb()
    .delete(fundContributionSources)
    .where(and(eq(fundContributionSources.id, sourceId), userScoped(ctx).owns(fundContributionSources)));
  return { source, fees };
}

/** The explicit due dates of a source as they are stored: well-formed ones, or `null` for none. */
function explicitDueEntries(value: unknown, period: AccrualPeriod) {
  const entries = parseDueEntries(value, period);
  return entries.length > 0 ? entries : null;
}

/** "Undo" of a removal: the same rows, with the ids they had, so nothing that named them breaks. */
export async function restoreSource(
  ctx: Pick<Ctx, "userId">,
  fundId: string,
  removed: {
    source: SourceInput & { id: string; state: SourceState };
    /** The explicit due dates the source had, as `removeSource` returned them. */
    dueEntries?: unknown;
    fees: (FeeInput & { id: string })[];
  },
): Promise<void> {
  await requireOpenFund(ctx, fundId);
  const { id, state, ...rest } = removed.source;
  const parsed = sourceInputSchema.parse(rest);
  const sourceId = z.uuid().parse(id);
  if (state === "active") {
    await requireFreeComponents(ctx, [parsed], { fundId });
    await requireOnePayroll(ctx, fundId, parsed);
  }
  if (parsed.kind === "bank_debit") await requireAccount(ctx, parsed.accountId);
  const fees = removed.fees.map(({ id: feeId, ...fee }) => ({
    id: z.uuid().parse(feeId),
    ...feeInputSchema.parse({ ...fee, sourceId }),
  }));
  await getDb().transaction(async (tx) => {
    await tx.insert(fundContributionSources).values(
      userScoped(ctx).stamp({
        id: sourceId,
        fundId,
        state: z.enum(["active", "paused"]).parse(state),
        ...sourceValues(parsed),
        ...(parsed.kind === "payroll" && parsed.due === null
          ? { dueEntries: explicitDueEntries(removed.dueEntries, parsed.accrualPeriod) }
          : {}),
      }),
    );
    if (fees.length > 0) {
      await tx.insert(fundFees).values(fees.map((fee) => userScoped(ctx).stamp({ fundId, ...fee })));
    }
  });
}
