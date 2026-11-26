/**
 * The shapes the Expenses components are handed, and `lineViewOf`, which builds a row from the
 * answer of `/api/v1`. They are made of strings already formatted, so the components never format
 * money or dates and never need to know the user's locale to draw a row.
 */

import type { RowBadge } from "@ledgerly/domain/transactions/client";
import type { RouteOutput } from "@ledgerly/api-client";
import type { movements } from "@ledgerly/api-contract/transactions";
import { parseCents } from "@ledgerly/format/cents";
import {
  formatAmountInput,
  formatClock,
  formatDate,
  formatMoney,
  NULL_DISPLAY,
} from "@ledgerly/format/format";
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
  /** The time of day in the person's zone ("14:32"); `null` when the source gave none (never a noon of convenience). */
  time?: string | null;
  /** `null` for a movement the provider gave no payee for (spec §4.3: unknown is `null`). */
  payee: string | null;
  account: string;
  /** The account's id: the choice of a giroconto's other account leaves it out. */
  accountId?: string;
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
  /** A giroconto: it has the other account instead of a category. `null` on an income or a spending. */
  transfer?: TransferView | null;
  badges: readonly RowBadge[];
  /** Whether the row is out of the totals, which decides between "Hide" and "Restore" (§7.2). */
  hidden: boolean;
  note: string | null;
  /** The names, for the row's own chips. */
  labels: readonly string[];
  /** The ids, for the details panel: what it prefills and what it submits. */
  labelIds: readonly string[];
  /**
   * Present when the movement came from a source that takes changes and the integration is connected: the panel then
   * edits type, amount, payee and note, and saves them to the source (owner, 2026-09-24).
   */
  atSource?: SourceFieldsView | null;
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
  /**
   * The leg of a deposit or a withdrawal of Investments (origin `investments`, PERS-651): its amount,
   * date and account follow the operation, and it goes only with it.
   */
  investments?: boolean;
}

/**
 * The other side of a giroconto, as the server answers it (decisions 6A–10A of 2026-11-25): paired with
 * the other leg, with an account outside Ledgerly, waiting for the other leg on the account chosen, or
 * waiting for the person to choose the account (badge `unpaired`).
 */
interface TransferView {
  state: "paired" | "outside" | "waiting" | "choose";
  /** The other account's id and name: `null` when it is outside or not chosen yet. */
  otherId: string | null;
  other: string | null;
  /** Money out of this account: it goes from this account to the other, else it comes from it. */
  out: boolean;
}

/** What the panel prefills for a movement of a source. */
interface SourceFieldsView {
  type: TransactionType;
  /** The size of the amount, in the user's number format, ready to be typed over. */
  amount: string;
}

/** The day and, when the source gave it, the time: «12 nov 2026 · 14:32». */
export function dateTimeOf(row: Pick<RowView, "date" | "time">): string {
  return row.time ? `${row.date} · ${row.time}` : row.date;
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
  /** How many movements in another currency with no rate the total leaves out (D4); absent for none. */
  excludedCount?: number;
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
    timeZone,
    numberFormat,
    colorOf,
    categories,
    accounts = [],
  }: {
    locale: UiLocale;
    /** The person's zone: the time of day is read there. */
    timeZone: string;
    numberFormat: NumberFormat;
    /** One colour per category, decided once for the screen (`categoryColors`). */
    colorOf: ReadonlyMap<string, string>;
    /** The person's categories as the screen offers them: where a suggestion's name is read. */
    categories: readonly { id: string; name: string; color: string }[];
    /** The person's accounts, for the other side of a giroconto; left out where none is drawn. */
    accounts?: readonly { id: string; name: string }[];
  },
): RowView {
  const cents = parseCents(line.amount);
  return {
    id: line.id,
    date: formatDate(line.on, "long", locale),
    time: line.timeKnown ? formatClock(new Date(line.occurredAt), { locale, timeZone }) : null,
    payee: line.payee?.trim() || null,
    account: line.accountName ?? NULL_DISPLAY,
    accountId: line.accountId,
    ...categoryOf(line, colorOf, categories),
    amount: formatMoney(cents, numberFormat),
    amountTone: amountToneOf({ type: line.type, amountCents: cents }),
    macros: line.macros,
    transfer: transferOf(line, cents < 0n, accounts),
    badges: line.badges,
    hidden: line.hidden,
    note: line.note,
    labels: line.labels,
    labelIds: line.labelIds,
    investments: line.origin === "investments",
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

/** The giroconto's state, read from its fields as the API documents them; `null` for any other type. */
function transferOf(
  line: TransactionLine,
  out: boolean,
  accounts: readonly { id: string; name: string }[],
): TransferView | null {
  if (line.type !== "transfer") return null;
  const otherId = line.transferOutside ? null : line.transferAccountId;
  const state =
    line.transferGroupId !== null
      ? "paired"
      : line.transferOutside
        ? "outside"
        : otherId !== null
          ? "waiting"
          : "choose";
  const other =
    otherId === null ? null : (accounts.find((account) => account.id === otherId)?.name ?? NULL_DISPLAY);
  return { state, otherId, other, out };
}

/** What the panel may change, and where: at the source, in the manual dialog; and the sending. */
function editableOf(line: TransactionLine, size: string): Pick<RowView, "atSource" | "manual" | "send"> {
  const manual = line.origin === "manual";
  return {
    atSource: line.editableAtSource ? { type: line.type, amount: size } : null,
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
