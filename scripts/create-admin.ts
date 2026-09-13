// scripts/create-admin.ts — bootstrap a password admin when Authentik is not available.
// Usage: npm run user:create-admin -- admin@example.com "Full Name"   (password read from ADMIN_PASSWORD)
import { createAuth } from "../src/platform/auth/auth";

const [email, name] = process.argv.slice(2);
const password = process.env.ADMIN_PASSWORD ?? "";
if (!email || !name) throw new Error("Usage: create-admin <email> <name> (password in ADMIN_PASSWORD)");
if (password.length < 12) throw new Error("ADMIN_PASSWORD must be at least 12 characters");

await createAuth({ withNextCookies: false }).api.createUser({
  body: { email, password, name, role: "admin" },
});
console.log(`[create-admin] ${email} created`);
process.exit(0);
