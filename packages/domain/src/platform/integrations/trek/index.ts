// The public interface of this unit (docs/design/rewrite-plan/10-modularity.md §10.3, rule M7).
export { TrekError, createTrekClient, isTokenRejected } from "./client";
export { isTrekBusy, syncTrekNow, trekConnection } from "./sync";
