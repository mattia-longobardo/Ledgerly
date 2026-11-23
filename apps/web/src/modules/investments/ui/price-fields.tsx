"use client";

// The amounts of an operation on a position (§3.4, R5d): by price — a quantity at a unit price — or by
// amount, with the choice between the two. The dialogs of a position and «Record operation» share it.
import { useTranslations } from "next-intl";
import { MoneyField, NumberField } from "@ledgerly/ui/form-fields";
import { Segmented } from "@ledgerly/ui/segmented";

/** The fields as typed, with their setters. */
export interface PriceFields {
  how: "price" | "amount";
  setHow: (how: "price" | "amount") => void;
  quantity: string;
  setQuantity: (value: string) => void;
  unitPrice: string;
  setUnitPrice: (value: string) => void;
  amount: string;
  setAmount: (value: string) => void;
}

/** «Record by»: price or amount. */
function HowChoice({ fields }: { fields: PriceFields }) {
  const text = useTranslations("investments.holdingForm");
  return (
    <div className="col-span-full">
      <Segmented
        label={text("how")}
        value={fields.how}
        onChange={fields.setHow}
        options={[
          { value: "price", label: text("byPrice") },
          { value: "amount", label: text("byAmount") },
        ]}
      />
    </div>
  );
}

export function PriceOrAmount({
  id,
  currency,
  fields,
  choice,
  quantity,
  amountLabel,
  autoFocus,
}: {
  id: string;
  currency: string;
  fields: PriceFields;
  /** Whether «Record by» is offered: a position kept by value has its amount only. */
  choice: boolean;
  /** Whether a quantity is typed beside the price: a valuation has none. */
  quantity: boolean;
  amountLabel: string;
  autoFocus?: boolean;
}) {
  const text = useTranslations("investments.holdingForm");
  return (
    <>
      {choice && <HowChoice fields={fields} />}
      {fields.how === "price" ? (
        <>
          {quantity && (
            <NumberField
              id={`${id}-quantity`}
              label={text("quantity")}
              value={fields.quantity}
              onChange={fields.setQuantity}
            />
          )}
          <MoneyField
            id={`${id}-price`}
            label={text("unitPrice")}
            value={fields.unitPrice}
            onChange={fields.setUnitPrice}
            currency={currency}
            autoFocus={autoFocus}
          />
        </>
      ) : (
        <MoneyField
          id={`${id}-amount`}
          label={amountLabel}
          value={fields.amount}
          onChange={fields.setAmount}
          currency={currency}
          autoFocus={autoFocus}
        />
      )}
    </>
  );
}
