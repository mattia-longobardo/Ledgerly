"use client";

import { useTranslations } from "next-intl";
import type { ReactNode } from "react";
import { cn } from "@ledgerly/ui/cn";
import { TONE_TEXT } from "@ledgerly/ui/tone";
import { Badge, Tag } from "@ledgerly/ui/badge";
import type { RowBadge } from "@ledgerly/domain/transactions/client";
import type { RowView } from "./view";

/** Hidden and gone-from-the-provider are facts about the data; "edited here" is one about the user. */
const BADGE_TONE: Record<RowBadge, "neutral" | "warn" | "accent"> = {
  manual: "neutral",
  hidden: "neutral",
  removedUpstream: "warn",
  edited: "accent",
  transfer: "neutral",
  // A leg with no other side here usually asks for the other account to be linked.
  unpaired: "warn",
  pending: "warn",
};

/** The badges of an Expenses row, in the table and on the card alike. */
function RowBadges({ row }: { row: RowView }) {
  const text = useTranslations("expenses");
  return (
    <>
      {row.badges.map((badge) => (
        <Badge key={badge} tone={BADGE_TONE[badge]}>
          {text(`badges.${badge}`)}
        </Badge>
      ))}
      {row.send &&
        (row.send.state === "to_send" ? (
          <Badge tone="neutral">{text("manual.badges.toSend")}</Badge>
        ) : (
          <Badge tone="warn">{text("manual.badges.notSent", { provider: row.send.source })}</Badge>
        ))}
    </>
  );
}

/** The note and the labels under the payee. */
function RowDetails({ row }: { row: RowView }) {
  const text = useTranslations("expenses");
  return (
    <>
      {row.note !== null && (
        <span className="block truncate text-sm text-muted">
          <span className="sr-only">{text("row.note")}: </span>
          {row.note}
        </span>
      )}
      {row.labels.length > 0 && (
        <span className="flex flex-wrap items-center gap-1">
          <span className="sr-only">{text("row.labels")}: </span>
          {row.labels.map((label) => (
            <Tag key={label}>{label}</Tag>
          ))}
        </span>
      )}
    </>
  );
}

/** A row as a card below `md`: the same facts and controls as the table's cells. */
export function RowCard({
  row,
  checkbox,
  category,
  menu,
}: {
  row: RowView;
  checkbox: ReactNode;
  category: ReactNode;
  menu: ReactNode;
}) {
  const text = useTranslations("expenses");
  const payee = row.payee ?? text("row.noPayee");
  return (
    <>
      <span className="pt-1">{checkbox}</span>
      <span className="flex min-w-0 flex-1 flex-col gap-1">
        <span className="flex items-baseline justify-between gap-2">
          <span className="min-w-0 truncate font-medium">{payee}</span>
          <span className={cn("shrink-0 font-medium tabular-nums", TONE_TEXT[row.amountTone])}>
            {row.amount}
          </span>
        </span>
        <span className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm text-muted">
          <span>{row.date}</span>
          <span aria-hidden>·</span>
          <span className="min-w-0 truncate">{row.account}</span>
          <RowBadges row={row} />
        </span>
        <RowDetails row={row} />
        <span className="flex items-center justify-between gap-2">
          {category}
          {menu}
        </span>
      </span>
    </>
  );
}

/** The payee of a table row, its badges, its note and its labels. */
export function PayeeCell({ row }: { row: RowView }) {
  const text = useTranslations("expenses");
  const payee = row.payee ?? text("row.noPayee");
  return (
    <>
      <span className="flex min-w-0 items-center gap-2">
        {/* Truncated when the column is short: the whole name is on hover. */}
        <span className="min-w-0 truncate font-medium" title={payee}>
          {payee}
        </span>
        <RowBadges row={row} />
      </span>
      <RowDetails row={row} />
    </>
  );
}
