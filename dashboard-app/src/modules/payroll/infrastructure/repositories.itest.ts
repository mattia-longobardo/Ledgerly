import { eq } from "drizzle-orm";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { fundDeposits, legacyFunds, organizations, payrollMappingRules, payslips, users } from "@/lib/db/schema";
import { withSystemContext, withUserContext } from "@/platform/db/context";
import { closeDb, resetDb, testDb } from "@/test/db";
import type { NewPayrollComponent, NewPayrollImport, NewPayrollRecord } from "../application/ports";
import { DEFAULT_MAPPING_RULES } from "../domain/mapping";
import { DrizzlePayrollComponentsRepository } from "./drizzle-payroll-components-repository";
import { DrizzlePayrollImportsRepository } from "./drizzle-payroll-imports-repository";
import { DrizzlePayrollMappingRulesRepository } from "./drizzle-payroll-mapping-rules-repository";
import { DrizzlePayrollRecordsRepository } from "./drizzle-payroll-records-repository";
import { drizzleLegacyFundDeposits } from "./legacy-fund-deposits";

const RETENTION = new Date("2036-01-01T00:00:00Z");

async function seedUsers() {
  const db = await testDb();
  const [org] = await db.insert(organizations).values({ name: "P" }).returning();
  const [a] = await db.insert(users).values({ organizationId: org!.id, displayName: "A" }).returning();
  const [b] = await db.insert(users).values({ organizationId: org!.id, displayName: "B" }).returning();
  return { db, a: a!.id, b: b!.id };
}

function newImport(userId: string, sha: string, over: Partial<NewPayrollImport> = {}): NewPayrollImport {
  return {
    userId, fileName: "busta.pdf", mime: "application/pdf", sizeBytes: 1234, sha256: sha,
    storageProvider: "local", storageKey: `payroll/${userId}/2026/${sha.slice(0, 32)}.pdf`,
    idempotencyKey: null, replacesImportId: null, retentionUntil: RETENTION, uploadedVia: "ui", ...over,
  };
}

function newRecord(userId: string, importId: string, over: Partial<NewPayrollRecord> = {}): NewPayrollRecord {
  return {
    userId, importId, periodStart: "2026-08-01", periodEnd: "2026-08-31", payDate: null,
    kind: "ordinary", currency: "EUR", gross: "2500.00", net: "1800.00",
    verifiedAt: null, verifiedBy: null, corrections: null, ...over,
  };
}

function newComponent(over: Partial<NewPayrollComponent> = {}): NewPayrollComponent {
  return {
    recordId: "", code: "net", labelRaw: "Netto del mese", kind: "earning", amount: "1800.00",
    quantity: null, unit: "eur", currency: "EUR", confidence: "high", source: "rules",
    mappedTo: { kind: "earnings" }, sortOrder: 0, ...over,
  };
}

describe("Drizzle payroll repositories", () => {
  beforeEach(resetDb);
  afterAll(closeDb);

  it("lists imports newest first, exactly as the memory repository does", async () => {
    const { db, a } = await seedUsers();
    const shas = await withUserContext(db, { userId: a }, async (tx) => {
      const repo = new DrizzlePayrollImportsRepository(tx);
      await repo.create(newImport(a, "a".repeat(64)));
      await repo.create(newImport(a, "b".repeat(64)));
      return (await repo.list(a)).map((i) => i.sha256);
    });
    expect(shas).toEqual(["b".repeat(64), "a".repeat(64)]);
  });

  it("raises the sha unique index by name, so createImport can recognise it", async () => {
    // The driver wraps the native Postgres error (drizzle-orm's own
    // `DrizzleQueryError`, whose own `.message` is just "Failed query: ...");
    // the constraint name is on `.cause.message`, exactly as
    // `interests/infrastructure/repositories.itest.ts` asserts for its own
    // RLS-violation case. `createImport` (Task 9) is the layer that reads it.
    const { db, a } = await seedUsers();
    const err: unknown = await withUserContext(db, { userId: a }, async (tx) => {
      const repo = new DrizzlePayrollImportsRepository(tx);
      await repo.create(newImport(a, "a".repeat(64)));
      await repo.create(newImport(a, "a".repeat(64)));
    }).catch((e) => e);
    expect(err).toBeInstanceOf(Error);
    expect((err as { cause?: { message?: string } }).cause?.message).toMatch(/payroll_imports_user_sha_uq/);
  });

  it("patch bumps version and never touches another user's row", async () => {
    const { db, a, b } = await seedUsers();
    const created = await withUserContext(db, { userId: a }, (tx) =>
      new DrizzlePayrollImportsRepository(tx).create(newImport(a, "a".repeat(64))),
    );
    const asOther = await withUserContext(db, { userId: b }, (tx) =>
      new DrizzlePayrollImportsRepository(tx).patch(b, created.id, { status: "rejected" }),
    );
    expect(asOther).toBeNull();
    const patched = await withUserContext(db, { userId: a }, (tx) =>
      new DrizzlePayrollImportsRepository(tx).patch(a, created.id, { status: "scanning" }),
    );
    expect(patched?.version).toBe(created.version + 1);
    expect(patched?.status).toBe("scanning");
  });

  it("listPurgeableForAllUsers crosses users and takes only terminal rows with a live key", async () => {
    const { db, a, b } = await seedUsers();
    const past = new Date("2020-01-01T00:00:00Z");
    await withSystemContext(db, async (tx) => {
      const repo = new DrizzlePayrollImportsRepository(tx);
      const applied = await repo.create(newImport(a, "a".repeat(64), { retentionUntil: past }));
      await repo.patch(a, applied.id, { status: "applied" });
      const live = await repo.create(newImport(b, "b".repeat(64), { retentionUntil: past }));
      await repo.patch(b, live.id, { status: "needs_review" });
      const purged = await repo.create(newImport(b, "c".repeat(64), { retentionUntil: past }));
      await repo.patch(b, purged.id, { status: "rejected", storageKey: null, purgedAt: new Date() });
    });
    const found = await withSystemContext(db, (tx) =>
      new DrizzlePayrollImportsRepository(tx).listPurgeableForAllUsers(new Date("2026-09-05T00:00:00Z"), 100),
    );
    expect(found.map((i) => i.sha256)).toEqual(["a".repeat(64)]);
  });

  it("enforces one record per import and one live record per period, and frees the period on supersede", async () => {
    const { db, a } = await seedUsers();
    const importIds = await withUserContext(db, { userId: a }, async (tx) => {
      const repo = new DrizzlePayrollImportsRepository(tx);
      const first = await repo.create(newImport(a, "a".repeat(64)));
      const second = await repo.create(newImport(a, "b".repeat(64)));
      return [first.id, second.id];
    });
    const firstRecord = await withUserContext(db, { userId: a }, (tx) =>
      new DrizzlePayrollRecordsRepository(tx).create(newRecord(a, importIds[0]!)),
    );
    const err: unknown = await withUserContext(db, { userId: a }, (tx) =>
      new DrizzlePayrollRecordsRepository(tx).create(newRecord(a, importIds[1]!)),
    ).catch((e) => e);
    expect(err).toBeInstanceOf(Error);
    expect((err as { cause?: { message?: string } }).cause?.message).toMatch(/payroll_records_period_uq/);
    await withUserContext(db, { userId: a }, async (tx) => {
      const repo = new DrizzlePayrollRecordsRepository(tx);
      await repo.supersede(a, firstRecord.id, firstRecord.id, new Date());
      await repo.create(newRecord(a, importIds[1]!));
    });
    const live = await withUserContext(db, { userId: a }, (tx) => new DrizzlePayrollRecordsRepository(tx).list(a));
    expect(live.length).toBe(1);
    const all = await withUserContext(db, { userId: a }, (tx) =>
      new DrizzlePayrollRecordsRepository(tx).list(a, { includeSuperseded: true }),
    );
    expect(all.length).toBe(2);
  });

  it("raises the import unique index by name — one import cannot back two records", async () => {
    // Isolates `payroll_records_import_uq` specifically: the second record
    // uses a different periodStart/kind than the first so
    // `payroll_records_period_uq` cannot also be the one that fires. This is
    // the fourth of the plan's four global uniqueness claims
    // (`payroll_imports` sha/idempotency-key, `payroll_records` import/period)
    // and the only one not otherwise proven against real Postgres in this file.
    const { db, a } = await seedUsers();
    const imp = await withUserContext(db, { userId: a }, (tx) =>
      new DrizzlePayrollImportsRepository(tx).create(newImport(a, "a".repeat(64))),
    );
    await withUserContext(db, { userId: a }, (tx) =>
      new DrizzlePayrollRecordsRepository(tx).create(newRecord(a, imp.id)),
    );
    const err: unknown = await withUserContext(db, { userId: a }, (tx) =>
      new DrizzlePayrollRecordsRepository(tx).create(
        newRecord(a, imp.id, { periodStart: "2026-09-01", periodEnd: "2026-09-30", kind: "bonus" }),
      ),
    ).catch((e) => e);
    expect(err).toBeInstanceOf(Error);
    expect((err as { cause?: { message?: string } }).cause?.message).toMatch(/payroll_records_import_uq/);
  });

  it("replaceForRecord replaces wholesale and reads back the same scales the fake produces", async () => {
    const { db, a } = await seedUsers();
    const recordId = await withUserContext(db, { userId: a }, async (tx) => {
      const imp = await new DrizzlePayrollImportsRepository(tx).create(newImport(a, "a".repeat(64)));
      const rec = await new DrizzlePayrollRecordsRepository(tx).create(newRecord(a, imp.id));
      return rec.id;
    });
    const first = await withUserContext(db, { userId: a }, (tx) =>
      new DrizzlePayrollComponentsRepository(tx).replaceForRecord(recordId, [
        newComponent({ amount: "1800.5" }),
        newComponent({ code: "ferieBalance", labelRaw: "Ferie residue", kind: "leave_balance", amount: null, quantity: "88.25", unit: "hours", sortOrder: 1 }),
      ]),
    );
    expect(first.map((c) => c.code)).toEqual(["net", "ferieBalance"]);
    expect(first[0]!.amount).toBe("1800.50");
    expect(first[1]!.quantity).toBe("88.250000");

    const second = await withUserContext(db, { userId: a }, (tx) =>
      new DrizzlePayrollComponentsRepository(tx).replaceForRecord(recordId, [
        newComponent({ code: "gross", labelRaw: "Totale competenze", amount: "2500.00" }),
      ]),
    );
    expect(second.map((c) => c.code)).toEqual(["gross"]);
  });

  it("merges the code-level global catalogue with this user's own rules, and no other user's", async () => {
    const { db, a, b } = await seedUsers();
    // No migration seeds `payroll_mapping_rules` with the global catalogue; it
    // lives in `DEFAULT_MAPPING_RULES` and `DrizzlePayrollMappingRulesRepository.
    // listFor` merges it in, matching what `MemoryPayrollMappingRulesRepository`
    // already does — so both backends honor the port's documented contract
    // ("global rules and this user's own") identically.
    await withUserContext(db, { userId: a }, (tx) =>
      tx.insert(payrollMappingRules).values({
        userId: a, matchCode: "gross", matchLabel: null, componentKind: "bonus",
        target: { kind: "none" }, priority: 1,
      }),
    );
    await withUserContext(db, { userId: b }, (tx) =>
      tx.insert(payrollMappingRules).values({
        userId: b, matchCode: "net", matchLabel: null, componentKind: "bonus",
        target: { kind: "none" }, priority: 1,
      }),
    );

    const rules = await withUserContext(db, { userId: a }, (tx) => new DrizzlePayrollMappingRulesRepository(tx).listFor(a));

    const globalCodes = rules.filter((r) => r.userId === null).map((r) => r.matchCode);
    expect(globalCodes).toEqual(DEFAULT_MAPPING_RULES.map((r) => r.matchCode));
    expect(rules.some((r) => r.userId === a && r.matchCode === "gross" && r.componentKind === "bonus")).toBe(true);
    expect(rules.some((r) => r.userId === b)).toBe(false);
  });

  it("the legacy fund bridge upserts one row per month and reports an unknown slug", async () => {
    const { db, a } = await seedUsers();
    const outcome = await withUserContext(db, { userId: a }, (tx) =>
      drizzleLegacyFundDeposits(tx).upsertForRecord({
        fundSlug: "definitely-not-a-fund", month: "2026-08-01", employee: "50.00", employer: "100.00",
      }),
    );
    expect(outcome).toBe("no_fund");
  });

  it("the legacy fund bridge writes nothing when the payslip carried neither half", async () => {
    const { db, a } = await seedUsers();
    // `legacyFunds` is seeded by the application's bootstrap script
    // (`src/lib/db/migrate.ts`), not by anything in `drizzle/` — the migrations
    // folder `testDb()` runs — so the test DB starts with no fund rows at all.
    // Seed the one row this guard path needs, deliberately not the "written"
    // path Task 11's apply integration test owns.
    await db.insert(legacyFunds).values({ id: 1, slug: "cometa", name: "Fondo Cometa" });
    const outcome = await withUserContext(db, { userId: a }, (tx) =>
      drizzleLegacyFundDeposits(tx).upsertForRecord({ fundSlug: "cometa", month: "2026-08-01", employee: null, employer: null }),
    );
    expect(outcome).toBe("no_amount");
  });

  it("the legacy fund bridge's second write over a pre-existing row overwrites source and payslip_id (Finding 5)", async () => {
    const { db, a } = await seedUsers();
    await db.insert(legacyFunds).values({ id: 1, slug: "cometa", name: "Fondo Cometa" });
    // A row this bridge did not originally write — the legacy manual path
    // (`source: "manual"`) with a real `payslip_id` — proves what a *second*
    // write over a pre-existing row does to those two unmodelled fields, not
    // just what a first insert sets them to.
    const [legacySlip] = await db
      .insert(payslips)
      .values({ month: "2026-08-01", paperlessDocId: 1 })
      .returning();
    await db.insert(fundDeposits).values({
      fundId: 1,
      month: "2026-08-01",
      amount: "10.00",
      employeePart: "5.00",
      employerPart: "5.00",
      source: "manual",
      payslipId: legacySlip!.id,
    });

    const outcome = await withUserContext(db, { userId: a }, (tx) =>
      drizzleLegacyFundDeposits(tx).upsertForRecord({
        fundSlug: "cometa", month: "2026-08-01", employee: "50.00", employer: "100.00",
      }),
    );
    expect(outcome).toBe("written");

    const [row] = await db.select().from(fundDeposits).where(eq(fundDeposits.fundId, 1));
    expect(row).toMatchObject({ amount: "150.00", source: "payroll", payslipId: null });
  });
});
