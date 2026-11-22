// The public interface of this unit (docs/design/rewrite-plan/10-modularity.md §10.3, rule M7).
export { trekCalendar as leaveCalendar } from "./calendar";
export { trekStatsOf } from "./sync";
// The card of the calendar (rewrite plan R5c anticipated), by a name that is no provider's.
export { trekCard as calendarCard } from "./card";
