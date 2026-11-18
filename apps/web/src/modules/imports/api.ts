import "server-only";
import { Hono } from "hono";
import { z } from "zod";
import { uploadPayslip } from "@ledgerly/domain/payroll";
import { enqueue } from "@ledgerly/domain/platform/jobs";
import { tasks } from "@/platform/jobs/queue";
import type { ApiEnv } from "@/platform/api/auth";
import { withToken } from "@/platform/api/auth";
import { fail } from "@/platform/api/errors";
import type { Ctx } from "@ledgerly/domain/platform/context";
import { DOCUMENT_KINDS, isReadKind, MAX_DOCUMENT_BYTES, type ReadKind } from "@ledgerly/domain/imports";
import { ImportError } from "@ledgerly/domain/imports";

/**
 * `POST /api/v1/imports` (spec §9.3, scope `imports`): the same pipeline the screen uses, reached
 * by a script instead of by a person.
 *
 * One endpoint, as the spec names it, so one router owns it — and the router belongs to the module
 * that owns the pipeline. It has to know which module reads which kind of document, because only
 * the caller knows what a PDF is; the alternative, a route in `platform/api` that knows the modules,
 * would put that knowledge further from the pipeline rather than closer to it.
 *
 * A fund's documents are not read any more (rewrite plan, decision H19). Their two kinds stay in
 * the contract, which only grows: a file sent with one of them is refused with `unsupported_format`
 * and is not stored (decision ST-26).
 */
export const importsApi = new Hono<ApiEnv>();

const kindSchema = z.enum(DOCUMENT_KINDS);

/** Reads the document in the worker, exactly as the Server Actions do (§7.8). */
async function readLater(ctx: Ctx, kind: ReadKind, documentId: string): Promise<void> {
  if (kind === "payslip") await enqueue(tasks.readDocument(ctx.userId, documentId));
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
  // Before the size and before any read of the file: nothing of it is kept.
  if (!isReadKind(kind.data)) return fail(c, "unsupported_format");
  if (file.size > MAX_DOCUMENT_BYTES) return fail(c, "too_large");

  const upload = { name: file.name, bytes: new Uint8Array(await file.arrayBuffer()) };
  try {
    const result = await uploadPayslip(ctx, upload);
    if (!result.duplicate) await readLater(ctx, kind.data, result.document.id);
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
