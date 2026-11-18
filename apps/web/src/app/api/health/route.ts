import { sql } from "drizzle-orm";
import { redactForLog } from "@ledgerly/domain/platform/auth";
import { getDb } from "@ledgerly/domain/platform/db";
import { lastBeatAt } from "@ledgerly/domain/platform/jobs";
import { keepManifestsFresh } from "@ledgerly/plugin-host";

export const dynamic = "force-dynamic";

/** The worker beats every 30 seconds (`apps/worker`): two minutes without a beat is a stale one. */
const BEAT_MAX_AGE_MS = 2 * 60 * 1000;

/**
 * Compose healthcheck target; public, so it exposes liveness only. The worker's heartbeat is said,
 * never counted: the web is healthy with its database, whatever the scheduler does (rewrite plan R1).
 */
export async function GET() {
  let dbUp = true;
  try {
    await getDb().execute(sql`SELECT 1`);
  } catch (error) {
    dbUp = false;
    console.error("[health] database check failed", redactForLog(error));
  }
  // The health check is the one caller that comes round from the start of the process on: it is
  // what keeps the manifests of the plugins read. Not awaited, and no part of the answer.
  if (dbUp) keepManifestsFresh();
  const beatAt = dbUp ? await lastBeatAt().catch(() => null) : null;
  const heartbeat =
    beatAt === null ? "absent" : Date.now() - beatAt.getTime() > BEAT_MAX_AGE_MS ? "stale" : "fresh";
  return Response.json(
    {
      status: dbUp ? "ok" : "degraded",
      db: dbUp ? "up" : "down",
      heartbeat,
    },
    { status: dbUp ? 200 : 503 },
  );
}
