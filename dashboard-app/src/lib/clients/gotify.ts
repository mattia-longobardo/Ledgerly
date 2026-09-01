import { env } from "@/lib/env";
import type { JobName } from "@/lib/contracts";
import { httpRequest, errorMessage } from "./http";

export interface GotifyMessage {
  title: string;
  message: string;
  priority: number;
}

const TIMEOUT_MS = 5000;

/**
 * Best-effort by construction: an alerting outage must never fail the job that
 * was trying to report. Never throws.
 */
export async function notify(msg: GotifyMessage): Promise<boolean> {
  try {
    const { GOTIFY_URL, GOTIFY_TOKEN } = env();
    if (!GOTIFY_URL || !GOTIFY_TOKEN) return false;
    await httpRequest("gotify", `${GOTIFY_URL.replace(/\/+$/, "")}/message`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "X-Gotify-Key": GOTIFY_TOKEN,
      },
      body: JSON.stringify({
        title: msg.title,
        message: msg.message,
        priority: msg.priority,
      }),
      timeoutMs: TIMEOUT_MS,
    });
    return true;
  } catch (err) {
    console.warn(`[gotify] notification dropped: ${errorMessage(err)}`);
    return false;
  }
}

function appUrl(path: string): string {
  try {
    return `${env().AUTH_URL.replace(/\/+$/, "")}${path}`;
  } catch {
    return path;
  }
}

export interface JobFailureAlert {
  job: JobName;
  error: string;
  monthKey?: string;
  attempts?: number;
}

export async function alertJobFailure(alert: JobFailureAlert): Promise<boolean> {
  const scope = alert.monthKey ? ` (${alert.monthKey})` : "";
  const attempts = alert.attempts ? `\nattempts: ${alert.attempts}` : "";
  return notify({
    title: `Finance Dashboard: ${alert.job} failed${scope}`,
    message: `${alert.error}${attempts}`,
    priority: 8,
  });
}

export interface RetrySuccessAlert {
  job: JobName;
  attempts: number;
  monthKey?: string;
  detail?: string;
}

export async function alertSuccessAfterRetry(alert: RetrySuccessAlert): Promise<boolean> {
  const scope = alert.monthKey ? ` (${alert.monthKey})` : "";
  return notify({
    title: `Finance Dashboard: ${alert.job} recovered${scope}`,
    message: `Succeeded after ${alert.attempts} attempts.${alert.detail ? `\n${alert.detail}` : ""}`,
    priority: 4,
  });
}

export interface PayslipPendingAlert {
  payslipId: number | string;
  month?: string;
  title?: string;
  /** Overrides the derived deep link when the caller knows a better route. */
  link?: string;
}

export async function alertPayslipPending(alert: PayslipPendingAlert): Promise<boolean> {
  const link = alert.link ?? appUrl(`/payroll/verify/${alert.payslipId}`);
  const scope = alert.month ? ` — ${alert.month}` : "";
  return notify({
    title: `Payslip awaiting verification${scope}`,
    message: `${alert.title ?? `Payslip ${alert.payslipId}`}\n${link}`,
    priority: 5,
  });
}
