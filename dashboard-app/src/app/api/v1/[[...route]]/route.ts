import { handle } from "hono/vercel";
import { db } from "@/lib/db";
import { PROVIDER_ID } from "@/auth";
import { getUserOrNull } from "@/lib/auth/require-user";
import { resolvePrincipal } from "@/platform/auth/principal";
import { createApiApp } from "@/platform/http/app";

export const dynamic = "force-dynamic";

const app = createApiApp({
  db,
  async authenticate() {
    const user = await getUserOrNull();
    if (!user) return null;
    const principal = await resolvePrincipal(db, { provider: PROVIDER_ID, subject: user.id });
    // The session cookie is the only way in today; Phase 8's tokens will report
    // "token" here and so skip the CSRF header requirement.
    return principal ? { principal, method: "session" as const } : null;
  },
  now: () => new Date(),
});

export const GET = handle(app);
export const POST = handle(app);
export const PUT = handle(app);
export const PATCH = handle(app);
export const DELETE = handle(app);
