// src/app/(app)/banks/connect/actions.ts — the start of an access to a bank (ux/n1-plugin-bank.md
// §6), bound to the browser's session until `/api/v1` serves it (§6 #4). The other steps are
// `calls.ts`. The return from the bank is `/api/v1/plugins/<id>/callback`.
"use server";

import { notFound } from "next/navigation";
import { getOptionalSession } from "@/platform/auth/session";
import { institutionOf, listPluginConnections } from "@ledgerly/domain/platform/plugins";
import { startAccess } from "@ledgerly/plugin-host";
import { BANK_PLUGIN_ID } from "../plugin";
import { type BankRefusal, bankRefusal } from "./cases";

async function signedIn() {
  const session = await getOptionalSession();
  if (!session) notFound();
  return session;
}

const COUNTRY = /^[A-Z]{2}$/;

export async function startBankAccessAction(
  country: string,
  name: string,
): Promise<{ ok: true; url: string } | BankRefusal> {
  const session = await signedIn();
  if (!COUNTRY.test(country) || name.length < 1 || name.length > 200) return { ok: false, error: "failed" };
  try {
    const { url } = await startAccess(session.ctx, {
      pluginId: BANK_PLUGIN_ID,
      sessionId: session.sessionId,
      institution: { name, country },
    });
    return { ok: true, url };
  } catch (error) {
    return bankRefusal(error);
  }
}

/** "Renew access" (§6.7): the same start, for the bank of a connection the person already has. */
export async function renewBankAccessAction(
  connectionId: string,
): Promise<{ ok: true; url: string } | BankRefusal> {
  const session = await signedIn();
  try {
    const connection = (await listPluginConnections(session.ctx, BANK_PLUGIN_ID)).find(
      (one) => one.id === connectionId,
    );
    if (!connection) return { ok: false, error: "not_found" };
    const { url } = await startAccess(session.ctx, {
      pluginId: BANK_PLUGIN_ID,
      sessionId: session.sessionId,
      institution: institutionOf(connection.instanceKey),
    });
    return { ok: true, url };
  } catch (error) {
    return bankRefusal(error);
  }
}
