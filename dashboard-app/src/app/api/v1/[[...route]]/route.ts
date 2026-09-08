import { handle } from "hono/vercel";
import { db } from "@/lib/db";
import { PROVIDER_ID } from "@/auth";
import { getUserOrNull } from "@/lib/auth/require-user";
import { createApiApp } from "@/platform/http/app";
import { createAuthenticate } from "@/platform/http/authenticate";
import { ensureProvidersRegistered } from "@/platform/integrations/register-all";

export const dynamic = "force-dynamic";

ensureProvidersRegistered();

const app = createApiApp({
  db,
  // The Bearer branch runs first and, when a token is present, decides the
  // request on its own; the cookie path below is unchanged. See
  // `createAuthenticate` for why there is no fallback between them.
  authenticate: createAuthenticate({
    db,
    sessionSubject: async () => (await getUserOrNull())?.id ?? null,
    provider: PROVIDER_ID,
    now: () => new Date(),
  }),
  now: () => new Date(),
});

export const GET = handle(app);
export const POST = handle(app);
export const PUT = handle(app);
export const PATCH = handle(app);
export const DELETE = handle(app);
