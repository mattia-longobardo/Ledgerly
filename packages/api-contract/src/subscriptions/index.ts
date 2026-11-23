// Subscriptions, one entry of the contract (rule M7): the pages import it, and the bundle leaves the
// other modules out.
import * as subscriptions from "./subscriptions";

export { subscriptions };
/** The largest N of «every N weeks or months» (D4), for the forms that check it before they send. */
export { MAX_EVERY } from "./shared";
