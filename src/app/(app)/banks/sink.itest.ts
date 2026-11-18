import { generateKeyPairSync } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { getAccount, listAccounts, listBalanceEntries } from "@domain/modules/accounts/queries";
import { archiveAccount, createAccount, updateAccountSettings } from "@domain/modules/accounts/service";
import { getPool } from "@domain/platform/db/client";
import { transactionIdsOfAccount, transactionsByIds } from "@domain/modules/transactions/queries";
import { categorisableAccountIds } from "@domain/modules/transactions/service";
import type { Ctx } from "@domain/platform/context";
import { dispatchDueConnections } from "@/platform/integrations/jobs";
import { passFor } from "@/platform/integrations/registry";
import { dueConnections, listRuns, readSyncJob } from "@domain/platform/integrations/service";
import type { Fetch } from "@/platform/plugins/client";
import {
  PLUGIN_PATHS,
  type PluginAccount,
  type SyncResponse,
  syncResponseSchema,
} from "@plugin-contract/calls";
import type { PluginManifest } from "@plugin-contract/manifest";
import { credentialsStatus, listPluginConnections } from "@domain/platform/plugins/queries";
import {
  completeAccess,
  connectionSummary,
  disconnectBank,
  PluginActionError,
  refreshManifests,
  saveUserCredentials,
  setPluginActive,
  startAccess,
} from "@/platform/plugins/service";
import {
  type AccountDecision,
  chooseAccounts,
  exposedAccounts,
  readBank,
  runBankPass,
  tieBack,
} from "@/platform/plugins/sync";
import "@/app/plugin-wiring";
import { closeDatabase, resetDatabase } from "../../../../test/db";
import { createTestUser } from "../../../../test/users";
import { deleteAccount } from "../accounts/[id]/delete";
import { bankSink } from "./sink";

// The whole way of a bank's data, with everything real but the plugin: the runtime, the port's
// adapter and the accounts' and transactions' own services, on the test database. The plugin's
// answers are the contract's; the reading of a real bank is the anonymous fixture
// `test/fixtures/plugins/enablebanking-reading.json` (names, numbers, amounts and texts are
// shapes only).

const PLUGIN = "enablebanking";
const PROVIDER = "plugin:enablebanking";
const KEY = generateKeyPairSync("rsa", { modulusLength: 2048 })
  .privateKey.export({ type: "pkcs8", format: "pem" })
  .toString();
const BANK = { name: "Zeta Bank", country: "IT" };
const NOW = new Date("2026-11-15T10:00:00Z");
const PRESENT = { ip: "203.0.113.7", userAgent: "Browser/1" };

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
  capabilities: ["windowedHistory"],
  userSettings: [],
  connectionFields: [],
  egress: ["api.enablebanking.com"],
  schedule: { recommendedPerDay: 3, minIntervalMinutes: 360 },
  providesCategories: false,
};

interface Fixture {
  accounts: PluginAccount[];
  balances: SyncResponse["accounts"];
  transactions: SyncResponse["transactions"];
}
const REAL: Fixture = JSON.parse(
  readFileSync(join(process.cwd(), "test/fixtures/plugins/enablebanking-reading.json"), "utf8"),
);
const REAL_ANSWER: SyncResponse = syncResponseSchema.parse({
  accounts: REAL.balances,
  transactions: REAL.transactions,
  cursor: null,
  coverage: { from: null, to: null },
});

const ACCOUNT: PluginAccount = {
  externalId: "u-1",
  stableId: "hash-1",
  name: "Conto",
  identifier: "IT60X0542811101000000123456",
  currency: "EUR",
  kind: "CACC",
};

const movement = (
  patch: Partial<SyncResponse["transactions"][number]> = {},
): SyncResponse["transactions"][number] => ({
  accountExternalId: "u-1",
  externalId: "ref-1",
  status: "booked",
  bookingDate: "2026-11-10",
  valueDate: "2026-11-10",
  amount: "12.30",
  direction: "debit",
  currency: "EUR",
  text: ["PAGAMENTO POS", "NEGOZIO 123"],
  counterparty: "Negozio",
  merchantCategoryCode: "5411",
  bankTransactionCode: "PMNT · POSD",
  ...patch,
});

const answer = (list: SyncResponse["transactions"], balance = "100.00"): SyncResponse => ({
  accounts: [
    {
      externalId: "u-1",
      balances: [{ type: "ITAV", amount: balance, currency: "EUR", date: "2026-11-14" }],
      error: null,
    },
  ],
  transactions: list,
  cursor: null,
  coverage: { from: null, to: null },
});

interface Call {
  path: string;
  body: Record<string, unknown>;
}

/** A plugin that gives `accounts` on an access and `sync` (an answer, or a failure) on a reading. */
function fakePlugin(options: { accounts?: PluginAccount[]; session?: string } = {}) {
  const calls: Call[] = [];
  let sync: SyncResponse | { status: number; code: string } = answer([]);
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
        session: { id: options.session ?? "session-1", expiresAt: "2027-05-14T09:59:00.000Z" },
        institution: BANK,
        accounts: options.accounts ?? [ACCOUNT],
      });
    }
    if (path === PLUGIN_PATHS.sync) {
      return "code" in sync ? reply({ error: { code: sync.code } }, sync.status) : reply(sync);
    }
    return reply({ error: { code: "invalid_request" } }, 400);
  };
  return {
    calls,
    deps: { fetchFn },
    syncs: () => calls.filter((call) => call.path === PLUGIN_PATHS.sync),
    gives(next: SyncResponse | { status: number; code: string }) {
      sync = next;
    },
  };
}

type Plugin = ReturnType<typeof fakePlugin>;

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

/** A person with the plugin on, credentials saved and an access to the bank just given. */
async function connected(plugin: Plugin): Promise<{ ctx: Ctx; connectionId: string }> {
  const ctx = contextFor((await createTestUser()).id);
  await setPluginActive(ctx, { pluginId: PLUGIN, active: true }, NOW);
  await saveUserCredentials(
    ctx,
    { pluginId: PLUGIN, applicationId: "app-1", privateKey: KEY },
    NOW,
    plugin.deps,
  );
  return { ctx, connectionId: await access(ctx, plugin) };
}

async function access(ctx: Ctx, plugin: Plugin): Promise<string> {
  await startAccess(ctx, { pluginId: PLUGIN, sessionId: "s", institution: BANK }, NOW, plugin.deps);
  const state = plugin.calls.filter((call) => call.path === PLUGIN_PATHS.authStart).at(-1)?.body
    .state as string;
  const outcome = await completeAccess(
    ctx,
    { pluginId: PLUGIN, sessionId: "s", query: { state, code: "code-1", error: null }, presence: null },
    NOW,
    plugin.deps,
  );
  if (!outcome.ok) throw new Error(`access refused: ${outcome.error}`);
  return outcome.connectionId;
}

const asNew = (providerAccountId: string, name = "Zeta Conto"): AccountDecision => ({
  providerAccountId,
  currency: "EUR",
  target: { kind: "new", name, type: "checking" },
});

/** A person whose one account of the bank is tied to a new account here; no reading yet. */
async function chosen(plugin: Plugin) {
  const { ctx, connectionId } = await connected(plugin);
  const target = { pluginId: PLUGIN, connectionId };
  await chooseAccounts(ctx, { ...target, decisions: [asNew("hash-1")] }, bankSink, NOW);
  const [account] = await listAccounts(ctx);
  return { ctx, target, accountId: account.id };
}

const read = (
  ctx: Ctx,
  target: { pluginId: string; connectionId: string },
  plugin: Plugin,
  now = NOW,
  presence: typeof PRESENT | null = PRESENT,
) => readBank(ctx, { ...target, presence }, bankSink, now, plugin.deps);

/** Every movement of the person, through the module's own queries, oldest first. */
async function rowsOf(ctx: Ctx) {
  const accounts = await listAccounts(ctx, { includeArchived: true });
  const ids = (await Promise.all(accounts.map((account) => transactionIdsOfAccount(ctx, account.id)))).flat();
  return [...(await transactionsByIds(ctx, ids)).values()].sort(
    (a, b) => a.occurredAt.getTime() - b.occurredAt.getTime() || a.id.localeCompare(b.id),
  );
}

async function codeOf(work: Promise<unknown>): Promise<string> {
  const error = await work.then(
    () => null,
    (thrown: unknown) => thrown,
  );
  expect(error).toBeInstanceOf(PluginActionError);
  return (error as PluginActionError).code;
}

const later = (hours: number) => new Date(NOW.getTime() + hours * 3_600_000);

beforeEach(async () => {
  await resetDatabase();
  await refreshManifests(NOW, fakePlugin().deps);
});
afterAll(closeDatabase);

describe("the reading of a real bank (anonymous fixture)", () => {
  it("becomes accounts, balances and movements, as the person chose for each account", async () => {
    const plugin = fakePlugin({ accounts: REAL.accounts });
    const { ctx, connectionId } = await connected(plugin);
    const target = { pluginId: PLUGIN, connectionId };
    const savings = await createAccount(ctx, {
      name: "Risparmi",
      type: "savings",
      openingBalance: { on: "2024-01-01", cents: 900_000n },
    });

    const exposed = await exposedAccounts(ctx, target, bankSink);
    expect(exposed.chosen).toBe(false);
    expect(
      exposed.accounts.map((account) => [account.providerAccountId, account.kind, account.linked]),
    ).toEqual([
      ["stable-1", "CACC", null],
      ["stable-2", "SVGS", null],
      ["stable-3", "SVGS", null],
    ]);

    await chooseAccounts(
      ctx,
      {
        ...target,
        decisions: [
          asNew("stable-1", "Zeta Conto corrente"),
          {
            providerAccountId: "stable-2",
            currency: "EUR",
            target: { kind: "existing", accountId: savings.id },
          },
          { providerAccountId: "stable-3", target: { kind: "skip" } },
        ],
      },
      bankSink,
      NOW,
    );
    plugin.gives(REAL_ANSWER);
    const outcome = await read(ctx, target, plugin);

    const mine = await listAccounts(ctx);
    expect(
      mine.map((account) => [
        account.name,
        account.type,
        account.origin,
        account.provider,
        account.providerAccountId,
      ]),
    ).toEqual([
      ["Risparmi", "savings", "synced", PROVIDER, "stable-2"],
      ["Zeta Conto corrente", "checking", "synced", PROVIDER, "stable-1"],
    ]);
    const current = mine.find((account) => account.providerAccountId === "stable-1")!;

    // Only the two tied accounts are asked of the plugin, by the id of this access.
    expect(plugin.syncs()[0].body).toMatchObject({
      accounts: ["account-1", "account-2"],
      from: null,
      userPresent: PRESENT,
    });

    const wanted = REAL.transactions.filter((one) => one.accountExternalId !== "account-3");
    const rows = await rowsOf(ctx);
    expect(rows).toHaveLength(wanted.length);
    expect(outcome).toEqual({
      ok: true,
      created: wanted.length,
      updated: 0,
      accountErrors: 0,
      complete: true,
    });
    expect(rows.every((row) => row.accountId === current.id || row.accountId === savings.id)).toBe(true);
    expect(rows.filter((row) => row.type === "income")).toHaveLength(
      wanted.filter((one) => one.direction === "credit").length,
    );
    expect(rows.every((row) => (row.type === "income" ? row.amountCents > 0n : row.amountCents < 0n))).toBe(
      true,
    );
    // What the bank wrote stays on the movement, for the automatic categories of a later release.
    expect(rows.every((row) => row.rawText !== null && row.bankTransactionCode !== null)).toBe(true);
    expect(rows.every((row) => row.categoryId === null && row.merchantCategoryCode === null)).toBe(true);
    expect(rows.filter((row) => row.counterpartyName !== null)).toHaveLength(
      wanted.filter((one) => one.counterparty !== null).length,
    );

    // The balance entered by hand stays; the bank's reading is another row beside it (decision H26).
    const entries = await listBalanceEntries(ctx, savings.id);
    expect(
      entries.filter((entry) => entry.source === "manual").map((entry) => [entry.on, entry.balanceCents]),
    ).toEqual([["2024-01-01", 900_000n]]);
    expect(entries.some((entry) => entry.source === "provider")).toBe(true);

    const [run] = await listRuns(ctx, { connectionId });
    expect(run).toMatchObject({ kind: "transactions", state: "success", error: null });
    expect(run.counts).toMatchObject({ created: wanted.length, updated: 0, accountErrors: 0 });
    const [connection] = await listPluginConnections(ctx, PLUGIN);
    expect(connection.lastOkAt).toEqual(NOW);
    expect(connection.nextSyncAt).not.toBeNull();
    expect(connection.schedule.rules).toHaveLength(1);
    expect(await connectionSummary(ctx, connectionId)).toMatchObject({ accounts: 3, chosen: true });
  });

  it("read a second time creates nothing: every movement is recognised by the bank's reference", async () => {
    const plugin = fakePlugin({ accounts: REAL.accounts });
    const { ctx, connectionId } = await connected(plugin);
    const target = { pluginId: PLUGIN, connectionId };
    await chooseAccounts(
      ctx,
      { ...target, decisions: [asNew("stable-1", "A"), asNew("stable-2", "B"), asNew("stable-3", "C")] },
      bankSink,
      NOW,
    );
    plugin.gives(REAL_ANSWER);
    const first = await read(ctx, target, plugin);
    const before = await rowsOf(ctx);
    const second = await read(ctx, target, plugin, later(1));
    expect(first).toMatchObject({ ok: true, created: REAL.transactions.length });
    expect(second).toMatchObject({ ok: true, created: 0, updated: 0 });
    expect((await rowsOf(ctx)).map((row) => row.id)).toEqual(before.map((row) => row.id));
  });
});

describe("the categories after a reading (rewrite plan N3)", () => {
  it("are looked for by the cascade on every movement the bank brought, and on nothing else", async () => {
    const plugin = fakePlugin({ accounts: REAL.accounts });
    const { ctx, connectionId } = await connected(plugin);
    const target = { pluginId: PLUGIN, connectionId };
    await chooseAccounts(
      ctx,
      { ...target, decisions: [asNew("stable-1", "A"), asNew("stable-2", "B"), asNew("stable-3", "C")] },
      bankSink,
      NOW,
    );
    plugin.gives(REAL_ANSWER);

    await read(ctx, target, plugin);

    // The bank's manifest says it gives no category: its accounts are the ones the cascade reads.
    const bankAccounts = (await listAccounts(ctx)).map((account) => account.id);
    expect((await categorisableAccountIds(ctx)).sort()).toEqual([...bankAccounts].sort());
    const rows = await rowsOf(ctx);
    expect(rows.length).toBe(REAL.transactions.length);
    // Each one was read: it has the key of its text. This person has no label and no group, so
    // none is given a category, and none is marked as a choice of theirs.
    expect(rows.every((row) => row.categoryKey !== null)).toBe(true);
    expect(rows.every((row) => row.categoryId === null && row.categoryOrigin === null)).toBe(true);
    expect(rows.every((row) => row.locallyEdited.length === 0)).toBe(true);
  });
});

describe("the choice of the accounts", () => {
  it("is refused with nothing chosen, for an account that is not open to a bank, and for another person's connection", async () => {
    const plugin = fakePlugin();
    const { ctx, connectionId } = await connected(plugin);
    const target = { pluginId: PLUGIN, connectionId };
    const skip: AccountDecision = { providerAccountId: "hash-1", target: { kind: "skip" } };
    expect(await codeOf(chooseAccounts(ctx, { ...target, decisions: [skip] }, bankSink, NOW))).toBe(
      "no_choice",
    );
    expect(
      await codeOf(chooseAccounts(ctx, { ...target, decisions: [asNew("not-of-this-bank")] }, bankSink, NOW)),
    ).toBe("failed");

    const dollars = await createAccount(ctx, { name: "Dollari", type: "checking", currency: "USD" });
    const pension = await createAccount(ctx, { name: "Fondo", type: "pension" });
    const other = contextFor((await createTestUser()).id);
    const theirs = await createAccount(other, { name: "Altrui", type: "checking" });
    for (const accountId of [dollars.id, pension.id, theirs.id]) {
      const decision: AccountDecision = {
        providerAccountId: "hash-1",
        currency: "EUR",
        target: { kind: "existing", accountId },
      };
      expect(await codeOf(chooseAccounts(ctx, { ...target, decisions: [decision] }, bankSink, NOW))).toBe(
        "failed",
      );
    }
    expect((await listAccounts(ctx)).every((account) => account.origin === "manual")).toBe(true);
    expect((await getAccount(other, theirs.id))?.origin).toBe("manual");
    expect(await connectionSummary(ctx, connectionId)).toMatchObject({ accounts: 1, chosen: false });

    await setPluginActive(other, { pluginId: PLUGIN, active: true }, NOW);
    expect(
      await codeOf(chooseAccounts(other, { ...target, decisions: [asNew("hash-1")] }, bankSink, NOW)),
    ).toBe("not_found");
    expect(await codeOf(exposedAccounts(other, target, bankSink))).toBe("not_found");
  });

  it("does not add the bank's account twice: an IBAN already here refuses a new account (rewrite plan N4, H39)", async () => {
    const plugin = fakePlugin();
    const { ctx, connectionId } = await connected(plugin);
    const target = { pluginId: PLUGIN, connectionId };
    const mine = await createAccount(ctx, { name: "Conto", type: "checking" });
    await updateAccountSettings(ctx, mine.id, {
      ...mine,
      reference: "",
      iban: ACCOUNT.identifier,
      purpose: "",
      notes: "",
      lowBalanceCents: null,
    });
    const owners = await bankSink.ibanOwners(ctx, [ACCOUNT.identifier]);
    expect(owners.get(ACCOUNT.identifier!)).toEqual({ id: mine.id, name: "Conto", manual: true });

    expect(
      await codeOf(chooseAccounts(ctx, { ...target, decisions: [asNew("hash-1")] }, bankSink, NOW)),
    ).toBe("iban_exists");
    expect(await listAccounts(ctx)).toHaveLength(1);

    const existing: AccountDecision = {
      providerAccountId: "hash-1",
      currency: "EUR",
      target: { kind: "existing", accountId: mine.id },
    };
    await chooseAccounts(ctx, { ...target, decisions: [existing] }, bankSink, NOW);
    expect(await getAccount(ctx, mine.id)).toMatchObject({ iban: ACCOUNT.identifier, ibanFromSource: true });
  });

  it("gives an account tied before the IBAN at the next reading", async () => {
    const plugin = fakePlugin();
    const { ctx, target, accountId } = await chosen(plugin);
    await getPool().query("update accounts set iban = null, iban_from_source = false");
    await read(ctx, target, plugin);
    expect(await getAccount(ctx, accountId)).toMatchObject({
      iban: ACCOUNT.identifier,
      ibanFromSource: true,
    });
  });

  it("does not read before it is made", async () => {
    const plugin = fakePlugin();
    const { ctx, connectionId } = await connected(plugin);
    expect(await read(ctx, { pluginId: PLUGIN, connectionId }, plugin)).toEqual({
      ok: false,
      error: "not_chosen",
      retryAt: null,
    });
    expect(plugin.syncs()).toEqual([]);
  });
});

describe("the identity of a movement", () => {
  it("without a reference is a hash: read twice it is one row, and two equal movements of a day are two", async () => {
    const plugin = fakePlugin();
    const { ctx, target } = await chosen(plugin);
    const bare = movement({ externalId: null });
    plugin.gives(answer([bare, bare, movement({ externalId: null, amount: "5.00" })]));
    expect(await read(ctx, target, plugin)).toMatchObject({ ok: true, created: 3 });
    expect(await read(ctx, target, plugin, later(1))).toMatchObject({ ok: true, created: 0 });
    expect(await rowsOf(ctx)).toHaveLength(3);
  });

  it("leaves a pending movement out until the bank books it", async () => {
    const plugin = fakePlugin();
    const { ctx, target } = await chosen(plugin);
    plugin.gives(answer([movement({ status: "pending", externalId: "ref-9" })]));
    expect(await read(ctx, target, plugin)).toMatchObject({ ok: true, created: 0 });
    plugin.gives(answer([movement({ status: "booked", externalId: "ref-9" })]));
    expect(await read(ctx, target, plugin, later(1))).toMatchObject({ ok: true, created: 1 });
    const [row] = await rowsOf(ctx);
    expect(row).toMatchObject({
      amountCents: -1230n,
      type: "expense",
      payee: "Negozio",
      note: "PAGAMENTO POS NEGOZIO 123",
      rawText: "PAGAMENTO POS NEGOZIO 123",
      counterpartyName: "Negozio",
      merchantCategoryCode: "5411",
      bankTransactionCode: "PMNT · POSD",
    });
    // Noon of the booking day in the person's zone.
    expect(row.occurredAt).toEqual(new Date("2026-11-10T11:00:00Z"));
  });
});

describe("the readings after the first", () => {
  it("start ten days before the last day covered, and say who asks only when a person does", async () => {
    const plugin = fakePlugin();
    const { ctx, target } = await chosen(plugin);
    await read(ctx, target, plugin);
    await read(ctx, target, plugin, later(24), null);
    const [first, second] = plugin.syncs().map((call) => call.body);
    expect(first).toMatchObject({
      from: null,
      userPresent: PRESENT,
      session: { id: "session-1" },
      accounts: ["u-1"],
    });
    expect(second).toMatchObject({ from: "2026-11-05", userPresent: null });
  });

  it("wait six hours after the bank says no more, unless a person asks", async () => {
    const plugin = fakePlugin();
    const { ctx, target } = await chosen(plugin);
    plugin.gives({ status: 429, code: "rate_limited" });
    const refused = await read(ctx, target, plugin, NOW, null);
    expect(refused).toEqual({ ok: false, error: "rate_limited", retryAt: later(6) });
    const [run] = await listRuns(ctx, { connectionId: target.connectionId });
    expect(run).toMatchObject({ state: "failed", error: "rate_limited" });

    // Inside the wait an automatic reading does not call the bank, and leaves no run behind.
    plugin.gives(answer([movement()]));
    expect(await read(ctx, target, plugin, later(5), null)).toEqual({
      ok: false,
      error: "rate_limited",
      retryAt: later(6),
    });
    expect(await runBankPass(ctx, { id: target.connectionId, provider: PROVIDER }, bankSink, later(5))).toBe(
      "refused",
    );
    expect(plugin.syncs()).toHaveLength(1);
    expect(await listRuns(ctx, { connectionId: target.connectionId })).toHaveLength(1);

    // A person can still ask; and after the wait the automatic readings go on.
    expect(await read(ctx, target, plugin, later(5))).toMatchObject({ ok: true, created: 1 });
    expect(await read(ctx, target, plugin, later(7), null)).toMatchObject({ ok: true, created: 0 });
    expect(plugin.syncs()).toHaveLength(3);
  });

  it("stop when the access has ended: the connection waits for a renewal", async () => {
    const plugin = fakePlugin();
    const { ctx, target } = await chosen(plugin);
    plugin.gives({ status: 409, code: "consent_expired" });
    expect(await read(ctx, target, plugin, NOW, null)).toMatchObject({ ok: false, error: "consent_expired" });
    expect((await listPluginConnections(ctx, PLUGIN))[0].state).toBe("revoked");
    expect((await dueConnections(later(48))).map((due) => due.id)).not.toContain(target.connectionId);
  });

  it("mark the key as refused when the provider refuses it", async () => {
    const plugin = fakePlugin();
    const { ctx, target } = await chosen(plugin);
    plugin.gives({ status: 403, code: "auth" });
    expect(await read(ctx, target, plugin)).toMatchObject({ ok: false, error: "auth" });
    expect((await credentialsStatus(ctx, PLUGIN)).invalid).toBe(true);
  });

  it("record a failure as a code and write nothing", async () => {
    const plugin = fakePlugin();
    const { ctx, target } = await chosen(plugin);
    plugin.gives({ status: 502, code: "invalid_data" });
    expect(await read(ctx, target, plugin)).toEqual({ ok: false, error: "invalid_data", retryAt: null });
    expect(await rowsOf(ctx)).toEqual([]);
    expect((await listPluginConnections(ctx, PLUGIN))[0]).toMatchObject({
      state: "error",
      lastError: "invalid_data",
    });
    expect(await readSyncJob(ctx, target.connectionId, "transactions")).toMatchObject({ cursor: null });
  });

  it("fail as a whole when the bank could read no account, and go on when it read some", async () => {
    const plugin = fakePlugin();
    const { ctx, target } = await chosen(plugin);
    plugin.gives({ ...answer([]), accounts: [{ externalId: "u-1", balances: [], error: "provider_down" }] });
    expect(await read(ctx, target, plugin)).toMatchObject({ ok: false, error: "provider_down" });
  });
});

describe("turning the plugin off", () => {
  it("stops the readings of that person only, and turning it on starts them again", async () => {
    const plugin = fakePlugin();
    const { ctx, target } = await chosen(plugin);
    const other = await chosen(plugin);
    plugin.gives(answer([movement()]));
    await setPluginActive(ctx, { pluginId: PLUGIN, active: false }, NOW);

    const due = { id: target.connectionId, provider: PROVIDER };
    expect(await runBankPass(ctx, due, bankSink, NOW)).toBe("absent");
    expect(await read(ctx, target, plugin)).toEqual({ ok: false, error: "not_active", retryAt: null });
    expect(plugin.syncs()).toEqual([]);
    expect(await listRuns(ctx, { connectionId: target.connectionId })).toEqual([]);
    // The accounts stay what they were: tied to the bank, with their last reading.
    expect((await listAccounts(ctx))[0]).toMatchObject({ origin: "synced", provider: PROVIDER });

    expect(await read(other.ctx, other.target, plugin)).toMatchObject({ ok: true, created: 1 });
    await setPluginActive(ctx, { pluginId: PLUGIN, active: true }, NOW);
    expect(await read(ctx, target, plugin)).toMatchObject({ ok: true, created: 1 });
  });
});

describe("the dispatcher", () => {
  it("has a pass for a plugin's connections, registered by the application", async () => {
    expect(passFor(PROVIDER)?.kinds).toEqual(["accounts", "transactions"]);
    expect(passFor("plugin:another")?.provider).toBe("plugin:");
  });

  it("reads a bank that is due, and the failure of a plugin that does not answer is that connection's own", async () => {
    const plugin = fakePlugin();
    const { ctx, target } = await chosen(plugin);
    const [connection] = await listPluginConnections(ctx, PLUGIN);
    const when = new Date((connection.nextSyncAt as Date).getTime() + 1000);
    // The pass of the dispatcher speaks to the configured plugin, which nothing answers for here.
    const detail = await dispatchDueConnections(when);
    expect(detail).toMatchObject({ due: 1, failures: 1, "provider_plugin:enablebanking": 1 });
    const [run] = await listRuns(ctx, { connectionId: target.connectionId });
    expect(run).toMatchObject({ kind: "transactions", state: "failed", error: "plugin_down" });
    // The schedule moves on to the next of the three readings of the day.
    const [after] = await listPluginConnections(ctx, PLUGIN);
    expect((after.nextSyncAt as Date).getTime()).toBeGreaterThan(when.getTime());
  });
});

describe("renewing and disconnecting", () => {
  it("a renewed access keeps the choice, and the movements are recognised under the new ids of the access", async () => {
    const plugin = fakePlugin();
    const { ctx, target } = await chosen(plugin);
    plugin.gives(answer([movement()]));
    await read(ctx, target, plugin);

    const renewed = fakePlugin({ accounts: [{ ...ACCOUNT, externalId: "u-new" }], session: "session-2" });
    await startAccess(ctx, { pluginId: PLUGIN, sessionId: "s", institution: BANK }, NOW, renewed.deps);
    const state = renewed.calls.find((call) => call.path === PLUGIN_PATHS.authStart)?.body.state as string;
    const outcome = await completeAccess(
      ctx,
      { pluginId: PLUGIN, sessionId: "s", query: { state, code: "c", error: null }, presence: null },
      NOW,
      renewed.deps,
    );
    expect(outcome).toEqual({ ok: true, connectionId: target.connectionId, renewed: true });
    // The access before is closed at the provider once the new one is saved.
    expect(renewed.calls.find((call) => call.path === PLUGIN_PATHS.authRevoke)?.body).toMatchObject({
      session: { id: "session-1" },
    });
    expect(await connectionSummary(ctx, target.connectionId)).toMatchObject({ accounts: 1, chosen: true });

    renewed.gives(answer([movement({ accountExternalId: "u-new" })]));
    const again = await read(ctx, target, renewed, later(1));
    expect(again).toMatchObject({ ok: true, created: 0 });
    expect(renewed.syncs()[0].body).toMatchObject({ session: { id: "session-2" }, accounts: ["u-new"] });
    expect(await rowsOf(ctx)).toHaveLength(1);
  });

  it("disconnecting keeps the accounts tied, and connecting the same bank again ties each one back with no choice", async () => {
    const plugin = fakePlugin();
    const { ctx, target, accountId } = await chosen(plugin);
    plugin.gives(answer([movement()]));
    await read(ctx, target, plugin);

    await disconnectBank(ctx, target, plugin.deps);
    expect(await listPluginConnections(ctx, PLUGIN)).toEqual([]);
    // Disconnected, not kept by hand: tied to the bank's id of it, with everything it had.
    expect(await getAccount(ctx, accountId)).toMatchObject({
      origin: "synced",
      provider: PROVIDER,
      providerAccountId: "hash-1",
    });
    expect(await rowsOf(ctx)).toHaveLength(1);
    expect((await listBalanceEntries(ctx, accountId)).some((entry) => entry.source === "provider")).toBe(
      true,
    );

    // A new access to the same bank: a new id of the account inside the access, the same stable
    // id, and an account never seen. The known one goes back by itself; only the new one is asked.
    const SAVINGS: PluginAccount = { ...ACCOUNT, externalId: "u-9", stableId: "hash-9", kind: "SVGS" };
    const again = fakePlugin({
      accounts: [{ ...ACCOUNT, externalId: "u-2" }, SAVINGS],
      session: "session-2",
    });
    const connectionId = await access(ctx, again);
    const back = { pluginId: PLUGIN, connectionId };
    expect(await tieBack(ctx, back, bankSink, NOW)).toBe(true);
    expect(await connectionSummary(ctx, connectionId)).toMatchObject({ accounts: 2, chosen: true });
    const exposed = await exposedAccounts(ctx, back, bankSink);
    expect(exposed.accounts.map((one) => [one.providerAccountId, one.linked?.id ?? null])).toEqual([
      ["hash-1", accountId],
      ["hash-9", null],
    ]);
    expect(await listAccounts(ctx, { includeArchived: true })).toHaveLength(1);
    // Asked twice, nothing changes.
    expect(await tieBack(ctx, back, bankSink, NOW)).toBe(false);

    again.gives(answer([movement({ accountExternalId: "u-2" })]));
    expect(await read(ctx, back, again, later(1))).toMatchObject({ ok: true, created: 0 });
    expect(again.syncs()[0].body).toMatchObject({ session: { id: "session-2" }, accounts: ["u-2"] });
    expect((await rowsOf(ctx)).map((row) => row.accountId)).toEqual([accountId]);
    expect((await dueConnections(later(30 * 24))).some((due) => due.id === connectionId)).toBe(true);
  });

  it("connecting a bank again leaves an account archived meanwhile archived, and a first access to choose", async () => {
    const plugin = fakePlugin();
    const { ctx, target, accountId } = await chosen(plugin);
    await disconnectBank(ctx, target, plugin.deps);
    await archiveAccount(ctx, accountId);

    const connectionId = await access(ctx, fakePlugin({ session: "session-2" }));
    expect(await tieBack(ctx, { pluginId: PLUGIN, connectionId }, bankSink, NOW)).toBe(true);
    expect(await getAccount(ctx, accountId)).toMatchObject({
      state: "archived",
      providerAccountId: "hash-1",
    });

    // Somebody else's first access to the bank: nothing of theirs is tied, the choice stays theirs.
    const first = await connected(fakePlugin());
    expect(
      await tieBack(first.ctx, { pluginId: PLUGIN, connectionId: first.connectionId }, bankSink, NOW),
    ).toBe(false);
    expect(await connectionSummary(first.ctx, first.connectionId)).toMatchObject({
      accounts: 1,
      chosen: false,
    });
  });
});

describe("a bank disconnected and connected again (H55)", () => {
  it("keeps the accounts left out and the deleted ones out, and ties the others back", async () => {
    const SECOND: PluginAccount = { ...ACCOUNT, externalId: "u-2", stableId: "hash-2", identifier: null };
    const THIRD: PluginAccount = { ...ACCOUNT, externalId: "u-3", stableId: "hash-3", identifier: null };
    const plugin = fakePlugin({ accounts: [ACCOUNT, SECOND, THIRD] });
    const { ctx, connectionId } = await connected(plugin);
    const target = { pluginId: PLUGIN, connectionId };
    await chooseAccounts(
      ctx,
      {
        ...target,
        decisions: [
          asNew("hash-1", "A"),
          asNew("hash-2", "B"),
          { providerAccountId: "hash-3", target: { kind: "skip" } },
        ],
      },
      bankSink,
      NOW,
    );
    const b = (await listAccounts(ctx)).find((one) => one.name === "B")!;
    await deleteAccount(ctx, b.id);
    await disconnectBank(ctx, target, plugin.deps);

    const again = fakePlugin({
      accounts: [
        { ...ACCOUNT, externalId: "u-11" },
        { ...SECOND, externalId: "u-12" },
        { ...THIRD, externalId: "u-13" },
      ],
      session: "session-2",
    });
    const back = { pluginId: PLUGIN, connectionId: await access(ctx, again) };
    expect(await tieBack(ctx, back, bankSink, NOW)).toBe(true);
    const exposed = await exposedAccounts(ctx, back, bankSink);
    expect([...exposed.skipped].sort()).toEqual(["hash-2", "hash-3"]);
    // Nothing left to ask: every account is tied back or stays out.
    expect(
      exposed.accounts.filter(
        (one) => one.linked === null && !exposed.skipped.includes(one.providerAccountId),
      ),
    ).toEqual([]);
    expect((await listAccounts(ctx, { includeArchived: true })).map((one) => one.name)).toEqual(["A"]);

    // Chosen again, an account leaves the memory: the next time it is tied back like the others.
    await chooseAccounts(ctx, { ...back, decisions: [asNew("hash-3", "C")] }, bankSink, later(1));
    expect((await exposedAccounts(ctx, back, bankSink)).skipped).toEqual(["hash-2"]);
  });
});

describe("an account of the bank deleted and chosen again (PERS-419)", () => {
  const SECOND: PluginAccount = { ...ACCOUNT, externalId: "u-2", stableId: "hash-2", identifier: null };
  const both = (list: SyncResponse["transactions"]): SyncResponse => ({
    ...answer(list),
    accounts: [
      ...answer([]).accounts,
      {
        externalId: "u-2",
        balances: [{ type: "ITAV", amount: "5.00", currency: "EUR", date: "2026-11-14" }],
        error: null,
      },
    ],
  });

  it("is no longer read once deleted, and when chosen again is read alone, from the start", async () => {
    const plugin = fakePlugin({ accounts: [ACCOUNT, SECOND] });
    const { ctx, connectionId } = await connected(plugin);
    const target = { pluginId: PLUGIN, connectionId };
    await chooseAccounts(
      ctx,
      { ...target, decisions: [asNew("hash-1", "A"), asNew("hash-2", "B")] },
      bankSink,
      NOW,
    );
    plugin.gives(both([movement(), movement({ accountExternalId: "u-2", externalId: "ref-2" })]));
    expect(await read(ctx, target, plugin)).toMatchObject({ ok: true, created: 2 });
    const first = (await listAccounts(ctx)).find((one) => one.name === "A")!;

    await deleteAccount(ctx, first.id);
    expect(await getAccount(ctx, first.id)).toBeNull();
    // Deleted, it is no longer tied: the reading asks the bank for the other account only.
    await read(ctx, target, plugin, later(1));
    expect(plugin.syncs().at(-1)?.body.accounts).toEqual(["u-2"]);
    expect((await listAccounts(ctx)).map((one) => one.name)).toEqual(["B"]);
    // The choice offers it again, as an account not tied.
    const exposed = await exposedAccounts(ctx, target, bankSink);
    expect(exposed.accounts.find((one) => one.providerAccountId === "hash-1")?.linked).toBeNull();

    await chooseAccounts(ctx, { ...target, decisions: [asNew("hash-1", "A again")] }, bankSink, later(2));
    expect((await readSyncJob(ctx, connectionId, "transactions"))?.cursor?.fresh).toBe('["hash-1"]');
    expect(await read(ctx, target, plugin, later(3))).toMatchObject({ ok: true, created: 1 });
    const fresh = plugin.syncs().at(-1)!.body;
    expect(fresh.accounts).toEqual(["u-1"]);
    expect(fresh.from).toBeNull();
    const again = (await listAccounts(ctx)).find((one) => one.name === "A again")!;
    expect((await transactionIdsOfAccount(ctx, again.id)).length).toBe(1);

    // The next reading is the usual one again: every tied account, from where the last one ended.
    expect((await readSyncJob(ctx, connectionId, "transactions"))?.cursor?.fresh).toBeUndefined();
    await read(ctx, target, plugin, later(4));
    const usual = plugin.syncs().at(-1)!.body;
    expect(usual.accounts).toEqual(["u-1", "u-2"]);
    expect(usual.from).not.toBeNull();
  });
});
