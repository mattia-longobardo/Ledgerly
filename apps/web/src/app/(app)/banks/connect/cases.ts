// src/app/(app)/banks/connect/cases.ts — the steps of "Connect a bank" (ux/n1-plugin-bank.md §6): the
// banks of a country, the start or the renewal of an access, the choice of the accounts with the first
// reading, a reading tried again and the way out. The Server Actions and `/api/v1` call these; an
// access is bound to the browser's session that starts it (the return checks it).
import "server-only";
import { revalidatePath } from "next/cache";
import { redactForLog } from "@ledgerly/domain/platform/auth";
import type { Ctx } from "@ledgerly/domain/platform/context";
import { enqueue } from "@ledgerly/domain/platform/jobs";
import { institutionOf, instanceKeyOf, listPluginConnections } from "@ledgerly/domain/platform/plugins";
import {
  type AccountDecision,
  chooseAccounts,
  disconnectBank,
  listInstitutions,
  type PluginActionCode,
  PluginActionError,
  type Presence,
  readBank,
  startAccess,
} from "@ledgerly/plugin-host";
import { tasks } from "@/platform/jobs/queue";
import { BANK_PLUGIN_ID } from "../plugin";
import { bankSink } from "../sink";

interface BankChoice {
  name: string;
  /** How many days an access to this bank lasts, at most; null when the bank does not say. */
  maxAccessDays: number | null;
  /** The person already has a connection to this bank: it is renewed, not connected again. */
  connected: boolean;
}

export type BankRefusal = { ok: false; error: PluginActionCode };

function bankRefusal(error: unknown): BankRefusal {
  if (error instanceof PluginActionError) return { ok: false, error: error.code };
  console.error("[plugins] an action failed", redactForLog(error));
  return { ok: false, error: "failed" };
}

const COUNTRY = /^[A-Z]{2}$/;

export async function listBanks(
  ctx: Ctx,
  country: string,
): Promise<{ ok: true; banks: BankChoice[] } | BankRefusal> {
  if (!COUNTRY.test(country)) return { ok: false, error: "failed" };
  try {
    const institutions = await listInstitutions(ctx, { pluginId: BANK_PLUGIN_ID, country });
    const connected = new Set(
      (await listPluginConnections(ctx, BANK_PLUGIN_ID)).map((connection) => connection.instanceKey),
    );
    return {
      ok: true,
      banks: institutions.map(({ name, maxAccessDays }) => ({
        name,
        maxAccessDays,
        connected: connected.has(instanceKeyOf({ name, country })),
      })),
    };
  } catch (error) {
    return bankRefusal(error);
  }
}

/** Starts an access to a bank of `country`, bound to the browser's session: the answer is the bank's page. */
export async function startBankAccess(
  ctx: Ctx,
  sessionId: string,
  institution: { country: string; name: string },
): Promise<{ ok: true; url: string } | BankRefusal> {
  const { country, name } = institution;
  if (!COUNTRY.test(country) || name.length < 1 || name.length > 200) return { ok: false, error: "failed" };
  try {
    const { url } = await startAccess(ctx, {
      pluginId: BANK_PLUGIN_ID,
      sessionId,
      institution: { name, country },
    });
    return { ok: true, url };
  } catch (error) {
    return bankRefusal(error);
  }
}

/** "Renew access" (§6.7): the same start, for the bank of a connection the person already has. */
export async function renewBankAccess(
  ctx: Ctx,
  sessionId: string,
  connectionId: string,
): Promise<{ ok: true; url: string } | BankRefusal> {
  try {
    const connection = (await listPluginConnections(ctx, BANK_PLUGIN_ID)).find(
      (one) => one.id === connectionId,
    );
    if (!connection) return { ok: false, error: "not_found" };
    const { url } = await startAccess(ctx, {
      pluginId: BANK_PLUGIN_ID,
      sessionId,
      institution: institutionOf(connection.instanceKey),
    });
    return { ok: true, url };
  } catch (error) {
    return bankRefusal(error);
  }
}

/** A reading of the bank now; a reading that brought movements starts what follows a sync. */
async function readNow(ctx: Ctx, connectionId: string, presence: Presence | null): Promise<void> {
  const outcome = await readBank(ctx, { pluginId: BANK_PLUGIN_ID, connectionId, presence }, bankSink);
  if (outcome.ok && outcome.created + outcome.updated > 0) await enqueue(tasks.afterSync("manual"));
}

/** The accounts chosen, then the first reading at once. */
export async function importBankAccounts(
  ctx: Ctx,
  connectionId: string,
  decisions: AccountDecision[],
  presence: Presence | null,
): Promise<{ ok: true } | BankRefusal> {
  try {
    await chooseAccounts(ctx, { pluginId: BANK_PLUGIN_ID, connectionId, decisions }, bankSink);
    await readNow(ctx, connectionId, presence);
  } catch (error) {
    return bankRefusal(error);
  }
  revalidatePath("/settings/plugins", "layout");
  return { ok: true };
}

/** The first reading, tried again after a refusal. */
export async function retryBankReading(
  ctx: Ctx,
  connectionId: string,
  presence: Presence | null,
): Promise<{ ok: true } | BankRefusal> {
  try {
    await readNow(ctx, connectionId, presence);
  } catch (error) {
    return bankRefusal(error);
  }
  revalidatePath("/banks/connect");
  return { ok: true };
}

export async function cancelBankConnection(
  ctx: Ctx,
  connectionId: string,
): Promise<{ ok: true } | BankRefusal> {
  try {
    await disconnectBank(ctx, { pluginId: BANK_PLUGIN_ID, connectionId });
  } catch (error) {
    return bankRefusal(error);
  }
  revalidatePath("/settings/plugins", "layout");
  return { ok: true };
}
