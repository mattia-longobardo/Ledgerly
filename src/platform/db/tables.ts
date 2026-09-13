// Every module's Drizzle tables, re-exported for the client and for Better Auth.
// Each task that adds a `schema.ts` adds one `export * from` line here.
export * from "@/platform/auth/schema";
export * from "@/modules/users/schema";
