import { housekeepingJob } from "./housekeeping";

export type Tier = "hourly" | "daily" | "monthly";

export interface JobDefinition {
  name: string;
  tier: Tier;
  run(): Promise<Record<string, unknown>>;
}

/** The one list of scheduled jobs. Each phase appends its jobs here. */
export const JOBS: readonly JobDefinition[] = [housekeepingJob];
