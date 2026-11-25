// Transactions, one entry of the contract (rule M7): a page imports the areas it calls, and the bundle
// leaves the others out. An area joins when a client calls it.
import * as csv from "./csv";
import * as giroconti from "./giroconti";
import * as manual from "./manual";
import * as movements from "./movements";
import * as review from "./review";
import * as rules from "./rules";
import * as spending from "./spending";

export { csv, giroconti, manual, movements, review, rules, spending };
