import "server-only";
import { forEachUser } from "@/modules/users/jobs";
import type { JobDefinition } from "@/platform/jobs/registry";
import type { JobDetail } from "@/platform/jobs/schema";
import { expireOriginals } from "./service";

/**
 * Every day (spec §10.2 "eliminazione originali scaduti"): originals past their retention leave S3;
 * the data and the evidence read from them stay (spec §9.3 step 6).
 */
export const documentsRetentionJob: JobDefinition = {
  name: "documents-retention",
  tier: "daily",
  async run(): Promise<JobDetail> {
    let deleted = 0;
    const counts = await forEachUser("documents-retention", async (_person, ctx) => {
      deleted += await expireOriginals(ctx);
    });
    return { ...counts, originalsDeleted: deleted };
  },
};
