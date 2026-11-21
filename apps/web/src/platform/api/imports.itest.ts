// The route of imports (rewrite plan R2, 05-refactor.md §5.5; audit PAY-2, IMP-4): the Server Action
// of the Payroll screen and `POST /imports` are one use case. The same payslip from either gives the
// same document, the same evidence and the same state; a file too large or of the wrong type is
// refused by both, as before.
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { MAX_DOCUMENT_BYTES } from "@domain/modules/imports/rules";
import { listEvidence } from "@domain/modules/imports/service";
import type { Ctx } from "@domain/platform/context";
import { getDb } from "@domain/platform/db/client";
import { jobQueue } from "@domain/platform/jobs/schema";
import { deleteFolder, ensureBucket } from "@domain/platform/storage";
import { closeDatabase, resetDatabase } from "../../../../../test/db";
import { createTestUser } from "../../../../../test/users";
import { MARCH } from "../../../../../test/fixtures/payroll/samples";
import { twinPdf } from "../../../../../test/fixtures/payroll/twin";

let signedIn: Ctx;
vi.mock("next/server", () => ({ after: () => {} }));
vi.mock("next/headers", () => ({ headers: async () => new Headers() }));
vi.mock("next/cache", () => ({ revalidatePath: () => {} }));
vi.mock("@/platform/auth/session", () => ({ requireSession: async () => signedIn }));

const { adapters } = await import("@/app/api/v1/[[...route]]/composition");
const { apiRoutes } = await import("@ledgerly/api");
const { uploadPayslipsAction } = await import("@/modules/payroll/actions");
const { readDocument } = await import("@ledgerly/domain/imports");

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

async function byAction(ctx: Ctx, ...files: File[]) {
  signedIn = ctx;
  const form = new FormData();
  for (const file of files) form.append("files", file);
  return uploadPayslipsAction(form);
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
});
