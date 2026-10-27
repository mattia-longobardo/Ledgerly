import { adminClient, twoFactorClient } from "better-auth/client/plugins";
import { createAuthClient } from "better-auth/react";
import { accessControl, roles } from "./permissions";

// No `twoFactorPage`: the sign-in form reads `twoFactorRedirect` itself and routes with Next.js.
export const authClient = createAuthClient({
  plugins: [adminClient({ ac: accessControl, roles }), twoFactorClient()],
});
