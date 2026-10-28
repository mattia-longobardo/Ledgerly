# API changelog

Changes to `/api/v1` and to the MCP tools (`/api/mcp`). Every change below is additive: a client
written before it keeps working.

## 2026-10-28 · investments and returns (PERS-86)

Investments is readable from outside, behind its own scope (`docs/design/investments.md` §5.5).

- New scope `investments:read`, separate from `read`: neither implies the other. A Client API can
  take it in Settings › Security; a self-registered MCP client may ask for it and the consent page
  names it, but the registration default stays `read`. The MCP metadata
  (`/.well-known/oauth-protected-resource/api/mcp`) now lists `read` and `investments:read`; the
  API's lists `investments:read` too. A token with only `investments:read` can open the MCP and sees
  only the two tools below.
- `GET /api/v1/investments` and the MCP tool `list_investments`: every service with `accountId`,
  `name`, `category`, `provider` (catalog id: `manual`, `etoro`, `ccxt:binance`), `origin`, `mode`,
  `currency`, `value` (own currency), `displayValue`, `change30Days`, `invested`, `gain`,
  `simpleReturn`, `xirr`, `xirrStatus` (`ok`, `no_solution`, `multiple_solutions`, `unavailable`),
  `reliable`, `reliableFrom`, `weight`, `lastUpdate`; and `totals` of the portfolio in the display
  `currency` (`value`, `valuePartial`, `invested`, `gain`, `simpleReturn`, `xirr`, `xirrStatus`,
  `includesExchangeEffect`). Money is a decimal string, returns are ratios (`0.05` = 5 %). Gain and
  returns are `null` unless the service's history is complete (§2.4). The portfolio leaves out
  transfers between its own services; each flow is converted at the rate of its day.
- `GET /api/v1/investments/{accountId}/holdings` and the MCP tool `get_investment_holdings`
  (`account_id`): the open positions of one service — asset (`name`, `class`, `symbol`, `isin`,
  `currency`), `product`, `origin`, `quantity`, `unitPrice`, `priceCurrency`, `pricedOn`, `value`,
  `gain`, `weight`, `conflict`. Another person's service is `404`.
- No answer carries a key, a key check, a connection's state or last error, or a provider's
  external id.

## 2026-10-28 · investment services (PERS-83)

Investments writes the value of each investment service as the account's daily balance
(`docs/design/investments.md` §1.7). The two legacy trading platforms became two accounts (Binance,
type `crypto`; eToro, type `investment`).

- `GET /api/v1/accounts/{id}/balances` and the MCP tool `get_account_balances`: an entry's `source`
  may now also be `portfolio` (the value Investments computed). `balance` keeps its meaning: the
  account's value in its `currency`.
- `GET /api/v1/accounts` and `list_accounts` list the new accounts; `GET /api/v1/summary` and
  `get_summary` count them in `netWorth` like every other account. Today both are worth 0.

## 2026-10-28 · display currency (PERS-82)

Each account keeps its own currency; totals across accounts are converted to the user's display
currency (Settings › Profile, default `EUR`) at the ECB rate of their day
(`docs/design/investments.md` §1.8).

- `GET /api/v1/summary` and the MCP tool `get_summary`: new field `currency`, the display currency
  of `netWorth`, `previousNetWorth` and `cash`. `netWorthPartial` and `cashPartial` are now also
  `true` when an account counted has no exchange rate to that currency (it is left out, never
  counted 1:1). `income`, `expense` and `net` are unchanged: sums of the month's transactions,
  not converted.
- `GET /api/v1/accounts`, `GET /api/v1/accounts/{id}/balances` and the MCP tools `list_accounts`,
  `get_account_balances`: unchanged. `balance` is the account's own value in its `currency`.
- The MCP server's instructions now say which currency each amount is in.

With every account in EUR and the display currency EUR, every value is the same as before.
