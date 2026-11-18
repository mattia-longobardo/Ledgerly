"use client";

import { useTranslations } from "next-intl";
import { useEffect, useId, useState, useTransition } from "react";
import type { CategoryType } from "@ledgerly/domain/transactions/client";
import { Button } from "@/ui/button";
import { Field } from "@/ui/field";
import { Select } from "@/ui/input";
import { Modal } from "@/ui/modal";
import { Segmented } from "@/ui/segmented";
import { notify } from "@/ui/toast";
import {
  type MacroMoveFacts,
  macroMoveFactsAction,
  moveToMacroAction,
  undoMoveToMacroAction,
} from "../../settings/categories/actions";

const MACROS: readonly CategoryType[] = ["income", "expense", "transfer"];

/**
 * "Move to another section" (categories-and-rules.md §5.6, N3.3): a group, or a category of
 * Transfers, goes to another macro. The dialog says first what changes — the movements that no
 * longer count as before, those a subscription, a pocket or an interest rule uses (§3.5), the
 * budget that stops (QC8), a source's movements that move too — and the toast has "Undo".
 */
export function MacroMoveDialog({
  line,
  childCount,
  groupsOf,
  onClose,
}: {
  line: { id: string; name: string; type: CategoryType };
  /** Its categories, which go with it. */
  childCount: number;
  groupsOf: (type: CategoryType) => readonly { id: string; name: string }[];
  onClose: () => void;
}) {
  const t = useTranslations("expenses.categories");
  const ts = useTranslations("settings.categories");
  const ids = useId();
  const [facts, setFacts] = useState<MacroMoveFacts | null>(null);
  const [failed, setFailed] = useState(false);
  const [to, setTo] = useState<CategoryType>(() => MACROS.find((macro) => macro !== line.type) ?? "expense");
  const [pending, startTransition] = useTransition();
  const lineId = line.id;

  // Mounted once per opening (the board keys it on the category): read what the move changes.
  useEffect(() => {
    let live = true;
    void macroMoveFactsAction(lineId)
      .then((result) => {
        if (!live) return;
        if (result.ok) setFacts(result.facts);
        else setFailed(true);
      })
      .catch(() => live && setFailed(true));
    return () => {
      live = false;
    };
  }, [lineId]);

  const macroName = (key: CategoryType) => t(`macro.${key}`);
  const offered = MACROS.filter((macro) => macro !== line.type);
  // Transfers has no groups (CR2); a group with categories stays a group (no third level).
  const groups = to === "transfer" || childCount > 0 ? [] : groupsOf(to);

  function submit(parentId: string | null) {
    const moved = line;
    startTransition(async () => {
      const result = await moveToMacroAction(moved.id, { type: to, parentId });
      if (!result.ok) {
        setFailed(true);
        return;
      }
      onClose();
      const undo = result.undo;
      notify(t("macroMove.done", { name: moved.name, macro: macroName(to) }), "success", {
        label: t("undo"),
        onClick: () =>
          void undoMoveToMacroAction(undo).then((undone) =>
            notify(undone.ok ? t("undone") : ts("errors.failed"), undone.ok ? "success" : "error"),
          ),
      });
    });
  }

  return (
    <Modal
      open
      onOpenChange={(next) => !next && onClose()}
      title={t("macroMove.title", { name: line.name })}
      width={460}
      footer={
        <>
          <Button size="sm" onClick={onClose}>
            {ts("cancel")}
          </Button>
          <Button
            type="submit"
            form={`${ids}-form`}
            variant="primary"
            size="sm"
            disabled={pending || facts === null}
            aria-busy={pending}
          >
            {t("macroMove.action")}
          </Button>
        </>
      }
    >
      <form
        id={`${ids}-form`}
        className="flex flex-col gap-3"
        onSubmit={(event) => {
          event.preventDefault();
          const parentId = String(new FormData(event.currentTarget).get("parentId") ?? "");
          submit(parentId === "" ? null : parentId);
        }}
      >
        {failed && (
          <p role="alert" className="text-sm text-neg">
            {t("macroMove.failed")}
          </p>
        )}
        <div className="flex flex-col gap-1.5">
          <span aria-hidden className="text-sm font-medium">
            {t("macroMove.to")}
          </span>
          <Segmented
            label={t("macroMove.to")}
            value={to}
            onChange={setTo}
            options={offered.map((key) => ({ value: key, label: macroName(key) }))}
          />
        </div>
        {groups.length > 0 && (
          <Field label={t("macroMove.group")} htmlFor={`${ids}-parent`}>
            <Select id={`${ids}-parent`} name="parentId" defaultValue="" key={to}>
              <option value="">{t("macroMove.ownGroup")}</option>
              {groups.map((group) => (
                <option key={group.id} value={group.id}>
                  {group.name}
                </option>
              ))}
            </Select>
          </Field>
        )}
        <div aria-live="polite" aria-busy={facts === null && !failed} className="flex flex-col gap-2 text-sm">
          {facts === null ? (
            !failed && <p className="text-muted">{t("macroMove.loading")}</p>
          ) : (
            <>
              <p>
                {t("macroMove.effect", {
                  count: facts.count,
                  from: t(`fromWord.${facts.from}`),
                  amount: facts.amount,
                  year: String(facts.firstYear ?? ""),
                })}
              </p>
              {childCount > 0 && (
                <p>{t("macroMove.children", { count: childCount, macro: macroName(to) })}</p>
              )}
              {(["subscriptions", "pockets", "interests"] as const)
                .filter((key) => facts.linked[key] > 0)
                .map((key) => (
                  <p key={key} className="text-muted">
                    {t("macroMove.linked", {
                      count: facts.linked[key],
                      where: t(`macroMove.where.${key}`),
                    })}
                  </p>
                ))}
              {facts.stopsBudget && to === "transfer" && (
                <p className="text-muted">{t("macroMove.budget")}</p>
              )}
              {facts.sources.map((provider) => (
                <p key={provider} className="text-muted">
                  {t("macroMove.sources", { provider })}
                </p>
              ))}
            </>
          )}
        </div>
      </form>
    </Modal>
  );
}
