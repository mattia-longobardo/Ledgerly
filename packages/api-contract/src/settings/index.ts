// Users and settings, one entry of the contract (rule M7): a page imports the areas it calls, and
// the bundle leaves the others out. An area joins when a client calls it.
import * as categories from "./categories";
import * as categoryBoard from "./category-board";
import * as connections from "./connections";
import * as labels from "./labels";
import * as people from "./people";
import * as profile from "./profile";
import * as security from "./security";
import * as server from "./server";

export { categories, categoryBoard, connections, labels, people, profile, security, server };
export {
  LAST_DAY,
  MAX_RULES,
  MAX_TIMES,
  MIN_SYNC_GAP_MINUTES,
  syncRuleSchema,
  syncScheduleSchema,
} from "./schedule";
