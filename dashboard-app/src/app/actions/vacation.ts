"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireUser } from "@/lib/auth/require-user";
import { fundBalance, withdrawalPreview } from "@/lib/calc/vacation-fund";
import * as vacation from "@/lib/repo/vacation";
import { monthKey, monthKeyOf, romeDate } from "@/lib/time";
import {
  fail,
  parseMoney,
  succeed,
  toNumericString,
  type ActionResult,
} from "./types";

const VACATION_PATHS = ["/", "/finance/vacation", "/settings"] as const;

function revalidateVacation(): void {
  for (const path of VACATION_PATHS) revalidatePath(path);
}

const monthPattern = /^\d{4}-\d{2}(-\d{2})?$/;
const isoDatePattern = /^\d{4}-\d{2}-\d{2}$/;

const withdrawalSchema = z.object({
  amount: z.union([z.string(), z.number()]),
  note: z.string().max(200).nullish(),
  /** Civil date `YYYY-MM-DD` in Europe/Rome; defaults to today. */
  occurredOn: z.string().regex(isoDatePattern).nullish(),
});

export interface WithdrawalRecorded {
  entryId: number;
  balance: number;
}

/**
 * Records a withdrawal from the vacation sinking fund.
 *
 * ANNOTATION ONLY — §9 item 12: the app never writes to the Wallet API. The
 * matching move out of the Revolut Savings sub-account is made by hand in
 * Wallet; this row only remembers that it happened.
 */
export async function recordWithdrawal(
  input: z.input<typeof withdrawalSchema>,
): Promise<ActionResult<WithdrawalRecorded>> {
  await requireUser();

  const parsed = withdrawalSchema.safeParse(input);
  if (!parsed.success) return fail("That withdrawal is not valid.");

  const amount = parseMoney(parsed.data.amount);
  if (amount === null || amount <= 0) return fail("Enter an amount greater than zero.");

  const ledger = await vacation.ledger();
  const remaining = withdrawalPreview(ledger, amount);

  const occurredAt =
    parsed.data.occurredOn == null
      ? undefined
      : new Date(`${parsed.data.occurredOn}T12:00:00Z`);

  const row = await vacation.addEntry({
    entryType: "withdrawal",
    // Signed ledger: withdrawals are negative, balance = SUM(amount).
    amount: toNumericString(-Math.abs(amount)),
    note: parsed.data.note ?? null,
    ...(occurredAt ? { occurredAt } : {}),
  });
  if (!row) return fail("The withdrawal could not be saved.");

  revalidateVacation();
  return succeed({ entryId: row.id, balance: remaining });
}

/**
 * Backs out a withdrawal — the 10 s Undo on the success toast. Withdrawals are
 * the only reversible entry type; accruals and the initial value are history.
 */
export async function undoWithdrawal(entryId: number): Promise<ActionResult<{ balance: number }>> {
  await requireUser();
  if (!Number.isInteger(entryId)) return fail("Unknown entry.");

  const recent = await vacation.recentLedger(100);
  const entry = recent.find((e) => e.id === entryId);
  if (!entry) return fail("That entry is no longer there.");
  if (entry.entryType !== "withdrawal") return fail("Only withdrawals can be undone.");

  await vacation.deleteEntry(entryId);
  const ledger = await vacation.ledger();

  revalidateVacation();
  return succeed({ balance: fundBalance(ledger) });
}

const rateSchema = z.object({
  monthlyAmount: z.union([z.string(), z.number()]),
  effectiveFrom: z.string().regex(monthPattern).nullish(),
});

/**
 * "Change X going forward" is a new effective-dated row — months before
 * `effectiveFrom` keep whatever they were expected to accrue.
 */
export async function setAccrualRate(
  input: z.input<typeof rateSchema>,
): Promise<ActionResult<null>> {
  await requireUser();

  const parsed = rateSchema.safeParse(input);
  if (!parsed.success) return fail("That accrual rate is not valid.");

  const amount = parseMoney(parsed.data.monthlyAmount);
  if (amount === null || amount < 0) return fail("Enter a monthly amount of zero or more.");

  const from = parsed.data.effectiveFrom
    ? monthKeyOf(parsed.data.effectiveFrom)
    : monthKey(new Date());

  await vacation.setRate(from, toNumericString(amount));
  revalidateVacation();
  return succeed(null);
}

const initialSchema = z.object({
  amount: z.union([z.string(), z.number()]),
  month: z.string().regex(monthPattern).nullish(),
});

/**
 * First-run only: the fund's opening value. §9 item 10 — configured in-app,
 * there is no preset. A unique index allows exactly one 'initial' month row.
 */
export async function setInitialValue(
  input: z.input<typeof initialSchema>,
): Promise<ActionResult<null>> {
  await requireUser();

  const parsed = initialSchema.safeParse(input);
  if (!parsed.success) return fail("That opening value is not valid.");

  const amount = parseMoney(parsed.data.amount);
  if (amount === null || amount < 0) return fail("Enter an opening value of zero or more.");

  const month = parsed.data.month ? monthKeyOf(parsed.data.month) : monthKeyOf(romeDate());
  const existing = await vacation.ledger();
  if (existing.some((e) => e.entryType === "initial")) {
    return fail("The opening value is already set. Record an adjustment instead.");
  }

  await vacation.addEntry({
    entryType: "initial",
    amount: toNumericString(amount),
    month,
    note: "Opening value",
  });

  revalidateVacation();
  return succeed(null);
}
