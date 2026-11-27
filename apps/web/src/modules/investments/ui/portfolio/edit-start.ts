// What «Edit» of an operation opens on (PERS-693): the body `GET …/operations/{eventId}` reads back,
// as the person would type it in «Record operation». Nothing is computed: decimals change only their
// separator, a deposit's side becomes the select's value.
import type { NumberFormat } from "@ledgerly/format/format";
import { AUTOMATIC, choiceOf, type StoredOperation, typedOf } from "../../calls";
import type { PickedInstrument } from "./instrument-field";

/** The kinds «Record operation» writes, and so the ones its «Edit» opens on. */
export const KINDS = ["buy", "sell", "deposit", "withdrawal", "income"] as const;
export type Kind = (typeof KINDS)[number];

export const isFormKind = (kind: string): kind is Kind => KINDS.some((one) => one === kind);

/** The fields of the form as a person types them. */
interface TypedOperation {
  instrument: PickedInstrument | null;
  holdingId: string;
  how: "price" | "amount";
  quantity: string;
  unitPrice: string;
  amount: string;
  fee: string;
  fxRate: string;
  note: string;
  counterpart: string;
}

/**
 * The kind and the day the form opens on: a purchase today, or the deposit an instalment asks for (P2).
 * With `eventId`, the «Edit» of that operation: its kind stays, its fields come typed.
 */
export interface OperationStart {
  kind: Kind;
  day?: string;
  eventId?: string;
  typed?: TypedOperation;
}

/** The instrument's name and price currency, as the Activity row names it. */
export interface RowInstrument {
  name: string;
  currency: string;
}

/** An empty form: «Record operation» opens on it. */
export const EMPTY: TypedOperation = {
  instrument: null,
  holdingId: "",
  how: "price",
  quantity: "",
  unitPrice: "",
  amount: "",
  fee: "",
  fxRate: "",
  note: "",
  counterpart: AUTOMATIC,
};

/** The price or the amount of a purchase or a sale, and its fee. */
function tradeOf(
  body: { quantity: string | null; unitPrice: string | null; amount: string | null; fee: string | null },
  format: NumberFormat,
) {
  return {
    how: body.quantity === null ? ("amount" as const) : ("price" as const),
    quantity: typedOf(body.quantity, format),
    unitPrice: typedOf(body.unitPrice, format),
    amount: typedOf(body.amount, format),
    fee: typedOf(body.fee, format),
  };
}

/** The form's start for the stored body; null for a kind «Record operation» does not write. */
export function editStartOf(
  eventId: string,
  body: StoredOperation,
  row: RowInstrument,
  format: NumberFormat,
): OperationStart | null {
  const opened = (
    kind: Kind,
    day: string | undefined,
    note: string | null | undefined,
    typed: Partial<TypedOperation>,
  ) => ({
    eventId,
    kind,
    day,
    typed: { ...EMPTY, note: note ?? "", ...typed },
  });
  switch (body.kind) {
    case "buy":
      return opened("buy", body.on, body.note, {
        ...tradeOf(body, format),
        instrument: {
          instrumentId: body.instrumentId,
          name: row.name,
          mic: body.mic,
          currency: row.currency,
        },
        fxRate: typedOf(body.fxRate, format),
      });
    case "sell":
      return opened("sell", body.on, body.note, { ...tradeOf(body, format), holdingId: body.holdingId });
    case "income":
      return opened("income", body.on, body.note, {
        holdingId: body.holdingId ?? "",
        amount: typedOf(body.amount, format),
      });
    case "deposit":
    case "withdrawal":
      return opened(body.kind, body.on, body.note, {
        amount: typedOf(body.amount, format),
        counterpart: choiceOf(body),
      });
    default:
      return null;
  }
}
