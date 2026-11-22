// src/app/api/v1/[[...route]]/composition.ts — `/api/v1` as the web process serves it until R4: the
// routes of the modules' web side (`platform/api`) and the routes of `apps/api`, which get from the
// web what it still holds — its guard, the names of the sources, the use cases of the connections.
// The application joins them here (rule M8), so no package imports the web.
import "server-only";
import { apiRoutes, readTools } from "@ledgerly/api";
import { accountCases } from "@/app/(app)/accounts/api-cases";
import { transactionCases } from "@/app/(app)/expenses/api-cases";
import { investmentCases } from "@/app/(app)/investments/api-cases";
import { bankChoice, bankOutcome } from "@/app/(app)/banks/connect/steps";
import { connectionCases } from "@/app/(app)/settings/plugins/api-cases";
import { sourceRead } from "@/app/(app)/settings/plugins/source-read";
import { serverCases } from "@/app/(app)/settings/server/api-cases";
import { api } from "@/platform/api/app";
import { withToken } from "@/platform/api/auth";
// Registers the readers of the documents before an upload asks for one (`document-kinds.ts`).
import "@/app/document-kinds";
import { sourceNameOf } from "@/platform/integrations/registry";

export const adapters = {
  guard: withToken,
  sourceName: sourceNameOf,
  connections: connectionCases,
  server: serverCases,
  accounts: accountCases,
  transactions: transactionCases,
  investments: investmentCases,
  sources: { choice: bankChoice, outcome: bankOutcome, source: sourceRead },
};

api.route("/", apiRoutes(adapters));

/** The MCP tools of the reads, from the same descriptors and handlers (`/api/mcp`). */
export const reads = readTools(adapters);

export { api };
