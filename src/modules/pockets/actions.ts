// src/modules/pockets/actions.ts — the Pockets Server Actions (spec §4.2): validate → service →
// revalidate. Amounts arrive as typed text and become cents here, in the user's number format.
"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { parseAmount } from "@/modules/accounts/rules";
import { requireSession } from "@/platform/auth/session";
import type { Ctx } from "@/platform/context";
import {
  addToPocket,
  createPocket,
  PocketError,
  recordWithdrawal,
  setPocketState,
  updatePocket,
} from "./service";

export type ActionResult = { ok: true } | { ok: false; error: string };
export type CreateResult = { ok: true; id: string } | { ok: false; error: string };

function failed(error: unknown): { ok: false; error: string } {
  if (error instanceof PocketError) return { ok: false, error: error.code };
  if (error instanceof z.ZodError || error instanceof RangeError) return { ok: false, error: "invalid" };
  throw error;
}

function revalidate(): void {
  revalidatePath("/pockets");
  revalidatePath("/");
}

/** The pocket dialog: amounts as typed, an empty one being no amount at all. */
export interface PocketFormInput {
  name: string;
  color: string | null;
  backingAccountId: string | null;
  target: string;
  monthly: string;
  startMonth: string;
}

function optionalAmount(value: string, ctx: Ctx): bigint | null {
  return value.trim() === "" ? null : parseAmount(value, ctx.numberFormat);
}

function toInput(input: PocketFormInput, ctx: Ctx) {
  return {
    name: input.name,
    color: input.color,
    backingAccountId: input.backingAccountId || null,
    targetCents: optionalAmount(input.target, ctx),
    monthlyCents: optionalAmount(input.monthly, ctx),
    startMonth: input.startMonth,
  };
}

export async function createPocketAction(input: PocketFormInput): Promise<CreateResult> {
  const ctx = await requireSession();
  try {
    const pocket = await createPocket(ctx, toInput(input, ctx));
    revalidate();
    return { ok: true, id: pocket.id };
  } catch (error) {
    return failed(error);
  }
}

export async function updatePocketAction(id: string, input: PocketFormInput): Promise<ActionResult> {
  const ctx = await requireSession();
  try {
    await updatePocket(ctx, id, toInput(input, ctx));
    revalidate();
    return { ok: true };
  } catch (error) {
    return failed(error);
  }
}

export async function setPocketStateAction(
  id: string,
  state: "active" | "paused" | "archived",
): Promise<ActionResult> {
  const ctx = await requireSession();
  try {
    await setPocketState(ctx, id, z.enum(["active", "paused", "archived"]).parse(state));
    revalidate();
    return { ok: true };
  } catch (error) {
    return failed(error);
  }
}

export async function addToPocketAction(
  id: string,
  input: { amount: string; on: string },
): Promise<ActionResult> {
  const ctx = await requireSession();
  try {
    await addToPocket(ctx, id, { cents: parseAmount(input.amount, ctx.numberFormat), on: input.on });
    revalidate();
    return { ok: true };
  } catch (error) {
    return failed(error);
  }
}

export async function recordWithdrawalAction(
  id: string,
  input: { amount: string; on: string; reason: string },
): Promise<ActionResult> {
  const ctx = await requireSession();
  try {
    await recordWithdrawal(ctx, id, {
      cents: parseAmount(input.amount, ctx.numberFormat),
      on: input.on,
      reason: input.reason,
    });
    revalidate();
    return { ok: true };
  } catch (error) {
    return failed(error);
  }
}
