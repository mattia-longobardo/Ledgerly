import "server-only";
import { stat, writeFile } from "node:fs/promises";
import { readEnv } from "@/platform/env";

/** Every tick is hourly at most, so two hours without one means the scheduler is gone. */
export const HEARTBEAT_MAX_AGE_MS = 2 * 60 * 60 * 1000;

export async function touchHeartbeat(): Promise<void> {
  await writeFile(readEnv().HEARTBEAT_FILE, new Date().toISOString());
}

export async function heartbeatAgeMs(): Promise<number | null> {
  try {
    return Date.now() - (await stat(readEnv().HEARTBEAT_FILE)).mtimeMs;
  } catch {
    return null;
  }
}
