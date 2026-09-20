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
  proposeDepositRule,
  saveDepositRule,
  setFundState,
  updateDeposit,
  updateFund,
  updateValuation,
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
  input: ValuationFormInput,
): Promise<ActionResult> {
  const ctx = await requireSession();
  try {
    await recordValuation(ctx, fundId, valuationInput(input, ctx));
    revalidate(fundId);
    return { ok: true };
  } catch (error) {
    return failed(error);
  }
}

export interface ValuationFormInput {
  on: string;
  value: string;
  note: string;
}

/**
 * A valuation is a day, an amount and a note. Units are not asked for any more: they are a
 * quantity only the fund's own documents can state, and this app does not ask for those
 * (owner, 2026-09-20). A valuation recorded before still keeps the units it was saved with.
 */
function valuationInput(input: ValuationFormInput, ctx: Ctx) {
  return {
    on: input.on,
    cents: amount(input.value, ctx),
    units: null,
    note: input.note,
  };
}

/** "Edit" on a valuation row: a new day moves the value, it never leaves a second one behind. */
export async function updateValuationAction(
  fundId: string,
  valuationId: string,
  input: ValuationFormInput,
): Promise<ActionResult> {
  const ctx = await requireSession();
  try {
    await updateValuation(ctx, valuationId, valuationInput(input, ctx));
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

/**
 * "Find this charge everywhere": what the app would match on, and what it already finds, before
 * anything is saved (owner, 2026-09-20). Read-only — the rule is saved by
 * {@link saveDepositRuleAction}, with the text this answered.
 */
export async function proposeDepositRuleAction(
  fundId: string,
  transactionId: string,
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
    const detection = await proposeDepositRule(ctx, fundId, transactionId);
    if (detection === null) return { ok: true, found: null };
    return {
      ok: true,
      found: {
        kind: detection.key.kind,
        text: detection.key.text,
        count: detection.charges.length,
        first: detection.first,
        last: detection.last,
        // Cents cross to the browser as text: a bigint is not serialisable (spec §4.3).
        medianCents: detection.medianCents === null ? null : detection.medianCents.toString(),
        intervalDays: detection.intervalDays,
      },
    };
  } catch (error) {
    return failed(error) as { ok: false; error: string };
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
