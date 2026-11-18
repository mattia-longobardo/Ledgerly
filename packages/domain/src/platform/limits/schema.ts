import { integer, pgTable, text } from "drizzle-orm/pg-core";
import { moment } from "../../platform/db/columns";

/**
 * Fixed windows of the limits every process shares (rewrite plan R1): the API's requests per token
 * and the attempts of a key, once held in the memory of the one process that served them.
 */
export const rateLimitCounters = pgTable("rate_limit_counters", {
  key: text("key").primaryKey(),
  count: integer("count").notNull(),
  resetAt: moment("reset_at").notNull(),
});
