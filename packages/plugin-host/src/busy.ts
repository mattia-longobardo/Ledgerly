/**
 * A pass that did not happen: another pass was already running on the same connection (or, for a
 * leave calendar, for the same person), so this one opened no `sync_runs` row at all — "already
 * running" is not an execution, and a log that recorded it would claim the provider was asked
 * something. The lock is each engine's own business: every caller — the scheduled pass and "Sync
 * now" alike (spec §10.3) — goes through it, and tells this apart from a real failure.
 */
export class PassBusyError extends Error {
  readonly code = "busy";

  constructor(message: string) {
    super(message);
    this.name = "PassBusyError";
  }
}

export function isPassBusy(error: unknown): boolean {
  // The `name` arm holds where `instanceof` cannot: a Next.js build can load this module twice (a
  // Server Action bundle and a job bundle), and the same class is then two classes.
  return error instanceof PassBusyError || (error instanceof Error && error.name === "PassBusyError");
}
