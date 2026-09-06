import { describe, expect, it } from "vitest";
import type { PayrollImportStatus, UseCaseDeps } from "./ports";
import { MemoryFundContributionSink } from "@/modules/funds/infrastructure/memory-contribution-sink";
import {
  MemoryPayrollComponentsRepository,
  MemoryPayrollImportsRepository,
  MemoryPayrollMappingRulesRepository,
  MemoryPayrollRecordsRepository,
} from "../infrastructure/memory-repositories";
import { PURGE_BATCH, purgeOne } from "./purge-expired-originals";

const NOW = new Date("2026-09-05T10:00:00Z");
const PAST = new Date("2020-01-01T00:00:00Z");
const USER = "00000000-0000-7000-8000-00000000000a";

function makeDeps(): UseCaseDeps & { audits: unknown[] } {
  const audits: unknown[] = [];
  return {
    imports: new MemoryPayrollImportsRepository(),
    records: new MemoryPayrollRecordsRepository(),
    components: new MemoryPayrollComponentsRepository(),
    mappingRules: new MemoryPayrollMappingRulesRepository(),
    funds: new MemoryFundContributionSink(),
    // `purgeOne` never deletes bytes itself — the orchestrator does that,
    // strictly before calling this function. A store that throws if touched
    // is what proves the split.
    documents: {
      provider: "local",
      put: async () => {
        throw new Error("purgeOne must never touch the document store");
      },
      get: async () => {
        throw new Error("purgeOne must never touch the document store");
      },
      delete: async () => {
        throw new Error("purgeOne must never touch the document store");
      },
      listPrefix: async () => [],
    },
    scanner: {
      scan: async () => {
        throw new Error("purgeOne must never call the scanner");
      },
    },
    clock: { now: () => NOW },
    audit: async (e) => void audits.push(e),
    audits,
  };
}

let sha = 0;
async function seed(deps: UseCaseDeps, status: PayrollImportStatus, retentionUntil: Date) {
  sha += 1;
  const created = await deps.imports.create({
    userId: USER, fileName: "a.pdf", mime: "application/pdf", sizeBytes: 10,
    sha256: String(sha).padStart(64, "0"), storageProvider: "local",
    storageKey: `payroll/${USER}/2026/${String(sha).padStart(32, "0")}.pdf`,
    idempotencyKey: null, replacesImportId: null, retentionUntil, uploadedVia: "ui",
  });
  return (await deps.imports.patch(USER, created.id, { status }))!;
}

describe("purgeOne", () => {
  it("clears storageKey and stamps purgedAt, keeping the row and its status (Ruling R4-5)", async () => {
    const deps = makeDeps();
    const imp = await seed(deps, "applied", PAST);
    await purgeOne(deps)(imp, NOW);
    const after = await deps.imports.get(USER, imp.id);
    expect(after).not.toBeNull();
    expect(after?.storageKey).toBeNull();
    expect(after?.purgedAt).toEqual(NOW);
    expect(after?.status).toBe("applied");
  });

  it("audits the purge with the retention date and status, never with the bytes or the storage key", async () => {
    const deps = makeDeps();
    const imp = await seed(deps, "rejected", PAST);
    await purgeOne(deps)(imp, NOW);
    expect(deps.audits).toEqual([
      {
        actorUserId: null,
        action: "payroll.original_purged",
        entityType: "payroll_import",
        entityId: imp.id,
        after: { retentionUntil: PAST.toISOString(), status: "rejected" },
      },
    ]);
  });

  it("PURGE_BATCH is 100 (Ruling R4-5's per-run cap)", () => {
    expect(PURGE_BATCH).toBe(100);
  });
});
