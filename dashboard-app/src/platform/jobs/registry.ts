import type { JobName, JobResult } from "@/lib/contracts";

export type JobTier = "hourly" | "daily" | "monthly";
export interface JobRunInput {
  trigger: "cron" | "manual";
  now: Date;
}
export interface JobDefinition {
  name: JobName;
  tier: JobTier;
  run(input: JobRunInput): Promise<JobResult>;
}

const jobs = new Map<JobName, JobDefinition>();

export function registerJob(def: JobDefinition): void {
  if (jobs.has(def.name)) throw new Error(`job ${def.name} is already registered`);
  jobs.set(def.name, def);
}

export function listJobs(tier?: JobTier): JobDefinition[] {
  return [...jobs.values()].filter((j) => !tier || j.tier === tier);
}

export async function runTier(tier: JobTier, input: JobRunInput): Promise<JobResult[]> {
  const out: JobResult[] = [];
  for (const job of listJobs(tier)) {
    try {
      out.push(await job.run(input));
    } catch (err) {
      out.push({ job: job.name, status: "failed", error: err instanceof Error ? err.message : String(err) });
    }
  }
  return out;
}

export function resetRegistry(): void {
  jobs.clear();
}
