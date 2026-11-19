"use client";

import { useTranslations } from "next-intl";
import { createContext, type ReactNode, useCallback, useContext, useMemo, useState } from "react";
import { notify } from "@ledgerly/ui/toast";
import { SimilarDialog, type SimilarRowView } from "./similar-dialog";
import type { CategoryOption } from "./view";

/** What an action on the category of several movements answers: how many changed, and how to undo. */
type CategoryChangeResult = { ok: true; count: number; undoId: string | null } | { ok: false; error: string };

/**
 * The writes and the read of the automatic categories, handed in by the page: Server Actions, so
 * no component here imports one (rewrite plan N3; ux/n3-categories-manual.md §18).
 */
export interface CategoryCommands {
  confirm(ids: string[]): Promise<CategoryChangeResult>;
  choose(ids: string[], categoryId: string | null): Promise<CategoryChangeResult>;
  undo(undoId: string): Promise<{ ok: true; count: number } | { ok: false; error: string }>;
  similar(id: string, categoryId: string): Promise<{ text: string; rows: SimilarRowView[] }>;
}

interface CategoryActionsApi {
  commands: CategoryCommands;
  /** Confirms the automatic category or the suggestion of some rows, and says so. */
  confirm(ids: readonly string[]): Promise<boolean>;
  /**
   * After a person chose `categoryId` for one row: asks whether the similar ones follow (K3).
   * `rule` is the rule that had given the row its category, which stays as it is (§4.5).
   */
  afterChoice(id: string, categoryId: string, rule?: { id: string; name: string } | null): void;
  /** A toast for an action on several rows, with its "Undo". */
  changed(result: Extract<CategoryChangeResult, { ok: true }>): void;
}

const CategoryActionsContext = createContext<CategoryActionsApi | null>(null);

/** `null` where no page set the automatic categories up: the rows then behave as they did before. */
export function useCategoryActions(): CategoryActionsApi | null {
  return useContext(CategoryActionsContext);
}

/**
 * The automatic categories of a screen that lists movements: "Confirm", the question "Apply to N
 * similar transactions?" after a choice, and the toast with "Undo" after an action on several.
 */
export function CategoryActions({
  commands,
  categories,
  children,
}: {
  commands: CategoryCommands;
  categories: readonly CategoryOption[];
  children: ReactNode;
}) {
  const t = useTranslations("expenses");
  const [similar, setSimilar] = useState<{
    id: string;
    categoryId: string;
    text: string;
    rows: SimilarRowView[];
    rule: { id: string; name: string } | null;
  } | null>(null);

  const changed = useCallback(
    (result: Extract<CategoryChangeResult, { ok: true }>) => {
      const undoId = result.undoId;
      notify(
        t("similar.applied", { count: result.count }),
        "success",
        undoId === null
          ? undefined
          : {
              label: t("similar.undo"),
              onClick: () => {
                commands.undo(undoId).catch(() => notify(t("errors.failed"), "error"));
              },
            },
      );
    },
    [commands, t],
  );

  const api = useMemo<CategoryActionsApi>(
    () => ({
      commands,
      changed,
      async confirm(ids) {
        try {
          const result = await commands.confirm([...ids]);
          if (!result.ok) {
            notify(result.error === "not_found" ? t("errors.notFound") : t("auto.failed"), "error");
            return false;
          }
          if (ids.length === 1) notify(t("auto.confirmed"));
          else changed(result);
          return true;
        } catch {
          notify(t("auto.failed"), "error");
          return false;
        }
      },
      afterChoice(id, categoryId, rule = null) {
        commands
          .similar(id, categoryId)
          .then((answer) => {
            if (answer.rows.length > 0) setSimilar({ id, categoryId, rule, ...answer });
          })
          // The first choice is saved whatever happens here: no question is asked, that is all.
          .catch(() => undefined);
      },
    }),
    [commands, changed, t],
  );

  return (
    <CategoryActionsContext.Provider value={api}>
      {children}
      {similar !== null && (
        <SimilarDialog
          text={similar.text}
          category={categories.find((category) => category.id === similar.categoryId) ?? null}
          rows={similar.rows}
          categories={categories}
          createRuleHref={`/settings/rules?from=${similar.id}&category=${similar.categoryId}`}
          rule={similar.rule}
          onClose={() => setSimilar(null)}
          onApply={async () => {
            const result = await commands.choose(
              similar.rows.map((row) => row.id),
              similar.categoryId,
            );
            if (!result.ok) return false;
            setSimilar(null);
            changed(result);
            return true;
          }}
        />
      )}
    </CategoryActionsContext.Provider>
  );
}
