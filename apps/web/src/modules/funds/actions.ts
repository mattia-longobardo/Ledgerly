"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { parseAmount } from "@ledgerly/domain/accounts";
import { requireSession } from "@/platform/auth/session";
import type { Ctx } from "@ledgerly/domain/platform/context";
import {
  type ContributionForm,
  contributionInputOf,
  type FeeForm,
  feeInputOf,
  type FundForm,
  fundInputOf,
  type SourceForm,
  sourceInputOf,
} from "@ledgerly/domain/funds";
import type { Component, Decision } from "@ledgerly/domain/funds";
import { clearDecision, decideDifference } from "@ledgerly/domain/funds";
import {
  addContribution,
  addFee,
  deleteContribution,
  deleteValuation,
  FundError,
  proposeDebitMatch,
  recordValuation,
  removeFee,
  removeSource,
  restoreSource,
  setFundState,
  setSourceState,
  updateContribution,
  updateFee,
  updateFund,
  updateValuation,
} from "@ledgerly/domain/funds";

export type ActionResult =
  | { ok: true; id?: string; dueEntries?: unknown }
  /** `detail` says more about some errors: the fund that holds a payslip component already. */
  | { ok: false; error: string; detail?: string | null };

function failed(error: unknown): { ok: false; error: string; detail?: string | null } {
  if (error instanceof FundError) return { ok: false, error: error.code, detail: error.detail };
  if (error instanceof z.ZodError || error instanceof RangeError) return { ok: false, error: "invalid" };
  throw error;
}

function revalidate(id?: string): void {
  revalidatePath("/funds");
  if (id) revalidatePath(`/funds/${id}`);
  revalidatePath("/");
  revalidatePath("/accounts");
}

const amount = (text: string, ctx: Ctx) => parseAmount(text, ctx.numberFormat);

/** One action, with the session and the errors the forms know how to show. */
async function run(
  fundId: string | undefined,
  work: (ctx: Ctx) => Promise<string | void>,
): Promise<ActionResult> {
  const ctx = await requireSession();
  try {
    const id = await work(ctx);
    revalidate(fundId);
    return { ok: true, id: id ?? fundId };
  } catch (error) {
    return failed(error);
  }
}

// ——— The fund ————————————————————————————————————————————————————————————————————————————————

export async function updateFundAction(id: string, form: FundForm): Promise<ActionResult> {
  return run(id, async (ctx) => {
    await updateFund(ctx, id, fundInputOf(form));
  });
}

export async function setFundStateAction(id: string, state: "active" | "archived"): Promise<ActionResult> {
  return run(id, async (ctx) => {
    await setFundState(ctx, id, z.enum(["active", "archived"]).parse(state));
  });
}

// ——— Valuations —————————————————————————————————————————————————————————————————————————————

export interface ValuationFormInput {
  on: string;
  value: string;
  note: string;
}

/**
 * A valuation is a day, an amount and a note. Units are not asked for: they are a quantity only the
 * fund itself can state, and the app does not ask for its documents (decision 5 of release N6). A
 * valuation recorded before keeps the units it was saved with.
 */
function valuationInput(input: ValuationFormInput, ctx: Ctx) {
  return { on: input.on, cents: amount(input.value, ctx), units: null, note: input.note };
}

export async function recordValuationAction(
  fundId: string,
  input: ValuationFormInput,
): Promise<ActionResult> {
  return run(fundId, async (ctx) => {
    await recordValuation(ctx, fundId, valuationInput(input, ctx));
  });
}

/** "Edit" on a valuation row: a new day moves the value, it never leaves a second one behind. */
export async function updateValuationAction(
  fundId: string,
  valuationId: string,
  input: ValuationFormInput,
): Promise<ActionResult> {
  return run(fundId, async (ctx) => {
    await updateValuation(ctx, valuationId, valuationInput(input, ctx));
  });
}

export async function deleteValuationAction(fundId: string, valuationId: string): Promise<ActionResult> {
  return run(fundId, async (ctx) => {
    await deleteValuation(ctx, valuationId);
  });
}

// ——— Contributions and the other operations ————————————————————————————————————————————————————

/** "Record contribution" and its edit: one form for every operation a person writes. */
export async function saveContributionAction(fundId: string, form: ContributionForm): Promise<ActionResult> {
  return run(fundId, async (ctx) => {
    const input = contributionInputOf(form, ctx.numberFormat);
    if (form.id === null) await addContribution(ctx, fundId, input);
    else await updateContribution(ctx, form.id, input);
  });
}

export async function deleteContributionAction(fundId: string, operationId: string): Promise<ActionResult> {
  return run(fundId, async (ctx) => {
    await deleteContribution(ctx, operationId);
  });
}

// ——— Sources (adding and editing one is in the app layer: a payslip source needs payroll) ———————

export async function setSourceStateAction(
  fundId: string,
  sourceId: string,
  state: "active" | "paused",
): Promise<ActionResult> {
  return run(fundId, async (ctx) => {
    await setSourceState(ctx, sourceId, z.enum(["active", "paused"]).parse(state));
  });
}

/** What "Undo" needs to put a removed source back: its fields and the fees that went with it. */
interface RemovedSourceForm {
  source: SourceForm;
  /** The explicit due dates the removal answered with: the form does not hold them. */
  dueEntries?: unknown;
  fees: FeeForm[];
}

/** Removes a source with no contribution. The answer carries its explicit due dates, for "Undo". */
export async function removeSourceAction(fundId: string, sourceId: string): Promise<ActionResult> {
  const ctx = await requireSession();
  try {
    const { source } = await removeSource(ctx, sourceId);
    revalidate(fundId);
    return { ok: true, id: fundId, dueEntries: source.dueEntries };
  } catch (error) {
    return failed(error);
  }
}

/** "Undo" of a removal: the source comes back with the id it had, and so do its own fees. */
export async function restoreSourceAction(fundId: string, removed: RemovedSourceForm): Promise<ActionResult> {
  return run(fundId, async (ctx) => {
    const { id, state } = removed.source;
    if (id === null) throw new FundError("invalid");
    await restoreSource(ctx, fundId, {
      source: { ...sourceInputOf(removed.source, ctx.numberFormat), id, state },
      dueEntries: removed.dueEntries,
      fees: removed.fees.map((fee) => {
        if (fee.id === null) throw new FundError("invalid");
        const { sourceKey, ...input } = feeInputOf(fee, ctx.numberFormat);
        // A fee comes back with the source it applied to: this one.
        if (sourceKey !== id) throw new FundError("invalid");
        return { ...input, id: fee.id };
      }),
    });
  });
}

// ——— Fees ———————————————————————————————————————————————————————————————————————————————————

/** "Add fee", its edit, and the "Undo" of a removal (`keepId`: the fee comes back as it was). */
export async function saveFeeAction(
  fundId: string,
  form: FeeForm,
  options: { keepId?: boolean } = {},
): Promise<ActionResult> {
  return run(fundId, async (ctx) => {
    const { sourceKey, ...input } = feeInputOf(form, ctx.numberFormat);
    const fee = { ...input, sourceId: sourceKey };
    if (form.id === null) await addFee(ctx, fundId, fee);
    else if (options.keepId) await addFee(ctx, fundId, { ...fee, id: form.id });
    else await updateFee(ctx, form.id, fee);
  });
}

export async function removeFeeAction(fundId: string, feeId: string): Promise<ActionResult> {
  return run(fundId, async (ctx) => {
    await removeFee(ctx, feeId);
  });
}

// ——— "Find this charge everywhere" ——————————————————————————————————————————————————————————

/**
 * What the app would match on, and what it already finds, before anything is saved. Read-only: the
 * source is saved by its own form, with the text this answered.
 */
export async function proposeDebitMatchAction(
  fundId: string,
  transactionId: string,
  accountId: string,
): Promise<
  | {
      ok: true;
      found: {
        kind: "creditor" | "mandate" | "payee";
        text: string;
        count: number;
        first: string | null;
        last: string | null;
        medianCents: string | null;
        intervalDays: number | null;
      } | null;
    }
  | { ok: false; error: string }
> {
  const ctx = await requireSession();
  try {
    const detection = await proposeDebitMatch(ctx, fundId, transactionId, accountId || null);
    if (detection === null) return { ok: true, found: null };
    return {
      ok: true,
      found: {
        kind: detection.key.kind,
        text: detection.key.text,
        count: detection.charges.length,
        first: detection.first,
        last: detection.last,
        medianCents: detection.medianCents === null ? null : detection.medianCents.toString(),
        intervalDays: detection.intervalDays,
      },
    };
  } catch (error) {
    return failed(error);
  }
}

// ——— The reviewer's word on a difference —————————————————————————————————————————————————————

interface DecisionFormInput {
  year: number;
  quarter: number;
  component: string;
  note: string;
  differenceCents: string;
  accruedCents: string | null;
  creditedCents: string | null;
  competenceIds: string[];
  operationIds: string[];
}

const decimal = z.string().regex(/^-?\d+(\.\d{1,2})?$/);

export async function decideDifferenceAction(
  fundId: string,
  input: DecisionFormInput,
): Promise<ActionResult> {
  return run(fundId, async (ctx) => {
    // Cents arrive as the integer text the page printed in `data-` attributes.
    const cents = (value: string | null) =>
      value === null ? null : BigInt(decimal.parse(value).replace(".", ""));
    await decideDifference(ctx, fundId, {
      year: z.number().int().min(1990).max(2200).parse(input.year),
      quarter: input.quarter,
      component: input.component as Component,
      decision: "accepted_difference" as Decision,
      note: input.note,
      differenceCents: cents(input.differenceCents)!,
      accruedCents: cents(input.accruedCents),
      creditedCents: cents(input.creditedCents),
      competenceIds: input.competenceIds,
      operationIds: input.operationIds,
    });
  });
}

export async function clearDecisionAction(
  fundId: string,
  year: number,
  quarter: number,
  component: string,
): Promise<ActionResult> {
  return run(fundId, async (ctx) => {
    await clearDecision(ctx, fundId, year, quarter, component as Component);
  });
}
