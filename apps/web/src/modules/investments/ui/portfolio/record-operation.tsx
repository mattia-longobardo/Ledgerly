"use client";

// «Record operation» of a manual portfolio (R5d): a purchase of an instrument of the registry on the
// market of the order, a sale, a deposit, a withdrawal or a dividend. The server keeps the cash and
// refuses what leaves it below zero (`negative_cash`): the refusal offers «Record a deposit», the
// same form on the same day. Every figure comes back from the API; nothing is computed here.
import { useTranslations } from "next-intl";
import { type FormEvent, type RefObject, useId, useState, useTransition } from "react";
import { investments } from "@ledgerly/api-contract/investments";
import { quantityText } from "@ledgerly/domain/investments/client";
import { Button } from "@ledgerly/ui/button";
import { useApi } from "@ledgerly/ui/data";
import { Field } from "@ledgerly/ui/field";
import { FormDialog } from "@ledgerly/ui/form-dialog";
import { DateField, MoneyField } from "@ledgerly/ui/form-fields";
import { Select } from "@ledgerly/ui/input";
import { useRouter } from "@ledgerly/ui/router";
import { notify } from "@ledgerly/ui/toast";
import { type ActionResult, recordOperation, recordPortfolioOperation } from "../../calls";
import { PriceOrAmount, type PriceFields } from "../price-fields";
import { FORM_GRID, NoteField, type ServiceContext, useErrorText } from "../dialog-kit";
import { FxRateField, InstrumentField, type PickedInstrument } from "./instrument-field";

const KINDS = ["buy", "sell", "deposit", "withdrawal", "income"] as const;
type Kind = (typeof KINDS)[number];

/** What the dialog holds while it is typed: one field each, read by the kind chosen. */
function useOperationForm(context: ServiceContext) {
  const [kind, setKind] = useState<Kind>("buy");
  const [day, setDay] = useState(context.today);
  const [instrument, setInstrument] = useState<PickedInstrument | null>(null);
  const [holdingId, setHoldingId] = useState("");
  const [how, setHow] = useState<"price" | "amount">("price");
  const [quantity, setQuantity] = useState("");
  const [unitPrice, setUnitPrice] = useState("");
  const [amount, setAmount] = useState("");
  const [fee, setFee] = useState("");
  const [fxRate, setFxRate] = useState("");
  const [note, setNote] = useState("");
  const typed = { day, instrument, holdingId, how, quantity, unitPrice, amount, fee, fxRate, note };
  const fields: PriceFields = {
    how,
    setHow,
    quantity,
    setQuantity,
    unitPrice,
    setUnitPrice,
    amount,
    setAmount,
  };
  const set = {
    setDay,
    setInstrument,
    setHoldingId,
    setHow,
    setQuantity,
    setUnitPrice,
    setAmount,
    setFee,
    setFxRate,
    setNote,
  };
  return { kind, setKind, typed, set, fields };
}

type OperationForm = ReturnType<typeof useOperationForm>;

/** The write of the kind chosen. */
function save(context: ServiceContext, form: OperationForm): Promise<ActionResult> {
  const { kind, typed } = form;
  const { accountId } = context;
  // A sale by amount names neither a quantity nor a price; an income its amount only.
  const byPrice = kind === "sell" && typed.how === "price";
  if (kind === "sell" || kind === "income")
    return recordOperation(accountId, {
      kind,
      on: typed.day,
      holdingId: typed.holdingId || null,
      quantity: byPrice ? typed.quantity : "",
      unitPrice: byPrice ? typed.unitPrice : "",
      amount: byPrice ? "" : typed.amount,
      fee: typed.fee,
      note: typed.note,
    });
  if (kind !== "buy")
    return recordPortfolioOperation(accountId, {
      kind,
      on: typed.day,
      amount: typed.amount,
      note: typed.note,
    });
  if (typed.instrument === null) return Promise.resolve({ ok: false, error: "invalid" });
  return recordPortfolioOperation(accountId, {
    kind,
    instrumentId: typed.instrument.instrumentId,
    mic: typed.instrument.mic,
    on: typed.day,
    how: typed.how,
    quantity: typed.quantity,
    unitPrice: typed.unitPrice,
    amount: typed.amount,
    fee: typed.fee,
    fxRate: typed.fxRate,
    note: typed.note,
  });
}

/** The portfolio's open positions, for a sale or a dividend. */
function HoldingField({
  id,
  context,
  value,
  onChange,
  optional,
}: {
  id: string;
  context: ServiceContext;
  value: string;
  onChange: (holdingId: string) => void;
  optional: boolean;
}) {
  const text = useTranslations("investments");
  const read = useApi(investments.getInvestmentPositions, {
    params: { accountId: context.accountId },
    query: {},
  });
  const positions = read.data;
  const rows = positions?.open.rows.filter((row) => row.manual !== null && row.holdingId !== null) ?? [];
  const assetOf = (assetId: string | null) => positions?.assets.find((one) => one.id === assetId);
  return (
    <div className="col-span-full">
      <Field label={text("portfolioOps.position")} htmlFor={`${id}-holding`}>
        <Select
          id={`${id}-holding`}
          value={value}
          required={!optional}
          onChange={(event) => onChange(event.target.value)}
        >
          <option value="" disabled={!optional}>
            {optional ? text("portfolioOps.noPosition") : text("portfolioOps.choosePosition")}
          </option>
          {rows.map((row) => {
            const asset = assetOf(row.assetId);
            return (
              <option key={row.key} value={row.holdingId ?? ""}>
                {text("portfolioOps.positionOption", {
                  name: asset?.name ?? text("positions.unknownAsset"),
                  quantity:
                    row.at.quantity === null
                      ? text("positions.byValue")
                      : quantityText(row.at.quantity, asset?.class ?? null, context.numberFormat),
                })}
              </option>
            );
          })}
        </Select>
      </Field>
    </div>
  );
}

/** A purchase: the instrument and its market, the price or the amount, the fee and the rate. */
function BuyFields({ id, context, form }: { id: string; context: ServiceContext; form: OperationForm }) {
  const text = useTranslations("investments");
  const { typed, set } = form;
  const currency = typed.instrument?.currency ?? context.currency;
  return (
    <>
      <InstrumentField id={id} onChange={set.setInstrument} />
      <PriceOrAmount
        id={id}
        currency={currency}
        fields={form.fields}
        choice
        quantity
        amountLabel={text("portfolioOps.total")}
      />
      <MoneyField
        id={`${id}-fee`}
        label={text("holdingForm.fee")}
        value={typed.fee}
        onChange={set.setFee}
        currency={currency}
      />
      <FxRateField
        id={`${id}-fx`}
        from={currency}
        to={context.currency}
        value={typed.fxRate}
        onChange={set.setFxRate}
      />
    </>
  );
}

/** A sale: the position, a quantity at a price, and the fee. */
function SellFields({ id, context, form }: { id: string; context: ServiceContext; form: OperationForm }) {
  const text = useTranslations("investments");
  const { typed, set } = form;
  return (
    <>
      <HoldingField
        id={id}
        context={context}
        value={typed.holdingId}
        onChange={set.setHoldingId}
        optional={false}
      />
      <PriceOrAmount
        id={id}
        currency={context.currency}
        fields={form.fields}
        choice
        quantity
        amountLabel={text("holdingForm.proceeds")}
      />
      <MoneyField
        id={`${id}-fee`}
        label={text("holdingForm.fee")}
        value={typed.fee}
        onChange={set.setFee}
        currency={context.currency}
      />
    </>
  );
}

function KindFields({ id, context, form }: { id: string; context: ServiceContext; form: OperationForm }) {
  const text = useTranslations("investments");
  const { kind, typed, set } = form;
  if (kind === "buy") return <BuyFields id={id} context={context} form={form} />;
  if (kind === "sell") return <SellFields id={id} context={context} form={form} />;
  return (
    <>
      {kind === "income" && (
        <HoldingField
          id={id}
          context={context}
          value={typed.holdingId}
          onChange={set.setHoldingId}
          optional
        />
      )}
      <MoneyField
        id={`${id}-amount`}
        label={text("form.amount")}
        value={typed.amount}
        onChange={set.setAmount}
        currency={context.currency}
        autoFocus
      />
    </>
  );
}

/** «Save»: the write, or the refusal kept by its code; `negative_cash` offers a deposit. */
function useRecord(context: ServiceContext, form: OperationForm, onClose: () => void) {
  const text = useTranslations("investments");
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [refused, setRefused] = useState<string | null>(null);
  function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    startTransition(async () => {
      const result = await save(context, form);
      if (!result.ok) {
        setRefused(result.error);
        return;
      }
      notify(text("toasts.saved"));
      onClose();
      router.refresh();
    });
  }
  return {
    pending,
    refused,
    onSubmit,
    pickKind: (kind: Kind) => {
      form.setKind(kind);
      setRefused(null);
    },
    /** «Record a deposit»: the same form, a deposit on the day of the refused operation. */
    toDeposit: () => {
      form.setKind("deposit");
      form.set.setAmount("");
      setRefused(null);
    },
  };
}

function KindField({ id, kind, onChange }: { id: string; kind: Kind; onChange: (kind: Kind) => void }) {
  const text = useTranslations("investments.portfolioOps");
  return (
    <Field label={text("kind")} htmlFor={id}>
      <Select
        id={id}
        value={kind}
        onChange={(event) => onChange(KINDS.find((one) => one === event.target.value) ?? "buy")}
      >
        {KINDS.map((one) => (
          <option key={one} value={one}>
            {text(`kinds.${one}`)}
          </option>
        ))}
      </Select>
    </Field>
  );
}

export function RecordOperationDialog({
  onClose,
  context,
  opener,
}: {
  onClose: () => void;
  context: ServiceContext;
  opener: RefObject<HTMLButtonElement | null>;
}) {
  const text = useTranslations("investments");
  const errorText = useErrorText();
  const id = useId();
  const form = useOperationForm(context);
  const record = useRecord(context, form, onClose);
  const { kind, typed, set } = form;
  return (
    <FormDialog
      onClose={onClose}
      title={text("portfolioOps.title", { name: context.name })}
      description={text(`portfolioOps.descriptions.${kind}`)}
      width={520}
      className={FORM_GRID}
      onSubmit={record.onSubmit}
      error={record.refused === null ? null : errorText(record.refused)}
      pending={record.pending}
      cancelLabel={text("form.cancel")}
      submitLabel={text("form.save")}
      finalFocus={opener}
    >
      <KindField id={`${id}-kind`} kind={kind} onChange={record.pickKind} />
      <DateField
        id={`${id}-on`}
        label={text("form.date")}
        value={typed.day}
        onChange={set.setDay}
        max={context.today}
      />
      <KindFields id={id} context={context} form={form} />
      <NoteField id={`${id}-note`} value={typed.note} onChange={set.setNote} />
      {record.refused === "negative_cash" && (
        <div className="col-span-full">
          <Button size="sm" onClick={record.toDeposit}>
            {text("portfolioOps.recordDeposit")}
          </Button>
        </div>
      )}
    </FormDialog>
  );
}
