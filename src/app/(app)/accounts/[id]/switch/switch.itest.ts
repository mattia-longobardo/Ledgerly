// The switch of an account from a source to the bank (rewrite plan N4b), with everything real but
// the plugin and the source's network: the runtime, the port's adapter, the modules' services, on
// the test database. The source is a provider of test whose update is a function; the bank is a
// plugin whose answers are the contract's. Invented names and amounts only.
import { generateKeyPairSync } from "node:crypto";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { getAccount, listAccounts } from "@/modules/accounts/queries";
import { applyProviderAccounts, saveProviderBalance } from "@/modules/accounts/service";
import { openSwitchOf } from "@/modules/accounts/switching";
import type { IncomingTransaction } from "@/modules/transactions/rules";
import { upsertFromProvider } from "@/modules/transactions/service";
import type { Ctx } from "@/platform/context";
import { getPool } from "@/platform/db/client";
import { PROVIDERS } from "@/platform/integrations/rules";
import type { Fetch } from "@/platform/plugins/client";
import { PLUGIN_PATHS, type PluginAccount, type SyncResponse } from "@/platform/plugins/contract/calls";
import type { PluginManifest } from "@/platform/plugins/contract/manifest";
import {
  completeAccess,
  refreshManifests,
  saveUserCredentials,
  setPluginActive,
  startAccess,
} from "@/platform/plugins/service";
import { chooseAccounts, readBank } from "@/platform/plugins/sync";
import "@/app/plugin-wiring";
import { closeDatabase, resetDatabase } from "../../../../../../test/db";
import { createTestUser } from "../../../../../../test/users";
import { BANK_PLUGIN_ID } from "../../../banks/plugin";
import { bankSink } from "../../../banks/sink";
import {
  applySwitch,
  BANK_PROVIDER,
  checkSwitch,
  type SwitchDeps,
  SwitchFailure,
  undoSwitch,
} from "./switch";

const KEY = generateKeyPairSync("rsa", { modulusLength: 2048 })
  .privateKey.export({ type: "pkcs8", format: "pem" })
  .toString();
const BANK = { name: "Zeta Bank", country: "IT" };
// The first provider of the core that reads movements: the switch never asks which one it is.
const SOURCE = PROVIDERS[0];
const NOW = new Date("2026-11-15T10:00:00Z");
const CUT = "2026-11-15";
// An example IBAN of the standard: nobody's account.
const IBAN = "IT60X0542811101000000123456";

const MANIFEST: PluginManifest = {
  id: BANK_PLUGIN_ID,
  version: "0.1.0",
  contract: "1",
  labels: {
    name: { en: "Bank", it: "Banca" },
    description: { en: "Accounts of banks", it: "Conti delle banche" },
    steps: {},
    products: {},
  },
  capabilities: ["windowedHistory"],
  userSettings: [],
  connectionFields: [],
  egress: ["api.example.test"],
  schedule: { recommendedPerDay: 3, minIntervalMinutes: 360 },
  providesCategories: false,
};

const CURRENT: PluginAccount = {
  externalId: "u-cur",
  stableId: "acc-cur",
  name: "Conto",
  identifier: IBAN,
  currency: "EUR",
  kind: "CACC",
};
const SAVINGS: PluginAccount = {
  externalId: "u-sav",
  stableId: "acc-sav",
  name: "Risparmio",
  identifier: null,
  currency: "EUR",
  kind: "SVGS",
};

type BankMovement = SyncResponse["transactions"][number];
const bankMovement = (
  account: string,
  ref: string,
  day: string,
  amount: string,
  debit: boolean,
  text: string,
): BankMovement => ({
  accountExternalId: account,
  externalId: ref,
  status: "booked",
  bookingDate: day,
  valueDate: day,
  amount,
  direction: debit ? "debit" : "credit",
  currency: "EUR",
  text: [text],
  counterparty: null,
  merchantCategoryCode: null,
  bankTransactionCode: null,
});

/** The state the core sent with the last start of an access: the return carries it back. */
let accessState = "";

function fakeBank(state: { current: BankMovement[]; savings: BankMovement[]; balance: string }) {
  const fetchFn: Fetch = async (input, init) => {
    const path = new URL(String(input)).pathname;
    const body = init?.body ? (JSON.parse(String(init.body)) as Record<string, unknown>) : {};
    if (path === PLUGIN_PATHS.authStart) accessState = String(body.state);
    const reply = (value: unknown, status = 200) => new Response(JSON.stringify(value), { status });
    if (path === PLUGIN_PATHS.manifest) return reply(MANIFEST);
    if (path === PLUGIN_PATHS.verify) return reply({ access: "read-only" });
    if (path === PLUGIN_PATHS.authStart) return reply({ url: "https://bank.example/login" });
    if (path === PLUGIN_PATHS.authComplete) {
      return reply({
        session: { id: "session-1", expiresAt: "2027-05-14T09:59:00.000Z" },
        institution: BANK,
        accounts: [CURRENT, SAVINGS],
      });
    }
    if (path === PLUGIN_PATHS.sync) {
      const asked = body.accounts as string[];
      const accounts = asked.map((externalId) => ({
        externalId,
        balances:
          externalId === CURRENT.externalId
            ? [
                { type: "CLBD", amount: state.balance, currency: "EUR", date: CUT },
                { type: "ITAV", amount: "999.00", currency: "EUR", date: CUT },
              ]
            : [{ type: "CLBD", amount: "5000.00", currency: "EUR", date: CUT }],
        error: null,
      }));
      const transactions = [
        ...(asked.includes(CURRENT.externalId) ? state.current : []),
        ...(asked.includes(SAVINGS.externalId) ? state.savings : []),
      ];
      return reply({ accounts, transactions, cursor: null, coverage: { from: null, to: null } });
    }
    return reply({ error: { code: "invalid_request" } }, 400);
  };
  return fetchFn;
}

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

const at = (day: string) => new Date(`${day}T11:00:00Z`);
const sourceMovement = (id: string, day: string, cents: bigint, payee: string): IncomingTransaction => ({
  externalId: id,
  counterpartExternalId: null,
  occurredAt: at(day),
  amountCents: cents,
  currency: "EUR",
  type: cents < 0n ? "expense" : "income",
  state: "cleared",
  payee,
  note: null,
  categoryExternalId: null,
  categoryName: null,
  categoryGroupExternalId: null,
  categoryGroupName: null,
  labels: [],
});

interface World {
  ctx: Ctx;
  deps: SwitchDeps;
  bank: { current: BankMovement[]; savings: BankMovement[]; balance: string };
  accountId: string;
  savingsId: string;
  target: { connectionId: string; bankAccountId: string };
  updates: string[];
}

/**
 * A person with: an account kept by a source (with a year of history and a move to the savings in
 * March), a bank with the same account (not imported) and a savings account (imported).
 */
async function world(): Promise<World> {
  const ctx = contextFor((await createTestUser()).id);
  const bank = {
    current: [
      bankMovement("u-cur", "c-1", "2026-11-06", "12.00", true, "POS MENSA AZIENDALE"),
      bankMovement("u-cur", "c-2", "2026-11-10", "12.00", true, "POS MENSA AZIENDALE"),
      bankMovement("u-cur", "c-3", "2026-11-09", "45.10", true, "POS SUPERMERCATO CENTRO"),
      bankMovement("u-cur", "c-4", "2026-11-12", "7.00", true, "POS EDICOLA"),
      bankMovement("u-cur", "c-5", "2026-11-17", "3.50", true, "POS BAR STAZIONE"),
    ],
    savings: [bankMovement("u-sav", "s-1", "2026-03-06", "500.00", false, "GIROCONTO")],
    balance: "1000.00",
  };
  const fetchFn = fakeBank(bank);
  const updates: string[] = [];
  const deps: SwitchDeps = {
    fetchFn,
    source: { update: async (provider) => void updates.push(provider), connected: async () => true },
  };

  await refreshManifests(NOW, { fetchFn });
  await setPluginActive(ctx, { pluginId: BANK_PLUGIN_ID, active: true }, NOW);
  await saveUserCredentials(ctx, { pluginId: BANK_PLUGIN_ID, applicationId: "app-1", privateKey: KEY }, NOW, {
    fetchFn,
  });
  await startAccess(ctx, { pluginId: BANK_PLUGIN_ID, sessionId: "s", institution: BANK }, NOW, { fetchFn });
  const state = accessState;
  const outcome = await completeAccess(
    ctx,
    {
      pluginId: BANK_PLUGIN_ID,
      sessionId: "s",
      query: { state, code: "code-1", error: null },
      presence: null,
    },
    NOW,
    { fetchFn },
  );
  if (!outcome.ok) throw new Error(`access refused: ${outcome.error}`);
  await chooseAccounts(
    ctx,
    {
      pluginId: BANK_PLUGIN_ID,
      connectionId: outcome.connectionId,
      decisions: [
        {
          providerAccountId: "acc-sav",
          currency: "EUR",
          target: { kind: "new", name: "Risparmi", type: "savings" },
        },
        { providerAccountId: "acc-cur", target: { kind: "skip" } },
      ],
    },
    bankSink,
    NOW,
  );
  const savingsId = (await listAccounts(ctx)).find((one) => one.name === "Risparmi")!.id;
  // The savings' history comes with the bank's first reading, as in production.
  await readBank(
    ctx,
    { pluginId: BANK_PLUGIN_ID, connectionId: outcome.connectionId, presence: null },
    bankSink,
    NOW,
    { fetchFn },
  );

  await applyProviderAccounts(
    ctx,
    SOURCE,
    [
      {
        provider: SOURCE,
        providerAccountId: "src-1",
        name: "Conto corrente",
        type: "checking",
        currency: "EUR",
      },
    ],
    NOW,
  );
  const accountId = (await listAccounts(ctx)).find((one) => one.name === "Conto corrente")!.id;
  await upsertFromProvider(
    ctx,
    accountId,
    [
      sourceMovement("w-1", "2026-11-06", -1_200n, "Mensa"),
      sourceMovement("w-2", "2026-11-07", -1_200n, "Mensa"),
      sourceMovement("w-3", "2026-11-10", -1_200n, "Mensa"),
      sourceMovement("w-4", "2026-11-09", -4_510n, "Supermercato Centro"),
      sourceMovement("w-5", "2026-11-12", -700n, "Edicola"),
      sourceMovement("w-6", "2026-03-05", -50_000n, "Giroconto risparmi"),
      sourceMovement("w-7", "2026-02-01", 250_000n, "Stipendio"),
    ],
    { provider: SOURCE, now: NOW },
  );
  await saveProviderBalance(ctx, accountId, { on: CUT, cents: 100_000n }, NOW);
  return {
    ctx,
    deps,
    bank,
    accountId,
    savingsId,
    target: { connectionId: outcome.connectionId, bankAccountId: "acc-cur" },
    updates,
  };
}

/** Every row the dry run must not write, as one text. */
async function everything(): Promise<string> {
  const parts: string[] = [];
  for (const table of [
    "accounts",
    "transactions",
    "provider_links",
    "balance_entries",
    "sync_runs",
    "integration_connections",
    "account_switches",
    "switch_transfer_pairs",
    "interest_rules",
  ]) {
    const { rows } = await getPool().query(`select * from ${table} order by id`);
    parts.push(JSON.stringify(rows, (_key, value) => (typeof value === "bigint" ? value.toString() : value)));
  }
  return parts.join("\n");
}

/** Income and spending of the person, by month: the numbers the transfers change (X1). */
async function incomeAndSpending(ctx: Ctx): Promise<string> {
  const { rows } = await getPool().query(
    `select to_char(occurred_at, 'YYYY-MM') as month, type, sum(amount_cents)::text as total
     from transactions where user_id = $1 and hidden_at is null and removed_upstream_at is null
     group by 1, 2 order by 1, 2`,
    [ctx.userId],
  );
  return JSON.stringify(rows);
}

beforeEach(resetDatabase);
afterAll(closeDatabase);

describe("the dry run (criteria 1, 2, 7)", () => {
  it("writes nothing, and lists what is the same, what to check, the new movements and the transfers", async () => {
    const w = await world();
    const before = await everything();
    const report = await checkSwitch(w.ctx, w.accountId, w.target, null, NOW, w.deps);
    expect(await everything()).toBe(before);
    expect(w.updates).toEqual([SOURCE]);

    expect(report.cutDate).toBe(CUT);
    expect(report.matched.map((one) => one.text).sort()).toEqual(["Edicola", "Supermercato Centro"]);
    // Three "Mensa" of 12,00 on the source and two in the bank: none is tied (criterion 2).
    expect(report.toCheck).toEqual([
      expect.objectContaining({ cents: "-1200", local: expect.any(Array), bank: expect.any(Array) }),
    ]);
    expect(report.toCheck[0].local).toHaveLength(3);
    expect(report.toCheck[0].bank).toHaveLength(2);
    expect(report.fresh.map((one) => one.day)).toEqual(["2026-11-17"]);
    expect(report.balance).toEqual({ kind: "CLBD", on: CUT, local: "100000", bank: "100000", equal: true });
    // The move of March to the savings is a transfer, on the whole history (H40).
    expect(report.transfers.pairs).toEqual([
      expect.objectContaining({
        outDay: "2026-03-05",
        inDay: "2026-03-06",
        from: "Conto corrente",
        to: "Risparmi",
        cents: "50000",
      }),
    ]);
    expect(report.transfers.byYear).toEqual([{ year: 2026, count: 1, cents: "50000" }]);
  });

  it("blocks with a different balance: no apply, nothing written (criterion 3)", async () => {
    const w = await world();
    w.bank.balance = "1012.00";
    const report = await checkSwitch(w.ctx, w.accountId, w.target, null, NOW, w.deps);
    expect(report.balance.equal).toBe(false);
    const before = await everything();
    await expect(
      applySwitch(w.ctx, w.accountId, { ...w.target, fingerprint: report.fingerprint }, null, NOW, w.deps),
    ).rejects.toEqual(new SwitchFailure("stale"));
    expect(await everything()).toBe(before);
    expect(await openSwitchOf(w.ctx, w.accountId)).toBeNull();
  });

  it("refuses a report that changed since the person read it", async () => {
    const w = await world();
    const report = await checkSwitch(w.ctx, w.accountId, w.target, null, NOW, w.deps);
    w.bank.current.push(bankMovement("u-cur", "c-9", "2026-11-11", "1.00", true, "POS"));
    await expect(
      applySwitch(w.ctx, w.accountId, { ...w.target, fingerprint: report.fingerprint }, null, NOW, w.deps),
    ).rejects.toEqual(new SwitchFailure("stale"));
  });
});

describe("apply and undo (criteria 4, 5, 7)", () => {
  it("moves the account, writes the transfers and the new movements only, and the undo puts every number back", async () => {
    const w = await world();
    const numbersBefore = await incomeAndSpending(w.ctx);
    const report = await checkSwitch(w.ctx, w.accountId, w.target, null, NOW, w.deps);
    const outcome = await applySwitch(
      w.ctx,
      w.accountId,
      { ...w.target, fingerprint: report.fingerprint },
      null,
      NOW,
      w.deps,
    );
    expect(outcome).toEqual({ matched: 2, transfers: 1, fresh: 1 });

    const account = await getAccount(w.ctx, w.accountId);
    expect(account).toMatchObject({ provider: BANK_PROVIDER, providerAccountId: "acc-cur", iban: IBAN });
    const { rows } = await getPool().query<{ payee: string; type: string; day: string }>(
      `select payee, type, to_char(occurred_at at time zone 'Europe/Rome', 'YYYY-MM-DD') as day
       from transactions where account_id = $1 and removed_upstream_at is null order by occurred_at, payee`,
      [w.accountId],
    );
    // The history stays the source's; only the movement after the cut came from the bank.
    expect(rows.filter((row) => row.day > CUT).map((row) => row.day)).toEqual(["2026-11-17"]);
    expect(rows.filter((row) => row.day <= CUT)).toHaveLength(7);
    expect(rows.find((row) => row.payee === "Giroconto risparmi")?.type).toBe("transfer");
    // X1: income and spending of March go down by the transfer, and only by it.
    const after = JSON.parse(await incomeAndSpending(w.ctx)) as {
      month: string;
      type: string;
      total: string;
    }[];
    expect(after.filter((row) => row.month === "2026-03" && row.type === "transfer")).toHaveLength(1);

    // A second reading of the bank writes nothing more: the cut holds.
    const second = await readBank(
      w.ctx,
      { pluginId: BANK_PLUGIN_ID, connectionId: w.target.connectionId, presence: null },
      bankSink,
      new Date(NOW.getTime() + 7 * 3_600_000),
      w.deps,
    );
    expect(second.ok).toBe(true);
    const { rows: again } = await getPool().query(
      "select count(*)::int as n from transactions where account_id = $1",
      [w.accountId],
    );
    expect(again[0].n).toBe(8);

    // The source of before skips the account: no second account, and none marked as gone (§9.2).
    const accountsBefore = (await listAccounts(w.ctx, { includeArchived: true })).length;
    await applyProviderAccounts(
      w.ctx,
      SOURCE,
      [
        {
          provider: SOURCE,
          providerAccountId: "src-1",
          name: "Conto corrente",
          type: "checking",
          currency: "EUR",
        },
      ],
      NOW,
    );
    expect(await listAccounts(w.ctx, { includeArchived: true })).toHaveLength(accountsBefore);
    expect((await getAccount(w.ctx, w.accountId))?.provider).toBe(BANK_PROVIDER);

    await undoSwitch(w.ctx, w.accountId, NOW, w.deps);
    expect(await getAccount(w.ctx, w.accountId)).toMatchObject({
      provider: SOURCE,
      providerAccountId: "src-1",
      iban: null,
    });
    // Criterion 5: the numbers are the ones before the switch, transfers included.
    expect(await incomeAndSpending(w.ctx)).toBe(numbersBefore);
    const { rows: retired } = await getPool().query(
      "select count(*)::int as n from transactions where account_id = $1 and removed_upstream_at is not null",
      [w.accountId],
    );
    expect(retired[0].n).toBe(1);
    const { rows: links } = await getPool().query(
      "select count(*)::int as n from provider_links where provider = $1 and entity_type = 'transaction' and entity_id in (select id from transactions where account_id = $2)",
      [BANK_PROVIDER, w.accountId],
    );
    expect(links[0].n).toBe(0);
    expect(await openSwitchOf(w.ctx, w.accountId)).toBeNull();
  });

  it("stops when a manual movement did not reach the source (H38), and reads nothing of the bank", async () => {
    const w = await world();
    await getPool().query(
      `insert into transactions (user_id, account_id, occurred_at, amount_cents, currency, type, origin, send_state, payee)
       values ($1, $2, now(), -450, 'EUR', 'expense', 'manual', 'not_sent', 'Bar')`,
      [w.ctx.userId, w.accountId],
    );
    const report = await checkSwitch(w.ctx, w.accountId, w.target, null, NOW, w.deps);
    expect(report.unsent).toHaveLength(1);
    expect(report.matched).toEqual([]);
    expect(report.balance.equal).toBe(false);
  });
});
