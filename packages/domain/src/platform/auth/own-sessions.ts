// The person's own sign-ins on the web, as `/api/v1/sessions` reads and ends them: a session is a
// row (spec §5.1), so ending one is deleting it, by id AND owner. The web ends its own through Better
// Auth, inside the session that asks.
import { and, eq } from "drizzle-orm";
import type { Ctx } from "../context";
import { getDb } from "../db/client";
import { sessions } from "./schema";

/** Ends one of the person's sessions; another person's id ends nothing. True when one ended. */
export async function endOwnSession(ctx: Pick<Ctx, "userId">, sessionId: string): Promise<boolean> {
  const ended = await getDb()
    .delete(sessions)
    .where(and(eq(sessions.id, sessionId), eq(sessions.userId, ctx.userId)))
    .returning({ id: sessions.id });
  return ended.length > 0;
}
