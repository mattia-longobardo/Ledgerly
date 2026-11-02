import { fundsHomePreview } from "@/modules/funds/preview";
import { returnsTarget } from "@/modules/funds/tabs";
import type { Query } from "@/modules/investments/period";
import { requireSession } from "@/platform/auth/session";
import { today } from "@/platform/dates";

/**
 * The old returns page, on the new address (docs/design/funds-ux.md §6, F4): the Valuations tab has its
 * lines now. Not connected: `/funds/[id]/returns` stays as it is until F5 moves this route over it. The target
 * checks the fund, so an id that is not yours answers 404 there, and this route reads no data of a fund.
 */
export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  if (!fundsHomePreview()) return new Response(null, { status: 404 });
  const ctx = await requireSession();
  const { id } = await params;
  const query: Query = Object.fromEntries(new URL(request.url).searchParams);
  return new Response(null, {
    status: 308,
    headers: { Location: returnsTarget(`/funds/preview/${id}`, query, today(ctx.timeZone)) },
  });
}
