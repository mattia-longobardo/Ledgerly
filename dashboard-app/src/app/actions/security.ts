"use server";

import { revalidatePath } from "next/cache";
import { createToken } from "@/modules/security/application/create-token";
import { InvalidInputError, NotFoundError } from "@/modules/security/application/errors";
import type { TokenRecord } from "@/modules/security/application/ports";
import { revokeToken } from "@/modules/security/application/revoke-token";
import { runForPrincipal } from "@/modules/security/ui/deps";
import { PERMISSIONS, type Permission } from "@/platform/auth/permissions";
import { PermissionDeniedError } from "@/platform/auth/principal";
import { fail, succeed, text, type ActionResult } from "./types";

const SECURITY_PATH = "/settings/security";

/**
 * What the page shows after a successful create.
 *
 * `token` travels in the action's return value and nowhere else — Ruling
 * P8-1. It is deliberately NOT put in `searchParams`: a redirect back with
 * `?token=pat_…` writes the secret into the address bar, the browser history,
 * the server access log and any referrer the next click sends.
 */
export interface CreatedToken {
  token: string;
  record: TokenRecord;
}

/** The one place a thrown error becomes copy the Security page can show. */
function mapError(err: unknown): string {
  if (err instanceof PermissionDeniedError) return "You do not have permission to manage tokens.";
  if (err instanceof NotFoundError) return "That token no longer exists.";
  if (err instanceof InvalidInputError) return err.message;
  return "Something went wrong.";
}

function isPermission(value: string): value is Permission {
  return (PERMISSIONS as readonly string[]).includes(value);
}

/**
 * Mint a token and hand it back exactly once.
 *
 * The `previous` parameter is `useActionState`'s: the form needs the result
 * rendered back into the page, which is the only way P8-1 can be honoured
 * without a URL. The return type is the ordinary `ActionResult<T>` — nothing
 * about that contract had to change to carry the token.
 *
 * Server actions are reached only through the session cookie
 * (`runForPrincipal` → `requirePrincipal`), never with a Bearer header, so
 * Ruling P8-2 holds here by construction; the API's own check is in
 * `src/modules/security/api/routes.ts`.
 */
export async function createTokenAction(
  _previous: ActionResult<CreatedToken> | null,
  formData: FormData,
): Promise<ActionResult<CreatedToken>> {
  const name = text(formData.get("name"));
  if (name === null) return fail("Give the token a name.");

  const scopes = formData.getAll("scopes").filter((s): s is string => typeof s === "string");
  const unknown = scopes.filter((s) => !isPermission(s));
  if (unknown.length > 0) return fail("That is not a permission this app knows.");
  if (scopes.length === 0) return fail("Pick at least one scope.");

  const rawExpiry = text(formData.get("expiresAt"));
  let expiresAt: Date | null = null;
  if (rawExpiry !== null) {
    // A date input gives `YYYY-MM-DD`; take the end of that day in UTC so a
    // token chosen to expire "on the 30th" still works on the 30th.
    expiresAt = new Date(`${rawExpiry}T23:59:59.999Z`);
    if (Number.isNaN(expiresAt.getTime())) return fail("Pick a real calendar day.");
  }

  try {
    const created = await runForPrincipal((deps, principal) =>
      createToken(deps)(principal, { name, scopes: scopes as Permission[], expiresAt }),
    );
    revalidatePath(SECURITY_PATH);
    return succeed(created);
  } catch (err) {
    return fail(mapError(err));
  }
}

export async function revokeTokenAction(formData: FormData): Promise<ActionResult<null>> {
  const id = text(formData.get("id"));
  if (id === null) return fail("Pick a token to revoke.");

  try {
    await runForPrincipal((deps, principal) => revokeToken(deps)(principal, id));
    revalidatePath(SECURITY_PATH);
    return succeed(null);
  } catch (err) {
    return fail(mapError(err));
  }
}
