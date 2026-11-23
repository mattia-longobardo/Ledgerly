"use client";

// «Switch to positions» (R5d, D4): a service kept by value becomes a manual portfolio from a day. Its
// value of that day stays: the server opens the positions at their price, and the cash is the rest;
// positions worth more than the value are refused (`negative_cash`).
import { useTranslations } from "next-intl";
import { type FormEvent, type RefObject, useId, useState, useTransition } from "react";
import { Button } from "@ledgerly/ui/button";
import { FormDialog } from "@ledgerly/ui/form-dialog";
import { DateField, MoneyField, NumberField } from "@ledgerly/ui/form-fields";
import { useRouter } from "@ledgerly/ui/router";
import { notify } from "@ledgerly/ui/toast";
import { convertToPortfolio } from "../../calls";
import { FORM_GRID, NoteField, type ServiceContext, useInvestmentResult } from "../dialog-kit";
import { FxRateField, InstrumentField, type PickedInstrument } from "./instrument-field";

/** At most the contract's 100 positions in one switch. */
const MAX_POSITIONS = 100;

interface Row {
  key: number;
  instrument: PickedInstrument | null;
  quantity: string;
  unitPrice: string;
  fxRate: string;
}

const emptyRow = (key: number): Row => ({ key, instrument: null, quantity: "", unitPrice: "", fxRate: "" });

function PositionRow({
  id,
  index,
  row,
  context,
  onChange,
  onRemove,
}: {
  id: string;
  index: number;
  row: Row;
  context: ServiceContext;
  onChange: (row: Row) => void;
  onRemove: () => void;
}) {
  const text = useTranslations("investments");
  const currency = row.instrument?.currency ?? context.currency;
  const own = `${id}-${row.key}`;
  return (
    <fieldset
      data-testid="conversion-position"
      className={`${FORM_GRID} col-span-full rounded-md border border-border p-3`}
    >
      <legend className="px-1 text-sm font-medium">
        {text("convertForm.position", { number: index + 1 })}
      </legend>
      <InstrumentField id={own} onChange={(instrument) => onChange({ ...row, instrument })} />
      <NumberField
        id={`${own}-quantity`}
        label={text("holdingForm.quantity")}
        value={row.quantity}
        onChange={(quantity) => onChange({ ...row, quantity })}
      />
      <MoneyField
        id={`${own}-price`}
        label={text("holdingForm.unitPrice")}
        value={row.unitPrice}
        onChange={(unitPrice) => onChange({ ...row, unitPrice })}
        currency={currency}
      />
      <FxRateField
        id={`${own}-fx`}
        from={currency}
        to={context.currency}
        value={row.fxRate}
        onChange={(fxRate) => onChange({ ...row, fxRate })}
      />
      <div className="col-span-full">
        <Button size="sm" variant="ghost" onClick={onRemove}>
          {text("convertForm.remove", { number: index + 1 })}
        </Button>
      </div>
    </fieldset>
  );
}

/** The form's day, note and positions, and its write. */
function useConversion(context: ServiceContext, onClose: () => void) {
  const text = useTranslations("investments");
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const { error, report } = useInvestmentResult();
  const [day, setDay] = useState(context.today);
  const [note, setNote] = useState("");
  const [rows, setRows] = useState<Row[]>([emptyRow(0)]);
  const [next, setNext] = useState(1);
  function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    startTransition(async () => {
      const positions = rows.flatMap((row) =>
        row.instrument === null
          ? []
          : [{ ...row, instrumentId: row.instrument.instrumentId, mic: row.instrument.mic }],
      );
      // A position with no instrument picked: the form is not complete.
      if (positions.length < rows.length) {
        report({ ok: false, error: "invalid" });
        return;
      }
      if (!report(await convertToPortfolio(context.accountId, { on: day, positions, note }))) return;
      notify(text("toasts.converted", { name: context.name }));
      onClose();
      router.refresh();
    });
  }
  return {
    pending,
    error,
    onSubmit,
    day,
    setDay,
    note,
    setNote,
    rows,
    change: (changed: Row) => setRows(rows.map((one) => (one.key === changed.key ? changed : one))),
    remove: (key: number) => setRows(rows.filter((one) => one.key !== key)),
    add: () => {
      setRows([...rows, emptyRow(next)]);
      setNext(next + 1);
    },
  };
}

export function ConvertDialog({
  onClose,
  context,
  opener,
}: {
  onClose: () => void;
  context: ServiceContext;
  opener: RefObject<HTMLButtonElement | null>;
}) {
  const text = useTranslations("investments");
  const id = useId();
  const form = useConversion(context, onClose);
  return (
    <FormDialog
      onClose={onClose}
      title={text("convertForm.title", { name: context.name })}
      description={text("convertForm.description")}
      width={520}
      className={FORM_GRID}
      onSubmit={form.onSubmit}
      error={form.error}
      pending={form.pending}
      cancelLabel={text("form.cancel")}
      submitLabel={text("convertForm.submit")}
      finalFocus={opener}
    >
      <DateField
        id={`${id}-on`}
        label={text("form.date")}
        value={form.day}
        onChange={form.setDay}
        max={context.today}
      />
      {form.rows.map((row, index) => (
        <PositionRow
          key={row.key}
          id={id}
          index={index}
          row={row}
          context={context}
          onChange={form.change}
          onRemove={() => form.remove(row.key)}
        />
      ))}
      <div className="col-span-full">
        <Button size="sm" disabled={form.rows.length >= MAX_POSITIONS} onClick={form.add}>
          {text("convertForm.add")}
        </Button>
      </div>
      <NoteField id={`${id}-note`} value={form.note} onChange={form.setNote} />
    </FormDialog>
  );
}
