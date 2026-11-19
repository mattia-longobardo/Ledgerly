"use client";

import { Popover } from "@base-ui/react/popover";
import { Sparkles } from "lucide-react";
import type { Route } from "next";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { useState } from "react";
import { Button } from "@/ui/button";
import { CategoryPicker } from "@/ui/category-picker";
import { cn } from "@/ui/cn";
import type { CategoryOption, RowView } from "./view";

// 24 px, not 22: the category chip is a button, and a button is a target (plan F9 §3.4).
export const CHIP = "focus-ring inline-flex h-6 items-center gap-1.5 rounded-sm px-1.5 text-sm";

/** The reasons the interface has a sentence for; any other code reads the fallback (ux §2.2). */
const REASONS = [
  "memory",
  "similar",
  "merchant_type",
  "brand",
  "salary",
  "fee",
  "rule",
  "rule_deleted",
] as const;

/** What the cell of a category needs of a row. */
type CellRow = Pick<
  RowView,
  | "id"
  | "categoryId"
  | "categoryName"
  | "categoryColor"
  | "categoryState"
  | "categoryReason"
  | "suggestion"
  | "macros"
  | "paired"
>;

/**
 * The category of a movement in its five states (ux/n3-categories-manual.md §1.2, §2, §3): chosen
 * by a person or given by the source (a plain chip), automatic (the chip and a mark that opens the
 * reason), suggested (a dashed chip that opens the suggestion), or none. Every write goes out
 * through the callbacks: the cell reads and writes nothing itself.
 *
 * `open` and `onOpenChange` are the category picker's, held by the table so one key (`E`) and one
 * menu item can open it. With `onConfirm` left out the cell is the plain chip of before, whatever
 * the row's state: a page that did not set the automatic categories up shows none.
 */
export function CategoryCell({
  row,
  categories,
  open,
  onOpenChange,
  onPick,
  onConfirm,
  disabled,
  wide = false,
}: {
  row: CellRow;
  categories: readonly CategoryOption[];
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onPick: (categoryId: string | null) => void;
  /** Confirms the automatic category or the suggestion; answers whether it was saved. */
  onConfirm?: () => Promise<boolean>;
  disabled?: boolean;
  /** The phone's list: the mark says its word, and a long name wraps instead of being cut. */
  wide?: boolean;
}) {
  const t = useTranslations("expenses");
  const [reasonOpen, setReasonOpen] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const state = onConfirm === undefined ? "chosen" : (row.categoryState ?? "chosen");
  const suggestion = state === "suggestion" ? (row.suggestion ?? null) : null;

  function reasonText(): string {
    const reason = row.categoryReason;
    const code = REASONS.find((one) => one === reason?.code);
    if (!reason || code === undefined) return t("auto.reason.other");
    return t(`auto.reason.${code}`, {
      text: reason.params.text ?? "",
      brand: reason.params.brand ?? "",
      name: reason.params.name ?? "",
    });
  }

  function confirm() {
    if (!onConfirm || confirming) return;
    setConfirming(true);
    onConfirm()
      .then((saved) => {
        if (saved) setReasonOpen(false);
      })
      .finally(() => setConfirming(false));
  }

  /** The reason of an automatic category or of a suggestion, with its two actions. */
  function reasonPopup(title: string, category: { name: string; color: string }, other: string) {
    return (
      <Popover.Portal>
        <Popover.Positioner sideOffset={4} align="start" className="z-[60]">
          <Popover.Popup
            aria-label={title}
            className="flex w-[280px] max-w-[calc(100vw-32px)] animate-in flex-col gap-2 rounded-lg border border-border bg-card p-3 shadow-overlay"
          >
            <p className="text-sm font-semibold">{title}</p>
            <p className="flex items-center gap-1.5 text-sm break-words">
              <span
                aria-hidden
                className="size-2 shrink-0 rounded-xs"
                style={{ background: category.color }}
              />
              {category.name}
            </p>
            <p className="text-sm text-muted">
              {reasonText()}
              {state === "suggestion" && ` ${t("auto.suggestion.notCounted")}`}
            </p>
            {row.categoryReason?.code === "rule" && row.categoryReason.params.ruleId && (
              <Link
                href={`/settings/rules#rule-${row.categoryReason.params.ruleId}` as Route}
                className="focus-ring inline-flex min-h-6 items-center self-start rounded-xs text-sm text-accent hover:underline"
              >
                {t("auto.openRule")}
              </Link>
            )}
            <div className="flex justify-end gap-2">
              <Button
                size="sm"
                disabled={confirming}
                onClick={() => {
                  setReasonOpen(false);
                  onOpenChange(true);
                }}
              >
                {other}
              </Button>
              <Button size="sm" variant="primary" disabled={confirming} onClick={confirm} autoFocus>
                {t("auto.confirm")}
              </Button>
            </div>
          </Popover.Popup>
        </Popover.Positioner>
      </Popover.Portal>
    );
  }

  // A suggestion: one dashed chip that opens it. "Choose another" hands over to the picker, which
  // then takes the chip's place until it closes.
  if (suggestion !== null && !open) {
    return (
      <Popover.Root open={reasonOpen} onOpenChange={setReasonOpen}>
        <Popover.Trigger
          data-testid="suggestion-chip"
          disabled={disabled}
          aria-label={t("auto.suggestion.chipLabel", { category: suggestion.name })}
          title={t("auto.suggestion.chip", { category: suggestion.name })}
          className={cn(
            CHIP,
            "max-w-full border border-dashed border-muted text-muted hover:bg-card",
            wide && "h-auto min-h-6 py-0.5 text-left",
          )}
        >
          <span
            aria-hidden
            className="size-[7px] shrink-0 rounded-xs border"
            style={{ borderColor: suggestion.color }}
          />
          <span className={cn("min-w-0", wide ? "break-words" : "truncate")}>
            {t("auto.suggestion.chip", { category: suggestion.name })}
          </span>
        </Popover.Trigger>
        {reasonPopup(t("auto.suggestion.title"), suggestion, t("auto.suggestion.other"))}
      </Popover.Root>
    );
  }

  const named = row.categoryName !== null && row.categoryColor !== null;
  const picker = (
    <CategoryPicker
      categories={categories.filter(
        (option) =>
          option.type === undefined || row.macros === undefined || row.macros.some((m) => m === option.type),
      )}
      note={row.paired === true ? t("row.paired") : undefined}
      currentId={row.categoryId}
      open={open}
      onOpenChange={onOpenChange}
      onPick={onPick}
      uncategorisedLabel={t("row.uncategorised")}
      searchLabel={t("row.searchCategory")}
      noMatchLabel={t("row.noCategoryMatch")}
      triggerLabel={t("row.editCategory")}
      disabled={disabled}
      triggerClassName={cn(
        CHIP,
        // As wide as its column allows (the table's layout is fixed), and truncated past that.
        "max-w-full min-w-0 border border-transparent hover:border-border hover:bg-card",
        open && "border-accent bg-card",
      )}
    >
      <span
        aria-hidden
        className={cn("size-[7px] shrink-0 rounded-xs", !named && "bg-faint")}
        style={named ? { background: row.categoryColor as string } : undefined}
      />
      <span className="min-w-0 truncate">{row.categoryName ?? t("row.uncategorised")}</span>
    </CategoryPicker>
  );
  if (state !== "automatic" || !named) return picker;

  return (
    <span className="flex max-w-full min-w-0 items-center gap-1">
      {picker}
      <Popover.Root open={reasonOpen} onOpenChange={setReasonOpen}>
        <Popover.Trigger
          data-testid="auto-mark"
          aria-label={t("auto.markLabel")}
          title={t("auto.markLabel")}
          className={cn(
            "focus-ring inline-flex h-6 min-w-6 shrink-0 items-center justify-center gap-1 rounded-sm text-sm text-accent hover:bg-hover",
            wide && "px-1",
          )}
        >
          <Sparkles aria-hidden className="size-3.5" />
          {wide && <span>{t("auto.mark")}</span>}
        </Popover.Trigger>
        {reasonPopup(
          t("auto.title"),
          { name: row.categoryName as string, color: row.categoryColor as string },
          t("auto.change"),
        )}
      </Popover.Root>
    </span>
  );
}
