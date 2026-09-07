/**
 * `/api/metrics` reads `payroll_imports`, which carries FORCE ROW LEVEL
 * SECURITY. The endpoint has no principal — Prometheus scrapes it over the
 * internal network — so it must read under the system context. On the bare
 * pool the owner policy admits nothing and the gauge would report 0 for ever
 * without failing anything, which is exactly the shape of bug this file
 * exists to catch.
 */
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { closeDb, resetDb, testDb } from "@/test/db";
import { db } from "@/lib/db";
import { jobRuns, organizations, payrollImports, users } from "@/lib/db/schema";
import { withSystemContext } from "@/platform/db/context";
import { GET } from "./route";

const RETENTION = new Date("2036-01-01T00:00:00Z");

function anImport(userId: string, sha: string, status: string) {
  return {
    userId,
    status,
    fileName: "busta.pdf",
    sizeBytes: 1234,
    sha256: sha,
    storageProvider: "local" as const,
    retentionUntil: RETENTION,
  };
}

describe("GET /api/metrics", () => {
  beforeEach(resetDb);
  afterAll(closeDb);

  it("counts imports awaiting review across users, and reports job freshness", async () => {
    const harness = await testDb();
    const [org] = await harness.insert(organizations).values({ name: "P" }).returning();
    const created = await harness
      .insert(users)
      .values([
        { organizationId: org!.id, displayName: "A" },
        { organizationId: org!.id, displayName: "B" },
      ])
      .returning();
    const [a, b] = [created[0]!.id, created[1]!.id];

    await withSystemContext(harness, (tx) =>
      tx.insert(payrollImports).values([
        anImport(a, "a".repeat(64), "needs_review"),
        anImport(b, "b".repeat(64), "needs_ocr"),
        // Not awaiting a human: it must not inflate the gauge.
        anImport(a, "c".repeat(64), "received"),
      ]),
    );
    await harness.insert(jobRuns).values({
      jobName: "payroll_ingest",
      trigger: "cron",
      status: "success",
      finishedAt: new Date(),
    });

    // The bug this guards against: with no session context the owner policy
    // on `payroll_imports` hides every row, so a read on the bare pool sees
    // nothing at all. The endpoint must not read that way.
    expect(await db.select().from(payrollImports)).toEqual([]);

    const body = await (await GET()).text();

    expect(body).toContain("payslips_pending_verification 2");
    expect(body).toContain('job_runs_total{job="payroll_ingest",status="success"} 1');
    expect(body).toMatch(/job_last_success_timestamp\{job="payroll_ingest"\} \d/);
  });

  it("reports zero when nothing is waiting, rather than omitting the gauge", async () => {
    const body = await (await GET()).text();
    expect(body).toContain("payslips_pending_verification 0");
  });
});
