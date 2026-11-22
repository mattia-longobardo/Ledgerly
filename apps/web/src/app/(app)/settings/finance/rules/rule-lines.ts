// What the rules screen holds between the list and the editor (categories-and-rules.md §4): a rule
// as the list draws it, a condition as the editor holds it (every value as typed), and the two ways
// between them. Pure: the screen's components call these.
import type { useTranslations } from "next-intl";
import {
  AMOUNT_OPS,
  COUNTERPARTY_OPS,
  DIRECTIONS,
  RULE_SOURCES,
  type RuleField,
  TEXT_OPS,
} from "@ledgerly/domain/transactions/client";
import { parseCents } from "@ledgerly/format/cents";
import { formatAmountInput, type NumberFormat } from "@ledgerly/format/format";
import { type RuleCondition, type RuleInput, ruleAmount } from "@/modules/transactions";

/** A rule as the list draws it: what the service answers, plus its category's path. */
export interface RuleView {
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

export interface Named {
  id: string;
  name: string;
}

/** One condition as the editor holds it: every value as typed. */
export interface Line {
  key: number;
  field: RuleField;
  op: string;
  value: string;
  to: string;
  accountIds: string[];
}

export interface Editing {
  id: string | null;
  name: string;
  lines: Line[];
  categoryId: string | null;
  labelIds: string[];
  note: string;
  active: boolean;
}

type Translate = ReturnType<typeof useTranslations<"settings.rules">>;
type ConditionInput = RuleInput["conditions"][number];

type RuleOp = (typeof TEXT_OPS)[number] | (typeof COUNTERPARTY_OPS)[number] | (typeof AMOUNT_OPS)[number];

export const OPS: Partial<Record<RuleField, readonly RuleOp[]>> = {
  text: TEXT_OPS,
  counterparty: COUNTERPARTY_OPS,
  amount: AMOUNT_OPS,
};

let keys = 0;
const nextKey = () => (keys += 1);

function isOneOf<T extends string>(list: readonly T[], value: string): value is T {
  return list.some((item) => item === value);
}

function lineOf(condition: RuleCondition, format: NumberFormat): Line {
  const base: Line = { key: nextKey(), field: condition.field, op: "", value: "", to: "", accountIds: [] };
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

const FIRST_VALUE: Partial<Record<RuleField, string>> = { direction: "out", source: "bank" };

/** A new condition on `field`, with its first operator and value. */
export function blankLine(field: RuleField, currency: string): Line {
  return {
    key: nextKey(),
    field,
    op: OPS[field]?.[0] ?? "",
    value: field === "currency" ? currency : (FIRST_VALUE[field] ?? ""),
    to: "",
    accountIds: [],
  };
}

function textCondition(line: Line): ConditionInput | null {
  const value = line.value.trim();
  if (value === "") return null;
  if (line.field === "text" && isOneOf(TEXT_OPS, line.op)) return { field: "text", op: line.op, value };
  if (line.field === "counterparty" && isOneOf(COUNTERPARTY_OPS, line.op))
    return { field: "counterparty", op: line.op, value };
  return null;
}

function amountCondition(line: Line, format: NumberFormat): ConditionInput | null {
  const from = ruleAmount(line.value, format);
  const to = line.op === "between" ? ruleAmount(line.to, format) : undefined;
  if (from === null || to === null || !isOneOf(AMOUNT_OPS, line.op)) return null;
  if (to !== undefined && parseCents(to) < parseCents(from)) return null;
  return { field: "amount", op: line.op, amount: from, ...(to === undefined ? {} : { toAmount: to }) };
}

function valueCondition(line: Line): ConditionInput | null {
  if (line.field === "direction")
    return isOneOf(DIRECTIONS, line.value) ? { field: "direction", value: line.value } : null;
  if (line.field === "source")
    return isOneOf(RULE_SOURCES, line.value) ? { field: "source", value: line.value } : null;
  return { field: "currency", value: line.value };
}

function conditionOf(line: Line, format: NumberFormat): ConditionInput | null {
  switch (line.field) {
    case "text":
    case "counterparty":
      return textCondition(line);
    case "amount":
      return amountCondition(line, format);
    case "account":
      return line.accountIds.length === 0 ? null : { field: "account", accountIds: line.accountIds };
    case "ownAccount":
      return { field: "ownAccount" };
    default:
      return valueCondition(line);
  }
}

/** The rule the editor holds, as the server reads it; `null` while a value is missing. */
export function inputOf(editing: Editing, format: NumberFormat): RuleInput | null {
  if (editing.name.trim() === "" || editing.categoryId === null || editing.lines.length === 0) return null;
  const read = editing.lines.map((line) => conditionOf(line, format));
  const conditions = read.filter((condition) => condition !== null);
  if (conditions.length !== read.length) return null;
  return {
    name: editing.name.trim(),
    active: editing.active,
    conditions,
    categoryId: editing.categoryId,
    labelIds: editing.labelIds,
    note: editing.note.trim() || null,
  };
}

/** A new rule, blank or from a draft, as the editor opens it. */
export function newEditing(lines: Line[], draft?: RuleDraft): Editing {
  return {
    id: null,
    name: draft?.name ?? "",
    lines,
    categoryId: draft?.categoryId ?? null,
    labelIds: [],
    note: "",
    active: true,
  };
}

export function editingOf(draft: RuleDraft | null, format: NumberFormat): Editing | null {
  if (draft === null) return null;
  return newEditing(
    draft.conditions.map((condition) => lineOf(condition, format)),
    draft,
  );
}

/** A saved rule, as the editor opens it to change it; an archived category is chosen again. */
export function editingOfRule(rule: RuleView, format: NumberFormat): Editing {
  return {
    id: rule.id,
    name: rule.name,
    lines: rule.conditions.map((condition) => lineOf(condition, format)),
    categoryId: rule.categoryArchived ? null : rule.categoryId,
    labelIds: rule.labelIds,
    note: rule.note ?? "",
    active: rule.active,
  };
}

function amountSummary(
  field: string,
  condition: Extract<RuleCondition, { field: "amount" }>,
  text: Translate,
  format: NumberFormat,
) {
  const from = formatAmountInput(parseCents(condition.amount), format);
  if (condition.op !== "between") return `${field} ${text(`op.${condition.op}`)} ${from}`;
  const to = formatAmountInput(parseCents(condition.toAmount ?? condition.amount), format);
  return `${field} ${text("op.between")} ${from} – ${to}`;
}

/** One condition in a line of words, for the row of the list (§4.2). */
export function summaryOf(
  condition: RuleCondition,
  text: Translate,
  accounts: Named[],
  format: NumberFormat,
): string {
  const field = text(`field.${condition.field}`);
  switch (condition.field) {
    case "text":
    case "counterparty":
      return `${field} ${text(`op.${condition.op}`)} «${condition.value}»`;
    case "ownAccount":
      return field;
    case "amount":
      return amountSummary(field, condition, text, format);
    case "direction":
      return `${field} ${text("op.is")} ${text(`direction.${condition.value}`)}`;
    case "source":
      return `${field} ${text("op.is")} ${text(`source.${condition.value}`)}`;
    case "currency":
      return `${field} ${text("op.is")} ${condition.value}`;
    case "account": {
      const names = condition.accountIds.map((id) => accounts.find((one) => one.id === id)?.name ?? "—");
      return `${field}: ${names.join(", ")}`;
    }
  }
}
