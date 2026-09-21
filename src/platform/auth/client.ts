import { adminClient } from "better-auth/client/plugins";
import { createAuthClient } from "better-auth/react";
import { accessControl, roles } from "./permissions";

export const authClient = createAuthClient({ plugins: [adminClient({ ac: accessControl, roles })] });
