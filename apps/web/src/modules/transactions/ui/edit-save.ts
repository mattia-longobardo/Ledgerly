"use client";

import { useTranslations } from "next-intl";
import { useState, useTransition } from "react";
import { notify } from "@ledgerly/ui/toast";
import { editInSource, setCategory, setLabels, setNote, setTransferSide } from "./commands";
import { type EditForm, type EditPlan, isEmpty, planOf, type TypeStep } from "./edit-plan";
import type { RowView } from "./view";

type Text = ReturnType<typeof useTranslations<"expenses">>;

/** One write of a save: the message of its refusal, or `null` once it is saved. */
type Write = () => Promise<string | null>;

const SOURCE_ERRORS = ["invalid", "amount", "notLinked", "noTransferCategory", "refused", "failed"] as const;

function refusal(text: Text, code: string): string {
  if (code === "not_found") return text("errors.notFound");
  if (code === "provider_owned") return text("errors.providerOwned");
  return text("errors.failed");
}

function sourceRefusal(text: Text, code: string, reason?: string): string {
  const key = SOURCE_ERRORS.find((one) => one === code) ?? "failed";
  const message = text(`atSource.errors.${key}`);
  return reason ? `${message} ${text("atSource.said", { reason })}` : message;
}

interface Context {
  row: Pick<RowView, "id">;
  text: Text;
  onCategoryChosen: (id: string, categoryId: string) => void;
}

/** A type step. A giroconto that became a spending with its category says the category, not the type. */
function stepWrite({ row, text, onCategoryChosen }: Context, step: TypeStep, quiet: boolean): Write {
  if (step.write === "side")
    return async () => {
      const result = await setTransferSide(row.id, step.side);
      if (!result.ok) return text("transfer.failed");
      if (!quiet) notify(text(step.side.kind === "none" ? "transfer.toasts.none" : "transfer.toasts.saved"));
      return null;
    };
  return async () => {
    const result = await setCategory([row.id], step.categoryId);
    if (!result.ok) return refusal(text, result.error);
    notify(text("toasts.categorySet", { count: result.count }));
    if (result.count > 0 && step.categoryId !== null) onCategoryChosen(row.id, step.categoryId);
    return null;
  };
}

/** The note or the labels: one route, one toast. */
function fieldWrite(
  text: Text,
  work: () => Promise<{ ok: true } | { ok: false; error: string }>,
  toast: "toasts.noteSaved" | "toasts.labelsSaved",
): Write {
  return async () => {
    const result = await work();
    if (!result.ok) return refusal(text, result.error);
    notify(text(toast));
    return null;
  };
}

/** The writes of a plan, in order: the source first, since nothing changes here unless it accepts. */
function writesOf(context: Context, plan: EditPlan): Write[] {
  const { row, text } = context;
  const { source, note, labelIds } = plan;
  const quiet = plan.steps.some((step) => step.write === "category");
  const writes: Write[] = [];
  if (source)
    writes.push(async () => {
      const result = await editInSource(row.id, source);
      if (!result.ok) return sourceRefusal(text, result.error, result.reason);
      notify(text(result.state === "saved" ? "atSource.saved" : "atSource.unchanged"));
      return null;
    });
  writes.push(...plan.steps.map((step) => stepWrite(context, step, quiet)));
  if (note !== null) writes.push(fieldWrite(text, () => setNote(row.id, note), "toasts.noteSaved"));
  if (labelIds !== null)
    writes.push(fieldWrite(text, () => setLabels(row.id, labelIds), "toasts.labelsSaved"));
  return writes;
}

/**
 * The save of the edit dialog: the writes one after the other, stopping at the first refusal, which
 * the dialog then shows. An unchanged dialog writes nothing and just closes.
 */
export function useEditSave(
  row: Parameters<typeof planOf>[0] & Pick<RowView, "id">,
  onClose: () => void,
  onCategoryChosen: (id: string, categoryId: string) => void,
) {
  const text = useTranslations("expenses");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function save(form: EditForm) {
    const plan = planOf(row, form);
    if (isEmpty(plan)) return onClose();
    startTransition(async () => {
      try {
        for (const write of writesOf({ row, text, onCategoryChosen }, plan)) {
          const refused = await write();
          if (refused !== null) return setError(refused);
        }
        setError(null);
        onClose();
      } catch {
        setError(text("errors.failed"));
      }
    });
  }
  return { error, pending, save };
}
