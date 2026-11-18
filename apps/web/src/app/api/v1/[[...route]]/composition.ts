// src/app/api/v1/[[...route]]/composition.ts — `/api/v1` as the web process serves it until R4: the
// routes of the modules' web side (`platform/api`) and the routes of `apps/api`, which get from the
// web what it still holds — its guard, the names of the sources, the use cases of the connections.
// The application joins them here (rule M8), so no package imports the web.
import "server-only";
import { apiRoutes } from "@ledgerly/api";
import { connectionCases } from "@/app/(app)/settings/integrations/api-cases";
import { api } from "@/platform/api/app";
import { withToken } from "@/platform/api/auth";
import { sourceNameOf } from "@/platform/integrations/registry";

api.route("/", apiRoutes({ guard: withToken, sourceName: sourceNameOf, connections: connectionCases }));

export { api };
