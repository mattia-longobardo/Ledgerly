// The route of imports (rewrite plan R2 and R3, 05-refactor.md §5.5; audit PAY-2, IMP-4): the Server
// Action the Payroll screen had and `POST /imports` are one use case. The same payslip from either
// gives the same document, the same evidence and the same state; a file too large or of the wrong
// type is refused by both, as before. The screen uploads through the route now (`uploadPayslips`),
// with the Server Action's answer; `byAction` is what the deleted action did, line for line.
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { MAX_DOCUMENT_BYTES } from "@domain/modules/imports/rules";
import { listDocuments, listEvidence } from "@domain/modules/imports/service";
import type { Ctx } from "@domain/platform/context";
import { getDb } from "@domain/platform/db/client";
import { jobQueue } from "@domain/platform/jobs/schema";
import { deleteFolder, ensureBucket } from "@domain/platform/storage";
import { closeDatabase, resetDatabase } from "../../../../../test/db";
import { createTestUser } from "../../../../../test/users";
import { APRIL, MARCH } from "../../../../../test/fixtures/payroll/samples";
import { twinPdf } from "../../../../../test/fixtures/payroll/twin";

vi.mock("next/server", () => ({ after: () => {} }));
vi.mock("next/headers", () => ({ headers: async () => new Headers() }));

const { adapters } = await import("@/app/api/v1/[[...route]]/composition");
const { apiRoutes } = await import("@ledgerly/api");
const { ImportError, readDocument, uploadDocuments } = await import("@ledgerly/domain/imports");
const { PAYSLIP_DOCUMENT } = await import("@ledgerly/domain/payroll");
const { uploadPayslips } = await import("@/modules/payroll/calls");

/** Whose session the routes see when the screen calls them. */
let session: Ctx;
const screenRoutes = apiRoutes({
  ...adapters,
  guard: () => async (context, next) => {
    context.set("ctx", session);
    await next();
  },
});
// `call` of the API client reaches the routes as the browser would, under `/api/v1`.
vi.stubGlobal("fetch", async (url: string, init: RequestInit) =>
  screenRoutes.request(url.replace(/^\/api\/v1/, ""), init),
);

/** The upload of the Payroll screen (`uploadPayslips`), as `ctx`, with each file's last progress. */
async function byScreen(ctx: Ctx, ...files: File[]) {
  session = ctx;
  const progress: string[] = [];
  const result = await uploadPayslips(files, (index, now) => (progress[index] = now));
  return { result, progress };
}

/** An answer of the upload without the ids, which differ from one person to the other. */
function shapeOf(result: Awaited<ReturnType<typeof uploadPayslips>>) {
  if (!result.ok) return result;
  return { ...result, uploaded: result.uploaded.map(({ name, duplicate }) => ({ name, duplicate })) };
}

function contextFor(userId: string): Ctx {
  return {
    userId,
    role: "user",
    locale: "en",
    timeZone: "Europe/Rome",
    numberFormat: "it-IT",
    displayCurrency: "EUR",
  };
}

/** `POST /imports` as `ctx`, past the guard (the guard has its own tests). */
async function upload(ctx: Ctx, file: File, kind = "payslip") {
  const routes = apiRoutes({
    ...adapters,
    guard: () => async (context, next) => {
      context.set("ctx", ctx);
      await next();
    },
  });
  const form = new FormData();
  form.set("kind", kind);
  form.set("file", file);
  const response = await routes.request("/imports", { method: "POST", body: form });
  return { status: response.status, body: await response.json() };
}

/** The deleted `uploadPayslipsAction` as `ctx`: the use case on the form's files, a refusal's code. */
async function byAction(ctx: Ctx, ...files: File[]) {
  try {
    const { uploaded, refused } = await uploadDocuments(ctx, PAYSLIP_DOCUMENT, files);
    return {
      ok: true as const,
      uploaded: uploaded.map(({ document, duplicate }) => ({
        id: document.id,
        name: document.fileName,
        duplicate,
      })),
      refused,
    };
  } catch (error) {
    if (error instanceof ImportError) return { ok: false as const, error: error.code };
    throw error;
  }
}

/** What a reading left, without what names the row or its owner. */
const HIDDEN = new Set(["id", "userId", "documentId", "createdAt", "updatedAt"]);
async function evidenceOf(ctx: Ctx, documentId: string) {
  return (await listEvidence(ctx, documentId)).map((row) =>
    Object.fromEntries(Object.entries(row).filter(([key]) => !HIDDEN.has(key))),
  );
}

const queued = async () => (await getDb().select().from(jobQueue)).map((task) => task.payload.documentId);

let alice: Ctx;
let bob: Ctx;

beforeAll(ensureBucket);
beforeEach(async () => {
  await resetDatabase();
  alice = contextFor((await createTestUser()).id);
  bob = contextFor((await createTestUser()).id);
});
afterAll(async () => {
  await deleteFolder("payslips/");
  await closeDatabase();
});

describe("POST /imports and the upload of the Payroll screen", () => {
  it("give the same document, evidence and state for the same payslip", async () => {
    const bytes = new Uint8Array(await twinPdf(MARCH));
    const fromAction = await byAction(alice, new File([bytes], "march.pdf"));
    expect(fromAction).toMatchObject({ ok: true, refused: [] });
    const actionId = (fromAction as { uploaded: { id: string }[] }).uploaded[0].id;

    const fromRoute = await upload(bob, new File([bytes], "march.pdf"));
    expect(fromRoute.status).toBe(201);
    expect(fromRoute.body).toMatchObject({ kind: "payslip", fileName: "march.pdf", duplicate: false });
    const routeId = fromRoute.body.id as string;

    // Both start the reading in the worker; the worker's task reads either the same way.
    expect((await queued()).sort()).toEqual([actionId, routeId].sort());
    const readByAction = await readDocument(alice, actionId);
    const readByRoute = await readDocument(bob, routeId);
    expect(readByAction?.state).toBe("needs_review");
    expect(readByRoute?.state).toBe(readByAction?.state);
    expect(readByRoute?.parserVersion).toBe(readByAction?.parserVersion);
    const evidence = await evidenceOf(alice, actionId);
    expect(evidence.length).toBeGreaterThan(0);
    expect(await evidenceOf(bob, routeId)).toEqual(evidence);

    // The same file again is the same document: 200 from the route, `duplicate` from the action.
    const again = await upload(bob, new File([bytes], "again.pdf"));
    expect(again).toMatchObject({ status: 200, body: { id: routeId, duplicate: true } });
    expect(await byAction(alice, new File([bytes], "again.pdf"))).toMatchObject({
      uploaded: [{ id: actionId, duplicate: true }],
    });
  });

  it("refuse a file too large or of the wrong type, as before", async () => {
    const tooLarge = () => new File([new Uint8Array(MAX_DOCUMENT_BYTES + 1)], "large.pdf");
    const text = () => new File([new TextEncoder().encode("hello")], "note.txt");

    expect(await upload(alice, tooLarge())).toEqual({ status: 413, body: { error: "too_large" } });
    expect(await upload(alice, text())).toEqual({ status: 415, body: { error: "unsupported_format" } });
    expect(await byAction(alice, tooLarge(), text())).toEqual({
      ok: true,
      uploaded: [],
      refused: [
        { name: "large.pdf", error: "too_large" },
        { name: "note.txt", error: "unsupported_format" },
      ],
    });
    // A fund's kind is refused before its size, and nothing is queued.
    expect(await upload(alice, tooLarge(), "cometa_position")).toEqual({
      status: 415,
      body: { error: "unsupported_format" },
    });
    expect(await queued()).toEqual([]);
    // No file, or more than 24, refuses the whole upload of the screen.
    expect(await byAction(alice)).toEqual({ ok: false, error: "empty" });
    expect(await byAction(alice, ...Array.from({ length: 25 }, text))).toEqual({
      ok: false,
      error: "too_many",
    });
  });

  it("name the use case's refusal of a 400 in its reason", async () => {
    expect(await upload(alice, new File([], "empty.pdf"))).toEqual({
      status: 400,
      body: { error: "invalid", reason: "empty" },
    });
    expect(await queued()).toEqual([]);
  });

  it("answer the same on the screen through the route as through the Server Action", async () => {
    const march = new Uint8Array(await twinPdf(MARCH));
    const april = new Uint8Array(await twinPdf(APRIL));
    const tooLarge = () => new File([new Uint8Array(MAX_DOCUMENT_BYTES + 1)], "large.pdf");
    const text = () => new File([new TextEncoder().encode("hello")], "note.txt");
    const blank = () => new File([], "blank.pdf");
    const batches: (() => File[])[] = [
      () => [new File([march], "march.pdf")],
      () => [new File([march], "again.pdf"), new File([april], "april.pdf"), tooLarge(), text(), blank()],
      () => [],
      () => Array.from({ length: 25 }, text),
    ];
    for (const batch of batches) {
      const fromAction = await byAction(alice, ...batch());
      const fromScreen = await byScreen(bob, ...batch());
      expect(shapeOf(fromScreen.result)).toEqual(shapeOf(fromAction));
    }
    // The documents and their state are the same for both people.
    const states = async (ctx: Ctx) =>
      (await listDocuments(ctx, ["payslip"])).map((row) => [row.fileName, row.state]).sort();
    expect(await states(bob)).toEqual(await states(alice));
  });

  it("follow each file of the screen's upload", async () => {
    const march = new Uint8Array(await twinPdf(MARCH));
    const text = () => new File([new TextEncoder().encode("hello")], "note.txt");
    expect((await byScreen(alice, new File([march], "march.pdf"), text())).progress).toEqual([
      "uploaded",
      "refused",
    ]);
    expect((await byScreen(alice, new File([march], "again.pdf"))).progress).toEqual(["duplicate"]);
    expect((await byScreen(alice, ...Array.from({ length: 25 }, text))).progress).toEqual([]);
  });
});
