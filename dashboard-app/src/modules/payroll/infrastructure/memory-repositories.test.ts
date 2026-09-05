import { describe, expect, it } from "vitest";
import type { NewPayrollComponent, NewPayrollImport, NewPayrollRecord } from "../application/ports";
import {
  MemoryLegacyFundDeposits,
  MemoryPayrollComponentsRepository,
  MemoryPayrollImportsRepository,
  MemoryPayrollMappingRulesRepository,
  MemoryPayrollRecordsRepository,
} from "./memory-repositories";

const USER_A = "user-a";
const USER_B = "user-b";
const RETENTION = new Date("2036-01-01T00:00:00Z");

function newImport(userId: string, sha: string, over: Partial<NewPayrollImport> = {}): NewPayrollImport {
  return {
    userId,
    fileName: "busta.pdf",
    mime: "application/pdf",
    sizeBytes: 1234,
    sha256: sha,
    storageProvider: "local",
    storageKey: `payroll/${userId}/2026/${sha.slice(0, 32)}.pdf`,
    idempotencyKey: null,
    replacesImportId: null,
    retentionUntil: RETENTION,
    uploadedVia: "ui",
    ...over,
  };
}

function newRecord(userId: string, importId: string, over: Partial<NewPayrollRecord> = {}): NewPayrollRecord {
  return {
    userId,
    importId,
    periodStart: "2026-08-01",
    periodEnd: "2026-08-31",
    payDate: null,
    kind: "ordinary",
    currency: "EUR",
    gross: "2500.00",
    net: "1800.00",
    verifiedAt: null,
    verifiedBy: null,
    corrections: null,
    ...over,
  };
}

function newComponent(over: Partial<NewPayrollComponent> = {}): NewPayrollComponent {
  return {
    recordId: "",
    code: "net",
    labelRaw: "Netto del mese",
    kind: "earning",
    amount: "1800.00",
    quantity: null,
    unit: "eur",
    currency: "EUR",
    confidence: "high",
    source: "rules",
    mappedTo: { kind: "earnings" },
    sortOrder: 0,
    ...over,
  };
}

describe("MemoryPayrollImportsRepository", () => {
  it("lists newest first and never shows another user's imports", async () => {
    const repo = new MemoryPayrollImportsRepository();
    await repo.create(newImport(USER_A, "a".repeat(64)));
    await repo.create(newImport(USER_A, "b".repeat(64)));
    await repo.create(newImport(USER_B, "c".repeat(64)));
    const mine = await repo.list(USER_A);
    expect(mine.map((i) => i.sha256)).toEqual(["b".repeat(64), "a".repeat(64)]);
  });

  it("filters by status and honours the limit", async () => {
    const repo = new MemoryPayrollImportsRepository();
    const first = await repo.create(newImport(USER_A, "a".repeat(64)));
    await repo.create(newImport(USER_A, "b".repeat(64)));
    await repo.patch(USER_A, first.id, { status: "needs_review" });
    expect((await repo.list(USER_A, { statuses: ["needs_review"] })).map((i) => i.id)).toEqual([first.id]);
    expect((await repo.list(USER_A, { limit: 1 })).length).toBe(1);
  });

  it("rejects a second import of the same bytes for the same user, naming the index", async () => {
    const repo = new MemoryPayrollImportsRepository();
    await repo.create(newImport(USER_A, "a".repeat(64)));
    await expect(repo.create(newImport(USER_A, "a".repeat(64)))).rejects.toThrow(/payroll_imports_user_sha_uq/);
  });

  it("lets two users import the same bytes", async () => {
    const repo = new MemoryPayrollImportsRepository();
    await repo.create(newImport(USER_A, "a".repeat(64)));
    await expect(repo.create(newImport(USER_B, "a".repeat(64)))).resolves.toBeTruthy();
  });

  it("rejects a repeated idempotency key but lets many nulls coexist", async () => {
    const repo = new MemoryPayrollImportsRepository();
    await repo.create(newImport(USER_A, "a".repeat(64), { idempotencyKey: "k1" }));
    await repo.create(newImport(USER_A, "b".repeat(64), { idempotencyKey: null }));
    await repo.create(newImport(USER_A, "c".repeat(64), { idempotencyKey: null }));
    await expect(repo.create(newImport(USER_A, "d".repeat(64), { idempotencyKey: "k1" }))).rejects.toThrow(
      /payroll_imports_user_idem_uq/,
    );
  });

  it("findBySha is scoped to the user", async () => {
    const repo = new MemoryPayrollImportsRepository();
    const created = await repo.create(newImport(USER_A, "a".repeat(64)));
    expect((await repo.findBySha(USER_A, "a".repeat(64)))?.id).toBe(created.id);
    expect(await repo.findBySha(USER_B, "a".repeat(64))).toBeNull();
  });

  it("patch bumps version and updatedAt, and ignores an explicit undefined", async () => {
    const repo = new MemoryPayrollImportsRepository();
    const created = await repo.create(newImport(USER_A, "a".repeat(64)));
    const patched = await repo.patch(USER_A, created.id, { status: "scanning", error: undefined });
    expect(patched?.version).toBe(created.version + 1);
    expect(patched?.status).toBe("scanning");
    expect(patched?.error).toBeNull();
    expect(patched!.updatedAt.getTime()).toBeGreaterThanOrEqual(created.updatedAt.getTime());
  });

  it("patch answers null for another user's import rather than touching it", async () => {
    const repo = new MemoryPayrollImportsRepository();
    const created = await repo.create(newImport(USER_A, "a".repeat(64)));
    expect(await repo.patch(USER_B, created.id, { status: "rejected" })).toBeNull();
    expect((await repo.get(USER_A, created.id))?.status).toBe("received");
  });

  it("listByStatusForAllUsers crosses users, oldest first, and honours the limit", async () => {
    const repo = new MemoryPayrollImportsRepository();
    const a = await repo.create(newImport(USER_A, "a".repeat(64)));
    const b = await repo.create(newImport(USER_B, "b".repeat(64)));
    expect((await repo.listByStatusForAllUsers(["received"], 10)).map((i) => i.id)).toEqual([a.id, b.id]);
    expect((await repo.listByStatusForAllUsers(["received"], 1)).map((i) => i.id)).toEqual([a.id]);
  });

  it("listPurgeableForAllUsers takes only terminal rows with a live key past their retention", async () => {
    const repo = new MemoryPayrollImportsRepository();
    const past = new Date("2020-01-01T00:00:00Z");
    const applied = await repo.create(newImport(USER_A, "a".repeat(64), { retentionUntil: past }));
    await repo.patch(USER_A, applied.id, { status: "applied" });
    const live = await repo.create(newImport(USER_A, "b".repeat(64), { retentionUntil: past }));
    await repo.patch(USER_A, live.id, { status: "needs_review" });
    const purged = await repo.create(newImport(USER_A, "c".repeat(64), { retentionUntil: past }));
    await repo.patch(USER_A, purged.id, { status: "rejected", storageKey: null, purgedAt: new Date() });
    const future = await repo.create(newImport(USER_A, "d".repeat(64)));
    await repo.patch(USER_A, future.id, { status: "applied" });

    const found = await repo.listPurgeableForAllUsers(new Date("2026-09-05T00:00:00Z"), 100);
    expect(found.map((i) => i.id)).toEqual([applied.id]);
  });
});

describe("MemoryPayrollRecordsRepository", () => {
  it("lists newest period first and hides superseded rows unless asked", async () => {
    const repo = new MemoryPayrollRecordsRepository();
    const july = await repo.create(newRecord(USER_A, "imp-1", { periodStart: "2026-07-01", periodEnd: "2026-07-31" }));
    const august = await repo.create(newRecord(USER_A, "imp-2"));
    await repo.supersede(USER_A, july.id, august.id, new Date("2026-09-01T00:00:00Z"));
    expect((await repo.list(USER_A)).map((r) => r.id)).toEqual([august.id]);
    expect((await repo.list(USER_A, { includeSuperseded: true })).map((r) => r.id)).toEqual([august.id, july.id]);
  });

  it("filters by an inclusive from/to window on periodStart", async () => {
    const repo = new MemoryPayrollRecordsRepository();
    await repo.create(newRecord(USER_A, "imp-1", { periodStart: "2026-07-01", periodEnd: "2026-07-31" }));
    await repo.create(newRecord(USER_A, "imp-2"));
    expect((await repo.list(USER_A, { from: "2026-08-01", to: "2026-08-31" })).map((r) => r.periodStart)).toEqual([
      "2026-08-01",
    ]);
  });

  it("rejects a second record for the same import", async () => {
    const repo = new MemoryPayrollRecordsRepository();
    await repo.create(newRecord(USER_A, "imp-1"));
    await expect(repo.create(newRecord(USER_A, "imp-1", { periodStart: "2026-09-01", periodEnd: "2026-09-30" }))).rejects.toThrow(
      /payroll_records_import_uq/,
    );
  });

  it("rejects a second live record for the same period and kind, and allows one after superseding", async () => {
    const repo = new MemoryPayrollRecordsRepository();
    const first = await repo.create(newRecord(USER_A, "imp-1"));
    await expect(repo.create(newRecord(USER_A, "imp-2"))).rejects.toThrow(/payroll_records_period_uq/);
    await repo.supersede(USER_A, first.id, "placeholder", new Date());
    await expect(repo.create(newRecord(USER_A, "imp-2"))).resolves.toBeTruthy();
  });

  it("allows the same period and kind for two different users", async () => {
    const repo = new MemoryPayrollRecordsRepository();
    await repo.create(newRecord(USER_A, "imp-1"));
    await expect(repo.create(newRecord(USER_B, "imp-2"))).resolves.toBeTruthy();
  });

  it("liveForPeriod ignores superseded rows", async () => {
    const repo = new MemoryPayrollRecordsRepository();
    const first = await repo.create(newRecord(USER_A, "imp-1"));
    expect((await repo.liveForPeriod(USER_A, "2026-08-01", "ordinary"))?.id).toBe(first.id);
    await repo.supersede(USER_A, first.id, "placeholder", new Date());
    expect(await repo.liveForPeriod(USER_A, "2026-08-01", "ordinary")).toBeNull();
  });

  it("update bumps version and leaves untouched fields alone", async () => {
    const repo = new MemoryPayrollRecordsRepository();
    const created = await repo.create(newRecord(USER_A, "imp-1"));
    const updated = await repo.update(USER_A, created.id, { net: "1850.00" });
    expect(updated?.net).toBe("1850.00");
    expect(updated?.gross).toBe("2500.00");
    expect(updated?.version).toBe(created.version + 1);
  });

  it("getByImport is scoped to the user", async () => {
    const repo = new MemoryPayrollRecordsRepository();
    const created = await repo.create(newRecord(USER_A, "imp-1"));
    expect((await repo.getByImport(USER_A, "imp-1"))?.id).toBe(created.id);
    expect(await repo.getByImport(USER_B, "imp-1")).toBeNull();
  });
});

describe("MemoryPayrollComponentsRepository", () => {
  it("replaceForRecord stamps the record id, orders by sortOrder and replaces wholesale", async () => {
    const repo = new MemoryPayrollComponentsRepository();
    await repo.replaceForRecord("rec-1", [
      newComponent({ code: "taxes", sortOrder: 1, labelRaw: "Totale trattenute", kind: "tax", amount: "700.00" }),
      newComponent({ code: "net", sortOrder: 0 }),
    ]);
    expect((await repo.listForRecord("rec-1")).map((c) => c.code)).toEqual(["net", "taxes"]);
    expect((await repo.listForRecord("rec-1")).every((c) => c.recordId === "rec-1")).toBe(true);

    await repo.replaceForRecord("rec-1", [newComponent({ code: "gross", labelRaw: "Totale competenze", amount: "2500.00" })]);
    expect((await repo.listForRecord("rec-1")).map((c) => c.code)).toEqual(["gross"]);
  });

  it("never touches another record's components", async () => {
    const repo = new MemoryPayrollComponentsRepository();
    await repo.replaceForRecord("rec-1", [newComponent()]);
    await repo.replaceForRecord("rec-2", [newComponent({ code: "gross", amount: "2500.00" })]);
    expect((await repo.listForRecord("rec-1")).map((c) => c.code)).toEqual(["net"]);
  });

  it("listForRecords batches, ordered by record then sortOrder", async () => {
    const repo = new MemoryPayrollComponentsRepository();
    await repo.replaceForRecord("rec-1", [newComponent()]);
    await repo.replaceForRecord("rec-2", [newComponent({ code: "gross", amount: "2500.00" })]);
    expect((await repo.listForRecords(["rec-1", "rec-2"])).map((c) => `${c.recordId}:${c.code}`)).toEqual([
      "rec-1:net",
      "rec-2:gross",
    ]);
    expect(await repo.listForRecords([])).toEqual([]);
  });

  it("normalises money to two decimals and quantity to six, as Postgres reads them back", async () => {
    const repo = new MemoryPayrollComponentsRepository();
    const [c] = await repo.replaceForRecord("rec-1", [
      newComponent({ amount: "1800.5", quantity: "88.25", unit: "hours" }),
    ]);
    expect(c!.amount).toBe("1800.50");
    expect(c!.quantity).toBe("88.250000");
  });
});

describe("MemoryPayrollMappingRulesRepository", () => {
  it("returns the seeded global rules plus this user's own, by priority then id", async () => {
    const repo = new MemoryPayrollMappingRulesRepository();
    repo.addUserRule(USER_A, { matchCode: null, matchLabel: "^Arretrati", componentKind: "earning", target: { kind: "earnings" }, priority: 10 });
    const rules = await repo.listFor(USER_A);
    expect(rules[0]!.priority).toBe(10);
    expect(rules.filter((r) => r.userId === null).length).toBeGreaterThan(0);
    expect(rules.every((r) => r.userId === null || r.userId === USER_A)).toBe(true);
  });

  it("never leaks another user's rule", async () => {
    const repo = new MemoryPayrollMappingRulesRepository();
    repo.addUserRule(USER_B, { matchCode: "x", matchLabel: null, componentKind: "info", target: { kind: "none" }, priority: 5 });
    expect((await repo.listFor(USER_A)).some((r) => r.userId === USER_B)).toBe(false);
  });
});

describe("MemoryLegacyFundDeposits", () => {
  it("writes one row per fund and month, replacing the previous figure", async () => {
    const funds = new MemoryLegacyFundDeposits(["cometa"]);
    expect(await funds.upsertForRecord({ fundSlug: "cometa", month: "2026-08-01", employee: "50.00", employer: "100.00" })).toBe("written");
    expect(await funds.upsertForRecord({ fundSlug: "cometa", month: "2026-08-01", employee: "60.00", employer: "100.00" })).toBe("written");
    expect(funds.rows).toEqual([
      { fundSlug: "cometa", month: "2026-08-01", amount: "160.00", employee: "60.00", employer: "100.00" },
    ]);
  });

  it("reports no_fund rather than inventing one", async () => {
    const funds = new MemoryLegacyFundDeposits([]);
    expect(await funds.upsertForRecord({ fundSlug: "cometa", month: "2026-08-01", employee: "50.00", employer: null })).toBe("no_fund");
    expect(funds.rows).toEqual([]);
  });

  it("reports no_amount and writes nothing when the payslip carried neither half", async () => {
    const funds = new MemoryLegacyFundDeposits(["cometa"]);
    expect(await funds.upsertForRecord({ fundSlug: "cometa", month: "2026-08-01", employee: null, employer: null })).toBe("no_amount");
    expect(funds.rows).toEqual([]);
  });
});
