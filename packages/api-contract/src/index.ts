// The public interface of the wire's contract (10-modularity.md §10.2, rule M7).
export { civilDate } from "./primitives";
export { CONTRACT_SCOPES } from "./scopes";
export type { ContractScope } from "./scopes";
export type { RouteContract } from "./route";
export { API_LEVEL, MIN_CLIENT_LEVEL, metaRoute } from "./meta";
export { openApiDocument } from "./openapi";
export { CONTRACT_ROUTES, SETTINGS_ROUTES } from "./routes";
