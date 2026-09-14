import "server-only";
import { stat, writeFile } from "node:fs/promises";
import { redactForLog } from "@/platform/auth/logger";
import { readEnv } from "@/platform/env";

/** Every tick is hourly at most, so two hours without one means the scheduler is gone. */
export const HEARTBEAT_MAX_AGE_MS = 2 * 60 * 60 * 1000;

export async function touchHeartbeat(): Promise<void> {
  await writeFile(readEnv().HEARTBEAT_FILE, new Date().toISOString());
}

/** The heartbeat file is absent (ENOENT) before the first tick — expected, not logged. */
function isMissingFile(error: unknown): boolean {
  return error instanceof Error && "code" in error && error.code === "ENOENT";
}

export async function heartbeatAgeMs(): Promise<number | null> {
  try {
    return Date.now() - (await stat(readEnv().HEARTBEAT_FILE)).mtimeMs;
  } catch (error) {
    if (!isMissingFile(error)) console.error("[jobs] heartbeat check failed", redactForLog(error));
    return null;
  }
}
