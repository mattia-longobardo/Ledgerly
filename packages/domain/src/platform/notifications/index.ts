// The public interface of this unit (docs/design/rewrite-plan/10-modularity.md §10.3, rule M7).
export { notificationsLog } from "./schema";
export { channelsOf, deleteOldFacts, raise, resolve } from "./service";
export type { Fact } from "./service";
