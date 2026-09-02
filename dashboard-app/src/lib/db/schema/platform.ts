import { integer, jsonb, pgTable, primaryKey, text, timestamp, uuid } from "drizzle-orm/pg-core";

const tz = (n: string) => timestamp(n, { withTimezone: true, mode: "date" });

export const idempotencyKeys = pgTable(
  "idempotency_keys",
  {
    principalId: uuid("principal_id").notNull(),
    key: text("key").notNull(),
    requestHash: text("request_hash").notNull(),
    statusCode: integer("status_code"),
    responseBody: jsonb("response_body"),
    createdAt: tz("created_at").notNull().defaultNow(),
    expiresAt: tz("expires_at").notNull(),
  },
  (t) => [primaryKey({ columns: [t.principalId, t.key] })],
);

export const rateLimitWindows = pgTable(
  "rate_limit_windows",
  {
    principalId: uuid("principal_id").notNull(),
    windowStart: tz("window_start").notNull(),
    count: integer("count").notNull().default(0),
  },
  (t) => [primaryKey({ columns: [t.principalId, t.windowStart] })],
);
