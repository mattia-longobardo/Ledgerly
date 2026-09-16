/**
 * The vocabulary the integration tables are built on. Kept here rather than in `schema.ts` so the
 * tables and the pure rules that reason about them share one source (same split as
 * `modules/accounts/rules.ts`).
 */

export const CONNECTION_STATES = ["active", "error", "revoked"] as const;
export const SYNC_KINDS = ["accounts", "transactions"] as const;
export const SYNC_STATES = ["running", "success", "failed", "skipped"] as const;
export const ENTITY_TYPES = ["account", "transaction", "category"] as const;

export type ConnectionState = (typeof CONNECTION_STATES)[number];
export type SyncKind = (typeof SYNC_KINDS)[number];
export type SyncState = (typeof SYNC_STATES)[number];
export type EntityType = (typeof ENTITY_TYPES)[number];

/** The only provider F2 speaks to. Later phases add their own (spec §9.2). */
export const WALLET_PROVIDER = "wallet";
