import { getTranslations } from "next-intl/server";
import { subscriptionsView } from "@/modules/subscriptions/queries";
import { requireSession } from "@/platform/auth/session";
import { formatAmountInput } from "@/platform/format";

/** One CSV field: quoted when it holds a separator, a quote or a line break (RFC 4180). */
function field(value: string | number): string {
  const text = String(value);
  return /[";\n\r]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

/**
 * "Export CSV" of Subscriptions (plan F3 §3.6.10; not wired in the design, and §8.4.2 wants every
 * control to work). Semicolon-separated with amounts in the user's own decimal format, so a
 * spreadsheet in their language opens it as numbers. The user's own rows only, behind the session.
 */
export async function GET(): Promise<Response> {
  const ctx = await requireSession();
  const t = await getTranslations("subscriptions");
  const view = await subscriptionsView(ctx);
  const amount = (cents: bigint) => formatAmountInput(cents, ctx.numberFormat);
  const header = [
    t("csv.name"),
    t("csv.category"),
    t("csv.utility"),
    t("csv.price"),
    t("csv.billing"),
    t("csv.paidFrom"),
    t("csv.monthly"),
    t("csv.yearly"),
    t("csv.nextCharge"),
    t("csv.state"),
    t("csv.status"),
  ];
  const lines = [...view.rows, ...view.inactive].map((row) =>
    [
      row.subscription.name,
      row.categoryName ?? "",
      row.subscription.utility,
      amount(row.subscription.priceCents),
      t(`cycles.${row.subscription.cycle}`),
      row.accountName ?? "",
      amount(row.monthlyCents),
      amount(row.yearlyCents),
      row.nextChargeOn,
      row.subscription.state,
      row.current?.state ?? "",
    ]
      .map(field)
      .join(";"),
  );
  return new Response(`﻿${[header.map(field).join(";"), ...lines].join("\r\n")}\r\n`, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": 'attachment; filename="subscriptions.csv"',
      "Cache-Control": "no-store",
    },
  });
}
