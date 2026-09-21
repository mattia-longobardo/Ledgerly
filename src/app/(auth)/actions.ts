"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { z } from "zod";
import { getAuth } from "@/platform/auth/auth";
import { acceptInvitation, InvitationError } from "@/platform/auth/invitations";
import { nameSchema } from "@/platform/auth/name-policy";

// Public: the invitee has no session yet, so the arguments are whatever the caller sent.
const acceptInviteInput = z.object({
  token: z.string(),
  name: nameSchema,
  password: z.string(),
  confirm: z.string(),
});

export async function acceptInviteAction(
  token: string,
  input: { name: string; password: string; confirm: string },
): Promise<{ error: "invalid" | "email_taken" | "weak_password" | "mismatch" | "name" } | undefined> {
  const parsed = acceptInviteInput.safeParse({ ...input, token });
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
    await (await getAuth()).api.signInEmail({ body: { email, password }, headers: await headers() });
  } catch {
    // The account exists; only the automatic sign-in failed (for example, rate limited).
    redirect("/sign-in");
  }
  redirect("/");
}
