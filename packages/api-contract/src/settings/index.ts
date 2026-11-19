// Users and settings, one entry of the contract (rule M7): a page imports the areas it calls, and
// the bundle leaves the others out. An area joins when a client calls it.
import * as connections from "./connections";
import * as people from "./people";
import * as profile from "./profile";
import * as security from "./security";
import * as server from "./server";

export { connections, people, profile, security, server };
export {
  LAST_DAY,
  MAX_RULES,
  MAX_TIMES,
  MIN_SYNC_GAP_MINUTES,
  syncRuleSchema,
  syncScheduleSchema,
} from "./schedule";
