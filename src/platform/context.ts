import type { NumberFormat, UiLocale } from "./format";

export type Role = "admin" | "user";

/** Who is acting. Built once per request (or per user inside a job) and passed to every service. */
export interface Ctx {
  userId: string;
  role: Role;
  locale: UiLocale;
  timeZone: string;
  numberFormat: NumberFormat;
}
