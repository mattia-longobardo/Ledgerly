"use client";

// The words of the Connection tab for the values of the API: a stream, a coverage's status and reason,
// a key check's result, a reading's status. A value the catalogue does not know is shown as it is.
import { useTranslations } from "next-intl";

const STREAMS = [
  "trades",
  "deposits",
  "balance_history",
  "withdrawals",
  "fiat_orders",
  "fiat_payments",
  "convert",
  "dividends",
  "dust",
  "pay",
  "earn_rewards",
  "quantities",
] as const;
const REASONS = [
  "api_limit_12m",
  "before_first_movement",
  "api_limit_24m",
  "api_limit_18m",
  "opening_12m",
  "negative_opening",
  "quantity_mismatch",
  "reconstructed",
] as const;

export function useConnectionWords() {
  const text = useTranslations("investments");
  return {
    stream: (stream: string) => {
      const known = STREAMS.find((one) => one === stream);
      return known ? text(`sync.streams.${known}`) : stream;
    },
    reason: (reason: string) => {
      const known = REASONS.find((one) => one === reason);
      return known ? text(`sync.reasons.${known}`) : reason;
    },
  };
}
