// scripts/create-api-client.ts — a Client API (docs/auth-design.md D3) for a person, without a
// browser: what a service that cannot sign in needs, such as the Paperless webhook (PERS-47).
//
// Usage (on the homelab): npm run user:create-api-client -- <email> <name> <scope[,scope…]> <env-file> <PREFIX>
// The client id and secret are written to <env-file> as <PREFIX>_CLIENT_ID and
// <PREFIX>_CLIENT_SECRET (mode 600), never printed. A short-lived session of the owner is made for
// the call and deleted right after, so the plugin records the right owner, as from Settings.
import { chmodSync, existsSync, readFileSync, writeFileSync } from "node:fs";
import { serializeSignedCookie } from "better-call";
import { eq } from "drizzle-orm";
import { createApiClientWith } from "../src/platform/auth/api-clients";
import { createAuth } from "../src/platform/auth/auth";
import { users } from "../src/platform/auth/schema";
import { getDb } from "../src/platform/db/client";

const [email, name, rawScopes, envFile, prefix] = process.argv.slice(2);
if (!email || !name || !rawScopes || !envFile || !prefix || !/^[A-Z][A-Z0-9_]*$/.test(prefix)) {
  throw new Error("Usage: create-api-client <email> <name> <scope[,scope…]> <env-file> <PREFIX>");
}

const auth = createAuth({ withNextCookies: false });
const context = await auth.$context;
const [person] = await getDb().select({ id: users.id }).from(users).where(eq(users.email, email));
if (!person) throw new Error(`No user ${email}`);

const session = await context.internalAdapter.createSession(person.id);
try {
  const cookie = (
    await serializeSignedCookie(context.authCookies.sessionToken.name, session.token, context.secret)
  ).split(";")[0];
  const minted = await createApiClientWith(auth, new Headers({ cookie }), {
    name,
    scopes: rawScopes.split(",").map((scope) => scope.trim()),
  });
  const keep = existsSync(envFile)
    ? readFileSync(envFile, "utf8")
        .split("\n")
        .filter(
          (line) => !line.startsWith(`${prefix}_CLIENT_ID=`) && !line.startsWith(`${prefix}_CLIENT_SECRET=`),
        )
    : [];
  while (keep.length > 0 && keep[keep.length - 1] === "") keep.pop();
  keep.push(`${prefix}_CLIENT_ID=${minted.clientId}`, `${prefix}_CLIENT_SECRET=${minted.clientSecret}`, "");
  writeFileSync(envFile, keep.join("\n"), { mode: 0o600 });
  chmodSync(envFile, 0o600);
  console.log(
    `[create-api-client] "${name}" created for ${email}; ${prefix}_CLIENT_ID and _CLIENT_SECRET written to ${envFile}`,
  );
} finally {
  await context.internalAdapter.deleteSession(session.token);
}
process.exit(0);
