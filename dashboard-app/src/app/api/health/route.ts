import { sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { HEARTBEAT_MAX_AGE_MS, heartbeatAgeMs } from "@/lib/jobs/heartbeat";

export const dynamic = "force-dynamic";

/**
 * Compose healthcheck target. Public by construction (the proxy exempts it),
 * so it must never leak configuration — only liveness.
 *
 * The heartbeat is only allowed to fail the check once the process has been up
 * longer than the heartbeat window. The sweep runs hourly, so a freshly booted
 * container has no heartbeat file yet; failing on that would keep the container
 * permanently unhealthy and put autoheal into a restart loop.
 */
export async function GET() {
  let dbUp = true;
  try {
    await db.execute(sql`SELECT 1`);
  } catch {
    dbUp = false;
  }

  const ageMs = await heartbeatAgeMs();
  const uptimeMs = process.uptime() * 1000;
  const heartbeatTrusted = uptimeMs > HEARTBEAT_MAX_AGE_MS;
  const heartbeatStale = ageMs === null || ageMs > HEARTBEAT_MAX_AGE_MS;
  const heartbeatFails = heartbeatTrusted && heartbeatStale;

  const healthy = dbUp && !heartbeatFails;

  return Response.json(
    {
      status: healthy ? "ok" : "degraded",
      db: dbUp ? "up" : "down",
      heartbeat: ageMs === null ? "absent" : heartbeatStale ? "stale" : "fresh",
      heartbeatAgeSeconds: ageMs === null ? null : Math.round(ageMs / 1000),
    },
    { status: healthy ? 200 : 503 },
  );
}
