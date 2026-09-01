import { verifyWebhookSecret } from "@/lib/auth/machine";
import { ingestPayslipDocument } from "@/lib/jobs/payslip-ingest";
import { finishRun, startRun } from "@/lib/repo/jobs";

export const dynamic = "force-dynamic";

/** Keys a Paperless workflow webhook body may carry the document id under. */
const ID_KEYS = ["document_id", "documentId", "doc_id", "docId", "id", "pk"] as const;

function asDocId(value: unknown): number | null {
  const n = typeof value === "number" ? value : typeof value === "string" ? Number(value) : NaN;
  return Number.isInteger(n) && n > 0 ? n : null;
}

/**
 * The payload is a HINT ONLY (PLAN §4): the id is the single thing taken from
 * it, and the document itself is then re-fetched from Paperless. Nothing else
 * in the body is read, so a spoofed or mistemplated field cannot reach the
 * parser or the database.
 */
function extractDocId(body: unknown, url: string): number | null {
  if (body && typeof body === "object") {
    const record = body as Record<string, unknown>;
    for (const key of ID_KEYS) {
      const id = asDocId(record[key]);
      if (id !== null) return id;
    }
    // Paperless templates sometimes nest the document under `document`.
    const nested = record.document;
    if (nested && typeof nested === "object") {
      const id = asDocId((nested as Record<string, unknown>).id);
      if (id !== null) return id;
    }
  }
  try {
    return asDocId(new URL(url).searchParams.get("id"));
  } catch {
    return null;
  }
}

export async function POST(req: Request) {
  const denied = verifyWebhookSecret(req);
  if (denied) return denied;

  let body: unknown = null;
  try {
    body = await req.json();
  } catch {
    body = null;
  }

  const docId = extractDocId(body, req.url);
  if (docId === null) {
    // Still observable: "did the webhook even fire?" must be answerable from
    // job_runs alone. The body is never logged — it is untrusted input.
    const run = await startRun({ jobName: "payslip_ingest", trigger: "webhook" });
    await finishRun(run.id, "failed", { error: "webhook payload carried no document id" });
    return Response.json({ error: "no document id" }, { status: 400 });
  }

  const result = await ingestPayslipDocument({ docId, trigger: "webhook" });
  return Response.json(result, { status: result.status === "failed" ? 500 : 200 });
}
