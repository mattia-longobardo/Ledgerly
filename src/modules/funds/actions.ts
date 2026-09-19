// src/modules/funds/actions.ts — the Funds Server Actions (spec §4.2): validate → service →
// revalidate. Amounts and the TER arrive as typed text, in the user's own number format.
"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { parseAmount } from "@/modules/accounts/rules";
import { percentToFraction } from "@/modules/interests/rules";
import { requireSession } from "@/platform/auth/session";
import type { Ctx } from "@/platform/context";
import {
  addDeposit,
  createFund,
  deleteDeposit,
  deleteValuation,
  FundError,
  recordValuation,
  saveDepositRule,
  setFundState,
  updateDeposit,
  updateFund,
} from "./service";

export type ActionResult = { ok: true; id?: string } | { ok: false; error: string };

function failed(error: unknown): { ok: false; error: string } {
  if (error instanceof FundError) return { ok: false, error: error.code };
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
const optionalAmount = (text: string, ctx: Ctx) => (text.trim() === "" ? null : amount(text, ctx));

/** "1,2" % in Italian, "1.2" in English, as the stored fraction; empty is no TER. */
function ter(text: string, ctx: Ctx): string | null {
  const cleaned = text.replace(/[\s %]/g, "");
  if (cleaned === "") return null;
  const plain =
    ctx.numberFormat === "en-US"
      ? cleaned.replaceAll(",", "")
      : cleaned.replaceAll(".", "").replace(",", ".");
  return percentToFraction(plain);
}

export interface FundFormInput {
  name: string;
  provider: string;
  isin: string;
  compartment: string;
  debitAccountId: string;
  debitDay: string;
  ter: string;
  startOn: string;
  monthly: string;
  fee: string;
}

function toInput(input: FundFormInput, ctx: Ctx) {
  return {
    name: input.name,
    provider: input.provider,
    isin: input.isin.trim().toUpperCase(),
    compartment: input.compartment,
    debitAccountId: input.debitAccountId || null,
    debitDay: input.debitDay.trim() === "" ? null : Number(input.debitDay),
    ter: ter(input.ter, ctx),
    startOn: input.startOn,
    monthlyCents: optionalAmount(input.monthly, ctx),
    depositFeeCents: optionalAmount(input.fee, ctx),
  };
}

export async function createFundAction(
  input: FundFormInput & { valuationAccountId: string; initial: string },
): Promise<ActionResult> {
  const ctx = await requireSession();
  try {
    const fund = await createFund(ctx, {
      ...toInput(input, ctx),
      valuationAccountId: input.valuationAccountId || null,
      initialCents: optionalAmount(input.initial, ctx),
    });
    revalidate(fund.id);
    return { ok: true, id: fund.id };
  } catch (error) {
    return failed(error);
  }
}

export async function updateFundAction(id: string, input: FundFormInput): Promise<ActionResult> {
  const ctx = await requireSession();
  try {
    await updateFund(ctx, id, toInput(input, ctx));
    revalidate(id);
    return { ok: true, id };
  } catch (error) {
    return failed(error);
  }
}

export async function setFundStateAction(id: string, state: "active" | "archived"): Promise<ActionResult> {
  const ctx = await requireSession();
  try {
    await setFundState(ctx, id, z.enum(["active", "archived"]).parse(state));
    revalidate(id);
    return { ok: true, id };
  } catch (error) {
    return failed(error);
  }
}

export async function recordValuationAction(
  fundId: string,
  input: { on: string; value: string; units: string; note: string },
): Promise<ActionResult> {
  const ctx = await requireSession();
  try {
    const units = input.units.trim() === "" ? null : input.units.trim().replace(",", ".");
    await recordValuation(ctx, fundId, {
      on: input.on,
      cents: amount(input.value, ctx),
      units,
      note: input.note,
    });
    revalidate(fundId);
    return { ok: true };
  } catch (error) {
    return failed(error);
  }
}

export async function deleteValuationAction(fundId: string, valuationId: string): Promise<ActionResult> {
  const ctx = await requireSession();
  try {
    await deleteValuation(ctx, valuationId);
    revalidate(fundId);
    return { ok: true };
  } catch (error) {
    return failed(error);
  }
}

export interface DepositFormInput {
  on: string;
  debited: string;
  fee: string;
  note: string;
}

function depositInput(input: DepositFormInput, ctx: Ctx) {
  return {
    on: input.on,
    chargedCents: amount(input.debited, ctx),
    feeCents: optionalAmount(input.fee, ctx),
    note: input.note.trim() === "" ? null : input.note.trim(),
  };
}

export async function saveDepositAction(
  fundId: string,
  depositId: string | null,
  input: DepositFormInput,
): Promise<ActionResult> {
  const ctx = await requireSession();
  try {
    if (depositId === null) await addDeposit(ctx, fundId, depositInput(input, ctx));
    else await updateDeposit(ctx, depositId, depositInput(input, ctx));
    revalidate(fundId);
    return { ok: true };
  } catch (error) {
    return failed(error);
  }
}

export async function deleteDepositAction(fundId: string, depositId: string): Promise<ActionResult> {
  const ctx = await requireSession();
  try {
    await deleteDeposit(ctx, depositId);
    revalidate(fundId);
    return { ok: true };
  } catch (error) {
    return failed(error);
  }
}

export async function saveDepositRuleAction(
  fundId: string,
  input: { payeeMatch: string; accountId: string; active: boolean },
): Promise<ActionResult> {
  const ctx = await requireSession();
  try {
    await saveDepositRule(ctx, fundId, { ...input, accountId: input.accountId || null });
    revalidate(fundId);
    return { ok: true };
  } catch (error) {
    return failed(error);
  }
}
