// src/modules/investments/actions.ts — the Investments Server Actions: validate → service →
// revalidate. Amounts arrive as typed text and become cents here, in the user's number format.
"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { parseAmount } from "@/modules/accounts/rules";
import { requireSession } from "@/platform/auth/session";
import {
  createMovement,
  createPlatform,
  deleteMovement,
  deletePlatform,
  deleteValuation,
  InvestmentError,
  setValuation,
  updateMovement,
  updatePlatform,
} from "./service";

export type ActionResult = { ok: true } | { ok: false; error: string };

function failed(error: unknown): { ok: false; error: string } {
  if (error instanceof InvestmentError) return { ok: false, error: error.code };
  if (error instanceof z.ZodError || error instanceof RangeError) return { ok: false, error: "invalid" };
  throw error;
}

function revalidate(): void {
  revalidatePath("/investments");
}

export interface PlatformFormInput {
  name: string;
  url: string;
}

export async function savePlatformAction(
  id: string | null,
  input: PlatformFormInput,
): Promise<{ ok: true; id: string } | { ok: false; error: string }> {
  const ctx = await requireSession();
  try {
    const platform = id === null ? await createPlatform(ctx, input) : await updatePlatform(ctx, id, input);
    revalidate();
    return { ok: true, id: platform.id };
  } catch (error) {
    return failed(error);
  }
}

export async function deletePlatformAction(
  id: string,
): Promise<{ ok: true; movements: number } | { ok: false; error: string }> {
  const ctx = await requireSession();
  try {
    const { movements } = await deletePlatform(ctx, id);
    revalidate();
    return { ok: true, movements };
  } catch (error) {
    return failed(error);
  }
}

export interface MovementFormInput {
  platformId: string;
  kind: "deposit" | "withdrawal";
  amount: string;
  on: string;
  transactionId: string | null;
  note: string;
}

export async function saveMovementAction(id: string | null, input: MovementFormInput): Promise<ActionResult> {
  const ctx = await requireSession();
  try {
    const parsed = {
      platformId: input.platformId,
      kind: input.kind,
      amountCents: parseAmount(input.amount, ctx.numberFormat),
      on: input.on,
      transactionId: input.transactionId || null,
      note: input.note,
    };
    if (id === null) await createMovement(ctx, parsed);
    else await updateMovement(ctx, id, parsed);
    revalidate();
    return { ok: true };
  } catch (error) {
    return failed(error);
  }
}

export async function deleteMovementAction(id: string): Promise<ActionResult> {
  const ctx = await requireSession();
  try {
    await deleteMovement(ctx, id);
    revalidate();
    return { ok: true };
  } catch (error) {
    return failed(error);
  }
}

export async function setValuationAction(
  platformId: string,
  input: { value: string; on: string },
): Promise<ActionResult> {
  const ctx = await requireSession();
  try {
    await setValuation(ctx, platformId, {
      valueCents: parseAmount(input.value, ctx.numberFormat),
      on: input.on,
    });
    revalidate();
    return { ok: true };
  } catch (error) {
    return failed(error);
  }
}

export async function deleteValuationAction(id: string): Promise<ActionResult> {
  const ctx = await requireSession();
  try {
    await deleteValuation(ctx, id);
    revalidate();
    return { ok: true };
  } catch (error) {
    return failed(error);
  }
}
