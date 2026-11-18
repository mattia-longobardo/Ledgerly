import { defineConfig } from "drizzle-kit";

export default defineConfig({
  dialect: "postgresql",
  // A schema split in parts (rule Q6) is a folder `schema/`.
  schema: [
    "./packages/domain/src/platform/**/schema.ts",
    "./packages/domain/src/modules/**/schema.ts",
    "./packages/domain/src/modules/**/schema/*.ts",
  ],
  out: "./drizzle",
  dbCredentials: { url: process.env.DATABASE_URL ?? "" },
  strict: true,
  verbose: true,
});
