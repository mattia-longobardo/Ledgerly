// The public interface of this unit (docs/design/rewrite-plan/10-modularity.md §10.3, rule M7).
export { trekCalendar as leaveCalendar } from "./calendar";
export { TrekError, createTrekClient, isTokenRejected } from "./client";
export { isTrekBusy, syncTrekNow, trekStatsOf } from "./sync";
