import { index, pgTable, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { createdAtColumn, idColumn } from "../../../platform/db/columns";
import { accounts } from "../../accounts/schema";
import { users } from "../../../platform/auth/schema";

/**
 * The archived accounts that are a double of another account (decision H58): every movement of
 * the account is one of its twin's, so the months count them once, on the twin. A row is written
 * when the account is archived and goes when it is restored; deleting the twin takes the row with
 * it, and the account's movements count again, because they are then the only copy.
 */
export const duplicateAccounts = pgTable(
  "duplicate_accounts",
  {
    id: idColumn(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    accountId: uuid("account_id")
      .notNull()
      .references(() => accounts.id, { onDelete: "cascade" }),
    twinAccountId: uuid("twin_account_id")
      .notNull()
      .references(() => accounts.id, { onDelete: "cascade" }),
    createdAt: createdAtColumn(),
  },
  (table) => [
    uniqueIndex("duplicate_accounts_account_uq").on(table.accountId),
    index("duplicate_accounts_user_idx").on(table.userId),
  ],
);
