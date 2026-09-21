// src/modules/subscriptions/actions.ts — the Subscriptions Server Actions (spec §4.2): validate →
// service → revalidate. Amounts and the tolerance arrive as typed text, in the user's number format.
"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { parseAmount } from "@/modules/accounts/rules";
import { requireSession } from "@/platform/auth/session";
import type { Ctx } from "@/platform/context";
import { CYCLES } from "./rules";
import {
  createSubscription,
  deleteSubscription,
  setSubscriptionState,
  setUtility,
  SubscriptionError,
  updateSubscription,
} from "./service";

export type ActionResult = { ok: true } | { ok: false; error: string };

function failed(error: unknown): { ok: false; error: string } {
  if (error instanceof SubscriptionError) return { ok: false, error: error.code };
  if (error instanceof z.ZodError || error instanceof RangeError) return { ok: false, error: "invalid" };
  throw error;
}

function revalidate(): void {
  revalidatePath("/subscriptions");
  revalidatePath("/");
}

export interface SubscriptionFormInput {
  name: string;
  categoryId: string | null;
  paymentAccountId: string | null;
  price: string;
  cycle: string;
  nextChargeOn: string;
  payeeMatch: string;
  /** Percent, as typed: "5" or "2,5". */
  tolerance: string;
  utility: number;
}

/**
 * A typed percentage as the stored fraction, exactly: "2,5" % is "0.0250". Read as an amount with
 * two decimals, so the same parser (and the same number format) as every other figure applies.
 */
function toleranceFraction(percent: string, ctx: Ctx): string {
  const hundredths = parseAmount(percent.trim() === "" ? "5" : percent, ctx.numberFormat);
  if (hundredths < 0n || hundredths > 10_000n) throw new RangeError("Tolerance out of range");
  return `${hundredths / 10_000n}.${(hundredths % 10_000n).toString().padStart(4, "0")}`;
}

function toInput(input: SubscriptionFormInput, ctx: Ctx) {
  return {
    name: input.name,
    categoryId: input.categoryId || null,
    paymentAccountId: input.paymentAccountId || null,
    priceCents: parseAmount(input.price, ctx.numberFormat),
    cycle: z.enum(CYCLES).parse(input.cycle),
    nextChargeOn: input.nextChargeOn,
    payeeMatch: input.payeeMatch,
    tolerance: toleranceFraction(input.tolerance, ctx),
    utility: input.utility,
  };
}

export async function createSubscriptionAction(input: SubscriptionFormInput): Promise<ActionResult> {
  const ctx = await requireSession();
  try {
    await createSubscription(ctx, toInput(input, ctx));
    revalidate();
    return { ok: true };
  } catch (error) {
    return failed(error);
  }
}

export async function updateSubscriptionAction(
  id: string,
  input: SubscriptionFormInput,
): Promise<ActionResult> {
  const ctx = await requireSession();
  try {
    await updateSubscription(ctx, id, toInput(input, ctx));
    revalidate();
    return { ok: true };
  } catch (error) {
    return failed(error);
  }
}

export async function setUtilityAction(id: string, utility: number): Promise<ActionResult> {
  const ctx = await requireSession();
  try {
    await setUtility(ctx, id, utility);
    revalidate();
    return { ok: true };
  } catch (error) {
    return failed(error);
  }
}

export async function setSubscriptionStateAction(
  id: string,
  state: "active" | "paused" | "cancelled",
): Promise<ActionResult> {
  const ctx = await requireSession();
  try {
    await setSubscriptionState(ctx, id, z.enum(["active", "paused", "cancelled"]).parse(state));
    revalidate();
    return { ok: true };
  } catch (error) {
    return failed(error);
  }
}

/** Throws away a cancelled subscription and the charges it had checked (service: cancelled only). */
export async function deleteSubscriptionAction(id: string): Promise<ActionResult> {
  const ctx = await requireSession();
  try {
    await deleteSubscription(ctx, id);
    revalidate();
    return { ok: true };
  } catch (error) {
    return failed(error);
  }
}
