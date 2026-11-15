// src/app/(app)/banks/connect/actions.ts — the procedure "Connect a bank" (ux/n1-plugin-bank.md
// §6): the banks of a country, the start of an access, the choice of the accounts with the first
// reading, and the way out. Thin wrappers around `platform/plugins`; the return from the bank is
// the route `/api/v1/plugins/<id>/callback`.
"use server";

import { notFound } from "next/navigation";
import { revalidatePath } from "next/cache";
import { redactForLog } from "@/platform/auth/logger";
import { getOptionalSession } from "@/platform/auth/session";
import { runAfterSync } from "@/platform/jobs/after-sync";
import { listPluginConnections } from "@/platform/plugins/queries";
import { institutionOf } from "@/platform/plugins/rules";
import {
  disconnectBank,
  listInstitutions,
  type PluginActionCode,
  PluginActionError,
  startAccess,
} from "@/platform/plugins/service";
import { type AccountDecision, chooseAccounts, readBank } from "@/platform/plugins/sync";
import { BANK_PLUGIN_ID } from "../plugin";
import { requestPresence } from "../presence";
import { bankSink } from "../sink";

export interface BankChoice {
  name: string;
  /** How many days an access to this bank lasts, at most; null when the bank does not say. */
  maxAccessDays: number | null;
}

type Refusal = { ok: false; error: PluginActionCode };

function refusal(error: unknown): Refusal {
  if (error instanceof PluginActionError) return { ok: false, error: error.code };
  console.error("[plugins] an action failed", redactForLog(error));
  return { ok: false, error: "failed" };
}

async function signedIn() {
  const session = await getOptionalSession();
  if (!session) notFound();
  return session;
}

const COUNTRY = /^[A-Z]{2}$/;

export async function listBanksAction(country: string): Promise<{ ok: true; banks: BankChoice[] } | Refusal> {
  const session = await signedIn();
  if (!COUNTRY.test(country)) return { ok: false, error: "failed" };
  try {
    const institutions = await listInstitutions(session.ctx, { pluginId: BANK_PLUGIN_ID, country });
    return { ok: true, banks: institutions.map(({ name, maxAccessDays }) => ({ name, maxAccessDays })) };
  } catch (error) {
    return refusal(error);
  }
}

/** Starts the access and returns the address of the bank's site, for the browser to go to. */
export async function startBankAccessAction(
  country: string,
  name: string,
): Promise<{ ok: true; url: string } | Refusal> {
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
    return refusal(error);
  }
}

/** "Renew access" (§6.7): the same start, for the bank of a connection the person already has. */
export async function renewBankAccessAction(
  connectionId: string,
): Promise<{ ok: true; url: string } | Refusal> {
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
    return refusal(error);
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
): Promise<{ ok: true } | Refusal> {
  const session = await signedIn();
  const target = { pluginId: BANK_PLUGIN_ID, connectionId };
  try {
    await chooseAccounts(session.ctx, { ...target, decisions }, bankSink);
    const outcome = await readBank(session.ctx, { ...target, presence: await requestPresence() }, bankSink);
    if (outcome.ok && outcome.created + outcome.updated > 0) await runAfterSync("manual");
  } catch (error) {
    return refusal(error);
  }
  revalidatePath("/settings/integrations");
  return { ok: true };
}

/** "Try again now" on the outcome page: one more reading the person asked for. */
export async function retryBankReadingAction(connectionId: string): Promise<{ ok: true } | Refusal> {
  const session = await signedIn();
  try {
    const outcome = await readBank(
      session.ctx,
      { pluginId: BANK_PLUGIN_ID, connectionId, presence: await requestPresence() },
      bankSink,
    );
    if (outcome.ok && outcome.created + outcome.updated > 0) await runAfterSync("manual");
  } catch (error) {
    return refusal(error);
  }
  revalidatePath("/banks/connect");
  return { ok: true };
}

/** "Cancel connection" on the choice of the accounts (§6.4): the access is closed, nothing is created. */
export async function cancelBankConnectionAction(connectionId: string): Promise<{ ok: true } | Refusal> {
  const session = await signedIn();
  try {
    await disconnectBank(session.ctx, { pluginId: BANK_PLUGIN_ID, connectionId }, bankSink);
  } catch (error) {
    return refusal(error);
  }
  revalidatePath("/settings/integrations");
  return { ok: true };
}
