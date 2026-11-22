import { isFundId } from "@ledgerly/domain/funds/client";

/**
 * The old returns page: the server's process answers where it went (`/api/web/funds/[id]/returns`),
 * because the target depends on the person's time zone and the web has no database (rewrite plan
 * R4). An id that cannot be a fund answers 404 here and never reaches a `Location` header.
 */
export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!isFundId(id)) return new Response(null, { status: 404 });
  const { search } = new URL(request.url);
  return new Response(null, {
    status: 307,
    headers: { Location: `/api/web/funds/${id}/returns${search}`, "Cache-Control": "no-store" },
  });
}
