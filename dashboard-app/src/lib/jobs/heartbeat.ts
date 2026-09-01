/**
 * Liveness file for the compose healthcheck — the wallet-manager autoheal
 * pattern (PLAN §5): every sweep touches it, and the healthcheck fails once it
 * is older than 2 h so autoheal restarts a container whose scheduler has gone
 * quiet.
 *
 * Every operation is best-effort: the container runs `read_only: true` with a
 * tmpfs for /tmp (PLAN §7), and a filesystem that refuses the write must
 * degrade the healthcheck, never crash the job that was reporting health.
 */

import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname } from "node:path";

export const HEARTBEAT_MAX_AGE_MS = 2 * 60 * 60 * 1000;

const DEFAULT_HEARTBEAT_PATH = "/tmp/dashboard-sweep-heartbeat";

/**
 * Read straight from `process.env` rather than through `env()`: the heartbeat
 * has to work in contexts where the full environment contract may not be
 * satisfiable (a degraded container still has to answer its healthcheck).
 */
export function heartbeatPath(): string {
  const configured = process.env.HEARTBEAT_FILE?.trim();
  return configured && configured.length > 0 ? configured : DEFAULT_HEARTBEAT_PATH;
}

function warn(action: string, err: unknown): void {
  console.warn(
    JSON.stringify({
      ts: new Date().toISOString(),
      level: "warn",
      event: "heartbeat_io_failed",
      action,
      path: heartbeatPath(),
      error: err instanceof Error ? err.message : String(err),
    }),
  );
}

/** Returns whether the touch landed; a read-only FS is a `false`, not a throw. */
export async function touchHeartbeat(now: Date = new Date()): Promise<boolean> {
  const path = heartbeatPath();
  try {
    await mkdir(dirname(path), { recursive: true });
  } catch {
    // A missing parent is only fatal if the write below also fails, and that
    // path already reports. Creating it is opportunistic.
  }
  try {
    await writeFile(path, `${now.toISOString()}\n`, "utf8");
    return true;
  } catch (err) {
    warn("write", err);
    return false;
  }
}

/** `null` when the file is absent, unreadable, or does not hold a timestamp. */
export async function readHeartbeat(): Promise<Date | null> {
  try {
    const raw = (await readFile(heartbeatPath(), "utf8")).trim();
    if (!raw) return null;
    const parsed = new Date(raw);
    return Number.isNaN(parsed.getTime()) ? null : parsed;
  } catch (err) {
    // A never-touched heartbeat is the normal state right after a restart.
    if ((err as NodeJS.ErrnoException)?.code !== "ENOENT") warn("read", err);
    return null;
  }
}

export async function heartbeatAgeMs(now: Date = new Date()): Promise<number | null> {
  const at = await readHeartbeat();
  return at === null ? null : now.getTime() - at.getTime();
}

/** Never touched counts as stale — a scheduler that never ran is not healthy. */
export async function isHeartbeatStale(
  maxAgeMs: number = HEARTBEAT_MAX_AGE_MS,
  now: Date = new Date(),
): Promise<boolean> {
  const age = await heartbeatAgeMs(now);
  return age === null || age > maxAgeMs;
}
