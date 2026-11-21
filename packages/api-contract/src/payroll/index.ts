// Payroll, one entry of the contract (rule M7): the pages import it, and the bundle leaves the
// other modules out.
import * as codes from "./codes";
import * as payroll from "./payroll";

export { codes, payroll };
export { CODE_ROLES, FIELD_GROUPS, SUMMED_FIELDS } from "./shared";
