import { createHmac } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import type { AuditInput } from "@/platform/audit/record";
import type { DisconnectContext, IntegrationConnection } from "@/platform/integrations/types";
import type { MemoryAccountsRepository, MemoryProviderLinksRepository } from "@/modules/accounts/infrastructure/memory-repositories";
import type { NewAccount, ProviderAccount } from "@/modules/accounts/application/ports";
import { unusedDb } from "@/test/integration-deps";
import { walletProvider } from "./wallet-provider-adapter";

vi.mock("@/lib/clients/wallet", () => ({
  getAccounts: vi.fn(async (opts: { token: string }) => {
    if (opts.token !== "good") throw new Error("401 from the Wallet API");
    return [
      {
        id: "w1",
        name: "ING - Salary",
        currencyCode: "EUR",
        archived: false,
        accountType: "general",
        balance: { currentBalance: 1234.5 },
      },
    ];
  }),
}));

/**
 * `onDisconnect` builds its own `accountDeps(ctx.db)` — this stands in for it
 * with the memory repositories so the policy tests never touch a real
 * database. The mocked module also exports `__disconnectFixture`, which the
 * tests below import to seed accounts and read the audit line back.
 */
vi.mock("@/modules/accounts/infrastructure/deps", async () => {
  const { MemoryAccountsRepository, MemoryProviderLinksRepository } = await import(
    "@/modules/accounts/infrastructure/memory-repositories"
  );
  const accounts = new MemoryAccountsRepository();
  const links = new MemoryProviderLinksRepository();
  const audit: AuditInput[] = [];
  return {
    accountDeps: () => ({
      accounts,
      links,
      clock: { now: () => new Date("2026-09-04T09:00:00Z") },
      audit: async (e: AuditInput) => {
        audit.push(e);
      },
    }),
    __disconnectFixture: { accounts, links, audit },
  };
});

interface DisconnectFixture {
  accounts: MemoryAccountsRepository;
  links: MemoryProviderLinksRepository;
  audit: AuditInput[];
}

async function disconnectFixture(): Promise<DisconnectFixture> {
  const mod = (await import("@/modules/accounts/infrastructure/deps")) as unknown as {
    __disconnectFixture: DisconnectFixture;
  };
  return mod.__disconnectFixture;
}

/**
 * `onDisconnect` reports through `ctx.audit` (the `DisconnectContext`'s own
 * port), not through the mocked `accountDeps(...).audit` — so this is wired to
 * the same `fixture.audit` array the tests read back from.
 */
function disconnectCtx(policy: DisconnectContext["policy"], userId: string, fixture: DisconnectFixture): DisconnectContext {
  return {
    connection: { ...connectionFixture(), userId },
    policy,
    db: unusedDb,
    clock: { now: () => new Date("2026-09-04T09:00:00Z") },
    audit: async (e) => {
      fixture.audit.push(e);
    },
  };
}

function walletAccount(over: Partial<NewAccount> = {}): NewAccount {
  return {
    userId: "u1",
    groupId: null,
    name: "ING - Salary",
    type: "checking",
    currency: "EUR",
    origin: "synced",
    provider: "wallet",
    status: "active",
    includeInNetWorth: true,
    notes: null,
    sortOrder: 0,
    ...over,
  };
}

function connectionFixture(): IntegrationConnection {
  return {
    id: "c1",
    userId: "u1",
    provider: "wallet",
    status: "connected",
    settings: {},
    lastTestAt: null,
    lastSyncAt: null,
    lastError: null,
    disconnectPolicy: "keep",
    version: 1,
    createdAt: new Date(0),
    updatedAt: new Date(0),
  };
}

describe("wallet provider adapter", () => {
  it("declares its code, capabilities and a single secret credential field", () => {
    expect(walletProvider.code).toBe("wallet");
    expect([...walletProvider.capabilities]).toContain("accounts");
    expect(walletProvider.credentialFields.map((f) => f.name)).toEqual(["token", "webhookSecret"]);
    expect(walletProvider.credentialFields[0]!.secret).toBe(true);
  });

  it("rejects an empty token through its credential schema", () => {
    expect(walletProvider.credentialSchema.safeParse({ token: "" }).success).toBe(false);
    expect(walletProvider.credentialSchema.safeParse({ token: "good" }).success).toBe(true);
  });

  it("reports a reachable provider and a refused one, never leaking the token", async () => {
    const ok = await walletProvider.testConnection({ token: "good" }, {});
    expect(ok.ok).toBe(true);
    expect(ok.message).toMatch(/1 account/);
    const bad = await walletProvider.testConnection({ token: "bad" }, {});
    expect(bad.ok).toBe(false);
    expect(bad.message).not.toContain("bad");
  });

  it("has a daily accounts sync in two phases, and no leave sync", () => {
    const accounts = walletProvider.syncs.accounts;
    expect(accounts?.schedule).toBe("daily");
    expect(typeof accounts?.fetch).toBe("function");
    expect(typeof accounts?.apply).toBe("function");
    expect(walletProvider.syncs.leave).toBeUndefined();
  });

  it("fetches with the credential and nothing else", async () => {
    // `IntegrationProvider.syncs` is typed `SyncHandler` (P = unknown), so the
    // cast is the price of calling through the framework's own contract rather
    // than the adapter's more specific internal type.
    const rows = (await walletProvider.syncs.accounts!.fetch({
      connection: connectionFixture(),
      credentials: { token: "good" },
      runId: "r1",
      clock: { now: () => new Date("2026-09-04T09:00:00Z") },
      cursor: null,
    })) as ProviderAccount[];
    // One `ProviderAccount`, already mapped out of Wallet's own shape — the
    // apply phase never sees a Wallet field. (`mapWalletAccount` itself is
    // exhaustively covered by `wallet-adapter.test.ts`; this asserts only that
    // `fetch` maps and does not hand the raw payload on.)
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      externalId: "w1",
      name: "ING - Salary",
      currency: "EUR",
      archived: false,
      balance: "1234.50",
      asOf: "2026-09-04",
    });
    expect(rows[0]).not.toHaveProperty("accountType");
  });

  it("verifies a webhook with the connection's own secret", () => {
    const body = '{"event":"accounts.changed"}';
    const secret = "s3cret";
    const signature = `sha256=${createHmac("sha256", secret).update(body, "utf8").digest("hex")}`;
    const headers = new Headers({ "x-signature": signature });
    expect(walletProvider.webhook!.verify({ rawBody: body, headers }, secret)).toBe(true);
    expect(walletProvider.webhook!.verify({ rawBody: body, headers }, "wrong")).toBe(false);
    expect(walletProvider.webhook!.toSyncRequests({ event: "accounts.changed" })).toEqual([
      { kind: "accounts", event: "accounts.changed" },
    ]);
    expect(walletProvider.webhook!.toSyncRequests({})).toEqual([{ kind: "accounts", event: "unknown" }]);
  });
});

describe("wallet provider adapter onDisconnect", () => {
  it("keep leaves every account exactly as it is and reports nothing", async () => {
    const fixture = await disconnectFixture();
    const auditBefore = fixture.audit.length;
    const account = await fixture.accounts.create(walletAccount({ userId: "keep-1" }));

    await walletProvider.onDisconnect(disconnectCtx("keep", "keep-1", fixture));

    const after = await fixture.accounts.get("keep-1", account.id);
    expect(after).toMatchObject({ status: "active", version: account.version });
    expect(fixture.audit.length).toBe(auditBefore);
  });

  it("archive archives every live wallet account, skips one already archived, and leaves other providers alone", async () => {
    const fixture = await disconnectFixture();
    const live = await fixture.accounts.create(walletAccount({ userId: "archive-1" }));
    const already = await fixture.accounts.create(
      walletAccount({ userId: "archive-1", name: "Old", status: "archived" }),
    );
    const other = await fixture.accounts.create(
      walletAccount({ userId: "archive-1", name: "Trek account", provider: "trek" }),
    );

    await walletProvider.onDisconnect(disconnectCtx("archive", "archive-1", fixture));

    expect(await fixture.accounts.get("archive-1", live.id)).toMatchObject({
      status: "archived",
      archivedAt: new Date("2026-09-04T09:00:00Z"),
    });
    expect(await fixture.accounts.get("archive-1", already.id)).toMatchObject({
      status: "archived",
      version: already.version, // untouched: it was already archived
    });
    expect(await fixture.accounts.get("archive-1", other.id)).toMatchObject({ status: "active" });
    const line = fixture.audit.at(-1);
    expect(line).toMatchObject({
      action: "integration.disconnect_applied",
      after: { provider: "wallet", policy: "archive", archived: 1, deleted: 0 },
    });
  });

  it("purge hard-deletes a synced wallet account with no references and marks its link missing", async () => {
    const fixture = await disconnectFixture();
    const account = await fixture.accounts.create(walletAccount({ userId: "purge-1" }));
    await fixture.links.upsertSeen(
      "purge-1",
      { provider: "wallet", entityType: "account", entityId: account.id, externalId: "w1", metadata: {} },
      new Date("2026-09-01T00:00:00Z"),
    );

    await walletProvider.onDisconnect(disconnectCtx("purge", "purge-1", fixture));

    expect(await fixture.accounts.get("purge-1", account.id)).toBeNull();
    expect(await fixture.links.liveFor("account", account.id)).toBeNull();
    const line = fixture.audit.at(-1);
    expect(line).toMatchObject({ after: { policy: "purge", archived: 0, deleted: 1 } });
  });

  it("purge archives instead of deleting when the account still has references", async () => {
    const fixture = await disconnectFixture();
    const referenced = await fixture.accounts.create(walletAccount({ userId: "purge-2" }));
    const original = fixture.accounts.hasReferences.bind(fixture.accounts);
    vi.spyOn(fixture.accounts, "hasReferences").mockImplementation(async (id) =>
      id === referenced.id ? true : original(id),
    );

    await walletProvider.onDisconnect(disconnectCtx("purge", "purge-2", fixture));

    expect(await fixture.accounts.get("purge-2", referenced.id)).toMatchObject({ status: "archived" });
    const line = fixture.audit.at(-1);
    expect(line).toMatchObject({ after: { policy: "purge", archived: 1, deleted: 0 } });
  });
});
