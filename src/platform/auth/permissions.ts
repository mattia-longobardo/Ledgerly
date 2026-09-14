// No `server-only`: the admin client plugin needs the same roles for its permission checks.
import { createAccessControl } from "better-auth/plugins/access";
import { defaultStatements } from "better-auth/plugins/admin/access";

export const accessControl = createAccessControl(defaultStatements);

/**
 * An admin lists, re-roles, bans and removes users and revokes their sessions (spec §7.10).
 * Creating users is not granted: accounts come from invitations and the create-admin script, which
 * call `auth.api.createUser` server-side, without a session, so no permission applies. Impersonation
 * and setting another user's password, email or profile directly are not granted either: a password
 * reset goes through the emailed link.
 */
export const roles = {
  admin: accessControl.newRole({
    user: ["list", "set-role", "ban", "delete"],
    session: ["list", "revoke"],
  }),
  user: accessControl.newRole({ user: [], session: [] }),
};
