// The calls of Settings › Security (rewrite plan R3): each answers `{ ok }` or a catalogued error
// key, as the Server Actions they replace did. They go to `/api/v1`; signing the other sessions out
// goes to Better Auth's own endpoint under `/api/auth`, which knows the session of the cookie.
import { security } from "@ledgerly/api-contract/settings";
import { ApiError, call } from "@ledgerly/api-client";
import { invalidate } from "@ledgerly/ui/data";
import { authClient } from "@/platform/auth/client";

type CallResult = { ok: true } | { ok: false; error: string };

/** A refusal the screen names; anything else is thrown. */
function refused(error: unknown, codes: readonly string[]): { ok: false; error: string } {
  if (error instanceof ApiError && codes.includes(error.code)) return { ok: false, error: error.code };
  throw error;
}

/** Signs one of the person's sessions out; one already gone answers as done. */
export async function revokeSessionAction(sessionId: string): Promise<CallResult> {
  try {
    await call(security.revokeSession, { params: { id: sessionId } });
  } catch (error) {
    if (error instanceof ApiError && error.code === "invalid") return { ok: false, error: "failed" };
    throw error;
  }
  invalidate(security.listSessions);
  return { ok: true };
}

/** Deletes one of the person's own clients; its tokens stop working at once. */
export async function deleteApiClientAction(clientId: string): Promise<CallResult> {
  try {
    await call(security.deleteApiClient, { params: { clientId } });
  } catch (error) {
    return refused(error, ["invalid", "not_found"]);
  }
  invalidate(security.listApiClients);
  return { ok: true };
}

/** Takes back a consent: the app's refresh tokens go, and the next authorize asks again. */
export async function revokeConnectedAppAction(clientId: string): Promise<CallResult> {
  try {
    await call(security.revokeConnectedApp, { params: { clientId } });
  } catch (error) {
    return refused(error, ["invalid", "not_found"]);
  }
  invalidate(security.listConnectedApps);
  return { ok: true };
}

/** Signs out every session of the person but the one of this browser. */
export async function revokeOtherSessionsAction(): Promise<CallResult> {
  const { error } = await authClient.revokeOtherSessions().catch((failure: unknown) => ({ error: failure }));
  if (error) return { ok: false, error: "failed" };
  invalidate(security.listSessions);
  return { ok: true };
}
