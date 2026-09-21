import "server-only";
import type { JobDefinition } from "@/platform/jobs/registry";
import type { JobDetail } from "@/platform/jobs/schema";
import { dumpDatabase, runBackup } from "./service";

/**
 * The daily backup (spec §10.2, at 12:00 with the rest of the daily tier). Its retention lives in
 * `housekeeping`, where everything that ages out already lives.
 */
export const backupJob: JobDefinition = {
  name: "database-backup",
  tier: "daily",
  async run(): Promise<JobDetail> {
    const result = await runBackup(dumpDatabase);
    return { key: result.key, bytes: result.bytes };
  },
};
