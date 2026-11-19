// src/app/(app)/settings/server/api-cases.ts — the maintenance of Admin › Server that the web
// process lends `/api/v1/server` (rewrite plan R2) until R4: the backups, the jobs and the last
// export are still the web's. The Server Actions of the page call the same functions.
import "server-only";
import type { ServerCases } from "@ledgerly/api";
import { enqueue } from "@ledgerly/domain/platform/jobs";
import { APP_VERSION } from "@ledgerly/domain/platform/version";
import { BACKUPS_KEPT, BackupError, backupNow, lastBackup, postgresVersion } from "@/platform/backup/service";
import { lastExport } from "@/platform/export/jobs";
import { NEXT_VERSION } from "@/platform/next-version";
import { jobStatuses } from "@/platform/jobs/queries";
import { tasks } from "@/platform/jobs/queue";
import { JOBS } from "@/platform/jobs/registry";

export const serverCases: ServerCases = {
  async maintenance() {
    const [backup, postgres, exported] = await Promise.all([lastBackup(), postgresVersion(), lastExport()]);
    return {
      version: APP_VERSION,
      postgres,
      lastBackup: backup && { at: backup.at, size: backup.bytes },
      backupsKept: BACKUPS_KEPT,
      lastExport: exported,
      nextVersion: NEXT_VERSION,
    };
  },
  async backupNow(ctx) {
    try {
      return { ok: true, size: (await backupNow(ctx)).bytes };
    } catch (error) {
      if (error instanceof BackupError) return { ok: false, error: error.code };
      throw error;
    }
  },
  jobs: jobStatuses,
  async runJob(name) {
    if (!JOBS.some((job) => job.name === name)) return false;
    await enqueue(tasks.job(name));
    return true;
  },
};
