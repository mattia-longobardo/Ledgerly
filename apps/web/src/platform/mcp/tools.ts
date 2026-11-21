import "server-only";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import type { ApiScope } from "@ledgerly/domain/platform/auth";
import type { Ctx } from "@ledgerly/domain/platform/context";
import { APP_VERSION } from "@ledgerly/domain/platform/version";
import type { ReadTool } from "@ledgerly/api";

/**
 * The tools of the MCP server (docs/auth-design.md D6, v1). Each one calls the same services as
 * the `/api/v1` route it mirrors and answers in the same shape — amounts as decimal strings, never
 * numbers — so the model, the API and the screen cannot quote three different figures (D5).
 *
 * Every tool runs with the `Ctx` the access token resolved to, so every query underneath is
 * `userScoped(ctx)`: nothing here takes a user id from the caller, and another person's account
 * is `not_found` exactly as it is on the screen.
 *
 * v1 is read-only (PERS-44, question 3 unanswered): `record_account_balance` (scope `write`) is
 * left out until it is confirmed. Every tool says which scope it needs; a token without it does
 * not see the tool at all. The Investments tools need `investments:read`, which `read` does not
 * imply (docs/design/investments.md §5.5).
 */

/** The JSON of a tool's answer, as text: every MCP client reads that, whatever it does with the rest. */
function json(value: unknown): CallToolResult {
  return { content: [{ type: "text", text: JSON.stringify(value) }] };
}

function failure(message: string): CallToolResult {
  return { content: [{ type: "text", text: message }], isError: true };
}

const READ_ONLY = { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false };

/** A server for one request, holding one person's `Ctx`: the transport is stateless (D6). */
export function buildMcpServer(
  ctx: Ctx,
  scopes: readonly ApiScope[],
  reads: readonly ReadTool[] = [],
): McpServer {
  const server = new McpServer(
    { name: "ledgerly", title: "Ledgerly", version: APP_VERSION },
    {
      instructions:
        "Ledgerly is a personal finance ledger. Amounts are decimal strings: an account's own balance is " +
        "in that account's `currency`, and get_summary's totals are in the `currency` it returns (the " +
        "user's display currency); dates are YYYY-MM-DD in the user's time zone. Every tool is read-only.",
    },
  );
  const granted = reads.filter((tool) => scopes.some((scope) => scope === tool.scope));
  // The Investments tools first, where `tools/list` has always listed them.
  const investments = (tool: ReadTool) => tool.scope === "investments:read";
  registerReadTools(server, ctx, [
    ...granted.filter(investments),
    ...granted.filter((tool) => !investments(tool)),
  ]);
  return server;
}

/**
 * The tools of the reads of `/api/v1` (rewrite plan R2): one per route of the contract with an MCP
 * entry, answering what the route answers, from the same handler.
 */
function registerReadTools(server: McpServer, ctx: Ctx, reads: readonly ReadTool[]): void {
  for (const tool of reads) {
    server.registerTool(
      tool.name,
      {
        title: tool.title,
        description: tool.description,
        inputSchema: tool.arguments,
        annotations: READ_ONLY,
      },
      async (args) => {
        try {
          return json(await tool.run(ctx, args));
        } catch (error) {
          if (error instanceof Error && error.name === "ApiRefusal") return failure(error.message);
          throw error;
        }
      },
    );
  }
}
