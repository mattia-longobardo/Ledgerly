"use client";

// The instruments of a basket in its form (PERS-681 §7): one row each with its percentage, the sum
// of the percentages as typed, and the registry's search to add one, at most 10. The sum is the
// form's check of what was typed, not a figure of the plan: the server checks it again.
import { useTranslations } from "next-intl";
import { useState } from "react";
import { plans } from "@ledgerly/api-contract/investments";
import { formatDecimalText, type NumberFormat } from "@ledgerly/format/format";
import { Button } from "@ledgerly/ui/button";
import { Field } from "@ledgerly/ui/field";
import { Input, InputGroup } from "@ledgerly/ui/input";
import type { PlanInstrument } from "../../plan-calls";
import { InstrumentField, type PickedInstrument } from "../portfolio/instrument-field";
import { weightsSum } from "./plan-words";

/** One instrument of the basket: its name, its percentage and «Remove». */
function InstrumentRow({
  id,
  row,
  onWeight,
  onRemove,
}: {
  id: string;
  row: PlanInstrument;
  onWeight: (weight: string) => void;
  onRemove: () => void;
}) {
  const text = useTranslations("investments.plans.form");
  return (
    <li data-testid="plan-instrument" className="flex flex-wrap items-end gap-2">
      <div className="min-w-0 flex-1">
        <Field label={text("weightOf", { name: row.name })} htmlFor={`${id}-weight`}>
          <InputGroup suffix="%">
            <Input
              id={`${id}-weight`}
              inputMode="decimal"
              numeric
              required
              value={row.weight}
              onChange={(event) => onWeight(event.target.value)}
            />
          </InputGroup>
        </Field>
      </div>
      <Button size="sm" variant="ghost" onClick={onRemove} aria-label={text("removeOf", { name: row.name })}>
        {text("remove")}
      </Button>
    </li>
  );
}

/** The registry's search, and «Add» for the instrument picked. */
function AddInstrument({ id, onAdd }: { id: string; onAdd: (picked: PickedInstrument) => void }) {
  const text = useTranslations("investments.plans.form");
  const [picked, setPicked] = useState<PickedInstrument | null>(null);
  // A new search each time one is added: the field starts empty.
  const [round, setRound] = useState(0);
  return (
    <div className="flex flex-col gap-2">
      <InstrumentField key={round} id={`${id}-add-${round}`} onChange={setPicked} />
      <div>
        <Button
          size="sm"
          disabled={picked === null}
          onClick={() => {
            if (picked === null) return;
            onAdd(picked);
            setPicked(null);
            setRound((count) => count + 1);
          }}
        >
          {text("addInstrument")}
        </Button>
      </div>
    </div>
  );
}

export function InstrumentsFields({
  id,
  rows,
  onChange,
  format,
}: {
  id: string;
  rows: readonly PlanInstrument[];
  onChange: (rows: PlanInstrument[]) => void;
  format: NumberFormat;
}) {
  const text = useTranslations("investments.plans.form");
  const sum = formatDecimalText(String(weightsSum(rows, format) / 100), format, { min: 0, max: 2 });
  const add = (picked: PickedInstrument) =>
    onChange([
      ...rows,
      {
        key: `${picked.instrumentId}-${rows.length}-${Date.now()}`,
        name: picked.name,
        weight: "",
        assetId: null,
        instrumentId: picked.instrumentId,
        mic: picked.mic,
      },
    ]);
  return (
    <fieldset className="col-span-full flex flex-col gap-3" aria-describedby={`${id}-sum`}>
      <legend className="text-sm font-medium">{text("instruments")}</legend>
      {rows.length > 0 && (
        <ul className="flex flex-col gap-2">
          {rows.map((row, index) => (
            <InstrumentRow
              key={row.key}
              id={`${id}-instrument-${index}`}
              row={row}
              onWeight={(weight) => onChange(rows.map((one) => (one === row ? { ...one, weight } : one)))}
              onRemove={() => onChange(rows.filter((one) => one !== row))}
            />
          ))}
        </ul>
      )}
      <p id={`${id}-sum`} data-testid="weights-sum" aria-live="polite" className="text-sm text-muted">
        {text("weightsSum", { sum })}
      </p>
      {rows.length < plans.MAX_PLAN_INSTRUMENTS ? (
        <AddInstrument id={id} onAdd={add} />
      ) : (
        <p className="text-sm text-muted">{text("maxInstruments", { max: plans.MAX_PLAN_INSTRUMENTS })}</p>
      )}
    </fieldset>
  );
}
