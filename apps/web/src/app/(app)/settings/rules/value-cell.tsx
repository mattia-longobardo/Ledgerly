"use client";

import { useTranslations } from "next-intl";
import { DIRECTIONS, RULE_SOURCES } from "@ledgerly/domain/transactions/client";
import { Checkbox, Input, Select } from "@ledgerly/ui/input";
import type { Line, Named } from "./rule-lines";

type Change = (patch: Partial<Line>) => void;

/** A select of fixed values: the direction, the source or the currency of a condition. */
function ChoiceValue({
  line,
  options,
  onChange,
}: {
  line: Line;
  options: readonly { value: string; label: string }[];
  onChange: Change;
}) {
  const text = useTranslations("settings.rules");
  return (
    <Select
      aria-label={text("value")}
      value={line.value}
      onChange={(event) => onChange({ value: event.target.value })}
    >
      {options.map((one) => (
        <option key={one.value} value={one.value}>
          {one.label}
        </option>
      ))}
    </Select>
  );
}

function AmountValue({ line, onChange }: { line: Line; onChange: Change }) {
  const text = useTranslations("settings.rules");
  return (
    <>
      <Input
        aria-label={text("value")}
        inputMode="decimal"
        numeric
        value={line.value}
        onChange={(event) => onChange({ value: event.target.value })}
      />
      {line.op === "between" && (
        <Input
          aria-label={text("valueTo")}
          inputMode="decimal"
          numeric
          value={line.to}
          onChange={(event) => onChange({ to: event.target.value })}
        />
      )}
    </>
  );
}

function AccountsValue({ line, accounts, onChange }: { line: Line; accounts: Named[]; onChange: Change }) {
  const text = useTranslations("settings.rules");
  return (
    <div
      role="group"
      aria-label={text("value")}
      className="flex max-h-28 flex-col overflow-y-auto rounded-control border border-border px-2 py-1"
    >
      {accounts.map((account) => (
        <Checkbox
          key={account.id}
          label={account.name}
          checked={line.accountIds.includes(account.id)}
          onChange={(event) =>
            onChange({
              accountIds: event.target.checked
                ? [...line.accountIds, account.id]
                : line.accountIds.filter((one) => one !== account.id),
            })
          }
        />
      ))}
    </div>
  );
}

/** The value of one condition, as its field asks for it. */
export function ValueCell({
  line,
  accounts,
  currencies,
  onChange,
}: {
  line: Line;
  accounts: Named[];
  currencies: string[];
  onChange: Change;
}) {
  const text = useTranslations("settings.rules");
  switch (line.field) {
    case "text":
    case "counterparty":
      return (
        <Input
          aria-label={text("value")}
          value={line.value}
          maxLength={100}
          onChange={(event) => onChange({ value: event.target.value })}
        />
      );
    case "amount":
      return <AmountValue line={line} onChange={onChange} />;
    case "direction":
      return (
        <ChoiceValue
          line={line}
          options={DIRECTIONS.map((value) => ({ value, label: text(`direction.${value}`) }))}
          onChange={onChange}
        />
      );
    case "source":
      return (
        <ChoiceValue
          line={line}
          options={RULE_SOURCES.map((value) => ({ value, label: text(`source.${value}`) }))}
          onChange={onChange}
        />
      );
    case "currency":
      return (
        <ChoiceValue
          line={line}
          options={currencies.map((value) => ({ value, label: value }))}
          onChange={onChange}
        />
      );
    case "account":
      return <AccountsValue line={line} accounts={accounts} onChange={onChange} />;
    case "ownAccount":
      return <span className="inline-flex h-8 items-center text-sm text-muted">{text("ownAccountYes")}</span>;
  }
}
