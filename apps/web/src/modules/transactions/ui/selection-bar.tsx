"use client";

import { useTranslations } from "next-intl";
import { Button } from "@ledgerly/ui/button";
import { CategoryPicker } from "@ledgerly/ui/category-picker";
import { cn } from "@ledgerly/ui/cn";
import { CHIP } from "./category-cell";
import type { CategoryOption, RowView } from "./view";

/** The action bar over the selected rows: one category for all, "Confirm suggestions", hide or restore. */
export function SelectionBar({
  chosen,
  categories,
  pickerOpen,
  onPickerOpenChange,
  pending,
  onSetCategory,
  onConfirm,
  onVisibility,
  onPair,
  onClear,
}: {
  chosen: readonly RowView[];
  categories: readonly CategoryOption[];
  pickerOpen: boolean;
  onPickerOpenChange: (open: boolean) => void;
  pending: boolean;
  onSetCategory: (ids: readonly string[], categoryId: string | null) => void;
  /** Where the page set up the automatic categories. */
  onConfirm?: (ids: readonly string[]) => void;
  onVisibility: (ids: readonly string[], hidden: boolean) => void;
  /** Two movements paired by hand as one giroconto; the server says whether they can be. */
  onPair?: (ids: readonly [string, string]) => void;
  onClear: () => void;
}) {
  const text = useTranslations("expenses");
  const ids = chosen.map((row) => row.id);
  // The rows with a suggestion are what "Confirm suggestions" confirms; all hidden, only "Restore" is left.
  const suggested = chosen.filter((row) => row.categoryState === "suggestion");
  const chosenHidden = chosen.every((row) => row.hidden);

  return (
    <div className="flex flex-wrap items-center gap-2 border-b border-border bg-sel px-4 py-1.5 text-sm">
      <span className="font-medium">{text("selection.label", { count: chosen.length })}</span>
      <SelectionCategory
        categories={categories}
        open={pickerOpen}
        onOpenChange={onPickerOpenChange}
        onPick={(categoryId) => onSetCategory(ids, categoryId)}
        disabled={pending}
      />
      {onConfirm && suggested.length > 0 && (
        <Button size="xs" disabled={pending} onClick={() => onConfirm(suggested.map((row) => row.id))}>
          {text("auto.selection.confirm", { count: suggested.length })}
        </Button>
      )}
      {onPair && chosen.length === 2 && (
        <PairButton ids={[ids[0], ids[1]]} onPair={onPair} disabled={pending} />
      )}
      <Button
        size="xs"
        variant={chosenHidden ? "secondary" : "danger"}
        disabled={pending}
        onClick={() => onVisibility(ids, chosenHidden)}
      >
        {chosenHidden ? text("selection.restore") : text("selection.hide")}
      </Button>
      <span className="flex-1" />
      <Button size="xs" variant="ghost" onClick={onClear}>
        {text("selection.clear")}
      </Button>
    </div>
  );
}

/** Two selected movements paired by hand as one giroconto. */
function PairButton({
  ids,
  onPair,
  disabled,
}: {
  ids: readonly [string, string];
  onPair: (ids: readonly [string, string]) => void;
  disabled: boolean;
}) {
  const text = useTranslations("expenses");
  return (
    <Button size="xs" disabled={disabled} onClick={() => onPair(ids)}>
      {text("transfer.pair")}
    </Button>
  );
}

/** "Set category" for every selected row. */
function SelectionCategory({
  categories,
  ...picker
}: {
  categories: readonly CategoryOption[];
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onPick: (categoryId: string | null) => void;
  disabled: boolean;
}) {
  const text = useTranslations("expenses");
  return (
    <CategoryPicker
      categories={categories}
      currentId={null}
      uncategorisedLabel={text("row.uncategorised")}
      searchLabel={text("row.searchCategory")}
      noMatchLabel={text("row.noCategoryMatch")}
      triggerLabel={text("selection.setCategory")}
      triggerClassName={cn(CHIP, "h-6 border border-border bg-card px-2 hover:bg-hover")}
      {...picker}
    >
      {text("selection.setCategory")}
    </CategoryPicker>
  );
}
