/**
 * These actions are thin wrappers over the payroll use cases, so the suite
 * exercises them through the real use cases and in-memory repositories (via
 * the `ui/run` test seams) rather than mocking the use cases themselves —
 * the point proven here is that `next` is always read fresh from the
 * database *after* the write, never trusted from whatever queue shape the
 * caller happened to send in.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";
import type { PayslipExtraction } from "@/lib/contracts";
import type { UseCaseDeps } from "@/modules/payroll/application/ports";
import {
  MemoryLegacyFundDeposits,
  MemoryPayrollComponentsRepository,
  MemoryPayrollImportsRepository,
  MemoryPayrollMappingRulesRepository,
  MemoryPayrollRecordsRepository,
} from "@/modules/payroll/infrastructure/memory-repositories";
import { noopScanner } from "@/modules/payroll/infrastructure/noop-scanner";
import { setPayrollDepsFactoryForTests, setPrincipalForTests } from "@/modules/payroll/ui/run";
import { testPrincipal } from "@/test/principal";

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

const { applyPayslipAction, rejectPayslipAction } = await import("./payroll");

const principal = testPrincipal({ userId: "00000000-0000-7000-8000-00000000000a" });

function extraction(month: string): PayslipExtraction {
  return {
    parserVersion: "payroll-1.0.0",
    month,
    isThirteenth: false,
    textSource: "pdf",
    fields: { net: { value: 1800, confidence: "high", rules: 1800, llm: null } },
    checks: [],
  };
}

let deps: UseCaseDeps;
let sha = 0;

function makeDeps(): UseCaseDeps {
  return {
    imports: new MemoryPayrollImportsRepository(),
    records: new MemoryPayrollRecordsRepository(),
    components: new MemoryPayrollComponentsRepository(),
    mappingRules: new MemoryPayrollMappingRulesRepository(),
    funds: new MemoryLegacyFundDeposits(),
    documents: { provider: "local", put: async () => {}, get: async () => null, delete: async () => {}, listPrefix: async () => [] },
    scanner: noopScanner,
    clock: { now: () => new Date("2026-09-05T10:00:00Z") },
    audit: async () => {},
  };
}

async function seed(status: "needs_review" | "verified" | "applied", month: string) {
  sha += 1;
  const created = await deps.imports.create({
    userId: principal.userId,
    fileName: `payslip-${sha}.pdf`,
    mime: "application/pdf",
    sizeBytes: 10,
    sha256: String(sha).padStart(64, "0"),
    storageProvider: "local",
    storageKey: `payroll/${principal.userId}/${sha}.pdf`,
    idempotencyKey: null,
    replacesImportId: null,
    retentionUntil: new Date("2036-01-01T00:00:00Z"),
    uploadedVia: "ui",
  });
  return (await deps.imports.patch(principal.userId, created.id, {
    status,
    scanStatus: "clean",
    scanner: "none",
    extraction: extraction(month),
    confidence: { net: "high" },
  }))!;
}

beforeEach(() => {
  deps = makeDeps();
  setPayrollDepsFactoryForTests(() => deps);
  setPrincipalForTests(principal);
  sha = 0;
});

describe("applyPayslipAction", () => {
  it("computes `next` from a fresh queue read, not a snapshot the caller might be holding stale", async () => {
    const current = await seed("verified", "2026-06-01");
    const resolvedElsewhere = await seed("needs_review", "2026-07-01");
    const stillPending = await seed("needs_review", "2026-08-01");

    // Simulate another reviewer resolving `resolvedElsewhere` between this
    // page's last render and this user's Apply click. A caller's own
    // `pending` prop would still list it — proving `next` cannot come from
    // that snapshot, only from a fresh read after the write.
    await deps.imports.patch(principal.userId, resolvedElsewhere.id, { status: "applied" });

    const result = await applyPayslipAction({ id: current.id });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.next).toBe(stillPending.id);
  });

  it("answers null once nothing else is pending", async () => {
    const only = await seed("verified", "2026-06-01");
    const result = await applyPayslipAction({ id: only.id });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.next).toBeNull();
  });
});

describe("rejectPayslipAction", () => {
  it("also reads the queue fresh, never off a caller-supplied shape", async () => {
    const current = await seed("needs_review", "2026-06-01");
    const resolvedElsewhere = await seed("needs_review", "2026-07-01");
    const stillPending = await seed("needs_review", "2026-08-01");
    await deps.imports.patch(principal.userId, resolvedElsewhere.id, { status: "applied" });

    const result = await rejectPayslipAction({ id: current.id, version: current.version });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.next).toBe(stillPending.id);
  });

  /**
   * Finding 3, whole-branch review: `nextInQueue` used to query only
   * `["needs_review", "needs_ocr"]`, missing `verified` — so a confirmed but
   * not-yet-applied import was counted in the page's `pending` queue (via
   * `load-payroll.ts`'s `AWAITING`) but invisible to auto-advance, and a
   * reviewer's Reject would skip straight past it to a later-queued import or
   * report the queue empty. Both call sites now share `AWAITING_STATUSES`
   * from `ui/queue.ts`, so a `verified` import is a valid `next` candidate.
   */
  it("offers a verified-but-not-yet-applied import as `next`, not just needs_review/needs_ocr", async () => {
    const current = await seed("needs_review", "2026-06-01");
    const stillPending = await seed("verified", "2026-07-01");

    const result = await rejectPayslipAction({ id: current.id, version: current.version });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.next).toBe(stillPending.id);
  });
});
