import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { organizations, users } from "@/lib/db/schema";
import { permissionsForRoles } from "@/platform/auth/permissions";
import type { Principal } from "@/platform/auth/principal";
import { closeDb, resetDb, testDb } from "@/test/db";
import { uploadPayslip } from "./upload";
import { resolveDocumentStore } from "./document-store-resolver";

const pdf = (extra = "") => new TextEncoder().encode(`%PDF-1.7\n${extra}`);

async function seedPrincipal(): Promise<Principal> {
  const db = await testDb();
  const [org] = await db.insert(organizations).values({ name: "P" }).returning();
  const [user] = await db.insert(users).values({ organizationId: org!.id, displayName: "A" }).returning();
  const roles = ["owner"] as const;
  return { userId: user!.id, organizationId: org!.id, roles: [...roles], permissions: permissionsForRoles([...roles]) };
}

describe("uploadPayslip", () => {
  beforeEach(resetDb);
  afterAll(closeDb);

  it("reserves the row, writes the bytes to the local store and leaves the import scanning", async () => {
    const principal = await seedPrincipal();
    const imported = await uploadPayslip(principal, {
      fileName: "Busta Paga Agosto 2026.pdf",
      mime: "application/pdf",
      bytes: pdf("body"),
    });
    expect(imported.status).toBe("scanning");
    expect(imported.storageProvider).toBe("local");

    const resolution = await resolveDocumentStore(principal.userId);
    expect(await resolution!.store.get(imported.storageKey!)).toEqual(pdf("body"));
  });

  it("answers a duplicate with the id of the import that already holds those bytes", async () => {
    const principal = await seedPrincipal();
    const first = await uploadPayslip(principal, { fileName: "a.pdf", mime: "application/pdf", bytes: pdf("same") });
    await expect(
      uploadPayslip(principal, { fileName: "again.pdf", mime: "application/pdf", bytes: pdf("same") }),
    ).rejects.toMatchObject({ name: "DuplicateImportError", existingImportId: first.id });
  });

  it("stamps a ten-year retention by default", async () => {
    const principal = await seedPrincipal();
    const imported = await uploadPayslip(principal, { fileName: "a.pdf", mime: "application/pdf", bytes: pdf("r") });
    expect(imported.retentionUntil.getUTCFullYear()).toBe(new Date().getUTCFullYear() + 10);
  });
});
