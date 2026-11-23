// Investments, one entry of the contract (rule M7): the pages import it, and the bundle leaves the
// other modules out.
import * as connection from "./connection";
import * as instruments from "./instruments";
import * as investments from "./investments";
import * as plans from "./plans";
import * as register from "./register";

export { connection, instruments, investments, plans, register };
