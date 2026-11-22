"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { acceptInvite, type InviteRefusal } from "./accept-invite";

export async function acceptInviteAction(
  token: string,
  input: { name: string; password: string; confirm: string },
): Promise<{ error: InviteRefusal } | undefined> {
  const outcome = await acceptInvite(token, input, await headers());
  if ("error" in outcome) return outcome;
  redirect(outcome.next);
}
