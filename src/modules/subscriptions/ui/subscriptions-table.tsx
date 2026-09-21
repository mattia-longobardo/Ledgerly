"use client";

import { useTranslations } from "next-intl";
import { useState, useTransition } from "react";
import { Tag } from "@/ui/badge";
import { Button } from "@/ui/button";
import { cn } from "@/ui/cn";
import { Modal } from "@/ui/modal";
import { Table, TBody, Td, Th, THead, TotalRow, Tr } from "@/ui/table";
import { notify } from "@/ui/toast";
import { deleteSubscriptionAction } from "../actions";
import type { Cycle } from "../rules";
import { type DialogOptions, SubscriptionDialog, type SubscriptionDraft } from "./subscription-dialog";

export type PaidStatus = "paid" | "amount_differs" | "due" | "not_found" | "not_due" | "unchecked";

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

function UtilityBar({ value }: { value: number }) {
  const tone = value <= 5 ? "bg-warn" : value >= 8 ? "bg-pos" : "bg-accent";
  return (
    <span aria-hidden className="h-1.5 w-[60px] overflow-hidden rounded-full bg-track">
      <span className={cn("block h-full rounded-full", tone)} style={{ width: `${value * 10}%` }} />
    </span>
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
  const header = (key: SortKey, label: string, align: "left" | "right" = "left") => (
    <Th
      align={align}
      sort={{
        direction: sort.key === key ? sort.direction : null,
        onSort: () =>
          setSort((current) =>
            current.key === key
              ? { key, direction: current.direction === "asc" ? "desc" : "asc" }
              : { key, direction: "desc" },
          ),
      }}
    >
      {label}
    </Th>
  );
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
  const utilityButton = (row: SubscriptionView) => (
    <button
      type="button"
      title={t("setUtility")}
      aria-label={`${t("setUtility")}: ${row.name}, ${t("utilityOf", { value: row.utility })}`}
      onClick={() => setEditing(row.draft)}
      className="focus-ring inline-flex min-h-6 items-center rounded-[4px] px-1 text-sm tabular-nums hover:bg-hover"
    >
      {t("utilityOf", { value: row.utility })}
    </button>
  );

  return (
    <>
      <div className="overflow-x-auto max-md:hidden">
        <Table className="table-fixed">
          <colgroup>
            <col />
            <col className="w-[120px]" />
            <col className="w-[92px]" />
            <col className="w-[92px]" />
            <col className="w-[104px]" />
            <col className="w-[92px]" />
            <col className="w-[92px]" />
            <col className="w-[136px]" />
            <col className="w-[60px]" />
          </colgroup>
          <THead>
            {header("name", t("columns.name"))}
            {header("utility", t("columns.utility"))}
            {header("price", t("columns.price"), "right")}
            {header("billing", t("columns.billing"))}
            <Th>{t("columns.due")}</Th>
            {header("monthly", t("columns.monthly"), "right")}
            {header("yearly", t("columns.yearly"), "right")}
            <Th>{t("columns.status")}</Th>
            <Th>
              <span className="sr-only">{t("columns.edit")}</span>
            </Th>
          </THead>
          <TBody>
            {sorted.map((row) => (
              <Tr key={row.draft.id} data-testid="subscription-row">
                {/* Category and paying account under the name (spec §8.4 point 3): at 1440 px with the
                    sidebar open there is no room for them as columns of their own. */}
                <Td className="py-1.5">
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
                </Td>
                <Td>
                  <span className="flex items-center gap-2">
                    <UtilityBar value={row.utility} />
                    {utilityButton(row)}
                  </span>
                </Td>
                <Td align="right">{row.price}</Td>
                <Td>
                  <span
                    className={cn(
                      "rounded-[4px] px-1.5 py-0.5 text-xs font-medium",
                      row.cycle === "monthly" ? "bg-soft text-accent" : "bg-hover text-muted",
                    )}
                  >
                    {t(`cycles.${row.cycle}`)}
                  </span>
                </Td>
                <Td className="truncate" title={t("columns.dueOn", { date: row.dueOn })}>
                  {row.due}
                </Td>
                <Td align="right">{row.monthly}</Td>
                <Td align="right" className="font-semibold">
                  {row.yearly}
                </Td>
                <Td>{pill(row)}</Td>
                <Td>
                  <Button size="xs" variant="ghost" onClick={() => setEditing(row.draft)}>
                    {t("columns.edit")}
                  </Button>
                </Td>
              </Tr>
            ))}
          </TBody>
          <tfoot>
            <TotalRow label={t("total")}>
              <td colSpan={3} className="px-2 text-sm font-normal text-muted">
                {totals.count}
              </td>
              <td className="px-2 text-right tabular-nums">{totals.monthly}</td>
              <td className="px-2 text-right tabular-nums">{totals.yearly}</td>
              <td colSpan={2} />
            </TotalRow>
          </tfoot>
        </Table>
      </div>

      <ul className="flex flex-col md:hidden">
        {sorted.map((row) => (
          <li
            key={row.draft.id}
            data-testid="subscription-item"
            className="flex flex-col gap-1.5 border-b border-border px-4 py-3 last:border-0"
          >
            <div className="flex items-center justify-between gap-2">
              <button
                type="button"
                onClick={() => setEditing(row.draft)}
                className="focus-ring inline-flex min-h-6 min-w-0 items-center truncate rounded-[2px] text-left font-semibold"
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
          </li>
        ))}
      </ul>

      {editing && <SubscriptionDialog draft={editing} options={options} onClose={() => setEditing(null)} />}
    </>
  );
}

/**
 * The plans that are not running, folded under the table — the paused and the cancelled in **two**
 * sections rather than one list (owner, 2026-09-21), because they are two different things: one is
 * a plan waiting to come back, the other a plan that is over. Each opens on a click and each is a
 * real table, so a name is not the only thing a person can see before deciding.
 *
 * `deletable` is set only for the cancelled: deleting is offered where it cannot be reached by
 * accident from a row that merely pauses (`deleteSubscription` refuses anything else anyway).
 */
export function InactiveSubscriptions({
  rows,
  options,
  title,
  deletable = false,
}: {
  rows: readonly SubscriptionView[];
  options: DialogOptions;
  title: string;
  deletable?: boolean;
}) {
  const t = useTranslations("subscriptions");
  const [editing, setEditing] = useState<SubscriptionDraft | null>(null);
  const [removing, setRemoving] = useState<SubscriptionView | null>(null);
  const [pending, startTransition] = useTransition();

  function onDelete(row: SubscriptionView) {
    setRemoving(null);
    startTransition(async () => {
      const result = await deleteSubscriptionAction(row.draft.id);
      if (result.ok) {
        notify(t("inactive.deletedToast", { name: row.name }));
        return;
      }
      // A service code, spelled out one branch at a time so the catalogue keys stay literal.
      notify(
        result.error === "not_cancelled"
          ? t("errors.not_cancelled")
          : result.error === "not_found"
            ? t("errors.not_found")
            : t("errors.failed"),
        "error",
      );
    });
  }

  if (rows.length === 0) return null;
  return (
    <details className="rounded-card border border-border bg-card">
      <summary className="cursor-pointer list-none px-4 py-2.5 text-sm font-medium text-muted marker:content-none">
        <span className="inline-flex items-center gap-1.5">
          <span aria-hidden className="transition-transform">
            ▸
          </span>
          {title}
        </span>
      </summary>
      <div className="overflow-x-auto border-t border-border">
        <Table>
          <THead>
            <Th>{t("columns.name")}</Th>
            <Th>{t("columns.billing")}</Th>
            <Th align="right">{t("columns.price")}</Th>
            <Th>{t("columns.paidFrom")}</Th>
            <Th align="right">
              <span className="sr-only">{t("columns.edit")}</span>
            </Th>
          </THead>
          <TBody>
            {rows.map((row) => (
              <Tr key={row.draft.id} data-testid="inactive-row">
                <Td className="font-medium">
                  <span className="flex min-w-0 items-center gap-1.5">
                    {row.categoryName && (
                      <span
                        aria-hidden
                        className="inline-block size-2 shrink-0 rounded-full"
                        style={{ backgroundColor: row.categoryColor ?? undefined }}
                      />
                    )}
                    <span className="truncate">{row.name}</span>
                  </span>
                </Td>
                <Td muted className="text-sm">
                  {t(`cycles.${row.cycle}`)}
                </Td>
                <Td align="right">{row.price}</Td>
                <Td muted className="truncate text-sm">
                  {row.accountName}
                </Td>
                <Td align="right">
                  <span className="inline-flex flex-wrap justify-end gap-1 whitespace-normal">
                    <Button size="xs" variant="ghost" onClick={() => setEditing(row.draft)}>
                      {t("columns.edit")}
                    </Button>
                    {deletable && (
                      <Button size="xs" variant="danger" disabled={pending} onClick={() => setRemoving(row)}>
                        {t("inactive.delete")}
                      </Button>
                    )}
                  </span>
                </Td>
              </Tr>
            ))}
          </TBody>
        </Table>
      </div>
      {editing && <SubscriptionDialog draft={editing} options={options} onClose={() => setEditing(null)} />}
      <Modal
        open={removing !== null}
        onOpenChange={(next) => !next && setRemoving(null)}
        title={t("inactive.deleteTitle")}
        description={removing ? t("inactive.deleteWarning", { name: removing.name }) : undefined}
        width={440}
        footer={
          <>
            <Button size="sm" onClick={() => setRemoving(null)}>
              {t("inactive.cancelDelete")}
            </Button>
            <Button
              size="sm"
              variant="danger"
              disabled={pending}
              onClick={() => removing && onDelete(removing)}
            >
              {t("inactive.delete")}
            </Button>
          </>
        }
      >
        <p className="text-muted">{t("inactive.deleteDetail")}</p>
      </Modal>
    </details>
  );
}
