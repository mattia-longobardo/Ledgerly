import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { organizations, users } from "@/lib/db/schema";
import { permissionsForRoles, type RoleCode } from "@/platform/auth/permissions";
import { createApiApp } from "@/platform/http/app";
import { closeDb, resetDb, testDb } from "@/test/db";
import { uploadPayslip } from "../infrastructure/upload";

const pdf = (extra = "") => new TextEncoder().encode(`%PDF-1.7\n${extra}`);

async function seedUser() {
  const testdb = await testDb();
  const [org] = await testdb.insert(organizations).values({ name: "P" }).returning();
  const [user] = await testdb.insert(users).values({ organizationId: org!.id, displayName: "A" }).returning();
  return { userId: user!.id, organizationId: org!.id };
}

function appFor(userId: string, organizationId: string, roles: RoleCode[] = ["owner"]) {
  return createApiApp({
    db,
    now: () => new Date("2026-09-05T09:00:00Z"),
    rateLimitEnabled: false,
    authenticate: async () => ({
      principal: { userId, organizationId, roles, permissions: permissionsForRoles(roles) },
      method: "session",
    }),
  });
}

function upload(bytes: Uint8Array, fileName = "Busta Paga Agosto 2026.pdf"): FormData {
  const form = new FormData();
  // Cast needed under this TS/@types/node combination: `TextEncoder#encode`
  // returns a `Uint8Array<ArrayBufferLike>`, and DOM's `BlobPart` wants one
  // backed specifically by `ArrayBuffer` (excluding `SharedArrayBuffer`) — a
  // type-only mismatch, not a runtime one.
  form.append("file", new File([bytes] as BlobPart[], fileName, { type: "application/pdf" }));
  return form;
}

describe("payroll API", () => {
  beforeEach(resetDb);
  afterAll(closeDb);

  it("lists no imports for a fresh user", async () => {
    const { userId, organizationId } = await seedUser();
    const res = await appFor(userId, organizationId).request("/api/v1/payroll/imports", {
      headers: { "x-requested-with": "test" },
    });
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ items: [] });
  });

  it("uploads a PDF and returns the import with its status", async () => {
    const { userId, organizationId } = await seedUser();
    const res = await appFor(userId, organizationId).request("/api/v1/payroll/imports", {
      method: "POST",
      headers: { "x-requested-with": "test" },
      body: upload(pdf("one")),
    });
    expect(res.status).toBe(201);
    const body = (await res.json()) as { id: string; status: string; sha256: string };
    expect(body.status).toBe("scanning");
    expect(body.sha256).toMatch(/^[0-9a-f]{64}$/);
    expect(body).not.toHaveProperty("storageKey");
  });

  it("answers 409 duplicate with the existing import id on a second upload of the same bytes", async () => {
    const { userId, organizationId } = await seedUser();
    const app = appFor(userId, organizationId);
    const first = (await (await app.request("/api/v1/payroll/imports", {
      method: "POST", headers: { "x-requested-with": "test" }, body: upload(pdf("same")),
    })).json()) as { id: string };
    const res = await app.request("/api/v1/payroll/imports", {
      method: "POST", headers: { "x-requested-with": "test" }, body: upload(pdf("same")),
    });
    expect(res.status).toBe(409);
    const body = (await res.json()) as { error: { code: string; details?: { existingImportId?: string } } };
    expect(body.error.code).toBe("duplicate");
    expect(body.error.details?.existingImportId).toBe(first.id);
  });

  it("answers 422 for a file that is not a PDF", async () => {
    const { userId, organizationId } = await seedUser();
    const res = await appFor(userId, organizationId).request("/api/v1/payroll/imports", {
      method: "POST",
      headers: { "x-requested-with": "test" },
      body: upload(new TextEncoder().encode("<html>gotcha")),
    });
    expect(res.status).toBe(422);
    expect(((await res.json()) as { error: { code: string } }).error.code).toBe("validation_failed");
  });

  it("refuses a cookie-authenticated upload with no X-Requested-With", async () => {
    const { userId, organizationId } = await seedUser();
    const res = await appFor(userId, organizationId).request("/api/v1/payroll/imports", {
      method: "POST",
      body: upload(pdf("csrf")),
    });
    expect(res.status).toBe(403);
    expect(((await res.json()) as { error: { code: string } }).error.code).toBe("csrf_required");
  });

  it("refuses an upload from a viewer with 403 permission_denied", async () => {
    const { userId, organizationId } = await seedUser();
    const res = await appFor(userId, organizationId, ["viewer"]).request("/api/v1/payroll/imports", {
      method: "POST",
      headers: { "x-requested-with": "test" },
      body: upload(pdf("viewer")),
    });
    expect(res.status).toBe(403);
  });

  it("refuses to serve an original that has not cleared the scanner, with 409", async () => {
    const { userId, organizationId } = await seedUser();
    const principal = { userId, organizationId, roles: ["owner"] as RoleCode[], permissions: permissionsForRoles(["owner"]) };
    const imported = await uploadPayslip(principal, {
      fileName: "a.pdf", mime: "application/pdf", bytes: pdf("unscanned"),
    });
    const res = await appFor(userId, organizationId).request(`/api/v1/payroll/imports/${imported.id}/original`, {
      headers: { "x-requested-with": "test" },
    });
    expect(res.status).toBe(409);
    expect(((await res.json()) as { error: { code: string } }).error.code).toBe("conflict");
  });

  it("answers 428 when a verify arrives with no version", async () => {
    const { userId, organizationId } = await seedUser();
    const principal = { userId, organizationId, roles: ["owner"] as RoleCode[], permissions: permissionsForRoles(["owner"]) };
    const imported = await uploadPayslip(principal, { fileName: "a.pdf", mime: "application/pdf", bytes: pdf("v") });
    const res = await appFor(userId, organizationId).request(`/api/v1/payroll/imports/${imported.id}/verify`, {
      method: "POST",
      headers: { "x-requested-with": "test", "content-type": "application/json" },
      body: JSON.stringify({ month: "2026-08-01", isThirteenth: false, values: {} }),
    });
    expect(res.status).toBe(428);
  });

  it("answers 404 for another user's import", async () => {
    const owner = await seedUser();
    const other = await seedUser();
    const principal = {
      userId: owner.userId, organizationId: owner.organizationId,
      roles: ["owner"] as RoleCode[], permissions: permissionsForRoles(["owner"]),
    };
    const imported = await uploadPayslip(principal, { fileName: "a.pdf", mime: "application/pdf", bytes: pdf("mine") });
    const res = await appFor(other.userId, other.organizationId).request(`/api/v1/payroll/imports/${imported.id}`, {
      headers: { "x-requested-with": "test" },
    });
    expect(res.status).toBe(404);
  });

  it("returns empty earnings for a user with no records — never a zero row", async () => {
    const { userId, organizationId } = await seedUser();
    const res = await appFor(userId, organizationId).request("/api/v1/payroll/earnings", {
      headers: { "x-requested-with": "test" },
    });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ months: [], quarters: [], years: [] });
  });

  it("retries an import stuck in scanning, driving it through scanImport again", async () => {
    const { userId, organizationId } = await seedUser();
    const principal = { userId, organizationId, roles: ["owner"] as RoleCode[], permissions: permissionsForRoles(["owner"]) };
    // Freshly uploaded, never actually scanned yet (the cron job normally does
    // that): status "scanning", scanStatus "pending" — exactly the state
    // `/retry` should treat as "still waiting on the scanner" and re-drive
    // through `scanImport`, which (the default noop scanner always answering
    // "clean") should carry it through to "extracting".
    const imported = await uploadPayslip(principal, { fileName: "a.pdf", mime: "application/pdf", bytes: pdf("retry-scan") });
    expect(imported.status).toBe("scanning");
    const res = await appFor(userId, organizationId).request(`/api/v1/payroll/imports/${imported.id}/retry`, {
      method: "POST",
      headers: { "x-requested-with": "test" },
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { status: string; scanStatus: string };
    expect(body.status).toBe("extracting");
    expect(body.scanStatus).toBe("clean");
  });

  it("refuses a viewer's retry with 403 permission_denied", async () => {
    const { userId, organizationId } = await seedUser();
    const principal = { userId, organizationId, roles: ["owner"] as RoleCode[], permissions: permissionsForRoles(["owner"]) };
    // A viewer holds `payroll.read` only (Ruling R4-17) — never `payroll.upload`
    // — and retry is functionally "try uploading through the pipeline again".
    // Without its own permission check, `/retry` would let a viewer trigger a
    // real scanner call (and, for a stuck parse, a real LLM call) with no
    // upload or review right anywhere else in the module.
    const imported = await uploadPayslip(principal, { fileName: "a.pdf", mime: "application/pdf", bytes: pdf("retry-viewer") });
    const res = await appFor(userId, organizationId, ["viewer"]).request(`/api/v1/payroll/imports/${imported.id}/retry`, {
      method: "POST",
      headers: { "x-requested-with": "test" },
    });
    expect(res.status).toBe(403);
  });

  it("answers 409 conflict for a retry on a terminal import", async () => {
    const { userId, organizationId } = await seedUser();
    const principal = { userId, organizationId, roles: ["owner"] as RoleCode[], permissions: permissionsForRoles(["owner"]) };
    const imported = await uploadPayslip(principal, { fileName: "a.pdf", mime: "application/pdf", bytes: pdf("retry-terminal") });
    const app = appFor(userId, organizationId);
    const rejected = await app.request(`/api/v1/payroll/imports/${imported.id}/reject`, {
      method: "POST",
      headers: { "x-requested-with": "test", "content-type": "application/json" },
      body: JSON.stringify({ version: imported.version }),
    });
    expect(rejected.status).toBe(200);
    // Terminal (`rejected`): neither "still waiting on the scanner" nor
    // "clean-scanned but stuck parsing" — the branching that already avoids a
    // wasteful `scanImport`/`parseImport` call for a terminal import, exercised
    // here rather than just correct by inspection.
    const res = await app.request(`/api/v1/payroll/imports/${imported.id}/retry`, {
      method: "POST",
      headers: { "x-requested-with": "test" },
    });
    expect(res.status).toBe(409);
    expect(((await res.json()) as { error: { code: string } }).error.code).toBe("conflict");
  });
});
