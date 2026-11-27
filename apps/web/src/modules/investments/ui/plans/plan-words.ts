// How the screens of the purchase plans write a plan and its executions (R5d; baskets, PERS-681 §7):
// its schedule and its instruments in words, the tone of each state, and a decimal of the wire as a
// person types it back. Formatting only: the due dates, the shares and the amounts are the server's;
// the sum of the weights typed is the form's check, not a figure of the plan.
import type { useTranslations } from "next-intl";
import type { RouteOutput } from "@ledgerly/api-client";
import { plans } from "@ledgerly/api-contract/investments";
import {
  formatDecimalText,
  type NumberFormat,
  numberSeparators,
  plainDecimalOf,
} from "@ledgerly/format/format";
import type { StatusTone } from "@ledgerly/ui/status-badge";
import type { PlanInstrument } from "../../plan-calls";

const { MAX_PLAN_INSTRUMENTS } = plans;

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

/** The instruments of a basket with their weight: «A 50 % · B 30 % · C 20 %». */
export function instrumentsText(plan: Pick<Plan, "instruments">, format: NumberFormat): string {
  return plan.instruments
    .map((one) => `${one.name} ${formatDecimalText(one.weight, format, { min: 0, max: 2 })} %`)
    .join(" · ");
}

/** The refusal of a basket the form gives before any write (§7), or null when it can be sent. */
export function basketProblem(
  rows: readonly Pick<PlanInstrument, "weight" | "assetId" | "instrumentId">[],
  format: NumberFormat,
): "empty" | "tooMany" | "repeated" | "sum" | null {
  if (rows.length === 0) return "empty";
  if (rows.length > MAX_PLAN_INSTRUMENTS) return "tooMany";
  const keys = rows.map((row) => row.instrumentId ?? row.assetId);
  if (new Set(keys).size !== keys.length) return "repeated";
  return weightsSum(rows, format) === 10_000 ? null : "sum";
}

/** The weights typed, in basis points; a weight that is no percentage counts as none. */
export const weightsSum = (rows: readonly Pick<PlanInstrument, "weight">[], format: NumberFormat) =>
  rows.reduce((sum, row) => sum + (weightBp(row.weight, format) ?? 0), 0);

/** A weight as typed («33,33») in basis points, or null when it is no percentage. */
export function weightBp(typed: string, format: NumberFormat): number | null {
  if (typed.trim() === "") return null;
  const value = Number(plainDecimalOf(typed, format));
  return Number.isFinite(value) && value > 0 ? Math.round(value * 100) : null;
}

/** A decimal of the wire («2.614224») as a person types it in their format («2,614224»). */
export function typedDecimal(value: string | null, format: NumberFormat): string {
  return value === null ? "" : value.replace(".", numberSeparators(format).decimal);
}

/** An execution the person can still skip: proposed, or waiting for its prices. */
export const isOpen = (run: Run) =>
  run.state === "proposed" || run.state === "waiting_price" || run.state === "pending";

export const LINE_TONES: Readonly<Record<Run["lines"][number]["state"], StatusTone>> = {
  buy: "pos",
  too_expensive: "warn",
  price_missing: "warn",
  skipped: "neutral",
};
