// scripts/seed-e2e.ts — runs after the e2e server has migrated the database.
import { mkdirSync, writeFileSync } from "node:fs";
import { createAuth } from "../src/platform/auth/auth";
import { createInvitation } from "../src/platform/auth/invitations";
import { ensureBucket } from "../src/platform/storage";
import { BASE_URL, INVITATIONS, SESSIONS, STATE_DIR, USERS, sessionState } from "../tests/e2e/env";

const auth = createAuth({ withNextCookies: false });
// In order: the first user created becomes the admin.
for (const user of [USERS.owner, USERS.prefs, USERS.reset, USERS.accounts]) {
  await auth.api.createUser({ body: user });
}
await ensureBucket();
mkdirSync(STATE_DIR, { recursive: true });
for (const { email, role, file } of Object.values(INVITATIONS)) {
  const { token } = await createInvitation({ email, role, invitedBy: null });
  writeFileSync(`${STATE_DIR}/${file}`, token);
}

/**
 * A Playwright storage state holding one user's session cookie. Better Auth is called here as a
 * library rather than over HTTP, so setting these sessions up costs none of the run's rate-limited
 * sign-ins (tests/e2e/env.ts) and a spec that only needs to be signed in spends none either.
 */
async function writeSessionState(name: keyof typeof SESSIONS): Promise<void> {
  const user = USERS[SESSIONS[name].user];
  const { headers } = await auth.api.signInEmail({
    body: { email: user.email, password: user.password },
    returnHeaders: true,
  });
  const cookies = headers
    .getSetCookie()
    .map((header) => header.split(";")[0].split("="))
    .filter(([cookieName]) => cookieName.includes("session_token"))
    .map(([cookieName, ...value]) => ({
      name: cookieName,
      value: value.join("="),
      domain: new URL(BASE_URL).hostname,
      path: "/",
      expires: -1,
      httpOnly: true,
      secure: false,
      sameSite: "Lax" as const,
    }));
  if (cookies.length === 0) throw new Error(`No session cookie for ${user.email}`);
  writeFileSync(sessionState(name), JSON.stringify({ cookies, origins: [] }, null, 2));
}

for (const name of Object.keys(SESSIONS) as (keyof typeof SESSIONS)[]) {
  await writeSessionState(name);
}

process.exit(0);
