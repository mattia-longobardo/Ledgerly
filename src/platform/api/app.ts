import "server-only";
import { Hono } from "hono";
import { accountsApi } from "@/modules/accounts/api";
import { importsApi } from "@/modules/imports/api";
import { transactionsApi } from "@/modules/transactions/api";
import { redactForLog } from "@/platform/auth/logger";
import type { ApiEnv } from "./auth";
import { fail } from "./errors";
import { summaryApi } from "./summary";

/**
 * `/api/v1` (spec §4.2, D5): one entry point, one place that authenticates, one shape of error.
 *
 * Each module exposes its routes in its own `api.ts` and calls **its own services** from them, so
 * nothing here is a second implementation of anything the screen already does. What is *not* here
 * is as deliberate as what is: no administrative surface exists under `/api/v1` at all, and the
 * interface has to keep working as though this whole directory did not exist (plan F8 §1).
 */
export const api = new Hono<ApiEnv>().basePath("/api/v1");

api.route("/", accountsApi);
api.route("/", transactionsApi);
api.route("/", summaryApi);
api.route("/", importsApi);

api.notFound((c) => fail(c, "not_found"));

api.onError((error, c) => {
  // The answer is a code, never the reason: a stack trace names queries, and a query carries the
  // parameters a service was called with (spec §5.4).
  console.error(`[api] ${c.req.method} ${new URL(c.req.url).pathname} failed`, redactForLog(error));
  return fail(c, "server_error");
});
