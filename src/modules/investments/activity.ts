// src/modules/investments/activity.ts — the Activity tab in words (docs/design/investments-ux.md §3.5,
// §5.2, U3): the families its chips filter by, and one sentence per event, never its legs. Pure: no
// database, no clock; the words come from the caller's translator.
import { formatDecimalText, type NumberFormat } from "@/platform/format";
import type { AssetClass, OperationKind } from "./rules";

/** The chips of the tab (§3.5): what the person looks for, not the engine's kinds. */
export const ACTIVITY_FAMILIES = ["trades", "flows", "income", "fees", "other"] as const;
export type ActivityFamily = (typeof ACTIVITY_FAMILIES)[number];

const FAMILY: Record<OperationKind, ActivityFamily> = {
  buy: "trades",
  sell: "trades",
  close: "trades",
  deposit: "flows",
  withdrawal: "flows",
  opening_cash: "flows",
  opening_position: "flows",
  income: "income",
  fee: "fees",
  valuation: "other",
  account_valuation: "other",
  adjustment: "other",
};

export function familyOf(kind: OperationKind): ActivityFamily {
  return FAMILY[kind];
}

/** The kinds of a family, for the query's filter. */
export function kindsOf(family: ActivityFamily): OperationKind[] {
  return (Object.keys(FAMILY) as OperationKind[]).filter((kind) => FAMILY[kind] === family);
}

/** A leg as the tab reads it: the one that says what the event is (`main`, or a trade's `base`). */
export interface DescribedLeg {
  kind: OperationKind;
  /** The asset's name; `null` for a leg of the account's cash. */
  assetName: string | null;
  assetClass: AssetClass | null;
  /** The product of the holding (`copy` = eToro copy trading). */
  product: string | null;
  /** Decimal text, as stored. */
  quantity: string | null;
  unitPrice: string | null;
  priceCurrency: string | null;
}

export interface DescribedEvent {
  leg: DescribedLeg;
  note: string | null;
  /** Where a deposit came from or a withdrawal went: the other service, or the bank movement's payee. */
  counterpart: string | null;
}

export type ActivityT = (key: string, values?: Record<string, string>) => string;

export interface Description {
  /** What the event is, for the Type column and the chips: "Bought", "Deposit", "Staking". */
  label: string;
  /** The rest of the sentence: "6.87 SpaceX at $202.94"; `null` when the label says it all. */
  detail: string | null;
  /** The whole sentence of §5.2: "Bought 6.87 SpaceX at $202.94". */
  sentence: string;
}

/**
 * A quantity with at most 4 decimals, 8 for a coin under one unit (§3.5): enough to read, never the
 * 18 the book keeps.
 */
export function quantityText(quantity: string, assetClass: AssetClass | null, format: NumberFormat): string {
  const coin = assetClass === "crypto" || assetClass === "stablecoin";
  const below = Math.abs(Number(quantity)) < 1;
  return formatDecimalText(quantity, format, { max: coin && below ? 8 : 4 });
}

/** A unit price in its currency: two decimals, up to eight under one unit (a coin's satoshis). */
export function priceText(price: string, currency: string | null, format: NumberFormat): string {
  const below = Math.abs(Number(price)) < 1;
  return formatDecimalText(price, format, {
    min: 2,
    max: below ? 8 : 2,
    currency: currency ?? undefined,
  });
}

/** One sentence per event (§5.2), in the reader's language: never `base` / `quote` / `fee`. */
export function describeEvent(event: DescribedEvent, t: ActivityT, format: NumberFormat): Description {
  const { leg } = event;
  const note = event.note?.trim() || null;
  const qty = leg.quantity === null ? null : quantityText(leg.quantity, leg.assetClass, format);
  const price = leg.unitPrice === null ? null : priceText(leg.unitPrice, leg.priceCurrency, format);
  const asset = leg.assetName;

  const position = (): string | null => {
    if (asset === null) return null;
    if (qty !== null && price !== null) return t("details.position", { qty, asset, price });
    if (qty !== null) return t("details.quantity", { qty, asset });
    return asset;
  };

  let label: string;
  let detail: string | null;
  switch (leg.kind) {
    case "buy":
    case "sell":
    case "close":
      label = t(`labels.${leg.kind === "buy" ? "buy" : "sell"}`);
      detail = position();
      break;
    case "deposit":
      label = t("labels.deposit");
      detail = event.counterpart ? t("details.from", { source: event.counterpart }) : null;
      break;
    case "withdrawal":
      label = t("labels.withdrawal");
      detail = event.counterpart ? t("details.to", { dest: event.counterpart }) : null;
      break;
    case "income":
      label = t(`labels.income.${incomeKind(leg)}`);
      detail = asset === null ? note : qty !== null ? t("details.quantity", { qty, asset }) : asset;
      break;
    case "fee":
      label = t("labels.fee");
      detail = [note, asset].filter(Boolean).join(" ") || null;
      break;
    case "adjustment":
      label = t("labels.adjustment");
      detail = note;
      break;
    case "opening_cash":
      label = t("labels.openingCash");
      detail = null;
      break;
    case "opening_position":
      label = t("labels.openingPosition");
      detail = position();
      break;
    case "valuation":
      label = t("labels.valuation");
      detail = asset === null ? null : price !== null ? t("details.priced", { asset, price }) : asset;
      break;
    case "account_valuation":
      label = t("labels.accountValuation");
      detail = null;
      break;
  }
  if (leg.product === "copy" && detail !== null) detail = t("details.copy", { detail });

  const sentence =
    detail === null ? label : t(leg.kind === "adjustment" ? "sentenceColon" : "sentence", { label, detail });
  return { label, detail, sentence };
}

/** What an income is (§5.2): a stake's reward, an Earn reward, a dividend, or just income. */
function incomeKind(leg: DescribedLeg): "staking" | "reward" | "dividend" | "income" {
  if (leg.product === "staking") return "staking";
  if (leg.product === "earn") return "reward";
  if (leg.assetClass === "stock" || leg.assetClass === "etf" || leg.assetClass === "fund") return "dividend";
  return "income";
}
