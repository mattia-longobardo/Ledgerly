// A payslip's original by its signed address (UI-PAY-2, rewrite plan R4): what the viewer of the web
// and an app open. The address is the credential — no session and no token — so the route is under
// `/api/v1` but outside its guard: `GET /payroll/payslips/{id}/original-link` gives the address.
import { checkOriginalLink, readOriginal } from "@ledgerly/domain/imports";
import { isActiveUser } from "@ledgerly/domain/platform/auth";
import { sessionCtxOf } from "@/platform/auth/signed-in";

export const dynamic = "force-dynamic";

const refuse = (status: 403 | 404, reason?: string) =>
  Response.json(
    { error: status === 403 ? "forbidden" : "not_found", ...(reason ? { reason } : {}) },
    { status, headers: { "Cache-Control": "no-store", "Referrer-Policy": "no-referrer" } },
  );

/**
 * The original, inline, never cached, and framable by this site alone (spec §5.2). Refused: an
 * address altered or of another shape (403 `link_invalid`), one past its five minutes (403
 * `link_expired`), one opened in a session of another person (403), a person blocked or gone (403);
 * a document that is not the person's, or whose original was deleted, is not found (404).
 */
export async function GET(request: Request, { params }: RouteContext<"/api/v1/originals/[token]">) {
  const { token } = await params;
  const check = checkOriginalLink(token);
  if (!check.ok) return refuse(403, check.reason);
  const { documentId, userId } = check.claims;
  // A browser that is signed in as someone else is not the person the address was made for.
  if (request.headers.has("cookie")) {
    const ctx = await sessionCtxOf(request.headers);
    if (ctx && ctx.userId !== userId) return refuse(403);
  }
  if (!(await isActiveUser(userId))) return refuse(403);
  const original = await readOriginal({ userId }, documentId);
  if (!original) return refuse(404);
  const name = encodeURIComponent(original.fileName);
  return new Response(new Uint8Array(original.bytes), {
    headers: {
      "Content-Type": original.mime,
      "Content-Length": String(original.bytes.length),
      "Content-Disposition": `inline; filename*=UTF-8''${name}`,
      "Cache-Control": "private, no-store",
      "Content-Security-Policy": "default-src 'none'; frame-ancestors 'self'",
      "X-Content-Type-Options": "nosniff",
      "Referrer-Policy": "no-referrer",
    },
  });
}
