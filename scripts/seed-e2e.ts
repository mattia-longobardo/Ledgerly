// scripts/seed-e2e.ts — runs after the e2e server has migrated the database.
import { mkdirSync, writeFileSync } from "node:fs";
import { createAuth } from "../src/platform/auth/auth";
import { createInvitation } from "../src/platform/auth/invitations";
import { ensureBucket } from "../src/platform/storage";
import { INVITATIONS, STATE_DIR, USERS } from "../tests/e2e/env";

const auth = createAuth({ withNextCookies: false });
// In order: the first user created becomes the admin.
for (const user of [USERS.owner, USERS.prefs, USERS.reset]) {
  await auth.api.createUser({ body: user });
}
await ensureBucket();
mkdirSync(STATE_DIR, { recursive: true });
for (const { email, role, file } of Object.values(INVITATIONS)) {
  const { token } = await createInvitation({ email, role, invitedBy: null });
  writeFileSync(`${STATE_DIR}/${file}`, token);
}
process.exit(0);
