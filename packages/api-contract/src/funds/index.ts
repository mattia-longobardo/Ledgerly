// Funds, one entry of the contract (rule M7): the pages import it, and the bundle leaves the other
// modules out.
import * as funds from "./funds";
import * as register from "./register";
import * as setup from "./setup";

export { funds, register, setup };
export { COMPONENTS } from "./shared";
