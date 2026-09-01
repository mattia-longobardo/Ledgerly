import { isUnauthorizedError, requireUser, unauthorizedResponse } from "@/lib/auth/require-user";
import { previewStream } from "@/lib/clients/paperless";
import { HttpError } from "@/lib/clients/http";

export const dynamic = "force-dynamic";

/** Anything else is served as an opaque download rather than rendered inline. */
const INLINE_TYPES = new Set([
  "application/pdf",
  "image/png",
  "image/jpeg",
  "image/webp",
  "image/gif",
]);

/**
 * Server-side proxy for the Paperless preview. The browser must never see the
 * Paperless token, so the <iframe> points here and the credential stays in the
 * server's request. The body is piped through — nothing is buffered.
 */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  try {
    await requireUser();
  } catch (err) {
    if (isUnauthorizedError(err)) return unauthorizedResponse();
    throw err;
  }

  const { id } = await params;
  const documentId = Number(id);
  if (!Number.isInteger(documentId) || documentId <= 0) {
    return new Response("Not found", { status: 404 });
  }

  let upstream: Response;
  try {
    upstream = await previewStream(documentId);
  } catch (err) {
    if (err instanceof HttpError && err.status === 404) {
      return new Response("Not found", { status: 404 });
    }
    return new Response("The document preview is unavailable.", { status: 502 });
  }

  const declared = (upstream.headers.get("content-type") ?? "").split(";")[0]?.trim() ?? "";
  const contentType = INLINE_TYPES.has(declared) ? declared : "application/octet-stream";
  const length = upstream.headers.get("content-length");

  const headers = new Headers({
    "content-type": contentType,
    // Private to this session and never shared: no CDN, no disk cache.
    "cache-control": "private, no-store, max-age=0",
    "content-disposition": `inline; filename="payslip-${documentId}.pdf"`,
    "x-content-type-options": "nosniff",
  });
  if (length !== null) headers.set("content-length", length);

  return new Response(upstream.body, { status: 200, headers });
}
