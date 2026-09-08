import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createLocalDocumentStore } from "./local-document-store";

let root = "";

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "payroll-store-"));
});
afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

const bytes = new TextEncoder().encode("%PDF-1.7 hello");

describe("createLocalDocumentStore", () => {
  it("names itself local, so the import row records which store holds the object", () => {
    expect(createLocalDocumentStore(root).provider).toBe("local");
  });

  it("round-trips bytes through nested key directories it creates itself", async () => {
    const store = createLocalDocumentStore(root);
    await store.put("payroll/u1/2026/abc.pdf", bytes, "application/pdf");
    expect(await store.get("payroll/u1/2026/abc.pdf")).toEqual(bytes);
  });

  it("answers null for a key that is not there, rather than throwing", async () => {
    expect(await createLocalDocumentStore(root).get("payroll/u1/2026/missing.pdf")).toBeNull();
  });

  it("delete is idempotent — purging an already-purged object is a no-op", async () => {
    const store = createLocalDocumentStore(root);
    await store.put("payroll/u1/2026/abc.pdf", bytes, "application/pdf");
    await store.delete("payroll/u1/2026/abc.pdf");
    await expect(store.delete("payroll/u1/2026/abc.pdf")).resolves.toBeUndefined();
    expect(await store.get("payroll/u1/2026/abc.pdf")).toBeNull();
  });

  it("listPrefix returns full keys under the prefix and nothing outside it", async () => {
    const store = createLocalDocumentStore(root);
    await store.put("payroll/u1/2026/a.pdf", bytes, "application/pdf");
    await store.put("payroll/u1/2025/b.pdf", bytes, "application/pdf");
    await store.put("payroll/u2/2026/c.pdf", bytes, "application/pdf");
    expect((await store.listPrefix("payroll/u1/")).sort()).toEqual([
      "payroll/u1/2025/b.pdf",
      "payroll/u1/2026/a.pdf",
    ]);
    expect(await store.listPrefix("payroll/u3/")).toEqual([]);
  });

  it("refuses a key that would escape the root", async () => {
    const store = createLocalDocumentStore(root);
    await expect(store.put("../../etc/passwd", bytes, "application/pdf")).rejects.toThrow(/invalid storage key/i);
    await expect(store.get("payroll/../../etc/passwd")).rejects.toThrow(/invalid storage key/i);
  });
});
