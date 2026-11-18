import { sql } from "drizzle-orm";
import { redactForLog } from "@ledgerly/domain/platform/auth";
import { getDb } from "@ledgerly/domain/platform/db";
import { HEARTBEAT_MAX_AGE_MS, heartbeatAgeMs } from "@/platform/jobs/heartbeat";
import { keepManifestsFresh } from "@ledgerly/plugin-host";

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
  // The health check is the one caller that comes round from the start of the process on: it is
  // what keeps the manifests of the plugins read. Not awaited, and no part of the answer.
  if (dbUp) keepManifestsFresh();
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
