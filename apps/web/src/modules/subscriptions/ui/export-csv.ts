// «Export CSV» of Subscriptions (audit UI-SUB-2): the file is written in the browser from
// `GET /subscriptions`, the same rows as the page; the client formats, it adds nothing up.
// Semicolon-separated, amounts in the person's own decimal format, so a spreadsheet in their
// language opens them as numbers.
import type { useTranslations } from "next-intl";
import type { subscriptions } from "@ledgerly/api-contract/subscriptions";
import type { RouteOutput } from "@ledgerly/api-client";
import { parseCents } from "@ledgerly/format/cents";
import { formatAmountInput, type NumberFormat } from "@ledgerly/format/format";
import { csvDocument } from "@ledgerly/format/csv";
import { frequencyText } from "./present";

type T = ReturnType<typeof useTranslations<"subscriptions">>;
type View = RouteOutput<typeof subscriptions.listSubscriptions>;

export function subscriptionsCsv(view: View, text: T, numberFormat: NumberFormat): string {
  const amount = (decimal: string) => formatAmountInput(parseCents(decimal), numberFormat);
  const header = [
    text("csv.name"),
    text("csv.category"),
    text("csv.utility"),
    text("csv.price"),
    text("csv.billing"),
    text("csv.paidFrom"),
    text("csv.monthly"),
    text("csv.yearly"),
    text("csv.nextCharge"),
    text("csv.state"),
    text("csv.status"),
  ];
  const rows = [...view.subscriptions, ...view.inactive].map((row) => [
    row.name,
    row.category ?? "",
    row.noVote ? "" : row.utility,
    amount(row.price),
    frequencyText(row, text),
    row.account ?? "",
    amount(row.monthly),
    amount(row.yearly),
    row.nextChargeOn,
    row.state,
    row.current?.state ?? "",
  ]);
  return csvDocument(header, rows);
}
