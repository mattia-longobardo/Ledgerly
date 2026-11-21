"use client";

// An event of a service in one sentence (§5.2), in the reader's language: the domain's pure
// `describeEvent` on a row of the API, with the words of `investments.activity`.
import { useTranslations } from "next-intl";
import { describeEvent } from "@ledgerly/domain/investments/client";
import type { NumberFormat } from "@ledgerly/format/format";

interface Row {
  note: string | null;
  leg: Parameters<typeof describeEvent>[0]["leg"];
  transfer: { accountName: string } | null;
  linked: { payee: string | null } | null;
}

/**
 * The catalogue as `describeEvent` reads it: by its own keys of `investments.activity`, which it builds
 * from the event (`labels.income.staking`). A method's parameters are compared both ways, so the typed
 * translator stands for one that takes any of them.
 */
interface ActivityWords {
  say(key: string, values?: Record<string, string>): string;
}

/** The label and the sentence of an event. */
export function useEventText(format: NumberFormat) {
  const words: ActivityWords = { say: useTranslations("investments.activity") };
  return (row: Row) =>
    describeEvent(
      { leg: row.leg, note: row.note, counterpart: row.transfer?.accountName ?? row.linked?.payee ?? null },
      (key, values) => words.say(key, values),
      format,
    );
}
