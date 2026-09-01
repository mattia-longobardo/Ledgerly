/**
 * Shared shapes for every server action. Deliberately NOT a "use server"
 * module — it exports types and pure helpers, so it can be imported from
 * client components too.
 */

import { parseItalianNumber } from "@/lib/format";

export interface ActionSuccess<T> {
  ok: true;
  data: T;
}

export interface ActionFailure {
  ok: false;
  error: string;
}

export type ActionResult<T = null> = ActionSuccess<T> | ActionFailure;

export function succeed<T>(data: T): ActionSuccess<T> {
  return { ok: true, data };
}

export function fail(error: string): ActionFailure {
  return { ok: false, error };
}

/**
 * Accepts what a numeric keypad actually produces: "1.234,56", "1234.56", or a
 * number. Returns null on anything else so the action can refuse it rather
 * than writing NaN into a numeric column.
 */
export function parseMoney(raw: unknown): number | null {
  if (typeof raw === "number") return Number.isFinite(raw) ? raw : null;
  if (typeof raw !== "string") return null;
  const trimmed = raw.trim();
  if (trimmed === "") return null;
  // Plain decimals stay plain; anything with a comma goes through the Italian
  // normaliser (which also strips € and thousands separators).
  const n = trimmed.includes(",") ? parseItalianNumber(trimmed) : Number(trimmed.replace(/[€\s]/g, ""));
  return n !== null && Number.isFinite(n) ? n : null;
}

/** Postgres numeric wants a plain decimal string, never a localised one. */
export function toNumericString(value: number): string {
  return value.toFixed(2);
}

export function text(raw: FormDataEntryValue | null): string | null {
  if (typeof raw !== "string") return null;
  const t = raw.trim();
  return t === "" ? null : t;
}

export function errorMessage(err: unknown): string {
  if (err instanceof Error) return err.message;
  return "Something went wrong.";
}
