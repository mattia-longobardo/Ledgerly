import "server-only";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";
import { balancesOn, getAccount, listAccounts, listBalanceEntries } from "@/modules/accounts/queries";
import { budgetsView } from "@/modules/budgets/queries";
import { holdingsJson, pnlJson, portfolioJson } from "@/modules/investments/api";
import { investmentsPnl, investmentsPortfolio, serviceHoldings } from "@/modules/investments/queries";
import { listTransactions, transactionsSummary } from "@/modules/transactions/queries";
import { TRANSACTION_TYPES } from "@/modules/transactions/rules";
import { instant, money } from "@/platform/api/json";
import type { ApiScope } from "@/platform/auth/oauth";
import type { Ctx } from "@/platform/context";
import { isCivilDate, monthKey, today } from "@/platform/dates";
import { APP_VERSION } from "@/platform/version";
import { monthlyFigures } from "@/platform/reports/monthly";

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

const MAX_TRANSACTIONS = 500;
const DEFAULT_TRANSACTIONS = 50;
const MAX_BALANCES = 200;
const DEFAULT_BALANCES = 50;

const civilDate = z.string().refine(isCivilDate, "A date as YYYY-MM-DD");
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
export function buildMcpServer(ctx: Ctx, scopes: readonly ApiScope[]): McpServer {
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
  if (!scopes.includes("read")) return server;

  server.registerTool(
    "get_summary",
    {
      title: "Summary",
      description:
        "Net worth, liquid cash, and this month's income, spending and net, as GET /api/v1/summary. " +
        "`currency` is the user's display currency, which netWorth, previousNetWorth and cash are " +
        "converted to at the ECB rate of their day. " +
        "`netWorthPartial`/`cashPartial` are true when an account counted has no balance yet, or no " +
        "exchange rate to that currency.",
      annotations: READ_ONLY,
    },
    async () => {
      const figures = await monthlyFigures(ctx, monthKey(today(ctx.timeZone)));
      return json({
        month: figures.month,
        currency: figures.currency,
        netWorth: money(figures.netWorthCents),
        netWorthPartial: figures.netWorthPartial,
        previousNetWorth: money(figures.previousNetWorthCents),
        cash: money(figures.cashCents),
        cashPartial: figures.cashPartial,
        income: money(figures.incomeCents),
        expense: money(figures.expenseCents),
        net: money(figures.netCents),
        transactions: figures.transactions,
        accounts: figures.accounts,
        lastSnapshotMonth: figures.lastSnapshotMonth,
      });
    },
  );

  server.registerTool(
    "list_accounts",
    {
      title: "Accounts",
      description:
        "Every account with its type, currency, state and today's balance, as GET /api/v1/accounts.",
      annotations: READ_ONLY,
    },
    async () => {
      const accounts = await listAccounts(ctx);
      const latest = await balancesOn(
        ctx,
        accounts.map((account) => account.id),
        today(ctx.timeZone),
      );
      return json({
        accounts: accounts.map((account) => ({
          id: account.id,
          name: account.name,
          type: account.type,
          currency: account.currency,
          origin: account.origin,
          state: account.state,
          inNetWorth: account.inNetWorth,
          countsAsLiquid: account.countsAsLiquid,
          balance: money(latest.get(account.id) ?? null),
          lastSyncedAt: instant(account.lastSyncedAt),
        })),
      });
    },
  );

  server.registerTool(
    "get_account_balances",
    {
      title: "Balance history",
      description:
        "The recorded balances of one account, newest first, as GET /api/v1/accounts/{id}/balances. " +
        "Take the account id from list_accounts.",
      inputSchema: {
        account_id: z.uuid().describe("The account's id, from list_accounts."),
        limit: z
          .number()
          .int()
          .min(1)
          .max(MAX_BALANCES)
          .optional()
          .describe(`How many entries, newest first (default ${DEFAULT_BALANCES}).`),
      },
      annotations: READ_ONLY,
    },
    async ({ account_id, limit }) => {
      // Another person's account is `not_found`, exactly as on the screen: `getAccount` is scoped.
      if (!(await getAccount(ctx, account_id))) return failure("Account not found.");
      const entries = await listBalanceEntries(ctx, account_id, limit ?? DEFAULT_BALANCES);
      return json({
        balances: entries.map((entry) => ({
          id: entry.id,
          on: entry.on,
          balance: money(entry.balanceCents),
          available: money(entry.availableCents),
          source: entry.source,
          note: entry.note,
          capturedAt: instant(entry.capturedAt),
        })),
      });
    },
  );

  server.registerTool(
    "list_transactions",
    {
      title: "Transactions",
      description:
        "Movements filtered by period, account, category, type and payee text, with the totals of the " +
        "whole filtered range (not just the page), as GET /api/v1/transactions. Paginate with offset.",
      inputSchema: {
        from: civilDate.optional().describe("First day included, YYYY-MM-DD."),
        to: civilDate.optional().describe("Last day included, YYYY-MM-DD."),
        account_id: z.uuid().optional().describe("Only this account, from list_accounts."),
        category_id: z
          .uuid()
          .optional()
          .describe("Only this category (a group includes its sub-categories)."),
        type: z.enum(TRANSACTION_TYPES).optional(),
        payee: z.string().trim().min(1).max(200).optional().describe("Text the payee contains."),
        limit: z
          .number()
          .int()
          .min(1)
          .max(MAX_TRANSACTIONS)
          .optional()
          .describe(`Page size (default ${DEFAULT_TRANSACTIONS}).`),
        offset: z.number().int().min(0).optional(),
      },
      annotations: READ_ONLY,
    },
    async ({ account_id, category_id, type, limit, ...rest }) => {
      const filters = {
        ...rest,
        accountIds: account_id ? [account_id] : undefined,
        categoryIds: category_id ? [category_id] : undefined,
        types: type ? [type] : undefined,
      };
      const [rows, summary] = await Promise.all([
        listTransactions(ctx, { ...filters, limit: limit ?? DEFAULT_TRANSACTIONS }),
        transactionsSummary(ctx, filters),
      ]);
      return json({
        transactions: rows.map((row) => ({
          id: row.id,
          on: row.on,
          occurredAt: instant(row.occurredAt),
          accountId: row.accountId,
          accountName: row.accountName,
          amount: money(row.amountCents),
          currency: row.currency,
          type: row.type,
          state: row.state,
          categoryId: row.categoryId,
          categoryName: row.categoryName,
          payee: row.payee,
          note: row.note,
          labels: row.labels.map((label) => label.name),
          hidden: row.hidden,
        })),
        summary: {
          count: summary.count,
          income: money(summary.incomeCents),
          expense: money(summary.expenseCents),
          net: money(summary.netCents),
        },
      });
    },
  );

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
        from: civilDate.optional().describe("First day, YYYY-MM-DD; with `to`, wins over `period`."),
        to: civilDate.optional().describe("Last day, YYYY-MM-DD."),
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
