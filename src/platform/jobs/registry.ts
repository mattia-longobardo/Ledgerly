import { housekeepingJob } from "./housekeeping";
import type { JobDetail } from "./schema";

export type Tier = "hourly" | "daily" | "monthly";

export interface JobDefinition {
  name: string;
  tier: Tier;
  run(): Promise<JobDetail>;
}

/** The one list of scheduled jobs. Each phase appends its jobs here. */
export const JOBS: readonly JobDefinition[] = [housekeepingJob];
