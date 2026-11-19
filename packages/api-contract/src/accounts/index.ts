// Accounts, one entry of the contract (rule M7): a page imports the areas it calls, and the bundle
// leaves the others out. An area joins when a client calls it.
import * as accounts from "./accounts";
import * as balances from "./balances";
import * as links from "./links";
import * as removal from "./removal";
import * as summary from "./summary";
import * as accountSwitch from "./switch";

export { accounts, accountSwitch, balances, links, removal, summary };
