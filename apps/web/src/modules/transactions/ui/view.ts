/**
 * The shapes the Expenses components are handed, and `lineViewOf`, which builds a row from the
 * answer of `/api/v1`. They are made of strings already formatted, so the components never format
 * money or dates and never need to know the user's locale to draw a row.
 */

import type { RowBadge } from "@ledgerly/domain/transactions/client";
import type { RouteOutput } from "@ledgerly/api-client";
import type { movements } from "@ledgerly/api-contract/transactions";
import { parseCents } from "@ledgerly/format/cents";
import { formatAmountInput, formatDate, formatMoney, NULL_DISPLAY } from "@ledgerly/format/format";
import type { NumberFormat, UiLocale } from "@ledgerly/format/format";
import type { Tone } from "@ledgerly/ui/tone";
import type { CategoryOption } from "@ledgerly/ui/category-picker";
import type { CategoryType, TransactionType } from "@ledgerly/domain/transactions";
import { amountToneOf } from "./display";
import type { ManualFieldsView } from "./manual-types";

export type { CategoryOption };

/** The state of a movement's category, as the cell draws it. */
type CategoryStateView = "chosen" | "automatic" | "suggestion" | "none";

/** One movement, as the table and the mobile list draw it. */
export interface RowView {
  id: string;
  /** The day, formatted; the table shows it and never computes on it. */
  date: string;
  /** `null` for a movement the provider gave no payee for (spec §4.3: unknown is `null`). */
  payee: string | null;
  account: string;
  categoryId: string | null;
  categoryName: string | null;
  categoryColor: string | null;
  /**
   * How the category stands (ux/n3-categories-manual.md §1.2). Left out, the category is a chosen
   * one or none, as before the automatic categories.
   */
  categoryState?: CategoryStateView;
  /** Why an automatic category was given or a suggestion made: a code and what its sentence names. */
  categoryReason?: { code: string; params: Readonly<Record<string, string>> } | null;
  /** The category suggested, with its colour: it does not count until it is confirmed. */
  suggestion?: { id: string; name: string; color: string } | null;
  /** The signed amount, formatted. */
  amount: string;
  amountTone: Tone;
  /** The macros its category may be chosen in (§3.2, QC2): the picker offers only those. */
  macros?: readonly CategoryType[];
  /** A leg of a pair: the picker says it is a transfer between the person's accounts. */
  paired?: boolean;
  badges: readonly RowBadge[];
  /** Whether the row is out of the totals, which decides between "Hide" and "Restore" (§7.2). */
  hidden: boolean;
  note: string | null;
  /** The names, for the row's own chips. */
  labels: readonly string[];
  /** The ids, for the details panel: what it prefills and what it submits. */
  labelIds: readonly string[];
  /**
   * Present when the movement came from Wallet and the integration is connected: the panel then
   * edits type, amount, payee and note, and saves them to Wallet (owner, 2026-09-24).
   */
  wallet?: WalletFieldsView | null;
  /**
   * Present when the person wrote the movement by hand: every field is theirs, so the row opens
   * the manual movement's dialog and can be deleted without being hidden first.
   */
  manual?: ManualFieldsView | null;
  /**
   * Present on a manual movement that waits for its source, or that the source did not take
   * (ux §9.8): the state, and the source's name for "Not sent to {source}".
   */
  send?: { state: "to_send" | "not_sent"; source: string } | null;
}

/** What the panel prefills for a Wallet movement. */
interface WalletFieldsView {
  type: TransactionType;
  /** The size of the amount, in the user's number format, ready to be typed over. */
  amount: string;
}

/**
 * A month group of the design's table: its heading, its count and its own total. `label` is
 * `null` for the one group a non-chronological sort produces: month headings on a list ordered by
 * amount would claim a month the rows under them do not belong to.
 */
export interface GroupView {
  /** The month key, only ever used as a React key. */
  key: string;
  label: string | null;
  count: number;
  total: string;
  rows: readonly RowView[];
}

/** A category as every picker in the screen offers it, in tree order (F2.5). */

/** A label as the details panel offers it (spec §7.2: labels are the user's, like the note). */
export interface LabelOption {
  id: string;
  name: string;
  color: string | null;
}

/** A category as the filter menu offers it: with how many movements the range holds under it. */
export interface CategoryFilterOption extends CategoryOption {
  count: number;
}

/** An account as the filter menu offers it. */
export interface AccountFilterOption {
  id: string;
  name: string;
  count: number;
}

/** A movement as `GET /transactions/view` and `GET /transactions/{id}` answer it. */
export type TransactionLine = RouteOutput<typeof movements.getTransaction>;

/**
 * One movement of `/api/v1` as the table draws it: the texts formatted, the colours the screen's.
 * The badges, the source's name and whether its source edits it are the server's answer.
 */
export function lineViewOf(
  line: TransactionLine,
  {
    locale,
    numberFormat,
    colorOf,
    categories,
  }: {
    locale: UiLocale;
    numberFormat: NumberFormat;
    /** One colour per category, decided once for the screen (`categoryColors`). */
    colorOf: ReadonlyMap<string, string>;
    /** The person's categories as the screen offers them: where a suggestion's name is read. */
    categories: readonly { id: string; name: string; color: string }[];
  },
): RowView {
  const cents = parseCents(line.amount);
  return {
    id: line.id,
    date: formatDate(line.on, "long", locale),
    payee: line.payee?.trim() || null,
    account: line.accountName ?? NULL_DISPLAY,
    ...categoryOf(line, colorOf, categories),
    amount: formatMoney(cents, numberFormat),
    amountTone: amountToneOf({ type: line.type, amountCents: cents }),
    macros: line.macros,
    paired: line.transferGroupId !== null,
    badges: line.badges,
    hidden: line.hidden,
    note: line.note,
    labels: line.labels,
    labelIds: line.labelIds,
    ...editableOf(line, formatAmountInput(cents < 0n ? -cents : cents, numberFormat)),
  };
}

/** The category cell: the screen's colour for the category, and the suggestion with its name. */
function categoryOf(
  line: TransactionLine,
  colorOf: ReadonlyMap<string, string>,
  categories: readonly { id: string; name: string; color: string }[],
) {
  const suggested = categories.find((category) => category.id === line.suggestedCategoryId) ?? null;
  return {
    categoryId: line.categoryId,
    categoryName: line.categoryName,
    categoryColor: line.categoryId === null ? null : (colorOf.get(line.categoryId) ?? line.categoryColor),
    categoryState: line.categoryState,
    categoryReason: line.categoryReason,
    suggestion: suggested ? { id: suggested.id, name: suggested.name, color: suggested.color } : null,
  };
}

/** What the panel may change, and where: at the source, in the manual dialog; and the sending. */
function editableOf(line: TransactionLine, size: string): Pick<RowView, "wallet" | "manual" | "send"> {
  const manual = line.origin === "manual";
  return {
    wallet: line.editableAtSource ? { type: line.type, amount: size } : null,
    manual:
      manual && line.type !== "transfer"
        ? { kind: line.type, amount: size, on: line.on, accountId: line.accountId, payee: line.payee ?? "" }
        : null,
    send:
      manual && line.sendState !== null
        ? { state: line.sendState, source: line.sendSource ?? line.accountName ?? NULL_DISPLAY }
        : null,
  };
}
