// src/modules/accounts/actions.ts — the accounts module's Server Actions (spec §3):
// validate → service → revalidate. Amounts arrive as typed text and become cents here.
"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireSession } from "@/platform/auth/session";
import type { Ctx } from "@/platform/context";
import { monthKey, today } from "@/platform/dates";
import { parseAmount } from "./rules";
import {
  AccountError,
  archiveAccount,
  createAccount,
  deleteBalanceEntry,
  removeAccount,
  restoreAccount,
  runSnapshot,
  saveBalanceEntry,
  snapshotMonthFor,
  updateAccountSettings,
} from "./service";

/**
 * Forms call these inside a transition with no error boundary, so a rejected input comes back as a
 * message key under the calling component's own namespace instead of throwing (as in users).
 */
export type ActionResult = { ok: true } | { ok: false; error: string };
export type CreateResult = { ok: true; id: string } | { ok: false; error: string };

function amount(value: string, ctx: Ctx): bigint {
  return parseAmount(value, ctx.numberFormat);
}

function failed(error: unknown): { ok: false; error: string } {
  if (error instanceof AccountError) return { ok: false, error: error.code };
  if (error instanceof z.ZodError) return { ok: false, error: "invalid" };
  if (error instanceof RangeError) return { ok: false, error: "invalid" };
  throw error;
}

export interface NewAccountInput {
  name: string;
  type: string;
  currency: string;
  color: string | null;
  reference: string;
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

export interface AccountSettingsFormInput {
  name: string;
  type: string;
  currency: string;
  color: string | null;
  reference: string;
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
    revalidatePath(`/accounts/${id}`);
    revalidatePath("/accounts");
    revalidatePath("/");
    return { ok: true };
  } catch (error) {
    return failed(error);
  }
}

export async function saveBalanceEntryAction(
  accountId: string,
  input: { on: string; amount: string; note: string },
): Promise<ActionResult> {
  const ctx = await requireSession();
  try {
    await saveBalanceEntry(ctx, accountId, {
      on: input.on,
      cents: amount(input.amount, ctx),
      note: input.note,
    });
    revalidatePath(`/accounts/${accountId}`);
    revalidatePath("/accounts");
    revalidatePath("/");
    return { ok: true };
  } catch (error) {
    return failed(error);
  }
}

export async function deleteBalanceEntryAction(accountId: string, entryId: string): Promise<ActionResult> {
  const ctx = await requireSession();
  const parsed = z.uuid().safeParse(entryId);
  if (!parsed.success) return { ok: false, error: "invalid" };
  await deleteBalanceEntry(ctx, parsed.data);
  revalidatePath(`/accounts/${accountId}`);
  revalidatePath("/accounts");
  revalidatePath("/");
  return { ok: true };
}

/** Archives when something depends on the account, deletes when nothing does (spec §7.1). */
export async function removeAccountAction(id: string): Promise<ActionResult> {
  const ctx = await requireSession();
  try {
    await removeAccount(ctx, id);
    revalidatePath("/accounts");
    revalidatePath("/");
    return { ok: true };
  } catch (error) {
    return failed(error);
  }
}

export async function archiveAccountAction(id: string): Promise<ActionResult> {
  const ctx = await requireSession();
  try {
    await archiveAccount(ctx, id);
    revalidatePath(`/accounts/${id}`);
    revalidatePath("/accounts");
    revalidatePath("/");
    return { ok: true };
  } catch (error) {
    return failed(error);
  }
}

export async function restoreAccountAction(id: string): Promise<ActionResult> {
  const ctx = await requireSession();
  try {
    await restoreAccount(ctx, id);
    revalidatePath(`/accounts/${id}`);
    revalidatePath("/accounts");
    revalidatePath("/");
    return { ok: true };
  } catch (error) {
    return failed(error);
  }
}

/** "Take snapshot now" (spec §10.3): the same run the monthly job does, for the caller alone. */
export async function runSnapshotNowAction(month?: string): Promise<ActionResult> {
  const ctx = await requireSession();
  try {
    const chosen = month ? monthKey(month) : snapshotMonthFor(today(ctx.timeZone));
    await runSnapshot(ctx, chosen);
    revalidatePath("/settings/data");
    revalidatePath("/accounts");
    revalidatePath("/");
    return { ok: true };
  } catch (error) {
    return failed(error);
  }
}
