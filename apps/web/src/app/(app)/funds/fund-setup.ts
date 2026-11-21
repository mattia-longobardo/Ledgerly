// The actions that need two modules at once: payroll owns the payslips' fields, the fund owns the
// competences, and the dependency only ever runs from payroll to funds. A fund fed by the payslip
// is told what the applied payslips accrued as soon as its payslip source exists. So the
// orchestration lives here, in the app layer, where either module may be called.
"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { parseAmount } from "@ledgerly/domain/platform/format";
import {
  feeInputOf,
  fundInputOf,
  type SourceForm,
  sourceInputOf,
  type WizardForm,
} from "@ledgerly/domain/funds";
import { competencesFromPayslips, replaceCompetences } from "@ledgerly/domain/funds";
import { addSource, createFund, FundError, updateSource } from "@ledgerly/domain/funds";
import { appliedPayslips } from "@ledgerly/domain/payroll";
import { requireSession } from "@/platform/auth/session";
import type { Ctx } from "@ledgerly/domain/platform/context";

type ActionResult =
  { ok: true; id?: string; count?: number } | { ok: false; error: string; detail?: string | null };

function failed(error: unknown): { ok: false; error: string; detail?: string | null } {
  if (error instanceof FundError) return { ok: false, error: error.code, detail: error.detail };
  if (error instanceof z.ZodError || error instanceof RangeError) return { ok: false, error: "invalid" };
  throw error;
}

function revalidate(fundId?: string): void {
  revalidatePath("/funds");
  if (fundId) revalidatePath(`/funds/${fundId}`);
  revalidatePath("/payroll");
  revalidatePath("/");
  revalidatePath("/accounts");
}

/** Every applied payslip's competence, published for the funds the payslip feeds. */
async function publish(ctx: Ctx, fundId: string): Promise<number> {
  return replaceCompetences(ctx, fundId, competencesFromPayslips(await appliedPayslips(ctx)));
}

/**
 * "Create fund", the last step of the form: the fund, its account, its sources and its fees, and
 * straight away the competences of the payslips applied before it existed when the payslip feeds it.
 */
export async function createFundAction(form: WizardForm): Promise<ActionResult> {
  const ctx = await requireSession();
  try {
    const fund = await createFund(ctx, {
      fund: fundInputOf(form.fund),
      currency: form.currency || null,
      value:
        form.value.trim() === ""
          ? null
          : { on: form.valueOn, cents: parseAmount(form.value, ctx.numberFormat) },
      sources: form.sources.map((source) => sourceInputOf(source, ctx.numberFormat)),
      fees: form.fees.map((fee) => {
        const { sourceKey, ...input } = feeInputOf(fee, ctx.numberFormat);
        // In this form a fee names a source by its place in the list: `#0`, `#1`.
        return { ...input, sourceIndex: sourceKey === null ? null : Number(sourceKey.slice(1)) };
      }),
    });
    const count = form.sources.some((source) => source.kind === "payroll") ? await publish(ctx, fund.id) : 0;
    revalidate(fund.id);
    return { ok: true, id: fund.id, count };
  } catch (error) {
    return failed(error);
  }
}

/** "Add source" and its edit, from Settings. A new payslip source publishes the applied payslips. */
export async function saveSourceAction(fundId: string, form: SourceForm): Promise<ActionResult> {
  const ctx = await requireSession();
  try {
    const input = sourceInputOf(form, ctx.numberFormat);
    if (form.id === null) await addSource(ctx, fundId, input);
    else await updateSource(ctx, form.id, input);
    const count = form.kind === "payroll" ? await publish(ctx, fundId) : 0;
    revalidate(fundId);
    return { ok: true, id: fundId, count };
  } catch (error) {
    return failed(error);
  }
}

/** Settings › "Rebuild from payslips": the competences read again from every applied payslip. */
export async function rebuildCompetencesAction(fundId: string): Promise<ActionResult> {
  const ctx = await requireSession();
  try {
    const count = await publish(ctx, fundId);
    revalidate(fundId);
    return { ok: true, count };
  } catch (error) {
    return failed(error);
  }
}
