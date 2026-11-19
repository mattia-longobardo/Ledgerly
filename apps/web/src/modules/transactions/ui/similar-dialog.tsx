"use client";

import { Sparkles } from "lucide-react";
import type { Route } from "next";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { useState } from "react";
import { Button } from "@/ui/button";
import { cn } from "@/ui/cn";
import { Modal } from "@/ui/modal";
import type { CategoryOption } from "./view";

/** A movement similar to the one just filed: its day and its amount already formatted. */
export interface SimilarRowView {
  id: string;
  date: string;
  amount: string;
  categoryId: string | null;
  suggestedCategoryId: string | null;
  automatic: boolean;
}

/** How many of the similar movements the dialog shows before "Show all". */
const SHOWN = 3;

/**
 * "Apply to N similar transactions?" (decision K3; ux/n3-categories-manual.md §5.2). It opens
 * after the first choice is saved: that one does not depend on the answer given here.
 */
export function SimilarDialog({
  text,
  category,
  rows,
  categories,
  onApply,
  onClose,
  createRuleHref,
  rule = null,
}: {
  /** The text of the movement the person filed. */
  text: string;
  category: CategoryOption | null;
  rows: readonly SimilarRowView[];
  categories: readonly CategoryOption[];
  /** Applies the category to every row; `false` when it could not. */
  onApply: () => Promise<boolean>;
  onClose: () => void;
  /** "Create a rule": the editor of the rules, filled from the movement (categories-and-rules.md §4.7). */
  createRuleHref?: string;
  /** The rule that had given the movement its category: it stays as it is (§4.5). */
  rule?: { id: string; name: string } | null;
}) {
  const t = useTranslations("expenses");
  const [all, setAll] = useState(false);
  const [saving, setSaving] = useState(false);
  const [failed, setFailed] = useState(false);
  const count = rows.length;
  const nameOf = (id: string | null) => categories.find((one) => one.id === id) ?? null;

  function apply() {
    if (saving) return;
    setSaving(true);
    setFailed(false);
    onApply()
      .then((done) => setFailed(!done))
      .catch(() => setFailed(true))
      .finally(() => setSaving(false));
  }

  return (
    <Modal
      open
      onOpenChange={(open) => !open && onClose()}
      title={t("similar.title", { count })}
      footer={
        <div className="flex w-full justify-end gap-2 max-sm:flex-col-reverse">
          {createRuleHref && (
            <Link
              href={createRuleHref as Route}
              className="focus-ring mr-auto inline-flex min-h-6 items-center self-center rounded-xs text-sm text-accent hover:underline max-sm:mr-0"
            >
              {t("similar.createRule")}
            </Link>
          )}
          <Button size="sm" onClick={onClose} disabled={saving}>
            {t("similar.skip")}
          </Button>
          <Button size="sm" variant="primary" onClick={apply} disabled={saving} autoFocus>
            {saving ? t("manual.saving") : t("similar.apply", { count })}
          </Button>
        </div>
      }
    >
      <div data-testid="similar-dialog" className="flex flex-col gap-3">
        {failed && (
          <p role="alert" className="text-sm text-neg">
            {t("similar.failed")}
          </p>
        )}
        <p className="text-sm break-words">
          {t("similar.chosen", { text, category: category?.name ?? "" })} {t("similar.body", { count })}
        </p>
        {rule && (
          <p className="text-sm break-words text-muted">
            {t("similar.ruleStays", { name: rule.name })}{" "}
            <Link
              href={`/settings/rules#rule-${rule.id}` as Route}
              className="focus-ring rounded-xs text-accent hover:underline"
            >
              {t("similar.editRule")}
            </Link>
          </p>
        )}
        <ul className={cn("flex flex-col text-sm", all && "max-h-60 overflow-y-auto")}>
          {(all ? rows : rows.slice(0, SHOWN)).map((row) => {
            const current = nameOf(row.categoryId);
            const suggested = nameOf(row.suggestedCategoryId);
            return (
              <li
                key={row.id}
                className="flex items-center gap-3 border-b border-border py-1.5 last:border-0"
              >
                <span className="w-24 shrink-0 text-muted">{row.date}</span>
                <span className="w-20 shrink-0 text-right tabular-nums">{row.amount}</span>
                <span className="flex min-w-0 items-center gap-1.5">
                  {current ? (
                    <>
                      <span
                        aria-hidden
                        className="size-[7px] shrink-0 rounded-xs"
                        style={{ background: current.color }}
                      />
                      <span className="min-w-0 truncate">{current.name}</span>
                      {row.automatic && (
                        <>
                          <Sparkles aria-hidden className="size-3.5 shrink-0 text-accent" />
                          <span className="sr-only">{t("auto.mark")}</span>
                        </>
                      )}
                    </>
                  ) : suggested ? (
                    <span className="min-w-0 truncate text-muted">
                      {t("auto.suggestion.chip", { category: suggested.name })}
                    </span>
                  ) : (
                    <span className="text-muted">{t("row.uncategorised")}</span>
                  )}
                </span>
              </li>
            );
          })}
        </ul>
        {count > SHOWN && !all && (
          <Button
            size="xs"
            variant="ghost"
            className="self-start"
            aria-expanded={false}
            onClick={() => setAll(true)}
          >
            {t("similar.showAll", { count })}
          </Button>
        )}
      </div>
    </Modal>
  );
}
