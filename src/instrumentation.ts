// src/instrumentation.ts — Next.js calls `register()` once, at server start, before the server
// accepts requests. Only the Node.js server instance owns `readEnv()`'s checks (database URL,
// secrets, SMTP…); the Edge runtime (proxy.ts) has none of that.
//
// Never at `next build`, which has no secrets: Next's own `registerInstrumentation` returns before
// calling this hook when `NEXT_PHASE` is `phase-production-build`, and the guard below states that
// out loud instead of trusting it — the whole point of this file is a process that stops, and a
// stop during the image build would be a broken deployment instead of a loud one.
import { ZodError } from "zod";
import { readEnv } from "@/platform/env";

const BUILD_PHASE = "phase-production-build";

/**
 * A failed environment check as one log line: `KEY: what is wrong`, joined by `; `, with the
 * values left out — an environment that holds every secret of the deployment must never be printed
 * to explain itself, and a multi-line ZodError dump is exactly what gets rotated away.
 */
export function describeEnvFailure(error: unknown): string {
  if (error instanceof ZodError) {
    return error.issues.map((issue) => `${issue.path.join(".") || "(root)"}: ${issue.message}`).join("; ");
  }
  return error instanceof Error ? error.message : String(error);
}

export function register(): void {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  if (process.env.NEXT_PHASE === BUILD_PHASE) return;
  try {
    readEnv();
  } catch (error) {
    // Throwing from here does not stop Next 16: it prints `Failed to prepare server`, keeps
    // listening, and answers 500 to every request — `/api/health` included — so the healthcheck
    // fails, autoheal restarts the container in a loop, and every probe reprints the error until
    // log rotation has thrown away the first one, the only one worth reading. Worse, the port
    // stays open, so Traefik routes to a process that cannot serve. One line, then out: this is
    // what README's "the process refuses to start if any check fails" promises.
    console.error(`[env] refusing to start: ${describeEnvFailure(error)}`);
    process.exit(1);
  }
}
