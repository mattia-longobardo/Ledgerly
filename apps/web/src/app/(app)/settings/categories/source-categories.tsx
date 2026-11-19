"use client";

import { useTranslations } from "next-intl";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { Badge } from "@/ui/badge";
import { LinkButton } from "@/ui/button";
import { type CategoryOption, CategoryPicker } from "@/ui/category-picker";
import { cn } from "@/ui/cn";
import { Segmented } from "@/ui/segmented";
import { notify } from "@/ui/toast";

/** One category of a source, as its row draws it. */
export interface SourceCategoryRow {
  id: string;
  /** What the source calls it, and whether it sits under a group there. */
  name: string;
  nested: boolean;
  count: number;
  isNew: boolean;
  /** "added": it counts under its own category. "matched": under `category`. */
  choice: "added" | "matched";
  /** The category it counts under, when it is matched. */
  category: { id: string; name: string; color: string } | null;
  /** The categories it may be matched to: the ones of its own kind. */
  options: readonly CategoryOption[];
}

type ChangeResult =
  | {
      ok: true;
      name: string;
      categoryName: string;
      choice: "added" | "matched";
      macro?: { from: "income" | "expense" | "transfer"; to: "income" | "expense" | "transfer" } | null;
      moved: number;
      undoId: string | null;
    }
  | { ok: false };

export interface SourceCategoryCommands {
  set(id: string, categoryId: string | null): Promise<ChangeResult>;
  undo(undoId: string): Promise<{ ok: boolean }>;
  keep(id: string): Promise<{ ok: boolean }>;
}

/**
 * "Categories of {source}" (ux/n3-categories-manual.md §6.4): for each category the source gives,
 * the category it counts under here — its own, added with its name, or another one the person
 * matches it to. A change is saved at once and can be undone from its toast: it moves nothing on
 * the source, and no movement of the source is given another category.
 *
 * A table from 768 px, one card for each category below: the same controls in both.
 */
export function SourceCategories({
  source,
  rows,
  commands,
}: {
  /** The name of the source, as a person reads it. */
  source: string;
  rows: readonly SourceCategoryRow[];
  commands: SourceCategoryCommands;
}) {
  const t = useTranslations("settings.categories.source");
  const tExpenses = useTranslations("expenses");
  const router = useRouter();
  const [filter, setFilter] = useState<"all" | "new">("all");
  const [picking, setPicking] = useState<string | null>(null);
  const [saving, setSaving] = useState<string | null>(null);
  const [failed, setFailed] = useState<string | null>(null);

  const fresh = rows.filter((row) => row.isNew);
  const shown = filter === "new" ? fresh : rows;

  async function undo(undoId: string) {
    try {
      const result = await commands.undo(undoId);
      if (!result.ok) notify(t("failed"), "error");
    } catch {
      notify(t("failed"), "error");
    }
    router.refresh();
  }

  async function choose(row: SourceCategoryRow, categoryId: string | null) {
    setSaving(row.id);
    setFailed(null);
    try {
      const result = await commands.set(row.id, categoryId);
      if (!result.ok) setFailed(row.id);
      else if (result.undoId !== null) {
        const undoId = result.undoId;
        // A match to another macro says how the movements count now (categories-and-rules.md §2.4).
        const macro =
          result.macro && result.moved > 0
            ? ` · ${t("toasts.macro", { count: result.moved, from: t(`toasts.fromWord.${result.macro.from}`) })}`
            : "";
        notify(
          (result.choice === "matched"
            ? t("toasts.linked", { name: result.name, category: result.categoryName, count: result.moved })
            : t("toasts.added", { name: result.name, count: result.moved })) + macro,
          "success",
          { label: t("undo"), onClick: () => void undo(undoId) },
        );
      }
    } catch {
      setFailed(row.id);
    } finally {
      setSaving(null);
      router.refresh();
    }
  }

  async function keep(row: SourceCategoryRow) {
    setSaving(row.id);
    try {
      await commands.keep(row.id);
    } finally {
      setSaving(null);
      router.refresh();
    }
  }

  if (rows.length === 0) {
    return <p className="p-4 text-muted">{t("empty", { provider: source })}</p>;
  }

  /** The name on the source, the count of its movements and, for a new one, its mark. */
  function theirs(row: SourceCategoryRow) {
    return (
      <span className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
        <span className={cn("min-w-0 break-words", row.nested && "md:pl-4")}>
          {t("row", { name: row.name, count: row.count })}
        </span>
        {row.isNew && (
          <>
            <Badge tone="accent">{t("new")}</Badge>
            <LinkButton disabled={saving !== null} onClick={() => void keep(row)}>
              {t("keep")}
            </LinkButton>
          </>
        )}
      </span>
    );
  }

  /** The chooser: "Add as a new category" first, then the person's categories of the right kind. */
  function ours(row: SourceCategoryRow, variant: "table" | "list") {
    const key = `${variant}:${row.id}`;
    return (
      <span className="flex min-w-0 flex-col gap-1">
        <CategoryPicker
          categories={row.options}
          currentId={row.choice === "matched" ? (row.category?.id ?? null) : null}
          open={picking === key}
          onOpenChange={(open) => setPicking(open ? key : null)}
          onPick={(categoryId) => void choose(row, categoryId)}
          uncategorisedLabel={t("addOption")}
          searchLabel={tExpenses("row.searchCategory")}
          noMatchLabel={tExpenses("row.noCategoryMatch")}
          triggerLabel={t("pickerLabel", { name: row.name })}
          disabled={saving !== null}
          triggerClassName="focus-ring flex h-8 w-full min-w-0 items-center gap-1.5 rounded-ctl border border-border bg-card px-2.5 text-left text-base hover:bg-hover disabled:opacity-60"
        >
          {row.choice === "matched" && row.category ? (
            <>
              <span
                aria-hidden
                className="size-2 shrink-0 rounded-xs"
                style={{ background: row.category.color }}
              />
              <span className="min-w-0 flex-1 truncate">{row.category.name}</span>
            </>
          ) : (
            <span className="min-w-0 flex-1 truncate text-muted">{t("added", { name: row.name })}</span>
          )}
          <span aria-hidden className="shrink-0 text-muted">
            ▾
          </span>
        </CategoryPicker>
        {failed === row.id && (
          <span role="alert" className="text-sm text-neg">
            {t("failed")}
          </span>
        )}
      </span>
    );
  }

  return (
    <div data-testid="source-categories" className="flex min-w-0 flex-col">
      <div className="flex px-4 py-3">
        <Segmented
          label={t("filters.label")}
          value={filter}
          onChange={setFilter}
          options={[
            { value: "all", label: t("filters.all") },
            { value: "new", label: t("filters.new", { count: fresh.length }) },
          ]}
        />
      </div>
      {shown.length === 0 ? (
        <p className="border-t border-border p-4 text-muted">{t("noNew")}</p>
      ) : (
        <>
          <table className="w-full table-fixed border-t border-border text-left max-md:hidden">
            <thead>
              <tr className="text-sm text-muted">
                <th scope="col" className="w-1/2 px-4 py-2 font-medium">
                  {t("columns.theirs", { provider: source })}
                </th>
                <th scope="col" className="w-1/2 px-4 py-2 font-medium">
                  {t("columns.ours")}
                </th>
              </tr>
            </thead>
            <tbody>
              {shown.map((row) => (
                <tr key={row.id} data-testid="source-category-row" className="border-t border-border">
                  <td className="px-4 py-2 align-middle">{theirs(row)}</td>
                  <td className="px-4 py-2 align-middle">{ours(row, "table")}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <ul className="flex flex-col md:hidden">
            {shown.map((row) => (
              <li
                key={row.id}
                data-testid="source-category-row"
                className="flex min-w-0 flex-col gap-2 border-t border-border px-4 py-3"
              >
                {theirs(row)}
                {ours(row, "list")}
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  );
}
