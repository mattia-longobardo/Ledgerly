import { readOriginal } from "@/modules/imports/service";
import { requireSession } from "@/platform/auth/session";

/**
 * A payslip's original, for the viewer and "Open original" (spec §7.8 "Originali"): the person's
 * own document only, inline, never cached, and framable by this site alone (spec §5.2). 404 for a
 * document that is not theirs, or whose original was deleted at the end of its retention.
 */
export async function GET(_request: Request, { params }: RouteContext<"/payroll/[id]/original">): Promise<Response> {
  const ctx = await requireSession();
  const { id } = await params;
  const original = /^[0-9a-f-]{36}$/.test(id) ? await readOriginal(ctx, id) : null;
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
