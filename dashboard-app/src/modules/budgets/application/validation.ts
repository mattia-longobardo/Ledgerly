import { z } from "zod";
import { InvalidInputError } from "./errors";

export const PERIOD_KINDS = ["none", "monthly", "quarterly", "annual", "custom"] as const;
export const BUDGET_STATUSES = ["active", "archived"] as const;
export const SOURCE_KINDS = ["fund", "account", "none"] as const;
export const RECURRENCES = ["once", "monthly"] as const;
export const SCOPE_KINDS = ["account", "category", "label", "fund"] as const;

export const moneySchema = z.string().regex(/^-?\d{1,14}(?:\.\d{1,2})?$/, "Invalid money amount.");
export const nonNegativeMoneySchema = moneySchema.refine((value) => !value.startsWith("-"), "Invalid negative money amount.");
export const currencySchema = z.string().regex(/^[A-Z]{3}$/, "Invalid currency code.");

function isRealDate(value: string): boolean {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return false;
  const [, year, month, day] = match;
  const date = new Date(`${value}T00:00:00.000Z`);
  return Number(year) === date.getUTCFullYear()
    && Number(month) === date.getUTCMonth() + 1
    && Number(day) === date.getUTCDate();
}

export const dateSchema = z.string().refine(isRealDate, "Invalid calendar date.");

export function parseInput<T>(schema: z.ZodType<T>, input: unknown): T {
  const parsed = schema.safeParse(input);
  if (!parsed.success) {
    const detail = parsed.error.issues[0]?.message ?? "input";
    throw new InvalidInputError(detail.toLowerCase().includes("invalid") ? detail : `Invalid input: ${detail}`, parsed.error.issues);
  }
  return parsed.data;
}

export function moneyCents(value: string): bigint {
  const match = /^(-?)(\d+)(?:\.(\d+))?$/.exec(value);
  if (!match) throw new InvalidInputError("Invalid money amount.");
  const [, sign, integer, fraction = ""] = match;
  return BigInt(`${sign}${integer}${(fraction + "00").slice(0, 2)}`);
}

/** `asOf = min(endDate ?? today, today)` — a closed budget's figures stop moving at its end date. */
export function asOfFor(endDate: string | null, today: string): string {
  return endDate !== null && endDate < today ? endDate : today;
}
