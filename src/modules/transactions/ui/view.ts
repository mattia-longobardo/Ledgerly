/**
 * The shapes the Expenses components are handed. They are deliberately made of strings the server
 * has already formatted (spec §8.5: `@/platform/format` and nothing else), so the browser never
 * reformats money or dates and never needs to know the user's locale to draw a row.
 */

import type { RowBadge } from "./display";
import type { Tone } from "@/ui/tone";
import type { CategoryOption } from "@/ui/category-picker";
import type { TransactionType } from "../rules";

export type { CategoryOption };

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
  /** The signed amount, formatted. */
  amount: string;
  amountTone: Tone;
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
}

/** What the panel prefills for a Wallet movement. */
export interface WalletFieldsView {
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
