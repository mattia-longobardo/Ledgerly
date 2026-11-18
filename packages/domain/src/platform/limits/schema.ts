import { integer, pgTable, text, timestamp } from "drizzle-orm/pg-core";

/**
 * Fixed windows of the limits every process shares (rewrite plan R1): the API's requests per token
 * and the attempts of a key, once held in the memory of the one process that served them.
 */
export const rateLimitCounters = pgTable("rate_limit_counters", {
  key: text("key").primaryKey(),
  count: integer("count").notNull(),
  resetAt: timestamp("reset_at", { withTimezone: true }).notNull(),
});
