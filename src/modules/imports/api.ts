import "server-only";
import { after } from "next/server";
import { Hono } from "hono";
import { z } from "zod";
import { processCometaDocument, uploadCometaDocument } from "@/modules/funds/pension/imports";
import { processPayslip, uploadPayslip } from "@/modules/payroll/service";
import type { ApiEnv } from "@/platform/api/auth";
import { withToken } from "@/platform/api/auth";
import { fail } from "@/platform/api/errors";
import { redactForLog } from "@/platform/auth/logger";
import type { Ctx } from "@/platform/context";
import { DOCUMENT_KINDS, MAX_DOCUMENT_BYTES } from "./rules";
import { ImportError } from "./service";

/**
 * `POST /api/v1/imports` (spec §9.3, scope `imports`): the same pipeline the screen uses, reached
 * by a script instead of by a person.
 *
 * One endpoint, as the spec names it, so one router owns it — and the router belongs to the module
 * that owns the pipeline. It has to know which module reads which kind of document, because only
 * the caller knows whether a PDF is a payslip or a Cometa statement; the alternative, a route in
 * `platform/api` that knows three modules, would put that knowledge further from the pipeline
 * rather than closer to it.
 */
export const importsApi = new Hono<ApiEnv>();

const kindSchema = z.enum(DOCUMENT_KINDS);

/** Reads the document after the answer has gone out, exactly as the Server Actions do (§7.8). */
function readLater(ctx: Ctx, kind: z.infer<typeof kindSchema>, documentId: string): void {
  after(async () => {
    try {
      if (kind === "payslip") await processPayslip(ctx, documentId);
      else await processCometaDocument(ctx, documentId);
    } catch (error) {
      // Left `extracting`: the hourly sweep reads it again (spec §10.2), but said out loud here.
      console.error(`[api] reading ${documentId} failed`, redactForLog(error));
    }
  });
}

const REFUSALS: Partial<Record<string, "too_large" | "unsupported_format" | "invalid">> = {
  too_large: "too_large",
  unsupported_format: "unsupported_format",
  empty: "invalid",
  storage_failed: "invalid",
};

importsApi.post("/imports", withToken("imports"), async (c) => {
  const ctx = c.get("ctx");
  let form: FormData;
  try {
    form = await c.req.formData();
  } catch {
    return fail(c, "invalid");
  }
  const kind = kindSchema.safeParse(form.get("kind"));
  const file = form.get("file");
  if (!kind.success || !(file instanceof File)) return fail(c, "invalid");
  if (file.size > MAX_DOCUMENT_BYTES) return fail(c, "too_large");

  const upload = { name: file.name, bytes: new Uint8Array(await file.arrayBuffer()) };
  try {
    const result =
      kind.data === "payslip"
        ? await uploadPayslip(ctx, upload)
        : await uploadCometaDocument(ctx, kind.data, upload);
    if (!result.duplicate) readLater(ctx, kind.data, result.document.id);
    return c.json(
      {
        id: result.document.id,
        kind: result.document.kind,
        fileName: result.document.fileName,
        state: result.document.state,
        duplicate: result.duplicate,
      },
      result.duplicate ? 200 : 201,
    );
  } catch (error) {
    if (error instanceof ImportError) return fail(c, REFUSALS[error.code] ?? "invalid");
    throw error;
  }
});
