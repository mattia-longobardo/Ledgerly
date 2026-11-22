"use client";

import { useTranslations } from "next-intl";
import {
  MAX_CONDITIONS,
  MAX_TEXT_CONDITIONS,
  RULE_FIELDS,
  type RuleField,
} from "@ledgerly/domain/transactions/client";
import { Button } from "@ledgerly/ui/button";
import { Select } from "@ledgerly/ui/input";
import { blankLine, type Editing, type Line, type Named, OPS } from "./rule-lines";
import { ValueCell } from "./value-cell";

export type Patch = (patch: Partial<Editing>) => void;

function ConditionRow({
  line,
  index,
  editing,
  set,
  options,
}: {
  line: Line;
  index: number;
  editing: Editing;
  set: Patch;
  options: { accounts: Named[]; currencies: string[]; fields: (own: RuleField) => RuleField[] };
}) {
  const text = useTranslations("settings.rules");
  const place = index + 1;
  const setLine = (patch: Partial<Line>) =>
    set({ lines: editing.lines.map((one) => (one.key === line.key ? { ...one, ...patch } : one)) });
  const pickField = (value: string) => {
    const field = RULE_FIELDS.find((one) => one === value);
    if (field) setLine({ ...blankLine(field, options.currencies[0] ?? "EUR"), key: line.key });
  };
  return (
    <div className="flex items-start gap-2 max-sm:flex-col max-sm:items-stretch" data-testid="rule-condition">
      <Select
        aria-label={text("conditionField", { n: place })}
        value={line.field}
        className="w-40 shrink-0 max-sm:w-full"
        onChange={(event) => pickField(event.target.value)}
      >
        {options.fields(line.field).map((field) => (
          <option key={field} value={field}>
            {text(`field.${field}`)}
          </option>
        ))}
      </Select>
      <OperatorCell line={line} onChange={(operator) => setLine({ op: operator })} />
      <div className="flex min-w-0 flex-1 flex-col gap-1">
        <ValueCell
          line={line}
          accounts={options.accounts}
          currencies={options.currencies}
          onChange={setLine}
        />
      </div>
      <Button
        size="xs"
        variant="ghost"
        type="button"
        aria-label={text("removeCondition", { n: place })}
        title={text("removeCondition", { n: place })}
        disabled={editing.lines.length === 1}
        onClick={() => set({ lines: editing.lines.filter((one) => one.key !== line.key) })}
        className="max-sm:self-end"
      >
        ✕
      </Button>
    </div>
  );
}

function OperatorCell({ line, onChange }: { line: Line; onChange: (op: string) => void }) {
  const text = useTranslations("settings.rules");
  const ops = OPS[line.field];
  if (ops === undefined) {
    const word =
      line.field === "account" ? text("op.oneOf") : line.field === "ownAccount" ? "" : text("op.is");
    return (
      <span className="inline-flex h-8 w-36 shrink-0 items-center text-sm text-muted max-sm:hidden">
        {word}
      </span>
    );
  }
  return (
    <Select
      aria-label={text("operator")}
      value={line.op}
      className="w-36 shrink-0 max-sm:w-full"
      onChange={(event) => onChange(event.target.value)}
    >
      {ops.map((operator) => (
        <option key={operator} value={operator}>
          {text(`op.${operator}`)}
        </option>
      ))}
    </Select>
  );
}

/** «If»: the conditions, at most one per field but text, and «Add condition». */
export function ConditionsField({
  editing,
  set,
  accounts,
  currencies,
}: {
  editing: Editing;
  set: Patch;
  accounts: Named[];
  currencies: string[];
}) {
  const text = useTranslations("settings.rules");
  const used = (field: RuleField) => editing.lines.filter((line) => line.field === field).length;
  const free = (field: RuleField, own?: RuleField) =>
    field === own || used(field) < (field === "text" ? MAX_TEXT_CONDITIONS : 1);
  const options = {
    accounts,
    currencies,
    fields: (own: RuleField) => RULE_FIELDS.filter((one) => free(one, own)),
  };
  const add = () => {
    const field = RULE_FIELDS.find((one) => free(one));
    if (field) set({ lines: [...editing.lines, blankLine(field, currencies[0] ?? "EUR")] });
  };
  return (
    <fieldset className="flex flex-col gap-2">
      <legend className="mb-1.5 text-sm font-medium">{text("if")}</legend>
      {editing.lines.map((line, index) => (
        <ConditionRow
          key={line.key}
          line={line}
          index={index}
          editing={editing}
          set={set}
          options={options}
        />
      ))}
      {editing.lines.length < MAX_CONDITIONS && (
        <Button size="xs" variant="ghost" type="button" className="self-start" onClick={add}>
          ＋ {text("addCondition")}
        </Button>
      )}
    </fieldset>
  );
}
