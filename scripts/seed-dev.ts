// scripts/seed-dev.ts — local development data. Idempotent. Later phases add their sample data here.
import { eq } from "drizzle-orm";
import { createAuth } from "../src/platform/auth/auth";
import { users } from "../src/platform/auth/schema";
import { getDb, getPool } from "../src/platform/db/client";
import { ensureBucket } from "../src/platform/storage";

const email = process.env.DEV_OWNER_EMAIL ?? "owner@example.test";
const password = process.env.DEV_OWNER_PASSWORD ?? "owner-password-123";

await ensureBucket();
const [existing] = await getDb().select({ id: users.id }).from(users).where(eq(users.email, email));
if (!existing) {
  await createAuth({ withNextCookies: false }).api.createUser({ body: { email, password, name: "Owner" } });
  console.log(`[seed] created ${email} (password: ${password})`);
} else {
  console.log(`[seed] ${email} already exists`);
}
await getPool().end();
