import { requireSession } from "@/platform/auth/session";
import { exportFileName, exportUser } from "@/platform/export/service";

export const dynamic = "force-dynamic";

/**
 * "Export my data" (spec §7.10 Data): the person's own ZIP, written straight into the response.
 *
 * No row, no copy in S3, no link that expires — they are signed in, it is their data, and a
 * package kept on the server would be one more copy of it to protect (plan F8 §3.4.12).
 */
export async function GET(): Promise<Response> {
  const ctx = await requireSession();
  const now = new Date();
  return new Response(exportUser(ctx, now), {
    headers: {
      "Content-Type": "application/zip",
      "Content-Disposition": `attachment; filename="${exportFileName(now)}"`,
      "Cache-Control": "no-store",
    },
  });
}
