// The MCP tools of the reads (rewrite plan R2, audit MCP-1…MCP-5): one tool for each route of the
// contract with an `mcp` entry, from the same descriptor and the same handler as the REST route.
// The tool answers what the route answers: one serializer, not two.
import type { z } from "zod";
import { CONTRACT_ROUTES, type ContractScope } from "@ledgerly/api-contract";
import type { Ctx } from "@ledgerly/domain/platform/context";
import { type Adapters, apiRoutes } from "./app";
import { handlerOf } from "./serve";

export interface ReadTool {
  name: string;
  title: string;
  description: string;
  scope: ContractScope;
  /** The arguments: the query of the route, as its zod shape. */
  arguments: z.ZodRawShape;
  run(ctx: Ctx, args: Record<string, unknown>): Promise<unknown>;
}

/** The read tools of every route the adapters serve. */
export function readTools(adapters: Adapters): ReadTool[] {
  const app = apiRoutes(adapters);
  return CONTRACT_ROUTES.flatMap((route) => {
    const handler = handlerOf(app, route.id);
    if (!route.mcp || route.scope === null || route.response === null || !handler) return [];
    const response = route.response;
    return [
      {
        name: route.id,
        title: route.mcp.title,
        description: route.mcp.description,
        scope: route.scope,
        arguments: route.query?.shape ?? {},
        run: async (ctx: Ctx, args: Record<string, unknown>) =>
          response.parse(
            await handler({ ctx, headers: new Headers(), params: {}, query: args, body: undefined }),
          ),
      },
    ];
  });
}
