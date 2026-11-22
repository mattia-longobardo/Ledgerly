import type { AddonId } from "@ledgerly/api-contract";
import type { NumberFormat, UiLocale } from "./format";
import type { DisplayCurrency } from "./fx/rules";

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
  /**
   * What every total across accounts is converted to and shown in (docs/design/investments.md
   * §1.8, D1). A single account's own value stays in the account's currency.
   */
  displayCurrency: DisplayCurrency;
  /**
   * The addons the person has on (R5a, H52). Absent means every addon is on: a context a test or a
   * script builds by hand acts as a person who never turned anything off.
   */
  addons?: readonly AddonId[];
}

/** Whether the person has `addon` on (H52): an addon that is off has no reads, jobs or alerts. */
export function addonOn(ctx: Pick<Ctx, "addons">, addon: AddonId): boolean {
  return ctx.addons === undefined || ctx.addons.includes(addon);
}

/** The one admin guard (audit PLT-4): a context that is not an admin's is refused with `refuse()`. */
export function requireAdminCtx(ctx: Pick<Ctx, "role">, refuse: () => Error): void {
  if (ctx.role !== "admin") throw refuse();
}
