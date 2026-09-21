import "server-only";
import { forEachUser } from "@/modules/users/jobs";
import { redactForLog } from "@/platform/auth/logger";
import { getDb } from "@/platform/db/client";
import type { JobDefinition } from "@/platform/jobs/registry";
import type { JobDetail } from "@/platform/jobs/schema";
import { EXPORT_LAST, readSetting } from "@/platform/settings/config";
import { appSettings } from "@/platform/settings/schema";
import { deleteObject, listFolder, putObject } from "@/platform/storage";
import { exportUserBytes } from "./service";

/**
 * "Export all data" (design row 891): one archive per person, under `exports/<userId>/`.
 *
 * A job and not a request, because it gathers everybody's documents and cannot finish inside one
 * (plan F8 §3.4.12); `manual`, because nobody asked for it on a schedule — it runs when an admin
 * presses the button (spec §10.3). One file per person rather than one file of everyone: removing
 * a user has to take their data with it, and `removePerson` clears `exports/<id>/` for exactly
 * that reason (plan F8 §3.4.2). A single archive of everybody would survive them.
 *
 * `forEachUser` isolates each person, so one unreadable document does not cost everyone else
 * their export.
 */
export const EXPORT_FOLDER = "exports";

export const exportAllJob: JobDefinition = {
  name: "export-all",
  tier: "manual",
  async run(): Promise<JobDetail> {
    const now = new Date();
    const stamp = now.toISOString().replaceAll(/[:.]/g, "-").toLowerCase();
    let bytes = 0;
    let written = 0;
    const counts = await forEachUser("export-all", async (person, ctx) => {
      const archive = await exportUserBytes(ctx, now);
      const folder = `${EXPORT_FOLDER}/${person.id}/`;
      const key = `${folder}${stamp}.zip`;
      await putObject(key, archive, "application/zip");
      written += 1;
      bytes += archive.length;
      // The new one is written before the old ones go: an export is derived data, but an admin
      // who presses the button and gets a failure should still have the package from last time.
      for (const stale of await listFolder(folder)) {
        if (stale.key === key) continue;
        try {
          await deleteObject(stale.key);
        } catch (error) {
          console.error("[export-all] could not drop an old package", redactForLog(error));
        }
      }
    });
    const value = { at: now.toISOString(), users: written, bytes };
    await getDb()
      .insert(appSettings)
      .values({ key: EXPORT_LAST, value, updatedAt: now })
      .onConflictDoUpdate({ target: appSettings.key, set: { value, updatedAt: now } });
    return { ...counts, written, bytes };
  },
};

export interface LastExport {
  at: Date;
  users: number;
  bytes: number;
}

/** What the Maintenance card says about the last package, or null when there has never been one. */
export async function lastExport(): Promise<LastExport | null> {
  const row = await readSetting(EXPORT_LAST);
  if (!row?.value?.at) return null;
  return {
    at: new Date(String(row.value.at)),
    users: Number(row.value.users ?? 0),
    bytes: Number(row.value.bytes ?? 0),
  };
}
