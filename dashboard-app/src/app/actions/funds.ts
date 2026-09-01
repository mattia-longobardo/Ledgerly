"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireUser } from "@/lib/auth/require-user";
import * as fundsRepo from "@/lib/repo/funds";
import { monthKey, monthKeyOf } from "@/lib/time";
import {
  fail,
  parseMoney,
  succeed,
  toNumericString,
  type ActionResult,
} from "./types";

const monthPattern = /^\d{4}-\d{2}(-\d{2})?$/;

function revalidateFund(slug: string | null): void {
  revalidatePath("/");
  revalidatePath("/finance");
  revalidatePath("/finance/funds");
  if (slug !== null) revalidatePath(`/finance/funds/${slug}`);
  revalidatePath("/settings");
}

async function slugOf(fundId: number): Promise<string | null> {
  const all = await fundsRepo.listFunds();
  return all.find((f) => f.id === fundId)?.slug ?? null;
}

const settingsSchema = z.object({
  fundId: z.coerce.number().int(),
  effectiveFrom: z.string().regex(monthPattern).nullish(),
  initialCapital: z.union([z.string(), z.number()]).nullish(),
  depositMode: z.enum(["fixed", "payroll"]),
  fixedMonthlyAmount: z.union([z.string(), z.number()]).nullish(),
});

/**
 * A mode switch ("link to payroll") is a NEW effective-dated row, never an
 * edit of the old one — that is what keeps the deposit history explainable
 * after the switch.
 */
export async function saveFundSettings(
  input: z.input<typeof settingsSchema>,
): Promise<ActionResult<null>> {
  await requireUser();

  const parsed = settingsSchema.safeParse(input);
  if (!parsed.success) return fail("Those fund settings are not valid.");
  const { fundId, depositMode } = parsed.data;

  const slug = await slugOf(fundId);
  if (slug === null) return fail("Unknown fund.");

  const initial = parseMoney(parsed.data.initialCapital ?? 0) ?? 0;
  if (initial < 0) return fail("Initial capital cannot be negative.");

  let fixed: string | null = null;
  if (depositMode === "fixed") {
    const amount = parseMoney(parsed.data.fixedMonthlyAmount);
    if (amount === null || amount < 0) {
      return fail("A fixed monthly amount is required in fixed mode.");
    }
    fixed = toNumericString(amount);
  }

  const effectiveFrom = parsed.data.effectiveFrom
    ? monthKeyOf(parsed.data.effectiveFrom)
    : monthKey(new Date());

  await fundsRepo.addSetting({
    fundId,
    effectiveFrom,
    initialCapital: toNumericString(initial),
    depositMode,
    fixedMonthlyAmount: fixed,
  });

  revalidateFund(slug);
  return succeed(null);
}

const depositSchema = z.object({
  fundId: z.coerce.number().int(),
  month: z.string().regex(monthPattern),
  amount: z.union([z.string(), z.number()]),
});

/**
 * A manual top-up. Both deposit modes write `fund_deposits`, so totals never
 * branch on mode; `source` only records where the row came from.
 */
export async function recordManualDeposit(
  input: z.input<typeof depositSchema>,
): Promise<ActionResult<null>> {
  await requireUser();

  const parsed = depositSchema.safeParse(input);
  if (!parsed.success) return fail("That deposit is not valid.");

  const amount = parseMoney(parsed.data.amount);
  if (amount === null) return fail("Enter a deposit amount.");

  const slug = await slugOf(parsed.data.fundId);
  if (slug === null) return fail("Unknown fund.");

  await fundsRepo.upsertDeposit({
    fundId: parsed.data.fundId,
    month: monthKeyOf(parsed.data.month),
    amount: toNumericString(amount),
    source: "manual",
  });

  revalidateFund(slug);
  return succeed(null);
}
