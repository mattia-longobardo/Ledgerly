// src/modules/accounts/actions.ts — the accounts module's Server Actions (spec §3):
// validate → service → revalidate. Amounts arrive as typed text and become cents here.
"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireSession } from "@/platform/auth/session";
import type { Ctx } from "@/platform/context";
import { monthKey, today } from "@/platform/dates";
import { linkOwnTransfers } from "@/modules/transactions/service";
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
  updateBalanceEntry,
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
    // A new IBAN may make giroconti of movements already stored (F2.5).
    await linkOwnTransfers(ctx);
    revalidatePath("/expenses");
    revalidatePath(`/accounts/${id}`);
    revalidatePath("/accounts");
    revalidatePath("/");
    return { ok: true };
  } catch (error) {
    return failed(error);
  }
}

/** What the balance-entry form sends, for both the new entry and the correction of one. */
export interface BalanceEntryFormInput {
  on: string;
  amount: string;
  /** What was spendable that day, blank when unknown (the column is nullable). */
  available: string;
  note: string;
}

function entryValues(input: BalanceEntryFormInput, ctx: Ctx) {
  return {
    on: input.on,
    cents: amount(input.amount, ctx),
    availableCents: input.available.trim() === "" ? null : amount(input.available, ctx),
    note: input.note,
  };
}

export async function saveBalanceEntryAction(
  accountId: string,
  input: BalanceEntryFormInput,
): Promise<ActionResult> {
  const ctx = await requireSession();
  try {
    await saveBalanceEntry(ctx, accountId, entryValues(input, ctx));
    revalidatePath(`/accounts/${accountId}`);
    revalidatePath("/accounts");
    revalidatePath("/");
    return { ok: true };
  } catch (error) {
    return failed(error);
  }
}

/** The same form again on a `manual` entry already stored; the service refuses any other source. */
export async function updateBalanceEntryAction(
  accountId: string,
  entryId: string,
  input: BalanceEntryFormInput,
): Promise<ActionResult> {
  const ctx = await requireSession();
  const parsed = z.uuid().safeParse(entryId);
  if (!parsed.success) return { ok: false, error: "invalid" };
  try {
    await updateBalanceEntry(ctx, parsed.data, entryValues(input, ctx));
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
