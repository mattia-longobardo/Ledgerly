// A bank's plugin for the integration tests: a fake plugin answering from memory, its manifest, one
// account and one reading. No call leaves the test.
import { generateKeyPairSync } from "node:crypto";
import type { Ctx } from "@domain/platform/context";
import type { Fetch } from "@plugin-host/client";
import { PLUGIN_PATHS, type PluginAccount, type SyncResponse } from "@plugin-contract/calls";
import type { PluginManifest } from "@plugin-contract/manifest";
import { completeAccess, saveUserCredentials, setPluginActive, startAccess } from "@plugin-host/service";

export const PLUGIN = "enablebanking";
export const PROVIDER = "plugin:enablebanking";
export const KEY = generateKeyPairSync("rsa", { modulusLength: 2048 })
  .privateKey.export({ type: "pkcs8", format: "pem" })
  .toString();
export const BANK = { name: "Zeta Bank", country: "IT" };
export const BANK_NOW = new Date("2026-11-15T10:00:00Z");

export const MANIFEST: PluginManifest = {
  id: PLUGIN,
  version: "0.1.0",
  contract: "1",
  labels: {
    name: { en: "Enable Banking", it: "Enable Banking" },
    description: { en: "Accounts from European banks", it: "Conti dalle banche europee" },
    steps: {},
    products: {},
  },
  capabilities: ["windowedHistory"],
  userSettings: [],
  connectionFields: [],
  egress: ["api.enablebanking.com"],
  schedule: { recommendedPerDay: 3, minIntervalMinutes: 360 },
  providesCategories: false,
};

export const ACCOUNT: PluginAccount = {
  externalId: "u-1",
  stableId: "hash-1",
  name: "Conto",
  identifier: "IT60X0542811101000000123456",
  currency: "EUR",
  kind: "CACC",
};

export const ANSWER: SyncResponse = {
  accounts: [
    {
      externalId: "u-1",
      balances: [{ type: "ITAV", amount: "100.00", currency: "EUR", date: "2026-11-14" }],
      error: null,
    },
  ],
  transactions: [
    {
      accountExternalId: "u-1",
      externalId: "ref-1",
      status: "booked",
      bookingDate: "2026-11-10",
      valueDate: "2026-11-10",
      amount: "12.30",
      direction: "debit",
      currency: "EUR",
      text: ["PAGAMENTO POS"],
      counterparty: "Negozio",
      merchantCategoryCode: null,
      bankTransactionCode: null,
    },
  ],
  cursor: null,
  coverage: { from: null, to: null },
};

/** The plugin, answering from memory: every call it got is in `calls`. */
export function fakePlugin() {
  const calls: { path: string; body: Record<string, unknown> }[] = [];
  const fetchFn: Fetch = async (input, init) => {
    const path = new URL(String(input)).pathname;
    const body = init?.body ? (JSON.parse(String(init.body)) as Record<string, unknown>) : {};
    calls.push({ path, body });
    const reply = (value: unknown, status = 200) => new Response(JSON.stringify(value), { status });
    if (path === PLUGIN_PATHS.manifest) return reply(MANIFEST);
    if (path === PLUGIN_PATHS.verify) return reply({ access: "read-only" });
    if (path === PLUGIN_PATHS.authStart) return reply({ url: "https://bank.example/login" });
    if (path === PLUGIN_PATHS.authRevoke) return reply({ revoked: true });
    if (path === PLUGIN_PATHS.authComplete) {
      return reply({
        session: { id: "session-1", expiresAt: "2027-05-14T09:59:00.000Z" },
        institution: BANK,
        accounts: [ACCOUNT],
      });
    }
    if (path === PLUGIN_PATHS.sync) return reply(ANSWER);
    return reply({ error: { code: "invalid_request" } }, 400);
  };
  return { calls, deps: { fetchFn } };
}

/** The person turns the plugin on, saves a key and gives one bank access: the connection's id. */
export async function bankAccess(ctx: Ctx, plugin: ReturnType<typeof fakePlugin>): Promise<string> {
  await setPluginActive(ctx, { pluginId: PLUGIN, active: true }, BANK_NOW);
  await saveUserCredentials(
    ctx,
    { pluginId: PLUGIN, applicationId: "app-1", privateKey: KEY },
    BANK_NOW,
    plugin.deps,
  );
  await startAccess(ctx, { pluginId: PLUGIN, sessionId: "s", institution: BANK }, BANK_NOW, plugin.deps);
  const state = plugin.calls.filter((call) => call.path === PLUGIN_PATHS.authStart).at(-1)?.body
    .state as string;
  const outcome = await completeAccess(
    ctx,
    { pluginId: PLUGIN, sessionId: "s", query: { state, code: "code-1", error: null }, presence: null },
    BANK_NOW,
    plugin.deps,
  );
  if (!outcome.ok) throw new Error(`access refused: ${outcome.error}`);
  return outcome.connectionId;
}
