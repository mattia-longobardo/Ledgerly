import { isFundId, returnsTarget } from "@ledgerly/domain/funds";
import type { Query } from "@ledgerly/domain/investments";
import { today } from "@ledgerly/domain/shared/dates";
import { sessionCtxOf } from "@/platform/auth/signed-in";

export const dynamic = "force-dynamic";

/**
 * The old returns page (docs/design/funds-ux.md §6, F4), reached through `/funds/[id]/returns` of the
 * web (rewrite plan R4): the Valuations tab has its lines now. The target checks the fund, so an id
 * that is not yours answers 404 there, and this route reads no data of a fund. An id that cannot be
 * one never reaches the `Location` header.
 */
export async function GET(request: Request, { params }: RouteContext<"/api/web/funds/[id]/returns">) {
  const ctx = await sessionCtxOf(request.headers);
  if (!ctx) return new Response(null, { status: 307, headers: { Location: "/sign-in" } });
  const { id } = await params;
  if (!isFundId(id)) return new Response(null, { status: 404 });
  const query: Query = Object.fromEntries(new URL(request.url).searchParams);
  return new Response(null, {
    status: 308,
    // `no-store`: the target depends on today, and a browser may keep a 308 for ever.
    headers: {
      Location: returnsTarget(`/funds/${id}`, query, today(ctx.timeZone)),
      "Cache-Control": "no-store",
    },
  });
}
