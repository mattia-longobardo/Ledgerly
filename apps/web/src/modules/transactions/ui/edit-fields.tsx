"use client";

import { useTranslations } from "next-intl";
import { useId, useState } from "react";
import { AccountSelect } from "@ledgerly/ui/account-select";
import { CategoryPicker } from "@ledgerly/ui/category-picker";
import { cn } from "@ledgerly/ui/cn";
import { Field } from "@ledgerly/ui/field";
import { Checkbox, Input, Textarea } from "@ledgerly/ui/input";
import { Segmented } from "@ledgerly/ui/segmented";
import { CHIP, useLikely } from "./category-cell";
import { allows, type EditKind, isOut, OUTSIDE } from "./edit-plan";
import { useTransferRoute } from "./transfer-cell";
import { type CategoryOption, dateTimeOf, type LabelOption, type RowView } from "./view";

const KINDS: readonly EditKind[] = ["expense", "income", "transfer"];

/** Spending, income or giroconto, with the reason when the sign rules one out. */
export function TypeField({
  row,
  kind,
  onChange,
  disabled,
}: {
  row: Parameters<typeof allows>[0];
  kind: EditKind;
  onChange: (kind: EditKind) => void;
  disabled: boolean;
}) {
  const text = useTranslations("expenses.edit");
  const blocked = KINDS.some((one) => !allows(row, one));
  return (
    <div className="flex flex-col gap-1.5">
      <span className="text-sm font-medium">{text("type")}</span>
      <Segmented
        label={text("type")}
        value={kind}
        onChange={onChange}
        options={KINDS.map((one) => ({
          value: one,
          label: text(`types.${one}`),
          disabled: disabled || !allows(row, one),
        }))}
      />
      {blocked && <p className="text-sm text-muted">{text(isOut(row) ? "outOnly" : "inOnly")}</p>}
    </div>
  );
}

/** The category of a spending or an income: the picker of the row, with the likeliest on top. */
export function CategoryField({
  rowId,
  categories,
  value,
  onChange,
  disabled,
}: {
  rowId: string;
  /** Already the ones of the type chosen. */
  categories: readonly CategoryOption[];
  value: string | null;
  onChange: (categoryId: string | null) => void;
  disabled: boolean;
}) {
  const text = useTranslations("expenses");
  const [open, setOpen] = useState(false);
  const likely = useLikely(open, rowId);
  const category = categories.find((option) => option.id === value) ?? null;
  return (
    <div className="flex flex-col gap-1.5">
      <span className="text-sm font-medium">{text("edit.category")}</span>
      <CategoryPicker
        categories={categories}
        currentId={value}
        likely={likely}
        open={open}
        onOpenChange={setOpen}
        onPick={(next) => {
          onChange(next);
          setOpen(false);
        }}
        uncategorisedLabel={text("row.uncategorised")}
        searchLabel={text("row.searchCategory")}
        noMatchLabel={text("row.noCategoryMatch")}
        triggerLabel={text("row.editCategory")}
        disabled={disabled}
        triggerClassName={cn(CHIP, "h-8 self-start border border-border px-2.5 hover:bg-hover")}
      >
        <span
          aria-hidden
          className={cn("size-[7px] shrink-0 rounded-xs", !category && "bg-faint")}
          style={category ? { background: category.color } : undefined}
        />
        <span className="min-w-0 truncate">{category?.name ?? text("row.uncategorised")}</span>
      </CategoryPicker>
    </div>
  );
}

/** The other side of a giroconto: one of the person's accounts, or an account outside Ledgerly. */
export function SideField({
  accountId,
  accounts,
  value,
  onChange,
  disabled,
}: {
  accountId: string | undefined;
  accounts: readonly { id: string; name: string }[];
  value: string;
  onChange: (side: string) => void;
  disabled: boolean;
}) {
  const text = useTranslations("expenses");
  const id = useId();
  return (
    <Field label={text("transfer.other")} htmlFor={id} hint={text("edit.transferHint")}>
      <AccountSelect
        id={id}
        accounts={accounts.filter((account) => account.id !== accountId)}
        none={text("transfer.choose")}
        value={value}
        disabled={disabled}
        onChange={(event) => onChange(event.target.value)}
      >
        <option value={OUTSIDE}>{text("transfer.outside")}</option>
      </AccountSelect>
    </Field>
  );
}

/** The provider's own fields, as context: read on this screen, never written (§7.2). */
export function BankFields({ row }: { row: RowView }) {
  const text = useTranslations("expenses");
  const routeOf = useTransferRoute();
  const context = [
    ...(row.atSource ? [] : [{ term: text("columns.payee"), value: row.payee ?? text("row.noPayee") }]),
    { term: text("columns.date"), value: dateTimeOf(row) },
    { term: text("columns.account"), value: row.account },
    ...(row.atSource ? [] : [{ term: text("columns.amount"), value: row.amount }]),
    ...(row.transfer && !row.atSource ? [{ term: text("transfer.title"), value: routeOf(row) }] : []),
  ];
  return (
    <dl data-testid="bank-fields" className="grid grid-cols-2 gap-2 rounded-ctl bg-hover px-3 py-2.5 text-sm">
      {context.map((entry) => (
        <div key={entry.term} className="flex min-w-0 flex-col">
          <dt className="text-muted">{entry.term}</dt>
          <dd className="truncate font-medium">{entry.value}</dd>
        </div>
      ))}
    </dl>
  );
}

/** Amount and payee of a movement edited at its source: saved there first. */
export function SourceFields({ row }: { row: RowView }) {
  const text = useTranslations("expenses");
  const id = useId();
  if (!row.atSource) return null;
  return (
    <>
      <p className="text-sm text-muted">{text("atSource.hint")}</p>
      <Field label={text("columns.amount")} htmlFor={`${id}-amount`} hint={text("atSource.amountHint")}>
        <Input
          id={`${id}-amount`}
          name="amount"
          defaultValue={row.atSource.amount}
          inputMode="decimal"
          autoComplete="off"
          required
          numeric
        />
      </Field>
      <Field label={text("columns.payee")} htmlFor={`${id}-payee`}>
        <Input
          id={`${id}-payee`}
          name="payee"
          defaultValue={row.payee ?? ""}
          maxLength={255}
          autoComplete="off"
        />
      </Field>
    </>
  );
}

/** The note and the labels: the person's own fields. */
export function NoteAndLabels({
  row,
  labels,
  chosen,
  onToggle,
  disabled,
}: {
  row: RowView;
  labels: readonly LabelOption[];
  chosen: readonly string[];
  onToggle: (id: string) => void;
  disabled: boolean;
}) {
  const text = useTranslations("expenses");
  const id = useId();
  return (
    <>
      <Field label={text("row.note")} htmlFor={id}>
        {/* A note is often a sentence or two, or a bank's whole remittance line: room to read it. */}
        <Textarea
          id={id}
          name="note"
          defaultValue={row.note ?? ""}
          rows={3}
          maxLength={row.atSource ? 255 : undefined}
        />
      </Field>
      <fieldset className="flex flex-col gap-1.5">
        <legend className="pb-1.5 text-sm font-medium">{text("row.labels")}</legend>
        {labels.length === 0 ? (
          <p className="text-sm text-muted">{text("row.noLabels")}</p>
        ) : (
          <div className="flex flex-wrap gap-x-4 gap-y-2">
            {labels.map((label) => (
              <span key={label.id} className="inline-flex items-center gap-1.5">
                <span
                  aria-hidden
                  className={cn("size-2 shrink-0 rounded-xs", label.color === null && "bg-faint")}
                  style={label.color === null ? undefined : { background: label.color }}
                />
                <Checkbox
                  label={label.name}
                  checked={chosen.includes(label.id)}
                  disabled={disabled}
                  onChange={() => onToggle(label.id)}
                />
              </span>
            ))}
          </div>
        )}
      </fieldset>
    </>
  );
}
