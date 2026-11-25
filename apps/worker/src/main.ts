/**
 * The worker (rewrite plan R1): the one process that runs the jobs and the syncs. Same image as the
 * web, another command (`node /app/worker.mjs`). It has its own pool of connections — its own
 * process — and four parts:
 *
 * - the scheduler: at each minute, the tiers whose time it is go in the queue (`SCHEDULE`);
 * - the consumer: up to {@link SLOTS} tasks at once, claimed one at a time from `job_queue`;
 * - the recovery, as it starts: the tasks a worker that died left running go back in the queue, and
 *   the `job_runs` and `sync_runs` rows it left `running` are closed as `orphaned`;
 * - the heartbeat in `worker_heartbeats`, which its own health check reads (`--health`).
 *
 * One worker only: two would run the scheduler twice (the queue would merge the tiers, not the
 * tasks the web adds).
 */
import { hostname } from "node:os";
import { wireDomain } from "@ledgerly/api";
import { redactForLog } from "@ledgerly/domain/platform/auth";
import { closeOrphanRuns } from "@ledgerly/domain/platform/integrations";
import {
  beat,
  claimNext,
  closeOrphanJobRuns,
  enqueue,
  finishTask,
  lastBeatAt,
  type QueuedTask,
  recoverInterrupted,
} from "@ledgerly/domain/platform/jobs";
import { runTask, SCHEDULE, SCHEDULE_TIME_ZONE, SCHEDULED_TIERS, tasks } from "@ledgerly/web/jobs";
import { setEmbedder } from "@ledgerly/domain/transactions";
import { loadEmbedder } from "./embedder";
import { linkAllTransfers } from "./link-transfers";
import { measureAll } from "./measure";
import { dueTiers, minuteOf } from "./scheduler";
import { instanceDefaults } from "@ledgerly/domain/users";

/** Tasks run side by side: a long sync or the backup never holds the minute tick. */
const SLOTS = 3;
const POLL_MS = 1_000;
const BEAT_MS = 30_000;
/** The health check's limit: four beats missed. */
const BEAT_MAX_AGE_MS = 2 * 60_000;
/** What a stop waits for the tasks running; the rest go back in the queue at the next start. */
const STOP_WAIT_MS = 25_000;

const log = (message: string, error?: unknown) =>
  error === undefined
    ? console.log(`[worker] ${message}`)
    : console.error(`[worker] ${message}`, redactForLog(error));

const sleep = (delay: number) => new Promise<void>((resolve) => setTimeout(resolve, delay));

async function health(): Promise<number> {
  const beatAt = await lastBeatAt();
  return beatAt !== null && Date.now() - beatAt.getTime() <= BEAT_MAX_AGE_MS ? 0 : 1;
}

async function recover(workerId: string, bootAt: Date): Promise<void> {
  const { requeued, abandoned } = await recoverInterrupted(workerId);
  for (const task of abandoned) log(`gave up ${task.kind} after ${task.attempts} interrupted attempts`);
  const jobRuns = await closeOrphanJobRuns(bootAt, bootAt);
  // shortcut: a reading the web runs inline at this very instant ("Retry sending", a bank's
  // return) is closed too, and reports a failure; move those readings to the queue in R2.
  const syncRuns = await closeOrphanRuns(bootAt, bootAt);
  log(
    `started: ${requeued} task(s) back in the queue, ${jobRuns} job run(s) and ${syncRuns} sync run(s) orphaned`,
  );
}

/**
 * The embedding model of the categories (R6), unless `CATEGORIES_MODEL=off`: off, the cascade is
 * the one of before R6 and the stored data stay as they are.
 */
function categoriesModel() {
  const model =
    process.env.CATEGORIES_MODEL === "off"
      ? { embedder: null, reason: "off (CATEGORIES_MODEL)" }
      : loadEmbedder();
  log(`categories model: ${model.reason}`);
  return model.embedder;
}

/** The commands that answer and exit: `--health`, and `--link-transfers` once after its release. */
async function oneShot(): Promise<void> {
  if (process.argv.includes("--health")) process.exit(await health());
  if (process.argv.includes("--link-transfers")) process.exit(await linkAllTransfers());
}

async function main(): Promise<void> {
  wireDomain();
  await oneShot();
  const embedder = categoriesModel();
  if (process.argv.includes("--measure-categories")) {
    if (embedder === null) process.exit(1);
    console.log(await measureAll(embedder));
    process.exit(0);
  }
  setEmbedder(embedder);

  // The preview (`scripts/preview-on-test.sh`) runs the queue only: no tier starts by itself there.
  const scheduling = !process.argv.includes("--no-schedule");
  const bootAt = new Date();
  const workerId = `${hostname()}:${process.pid}:${bootAt.toISOString()}`;
  let stopping = false;
  const running = new Set<Promise<void>>();

  await recover(workerId, bootAt);
  await beat(workerId, bootAt);
  // The zone of the schedule is the instance's (R5a, E8); before an admin chose one, Rome's as before.
  const scheduleZone = (await instanceDefaults())?.timeZone ?? SCHEDULE_TIME_ZONE;

  const beating = setInterval(() => {
    beat(workerId, bootAt).catch((error: unknown) => log("heartbeat failed", error));
  }, BEAT_MS);

  let lastMinute = minuteOf(new Date()).getTime();
  const tick = async (): Promise<void> => {
    const minute = minuteOf(new Date());
    if (scheduling && minute.getTime() !== lastMinute) {
      lastMinute = minute.getTime();
      for (const tier of dueTiers(minute, SCHEDULED_TIERS, SCHEDULE, scheduleZone)) {
        await enqueue(tasks.tier(tier)).catch((error: unknown) => log(`tier ${tier} not queued`, error));
      }
    }
  };

  const run = (task: QueuedTask): void => {
    const done = runTask(task)
      .catch((error: unknown) => log(`${task.kind} failed`, error))
      .then(() => finishTask(task.id))
      .catch((error: unknown) => log(`${task.kind} not closed`, error))
      .finally(() => running.delete(done));
    running.add(done);
  };

  const stop = (): void => {
    if (stopping) return;
    stopping = true;
    log("stopping");
  };
  process.on("SIGTERM", stop);
  process.on("SIGINT", stop);

  while (!stopping) {
    try {
      await tick();
      let task: QueuedTask | null = null;
      while (!stopping && running.size < SLOTS && (task = await claimNext(workerId)) !== null) run(task);
    } catch (error) {
      log("the queue could not be read", error);
    }
    await sleep(POLL_MS);
  }

  clearInterval(beating);
  await Promise.race([Promise.allSettled([...running]), sleep(STOP_WAIT_MS)]);
  process.exit(0);
}

main().catch((error: unknown) => {
  log("could not start", error);
  process.exit(1);
});
