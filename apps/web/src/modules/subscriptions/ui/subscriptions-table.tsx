"use client";

import { useTranslations } from "next-intl";
import { useState } from "react";
import { Tag } from "@ledgerly/ui/badge";
import { Button } from "@ledgerly/ui/button";
import { cn } from "@ledgerly/ui/cn";
import { type DataColumn, DataTable } from "@ledgerly/ui/data-table";
import { ProgressBar } from "@ledgerly/ui/progress-bar";
import { TotalRow } from "@ledgerly/ui/table";
import type { Cycle } from "@ledgerly/domain/subscriptions/client";
import { type DialogOptions, SubscriptionDialog, type SubscriptionDraft } from "./subscription-dialog";

type PaidStatus = "paid" | "amount_differs" | "due" | "not_found" | "not_due" | "unchecked";

/** One subscription as the table draws it: text formatted by the server, sort keys as numbers. */
export interface SubscriptionView {
  draft: SubscriptionDraft & { id: string };
  name: string;
  categoryName: string | null;
  /** The category's colour — its group's when it has one (spec §7.2). */
  categoryColor: string | null;
  /** When in its cycle it falls due, in the cycle's own unit (`presentDue`). */
  due: string;
  /** The exact next charge, for the cell's title: the column says the unit, not the date. */
  dueOn: string;
  utility: number;
  price: string;
  priceCents: bigint;
  cycle: Cycle;
  accountName: string;
  monthly: string;
  monthlyCents: bigint;
  yearly: string;
  yearlyCents: bigint;
  status: PaidStatus;
  statusDetail: string;
}

type SortKey = "name" | "utility" | "price" | "billing" | "monthly" | "yearly";

const CYCLE_ORDER: Record<Cycle, number> = { weekly: 0, monthly: 1, quarterly: 2, yearly: 3 };

const STATUS_TONE: Record<PaidStatus, string> = {
  paid: "bg-pos-bg text-pos",
  amount_differs: "bg-warn-bg text-warn",
  due: "bg-warn-bg text-warn",
  not_found: "bg-neg-bg text-neg",
  not_due: "bg-hover text-muted",
  unchecked: "bg-hover text-faint",
};

function compare(a: SubscriptionView, b: SubscriptionView, key: SortKey): number {
  const text = (x: string | null, y: string | null) => (x ?? "").localeCompare(y ?? "");
  const big = (x: bigint, y: bigint) => (x < y ? -1 : x > y ? 1 : 0);
  switch (key) {
    case "name":
      return text(a.name, b.name);
    case "utility":
      return a.utility - b.utility;
    case "price":
      return big(a.priceCents, b.priceCents);
    case "billing":
      return CYCLE_ORDER[a.cycle] - CYCLE_ORDER[b.cycle];
    case "monthly":
      return big(a.monthlyCents, b.monthlyCents);
    case "yearly":
      return big(a.yearlyCents, b.yearlyCents);
  }
}

/** The utility as a bar beside its number: low is a warning, 8 and up is a good sign. */
function UtilityBar({ value, label }: { value: number; label: string }) {
  return (
    <div className="w-[60px] shrink-0">
      <ProgressBar
        value={value / 10}
        tone={value <= 5 ? "warn" : value >= 8 ? "pos" : "accent"}
        label={label}
      />
    </div>
  );
}

/**
 * The design's table: every column but the last two sorts on click (a new column descending
 * first, the same one toggling), Yearly descending by default; the utility and Edit open the
 * dialog. Below 768 px the rows become a list (spec §8.2).
 */
export function SubscriptionsTable({
  rows,
  options,
  totals,
}: {
  rows: readonly SubscriptionView[];
  options: DialogOptions;
  totals: { count: string; monthly: string; yearly: string };
}) {
  const t = useTranslations("subscriptions");
  const [sort, setSort] = useState<{ key: SortKey; direction: "asc" | "desc" }>({
    key: "yearly",
    direction: "desc",
  });
  const [editing, setEditing] = useState<SubscriptionDraft | null>(null);
  const sorted = [...rows].sort((a, b) => {
    const order = compare(a, b, sort.key) * (sort.direction === "asc" ? 1 : -1);
    return order || a.name.localeCompare(b.name) || a.draft.id.localeCompare(b.draft.id);
  });
  const sortOn = (key: SortKey) => ({
    direction: sort.key === key ? sort.direction : null,
    onSort: () =>
      setSort((current) =>
        current.key === key
          ? { key, direction: current.direction === "asc" ? "desc" : "asc" }
          : { key, direction: "desc" },
      ),
  });
  const pill = (row: SubscriptionView) => (
    <span
      title={row.statusDetail}
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-xs font-medium whitespace-nowrap",
        STATUS_TONE[row.status],
      )}
    >
      <span aria-hidden className="size-1.5 rounded-full bg-current" />
      {row.status === "unchecked" ? "—" : t(`status.${row.status}`)}
      <span className="sr-only">: {row.statusDetail}</span>
    </span>
  );
  const columns: DataColumn<SubscriptionView>[] = [
    {
      key: "name",
      header: t("columns.name"),
      sort: sortOn("name"),
      className: "py-1.5",
      // Category and paying account under the name (spec §8.4 point 3): at 1440 px with the sidebar
      // open there is no room for them as columns of their own.
      cell: (row) => (
        <span className="flex min-w-0 flex-col">
          <span className="truncate font-semibold" title={row.name}>
            {row.name}
          </span>
          <span className="flex min-w-0 items-center gap-1.5 text-sm text-muted">
            {row.categoryName && (
              <Tag>
                <span
                  aria-hidden
                  className="mr-1 inline-block size-2 shrink-0 rounded-full"
                  style={{ backgroundColor: row.categoryColor ?? undefined }}
                />
                {row.categoryName}
              </Tag>
            )}
            <span className="truncate" title={`${t("columns.paidFrom")}: ${row.accountName}`}>
              {row.accountName}
            </span>
          </span>
        </span>
      ),
    },
    {
      key: "utility",
      header: t("columns.utility"),
      sort: sortOn("utility"),
      width: "w-[120px]",
      cell: (row) => (
        <div className="flex items-center gap-2">
          <UtilityBar value={row.utility} label={`${t("columns.utility")}: ${row.name}`} />
          <button
            type="button"
            title={t("setUtility")}
            aria-label={`${t("setUtility")}: ${row.name}, ${t("utilityOf", { value: row.utility })}`}
            onClick={() => setEditing(row.draft)}
            className="focus-ring inline-flex min-h-6 items-center rounded-sm px-1 text-sm tabular-nums hover:bg-hover"
          >
            {t("utilityOf", { value: row.utility })}
          </button>
        </div>
      ),
    },
    {
      key: "price",
      header: t("columns.price"),
      sort: sortOn("price"),
      align: "right",
      width: "w-[92px]",
      cell: (row) => row.price,
    },
    {
      key: "billing",
      header: t("columns.billing"),
      sort: sortOn("billing"),
      width: "w-[92px]",
      cell: (row) => (
        <span
          className={cn(
            "rounded-sm px-1.5 py-0.5 text-xs font-medium",
            row.cycle === "monthly" ? "bg-soft text-accent" : "bg-hover text-muted",
          )}
        >
          {t(`cycles.${row.cycle}`)}
        </span>
      ),
    },
    {
      key: "due",
      header: t("columns.due"),
      width: "w-[104px]",
      cell: (row) => (
        <span className="block truncate" title={t("columns.dueOn", { date: row.dueOn })}>
          {row.due}
        </span>
      ),
    },
    {
      key: "monthly",
      header: t("columns.monthly"),
      sort: sortOn("monthly"),
      align: "right",
      width: "w-[92px]",
      cell: (row) => row.monthly,
    },
    {
      key: "yearly",
      header: t("columns.yearly"),
      sort: sortOn("yearly"),
      align: "right",
      width: "w-[92px]",
      className: "font-semibold",
      cell: (row) => row.yearly,
    },
    { key: "status", header: t("columns.status"), width: "w-[136px]", cell: pill },
    {
      key: "edit",
      header: t("columns.edit"),
      hiddenHeader: true,
      width: "w-[60px]",
      cell: (row) => (
        <Button size="xs" variant="ghost" onClick={() => setEditing(row.draft)}>
          {t("columns.edit")}
        </Button>
      ),
    },
  ];

  return (
    <>
      <DataTable
        columns={columns}
        rows={sorted}
        rowKey={(row) => row.draft.id}
        rowProps={() => ({ "data-testid": "subscription-row" })}
        cardProps={() => ({
          "data-testid": "subscription-item",
          className: "flex flex-col gap-1.5 border-b border-border px-4 py-3 last:border-0",
        })}
        card={(row) => (
          <>
            <div className="flex items-center justify-between gap-2">
              <button
                type="button"
                onClick={() => setEditing(row.draft)}
                className="focus-ring inline-flex min-h-6 min-w-0 items-center truncate rounded-xs text-left font-semibold"
              >
                {row.name}
              </button>
              <span className="shrink-0 font-semibold tabular-nums">{row.price}</span>
            </div>
            <div className="flex items-center justify-between gap-2 text-sm text-muted">
              <span className="truncate">
                {t(`cycles.${row.cycle}`)} · {row.accountName}
              </span>
              {pill(row)}
            </div>
          </>
        )}
        footer={
          <TotalRow label={t("total")}>
            <td colSpan={4} className="px-2 text-sm font-normal text-muted">
              {totals.count}
            </td>
            <td className="px-2 text-right tabular-nums">{totals.monthly}</td>
            <td className="px-2 text-right tabular-nums">{totals.yearly}</td>
            <td colSpan={2} />
          </TotalRow>
        }
      />
      {editing && <SubscriptionDialog draft={editing} options={options} onClose={() => setEditing(null)} />}
    </>
  );
}
