import "server-only";
import { z } from "zod";
import { ADDONS } from "@ledgerly/api-contract";
import { API_SCOPES } from "@ledgerly/domain/platform/auth/client";
import type { Ctx } from "@ledgerly/domain/platform/context";
import type { Preferences } from "./signed-in";

// The preferences are the server's own row, already read by its schema: here only their shape is
// held, so a value saved before a rule changed never takes a page down.
const signedInSchema = z.object({
  user: z.object({ id: z.string(), role: z.string().nullable(), email: z.string() }),
  preferences: z.custom<Preferences>((value) => typeof value === "object" && value !== null),
  ctx: z.custom<Ctx>((value) => typeof value === "object" && value !== null),
  addons: z.array(z.enum(ADDONS)),
  onboarding: z.boolean(),
  setupPending: z.boolean(),
});

/** What `/api/web/session` answers for a signed-in request (`app/api/web/session/route.ts`). */
type RemoteSignedIn = z.infer<typeof signedInSchema>;

const consentSchema = z.object({
  clientName: z.string(),
  scopes: z.array(z.enum(API_SCOPES)),
  offline: z.boolean(),
  hosts: z.array(z.string()),
  verified: z.boolean(),
});

/** What the consent screen shows (`/api/web/consent`); `null` is an invalid request. */
export type ConsentView = z.infer<typeof consentSchema>;

/**
 * The address of the server's process (rewrite plan R4). `LEDGERLY_API_URL` when the web runs in a
 * container of its own; otherwise the same process, on its own port.
 */
export function apiOrigin(): string {
  return process.env.LEDGERLY_API_URL ?? `http://127.0.0.1:${process.env.PORT ?? "3000"}`;
}

/**
 * A GET to the server's process with the cookie of the request: the web's server reads nothing
 * by itself. Only the cookie goes, never the other headers of the browser. A server that does not
 * answer is an error, never a signed-out visitor.
 */
async function getFromServer<T>(path: string, requestHeaders: Headers, schema: z.ZodType<T>): Promise<T> {
  const cookie = requestHeaders.get("cookie");
  const response = await fetch(`${apiOrigin()}${path}`, {
    headers: cookie ? { cookie } : {},
    cache: "no-store",
    redirect: "manual",
  });
  if (!response.ok) throw new Error(`server answered ${response.status} to ${path.split("?")[0]}`);
  return schema.parse(await response.json());
}

/** The signed-in user of the request's cookie, or null (`/api/web/session`). */
export function fetchSignedIn(requestHeaders: Headers): Promise<RemoteSignedIn | null> {
  return getFromServer("/api/web/session", requestHeaders, signedInSchema.nullable());
}

/** The consent screen of a signed query string, or null for one the server did not sign. */
export function fetchConsent(signedQuery: string, requestHeaders: Headers): Promise<ConsentView | null> {
  return getFromServer(`/api/web/consent?${signedQuery}`, requestHeaders, consentSchema.nullable());
}
