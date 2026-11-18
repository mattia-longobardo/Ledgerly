/**
 * Who started a reading (ux/n2-connection-status.md §8.3: "Automatic" or "Manual"). The schedule
 * has one entry, the dispatcher, and it says so here; every other entry is a person's request,
 * so a reading with nothing said is a manual one. `recordRun` reads the answer: no pass has to
 * carry it through its own calls.
 */
import { AsyncLocalStorage } from "node:async_hooks";

type RunOrigin = "auto" | "manual";

const origin = new AsyncLocalStorage<RunOrigin>();

/** Runs `work` as the schedule's own: the runs it records are automatic. */
export function asAutomatic<T>(work: () => Promise<T>): Promise<T> {
  return origin.run("auto", work);
}

export function currentOrigin(): RunOrigin {
  return origin.getStore() ?? "manual";
}
