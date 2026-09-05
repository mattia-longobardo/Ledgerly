import { describe, expect, it, vi } from "vitest";
import type { DocumentStore } from "../application/ports";
import { siloCredentialSchema, siloProvider, type SiloDisconnectContext } from "./silo-provider-adapter";

const creds = {
  endpoint: "https://silo.internal",
  bucket: "payroll",
  region: "us-east-1",
  accessKeyId: "AK",
  secretAccessKey: "SK",
};

function fakeStore(overrides: Partial<DocumentStore> = {}): DocumentStore {
  return {
    provider: "silo",
    put: async () => {},
    get: async () => null,
    delete: async () => {},
    listPrefix: async () => [],
    ...overrides,
  };
}

describe("siloProvider", () => {
  it("declares itself as a document provider with no syncs (Ruling R4-15)", () => {
    expect(siloProvider.code).toBe("payroll_silo");
    expect(siloProvider.capabilities).toEqual(["documents"]);
    expect(siloProvider.syncs).toEqual({});
    expect(siloProvider.webhook).toBeUndefined();
  });

  it("marks both secret fields secret so the connect form never echoes them back", () => {
    const secrets = siloProvider.credentialFields.filter((f) => f.secret).map((f) => f.name);
    expect(secrets.sort()).toEqual(["accessKeyId", "secretAccessKey"]);
  });

  it("rejects an incomplete credential at the schema, before anything is sealed", () => {
    expect(siloCredentialSchema.safeParse({ ...creds, bucket: "" }).success).toBe(false);
    expect(siloCredentialSchema.safeParse({ ...creds, endpoint: "not-a-url" }).success).toBe(false);
    expect(siloCredentialSchema.safeParse(creds).success).toBe(true);
  });

  it("testConnection writes, reads and deletes a probe object — a read-only key must not pass", async () => {
    const seen: string[] = [];
    const fetchImpl = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const req = new Request(input as URL | string, init);
      seen.push(`${req.method} ${new URL(req.url).pathname}`);
      return req.method === "GET" ? new Response(new Uint8Array([1]), { status: 200 }) : new Response(null, { status: 204 });
    });
    const result = await siloProvider.testConnection(creds, { fetchImpl });
    expect(result.ok).toBe(true);
    expect(seen.map((s) => s.split(" ")[0])).toEqual(["PUT", "GET", "DELETE"]);
    expect(seen[0]).toContain("/payroll/payroll/_probe/");
  });

  it("testConnection fails, with the status, when the credential cannot write", async () => {
    const fetchImpl = vi.fn(async () => new Response("denied", { status: 403 }));
    const result = await siloProvider.testConnection(creds, { fetchImpl });
    expect(result.ok).toBe(false);
    expect(result.message).toContain("403");
  });

  it("onDisconnect with purge deletes every object under the user's prefix and audits the count", async () => {
    const deleted: string[] = [];
    const audit = vi.fn(async () => {});
    const ctx: SiloDisconnectContext = {
      connection: { id: "c1", userId: "u1", provider: "payroll_silo" } as SiloDisconnectContext["connection"],
      policy: "purge",
      db: {} as SiloDisconnectContext["db"],
      clock: { now: () => new Date("2026-09-05T00:00:00Z") },
      audit,
      store: fakeStore({
        delete: async (k: string) => void deleted.push(k),
        listPrefix: async () => ["payroll/u1/2026/a.pdf", "payroll/u1/2025/b.pdf"],
      }),
    };
    await siloProvider.onDisconnect(ctx);
    expect(deleted.sort()).toEqual(["payroll/u1/2025/b.pdf", "payroll/u1/2026/a.pdf"]);
    expect(audit).toHaveBeenCalledWith(
      expect.objectContaining({ action: "integration.disconnect_applied", after: expect.objectContaining({ objectsPurged: 2 }) }),
    );
  });

  it("onDisconnect with keep deletes nothing", async () => {
    const deleted: string[] = [];
    const ctx: SiloDisconnectContext = {
      connection: { id: "c1", userId: "u1", provider: "payroll_silo" } as SiloDisconnectContext["connection"],
      policy: "keep",
      db: {} as SiloDisconnectContext["db"],
      clock: { now: () => new Date("2026-09-05T00:00:00Z") },
      audit: async () => {},
      store: fakeStore({
        delete: async (k: string) => void deleted.push(k),
        listPrefix: async () => ["payroll/u1/2026/a.pdf"],
      }),
    };
    await siloProvider.onDisconnect(ctx);
    expect(deleted).toEqual([]);
  });
});
