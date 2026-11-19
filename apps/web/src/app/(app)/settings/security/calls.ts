// The calls of Settings › Security to `/api/v1` (rewrite plan R3): each answers `{ ok }` or a
// catalogued error key, as the Server Actions they replace did. Signing the other sessions out stays
// a Server Action (`tools/contract.test.ts`, EXCLUDED: «the other sessions» are the cookie's).
import { SETTINGS } from "@ledgerly/api-contract";
import { ApiError, call } from "@ledgerly/api-client";
import { invalidate } from "@ledgerly/ui/data";

export { revokeOtherSessionsAction } from "@/modules/users/actions";

type CallResult = { ok: true } | { ok: false; error: string };

const { security } = SETTINGS;

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
