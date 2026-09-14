// src/instrumentation.ts — Next.js calls `register()` once, at server start (never at `next
// build`), before the server accepts requests. Only the Node.js server instance owns `readEnv()`'s
// checks (database URL, secrets, SMTP…); the Edge runtime (proxy.ts) has none of that.
import { readEnv } from "@/platform/env";

export function register(): void {
  if (process.env.NEXT_RUNTIME === "nodejs") readEnv();
}
