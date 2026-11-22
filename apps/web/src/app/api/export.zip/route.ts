import { redirect } from "next/navigation";
import { sessionCtxOf } from "@/platform/auth/signed-in";
import { exportFileName, exportUser } from "@/platform/export/service";

export const dynamic = "force-dynamic";

/**
 * "Export my data" (spec §7.10 Data): the person's own ZIP, written straight into the response.
 * The link of Settings › Data comes here through `/settings/data/export.zip` (rewrite plan R4: the
 * web has no database). A download link sends the cookie only, so this is not under `/api/v1`,
 * which takes a session with its own header.
 *
 * No row, no copy in S3, no link that expires — they are signed in, it is their data, and a
 * package kept on the server would be one more copy of it to protect (plan F8 §3.4.12).
 */
export async function GET(request: Request): Promise<Response> {
  const ctx = await sessionCtxOf(request.headers);
  if (!ctx) redirect("/sign-in");
  const now = new Date();
  return new Response(exportUser(ctx, now), {
    headers: {
      "Content-Type": "application/zip",
      "Content-Disposition": `attachment; filename="${exportFileName(now)}"`,
      "Cache-Control": "no-store",
    },
  });
}
