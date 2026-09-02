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
    return user ? resolvePrincipal(db, { provider: PROVIDER_ID, subject: user.id }) : null;
  },
  now: () => new Date(),
});

export const GET = handle(app);
export const POST = handle(app);
export const PUT = handle(app);
export const PATCH = handle(app);
export const DELETE = handle(app);
