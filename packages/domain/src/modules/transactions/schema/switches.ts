import { sql } from "drizzle-orm";
import { index, jsonb, pgTable, text, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { createdAtColumn, idColumn, moment } from "../../../platform/db/columns";
import { accountSwitches } from "../../accounts/schema";
import { users } from "../../../platform/auth/schema";
import { type TransactionType } from "../rules";
import { transactions } from "./movements";

/** What a movement was before a switch made it a leg of a transfer (rewrite plan N4, H40). */
export interface SwitchLegBefore {
  type: TransactionType;
  transferGroupId: string | null;
}

/**
 * The transfers a switch found between the account and the other accounts of the same bank, on the
 * whole history and after it (decision H40). "Undo switch" puts each leg back as it was; the rows
 * are kept, with `undone_at`, so the history of the switch stays readable.
 */
export const switchTransferPairs = pgTable(
  "switch_transfer_pairs",
  {
    id: idColumn(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    switchId: uuid("switch_id")
      .notNull()
      .references(() => accountSwitches.id, { onDelete: "cascade" }),
    outId: uuid("out_id")
      .notNull()
      .references(() => transactions.id, { onDelete: "cascade" }),
    inId: uuid("in_id")
      .notNull()
      .references(() => transactions.id, { onDelete: "cascade" }),
    outBefore: jsonb("out_before").$type<SwitchLegBefore>().notNull(),
    inBefore: jsonb("in_before").$type<SwitchLegBefore>().notNull(),
    undoneAt: moment("undone_at"),
    createdAt: createdAtColumn(),
  },
  (table) => [
    index("switch_transfer_pairs_switch_idx").on(table.switchId),
    uniqueIndex("switch_transfer_pairs_out_uq")
      .on(table.outId)
      .where(sql`${table.undoneAt} is null`),
  ],
);

/** What a movement kept by a switch was before the joined account's movement gave it its choices. */
export interface MergedMovementBefore {
  categoryId: string | null;
  categoryOrigin: (typeof transactions.$inferSelect)["categoryOrigin"];
  categoryConfidence: number | null;
  categoryModelVersion: number | null;
  suggestedCategoryId: string | null;
  categoryReason: string | null;
  categoryReasonParams: Record<string, string> | null;
  note: string | null;
  locallyEdited: string[];
}

/**
 * The movements of an account of the bank that was already here, each with the movement of the
 * switched account it doubles (rewrite plan N4, H39 for already imported accounts): the bank's link
 * moved to the movement kept, the double stopped counting, and the person's category and note went
 * to the movement kept when it had none. "Undo switch" reads this to put each one back.
 */
export const switchMergedMovements = pgTable(
  "switch_merged_movements",
  {
    id: idColumn(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    switchId: uuid("switch_id")
      .notNull()
      .references(() => accountSwitches.id, { onDelete: "cascade" }),
    /** The movement of the joined account: it no longer counts while the switch is open. */
    doubleId: uuid("double_id")
      .notNull()
      .references(() => transactions.id, { onDelete: "cascade" }),
    /** The movement of the switched account that stays. */
    keptId: uuid("kept_id")
      .notNull()
      .references(() => transactions.id, { onDelete: "cascade" }),
    /** The bank's id of the movement, moved from the double to the movement kept. */
    externalId: text("external_id"),
    /** The movement kept before it took the double's choices; `null` when nothing was taken. */
    keptBefore: jsonb("kept_before").$type<MergedMovementBefore>(),
    undoneAt: moment("undone_at"),
    createdAt: createdAtColumn(),
  },
  (table) => [index("switch_merged_movements_switch_idx").on(table.switchId)],
);
