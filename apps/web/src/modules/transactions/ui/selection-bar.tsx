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
  onClear: () => void;
}) {
  const text = useTranslations("expenses");
  const ids = chosen.map((row) => row.id);
  /** The selected rows that carry a suggestion: what "Confirm suggestions" confirms. */
  const suggested = chosen.filter((row) => row.categoryState === "suggestion");
  /** Every selected row is already hidden: the only thing left to offer is putting them back. */
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
