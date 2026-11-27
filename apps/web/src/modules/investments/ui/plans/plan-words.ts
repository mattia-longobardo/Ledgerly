// How the screens of the purchase plans write a plan and its instalments (R5d, step 2): its schedule
// and its size in words, the tone of each state, and a decimal of the wire as a person types it back.
// Formatting only: the due dates, the quantities and the amounts are the server's.
import type { useTranslations } from "next-intl";
import type { RouteOutput } from "@ledgerly/api-client";
import type { plans } from "@ledgerly/api-contract/investments";
import { quantityText } from "@ledgerly/domain/investments/client";
import { formatDecimalText, type NumberFormat, numberSeparators } from "@ledgerly/format/format";
import type { StatusTone } from "@ledgerly/ui/status-badge";

type Plans = typeof plans;
export type Plan = RouteOutput<Plans["listPlans"]>["plans"][number];
export type Run = RouteOutput<Plans["listPlanRuns"]>["runs"][number];
export type PlansText = ReturnType<typeof useTranslations<"investments.plans">>;

export const PLAN_TONES: Readonly<Record<Plan["state"], StatusTone>> = {
  active: "pos",
  paused: "warn",
  ended: "neutral",
};

export const RUN_TONES: Readonly<Record<Run["state"], StatusTone>> = {
  pending: "neutral",
  waiting_price: "warn",
  proposed: "accent",
  recorded: "pos",
  skipped: "neutral",
  expired: "neutral",
};

/** An amount of the wire («100.00») in its currency, with the person's separators and two decimals. */
export const amountText = (amount: string, currency: string, format: NumberFormat) =>
  formatDecimalText(amount, format, { min: 2, max: 2, currency });

/** The days of the week, Monday first, as the contract numbers them (1-7). */
export const WEEKDAYS = ["1", "2", "3", "4", "5", "6", "7"] as const;

/** «Every month on the 5th», «Every 2 weeks on Monday». */
export function scheduleText(plan: Pick<Plan, "frequency" | "interval" | "day">, text: PlansText): string {
  const weekday = WEEKDAYS.find((one) => one === String(plan.day)) ?? "1";
  const day = plan.frequency === "week" ? text(`weekdays.${weekday}`) : String(plan.day);
  return text(`every.${plan.frequency}`, { interval: plan.interval, day });
}

/** What each instalment buys: an amount, or a quantity. */
export function sizeText(
  plan: Pick<Plan, "amount" | "quantity" | "currency">,
  text: PlansText,
  format: NumberFormat,
) {
  if (plan.amount !== null)
    return text("sizeAmount", { amount: amountText(plan.amount, plan.currency, format) });
  return text("sizeQuantity", { quantity: quantityText(plan.quantity ?? "0", null, format) });
}

/** A decimal of the wire («2.614224») as a person types it in their format («2,614224»). */
export function typedDecimal(value: string | null, format: NumberFormat): string {
  return value === null ? "" : value.replace(".", numberSeparators(format).decimal);
}

/** An instalment the person can still confirm or skip. */
export const isOpen = (run: Run) =>
  run.state === "proposed" || run.state === "waiting_price" || run.state === "pending";
