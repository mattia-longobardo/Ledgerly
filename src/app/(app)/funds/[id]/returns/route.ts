import { isFundId } from "@/modules/funds/detail";
import { returnsTarget } from "@/modules/funds/tabs";
import type { Query } from "@/modules/investments/period";
import { requireSession } from "@/platform/auth/session";
import { today } from "@/platform/dates";

/**
 * The old returns page (docs/design/funds-ux.md §6, F4): the Valuations tab has its lines now. The target
 * checks the fund, so an id that is not yours answers 404 there, and this route reads no data of a fund.
 * An id that cannot be one never reaches the `Location` header.
 */
export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await requireSession();
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
