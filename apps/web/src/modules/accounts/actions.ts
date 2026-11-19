// src/modules/accounts/actions.ts — the two Server Actions of accounts left (spec §3): creating an
// account and saving its settings, until a refusal of `/api/v1` names the account that already has
// the IBAN. Validate → service → revalidate; amounts arrive as typed text and become cents here.
"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireSession } from "@/platform/auth/session";
import type { Ctx } from "@ledgerly/domain/platform/context";
import { parseAmount } from "@ledgerly/domain/platform/format";
import { AccountError, createAccount, updateAccountSettings } from "@ledgerly/domain/accounts";

/**
 * Forms call these inside a transition with no error boundary, so a rejected input comes back as a
 * message key under the calling component's own namespace instead of throwing (as in users).
 */
type ActionResult = { ok: true } | { ok: false; error: string; other?: string };
type CreateResult = { ok: true; id: string } | { ok: false; error: string; other?: string };

function amount(value: string, ctx: Ctx): bigint {
  return parseAmount(value, ctx.numberFormat);
}

function failed(error: unknown): { ok: false; error: string; other?: string } {
  // `other` is the name of the account that has the IBAN: never the IBAN itself (H45).
  if (error instanceof AccountError) {
    return error.other === null
      ? { ok: false, error: error.code }
      : { ok: false, error: error.code, other: error.other };
  }
  if (error instanceof z.ZodError) return { ok: false, error: "invalid" };
  if (error instanceof RangeError) return { ok: false, error: "invalid" };
  throw error;
}

interface NewAccountInput {
  name: string;
  type: string;
  currency: string;
  color: string | null;
  reference: string;
  iban: string;
  purpose: string;
  openedOn: string | null;
  notes: string;
  openingBalance: { on: string; amount: string } | null;
}

export async function createAccountAction(input: NewAccountInput): Promise<CreateResult> {
  const ctx = await requireSession();
  try {
    const account = await createAccount(ctx, {
      ...input,
      openingBalance: input.openingBalance
        ? { on: input.openingBalance.on, cents: amount(input.openingBalance.amount, ctx) }
        : null,
    });
    revalidatePath("/accounts");
    revalidatePath("/");
    return { ok: true, id: account.id };
  } catch (error) {
    return failed(error);
  }
}

interface AccountSettingsFormInput {
  name: string;
  type: string;
  currency: string;
  color: string | null;
  reference: string;
  iban: string;
  purpose: string;
  openedOn: string | null;
  notes: string;
  inNetWorth: boolean;
  inSnapshot: boolean;
  countsAsLiquid: boolean;
  lowBalance: string | null;
  staleAfterHours: number;
  reminder: string;
  betweenEntries: string;
}

export async function saveAccountSettingsAction(
  id: string,
  input: AccountSettingsFormInput,
): Promise<ActionResult> {
  const ctx = await requireSession();
  try {
    await updateAccountSettings(ctx, id, {
      ...input,
      lowBalanceCents: input.lowBalance ? amount(input.lowBalance, ctx) : null,
    });
    revalidatePath("/expenses");
    revalidatePath(`/accounts/${id}`);
    revalidatePath("/accounts");
    revalidatePath("/");
    return { ok: true };
  } catch (error) {
    return failed(error);
  }
}
