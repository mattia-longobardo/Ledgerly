import { createHash, timingSafeEqual } from "node:crypto";
import { env } from "@/lib/env";

export type MachineAuthKind = "cron" | "webhook";

export const CRON_SECRET_HEADER = "x-cron-secret";
export const WEBHOOK_SECRET_HEADER = "x-webhook-secret";

const RATE_LIMIT_MAX = 30;
const RATE_LIMIT_WINDOW_MS = 60_000;

interface Bucket {
  count: number;
  resetAt: number;
}

const buckets = new Map<MachineAuthKind, Bucket>();

/**
 * Hash both sides first: equal-length digests mean `timingSafeEqual` can never
 * throw on a length mismatch, and the presented secret's length never leaks
 * through an early return.
 */
export function constantTimeEqual(presented: string, expected: string): boolean {
  const a = createHash("sha256").update(presented, "utf8").digest();
  const b = createHash("sha256").update(expected, "utf8").digest();
  return timingSafeEqual(a, b);
}

function withinRateLimit(kind: MachineAuthKind): boolean {
  const now = Date.now();
  const bucket = buckets.get(kind);
  if (!bucket || now >= bucket.resetAt) {
    buckets.set(kind, { count: 1, resetAt: now + RATE_LIMIT_WINDOW_MS });
    return true;
  }
  bucket.count += 1;
  return bucket.count <= RATE_LIMIT_MAX;
}

export type MachineAuthFailureReason =
  | "missing_header"
  | "bad_secret"
  | "rate_limited";

/** Structured single-line JSON so Loki can select on `event`. Never logs the secret. */
export function logMachineAuthFailure(
  kind: MachineAuthKind,
  reason: MachineAuthFailureReason,
  req?: Request,
): void {
  let path = "unknown";
  if (req) {
    try {
      path = new URL(req.url).pathname;
    } catch {
      path = "unparseable";
    }
  }
  console.warn(
    JSON.stringify({
      ts: new Date().toISOString(),
      level: "warn",
      event: "machine_auth_failure",
      kind,
      reason,
      method: req?.method ?? "unknown",
      path,
    }),
  );
}

/** 404, never 401/403 — a machine endpoint must not confirm it exists. */
function notFound(): Response {
  return new Response("Not Found", {
    status: 404,
    headers: { "content-type": "text/plain; charset=utf-8" },
  });
}

function verify(
  kind: MachineAuthKind,
  header: string,
  expected: string,
  req: Request,
): Response | null {
  if (!withinRateLimit(kind)) {
    logMachineAuthFailure(kind, "rate_limited", req);
    return notFound();
  }
  const presented = req.headers.get(header);
  if (presented === null || presented === "") {
    logMachineAuthFailure(kind, "missing_header", req);
    return notFound();
  }
  if (!constantTimeEqual(presented, expected)) {
    logMachineAuthFailure(kind, "bad_secret", req);
    return notFound();
  }
  return null;
}

/** Returns `null` when the request is authorised, or the 404 response to send back. */
export function verifyCronSecret(req: Request): Response | null {
  return verify("cron", CRON_SECRET_HEADER, env().CRON_SECRET, req);
}

export function verifyWebhookSecret(req: Request): Response | null {
  return verify("webhook", WEBHOOK_SECRET_HEADER, env().WEBHOOK_SECRET, req);
}

/** Test seam: the limiter is process-local state shared across cases. */
export function resetMachineAuthRateLimits(): void {
  buckets.clear();
}
