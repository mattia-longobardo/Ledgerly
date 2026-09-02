import type { PgDatabase } from "drizzle-orm/pg-core";
import type { NodePgQueryResultHKT } from "drizzle-orm/node-postgres";
import type * as schema from "./schema";

/** Either the pool-backed db or a transaction: repositories accept both. */
export type DbClient = PgDatabase<NodePgQueryResultHKT, typeof schema>;
