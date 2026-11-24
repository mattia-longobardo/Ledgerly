// Payroll, one entry of the contract (rule M7): the pages import it, and the bundle leaves the
// other modules out.
import * as codes from "./codes";
import * as employer from "./employer";
import * as manual from "./manual";
import * as payroll from "./payroll";

export { codes, employer, manual, payroll };
export { CODE_ROLES, FIELD_GROUPS, MAX_EXTRA_PAYMENTS, PAY_FREQUENCIES, PAYSLIP_KINDS, SUMMED_FIELDS } from "./shared";
