// scripts/create-admin.ts — bootstrap a password admin when Authentik is not available.
// Usage: npm run user:create-admin -- admin@example.com "Full Name"   (password read from ADMIN_PASSWORD)
import { createAuth } from "../src/platform/auth/auth";
import { MAX_NAME_LENGTH, nameSchema } from "../src/platform/auth/name-policy";
import {
  isPasswordLengthValid,
  MAX_PASSWORD_LENGTH,
  MIN_PASSWORD_LENGTH,
} from "../src/platform/auth/password-policy";

const [email, rawName] = process.argv.slice(2);
const password = process.env.ADMIN_PASSWORD ?? "";
if (!email || rawName === undefined) {
  throw new Error("Usage: create-admin <email> <name> (password in ADMIN_PASSWORD)");
}
const name = nameSchema.safeParse(rawName);
if (!name.success) throw new Error(`The name must be 1 to ${MAX_NAME_LENGTH} characters`);
if (!isPasswordLengthValid(password)) {
  throw new Error(`ADMIN_PASSWORD must be ${MIN_PASSWORD_LENGTH} to ${MAX_PASSWORD_LENGTH} characters`);
}

await createAuth({ withNextCookies: false }).api.createUser({
  body: { email, password, name: name.data, role: "admin" },
});
console.log(`[create-admin] ${email} created`);
process.exit(0);
