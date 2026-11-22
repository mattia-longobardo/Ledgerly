// src/app/(auth)/accept-invite.ts — accepting an invitation: the account is created and the invitee is
// signed in (Better Auth's cookie, set by its `nextCookies`). The Server Action and the public route
// `POST /api/invite/{token}/accept` call this one use case.
import "server-only";
import { z } from "zod";
import { getAuth, nameSchema } from "@ledgerly/domain/platform/auth";
import { acceptInvitation, InvitationError } from "@/platform/auth/invitations";

/** Why an invitation was not accepted: the codes the form turns into its sentences. */
export type InviteRefusal = "invalid" | "email_taken" | "weak_password" | "mismatch" | "name";

// Public: the invitee has no session yet, so the input is whatever the caller sent.
const acceptInviteInput = z.object({
  token: z.string(),
  name: nameSchema,
  password: z.string(),
  confirm: z.string(),
});

/**
 * Creates the invitee's account and signs them in. `next` is where the browser goes: the app, or the
 * sign-in page when only the automatic sign-in failed (the account exists, for example rate limited).
 */
export async function acceptInvite(
  token: string,
  input: unknown,
  requestHeaders: Headers,
): Promise<{ error: InviteRefusal } | { next: "/" | "/sign-in" }> {
  const parsed = acceptInviteInput.safeParse(
    typeof input === "object" && input !== null ? { ...input, token } : { token },
  );
  if (!parsed.success) {
    return { error: parsed.error.issues.some((issue) => issue.path[0] === "name") ? "name" : "invalid" };
  }
  const { password, confirm } = parsed.data;
  if (password !== confirm) return { error: "mismatch" };
  let email: string;
  try {
    ({ email } = await acceptInvitation(await getAuth(), parsed.data));
  } catch (error) {
    if (error instanceof InvitationError) return { error: error.reason };
    throw error;
  }
  try {
    await (await getAuth()).api.signInEmail({ body: { email, password }, headers: requestHeaders });
  } catch {
    return { next: "/sign-in" };
  }
  return { next: "/" };
}
