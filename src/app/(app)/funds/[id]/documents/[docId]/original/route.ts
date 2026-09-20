import { requirePensionFund } from "@/modules/funds/pension/service";
import { FundError } from "@/modules/funds/service";
import { readOriginal } from "@/modules/imports/service";
import { requireSession } from "@/platform/auth/session";

const UUID = /^[0-9a-f-]{36}$/;

/**
 * A Cometa document's original, for the viewer (spec §7.8 "Originali"): the person's own document
 * only, inline, never cached, framable by this site alone (spec §5.2). 404 for a document that is
 * not theirs, or whose original was deleted at the end of its retention.
 */
export async function GET(
  _request: Request,
  { params }: RouteContext<"/funds/[id]/documents/[docId]/original">,
): Promise<Response> {
  const ctx = await requireSession();
  const { id, docId } = await params;
  if (!UUID.test(id) || !UUID.test(docId)) return new Response(null, { status: 404 });
  try {
    await requirePensionFund(ctx, id);
  } catch (error) {
    if (error instanceof FundError) return new Response(null, { status: 404 });
    throw error;
  }
  const original = await readOriginal(ctx, docId);
  if (!original) return new Response(null, { status: 404 });
  const name = encodeURIComponent(original.fileName);
  return new Response(new Uint8Array(original.bytes), {
    headers: {
      "Content-Type": original.mime,
      "Content-Length": String(original.bytes.length),
      "Content-Disposition": `inline; filename*=UTF-8''${name}`,
      "Cache-Control": "private, no-store",
      "Content-Security-Policy": "default-src 'none'; frame-ancestors 'self'",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
