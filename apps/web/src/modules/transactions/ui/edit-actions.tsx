"use client";

import { useTranslations } from "next-intl";
import { useId } from "react";
import { Button } from "@ledgerly/ui/button";
import { useRouter } from "@ledgerly/ui/router";
import { useCategoryActions } from "./category-actions";
import { useManualMovement } from "./manual-movement";
import type { RowView } from "./view";

/** The rule editor, prefilled from a movement. */
const ruleFrom = (id: string) => `/settings/finance/rules?from=${id}`;

interface Action {
  label: string;
  run: () => void;
  danger?: boolean;
}

interface ActionsInput {
  row: RowView;
  onVisibility: () => void;
  onDeleteHidden: () => void;
}

/**
 * The actions of one movement, in the order the row's «⋯» menu had them: a rule from it, the
 * manual movement's own dialog and its sending, hide or restore, and delete — a manual movement at
 * once, any other only once it is hidden.
 */
function useActions({ row, onVisibility, onDeleteHidden }: ActionsInput): Action[] {
  const text = useTranslations("expenses");
  const router = useRouter();
  const manual = useManualMovement();
  const automatic = useCategoryActions();
  const own = row.manual != null ? manual : null;
  const retry = row.send?.state === "not_sent" ? own?.retrySend : null;
  const actions: Action[] = [];
  if (automatic) actions.push({ label: text("row.createRule"), run: () => router.push(ruleFrom(row.id)) });
  if (own) actions.push({ label: text("manual.row.edit"), run: () => own.openEdit(row) });
  if (retry) actions.push({ label: text("manual.row.retrySend"), run: () => retry(row) });
  actions.push({
    label: row.hidden ? text("selection.restore") : text("selection.hide"),
    run: onVisibility,
    danger: !row.hidden && !own,
  });
  const remove = removalOf(row, own, onDeleteHidden);
  if (remove) actions.push({ label: text("selection.delete"), run: remove, danger: true });
  return actions;
}

/**
 * «Delete»: a manual movement at once; any other once hidden — but a leg of Investments goes only
 * with its operation (PERS-651).
 */
function removalOf(
  row: RowView,
  own: ReturnType<typeof useManualMovement> | null,
  onDeleteHidden: () => void,
): (() => void) | null {
  if (own) return () => own.openDelete(row);
  return row.hidden && !row.investments ? onDeleteHidden : null;
}

/** What the row's «⋯» menu offered, under the form. Each one leaves the dialog first. */
export function EditActions({
  disabled,
  onClose,
  ...input
}: ActionsInput & {
  disabled: boolean;
  /** Closes the dialog: each action leaves it first. */
  onClose: () => void;
}) {
  const text = useTranslations("expenses");
  const id = useId();
  const actions = useActions(input);
  return (
    <section aria-labelledby={id} className="flex flex-col gap-1.5 border-t border-border pt-3">
      <h3 id={id} className="text-sm font-medium">
        {text("edit.actions")}
      </h3>
      <div className="flex flex-wrap gap-2">
        {actions.map((action) => (
          <Button
            key={action.label}
            size="sm"
            variant={action.danger ? "danger" : "secondary"}
            disabled={disabled}
            onClick={() => {
              onClose();
              action.run();
            }}
          >
            {action.label}
          </Button>
        ))}
      </div>
    </section>
  );
}
