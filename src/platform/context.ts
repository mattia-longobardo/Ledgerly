import type { NumberFormat, UiLocale } from "./format";

export type Role = "admin" | "user";

/** Who is acting. Built once per request (or per user inside a job) and passed to every service. */
export interface Ctx {
  userId: string;
  role: Role;
  locale: UiLocale;
  timeZone: string;
  /**
   * The user's number format together with their explicit separator and euro-position overrides
   * (a `NumberStyle`), so every formatting call already written as `formatMoney(x, ctx.numberFormat)`
   * honours them without reading the database again.
   */
  numberFormat: NumberFormat;
}
