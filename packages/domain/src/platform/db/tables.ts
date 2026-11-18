// Every module's Drizzle tables, re-exported for the client and for Better Auth.
// Each task that adds a `schema.ts` adds one `export * from` line here.
// `platform/plugins/schema` is not here on purpose: its tables are read with the query builder,
// which needs no barrel, and a line here would make the plugin runtime and the database client
// import each other — a pair the known lists of `baselines/modularity.json` may not gain (M4).
// The migrations find every `schema.ts` by themselves (`drizzle.config.ts`).
export * from "../auth/schema";
export * from "../auth/oauth/schema";
export * from "../../modules/users/schema";
export * from "../jobs/schema";
export * from "../notifications/schema";
export * from "../../modules/accounts/schema";
export * from "../integrations/schema";
export * from "../../modules/transactions/schema";
export * from "../../modules/budgets/schema";
export * from "../../modules/pockets/schema";
export * from "../../modules/subscriptions/schema";
export * from "../../modules/interests/schema";
export * from "../../modules/funds/schema";
export * from "../settings/schema";
export * from "../../modules/imports/schema";
export * from "../../modules/payroll/schema";
export * from "../../modules/timeoff/schema";
export * from "../holidays/schema";
export * from "../fx/schema";
export * from "../../modules/investments/schema";
