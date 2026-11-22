"use client";

import { GripVertical } from "lucide-react";
import type { Route } from "next";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useRef, useState } from "react";
import type { NumberFormat } from "@ledgerly/format/format";
import {
  deleteRuleAction,
  reorderRulesAction,
  saveRuleAction,
  setRuleActiveAction,
  undoRuleApplyAction,
} from "@/modules/transactions";
import { Badge } from "@ledgerly/ui/badge";
import { Button } from "@ledgerly/ui/button";
import { Card } from "@ledgerly/ui/card";
import type { CategoryOption } from "@ledgerly/ui/category-picker";
import { ActionMenu } from "@ledgerly/ui/menu";
import { Modal } from "@ledgerly/ui/modal";
import { EmptyState } from "@ledgerly/ui/states";
import { Switch } from "@ledgerly/ui/switch";
import { notify } from "@ledgerly/ui/toast";
import { ApplyDialog } from "./apply-dialog";
import { RuleEditor } from "./rule-editor";
import {
  blankLine,
  type Editing,
  editingOf,
  editingOfRule,
  type Named,
  newEditing,
  type RuleDraft,
  type RuleView,
  summaryOf,
} from "./rule-lines";

/**
 * Settings › Rules (categories-and-rules.md §4): the ordered list, the editor with its live
 * preview, "Apply to existing transactions" with its "Undo", and the order by drag or by menu.
 */
export function RulesBoard({
  rules,
  categories,
  labels,
  accounts,
  currencies,
  numberFormat,
  draft,
}: {
  rules: RuleView[];
  categories: CategoryOption[];
  labels: Named[];
  accounts: Named[];
  currencies: string[];
  numberFormat: NumberFormat;
  draft: RuleDraft | null;
}) {
  const t = useTranslations("settings.rules");
  const router = useRouter();
  const [order, setOrder] = useState(rules);
  const [shownRules, setShownRules] = useState(rules);
  const [editing, setEditing] = useState<Editing | null>(() => editingOf(draft, numberFormat));
  const [shownDraft, setShownDraft] = useState(draft);
  const [applying, setApplying] = useState<RuleView | null>(null);
  const [removing, setRemoving] = useState<RuleView | null>(null);
  const [announce, setAnnounce] = useState("");
  const dragged = useRef<number | null>(null);

  // The server's list after every write; the draft of a link opens the editor once.
  if (shownRules !== rules) {
    setShownRules(rules);
    setOrder(rules);
  }
  if (shownDraft !== draft) {
    setShownDraft(draft);
    if (draft !== null) setEditing(editingOf(draft, numberFormat));
  }

  /** "Section › category", as the dialog "Apply" names where the movements go. */
  const categoryName = (id: string | null) => {
    const one = categories.find((category) => category.id === id);
    return one ? [one.section, one.name].filter(Boolean).join(" › ") : "";
  };

  function openNew() {
    if (order.length >= 200) {
      notify(t("limit"), "error");
      return;
    }
    setEditing(newEditing([blankLine("text", currencies[0] ?? "EUR")]));
  }

  function openEdit(rule: RuleView) {
    setEditing(editingOfRule(rule, numberFormat));
  }

  async function duplicate(rule: RuleView) {
    const result = await saveRuleAction(null, {
      name: t("copyName", { name: rule.name }).slice(0, 80),
      active: rule.active,
      conditions: rule.conditions,
      categoryId: rule.categoryId,
      labelIds: rule.labelIds,
      note: rule.note,
    });
    if (!result.ok) notify(result.error === "limit" ? t("limit") : t("error"), "error");
  }

  async function move(index: number, to: number) {
    if (to < 0 || to >= order.length || to === index) return;
    const before = order;
    const next = [...order];
    const [rule] = next.splice(index, 1);
    next.splice(to, 0, rule);
    setOrder(next);
    const result = await reorderRulesAction(next.map((one) => one.id));
    if (!result.ok) {
      setOrder(before);
      notify(t("error"), "error");
      return;
    }
    setAnnounce(t("moved", { name: rule.name, n: to + 1 }));
  }

  async function toggle(rule: RuleView, active: boolean) {
    setOrder((list) => list.map((one) => (one.id === rule.id ? { ...one, active } : one)));
    const result = await setRuleActiveAction(rule.id, active);
    if (!result.ok) {
      setOrder((list) => list.map((one) => (one.id === rule.id ? { ...one, active: !active } : one)));
      notify(t("error"), "error");
    }
  }

  function applied(result: { count: number; undoId: string | null }) {
    const undoId = result.undoId;
    notify(
      t("apply.done", { count: result.count }),
      "success",
      undoId === null
        ? undefined
        : {
            label: t("undo"),
            onClick: () => {
              undoRuleApplyAction(undoId)
                .then((done) => !done.ok && notify(t("apply.failed"), "error"))
                .catch(() => notify(t("apply.failed"), "error"));
            },
          },
    );
  }

  return (
    <section aria-labelledby="rules-title" className="flex flex-col gap-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex max-w-[640px] flex-col gap-1">
          <h2 id="rules-title" className="text-lg font-semibold">
            {t("title")}
          </h2>
          <p className="text-muted">{t("intro")}</p>
        </div>
        <Button variant="primary" size="sm" onClick={openNew}>
          {t("new")}
        </Button>
      </div>
      <p role="status" aria-live="polite" className="sr-only">
        {announce}
      </p>

      {order.length === 0 ? (
        <EmptyState
          title={t("empty.title")}
          description={t("empty.body")}
          actions={
            <Button size="sm" onClick={openNew}>
              {t("new")}
            </Button>
          }
        />
      ) : (
        <Card padded={false} className="overflow-hidden">
          <ol className="flex flex-col">
            {order.map((rule, index) => (
              <li
                key={rule.id}
                id={`rule-${rule.id}`}
                data-testid="rule-row"
                draggable
                onDragStart={() => {
                  dragged.current = index;
                }}
                onDragOver={(event) => event.preventDefault()}
                onDrop={(event) => {
                  event.preventDefault();
                  if (dragged.current !== null) void move(dragged.current, index);
                  dragged.current = null;
                }}
                className="flex scroll-mt-20 gap-2 border-t border-border px-3 py-3 first:border-0 target:bg-sel"
              >
                <span
                  aria-hidden
                  title={t("drag", { name: rule.name })}
                  className="mt-0.5 inline-grid size-6 shrink-0 cursor-grab place-items-center text-faint max-md:hidden"
                >
                  <GripVertical className="size-4" />
                </span>
                <span className="mt-0.5 w-5 shrink-0 text-right text-muted tabular-nums">{index + 1}</span>
                <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                  <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                    <span className="min-w-0 font-medium break-words">{rule.name}</span>
                    {!rule.active && <Badge tone="neutral">{t("off")}</Badge>}
                    {rule.categoryArchived && <Badge tone="warn">{t("archivedCategory")}</Badge>}
                  </div>
                  <p className="text-sm break-words text-muted">
                    {rule.conditions
                      .map((condition) => summaryOf(condition, t, accounts, numberFormat))
                      .join(" · ")}
                  </p>
                  <p className="text-sm break-words">
                    → {rule.path} · {t("count", { count: rule.count })}
                  </p>
                </div>
                <div className="flex shrink-0 items-start gap-1">
                  <Switch
                    checked={rule.active}
                    onCheckedChange={(active) => void toggle(rule, active)}
                    label={t("activeName", { name: rule.name })}
                  />
                  <ActionMenu
                    label={t("actions", { name: rule.name })}
                    items={[
                      { label: t("edit"), onSelect: () => openEdit(rule) },
                      ...(rule.categoryArchived
                        ? []
                        : [{ label: t("applyMenu"), onSelect: () => setApplying(rule) }]),
                      { label: t("duplicate"), onSelect: () => void duplicate(rule) },
                      ...(index > 0
                        ? [{ label: t("moveUp"), onSelect: () => void move(index, index - 1) }]
                        : []),
                      ...(index < order.length - 1
                        ? [{ label: t("moveDown"), onSelect: () => void move(index, index + 1) }]
                        : []),
                      { label: t("delete.action"), onSelect: () => setRemoving(rule), danger: true },
                    ]}
                  />
                </div>
              </li>
            ))}
          </ol>
        </Card>
      )}

      {editing !== null && (
        <RuleEditor
          editing={editing}
          setEditing={setEditing}
          categories={categories}
          labels={labels}
          accounts={accounts}
          currencies={currencies}
          numberFormat={numberFormat}
          onClose={() => {
            setEditing(null);
            if (draft !== null) router.replace("/settings/finance/rules" as Route);
          }}
          onSaved={(id, changes, name) => {
            setEditing(null);
            notify(
              t("saved"),
              "success",
              changes > 0
                ? {
                    label: t("applyExisting", { count: changes }),
                    onClick: () => setApplying({ id, name } as RuleView),
                  }
                : undefined,
            );
            if (draft !== null) router.replace("/settings/finance/rules" as Route);
          }}
        />
      )}

      {applying !== null && (
        <ApplyDialog
          rule={applying}
          categoryName={categoryName}
          onClose={() => setApplying(null)}
          onApplied={(result) => {
            setApplying(null);
            applied(result);
          }}
        />
      )}

      {removing !== null && (
        <Modal
          open
          width={420}
          onOpenChange={(open) => !open && setRemoving(null)}
          title={t("delete.title", { name: removing.name })}
          footer={
            <>
              <Button size="sm" onClick={() => setRemoving(null)}>
                {t("cancel")}
              </Button>
              <Button
                size="sm"
                variant="danger"
                onClick={async () => {
                  const rule = removing;
                  const result = await deleteRuleAction(rule.id, true);
                  setRemoving(null);
                  if (!result.ok) {
                    notify(t("error"), "error");
                    return;
                  }
                  notify(t("deleted"), "success", {
                    label: t("undo"),
                    onClick: () => {
                      deleteRuleAction(rule.id, false).catch(() => notify(t("error"), "error"));
                    },
                  });
                }}
              >
                {t("delete.confirm")}
              </Button>
            </>
          }
        >
          <p>{t("delete.body", { count: removing.count })}</p>
        </Modal>
      )}
    </section>
  );
}
