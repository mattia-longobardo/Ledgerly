// The MCP tools of the reads (rewrite plan R2, audit MCP-1…MCP-5): one tool for each route of the
// contract with an `mcp` entry, from the same descriptor and the same handler as the REST route.
// The tool answers what the route answers: one serializer, not two.
import type { z } from "zod";
import { CONTRACT_ROUTES, type ContractScope, type RouteContract } from "@ledgerly/api-contract";
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

/**
 * The arguments of a tool as the route takes them: the path's parameters by `pathArguments`, and the
 * rest as the query, which is text on the wire when the tool declares arguments of its own.
 */
function splitArguments(route: RouteContract, args: Record<string, unknown>) {
  const named = route.mcp?.pathArguments ?? {};
  const params = Object.fromEntries(Object.entries(named).map(([param, arg]) => [param, args[arg]]));
  const rest = Object.entries(args).filter(([arg]) => !Object.values(named).includes(arg));
  const query = route.mcp?.arguments
    ? Object.fromEntries(
        rest.filter(([, value]) => value !== undefined).map(([arg, value]) => [arg, String(value)]),
      )
    : Object.fromEntries(rest);
  return { params, query };
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
        arguments: route.mcp.arguments ?? route.query?.shape ?? {},
        run: async (ctx: Ctx, args: Record<string, unknown>) => {
          const { params, query } = splitArguments(route, args);
          return response.parse(
            await handler({ ctx, headers: new Headers(), params, query, body: undefined }),
          );
        },
      },
    ];
  });
}
