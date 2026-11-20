// src/modules/subscriptions/actions.ts — the Subscriptions Server Actions (spec §4.2): validate →
// service → revalidate. Amounts and the tolerance arrive as typed text, in the user's number format.
"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { parseAmount } from "@ledgerly/domain/platform/format";
import { requireSession } from "@/platform/auth/session";
import type { Ctx } from "@ledgerly/domain/platform/context";
import { centsToDecimal } from "@ledgerly/domain/shared/money";
import { CYCLES, toleranceOf } from "@ledgerly/domain/subscriptions";
import {
  createSubscription,
  deleteSubscription,
  setSubscriptionState,
  SubscriptionError,
  updateSubscription,
} from "@ledgerly/domain/subscriptions";

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

interface SubscriptionFormInput {
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

/** A percentage typed in the user's number format, in plain decimal form for the domain (SUB-7). */
function plainPercent(percent: string, ctx: Ctx): string | undefined {
  return percent.trim() === "" ? undefined : centsToDecimal(parseAmount(percent, ctx.numberFormat));
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
    tolerance: toleranceOf(plainPercent(input.tolerance, ctx)),
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
