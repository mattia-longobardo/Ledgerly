// src/app/(app)/banks/connect/actions.ts — the start of an access to a bank (ux/n1-plugin-bank.md
// §6), bound to the browser's session; `/api/v1` serves the same steps of `cases.ts`. The other steps
// are `calls.ts`. The return from the bank is `/api/v1/plugins/<id>/callback`.
"use server";

import { notFound } from "next/navigation";
import { getOptionalSession } from "@/platform/auth/session";
import { type BankRefusal, renewBankAccess, startBankAccess } from "./cases";

async function signedIn() {
  const session = await getOptionalSession();
  if (!session) notFound();
  return session;
}

export async function startBankAccessAction(
  country: string,
  name: string,
): Promise<{ ok: true; url: string } | BankRefusal> {
  const session = await signedIn();
  return startBankAccess(session.ctx, session.sessionId, { country, name });
}

/** "Renew access" (§6.7): the same start, for the bank of a connection the person already has. */
export async function renewBankAccessAction(
  connectionId: string,
): Promise<{ ok: true; url: string } | BankRefusal> {
  const session = await signedIn();
  return renewBankAccess(session.ctx, session.sessionId, connectionId);
}
