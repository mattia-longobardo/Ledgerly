"use client";

import { GripVertical } from "lucide-react";
import type { Route } from "next";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { type FormEvent, useEffect, useId, useRef, useState } from "react";
import {
  AMOUNT_OPS,
  COUNTERPARTY_OPS,
  DIRECTIONS,
  MAX_CONDITIONS,
  MAX_TEXT_CONDITIONS,
  NOTE_MAX,
  RULE_FIELDS,
  RULE_SOURCES,
  type RuleField,
  TEXT_OPS,
} from "@ledgerly/domain/transactions/client";
import { parseCents } from "@ledgerly/format/cents";
import { formatAmountInput, type NumberFormat } from "@ledgerly/format/format";
import {
  applyRuleAction,
  deleteRuleAction,
  type PreviewView,
  previewRuleAction,
  previewSavedRuleAction,
  reorderRulesAction,
  type RuleCondition,
  type RuleInput,
  ruleAmount,
  saveRuleAction,
  setRuleActiveAction,
  undoRuleApplyAction,
} from "@/modules/transactions";
import { Badge } from "@ledgerly/ui/badge";
import { Button } from "@ledgerly/ui/button";
import { Card } from "@ledgerly/ui/card";
import { CategoryPicker, type CategoryOption } from "@ledgerly/ui/category-picker";
import { Checkbox, Input, Select } from "@ledgerly/ui/input";
import { ActionMenu } from "@ledgerly/ui/menu";
import { Modal } from "@ledgerly/ui/modal";
import { EmptyState } from "@ledgerly/ui/states";
import { Switch } from "@ledgerly/ui/switch";
import { notify } from "@ledgerly/ui/toast";

/** A rule as the list draws it: what the service answers, plus its category's path. */
interface RuleView {
  id: string;
  name: string;
  active: boolean;
  conditions: RuleCondition[];
  categoryId: string;
  labelIds: string[];
  note: string | null;
  count: number;
  categoryArchived: boolean;
  path: string;
}

/** What the editor opens with, from a movement or a category (§4.7, §5.4). */
export interface RuleDraft {
  name: string;
  conditions: RuleCondition[];
  categoryId: string | null;
}

interface Named {
  id: string;
  name: string;
}

/** One condition as the editor holds it: every value as typed. */
interface Line {
  key: number;
  field: RuleField;
  op: string;
  value: string;
  to: string;
  accountIds: string[];
}

interface Editing {
  id: string | null;
  name: string;
  lines: Line[];
  categoryId: string | null;
  labelIds: string[];
  note: string;
  active: boolean;
}

const OPS: Partial<Record<RuleField, readonly string[]>> = {
  text: TEXT_OPS,
  counterparty: COUNTERPARTY_OPS,
  amount: AMOUNT_OPS,
};
const DEBOUNCE_MS = 400;

let keys = 0;
const nextKey = () => (keys += 1);

function lineOf(condition: RuleCondition, format: NumberFormat): Line {
  const base = {
    key: nextKey(),
    field: condition.field,
    op: "",
    value: "",
    to: "",
    accountIds: [] as string[],
  };
  switch (condition.field) {
    case "text":
    case "counterparty":
      return { ...base, op: condition.op, value: condition.value };
    case "amount":
      return {
        ...base,
        op: condition.op,
        value: formatAmountInput(parseCents(condition.amount), format),
        to: condition.toAmount === undefined ? "" : formatAmountInput(parseCents(condition.toAmount), format),
      };
    case "direction":
    case "source":
    case "currency":
      return { ...base, value: condition.value };
    case "account":
      return { ...base, accountIds: condition.accountIds };
    case "ownAccount":
      return base;
  }
}

function blankLine(field: RuleField, currency: string): Line {
  return {
    key: nextKey(),
    field,
    op: OPS[field]?.[0] ?? "",
    value: field === "direction" ? "out" : field === "source" ? "bank" : field === "currency" ? currency : "",
    to: "",
    accountIds: [],
  };
}

/** The rule the editor holds, as the server reads it; `null` while a value is missing. */
function inputOf(editing: Editing, format: NumberFormat): RuleInput | null {
  if (editing.name.trim() === "" || editing.categoryId === null || editing.lines.length === 0) return null;
  const conditions: RuleInput["conditions"] = [];
  for (const line of editing.lines) {
    switch (line.field) {
      case "text":
      case "counterparty":
        if (line.value.trim() === "") return null;
        conditions.push({
          field: line.field,
          op: line.op,
          value: line.value.trim(),
        } as RuleInput["conditions"][number]);
        break;
      case "amount": {
        const from = ruleAmount(line.value, format);
        const to = line.op === "between" ? ruleAmount(line.to, format) : undefined;
        if (from === null || to === null || (to !== undefined && parseCents(to) < parseCents(from)))
          return null;
        conditions.push({
          field: "amount",
          op: line.op as (typeof AMOUNT_OPS)[number],
          amount: from,
          ...(to === undefined ? {} : { toAmount: to }),
        });
        break;
      }
      case "account":
        if (line.accountIds.length === 0) return null;
        conditions.push({ field: "account", accountIds: line.accountIds });
        break;
      case "ownAccount":
        conditions.push({ field: "ownAccount" });
        break;
      default:
        conditions.push({ field: line.field, value: line.value } as RuleInput["conditions"][number]);
    }
  }
  return {
    name: editing.name.trim(),
    active: editing.active,
    conditions,
    categoryId: editing.categoryId,
    labelIds: editing.labelIds,
    note: editing.note.trim() || null,
  };
}

function editingOf(draft: RuleDraft | null, format: NumberFormat): Editing | null {
  if (draft === null) return null;
  return {
    id: null,
    name: draft.name,
    lines: draft.conditions.map((condition) => lineOf(condition, format)),
    categoryId: draft.categoryId,
    labelIds: [],
    note: "",
    active: true,
  };
}

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
    setEditing({
      id: null,
      name: "",
      lines: [blankLine("text", currencies[0] ?? "EUR")],
      categoryId: null,
      labelIds: [],
      note: "",
      active: true,
    });
  }

  function openEdit(rule: RuleView) {
    setEditing({
      id: rule.id,
      name: rule.name,
      lines: rule.conditions.map((condition) => lineOf(condition, numberFormat)),
      categoryId: rule.categoryArchived ? null : rule.categoryId,
      labelIds: rule.labelIds,
      note: rule.note ?? "",
      active: rule.active,
    });
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
            if (draft !== null) router.replace("/settings/rules" as Route);
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
            if (draft !== null) router.replace("/settings/rules" as Route);
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

type Translate = ReturnType<typeof useTranslations<"settings.rules">>;

/** One condition in a line of words, for the row of the list (§4.2). */
function summaryOf(condition: RuleCondition, t: Translate, accounts: Named[], format: NumberFormat): string {
  const field = t(`field.${condition.field}`);
  switch (condition.field) {
    case "text":
    case "counterparty":
      return `${field} ${t(`op.${condition.op}`)} «${condition.value}»`;
    case "ownAccount":
      return field;
    case "amount": {
      const from = formatAmountInput(parseCents(condition.amount), format);
      return condition.op === "between"
        ? `${field} ${t("op.between")} ${from} – ${formatAmountInput(parseCents(condition.toAmount ?? condition.amount), format)}`
        : `${field} ${t(`op.${condition.op}`)} ${from}`;
    }
    case "direction":
      return `${field} ${t("op.is")} ${t(`direction.${condition.value}`)}`;
    case "source":
      return `${field} ${t("op.is")} ${t(`source.${condition.value}`)}`;
    case "currency":
      return `${field} ${t("op.is")} ${condition.value}`;
    case "account":
      return `${field}: ${condition.accountIds.map((id) => accounts.find((one) => one.id === id)?.name ?? "—").join(", ")}`;
  }
}

function RuleEditor({
  editing,
  setEditing,
  categories,
  labels,
  accounts,
  currencies,
  numberFormat,
  onClose,
  onSaved,
}: {
  editing: Editing;
  setEditing: (next: Editing) => void;
  categories: CategoryOption[];
  labels: Named[];
  accounts: Named[];
  currencies: string[];
  numberFormat: NumberFormat;
  onClose: () => void;
  onSaved: (id: string, changes: number, name: string) => void;
}) {
  const t = useTranslations("settings.rules");
  const id = useId();
  const [pickerOpen, setPickerOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // The answer and the rule it is for: an answer for another rule is "Calculating…".
  const [answer, setAnswer] = useState<{ for: string; value: PreviewView | "error" } | null>(null);
  const [seeAll, setSeeAll] = useState(false);
  const input = inputOf(editing, numberFormat);
  const serial = input === null ? null : JSON.stringify(input);
  const preview = serial === null ? null : answer?.for === serial ? answer.value : "busy";

  // The live preview (§4.6): only for a valid rule, at most every 400 ms.
  useEffect(() => {
    if (serial === null) return;
    let live = true;
    const timer = setTimeout(() => {
      previewRuleAction(JSON.parse(serial), editing.id)
        .then((value) => live && setAnswer({ for: serial, value: value ?? "error" }))
        .catch(() => live && setAnswer({ for: serial, value: "error" }));
    }, DEBOUNCE_MS);
    return () => {
      live = false;
      clearTimeout(timer);
    };
  }, [serial, editing.id]);

  const set = (patch: Partial<Editing>) => setEditing({ ...editing, ...patch });
  const setLine = (key: number, patch: Partial<Line>) =>
    set({ lines: editing.lines.map((line) => (line.key === key ? { ...line, ...patch } : line)) });
  const used = (field: RuleField) => editing.lines.filter((line) => line.field === field).length;
  const free = (field: RuleField, own?: RuleField) =>
    field === own || used(field) < (field === "text" ? MAX_TEXT_CONDITIONS : 1);
  const category = categories.find((one) => one.id === editing.categoryId) ?? null;

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (input === null || saving) return;
    setSaving(true);
    setError(null);
    saveRuleAction(editing.id, input)
      .then((result) => {
        if (result.ok) onSaved(result.id, result.changes, input.name);
        else setError(result.error === "limit" ? t("limit") : t("error"));
      })
      .catch(() => setError(t("error")))
      .finally(() => setSaving(false));
  }

  return (
    <Modal
      open
      width={520}
      onOpenChange={(open) => !open && !saving && onClose()}
      title={editing.id === null ? t("new") : t("edit")}
      footer={
        <>
          <Button size="sm" onClick={onClose} disabled={saving}>
            {t("cancel")}
          </Button>
          <Button
            size="sm"
            variant="primary"
            type="submit"
            form={`${id}-form`}
            disabled={input === null || saving}
            aria-busy={saving || undefined}
          >
            {saving ? t("saving") : t("save")}
          </Button>
        </>
      }
    >
      <form id={`${id}-form`} onSubmit={submit} className="flex flex-col gap-4" data-testid="rule-editor">
        {error && (
          <p role="alert" className="text-sm text-neg">
            {error}
          </p>
        )}
        <div className="flex flex-col gap-1.5">
          <label htmlFor={`${id}-name`} className="text-sm font-medium">
            {t("name")}
          </label>
          <Input
            id={`${id}-name`}
            value={editing.name}
            maxLength={80}
            onChange={(event) => set({ name: event.target.value })}
            autoFocus
          />
        </div>

        <fieldset className="flex flex-col gap-2">
          <legend className="mb-1.5 text-sm font-medium">{t("if")}</legend>
          {editing.lines.map((line, index) => {
            const n = index + 1;
            const ops = OPS[line.field];
            return (
              <div
                key={line.key}
                className="flex items-start gap-2 max-sm:flex-col max-sm:items-stretch"
                data-testid="rule-condition"
              >
                <Select
                  aria-label={t("conditionField", { n })}
                  value={line.field}
                  className="w-40 shrink-0 max-sm:w-full"
                  onChange={(event) => {
                    const field = event.target.value as RuleField;
                    setLine(line.key, { ...blankLine(field, currencies[0] ?? "EUR"), key: line.key });
                  }}
                >
                  {RULE_FIELDS.filter((field) => free(field, line.field)).map((field) => (
                    <option key={field} value={field}>
                      {t(`field.${field}`)}
                    </option>
                  ))}
                </Select>
                {ops !== undefined ? (
                  <Select
                    aria-label={t("operator")}
                    value={line.op}
                    className="w-36 shrink-0 max-sm:w-full"
                    onChange={(event) => setLine(line.key, { op: event.target.value })}
                  >
                    {ops.map((op) => (
                      <option key={op} value={op}>
                        {t(`op.${op as "contains"}`)}
                      </option>
                    ))}
                  </Select>
                ) : (
                  <span className="inline-flex h-8 w-36 shrink-0 items-center text-sm text-muted max-sm:hidden">
                    {line.field === "account" ? t("op.oneOf") : line.field === "ownAccount" ? "" : t("op.is")}
                  </span>
                )}
                <div className="flex min-w-0 flex-1 flex-col gap-1">
                  <ValueCell
                    line={line}
                    accounts={accounts}
                    currencies={currencies}
                    onChange={(patch) => setLine(line.key, patch)}
                  />
                </div>
                <Button
                  size="xs"
                  variant="ghost"
                  type="button"
                  aria-label={t("removeCondition", { n })}
                  title={t("removeCondition", { n })}
                  disabled={editing.lines.length === 1}
                  onClick={() => set({ lines: editing.lines.filter((one) => one.key !== line.key) })}
                  className="max-sm:self-end"
                >
                  ✕
                </Button>
              </div>
            );
          })}
          {editing.lines.length < MAX_CONDITIONS && (
            <Button
              size="xs"
              variant="ghost"
              type="button"
              className="self-start"
              onClick={() => {
                const field = RULE_FIELDS.find((one) => free(one));
                if (field) set({ lines: [...editing.lines, blankLine(field, currencies[0] ?? "EUR")] });
              }}
            >
              ＋ {t("addCondition")}
            </Button>
          )}
        </fieldset>

        <fieldset className="flex flex-col gap-3">
          <legend className="mb-1.5 text-sm font-medium">{t("then")}</legend>
          <div className="flex flex-col gap-1.5">
            <span id={`${id}-category`} className="text-sm">
              {t("action.category")}
            </span>
            <CategoryPicker
              categories={categories}
              currentId={editing.categoryId}
              open={pickerOpen}
              onOpenChange={setPickerOpen}
              onPick={(categoryId) => set({ categoryId })}
              searchLabel={t("searchCategory")}
              noMatchLabel={t("noCategoryMatch")}
              triggerLabel={`${t("action.category")}: ${category?.name ?? t("chooseCategory")}`}
              triggerClassName="focus-ring flex h-8 w-full items-center gap-2 rounded-control border border-border bg-card px-2 text-left"
            >
              {category ? (
                <>
                  <span
                    aria-hidden
                    className="size-2 shrink-0 rounded-xs"
                    style={{ background: category.color }}
                  />
                  <span className="min-w-0 truncate">
                    {category.section ? `${category.section} › ` : ""}
                    {category.name}
                  </span>
                </>
              ) : (
                <span className="text-muted">{t("chooseCategory")}</span>
              )}
            </CategoryPicker>
          </div>
          {labels.length > 0 && (
            <div role="group" aria-label={t("action.labels")} className="flex flex-col gap-1">
              <span className="text-sm">{t("action.labels")}</span>
              <div className="flex max-h-28 flex-wrap gap-x-4 overflow-y-auto">
                {labels.map((label) => (
                  <Checkbox
                    key={label.id}
                    label={label.name}
                    checked={editing.labelIds.includes(label.id)}
                    onChange={(event) =>
                      set({
                        labelIds: event.target.checked
                          ? [...editing.labelIds, label.id]
                          : editing.labelIds.filter((one) => one !== label.id),
                      })
                    }
                  />
                ))}
              </div>
            </div>
          )}
          <div className="flex flex-col gap-1.5">
            <label htmlFor={`${id}-note`} className="text-sm">
              {t("action.note")}
            </label>
            <Input
              id={`${id}-note`}
              value={editing.note}
              maxLength={NOTE_MAX}
              aria-describedby={`${id}-note-hint`}
              onChange={(event) => set({ note: event.target.value })}
            />
            <p id={`${id}-note-hint`} className="text-sm text-muted">
              {t("noteHint")}
            </p>
          </div>
        </fieldset>

        <div
          aria-live="polite"
          aria-busy={preview === "busy" || undefined}
          className="text-sm"
          data-testid="rule-preview"
        >
          {input === null ? (
            <p className="text-muted">{t("preview.invalid")}</p>
          ) : preview === "busy" || preview === null ? (
            <p className="text-muted">{t("preview.busy")}</p>
          ) : preview === "error" ? (
            <p className="text-muted">{t("preview.error")}</p>
          ) : (
            <div className="flex flex-col gap-1">
              <p>
                {t("preview.match", { count: preview.matched })}{" "}
                {preview.kept > 0 && t("preview.kept", { count: preview.kept })}
              </p>
              {preview.rows.length > 0 && (
                <>
                  <Button
                    size="xs"
                    variant="ghost"
                    type="button"
                    className="self-start"
                    aria-expanded={seeAll}
                    onClick={() => setSeeAll(!seeAll)}
                  >
                    {seeAll ? t("preview.hide") : t("preview.see")}
                  </Button>
                  {seeAll && <MovementList rows={preview.rows} />}
                </>
              )}
            </div>
          )}
        </div>
      </form>
    </Modal>
  );
}

function ValueCell({
  line,
  accounts,
  currencies,
  onChange,
}: {
  line: Line;
  accounts: Named[];
  currencies: string[];
  onChange: (patch: Partial<Line>) => void;
}) {
  const t = useTranslations("settings.rules");
  switch (line.field) {
    case "text":
    case "counterparty":
      return (
        <Input
          aria-label={t("value")}
          value={line.value}
          maxLength={100}
          onChange={(e) => onChange({ value: e.target.value })}
        />
      );
    case "amount":
      return (
        <>
          <Input
            aria-label={t("value")}
            inputMode="decimal"
            numeric
            value={line.value}
            onChange={(e) => onChange({ value: e.target.value })}
          />
          {line.op === "between" && (
            <Input
              aria-label={t("valueTo")}
              inputMode="decimal"
              numeric
              value={line.to}
              onChange={(e) => onChange({ to: e.target.value })}
            />
          )}
        </>
      );
    case "direction":
      return (
        <Select
          aria-label={t("value")}
          value={line.value}
          onChange={(e) => onChange({ value: e.target.value })}
        >
          {DIRECTIONS.map((one) => (
            <option key={one} value={one}>
              {t(`direction.${one}`)}
            </option>
          ))}
        </Select>
      );
    case "source":
      return (
        <Select
          aria-label={t("value")}
          value={line.value}
          onChange={(e) => onChange({ value: e.target.value })}
        >
          {RULE_SOURCES.map((one) => (
            <option key={one} value={one}>
              {t(`source.${one}`)}
            </option>
          ))}
        </Select>
      );
    case "currency":
      return (
        <Select
          aria-label={t("value")}
          value={line.value}
          onChange={(e) => onChange({ value: e.target.value })}
        >
          {currencies.map((one) => (
            <option key={one} value={one}>
              {one}
            </option>
          ))}
        </Select>
      );
    case "account":
      return (
        <div
          role="group"
          aria-label={t("value")}
          className="flex max-h-28 flex-col overflow-y-auto rounded-control border border-border px-2 py-1"
        >
          {accounts.map((account) => (
            <Checkbox
              key={account.id}
              label={account.name}
              checked={line.accountIds.includes(account.id)}
              onChange={(e) =>
                onChange({
                  accountIds: e.target.checked
                    ? [...line.accountIds, account.id]
                    : line.accountIds.filter((one) => one !== account.id),
                })
              }
            />
          ))}
        </div>
      );
    case "ownAccount":
      return <span className="inline-flex h-8 items-center text-sm text-muted">{t("ownAccountYes")}</span>;
  }
}

function MovementList({ rows }: { rows: PreviewView["rows"] }) {
  return (
    <ul className="flex max-h-48 flex-col overflow-y-auto text-sm">
      {rows.map((row) => (
        <li key={row.id} className="flex items-center gap-3 border-b border-border py-1 last:border-0">
          <span className="w-24 shrink-0 text-muted">{row.date}</span>
          <span className="min-w-0 flex-1 truncate">{row.payee}</span>
          <span className="shrink-0 tabular-nums">{row.amount}</span>
        </li>
      ))}
    </ul>
  );
}

/** "Apply to existing transactions…" (§4.6): what changes, then all or nothing, with "Undo". */
function ApplyDialog({
  rule,
  categoryName,
  onClose,
  onApplied,
}: {
  rule: Pick<RuleView, "id" | "name">;
  categoryName: (id: string | null) => string;
  onClose: () => void;
  onApplied: (result: { count: number; undoId: string | null }) => void;
}) {
  const t = useTranslations("settings.rules");
  const [preview, setPreview] = useState<PreviewView | null | "error">(null);
  const [shown, setShown] = useState(false);
  const [saving, setSaving] = useState(false);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let live = true;
    previewSavedRuleAction(rule.id)
      .then((answer) => live && setPreview(answer ?? "error"))
      .catch(() => live && setPreview("error"));
    return () => {
      live = false;
    };
  }, [rule.id]);

  function apply() {
    if (saving) return;
    setSaving(true);
    setFailed(false);
    applyRuleAction(rule.id)
      .then((result) => (result.ok ? onApplied(result) : setFailed(true)))
      .catch(() => setFailed(true))
      .finally(() => setSaving(false));
  }

  const ready = preview !== null && preview !== "error";
  return (
    <Modal
      open
      width={460}
      onOpenChange={(open) => !open && !saving && onClose()}
      title={t("apply.title", { name: rule.name })}
      footer={
        <>
          <Button size="sm" onClick={onClose} disabled={saving}>
            {t("cancel")}
          </Button>
          <Button
            size="sm"
            variant="primary"
            onClick={apply}
            disabled={!ready || preview.changes === 0 || saving}
            aria-busy={saving || undefined}
          >
            {t("apply.confirm")}
          </Button>
        </>
      }
    >
      <div
        className="flex flex-col gap-2"
        data-testid="rule-apply"
        aria-live="polite"
        aria-busy={preview === null || undefined}
      >
        {failed && (
          <p role="alert" className="text-sm text-neg">
            {t("apply.failed")}
          </p>
        )}
        {preview === null ? (
          <p className="text-muted">{t("preview.busy")}</p>
        ) : preview === "error" ? (
          <p className="text-muted">{t("preview.error")}</p>
        ) : preview.changes === 0 ? (
          <p>{t("apply.nothing")}</p>
        ) : (
          <>
            <p>
              {t("apply.body", {
                count: preview.changes,
                category: categoryName(preview.categoryId ?? null),
              })}
            </p>
            {preview.retyped && (
              <p>
                {preview.retyped.from === null
                  ? t("apply.effectJoin", {
                      count: preview.retyped.count,
                      amount: preview.retyped.amount,
                      year: preview.retyped.year,
                    })
                  : t("apply.effect", {
                      count: preview.retyped.count,
                      from: t(preview.retyped.from === "expense" ? "fromExpense" : "fromIncome"),
                      amount: preview.retyped.amount,
                      year: preview.retyped.year,
                    })}
              </p>
            )}
          </>
        )}
        {ready && preview.kept > 0 && (
          <p className="text-muted">{t("apply.kept", { count: preview.kept })}</p>
        )}
        {ready && preview.rows.length > 0 && (
          <>
            <Button
              size="xs"
              variant="ghost"
              className="self-start"
              aria-expanded={shown}
              onClick={() => setShown(!shown)}
            >
              {shown ? t("apply.hide") : t("apply.show", { count: preview.changes })}
            </Button>
            {shown && <MovementList rows={preview.rows} />}
          </>
        )}
      </div>
    </Modal>
  );
}
