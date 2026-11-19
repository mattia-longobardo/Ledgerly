// The calls of Admin › Users to `/api/v1/people` (rewrite plan R3): each answers `{ ok, outcome }` or
// the use case's refusal code, as the Server Actions they replace did.
import { SETTINGS } from "@ledgerly/api-contract";
import { ApiError, call } from "@ledgerly/api-client";
import { invalidate } from "@ledgerly/ui/data";
import type { AdminErrorCode, InviteOutcome, ResetOutcome } from "./admin";

type AdminResult<T> = { ok: true; outcome: T } | { ok: false; error: AdminErrorCode };

const { people } = SETTINGS;

const ADMIN_CODES: readonly AdminErrorCode[] = [
  "forbidden",
  "not_found",
  "invalid",
  "email_taken",
  "last_admin",
  "self",
];

const isAdminCode = (code: string): code is AdminErrorCode => ADMIN_CODES.some((known) => known === code);

/** The use case's code: the route names it as the refusal's reason, or as the refusal itself. */
function refused(error: unknown): { ok: false; error: AdminErrorCode } {
  if (error instanceof ApiError) {
    const code = error.reason ?? error.code;
    if (isAdminCode(code)) return { ok: false, error: code };
  }
  throw error;
}

/** Runs a write of the people, and reads the list again once it is done. */
async function changing<T = undefined>(work: () => Promise<T>): Promise<AdminResult<T>> {
  try {
    const outcome = await work();
    invalidate(people.listPeople);
    return { ok: true, outcome };
  } catch (error) {
    return refused(error);
  }
}

export function invitePersonAction(
  email: string,
  role: "admin" | "user",
): Promise<AdminResult<InviteOutcome>> {
  return changing(async () => (await call(people.invitePerson, { body: { email, role } })).outcome);
}

export function revokeInvitationAction(id: string): Promise<AdminResult<undefined>> {
  return changing(async () => {
    await call(people.revokeInvitation, { params: { id } });
    return undefined;
  });
}

export function setPersonRoleAction(userId: string, role: "admin" | "user"): Promise<AdminResult<undefined>> {
  return changing(async () => {
    await call(people.updatePerson, { params: { id: userId }, body: { role } });
    return undefined;
  });
}

export function setPersonBlockedAction(userId: string, blocked: boolean): Promise<AdminResult<undefined>> {
  return changing(async () => {
    await call(people.updatePerson, { params: { id: userId }, body: { blocked } });
    return undefined;
  });
}

export function sendPersonResetAction(userId: string): Promise<AdminResult<ResetOutcome>> {
  return changing(async () => (await call(people.sendPersonReset, { params: { id: userId } })).outcome);
}

export function resetPersonTwoFactorAction(userId: string): Promise<AdminResult<undefined>> {
  return changing(async () => {
    await call(people.resetPersonTwoFactor, { params: { id: userId } });
    return undefined;
  });
}

/** Deletes the person and everything they own: the confirmation is the dialog's job, not this. */
export function removePersonAction(userId: string): Promise<AdminResult<undefined>> {
  return changing(async () => {
    await call(people.removePerson, { params: { id: userId } });
    return undefined;
  });
}
