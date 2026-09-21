// The two actions that need both modules at once (plan F6 §3.1, §3.6.3): payroll owns the payslips'
// fields, the fund owns the competences, and the dependency only ever runs from payroll to funds.
// So the orchestration lives here, in the app layer, where either module may be called.
"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createPensionFund, replaceCompetences } from "@/modules/funds/pension/service";
import { FundError } from "@/modules/funds/service";
import { appliedCompetences } from "@/modules/payroll/pension";
import { codeMapOf } from "@/modules/payroll/service";
import { requireSession } from "@/platform/auth/session";
import type { Ctx } from "@/platform/context";

export type ActionResult = { ok: true; id?: string; count?: number } | { ok: false; error: string };

function failed(error: unknown): { ok: false; error: string } {
  if (error instanceof FundError) return { ok: false, error: error.code };
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

/** Every applied payslip's competence, published to the fund that takes payroll. */
async function publish(ctx: Ctx, fundId: string): Promise<number> {
  return replaceCompetences(ctx, fundId, await appliedCompetences(ctx, await codeMapOf(ctx)));
}

export interface PensionFundFormInput {
  name: string;
  provider: string;
  compartment: string;
  startOn: string;
}

/**
 * A new pension fund (design "New fund" · pension): its valuation account and its schedule, and
 * straight away the competences of the payslips applied before it existed (plan F6 §3.4.2).
 */
export async function createPensionFundAction(input: PensionFundFormInput): Promise<ActionResult> {
  const ctx = await requireSession();
  try {
    const fund = await createPensionFund(ctx, {
      name: input.name,
      provider: input.provider,
      compartment: input.compartment,
      startOn: input.startOn,
    });
    const count = fund.receivesPayroll ? await publish(ctx, fund.id) : 0;
    revalidate(fund.id);
    return { ok: true, id: fund.id, count };
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
