import { sql } from "drizzle-orm";
import { redactForLog } from "@/platform/auth/logger";
import { getDb } from "@/platform/db/client";
import { HEARTBEAT_MAX_AGE_MS, heartbeatAgeMs } from "@/platform/jobs/heartbeat";

export const dynamic = "force-dynamic";

/**
 * Compose healthcheck target; public, so it exposes liveness only. The heartbeat counts only
 * after the process has been up longer than its window, otherwise a fresh container would be
 * unhealthy before its first tick and autoheal would restart it in a loop.
 */
export async function GET() {
  let dbUp = true;
  try {
    await getDb().execute(sql`SELECT 1`);
  } catch (error) {
    dbUp = false;
    console.error("[health] database check failed", redactForLog(error));
  }
  const age = await heartbeatAgeMs();
  const heartbeatStale = age === null || age > HEARTBEAT_MAX_AGE_MS;
  const healthy = dbUp && !(process.uptime() * 1000 > HEARTBEAT_MAX_AGE_MS && heartbeatStale);
  return Response.json(
    {
      status: healthy ? "ok" : "degraded",
      db: dbUp ? "up" : "down",
      heartbeat: age === null ? "absent" : heartbeatStale ? "stale" : "fresh",
    },
    { status: healthy ? 200 : 503 },
  );
}
