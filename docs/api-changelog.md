# API changelog

Changes to `/api/v1` and to the MCP tools (`/api/mcp`). Every change below is additive: a client
written before it keeps working.

## 2026-11-21 · imports (0.51.0)

- `POST /imports` (`imports`) is now in the OpenAPI document as `upload_document`, with the same
  request and answers as before: `multipart/form-data` with `kind` and one `file`; `201` with `{id,
  kind, fileName, state, duplicate}` for a new document, `200` with `duplicate: true` for a file
  already received; `400` `invalid`, `413` `too_large`, `415` `unsupported_format` (also for the kinds
  `cometa_operations` and `cometa_position`, before the size). The Payroll screen's upload is the same
  use case.

## 2026-11-21 · payroll (0.50.0)

- `GET /payroll/payslips` (new, `read`): the register of the Payroll page — `years` (each with `rows`:
  a payslip applied or waiting, `id` of its document, `payslipId`, `period`, `type`, `state`, `applied`,
  `amounts` as decimal strings, `leaveLeft` in hours as printed, `openWarnings`; `totals` and `averages`;
  `hasApplied`), `inbox` (documents still being read or waiting), `awaiting`, `inFlight`, `kpis`
  (`net3`, `net6`, `net12`, `taxRate` as a fraction, `ral` `{amount, basis, year}`), `applied`, `span`.
- `GET /payroll/payslips/{id}` (new, `read`): one payslip's review — `document`, `payslip`,
  `periodLabel`, `fields` in the catalogue's order (`value` in canonical form, `read` when corrected,
  `origin`, `verification`, `confidence`, `page`, `bbox`), `checks`, `warnings`, `blocking`,
  `leaveEvents` (stored once applied, foreseen before), `lines` with the role of each code, `llmFill`.
- MCP tools `get_payroll` and `get_payslip` (`id`) (new, read only): the answers of the two routes.
- `GET /payroll/codes` (new, `read`), `PUT /payroll/codes/{code}` and `DELETE /payroll/codes/{code}`
  (new, `write`, 204): the code map, with `seeded` for the codes of the reading profile.
- The writes of a payslip's review (new, `write`): `PUT /payroll/payslips/{id}/fields/{field}`
  `{value}` (canonical form; answers the review), `POST .../verify` `{acknowledgeFailures}`,
  `.../apply`, `.../reject`, `.../retry` (204), `.../reopen` (`{restored}`), `PATCH /payroll/payslips/{id}`
  `{name}` (204), `DELETE /payroll/payslips/{id}` (`{unapplied, restored}`). Errors: `not_found`;
  `invalid` (`reason` `invalid_value`, `derived_field`, `invalid_name`); `conflict` (`reason`
  `invalid_state`, `unconfirmed_inferred`, `blocking_checks`, `no_identity`, `conflict`).
- `POST /payroll/payslips/{id}/llm-fill` (new, scope `session`): «Fill with AI», `{asked, filled}`;
  `unavailable` (`llm_not_configured`, `llm_failed`). It sends the payslip's text to an external
  service, so only the web's own session calls it: a token gets 403.
- The upload of a payslip stays `POST /imports`.

## 2026-11-21 · time off and the colour of a category (0.49.0)

- `GET /timeoff/{year}` (new, `read`): the Time off page of one year — `allowance` in days, `vacation`
  and `rol` (`residual` with `basis` `payslip`, `allowance` or `unknown`, `allowanceMinutes`,
  `carriedMinutes`), `bars`, `rows` (a day: `origin` `manual` or `external`, `sync` `none`, `upsert` or
  `delete`; a payslip's month: `usagePeriod`, `hours`, `payrollPeriod`), `years`, `unrecorded`,
  `overdrawn`, `totals`, `countedThrough`, `months`, `totalAllowanceMinutes`, `allowanceMismatch`,
  `holidays`, `accrual`, and `residualInputs` and `forecastInputs` for a preview before a write. Every
  length is in minutes; `minutesPerDay` is a day.
- MCP tool `get_time_off` (`year`) (new, read only): the answer of `GET /timeoff/{year}`.
- `GET /timeoff/allowances` (new, `read`) and `PUT /timeoff/allowances/{year}` (new, `write`): the
  allowance of each year, in days; null for a part nobody states.
- `POST /timeoff/leave`, `DELETE /timeoff/leave/{id}`, `DELETE /timeoff/days/{date}`,
  `DELETE /timeoff/leave?from&to` (new, `write`): book a range, remove a row, a date or a range; each
  answers `{undo, days, removed, pending}`. `POST /timeoff/leave/undo` (new, `write`, 204) puts the
  days back. Errors: `invalid` (`reason` `invalid_input`, `range_too_long`), `conflict` (`reason`
  `not_bookable`, with `refused` `[{on, reason}]`), `not_found`.
- `GET /timeoff/holidays/countries`, `/timeoff/holidays/subdivisions?source&country`,
  `/timeoff/holidays/calendars` (new, `read`); `POST /timeoff/holidays/calendars` (201 `{id}`),
  `DELETE /timeoff/holidays/calendars/{id}`, `POST /timeoff/holidays/calendars/{id}/refresh` (new,
  `write`). Errors: `invalid`, `not_found`, `conflict` (`duplicate`, `too_many`), `unavailable`.
- The error body gains `refused` (optional), only on `not_bookable`.
- `GET /categories` (and the answers of the writes of a category): `displayColor` (new), the colour a
  category is drawn in — its own, its group's for a sub-category, or the one derived from the id.

## 2026-11-21 · interests and the projections of subscriptions (0.48.0)

- `GET /interests` (new, `read`): the Interests page — the `rules`, oldest first (`id`, `accountId`,
  `account`, `validFrom`, `validTo`, `runHour`, `tiers` `{upTo, rate}` with the rate as a plain
  percentage, `tax` as a percentage, `dayBasis`, `settlement`, `payeeMatch`, `mode`, `categoryId`,
  `state`, `accruedYtd` and `grossYtd` since 1 January, `nextPayout`), the `totals` of the year
  (`year`, `accruedYtd`, `grossYtd`) and the open `accounts` a rule can be on, with `publishable`.
- `GET /interests/{id}` (new, `read`): one rule's page — the `rule` (the row above), `category`,
  `pending`, `accruedYtd` (the settlements that start this year plus `pending`), `balance` (`synced`,
  `lastSyncedAt`, `staleForAccrual`: the reading is too old for the accrual, one hour, not the
  account's own threshold), the `settlements` reconciled with what was paid (`periodFrom`, `periodTo`,
  `settleOn`, `accruedDays`, `skippedDays`, `gross`, `tax`, `net`, `paid`, `status`, `posting`,
  `postingError`) and the latest 90 `days` (`on`, `balance`, `net`, `status`).
- MCP tools `list_interest_rules` and `get_interest_rule` (`rule_id`) (new, read only): the answers of
  the two routes, from the same descriptors.
- `POST /interests` (201 `{id}`), `PUT /interests/{id}`, `PUT /interests/{id}/state` (new, `write`).
  Rates and tax are plain percentages (`"2.75"`), band bounds decimal strings, the last band without
  one. Errors: `invalid` (`reason` `invalid`, `invalid_account`, `invalid_tiers`, `invalid_category`),
  `conflict` (`reason` `not_synced`), `not_found`.
- `POST /interests/{id}/settlements/{entryId}/posting` `{retry}` and
  `PUT /interests/{id}/settlements/{entryId}/posted` (new, `write`): «Post now» or «Retry», and «Mark as
  posted»; both answer `{posting}`. A posting that does not land is an answer, not an error.
- The tolerance of subscriptions and the rates of interests share one schema of a percentage on the
  way in (`percentInput`): nothing changes on the wire.
- `GET /subscriptions`: every entry of `projections.month` and `projections.year` has `percent`
  (new, `number | null`), the part of `balance` that `commit` takes, as a percentage with one decimal,
  truncated (`⌊commit × 1000 / balance⌋ / 10`); null when `balance` is null or not above zero. The
  MCP tool `list_subscriptions` answers it too, from the same descriptor.

## 2026-11-20 · subscriptions (0.46.0)

- `GET /subscriptions` (new, `read`): the Subscriptions page — the active `subscriptions` and the
  `inactive` ones (`id`, `name`, `state`, `categoryId`, `category`, `categoryColor`, `accountId`,
  `account`, `price`, `cycle`, `chargeOn` as entered, `nextChargeOn` not paid yet, `utility`,
  `payeeMatch`, `tolerance` as a percentage, `monthly`, `yearly`, `current` — the check of the period
  under way: `id`, `dueOn`, `state`, `expected`, `actual` — and `lastMatch` `{on, amount}`), the
  `totals` (`monthly`, `yearly`, `lowUtility` `{yearly, count}`, `next30` `{amount, until}`), the
  `alerts`, `byCategory` (`groupId`, `name`, `color`, `yearly`), `projections.month` and
  `projections.year` per paying account (`balance` in EUR, null without one or without a rate,
  `commit`, `projected`) and the `accounts` a subscription can be paid from.
- MCP tool `list_subscriptions` (new, read only): the answer of `GET /subscriptions`, from the same
  descriptor.
- `GET /subscriptions/suggestions` (new, `read`): the recurring payments no subscription covers yet
  (`key`, `name`, `price`, `cycle`, `nextChargeOn`, `accountId`, `categoryId`, `occurrences`).
- `POST /subscriptions` (201 `{id}`), `PUT /subscriptions/{id}`, `PUT /subscriptions/{id}/state`,
  `DELETE /subscriptions/{id}` (new, `write`). The price is a decimal string, the tolerance a plain
  percentage (`"2.5"`, 5 when left out). Errors: `invalid` (`reason` `invalid`, `invalid_account`,
  `invalid_category`), `conflict` (`reason` `not_cancelled`), `not_found`.

## 2026-11-20 · the budgets' percentages and the categories' board (0.45.0)

- `GET /budgets/view`: `totals.percent` (new), spent as a whole percentage of the limit, with the rule
  of a row's `percent` (rounded half-up, past 100 when over).
- `GET /budgets/{budget}`: `percent` and `remaining` (new) on every month of `history` — the rule of a
  row's `percent`, and `limit − spent`, negative when over; both null in a month without a limit.
- `GET /categories/board?from=&to=&accounts=` (new, `read`): Expenses › Categories in a period.
  `macros`, always Income, Expenses, Transfers: `macro`, `count`, `total` (signed), `in` and `out`
  (positive); `groups` (biggest first), each a line plus `only` (`total`, `count` of the movements on
  the group itself; null when none) and `children` (lines); `rest` (`count`, `total`, `in`, `out` of
  the movements without a category; null when none). A line: `id`, `name`, `parentId`, `type`,
  `color` (as drawn: its own, its group's or the palette's), `chosenColor` (null when none),
  `archived`, `canMerge`, `usage` (movements ever), `count`, `total`, `in`, `out`, `share` (0-100,
  one decimal; 0 under Transfers), `budget` (`limit`, `status` on every account in the period's last
  month; null when none) and `source` (`provider`, `name`, `names`; null when none). No MCP tool.


- `GET /pockets` (new, `read`): the Pockets page — the open pockets (`id`, `name`, `color`, `state`,
  `accountId`, `account`, `startMonth`, `target`, `monthly`, `balance`, `percent` of the target, whole,
  null without one, and `planned` `{count, total, after}`), the `archived` ones, the `totals`
  (`earmarked`, `backing` and `free`, null when a backing balance is unknown, `monthly`),
  `backingAccounts` (`id`, `name`, `free`), `nextAccrual` and the `accounts` a pocket can rest on.
- MCP tool `list_pockets` (new, read only): the answer of `GET /pockets`, from the same descriptor.
- `GET /pockets/overview` (new, `read`): Overview's tile — `total`, `monthly`, `count`.
- `GET /pockets/candidates` (new, `read`): the expenses a standalone pocket can take (`id`, `on`,
  `amount`, `payee`, `account`), newest first.
- `GET /pockets/{id}` (new, `read`): a pocket's page — its row plus `budget`, `accrued`, `spent`,
  `toGo`, `eta`, `etaMonth`, `interest` (null when unknown), `interestReason`
  (`estimate`/`no_interest_data`/`standalone`), `freeOnAccount`; `history` (`month`, `balance`, 12
  months, oldest first), `expenses` and `planned`. `not_found` for an archived pocket.
- `POST /pockets` (201 `{id}`), `PUT /pockets/{id}`, `PUT /pockets/{id}/state`,
  `POST /pockets/{id}/deposits`, `PUT` and `DELETE /pockets/{id}/expenses/{transaction}`,
  `POST /pockets/{id}/planned`, `DELETE /pockets/planned/{id}` (new, `write`). Amounts are decimal
  strings, `null` for none. Errors: `invalid` (`reason` `invalid`, `amount`, `invalid_account`,
  `future_date`, `past_date`, `not_expense`), `conflict` (`reason` `duplicate_name`, `archived`,
  `backed`, `already_linked`), `not_found`.

## 2026-11-20 · budgets (0.44.0)

- `GET /budgets?month=` (new, `read`): the answer of the MCP tool `list_budgets`, from the same
  descriptor and the same mapper — `month`, `budgets` (`categoryId`, `category`, `group`,
  `accountId`, `account`, `limit`, `spent`, `status` `over`/`near`/`on_track`, `percent`), `totals`
  and `unbudgeted`.
- `GET /budgets/view?month=` (new, `read`): the Budgets page. Each row of `list_budgets` plus `slug`,
  `name` («Group › Sub» already composed, null for «All categories»), `color`, `depth` and
  `remaining` (`limit − spent`, negative when over); `totals.remaining`, `toCategorise` (`count`,
  `amount`), the choices of «Add budget» (`categories`, `accounts`) and `firstMonth`.
- `GET /budgets/overview?month=` (new, `read`): Overview's card, the 5 budgets closest to their limit,
  the highest `percent` first, with the rows of the page.
- `GET /budgets/{budget}?month=` (new, `read`): a budget's page — `budget` (the row of the page), the
  6 months before (`history`: `month`, `limit` null without one, `spent`) and `alerts`. `not_found`
  when the budget has no limit in `month`. `{budget}` is `<category|all>_<account|all>`.
- `PUT /budgets/{budget}/limit` (`month`, `amount` as a decimal string), `POST /budgets/{budget}/stop`
  (`month`), `PUT /budgets/{budget}/alerts` (`enabled`, `thresholds`, answered sorted without
  repeats) (new, `write`). Errors: `invalid`, `not_found`.
- `month` is `YYYY-MM` or `YYYY-MM-01` on every budgets route and on `list_budgets` (which took
  `YYYY-MM` only); none is the current month. The tool's answer does not change.

## 2026-11-20 · the sign, the series' shares, the groups' counts, the macros, the archived accounts, a category's figures (0.44.0)

- `GET /transactions/spending/breakdown`: `signedAmount` (new) on every group and child, the amount
  with its sign (negative for spending). `amount`, `share` and `width` do not change.
- `GET /transactions/spending/series`: `total` (new), what the buckets add up to, and `share` (new) on
  every group, its `total` as a share of the series' `total` (0-1; 0 when the series is 0).
- `GET /transactions/view`: `facets.groups` (new), `[{ categoryId, count }]` for every group of
  categories that has sub-categories and any movement: its own movements and its sub-categories'
  (F2.5). `facets.categories` keeps each category's own count; `GET /transactions/facets` does not
  change.
- `macros` (new) on every movement of `GET /transactions/view` and `GET /transactions/{id}`: the
  macros its category may be chosen in — `["transfer"]` for a leg of a pair, otherwise
  `["expense", "transfer"]` for money out and `["income", "transfer"]` for money in.
- `GET /accounts?archived=true` (new optional parameter): the archived accounts too, in the same
  shape. Without it the answer does not change.
- `GET /categories/{id}/summary?from&to[&accounts]` (new, `read`): the figures of a category's page
  for a period, the category and its sub-categories together — `amount` (spent, received or moved
  out, positive when the money went that way), `count`, `previousAmount` and `change` against the
  period before (null when that one had no movement; `change` also when it came to 0), `perMonth`
  (null under two months), `budget` (`limit`, `overMonths` in the period; null without one),
  `children` of a group (`id`, `name`, `color`, `amount` with its sign, `share` of the macro 0-1) and
  `source` (`provider`, `name`, `names`: the source whose categories count under it; null when none).
- `GET /transactions/review`: `counts.left` (new), what is left to review: `suggested` + `open`.
- No MCP tool changes: `list_accounts` keeps no arguments.

## 2026-11-20 · the card, the chart and «To review» for the client (0.43.0)

- `GET /transactions/spending/breakdown` (new, `read`): the «By category» card on two levels, as the
  page draws it — `total`, and per group `id`, `name`, `color`, `amount` (positive), `share` of the
  total and `width` of the largest group (0-1), with its `children` measured within the group (what
  was filed on the group itself is a child under the group's name). Takes the filters of
  `GET /transactions`. `id`/`name` null for «Uncategorised»; `color` is the stored one, null when the
  category has none.
- `GET /transactions/spending/series?from&to&grain=day|month` (new, `read`): the spending chart —
  `buckets` (every day or month from `from` to `to`, today at the latest, with its `total`) and
  `groups` (`id`, `name`, `color`, `total`, `values` aligned to `buckets`, the biggest first). One
  `type`, spending when none.
- `GET /transactions/review` adds `count` and `total` (groups and single movements together) and
  `counts` (`categorised`, `suggested`, `open`) for the chosen accounts.
- `badges` (new) on every movement of `GET /transactions/view` and `GET /transactions/{id}`: the
  markers the page draws, decided by the server, in this order: `manual`, `hidden`,
  `removedUpstream`, `edited`, `transfer` or `unpaired`, `pending`. `hidden` is the person's own
  hiding only, and `edited` leaves out a category chosen where the source gives none; the fields
  `hidden` and `edited` keep their meaning, for the MCP tools.
- No MCP tool changes.

## 2026-11-20 · three fixes of transactions (0.42.0)

- `excludedCount` (new, optional): how many movements in another currency a total left out because
  there is no exchange rate for their day (decision D4); the money is then partial. Present only when
  it is above zero, in the `summary` of `GET /transactions` and of `list_transactions`, in the
  `summary` and in each month of `GET /transactions/view`, in each group of
  `GET /transactions/spending` and `get_spending`, and in `GET /summary` and `get_summary` (income,
  spending and net).
- `POST /transactions/visibility` now rebuilds the balance of each manual movement's account for every
  action, as Expenses always did. `rebuildBalances` is still accepted and has no effect: a client that
  sends it keeps working.
- The search of a payee by its key (suggestions, recurrences) gives the same key in the database as in
  the server for a no-break space (U+00A0, U+202F, U+FEFF) and a dotted capital I (U+0130).

## 2026-11-20 · the routes of transactions (rewrite plan R2)

- `GET /transactions` is served from the contract with the answer of F8. New optional filters:
  `accounts`, `category`, `categories` (`none` for «Uncategorised»), `labels`, `types` (lists
  separated by commas), `hidden`, `sort`, `direction`.
- New reads (`read`): `GET /transactions/{id}`, `/transactions/view`, `/transactions/facets`,
  `/transactions/spending?groupBy=category|macro|day|month`, `/transactions/review`,
  `/transactions/{id}/similar`, `/transactions/manual/form`, `/payees`, `/rules`, `/rules/draft`,
  `/rules/{id}/preview`, `/search` (the ⌘K palette: pockets, funds, subscriptions); `POST
  /transactions/manual/preview`, `/transactions/manual/suggestion` and `/rules/preview` write nothing.
- New writes (`write`): a movement's note and labels, its category, its visibility, its edit at the
  source; the manual movement (create with an idempotency key, change, delete, retry the send); the
  choices of «To review» with «Undo»; the merge proposals; the default groups; the rules.
- MCP: new tool `get_spending`; `list_transactions` keeps its arguments and its page of 50.
- `incomeLessExpense` (decision D3) beside `net` in the `summary` of `GET /transactions` and
  `list_transactions` and in `GET /summary`: income less spending, giroconti out. `net` is unchanged
  (every movement, giroconti included); the two differ when a giroconto has no counterpart.

## 2026-11-19 · archived doubles and the state of a connection (decision H58)

- `GET /accounts/{id}/twin` (new, `read`): `{ twin: { id, name } | null }`, the account this one
  doubles. Open: the twin that `POST /accounts/{id}/archive` would record; archived: the twin recorded.
- `POST /accounts/{id}/archive` of a double records its twin: its movements leave every total of the
  months (`GET /summary`, `GET /transactions`' summary, the MCP tools), as a hidden row does, until
  `POST /accounts/{id}/restore`. A filter on the account itself still lists and sums them.
- `GET /connections` adds `status` to each connection: `{ value, text, action }`, by the same rule as
  the web's row (`value` one of `ok`, `running`, `late`, `action`, `paused`; `action` or `null`).

## 2026-11-19 · the IBAN for the web's pages only (decision H45, option A)

- New scope `session`: the web's own session has it, and no token is ever granted it. A route that
  asks for it answers `403 insufficient_scope` to every Bearer token, whatever its scopes, also next
  to a valid cookie. No MCP tool has it (an MCP tool is a read with scope `read`).
- New, scope `session`: `GET /accounts/{id}/iban` (the account's IBAN grouped by four, or `null`) and
  `GET /accounts/{id}/switch/identifiers` (the bank's identifier of each candidate of the switch,
  masked as `IT60 •••• 3456`). Every other answer, the MCP tools and the exports still carry no IBAN,
  whole or masked.
- The enum of scopes in `GET /api-clients` and `GET /connected-apps` names `session` too; no client
  can have it.

## 2026-11-19 · the web session's own rate limit (decision H57)

- The web's session cookie on `/api/v1` has 1200 calls per minute per person; a token (Client API,
  MCP, script) keeps 120 per minute per client. `X-RateLimit-Limit` says the caller's allowance.

## 2026-11-19 · the last figures of accounts (release R2, accounts, completion)

The changes of the charts, the connection an account comes from and the counts of a switch are
fields of the API: the client works out no change between two points. A change is
`{ amount, fraction }`, as below.

- `GET /net-worth` adds `windowChange`: the last month's `netWorth` from the first known one of the
  window. Each row of `accounts` adds `seriesChange`, one change per month of `series`, each from
  the month before; the first is `{ amount: null, fraction: null }`.
- `GET /net-worth/daily` adds `windowChange`: the last day's `total` from the first known one.
- `GET /accounts/{id}/daily-balances` adds `changes`, one per day of `values`, each from the day
  before; the first is `{ amount: null, fraction: null }`.
- `GET /accounts/{id}/context` adds `connectionId`: the connection the account comes from (its row is
  in `GET /connections`), or `null`. Its `switch` adds `counts`: `matched`, `fresh`, `transfers`,
  `joined`, what «Apply» counted, 0 when it did not count one.
- No route and no MCP tool is added. No IBAN, whole or masked, in any of them.

## 2026-11-19 · the figures of accounts (release R2, accounts, completion)

Every change, share and conversion a screen of accounts shows is now a field of the API: the
client does not work them out. A change is `{ amount, fraction }`: `amount` is `null` when either
value is unknown, `fraction` is `null` also when the earlier value is zero.

- A refusal `iban_exists` or `iban_archived` (`POST /accounts`, `PATCH /accounts/{id}`) adds `other`:
  the name of the account that has the IBAN. Never the IBAN. The error body may carry `other`.
- `GET /net-worth` adds `change` (from `previousTotal`) and `yearToDate` (from the end of December
  before the year of the window's last month; `null` when that month is outside the window). Each
  row of `accounts` adds `change` (from `previous`), `yoy` (from the 13th month end back), `share`
  (of `total`, `null` for an archived account), `lastSyncedAt`, and `service` (`provider` and
  `lastSyncedAt` of the service of Investments that feeds it, or `null`).
- `GET /accounts/{id}/balances` and the MCP tool `get_account_balances` add `change` to each entry:
  from the entry before it. The oldest entry of a page has one too; only the oldest ever has `null`.
- New, scope `read`: `GET /net-worth/daily?from=&to=` (the accounts in the net worth day by day, in
  the display currency at the rate of each day, with their sum; at most the last 366 days of the
  window, cut at today), `GET /accounts/{id}/context` (provider's name, Investments, pockets,
  subscriptions, interest rules, the open switch and whether the switch is offered) and
  `GET /accounts/{id}/switch/candidates` (the accounts of the banks the switch can move it to;
  the IBAN only as `sameIban` and `otherIban`, never whole or masked).
- No MCP tool is added.

## 2026-11-19 · Security, Profile and Server in the contract (release R2, users and settings)

- New, scope `security` (capability `security`): `GET /security/sign-in`: `password`, `sso`,
  `identityProvider` (the origin of the instance's identity provider, never its path or client) and
  `twoFactorPolicy` (`required` or `optional`).
- New, scope `read` (capability `profile`): `GET /profile/options`: `timeZones` (`zone` and its
  `offset` now, as `UTC+1`) and `monthlySummaryAllowed` (false when an admin turned the monthly
  summary off for the instance).
- New, scope `admin` (capability `server`): `GET /server/diagnostics`: one row per plugin (`id`,
  `name`, `state` `up`/`down`/`never`/`incompatible`, `version`, `contract`, `at`). A plugin that
  does not answer is `down` in its row and the answer is `200`; `503` with the new error code
  `unavailable` only when the check cannot run at all.
- `GET /sessions` adds `current` to each session: true only for the session of the cookie of the
  call; always false for a Bearer token.
- `GET /server/settings` adds `oidc.environmentOrigin` (the origin of the provider the environment
  names, or `null`), `maintenance.nextVersion` and `maintenance.export` (`at`, `users`, `bytes` of
  the last export, or `null`). No secret and no value of the environment besides those origins.
- `GET /connections` adds `providerName` to each connection (what a person calls the provider). A
  refused run (`sync`, `test`, `history`, `resume`, `enable`) answers a `reason` of the contract's
  closed list `CONNECTION_REFUSALS`: `notActive` becomes `not_active`, and a code outside the list
  becomes `failed`, which is the sentence the web showed for it.
- `@ledgerly/api-contract` adds the entries `./core`, `./settings` and `./accounts`: a client imports
  the areas it calls (`import { profile } from "@ledgerly/api-contract/settings"`). `.` is unchanged.
  No MCP tool changes.

## 2026-11-19 · accounts (release R2, accounts)

- `previousNetWorth` of `GET /summary`, of `get_summary` and of the monthly mail has a value: the
  net worth at the end of the previous month, the one Overview shows the change from (decision D1).
  It was always `null`.
- `GET /accounts`, `GET`/`POST /accounts/{id}/balances` and `GET /summary` keep their answers; they
  are now served from the contract, with one serializer for the route and its MCP tool. A refusal of
  `POST /accounts/{id}/balances` adds `reason` (`future_date`, `managed_locked`, …); the status is
  the same as before.
- The balance history has one default for REST and MCP: 200 entries. `get_account_balances` without
  `limit` gives up to 200 entries (50 before). A `limit` that is not 1-200 still gives 200.
- New, scope `read` (capability `accounts`): `GET /accounts/{id}` (the settings; `hasIban` and
  `ibanFromSource`, never the IBAN), `GET /accounts/{id}/links`, `GET /accounts/{id}/dependents`,
  `GET /snapshots`, `GET /net-worth?months=&through=&includeArchived=` and
  `GET /accounts/{id}/daily-balances?from=&to=` (at most 1100 days, cut at today).
- New, scope `write`: `POST /accounts`, `PATCH /accounts/{id}` (a field left out keeps its value,
  `iban: null` removes the IBAN), `POST /accounts/{id}/archive`, `POST /accounts/{id}/restore`,
  `PUT`/`DELETE /accounts/{id}/balances/{entryId}` (a reading a person recorded),
  `POST /accounts/{id}/links`, `PUT`/`DELETE /accounts/{id}/links/{linkId}`, `POST /snapshots`,
  `POST /accounts/{id}/dependents/move`, `DELETE /accounts/{id}`, `POST /accounts/{id}/switch/check`,
  `POST /accounts/{id}/switch` and `DELETE /accounts/{id}/switch`. A refusal answers `400`, `404` or
  `409` with the code of the use case in `reason`.
- MCP: `tools/list` also lists the read tools of users and settings (`get_preferences`,
  `get_profile`, `list_categories`, `list_labels`, `list_connections`), in a new order. A tool that
  does not find what it was asked answers the text `not_found` (`get_account_balances` said
  `Account not found.`).

## 2026-11-19 · the web's session (release R2, users and settings)

- `/api/v1` also accepts the session cookie of the web, same origin: scopes `read`, `write`,
  `security`, and `admin` for an admin. A session that owes its TOTP setup, a revoked session or a
  blocked person answers `401`. A write by cookie needs `Origin` equal to the instance and the
  header `X-Ledgerly-CSRF` (`SESSION_CSRF_HEADER` of the contract), otherwise `403`. The Bearer token
  works as before and, when it is there, decides alone. No answer carries
  `Access-Control-Allow-Credentials`.
- The contract also exports `syncRuleSchema`, the shape of one rule of a schedule.

## 2026-11-19 · the preview of a schedule (release R2, users and settings)

- New `POST /api/v1/connections/{id}/schedule/preview` (`read`, capability `connections`): the body
  is a schedule as `PUT /connections/{id}/schedule` takes it; the answer is `next` (the next 5
  passes, in the person's zone, after now) and `problems` (`tooFrequent` with `day`, `first`,
  `second`; `neverRuns` and `invalidRule` with the index of the `rule`). `next` is empty when there
  is a problem or no rule. It saves nothing; another person's connection answers `404`.
- The contract exports the limits of a schedule (`MIN_SYNC_GAP_MINUTES`, `MAX_RULES`, `MAX_TIMES`,
  `LAST_DAY`, `SCHEDULE_PREVIEW_COUNT`) and `syncScheduleSchema`, the shape a client checks before
  it asks. No other route or tool changes.

## 2026-11-18 · the metadata of the instance (release R2, users and settings)

- New `GET /api/v1/meta`, without a token: `version`, `apiLevel` (1), `minClientLevel` (1),
  `capabilities` (the capabilities of the routes the instance serves, sorted) and `scopes` (the
  scopes the instance grants). No other route or tool changes.
- The OpenAPI document of the contract is generated into `docs/openapi.json`. It already describes
  the routes of users and settings that later steps serve: `capabilities` of `GET /meta` says what
  an instance serves, and each route gets its own entry here when it is served.
- New `GET /api/v1/preferences` (`read`) and `PATCH /api/v1/preferences` (`write`): the person's
  preferences; a field left out of the `PATCH` keeps its value, a new `timeZone` moves the times of
  the connections. New `GET /api/v1/profile` (`read`) and `PATCH /api/v1/profile` (`write`, `name`
  only; `409` with `reason: "sso"` when the identity provider manages the name).
- Categories and labels (`read` to list, `write` to change): `GET`/`POST /categories`,
  `PATCH`/`DELETE /categories/{id}`, `POST /categories/{id}/archive`, `POST /categories/restore`,
  `POST /categories/{id}/move`, `GET`/`POST /categories/{id}/macro-move`,
  `POST /categories/macro-move/undo`, `POST /categories/merge`, `POST /categories/merge/undo`;
  `GET`/`POST /labels`, `PATCH`/`DELETE /labels/{id}`; `GET /source-categories`,
  `PUT /source-categories/{id}`, `POST /source-categories/undo/{undoId}`,
  `POST /source-categories/{id}/keep`. A refusal of the taxonomy answers `409`
  (`reason: "duplicate"`) or `400` with its code in `reason`; an `undo` goes back as it came.
- Connections, banks, sources and plugins: `GET /connections` (`read`), `POST /connections/{id}/sync`
  (`202`), `/test`, `/history`, `/resume`, `/enable`, `PUT /connections/{id}/schedule`,
  `DELETE /connections/{id}`, `GET`/`PUT /connections/{id}/accounts`, `POST /connections/{id}/read`,
  `GET /banks?country=`, `GET /sources/{slug}/deactivation`, `POST /sources/{slug}/deactivate`,
  `POST /sources/{slug}/accounts/{externalId}/resume`, `PATCH /plugins/{pluginId}`,
  `PUT`/`DELETE /plugins/{pluginId}/credentials` (`write` for the changes). A provider of the core
  answers `409` with `reason: "core_provider"` to what only its card on the web does (connect,
  test, history, its accounts, disconnect) until it is a plugin; `capabilities` says what a
  connection offers through the API. `POST /connections` refuses every provider for now. The start
  and the renewal of a bank's access are not served yet.
- Security, people and server: `GET /sessions`, `DELETE /sessions/{id}`, `GET /api-clients`,
  `DELETE /api-clients/{clientId}`, `GET /connected-apps`, `DELETE /connected-apps/{clientId}`
  (scope `security`); `GET /people`, `POST /people/invitations`, `DELETE /people/invitations/{id}`,
  `PATCH`/`DELETE /people/{id}`, `POST /people/{id}/password-reset`, `DELETE /people/{id}/two-factor`,
  `GET /server/settings`, `PUT`/`DELETE /server/llm`, `/server/oidc`, `/server/smtp`, their
  `POST …/test`, `POST /server/backups`, `GET /server/jobs`, `POST /server/jobs/{name}/run` (scope
  `admin`, and the admin role at every call). No token is granted these scopes yet: until the
  first-party clients exist, each of these routes answers `403`. `oidc.displayName` and
  `llm.provider` (only `openai`) are settings (E8).
- New MCP tools (scope `read`), from the same descriptors and handlers as their routes, answering
  what the route answers: `get_preferences`, `get_profile`, `list_categories` (argument `archived`),
  `list_labels`, `list_connections`.

## 2026-11-14 · one pension fund model (release N6)

Funds has one kind of fund. A fund's documents are not read any more.

- `POST /api/v1/imports`: the kinds `cometa_operations` and `cometa_position` stay in the contract
  and are refused with `415 unsupported_format`. The file is not stored. `payslip` is unchanged.
- No other route or tool changes: no route and no tool returns a fund, and the deductible figure
  and the fund's documents had no field.

## 2026-10-30 · the P&L of a period (PERS-145)

`GET /api/v1/investments` and the MCP tool `list_investments` add `pnl`: the profit and loss of a
period from the engine every screen uses, so the API, the MCP and the screen quote one number. Every
field before it is unchanged.

- Query `period` (a year `YYYY` or `all`), or `from`/`to` (`YYYY-MM-DD`, they win over `period`);
  nothing is the year running. The MCP tool takes the same three as optional arguments.
- `pnl.period` (`kind`, `from`, `to`), `pnl.currency` (the display currency), `pnl.status`
  (`verified`, `stale`, `undetermined`), and the parts as decimal strings: `pnl`, `realized`,
  `unrealized` (open positions at the end of the period only; `0.00` when none is open), `income`,
  `fees`, `corrections`, `fx`; plus `transfers` between the person's own services. The parts add up
  to `pnl`; the services add up to it with `transfers`.
- `pnl.services[]`: `accountId`, `status`, `from`, `to`, `openPositions`, `display` (the same parts
  in the display currency) and `local` (in the service's own `currency`).

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
