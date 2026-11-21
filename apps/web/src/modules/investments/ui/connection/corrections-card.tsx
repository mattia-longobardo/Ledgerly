"use client";

// The manual corrections of a service (§4.9): each with its days, its class and whether it is old.
import { useTranslations } from "next-intl";
import { formatDate, NULL_DISPLAY } from "@ledgerly/format/format";
import { Badge } from "@ledgerly/ui/badge";
import { Card, CardHeader } from "@ledgerly/ui/card";
import { cn } from "@ledgerly/ui/cn";
import { TONE_TEXT, toneOfSign } from "@ledgerly/ui/tone";
import { centsOf } from "../present";
import type { ServicePage } from "../service/service-view";
import type { Connection } from "./connection-view";

export function CorrectionsCard({ page, connection }: { page: ServicePage; connection: Connection }) {
  const text = useTranslations("investments");
  const long = (day: string) => formatDate(day, "long", page.say.locale);
  return (
    <Card padded={false} className="min-w-0" data-testid="corrections">
      <CardHeader title={text("connection.corrections.title")} />
      {connection.adjustments.length === 0 ? (
        <p className="px-4 pb-4 text-sm text-muted">{text("connection.corrections.empty")}</p>
      ) : (
        <ul className="flex flex-col">
          {connection.adjustments.map((adjustment) => (
            <li
              key={adjustment.eventId}
              className="flex flex-col gap-0.5 border-t border-border px-4 py-2 text-sm"
            >
              <div className="flex items-start justify-between gap-2">
                <span className="min-w-0">{adjustment.note ?? NULL_DISPLAY}</span>
                <span
                  className={cn(
                    "shrink-0 font-medium tabular-nums",
                    TONE_TEXT[toneOfSign(centsOf(adjustment.amount))],
                  )}
                >
                  {page.money(adjustment.amount, { signed: true })}
                </span>
              </div>
              <span className="flex flex-wrap items-center gap-x-2 text-muted">
                <span>
                  {long(adjustment.on)} →{" "}
                  {adjustment.validUntil ? long(adjustment.validUntil) : text("adjustments.openEnded")}
                </span>
                <Badge tone="neutral">
                  {text(`operationForm.classes.${adjustment.adjustmentClass ?? "data"}`)}
                </Badge>
              </span>
              {adjustment.stale && <span className="text-warn">{text("adjustments.stale")}</span>}
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}
