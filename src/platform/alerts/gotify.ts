import "server-only";
import { redactForLog } from "@/platform/auth/logger";
import { readEnv } from "@/platform/env";

/**
 * Admin alerts through Gotify (spec §9.4, §10.4): the homelab's own push channel, for the things
 * only an administrator can act on — a job that failed.
 *
 * Optional by design. Without `GOTIFY_URL` and `GOTIFY_TOKEN` this does nothing and says so
 * quietly: an instance that has not set it up is configured, not broken, and a warning on every
 * tick would train whoever reads the log to ignore it.
 *
 * It never throws. An alert that fails must not turn a job that already failed into a second,
 * different failure, nor a successful run into a failed one.
 */

export const GOTIFY_TIMEOUT_MS = 5_000;

export type AlertOutcome = "sent" | "off" | "failed";

export interface Alert {
  title: string;
  message: string;
  /** Gotify's own scale: 0 silent, 5 normal, 8 loud. A failed job is worth a notification. */
  priority?: number;
}

export async function alertAdmins(
  alert: Alert,
  deps: { fetch: typeof fetch } = { fetch: globalThis.fetch },
): Promise<AlertOutcome> {
  const env = readEnv();
  if (!env.GOTIFY_URL || !env.GOTIFY_TOKEN) return "off";
  try {
    const response = await deps.fetch(new URL("/message", env.GOTIFY_URL).toString(), {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Gotify-Key": env.GOTIFY_TOKEN },
      body: JSON.stringify({
        title: alert.title,
        message: alert.message,
        priority: alert.priority ?? 5,
      }),
      signal: AbortSignal.timeout(GOTIFY_TIMEOUT_MS),
    });
    if (response.ok) return "sent";
    // The status only: the body of a refused request can quote the request, and the key is in it.
    console.error(`[alerts] Gotify refused the message (${response.status})`);
    return "failed";
  } catch (error) {
    console.error("[alerts] could not reach Gotify", redactForLog(error));
    return "failed";
  }
}
