import "server-only";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";
import { budgetsView } from "@ledgerly/domain/budgets";
import { holdingsJson, pnlJson, portfolioJson } from "@/modules/investments/api";
import { investmentsPnl, investmentsPortfolio, serviceHoldings } from "@ledgerly/domain/investments";
import { money } from "@/platform/api/json";
import type { ApiScope } from "@ledgerly/domain/platform/auth";
import type { Ctx } from "@ledgerly/domain/platform/context";
import { monthKey, today } from "@ledgerly/domain/shared/dates";
import { APP_VERSION } from "@ledgerly/domain/platform/version";
import { civilDate } from "@ledgerly/api-contract";
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

const civilDateField = civilDate("A date as YYYY-MM-DD");
const month = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/, "A month as YYYY-MM");

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
  if (scopes.includes("investments:read")) registerInvestmentTools(server, ctx);
  registerReadTools(
    server,
    ctx,
    reads.filter((tool) => scopes.some((scope) => scope === tool.scope)),
  );
  if (!scopes.includes("read")) return server;

  server.registerTool(
    "list_budgets",
    {
      title: "Budgets",
      description:
        "The budgets of one month with their limit, what was spent and the status, plus the totals " +
        "and the spending no budget covers, as the Budgets page shows them.",
      inputSchema: {
        month: month.optional().describe("YYYY-MM; the current month when omitted."),
      },
      annotations: READ_ONLY,
    },
    async ({ month: chosen }) => {
      const key = chosen ? `${chosen}-01` : monthKey(today(ctx.timeZone));
      const view = await budgetsView(ctx, key);
      return json({
        month: view.month,
        budgets: view.rows.map((row) => ({
          categoryId: row.categoryId,
          category: row.name,
          group: row.groupName,
          accountId: row.accountId,
          account: row.accountName,
          limit: money(row.limitCents),
          spent: money(row.spentCents),
          status: row.status,
          percent: row.percent,
        })),
        totals: { limit: money(view.totals.limitCents), spent: money(view.totals.spentCents) },
        unbudgeted: money(view.unbudgetedCents),
      });
    },
  );

  return server;
}

/** The Investments tools (docs/design/investments.md §5.5): scope `investments:read` only. */
function registerInvestmentTools(server: McpServer, ctx: Ctx): void {
  server.registerTool(
    "list_investments",
    {
      title: "Investments",
      description:
        "Every investment service (broker, exchange, manual account) with its value in its own " +
        "`currency` and in the display currency, net invested, gain, simple return and XIRR, plus the " +
        "portfolio's totals in the display `currency`, as GET /api/v1/investments. Returns are ratios " +
        "(0.05 = 5 %). Gain and returns are null unless the service's history is complete " +
        "(`reliable`; `reliableFrom` says from when it is); `xirrStatus` says why XIRR is missing. " +
        "The portfolio leaves out transfers between its own services and includes the exchange effect. " +
        "`pnl` is the profit and loss of the period (the year running by default), the number the " +
        "screen shows: realized, unrealized (open positions only), income, fees, corrections and " +
        "exchange effect add up to it, and the services add up to the portfolio with `transfers`.",
      inputSchema: {
        period: z
          .string()
          .regex(/^(\d{4}|all)$/)
          .optional()
          .describe("A year (YYYY) or `all`; default the year running."),
        from: civilDateField.optional().describe("First day, YYYY-MM-DD; with `to`, wins over `period`."),
        to: civilDateField.optional().describe("Last day, YYYY-MM-DD."),
      },
      annotations: READ_ONLY,
    },
    async ({ period, from, to }) =>
      json({
        ...portfolioJson(await investmentsPortfolio(ctx)),
        pnl: pnlJson(
          await investmentsPnl(ctx, { period: period ?? null, from: from ?? null, to: to ?? null }),
        ),
      }),
  );

  server.registerTool(
    "get_investment_holdings",
    {
      title: "Investment holdings",
      description:
        "The open positions of one investment service today — asset, product, quantity, price, value " +
        "and gain in the service's `currency` — as GET /api/v1/investments/{accountId}/holdings. Take " +
        "the account id from list_investments.",
      inputSchema: {
        account_id: z.uuid().describe("The service's accountId, from list_investments."),
      },
      annotations: READ_ONLY,
    },
    async ({ account_id }) => {
      const view = await serviceHoldings(ctx, account_id);
      if (!view) return failure("Investment service not found.");
      return json(holdingsJson(view));
    },
  );
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
