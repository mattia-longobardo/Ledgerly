"use client";

// The dialogs of a manual position (§3.4): a valuation, a sale or a close, and the reconciliation of a
// position the provider's reading may cover. Loaded when one opens (holdings.tsx).
import { useTranslations } from "next-intl";
import { type FormEvent, useId, useState, useTransition } from "react";
import { PRODUCTS } from "@ledgerly/domain/investments/client";
import { numberSeparators } from "@ledgerly/format/format";
import { Field } from "@ledgerly/ui/field";
import { FormDialog } from "@ledgerly/ui/form-dialog";
import { DateField, MoneyField, NumberField } from "@ledgerly/ui/form-fields";
import { Input, Select } from "@ledgerly/ui/input";
import { useRouter } from "@ledgerly/ui/router";
import { Segmented } from "@ledgerly/ui/segmented";
import { notify } from "@ledgerly/ui/toast";
import { reconcile, recordOperation } from "../calls";
import { FORM_GRID, type ServiceContext, useInvestmentResult } from "./dialog-kit";
import type { HoldingKind, HoldingSummary } from "./holdings";

/** After a write: its toast, the dialog closed, the page read again. */
function useSaved(onClose: () => void) {
  const router = useRouter();
  return (done: string) => {
    notify(done);
    onClose();
    router.refresh();
  };
}

/** What the holding dialog holds while it is typed. */
function useHoldingForm(kind: HoldingKind, holding: HoldingSummary, context: ServiceContext) {
  const separators = numberSeparators(context.numberFormat);
  const [how, setHow] = useState<"price" | "amount">(holding.byValue ? "amount" : "price");
  const [quantity, setQuantity] = useState(
    kind === "close" && holding.quantityText ? holding.quantityText.replace(".", separators.decimal) : "",
  );
  const [unitPrice, setUnitPrice] = useState("");
  const [amount, setAmount] = useState("");
  const [fee, setFee] = useState("");
  const [day, setDay] = useState(context.today);
  const [note, setNote] = useState("");
  const byPrice = how === "price";
  return {
    fields: { how, setHow, quantity, setQuantity, unitPrice, setUnitPrice, amount, setAmount, fee, setFee },
    day,
    setDay,
    note,
    setNote,
    /** The operation as the Server Action took it: the fields of the way chosen only. */
    typed: () => ({
      kind,
      on: day,
      holdingId: holding.id,
      amount: byPrice ? "" : amount,
      unitPrice: byPrice ? unitPrice : "",
      quantity: kind === "valuation" || !byPrice ? "" : quantity,
      fee: kind === "valuation" ? "" : fee,
      note,
    }),
  };
}

type HoldingFields = ReturnType<typeof useHoldingForm>["fields"];

/** A sale or a valuation by price or by amount: only for a position kept by quantity. */
function HowChoice({ fields }: { fields: HoldingFields }) {
  const text = useTranslations("investments");
  return (
    <div className="col-span-full">
      <Segmented
        label={text("holdingForm.how")}
        value={fields.how}
        onChange={fields.setHow}
        options={[
          { value: "price", label: text("holdingForm.byPrice") },
          { value: "amount", label: text("holdingForm.byAmount") },
        ]}
      />
    </div>
  );
}

/** By price (a quantity and a unit price) or by amount, and the fee of a sale. */
function HoldingAmounts({
  id,
  kind,
  holding,
  fields,
}: {
  id: string;
  kind: HoldingKind;
  holding: HoldingSummary;
  fields: HoldingFields;
}) {
  const text = useTranslations("investments");
  return (
    <>
      {!holding.byValue && <HowChoice fields={fields} />}
      {fields.how === "price" ? (
        <>
          {kind !== "valuation" && (
            <NumberField
              id={`${id}-quantity`}
              label={text("holdingForm.quantity")}
              value={fields.quantity}
              onChange={fields.setQuantity}
            />
          )}
          <MoneyField
            id={`${id}-price`}
            label={text("holdingForm.unitPrice")}
            value={fields.unitPrice}
            onChange={fields.setUnitPrice}
            currency={holding.currency}
            autoFocus
          />
        </>
      ) : (
        <MoneyField
          id={`${id}-amount`}
          label={kind === "valuation" ? text("holdingForm.value") : text("holdingForm.proceeds")}
          value={fields.amount}
          onChange={fields.setAmount}
          currency={holding.currency}
          autoFocus
        />
      )}
      {kind !== "valuation" && (
        <MoneyField
          id={`${id}-fee`}
          label={text("holdingForm.fee")}
          value={fields.fee}
          onChange={fields.setFee}
          currency={holding.currency}
        />
      )}
    </>
  );
}

function HoldingDialog({
  onClose,
  kind,
  holding,
  context,
}: {
  onClose: () => void;
  kind: HoldingKind;
  holding: HoldingSummary;
  context: ServiceContext;
}) {
  const text = useTranslations("investments");
  const id = useId();
  const saved = useSaved(onClose);
  const [pending, startTransition] = useTransition();
  const { error, report } = useInvestmentResult();
  const form = useHoldingForm(kind, holding, context);

  function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    startTransition(async () => {
      if (report(await recordOperation(context.accountId, form.typed()))) saved(text("toasts.saved"));
    });
  }

  return (
    <FormDialog
      onClose={onClose}
      title={text(`holdingForm.${kind}`, { name: holding.name })}
      description={text(`holdingForm.${kind}Description`)}
      width={520}
      className={FORM_GRID}
      onSubmit={onSubmit}
      error={error}
      pending={pending}
      cancelLabel={text("form.cancel")}
      submitLabel={text("form.save")}
    >
      <HoldingAmounts id={id} kind={kind} holding={holding} fields={form.fields} />
      <DateField
        id={`${id}-on`}
        label={text("form.date")}
        value={form.day}
        onChange={form.setDay}
        max={context.today}
      />
      <Field label={text("form.note")} htmlFor={`${id}-note`}>
        <Input
          id={`${id}-note`}
          maxLength={200}
          value={form.note}
          onChange={(event) => form.setNote(event.target.value)}
        />
      </Field>
    </FormDialog>
  );
}

type ReconcileKind = "covered_by_provider" | "partial" | "outside_scope";

/** The decision: covered by the provider, partly, or outside its scope. */
function ReconcileChoice({
  kind,
  onChange,
}: {
  kind: ReconcileKind;
  onChange: (kind: ReconcileKind) => void;
}) {
  const text = useTranslations("investments");
  return (
    <div className="col-span-full">
      <Segmented
        label={text("reconcileForm.choice")}
        value={kind}
        onChange={onChange}
        options={[
          { value: "covered_by_provider", label: text("reconcileForm.covered") },
          { value: "partial", label: text("reconcileForm.partial") },
          { value: "outside_scope", label: text("reconcileForm.outside") },
        ]}
      />
    </div>
  );
}

/** What the partial and the outside-scope decisions add: how much, or which product it really is. */
function ReconcileDetail({
  id,
  kind,
  holding,
  quantity,
  onQuantity,
  product,
  onProduct,
}: {
  id: string;
  kind: ReconcileKind;
  holding: HoldingSummary;
  quantity: string;
  onQuantity: (quantity: string) => void;
  product: string;
  onProduct: (product: string) => void;
}) {
  const text = useTranslations("investments");
  if (kind === "partial")
    return (
      <NumberField
        id={`${id}-quantity`}
        label={text("reconcileForm.quantity")}
        value={quantity}
        onChange={onQuantity}
      />
    );
  if (kind !== "outside_scope") return null;
  return (
    <Field label={text("reconcileForm.product")} htmlFor={`${id}-product`}>
      <Select id={`${id}-product`} value={product} onChange={(event) => onProduct(event.target.value)}>
        {PRODUCTS.filter((one) => one !== holding.product).map((one) => (
          <option key={one} value={one}>
            {text(`products.${one}`)}
          </option>
        ))}
      </Select>
    </Field>
  );
}

function ReconcileDialog({
  onClose,
  holding,
  context,
}: {
  onClose: () => void;
  holding: HoldingSummary;
  context: ServiceContext;
}) {
  const text = useTranslations("investments");
  const id = useId();
  const saved = useSaved(onClose);
  const [pending, startTransition] = useTransition();
  const { error, report } = useInvestmentResult();
  const [kind, setKind] = useState<ReconcileKind>("covered_by_provider");
  const [effectiveOn, setEffectiveOn] = useState(holding.readingOn ?? context.today);
  const [quantity, setQuantity] = useState("");
  const [product, setProduct] = useState<string>(
    PRODUCTS.find((one) => one !== holding.product) ?? "custody",
  );
  const input = { holdingId: holding.id, kind, effectiveOn, quantity, product, readingId: holding.readingId };

  function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    startTransition(async () => {
      if (report(await reconcile(context.accountId, input))) saved(text("toasts.reconciled"));
    });
  }

  return (
    <FormDialog
      onClose={onClose}
      title={text("reconcileForm.title", { name: holding.name })}
      description={text("reconcileForm.description")}
      width={520}
      className={FORM_GRID}
      onSubmit={onSubmit}
      error={error}
      pending={pending}
      cancelLabel={text("form.cancel")}
      submitLabel={text("reconcileForm.submit")}
    >
      <ReconcileChoice kind={kind} onChange={setKind} />
      <DateField
        id={`${id}-on`}
        label={text("reconcileForm.effectiveOn")}
        value={effectiveOn}
        onChange={setEffectiveOn}
        max={context.today}
      />
      <ReconcileDetail
        id={id}
        kind={kind}
        holding={holding}
        quantity={quantity}
        onQuantity={setQuantity}
        product={product}
        onProduct={setProduct}
      />
    </FormDialog>
  );
}

/** The dialog of a position's command: an operation, or the reconciliation. */
export function PositionDialog({
  kind,
  ...props
}: {
  kind: HoldingKind | "reconcile";
  onClose: () => void;
  holding: HoldingSummary;
  context: ServiceContext;
}) {
  return kind === "reconcile" ? <ReconcileDialog {...props} /> : <HoldingDialog kind={kind} {...props} />;
}
