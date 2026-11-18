// The public interface of this unit (docs/design/rewrite-plan/10-modularity.md §10.3, rule M7).
export { TrekError, createTrekClient, isTokenRejected } from "./client";
export { TrekBusyError, isTrekBusy, splitForTrek, syncTrekNow, trekConnection, trekStatsOf } from "./sync";
export type { TrekSyncOptions, TrekSyncResult } from "./sync";
