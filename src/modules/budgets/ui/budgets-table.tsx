"use client";

import { useTranslations } from "next-intl";
import { type KeyboardEvent, useState, useTransition } from "react";
import { Badge } from "@/ui/badge";
import { cn } from "@/ui/cn";
import { ActionMenu } from "@/ui/menu";
import { ProgressBar } from "@/ui/progress-bar";
import { Table, TBody, Td, Th, THead, Tr } from "@/ui/table";
import { notify } from "@/ui/toast";
import { TONE_TEXT } from "@/ui/tone";
import { setBudgetLimitAction, stopBudgetAction } from "../actions";
import type { BudgetScope, BudgetStatus } from "../rules";

/** One budget as the table draws it: every amount already formatted by the server (spec §8.5). */
export interface BudgetRowView {
  key: string;
  scope: BudgetScope;
  /** The category ("Group › Sub" when shown on its own), or "All categories". */
  name: string;
  /** The account, or "All accounts". */
  detail: string;
  color: string;
  depth: 0 | 1;
  spent: string;
  limit: string;
  /** The limit as the person would type it back, for the inline editor. */
  limitInput: string;
  remaining: string;
  status: BudgetStatus;
  percent: number;
  percentLabel: string;
}

const BAR_TONE = { over: "neg", near: "warn", on_track: "accent" } as const;
const BADGE_TONE = { over: "neg", near: "warn", on_track: "pos" } as const;
const REMAINING_TONE = { over: "neg", near: "warn", on_track: "muted" } as const;

function Swatch({ color }: { color: string }) {
  return <span aria-hidden className="size-2.5 shrink-0 rounded-[3px]" style={{ background: color }} />;
}

/**
 * The design's limit cell: a button showing the limit, which becomes a field on click. Enter or
 * leaving the field saves an amount above zero; anything else, or Esc, puts the old limit back.
 */
function LimitCell({ row, month }: { row: BudgetRowView; month: string }) {
  const t = useTranslations("budgets");
  const [editing, setEditing] = useState(false);
  const [pending, startTransition] = useTransition();

  function save(value: string) {
    setEditing(false);
    if (value.trim() === "" || value.trim() === row.limitInput) return;
    startTransition(async () => {
      const result = await setBudgetLimitAction(row.scope, month, value);
      notify(result.ok ? t("toasts.saved") : t("errors.invalid"), result.ok ? "success" : "error");
    });
  }

  function onKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === "Enter") {
      event.preventDefault();
      save(event.currentTarget.value);
    } else if (event.key === "Escape") {
      event.preventDefault();
      setEditing(false);
    }
  }

  if (editing) {
    return (
      <input
        aria-label={t("limitInput", { category: row.name })}
        defaultValue={row.limitInput}
        inputMode="decimal"
        autoFocus
        onKeyDown={onKeyDown}
        onBlur={(event) => save(event.currentTarget.value)}
        className="h-7 w-24 rounded-[5px] border border-accent bg-card px-2 text-right tabular-nums focus:outline-none"
      />
    );
  }
  return (
    <button
      type="button"
      title={t("editLimit")}
      aria-label={`${t("editLimit")}: ${row.name}, ${row.limit}`}
      disabled={pending}
      onClick={() => setEditing(true)}
      className="focus-ring inline-flex min-h-6 items-center rounded-[5px] px-1.5 py-0.5 tabular-nums hover:bg-hover"
    >
      {row.limit}
    </button>
  );
}

export function BudgetsTable({
  rows,
  month,
  monthLabel,
}: {
  rows: readonly BudgetRowView[];
  month: string;
  monthLabel: string;
}) {
  const t = useTranslations("budgets");

  function remove(row: BudgetRowView) {
    void stopBudgetAction(row.scope, month).then((result) =>
      notify(
        result.ok ? t("toasts.removed", { month: monthLabel }) : t("errors.failed"),
        result.ok ? "success" : "error",
      ),
    );
  }

  const menu = (row: BudgetRowView) => (
    <ActionMenu
      label={t("row.menu")}
      items={[{ label: t("row.remove"), onSelect: () => remove(row), danger: true }]}
    />
  );
  const label = (row: BudgetRowView) => (
    <span className="flex min-w-0 flex-col">
      <span className="truncate font-medium">{row.name}</span>
      <span className="truncate text-sm text-muted">{row.detail}</span>
    </span>
  );

  return (
    <>
      <div className="max-md:hidden">
        <Table>
          <THead>
            <Th>{t("columns.category")}</Th>
            <Th>{t("columns.progress")}</Th>
            <Th align="right">{t("columns.spent")}</Th>
            <Th align="right">{t("columns.limit")}</Th>
            <Th align="right">{t("columns.remaining")}</Th>
            <Th>{t("columns.status")}</Th>
            <Th>
              <span className="sr-only">{t("columns.actions")}</span>
            </Th>
          </THead>
          <TBody>
            {rows.map((row) => (
              <Tr key={row.key} data-testid="budget-row">
                <Td>
                  <span className={cn("flex items-center gap-2", row.depth === 1 && "pl-5")}>
                    <Swatch color={row.color} />
                    {label(row)}
                  </span>
                </Td>
                <Td className="w-[32%]">
                  <span className="flex items-center gap-3">
                    <ProgressBar
                      value={row.percent / 100}
                      tone={BAR_TONE[row.status]}
                      label={t("progressOf", { category: row.name, percent: row.percentLabel })}
                    />
                    <span className="w-12 shrink-0 text-right text-sm text-muted tabular-nums">
                      {row.percentLabel}
                    </span>
                  </span>
                </Td>
                <Td align="right">{row.spent}</Td>
                <Td align="right">
                  <LimitCell row={row} month={month} />
                </Td>
                <Td align="right" className={TONE_TEXT[REMAINING_TONE[row.status]]}>
                  {row.remaining}
                </Td>
                <Td>
                  <Badge tone={BADGE_TONE[row.status]}>{t(`status.${row.status}`)}</Badge>
                </Td>
                <Td className="w-8">{menu(row)}</Td>
              </Tr>
            ))}
          </TBody>
        </Table>
      </div>
      <ul className="flex flex-col md:hidden">
        {rows.map((row) => (
          <li
            key={row.key}
            data-testid="budget-item"
            className="flex flex-col gap-2 border-b border-border py-3 last:border-0"
          >
            <div className="flex items-center justify-between gap-2">
              <span className="flex min-w-0 items-center gap-2">
                <Swatch color={row.color} />
                {label(row)}
              </span>
              <span className="flex items-center gap-1">
                <Badge tone={BADGE_TONE[row.status]}>{t(`status.${row.status}`)}</Badge>
                {menu(row)}
              </span>
            </div>
            <ProgressBar
              value={row.percent / 100}
              tone={BAR_TONE[row.status]}
              label={t("progressOf", { category: row.name, percent: row.percentLabel })}
            />
            <div className="flex items-center justify-between text-sm tabular-nums">
              <span className="text-muted">
                {row.spent} / <LimitCell row={row} month={month} />
              </span>
              <span className={TONE_TEXT[REMAINING_TONE[row.status]]}>{row.remaining}</span>
            </div>
          </li>
        ))}
      </ul>
    </>
  );
}
