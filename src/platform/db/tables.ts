// Every module's Drizzle tables, re-exported for the client and for Better Auth.
// Each task that adds a `schema.ts` adds one `export * from` line here.
export * from "@/platform/auth/schema";
export * from "@/modules/users/schema";
export * from "@/platform/jobs/schema";
export * from "@/platform/notifications/schema";
export * from "@/modules/accounts/schema";
export * from "@/platform/integrations/schema";
export * from "@/modules/transactions/schema";
export * from "@/modules/budgets/schema";
export * from "@/modules/pockets/schema";
export * from "@/modules/subscriptions/schema";
export * from "@/modules/interests/schema";
export * from "@/modules/funds/schema";
export * from "@/platform/settings/schema";
export * from "@/modules/imports/schema";
export * from "@/modules/payroll/schema";
