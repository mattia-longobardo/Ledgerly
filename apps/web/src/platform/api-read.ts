// What a page still asks before it is drawn (rewrite plan R3, R4): its HTTP 404 and its title. The web
// holds no database and no domain: it asks `/api/v1` over HTTP, as the person of this request, with
// their session cookie. Everything the page shows comes from the screen's own reads, in the browser.
import "server-only";
import { headers } from "next/headers";
import type { RouteContract } from "@ledgerly/api-contract/core";
import { ApiError, call, type RouteInput, type RouteOutput } from "@ledgerly/api-client";
import { apiOrigin } from "./auth/remote";

/**
 * One read of `/api/v1` for this request's person; `null` when the API finds nothing to read — a `404`,
 * or a `400` for a path parameter that cannot name anything (an id that is not one). Any other refusal throws.
 */
export async function apiRead<R extends RouteContract>(
  route: R,
  input: RouteInput<R>,
): Promise<RouteOutput<R> | null> {
  const cookie = (await headers()).get("cookie") ?? "";
  try {
    return await call(route, input, { origin: apiOrigin(), headers: { cookie } });
  } catch (error) {
    if (error instanceof ApiError && (error.status === 404 || error.status === 400)) return null;
    throw error;
  }
}
