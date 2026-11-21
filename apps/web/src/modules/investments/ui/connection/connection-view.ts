// What the parts of a service's Connection share (§3.6): the answer of `GET /investments/{accountId}/connection`.
import type { RouteOutput } from "@ledgerly/api-client";
import type { investments } from "@ledgerly/api-contract/investments";

export type Connection = RouteOutput<typeof investments.getInvestmentConnection>;
export type Sync = NonNullable<Connection["sync"]>;
export type Reading = Connection["readings"][number];
