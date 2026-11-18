// The columns and the constraints every table writes the same way (rewrite plan R2, §10.7
// duplication): one declaration each. The SQL they make is the one the migrations already hold.
import { type SQL, sql } from "drizzle-orm";
import { check, type PgColumn, timestamp, uuid } from "drizzle-orm/pg-core";
import { inList } from "./checks";

/** The key of a row: a UUID v7 the database makes. */
export const idColumn = () =>
  uuid("id")
    .primaryKey()
    .default(sql`uuidv7()`);

/** A moment, with its zone. */
export const moment = (name: string) => timestamp(name, { withTimezone: true });

/** When the row was made. */
export const createdAtColumn = () => moment("created_at").notNull().defaultNow();

/** When the row last changed: the database's time at the insert, the app's at each update. */
export const updatedAtColumn = () =>
  moment("updated_at")
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date());

/** `CHECK (column IN (…))` over a closed vocabulary; `orNull` lets the column be empty too. */
export function checkIn(name: string, column: PgColumn | SQL, values: readonly string[], orNull = false) {
  const list = sql.raw(inList(values));
  return check(name, orNull ? sql`${column} is null or ${column} in (${list})` : sql`${column} in (${list})`);
}
