// src/app/(app)/banks/connect/actions.ts — the procedure "Connect a bank" (ux/n1-plugin-bank.md
// §6): the list of the banks of a country and the start of an access. Thin wrappers around
// `platform/plugins`; the return from the bank is the route `/api/v1/plugins/<id>/callback`.
"use server";

import { notFound } from "next/navigation";
import { redactForLog } from "@/platform/auth/logger";
import { getOptionalSession } from "@/platform/auth/session";
import {
  listInstitutions,
  type PluginActionCode,
  PluginActionError,
  startAccess,
} from "@/platform/plugins/service";
import { BANK_PLUGIN_ID } from "../plugin";

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

const COUNTRY = /^[A-Z]{2}$/;

export async function listBanksAction(country: string): Promise<{ ok: true; banks: BankChoice[] } | Refusal> {
  const session = await getOptionalSession();
  if (!session) notFound();
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
  const session = await getOptionalSession();
  if (!session) notFound();
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
