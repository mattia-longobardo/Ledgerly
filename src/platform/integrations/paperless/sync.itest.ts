import { eq } from "drizzle-orm";
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { uploadPayslip } from "@/modules/payroll/service";
import type { Ctx } from "@/platform/context";
import { getDb } from "@/platform/db/client";
import { allDocuments } from "../../../../test/documents";
import { closeDatabase, resetDatabase } from "../../../../test/db";
import { newContext } from "../../../../test/fixtures";
import { PAPERLESS_PROVIDER } from "../rules";
import { syncJobs } from "../schema";
import { listConnections, listRuns, saveConnection } from "../service";
import { isPaperlessBusy, syncPaperlessNow } from "./sync";

// The Paperless pull of docs/auth-design.md D5 against a real database and Silo, with Paperless
// itself played by a fake `fetch`: a payslip arrives, the cursor moves, a document the webhook
// already delivered comes back `duplicate`, and a refused token stops the next pass.

const BASE = "http://paperless.test";
let ctx: Ctx;

const PDF = new TextEncoder().encode("%PDF-1.4\n% paperless payslip\n%%EOF\n");

interface FakeDocument {
  id: number;
  document_type: number;
  modified: string;
}

function fakePaperless(documents: FakeDocument[], { status = 200 }: { status?: number } = {}) {
  const calls: string[] = [];
  const fetch = vi.fn(async (input: RequestInfo | URL) => {
    const url = new URL(String(input));
    calls.push(`${url.pathname}${url.search}`);
    if (status !== 200) return new Response("", { status });
    if (url.pathname === "/api/document_types/") {
      return Response.json({
        next: null,
        results: [
          { id: 48, name: "Payroll" },
          { id: 49, name: "Contract" },
        ],
      });
    }
    if (url.pathname === "/api/documents/") {
      const after = url.searchParams.get("modified__gt") ?? "";
      const types = (url.searchParams.get("document_type__id__in") ?? "").split(",").map(Number);
      const results = documents
        .filter((one) => types.includes(one.document_type) && Date.parse(one.modified) > Date.parse(after))
        .sort((a, b) => Date.parse(a.modified) - Date.parse(b.modified))
        .map((one) => ({ ...one, title: `doc ${one.id}`, original_file_name: `doc-${one.id}.pdf` }));
      return Response.json({ next: null, results });
    }
    const download = /^\/api\/documents\/(\d+)\/download\/$/.exec(url.pathname);
    if (download && url.searchParams.get("original") === "true") {
      return new Response(PDF, {
        headers: { "content-disposition": `attachment; filename="busta-${download[1]}.pdf"` },
      });
    }
    return new Response("", { status: 404 });
  });
  vi.stubGlobal("fetch", fetch);
  return { fetch, calls };
}

beforeEach(async () => {
  await resetDatabase();
  ctx = await newContext();
  await saveConnection(ctx, {
    provider: PAPERLESS_PROVIDER,
    credentials: { baseUrl: BASE, token: "paperless_test_token", payslipType: "Payroll" },
  });
});

afterEach(() => vi.unstubAllGlobals());
afterAll(closeDatabase);

async function cursor() {
  const [connection] = await listConnections(ctx);
  const [job] = await getDb().select().from(syncJobs).where(eq(syncJobs.connectionId, connection.id));
  return job?.cursor ?? null;
}

describe("syncPaperlessNow", () => {
  it("imports a payslip of the configured type, and only that, and moves the cursor", async () => {
    const paperless = fakePaperless([
      { id: 7, document_type: 48, modified: "2026-10-11T10:00:00+02:00" },
      { id: 8, document_type: 49, modified: "2026-10-12T10:00:00+02:00" },
    ]);
    const result = await syncPaperlessNow(ctx, new Date("2026-10-27T00:00:00Z"));
    expect(result).toMatchObject({ refused: null, counts: { created: 1, skipped: 0 } });
    const documents = await allDocuments(ctx.userId);
    expect(documents).toHaveLength(1);
    expect(documents[0]).toMatchObject({ kind: "payslip", fileName: "busta-7.pdf" });
    expect(await cursor()).toEqual({ modified: "2026-10-11T10:00:00+02:00" });
    // The first pass looks back 90 days, and asks only for the Payroll type.
    const list = paperless.calls.find((call) => call.startsWith("/api/documents/?")) ?? "";
    expect(new URLSearchParams(list.split("?")[1]).get("document_type__id__in")).toBe("48");
    expect(new URLSearchParams(list.split("?")[1]).get("modified__gt")).toBe("2026-07-29T00:00:00.000Z");
    // The token went in the header, the Paperless way, and nowhere else.
    expect(paperless.calls.every((call) => !call.includes("paperless_test_token"))).toBe(true);
    const [run] = await listRuns(ctx);
    expect(run).toMatchObject({ kind: "documents", state: "success" });
  });

  it("answers duplicate for a payslip the webhook already delivered, and creates nothing", async () => {
    await uploadPayslip(ctx, { name: "from-webhook.pdf", bytes: PDF });
    fakePaperless([{ id: 7, document_type: 48, modified: "2026-10-11T10:00:00+02:00" }]);
    const result = await syncPaperlessNow(ctx, new Date("2026-10-27T00:00:00Z"));
    expect(result?.counts).toMatchObject({ created: 0, skipped: 1 });
    expect(await allDocuments(ctx.userId)).toHaveLength(1);
  });

  it("resumes after the cursor: a document seen once is not downloaded again", async () => {
    const paperless = fakePaperless([{ id: 7, document_type: 48, modified: "2026-10-11T10:00:00+02:00" }]);
    await syncPaperlessNow(ctx, new Date("2026-10-27T00:00:00Z"));
    paperless.calls.length = 0;
    const again = await syncPaperlessNow(ctx, new Date("2026-10-27T01:00:00Z"));
    expect(again?.counts).toMatchObject({ created: 0, skipped: 0 });
    expect(paperless.calls.some((call) => call.includes("/download/"))).toBe(false);
  });

  it("marks the connection revoked on a refused token, and the next pass attempts nothing", async () => {
    fakePaperless([], { status: 401 });
    await expect(syncPaperlessNow(ctx)).rejects.toMatchObject({ kind: "token_rejected" });
    expect((await listConnections(ctx))[0].state).toBe("revoked");
    const paperless = fakePaperless([]);
    expect(await syncPaperlessNow(ctx)).toMatchObject({ refused: "revoked" });
    expect(paperless.calls).toEqual([]);
  });

  it("fails the pass, without guessing, when the named type does not exist", async () => {
    await saveConnection(ctx, {
      provider: PAPERLESS_PROVIDER,
      credentials: { baseUrl: BASE, token: "paperless_test_token", payslipType: "Buste paga" },
    });
    fakePaperless([{ id: 7, document_type: 48, modified: "2026-10-11T10:00:00+02:00" }]);
    await expect(syncPaperlessNow(ctx)).rejects.toThrow(/no document type named Buste paga/);
    expect(await allDocuments(ctx.userId)).toHaveLength(0);
    const [run] = await listRuns(ctx);
    expect(run).toMatchObject({ state: "failed" });
  });

  it("is null for a person with no Paperless link, and busy errors are recognisable", async () => {
    const other = await newContext();
    expect(await syncPaperlessNow(other)).toBeNull();
    expect(isPaperlessBusy(new Error("x"))).toBe(false);
  });
});
