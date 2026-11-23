import { generateKeyPairSync, randomUUID } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import type { Ctx } from "@domain/platform/context";
import { getDb } from "@domain/platform/db/client";
import { pluginProvider } from "@domain/platform/integrations/rules";
import { integrationConnections } from "@domain/platform/integrations/schema";
import {
  type Connection,
  listConnections,
  listRuns,
  saveConnection,
} from "@domain/platform/integrations/service";
import { closeDatabase, resetDatabase } from "../../../test/db";
import { createTestUser } from "../../../test/users";
import type { Fetch } from "./client";
import { PLUGIN_PATHS, SECRET_HEADER } from "@plugin-contract/calls";
import type { PluginManifest } from "@plugin-contract/manifest";
import {
  credentialsStatus,
  isPluginActive,
  listPluginConnections,
  listUserPlugins,
  pricesPlugin,
  pluginDiagnostics,
} from "@domain/platform/plugins/queries";
import { hashState } from "@domain/platform/plugins/rules";
import {
  pluginActivations,
  pluginAuthStates,
  plugins,
  pluginUserCredentials,
} from "@domain/platform/plugins/schema";
import {
  completeAccess,
  connectionSummary,
  disconnectBank,
  listInstitutions,
  PluginActionError,
  refreshManifests,
  removeUserCredentials,
  returnAddress,
  saveUserCredentials,
  setPluginActive,
  startAccess,
} from "./service";
import { TREK_PROVIDER } from "../../../test/fixtures/providers";

const PLUGIN = "enablebanking";
const SECRET = "integration-plugin-secret-integration-1";
const KEY = generateKeyPairSync("rsa", { modulusLength: 2048 })
  .privateKey.export({ type: "pkcs8", format: "pem" })
  .toString();
const APP_ID = "app-id-of-the-first-person";
const BANK = { name: "Zeta Bank", country: "IT" };
const NOW = new Date("2026-11-15T10:00:00Z");

const MANIFEST: PluginManifest = {
  id: PLUGIN,
  version: "0.1.0",
  contract: "1",
  labels: {
    name: { en: "Enable Banking", it: "Enable Banking" },
    description: { en: "Accounts from European banks", it: "Conti dalle banche europee" },
    steps: {},
    products: {},
  },
  capabilities: ["windowedHistory", "somethingNew"],
  userSettings: [],
  connectionFields: [],
  egress: ["api.enablebanking.com"],
  schedule: { recommendedPerDay: 3, minIntervalMinutes: 360 },
  providesCategories: false,
};

const ACCOUNT = {
  externalId: "u-1",
  stableId: "hash-1",
  name: "Conto",
  identifier: "IT60X0542811101000000123456",
  currency: "EUR",
  kind: "CACC",
};

const TRANSACTION = {
  accountExternalId: "u-1",
  externalId: "ref-1",
  status: "booked",
  bookingDate: "2025-01-10",
  valueDate: "2025-01-10",
  amount: "12.30",
  direction: "debit",
  currency: "EUR",
  text: ["PAGAMENTO POS"],
  counterparty: "Negozio",
  merchantCategoryCode: null,
  bankTransactionCode: null,
};

interface Call {
  path: string;
  secret: string | null;
  body: Record<string, unknown> | null;
}

type Answer = { status?: number; body: unknown };

/** A plugin made of canned answers, by path: the contract's happy path unless a test says otherwise. */
function fakePlugin(overrides: Record<string, Answer> = {}) {
  const calls: Call[] = [];
  const answers: Record<string, Answer> = {
    [PLUGIN_PATHS.manifest]: { body: MANIFEST },
    [PLUGIN_PATHS.verify]: { body: { access: "read-only" } },
    [PLUGIN_PATHS.institutions]: { body: { institutions: [{ ...BANK, maxAccessDays: 180 }] } },
    [PLUGIN_PATHS.authStart]: { body: { url: "https://bank.example/login" } },
    [PLUGIN_PATHS.authComplete]: {
      body: {
        session: { id: "session-1", expiresAt: "2027-05-14T09:59:00.000Z" },
        institution: BANK,
        accounts: [ACCOUNT],
      },
    },
    [PLUGIN_PATHS.authRevoke]: { body: { revoked: true } },
    [PLUGIN_PATHS.sync]: {
      body: {
        accounts: [
          {
            externalId: "u-1",
            balances: [{ type: "CLBD", amount: "100.00", currency: "EUR", date: null }],
            error: null,
          },
        ],
        transactions: [TRANSACTION],
        cursor: null,
        coverage: { from: "2025-01-10", to: "2025-01-10" },
      },
    },
    ...overrides,
  };
  const fetchFn: Fetch = async (input, init) => {
    const path = new URL(String(input)).pathname;
    const headers = (init?.headers ?? {}) as Record<string, string>;
    calls.push({
      path,
      secret: headers[SECRET_HEADER] ?? null,
      body: init?.body ? JSON.parse(String(init.body)) : null,
    });
    const answer = answers[path];
    return new Response(JSON.stringify(answer.body), { status: answer.status ?? 200 });
  };
  const of = (path: string) => calls.filter((call) => call.path === path);
  return { calls, of, deps: { fetchFn } };
}

const failure = (code: string, status: number): Answer => ({ status, body: { error: { code } } });

function contextFor(userId: string): Ctx {
  return {
    userId,
    role: "user",
    locale: "it",
    timeZone: "Europe/Rome",
    numberFormat: "it-IT",
    displayCurrency: "EUR",
  };
}

async function newContext(): Promise<Ctx> {
  return contextFor((await createTestUser()).id);
}

/** A person with the plugin on and credentials saved. */
async function readyContext(plugin = fakePlugin()): Promise<Ctx> {
  const ctx = await newContext();
  await setPluginActive(ctx, { pluginId: PLUGIN, active: true }, NOW);
  await saveUserCredentials(
    ctx,
    { pluginId: PLUGIN, applicationId: APP_ID, privateKey: KEY },
    NOW,
    plugin.deps,
  );
  return ctx;
}

/** Starts an access and returns the `state` the plugin was given: the one the bank sends back. */
async function started(ctx: Ctx, sessionId: string, plugin = fakePlugin()): Promise<string> {
  await startAccess(ctx, { pluginId: PLUGIN, sessionId, institution: BANK }, NOW, plugin.deps);
  return plugin.of(PLUGIN_PATHS.authStart).at(-1)?.body?.state as string;
}

const returned = (state: string | null, more: { code?: string | null; error?: string | null } = {}) => ({
  state,
  code: more.code === undefined ? "code-1" : more.code,
  error: more.error ?? null,
});

async function rejection(work: Promise<unknown>): Promise<string> {
  const error = await work.then(
    () => null,
    (thrown: unknown) => thrown,
  );
  expect(error).toBeInstanceOf(PluginActionError);
  return (error as PluginActionError).code;
}

beforeEach(async () => {
  await resetDatabase();
  await refreshManifests(NOW, fakePlugin().deps);
});
afterAll(closeDatabase);

describe("the plugins of the instance", () => {
  it("are read from the configuration, with the shared secret, and kept with their manifest", async () => {
    await resetDatabase();
    const plugin = fakePlugin();
    await refreshManifests(NOW, plugin.deps);
    expect(plugin.calls).toEqual([{ path: PLUGIN_PATHS.manifest, secret: SECRET, body: null }]);
    const [row] = await getDb().select().from(plugins);
    expect(row).toMatchObject({ id: PLUGIN, contract: "1", state: "ready", verified: true });
    expect(row.manifest.capabilities).toContain("somethingNew");
    expect(JSON.stringify(row)).not.toContain(SECRET);
  });

  it("are not read again within the hour", async () => {
    const plugin = fakePlugin();
    await refreshManifests(new Date(NOW.getTime() + 59 * 60_000), plugin.deps);
    expect(plugin.calls).toEqual([]);
    await refreshManifests(new Date(NOW.getTime() + 61 * 60_000), plugin.deps);
    expect(plugin.calls).toHaveLength(1);
  });

  it("stay unseen until a manifest has been read: the app is what it was", async () => {
    await resetDatabase();
    const ctx = await newContext();
    await refreshManifests(NOW, fakePlugin({ [PLUGIN_PATHS.manifest]: failure("failed", 500) }).deps);
    expect(await listUserPlugins(ctx)).toEqual([]);
    expect(await rejection(setPluginActive(ctx, { pluginId: PLUGIN, active: true }))).toBe("not_found");
  });

  it("are not accepted with another plugin's id or a contract the core does not speak", async () => {
    await resetDatabase();
    const ctx = await newContext();
    await refreshManifests(
      NOW,
      fakePlugin({ [PLUGIN_PATHS.manifest]: { body: { ...MANIFEST, id: "other" } } }).deps,
    );
    await refreshManifests(
      NOW,
      fakePlugin({ [PLUGIN_PATHS.manifest]: { body: { ...MANIFEST, contract: "9" } } }).deps,
    );
    expect(await listUserPlugins(ctx)).toEqual([]);
  });

  it("serve the instance with prices.daily: nobody sees it or turns it on (R5d)", async () => {
    await resetDatabase();
    const ctx = await newContext();
    const prices = { ...MANIFEST, capabilities: ["prices.daily"] };
    await refreshManifests(NOW, fakePlugin({ [PLUGIN_PATHS.manifest]: { body: prices } }).deps);
    expect(await pricesPlugin()).toMatchObject({ manifest: { capabilities: ["prices.daily"] } });
    expect(await listUserPlugins(ctx)).toEqual([]);
    expect(await rejection(setPluginActive(ctx, { pluginId: PLUGIN, active: true }))).toBe("not_found");
  });
});

describe("a plugin, for one person", () => {
  it("is there for everybody and on for nobody", async () => {
    const ctx = await newContext();
    expect(await listUserPlugins(ctx)).toEqual([
      {
        id: PLUGIN,
        name: "Enable Banking",
        description: "Conti dalle banche europee",
        state: "available",
        pausedSince: null,
        hasCredentials: false,
        connections: 0,
        countries: [],
        // A bank's plugin (neither `source.read` nor `leaveCalendar`), with no credential of its own.
        kind: "bank",
        fields: [],
      },
    ]);
    expect(await isPluginActive(ctx, PLUGIN)).toBe(false);
  });

  it("is turned on by a person who is not an admin, for that person only", async () => {
    const first = await newContext();
    const second = await newContext();
    await setPluginActive(first, { pluginId: PLUGIN, active: true }, NOW);
    expect((await listUserPlugins(first))[0].state).toBe("active");
    expect((await listUserPlugins(second))[0]).toMatchObject({ state: "available", hasCredentials: false });
    expect(await isPluginActive(second, PLUGIN)).toBe(false);
    expect(await getDb().select().from(pluginActivations)).toHaveLength(1);
  });

  it("goes back to available when turned off with nothing saved, and to paused with credentials", async () => {
    const bare = await newContext();
    await setPluginActive(bare, { pluginId: PLUGIN, active: true }, NOW);
    await setPluginActive(bare, { pluginId: PLUGIN, active: false }, NOW);
    expect((await listUserPlugins(bare))[0].state).toBe("available");

    const used = await readyContext();
    const later = new Date(NOW.getTime() + 60_000);
    await setPluginActive(used, { pluginId: PLUGIN, active: false }, later);
    expect((await listUserPlugins(used))[0]).toMatchObject({
      state: "paused",
      pausedSince: later,
      hasCredentials: true,
    });
  });

  it("keeps credentials and connections when turned off, and stops every call (H30)", async () => {
    const ctx = await readyContext();
    await completeAccess(
      ctx,
      { pluginId: PLUGIN, sessionId: "s", query: returned(await started(ctx, "s")), presence: null },
      NOW,
      fakePlugin().deps,
    );
    await setPluginActive(ctx, { pluginId: PLUGIN, active: false }, NOW);

    const plugin = fakePlugin();
    expect(
      await rejection(listInstitutions(ctx, { pluginId: PLUGIN, country: "IT" }, NOW, plugin.deps)),
    ).toBe("not_active");
    expect(
      await rejection(
        startAccess(ctx, { pluginId: PLUGIN, sessionId: "s", institution: BANK }, NOW, plugin.deps),
      ),
    ).toBe("not_active");
    expect(plugin.calls).toEqual([]);
    expect((await credentialsStatus(ctx, PLUGIN)).saved).toBe(true);
    expect(await listPluginConnections(ctx, PLUGIN)).toHaveLength(1);

    await setPluginActive(ctx, { pluginId: PLUGIN, active: true }, NOW);
    expect(await listInstitutions(ctx, { pluginId: PLUGIN, country: "IT" }, NOW, plugin.deps)).toHaveLength(
      1,
    );
  });
});

describe("the credentials of a person", () => {
  it("are checked with the provider, then sealed: the row carries no readable value", async () => {
    const plugin = fakePlugin();
    const ctx = await readyContext(plugin);
    expect(plugin.of(PLUGIN_PATHS.verify)[0].body).toEqual({
      credentials: { applicationId: APP_ID, privateKey: KEY.trim() + "\n" },
    });
    expect(await credentialsStatus(ctx, PLUGIN)).toEqual({ saved: true, savedAt: NOW, invalid: false });
    const [row] = await getDb().select().from(pluginUserCredentials);
    const stored = row.credentials.toString("latin1");
    expect(stored).not.toContain(APP_ID);
    expect(stored).not.toContain("PRIVATE KEY");
  });

  it("are asked of a person who has the plugin on", async () => {
    const ctx = await newContext();
    const plugin = fakePlugin();
    const input = { pluginId: PLUGIN, applicationId: APP_ID, privateKey: KEY };
    expect(await rejection(saveUserCredentials(ctx, input, NOW, plugin.deps))).toBe("not_active");
    expect(plugin.calls).toEqual([]);
  });

  it("are refused before any call when something is missing or the key is not a key", async () => {
    const ctx = await newContext();
    await setPluginActive(ctx, { pluginId: PLUGIN, active: true }, NOW);
    const plugin = fakePlugin();
    const save = (applicationId: string, privateKey: string) =>
      rejection(saveUserCredentials(ctx, { pluginId: PLUGIN, applicationId, privateKey }, NOW, plugin.deps));
    expect(await save("", KEY)).toBe("missing");
    expect(await save(APP_ID, "  ")).toBe("missing");
    expect(await save(APP_ID, "this is not a key")).toBe("key_format");
    expect(plugin.calls).toEqual([]);
    expect((await credentialsStatus(ctx, PLUGIN)).saved).toBe(false);
  });

  it.each([
    [{ body: { access: "write" } }, "write_not_allowed"],
    [failure("auth", 403), "credentials_invalid"],
    [failure("key_format", 400), "key_format"],
    [failure("provider_down", 502), "unreachable"],
    [failure("unauthorized", 401), "plugin_down"],
    [{ status: 500, body: "the plugin's own words" }, "plugin_down"],
  ] as [Answer, string][])("are not saved when the check says %j", async (answer, code) => {
    const ctx = await newContext();
    await setPluginActive(ctx, { pluginId: PLUGIN, active: true }, NOW);
    const plugin = fakePlugin({ [PLUGIN_PATHS.verify]: answer });
    const work = saveUserCredentials(
      ctx,
      { pluginId: PLUGIN, applicationId: APP_ID, privateKey: KEY },
      NOW,
      plugin.deps,
    );
    const error = await work.then(
      () => null,
      (thrown: Error) => thrown,
    );
    expect(error).toMatchObject({ code, message: code });
    expect((await credentialsStatus(ctx, PLUGIN)).saved).toBe(false);
  });

  it("are accepted when the provider does not say what the application can do", async () => {
    const ctx = await newContext();
    await setPluginActive(ctx, { pluginId: PLUGIN, active: true }, NOW);
    const plugin = fakePlugin({ [PLUGIN_PATHS.verify]: { body: { access: "unverifiable" } } });
    await saveUserCredentials(
      ctx,
      { pluginId: PLUGIN, applicationId: APP_ID, privateKey: KEY },
      NOW,
      plugin.deps,
    );
    expect((await credentialsStatus(ctx, PLUGIN)).saved).toBe(true);
  });

  it("keep the saved id when a key is replaced with the id left empty, and stay as they were on a refusal", async () => {
    const ctx = await readyContext();
    const other = generateKeyPairSync("rsa", { modulusLength: 2048 })
      .privateKey.export({ type: "pkcs8", format: "pem" })
      .toString();
    const refusing = fakePlugin({ [PLUGIN_PATHS.verify]: failure("auth", 403) });
    await rejection(
      saveUserCredentials(
        ctx,
        { pluginId: PLUGIN, applicationId: "", privateKey: other },
        NOW,
        refusing.deps,
      ),
    );
    const [before] = await getDb().select().from(pluginUserCredentials);

    const plugin = fakePlugin();
    const later = new Date(NOW.getTime() + 60_000);
    await saveUserCredentials(
      ctx,
      { pluginId: PLUGIN, applicationId: "", privateKey: other },
      later,
      plugin.deps,
    );
    expect(plugin.of(PLUGIN_PATHS.verify)[0].body).toEqual({
      credentials: { applicationId: APP_ID, privateKey: other },
    });
    const [after] = await getDb().select().from(pluginUserCredentials);
    expect(before.savedAt).toEqual(NOW);
    expect(after.savedAt).toEqual(later);
    expect(after.credentials.equals(before.credentials)).toBe(false);
  });

  it("are not seen and not used by a second person", async () => {
    const first = await readyContext();
    const second = await newContext();
    await setPluginActive(second, { pluginId: PLUGIN, active: true }, NOW);
    const plugin = fakePlugin();

    expect(await credentialsStatus(second, PLUGIN)).toEqual({ saved: false, savedAt: null, invalid: false });
    expect(
      await rejection(listInstitutions(second, { pluginId: PLUGIN, country: "IT" }, NOW, plugin.deps)),
    ).toBe("missing");
    expect(
      await rejection(
        startAccess(second, { pluginId: PLUGIN, sessionId: "s", institution: BANK }, NOW, plugin.deps),
      ),
    ).toBe("missing");
    expect(plugin.calls).toEqual([]);

    await saveUserCredentials(
      second,
      { pluginId: PLUGIN, applicationId: "app-of-the-second", privateKey: KEY },
      NOW,
      plugin.deps,
    );
    await listInstitutions(second, { pluginId: PLUGIN, country: "IT" }, NOW, plugin.deps);
    await listInstitutions(first, { pluginId: PLUGIN, country: "IT" }, NOW, plugin.deps);
    const ids = plugin
      .of(PLUGIN_PATHS.institutions)
      .map((call) => (call.body?.credentials as Record<string, string>).applicationId);
    expect(ids).toEqual(["app-of-the-second", APP_ID]);
  });

  it("are marked as refused when the provider refuses them in use, and cleared by a new key", async () => {
    const ctx = await readyContext();
    const refusing = fakePlugin({ [PLUGIN_PATHS.institutions]: failure("auth", 403) });
    expect(
      await rejection(listInstitutions(ctx, { pluginId: PLUGIN, country: "IT" }, NOW, refusing.deps)),
    ).toBe("auth");
    expect((await credentialsStatus(ctx, PLUGIN)).invalid).toBe(true);
    await saveUserCredentials(
      ctx,
      { pluginId: PLUGIN, applicationId: "", privateKey: KEY },
      NOW,
      fakePlugin().deps,
    );
    expect((await credentialsStatus(ctx, PLUGIN)).invalid).toBe(false);
  });

  it("are removed only with no bank connected", async () => {
    const ctx = await readyContext();
    await completeAccess(
      ctx,
      { pluginId: PLUGIN, sessionId: "s", query: returned(await started(ctx, "s")), presence: null },
      NOW,
      fakePlugin().deps,
    );
    expect(await rejection(removeUserCredentials(ctx, PLUGIN))).toBe("connected");
    const [connection] = await listPluginConnections(ctx, PLUGIN);
    await disconnectBank(ctx, { pluginId: PLUGIN, connectionId: connection.id }, fakePlugin().deps);
    await removeUserCredentials(ctx, PLUGIN);
    expect(await getDb().select().from(pluginUserCredentials)).toEqual([]);
  });
});

describe("an access to a bank", () => {
  it("starts at the plugin with a state that is kept only as a hash, for this session", async () => {
    const ctx = await readyContext();
    const plugin = fakePlugin();
    const { url } = await startAccess(
      ctx,
      { pluginId: PLUGIN, sessionId: "session-a", institution: BANK },
      NOW,
      plugin.deps,
    );
    expect(url).toBe("https://bank.example/login");
    const body = plugin.of(PLUGIN_PATHS.authStart)[0].body as Record<string, unknown>;
    expect(body.redirectUrl).toBe(returnAddress(PLUGIN));
    expect(returnAddress(PLUGIN)).toBe("http://127.0.0.1:3000/api/v1/plugins/enablebanking/callback");
    expect(body.institution).toEqual(BANK);
    const state = body.state as string;
    expect(state.length).toBeGreaterThanOrEqual(40);

    const [row] = await getDb().select().from(pluginAuthStates);
    expect(row).toMatchObject({
      userId: ctx.userId,
      pluginId: PLUGIN,
      stateHash: hashState(state),
      sessionId: "session-a",
      payload: BANK,
      consumedAt: null,
      expiresAt: new Date(NOW.getTime() + 15 * 60_000),
    });
    expect(JSON.stringify(row)).not.toContain(state);
  });

  it("ends with the bank's connection, sealed and to complete: nothing is read before the accounts are chosen", async () => {
    const ctx = await readyContext();
    const state = await started(ctx, "session-a");
    const plugin = fakePlugin();
    const outcome = await completeAccess(
      ctx,
      { pluginId: PLUGIN, sessionId: "session-a", query: returned(state), presence: null },
      NOW,
      plugin.deps,
    );
    const [connection] = await listPluginConnections(ctx, PLUGIN);
    expect(outcome).toEqual({ ok: true, connectionId: connection.id, renewed: false });
    expect(connection).toMatchObject({
      provider: pluginProvider(PLUGIN),
      instanceKey: "IT:Zeta Bank",
      expiresAt: new Date("2027-05-14T09:59:00.000Z"),
      state: "active",
      lastOkAt: null,
      // Not scheduled until the accounts are chosen.
      nextSyncAt: null,
      schedule: { rules: [] },
    });
    expect(await connectionSummary(ctx, connection.id)).toMatchObject({ accounts: 1, chosen: false });
    expect(plugin.of(PLUGIN_PATHS.authComplete)[0].body).toMatchObject({ code: "code-1" });
    expect(plugin.of(PLUGIN_PATHS.sync)).toEqual([]);
    expect(await listRuns(ctx, { connectionId: connection.id })).toEqual([]);

    const [row] = await getDb()
      .select()
      .from(integrationConnections)
      .where(eq(integrationConnections.id, connection.id));
    const stored = row.credentials.toString("latin1");
    for (const secret of ["session-1", "IT60X0542811101000000123456", "Conto"])
      expect(stored).not.toContain(secret);
  });

  it("names an exchange whose answer cannot be read as unreadable, not as a bank that did not answer", async () => {
    const ctx = await readyContext();
    const state = await started(ctx, "s");
    const plugin = fakePlugin({ [PLUGIN_PATHS.authComplete]: failure("invalid_data", 502) });
    expect(
      await completeAccess(
        ctx,
        { pluginId: PLUGIN, sessionId: "s", query: returned(state), presence: null },
        NOW,
        plugin.deps,
      ),
    ).toEqual({ ok: false, error: "unreadable", bank: "Zeta Bank" });
  });

  it("is refused when the return does not come from the session that started it", async () => {
    const ctx = await readyContext();
    const state = await started(ctx, "session-a");
    const plugin = fakePlugin();
    const other = await completeAccess(
      ctx,
      { pluginId: PLUGIN, sessionId: "session-b", query: returned(state), presence: null },
      NOW,
      plugin.deps,
    );
    expect(other).toEqual({ ok: false, error: "session", bank: null });
    expect(plugin.calls).toEqual([]);
    expect(await listPluginConnections(ctx, PLUGIN)).toEqual([]);
    // The right session can still finish: a wrong return does not burn the state.
    const own = await completeAccess(
      ctx,
      { pluginId: PLUGIN, sessionId: "session-a", query: returned(state), presence: null },
      NOW,
      plugin.deps,
    );
    expect(own.ok).toBe(true);
  });

  it("is refused for another person, even with the same session id and state", async () => {
    const first = await readyContext();
    const second = await readyContext();
    const state = await started(first, "session-a");
    const plugin = fakePlugin();
    expect(
      await completeAccess(
        second,
        { pluginId: PLUGIN, sessionId: "session-a", query: returned(state), presence: null },
        NOW,
        plugin.deps,
      ),
    ).toEqual({ ok: false, error: "session", bank: null });
    expect(plugin.calls).toEqual([]);
    expect(await listConnections(second)).toEqual([]);
  });

  it("is refused for a state nobody started, for no state, and for a state used once already", async () => {
    const ctx = await readyContext();
    const plugin = fakePlugin();
    const complete = (state: string | null) =>
      completeAccess(
        ctx,
        { pluginId: PLUGIN, sessionId: "s", query: returned(state), presence: null },
        NOW,
        plugin.deps,
      );
    expect(await complete(randomUUID())).toEqual({ ok: false, error: "session", bank: null });
    expect(await complete(null)).toEqual({ ok: false, error: "session", bank: null });
    expect(plugin.calls).toEqual([]);

    const state = await started(ctx, "s");
    expect((await complete(state)).ok).toBe(true);
    expect(await complete(state)).toEqual({ ok: false, error: "session", bank: null });
    expect(plugin.of(PLUGIN_PATHS.authComplete)).toHaveLength(1);
  });

  it("is refused past its quarter of an hour", async () => {
    const ctx = await readyContext();
    const state = await started(ctx, "s");
    const plugin = fakePlugin();
    const late = new Date(NOW.getTime() + 15 * 60_000);
    expect(
      await completeAccess(
        ctx,
        { pluginId: PLUGIN, sessionId: "s", query: returned(state), presence: null },
        late,
        plugin.deps,
      ),
    ).toEqual({ ok: false, error: "expired", bank: "Zeta Bank" });
    expect(plugin.calls).toEqual([]);
    expect(await listPluginConnections(ctx, PLUGIN)).toEqual([]);
  });

  it("ends as denied when the person refused at the bank, and nothing is exchanged", async () => {
    const ctx = await readyContext();
    const plugin = fakePlugin();
    const denied = await completeAccess(
      ctx,
      {
        pluginId: PLUGIN,
        sessionId: "s",
        query: returned(await started(ctx, "s"), { code: null, error: "access_denied" }),
        presence: null,
      },
      NOW,
      plugin.deps,
    );
    expect(denied).toEqual({ ok: false, error: "denied", bank: "Zeta Bank" });
    expect(plugin.calls).toEqual([]);
  });

  it("says in the log why a return was refused, with codes and nothing of the return itself", async () => {
    const ctx = await readyContext();
    const lines: string[] = [];
    const warn = console.warn;
    console.warn = (line: string) => void lines.push(line);
    try {
      const complete = async (query: ReturnType<typeof returned>, plugin = fakePlugin()) =>
        completeAccess(ctx, { pluginId: PLUGIN, sessionId: "s", query, presence: null }, NOW, plugin.deps);
      await complete(returned(await started(ctx, "s"), { code: null, error: "access_denied" }));
      await complete(
        returned(await started(ctx, "s"), { code: null, error: "Zeta <b>Bank</b> said no to Mario" }),
      );
      await complete(returned("a-state-nobody-started-000000"));
      await complete(
        returned(await started(ctx, "s")),
        fakePlugin({ [PLUGIN_PATHS.authComplete]: failure("invalid_data", 502) }),
      );
      await complete(
        returned(await started(ctx, "s")),
        fakePlugin({
          [PLUGIN_PATHS.authComplete]: { body: { session: { id: "x" }, accounts: [{ externalId: "u" }] } },
        }),
      );
    } finally {
      console.warn = warn;
    }
    expect(lines).toEqual([
      "[plugins] return of enablebanking refused: denied (provider said access_denied)",
      "[plugins] return of enablebanking refused: denied (provider said an error)",
      "[plugins] return of enablebanking refused: session (state not pending for this session)",
      "[plugins] return of enablebanking refused: unreadable (exchange failed with invalid_data)",
      "[plugins] enablebanking /auth/complete: answer outside the contract at session.expiresAt, institution, accounts.0.stableId, accounts.0.name, accounts.0.identifier",
      "[plugins] return of enablebanking refused: unreadable (exchange failed with invalid_data)",
    ]);
  });

  it("closes the access and saves nothing when the bank shared no account", async () => {
    const ctx = await readyContext();
    const state = await started(ctx, "s");
    const plugin = fakePlugin({
      [PLUGIN_PATHS.authComplete]: {
        body: { session: { id: "session-1", expiresAt: null }, institution: BANK, accounts: [] },
      },
    });
    expect(
      await completeAccess(
        ctx,
        { pluginId: PLUGIN, sessionId: "s", query: returned(state), presence: null },
        NOW,
        plugin.deps,
      ),
    ).toEqual({ ok: false, error: "no_accounts", bank: "Zeta Bank" });
    expect(plugin.of(PLUGIN_PATHS.authRevoke)[0].body).toMatchObject({ session: { id: "session-1" } });
    expect(await listPluginConnections(ctx, PLUGIN)).toEqual([]);
  });

  it.each([
    ["provider_down", 502, "unreachable"],
    ["consent_expired", 409, "expired"],
    ["institution_unavailable", 503, "bank_unavailable"],
  ])("names a failed exchange (%s) from the closed list", async (code, status, error) => {
    const ctx = await readyContext();
    const state = await started(ctx, "s");
    const plugin = fakePlugin({ [PLUGIN_PATHS.authComplete]: failure(code, status) });
    expect(
      await completeAccess(
        ctx,
        { pluginId: PLUGIN, sessionId: "s", query: returned(state), presence: null },
        NOW,
        plugin.deps,
      ),
    ).toEqual({ ok: false, error, bank: "Zeta Bank" });
  });

  it("is one connection per bank: a second bank is a second connection, the same bank a renewal", async () => {
    const ctx = await readyContext();
    await completeAccess(
      ctx,
      { pluginId: PLUGIN, sessionId: "s", query: returned(await started(ctx, "s")), presence: null },
      NOW,
      fakePlugin().deps,
    );
    // From N2 a person connects more than one bank (rewrite plan, N2, criterion 5).
    const OTHER = { name: "Alfa Bank", country: "IT" };
    const second = fakePlugin({
      [PLUGIN_PATHS.authComplete]: {
        body: {
          session: { id: "session-alfa", expiresAt: "2027-06-01T00:00:00.000Z" },
          institution: OTHER,
          accounts: [{ ...ACCOUNT, externalId: "u-alfa", stableId: "stable-alfa" }],
        },
      },
    });
    await startAccess(ctx, { pluginId: PLUGIN, sessionId: "s", institution: OTHER }, NOW, second.deps);
    const state = second.of(PLUGIN_PATHS.authStart).at(-1)?.body?.state as string;
    const outcome = await completeAccess(
      ctx,
      { pluginId: PLUGIN, sessionId: "s", query: returned(state), presence: null },
      NOW,
      second.deps,
    );
    expect(outcome).toMatchObject({ ok: true, renewed: false });
    expect((await listPluginConnections(ctx, PLUGIN)).map((one) => one.instanceKey).sort()).toEqual([
      "IT:Alfa Bank",
      "IT:Zeta Bank",
    ]);
    // The first bank's access is not closed by the second bank's.
    expect(second.of(PLUGIN_PATHS.authRevoke)).toEqual([]);

    // The same bank again is a renewal: it replaces the access of that bank's connection only.
    const renewed = fakePlugin({
      [PLUGIN_PATHS.authComplete]: {
        body: {
          session: { id: "session-2", expiresAt: "2027-08-01T00:00:00.000Z" },
          institution: BANK,
          accounts: [ACCOUNT],
        },
      },
    });
    await completeAccess(
      ctx,
      { pluginId: PLUGIN, sessionId: "s", query: returned(await started(ctx, "s", renewed)), presence: null },
      NOW,
      renewed.deps,
    );
    const connections = await listPluginConnections(ctx, PLUGIN);
    expect(connections).toHaveLength(2);
    expect(connections.find((one) => one.instanceKey === "IT:Zeta Bank")?.expiresAt).toEqual(
      new Date("2027-08-01T00:00:00.000Z"),
    );
    expect(connections.find((one) => one.instanceKey === "IT:Alfa Bank")?.expiresAt).toEqual(
      new Date("2027-06-01T00:00:00.000Z"),
    );

    // Disconnecting one bank leaves the other connected (its accounts: `banks/sink.itest.ts`).
    const alfa = connections.find((one) => one.instanceKey === "IT:Alfa Bank") as Connection;
    await disconnectBank(ctx, { pluginId: PLUGIN, connectionId: alfa.id }, fakePlugin().deps);
    expect((await listPluginConnections(ctx, PLUGIN)).map((one) => one.instanceKey)).toEqual([
      "IT:Zeta Bank",
    ]);
  });

  it("says in the diagnostics whether each plugin answers, and since when it does not", async () => {
    expect(await pluginDiagnostics("en")).toEqual([
      { id: PLUGIN, name: MANIFEST.labels.name.en, version: "0.1.0", contract: "1", state: "up", at: NOW },
    ]);
    // Two failed checks: the series started at the first one.
    const later = (hours: number) => new Date(NOW.getTime() + hours * 3_600_000);
    const down = fakePlugin({ [PLUGIN_PATHS.manifest]: { status: 502, body: {} } });
    await refreshManifests(later(2), down.deps);
    await refreshManifests(later(4), down.deps);
    expect(await pluginDiagnostics("en")).toMatchObject([{ state: "down", at: later(2) }]);
    // A plugin that speaks a contract this core does not: kept as it answered, used by nobody.
    await refreshManifests(
      later(6),
      fakePlugin({ [PLUGIN_PATHS.manifest]: { body: { ...MANIFEST, contract: "9" } } }).deps,
    );
    expect(await pluginDiagnostics("en")).toMatchObject([{ state: "incompatible", contract: "9" }]);
    expect(await listUserPlugins(await newContext())).toEqual([]);
    await refreshManifests(later(8), fakePlugin().deps);
    expect(await pluginDiagnostics("en")).toMatchObject([{ state: "up", at: later(8) }]);

    await resetDatabase();
    expect(await pluginDiagnostics("en")).toEqual([
      { id: PLUGIN, name: PLUGIN, version: null, contract: null, state: "never", at: null },
    ]);
  });

  it("is closed at the provider and forgotten here on disconnect, credentials kept", async () => {
    const ctx = await readyContext();
    await completeAccess(
      ctx,
      { pluginId: PLUGIN, sessionId: "s", query: returned(await started(ctx, "s")), presence: null },
      NOW,
      fakePlugin().deps,
    );
    const [connection] = await listPluginConnections(ctx, PLUGIN);
    const other = await readyContext();
    expect(
      await rejection(
        disconnectBank(other, { pluginId: PLUGIN, connectionId: connection.id }, fakePlugin().deps),
      ),
    ).toBe("not_found");

    // A provider that does not answer does not keep the person connected.
    const plugin = fakePlugin({ [PLUGIN_PATHS.authRevoke]: failure("provider_down", 502) });
    await disconnectBank(ctx, { pluginId: PLUGIN, connectionId: connection.id }, plugin.deps);
    expect(plugin.of(PLUGIN_PATHS.authRevoke)[0].body).toMatchObject({ session: { id: "session-1" } });
    expect(await listPluginConnections(ctx, PLUGIN)).toEqual([]);
    expect((await credentialsStatus(ctx, PLUGIN)).saved).toBe(true);
  });
});

describe("the connections of the providers there were before", () => {
  it("are still saved one per provider, with an empty instance key, beside a bank's", async () => {
    const ctx = await readyContext();
    await completeAccess(
      ctx,
      { pluginId: PLUGIN, sessionId: "s", query: returned(await started(ctx, "s")), presence: null },
      NOW,
      fakePlugin().deps,
    );
    await saveConnection(ctx, { provider: TREK_PROVIDER, credentials: { token: "one" } });
    await saveConnection(ctx, { provider: TREK_PROVIDER, credentials: { token: "two" } });
    const rows = await getDb()
      .select({ provider: integrationConnections.provider, instanceKey: integrationConnections.instanceKey })
      .from(integrationConnections)
      .where(and(eq(integrationConnections.userId, ctx.userId)))
      .orderBy(integrationConnections.provider);
    expect(rows).toEqual([
      { provider: "plugin:enablebanking", instanceKey: "IT:Zeta Bank" },
      { provider: "plugin:trek", instanceKey: "" },
    ]);
  });
});
