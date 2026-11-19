// The part of the wire's contract every client needs, without a module's schemas (rule M7): a page
// that imports only this does not carry the routes of Settings or Accounts. A name joins when a
// client needs it.
export type { RouteContract } from "../route";
export { SESSION_CSRF_HEADER } from "../session";
