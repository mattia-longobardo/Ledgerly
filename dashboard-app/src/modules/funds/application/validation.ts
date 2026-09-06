import { z } from "zod";
import { InvalidInputError } from "./errors";

export const FUND_KINDS = ["pension", "investment", "savings", "other"] as const;
export const FUND_STATUSES = ["active", "archived"] as const;
export const CONTRIBUTION_TYPES = ["employee", "employer", "voluntary", "adjustment", "fee"] as const;

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
export const monthSchema = dateSchema.refine((value) => value.endsWith("-01"), "Invalid month; use YYYY-MM-01.");

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

export function formatCents(value: bigint): string {
  const negative = value < 0n;
  const absolute = (negative ? -value : value).toString().padStart(3, "0");
  return `${negative ? "-" : ""}${absolute.slice(0, -2)}.${absolute.slice(-2)}`;
}

export function isUniqueViolation(error: unknown, constraint: string): boolean {
  if (!(error instanceof Error)) return false;
  const cause = error.cause instanceof Error ? error.cause.message : "";
  return `${error.message} ${cause}`.includes(constraint);
}
