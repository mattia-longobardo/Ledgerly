// src/app/(app)/banks/connect/actions.ts — the procedure "Connect a bank" (ux/n1-plugin-bank.md
// §6). The steps are the use cases of `cases.ts`, which `/api/v1` calls too; the start of an access
// is the browser's, bound to its session. The return from the bank is `/api/v1/plugins/<id>/callback`.
"use server";

import { notFound } from "next/navigation";
import { getOptionalSession } from "@/platform/auth/session";
import { institutionOf, listPluginConnections } from "@ledgerly/domain/platform/plugins";
import { type AccountDecision, startAccess } from "@ledgerly/plugin-host";
import { BANK_PLUGIN_ID } from "../plugin";
import { requestPresence } from "../presence";
import {
  type BankChoice,
  type BankRefusal,
  bankRefusal,
  cancelBankConnection,
  importBankAccounts,
  listBanks,
  retryBankReading,
} from "./cases";

export type { BankChoice } from "./cases";

async function signedIn() {
  const session = await getOptionalSession();
  if (!session) notFound();
  return session;
}

const COUNTRY = /^[A-Z]{2}$/;

export async function listBanksAction(
  country: string,
): Promise<{ ok: true; banks: BankChoice[] } | BankRefusal> {
  return listBanks((await signedIn()).ctx, country);
}

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

/**
 * Applies the choice of the accounts and reads the bank at once, in the same request (§6.6): the
 * history older than 90 days is only there in the first minutes after the access. A reading that
 * fails does not undo the choice — the outcome page says so and offers to try again.
 */
export async function importBankAccountsAction(
  connectionId: string,
  decisions: AccountDecision[],
): Promise<{ ok: true } | BankRefusal> {
  return importBankAccounts((await signedIn()).ctx, connectionId, decisions, await requestPresence());
}

export async function retryBankReadingAction(connectionId: string): Promise<{ ok: true } | BankRefusal> {
  return retryBankReading((await signedIn()).ctx, connectionId, await requestPresence());
}

export async function cancelBankConnectionAction(connectionId: string): Promise<{ ok: true } | BankRefusal> {
  return cancelBankConnection((await signedIn()).ctx, connectionId);
}
