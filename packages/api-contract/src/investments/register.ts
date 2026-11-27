// The writes of a service's register (rewrite plan R2, 05-refactor.md §5.5 «investments»): a manual
// service, its address and its value, the operations a person writes on a holding, the decisions on
// a provider's reading, and the transfers between two services. Refusals: `INVESTMENT_REFUSALS`.
import { z } from "zod";
import { id } from "../primitives";
import { defineRoute } from "../route";
import {
  conversionBody,
  manualServiceBody,
  newManualServiceBody,
  newPortfolioBody,
  operationBody,
  portfolioBody,
  priceModeBody,
  reconciliationBody,
  transferBody,
  urlBody,
  valueBody,
} from "./bodies";
import {
  ACCOUNT_ID,
  byService,
  DEPOSIT_ID,
  EVENT_ID,
  HOLDING_ID,
  INSTRUMENT_ID,
  INVESTMENT_ERRORS,
  READING_ID,
} from "./shared";

const byEvent = z.object({ accountId: id(), eventId: id() });
const created = z.object({ id: id() });
const TRANSFER_ID = "5e6f7081-92a3-44b5-a6c7-6f708192a3b4";

export const createManualService = defineRoute({
  id: "create_investment_service",
  method: "POST",
  path: "/investments",
  scope: "write",
  capability: "investments",
  summary:
    "Makes an investment or crypto account of Accounts a manual service: its value stays the account's " +
    "balance, its deposits and withdrawals the account's movements. `not_eligible`: a fund's, another " +
    "type, or already a service. Without `accountId`, makes the account too, from four fields: `name`, " +
    "`category`, `currency` and today's `value` (R5b). With `kind: portfolio`, a manual portfolio " +
    "(R5d): it keeps positions and writes the account's value; `not_eligible` also on an account a " +
    "source reads (reason `synced`), and without `accountId` it makes the account from `name` and " +
    "`currency`.",
  actions: [],
  body: z.union([manualServiceBody, newManualServiceBody, portfolioBody, newPortfolioBody]),
  response: z.object({ accountId: id() }),
  status: 201,
  errors: INVESTMENT_ERRORS,
  example: {
    body: { accountId: ACCOUNT_ID, category: "broker", url: null },
    response: { accountId: ACCOUNT_ID },
  },
});

export const updateServiceUrl = defineRoute({
  id: "update_investment_service",
  method: "PATCH",
  path: "/investments/{accountId}",
  scope: "write",
  capability: "investments",
  summary: "Changes the web address of a service; an empty one removes it.",
  actions: [],
  params: byService,
  body: urlBody,
  response: null,
  status: 204,
  errors: INVESTMENT_ERRORS,
  example: { params: { accountId: ACCOUNT_ID }, body: { url: "https://www.directa.it" } },
});

export const updateServiceValue = defineRoute({
  id: "set_investment_value",
  method: "PUT",
  path: "/investments/{accountId}/value",
  scope: "write",
  capability: "investments",
  summary:
    "«Update value» of a manual service: the value read at the broker on a day, written as the manual " +
    "balance of its account. `not_editable` on an account a provider reads.",
  actions: [],
  params: byService,
  body: valueBody,
  response: null,
  status: 204,
  errors: INVESTMENT_ERRORS,
  example: { params: { accountId: ACCOUNT_ID }, body: { on: "2026-11-20", amount: "12650.00" } },
});

export const recordOperation = defineRoute({
  id: "record_investment_operation",
  method: "POST",
  path: "/investments/{accountId}/operations",
  scope: "write",
  capability: "investments",
  summary:
    "Writes a valuation, a sale, a close or an income on a service (not in the future); on a manual " +
    "portfolio also a purchase of an instrument, a deposit and a withdrawal (R5d). A sale of more " +
    "than the quantity held that day, or a change that leaves a later sale short: `409` " +
    "`quantity_exceeded`. A deposit or a withdrawal of another service, an account valuation or a " +
    "correction comes from Accounts or the provider: `409` `not_editable`. On a manual portfolio, a day " +
    "before it was made moves its start back to that day (a plan's past instalments, P4); `400` " +
    "`before_positions` when its days before were a value only. Answers the event's id.",
  actions: [],
  params: byService,
  body: operationBody,
  response: created,
  status: 201,
  errors: INVESTMENT_ERRORS,
  example: {
    params: { accountId: ACCOUNT_ID },
    body: {
      kind: "sell",
      holdingId: HOLDING_ID,
      on: "2026-11-03",
      quantity: "2",
      unitPrice: "130.5",
      amount: null,
      fee: "1.50",
      note: null,
    },
    response: { id: EVENT_ID },
  },
});

export const setPriceMode = defineRoute({
  id: "set_investment_price_mode",
  method: "PUT",
  path: "/investments/{accountId}/holdings/{holdingId}/price-mode",
  scope: "write",
  capability: "investments",
  summary:
    "Where the price of a manual portfolio's asset comes from (R5d): `auto`, the daily close of the " +
    "market of the order; `manual`, the valuations typed by hand. `auto` on an asset with no priced " +
    "market: `409` `not_editable`.",
  actions: [],
  params: z.object({ accountId: id(), holdingId: id() }),
  body: priceModeBody,
  response: null,
  status: 204,
  errors: INVESTMENT_ERRORS,
  example: { params: { accountId: ACCOUNT_ID, holdingId: HOLDING_ID }, body: { mode: "manual" } },
});

export const convertToPortfolio = defineRoute({
  id: "convert_investment_to_portfolio",
  method: "POST",
  path: "/investments/{accountId}/conversion",
  scope: "write",
  capability: "investments",
  summary:
    "«Switch to positions» (R5d): a manual service kept by value becomes a manual portfolio from `on`. " +
    "The value before stays in its history; the positions open at their price and the cash is the " +
    "value of that day less the positions. `409` `negative_cash` when the positions are worth more, " +
    "`not_eligible` on a service that is not a manual one kept by value.",
  actions: [],
  params: byService,
  body: conversionBody,
  response: null,
  status: 204,
  errors: INVESTMENT_ERRORS,
  example: {
    params: { accountId: ACCOUNT_ID },
    body: {
      on: "2026-11-20",
      positions: [
        { instrumentId: INSTRUMENT_ID, mic: "XMIL", quantity: "100", unitPrice: "60", fxRate: null },
      ],
      note: null,
    },
  },
});

export const updateOperation = defineRoute({
  id: "update_investment_operation",
  method: "PATCH",
  path: "/investments/{accountId}/operations/{eventId}",
  scope: "write",
  capability: "investments",
  summary:
    "Rewrites an operation written by hand on a manual portfolio (PERS-683): the body of «Record " +
    "operation», same kind, same checks. Its legs before are kept as revisions; positions, cash and " +
    "P&L are rewritten from the older of the two days, and a deposit's or a withdrawal's leg in the " +
    "accounts follows the new day, amount and `counterpart`. A purchase keeps the plan instalment that " +
    "wrote it. `409` `not_editable` on a service that is not a manual portfolio (one a provider syncs, " +
    "one kept by value), on an event a provider or a conversion wrote, or with another `kind`; " +
    "`quantity_exceeded` and `negative_cash` as for a new operation.",
  actions: [],
  params: byEvent,
  body: operationBody,
  response: null,
  status: 204,
  errors: INVESTMENT_ERRORS,
  example: {
    params: { accountId: ACCOUNT_ID, eventId: EVENT_ID },
    body: {
      kind: "buy",
      instrumentId: INSTRUMENT_ID,
      mic: "XMIL",
      on: "2026-11-03",
      quantity: "3",
      unitPrice: "61.2",
      amount: null,
      fee: "2.95",
      fxRate: null,
      note: null,
    },
  },
});

export const deleteOperation = defineRoute({
  id: "delete_investment_operation",
  method: "DELETE",
  path: "/investments/{accountId}/operations/{eventId}",
  scope: "write",
  capability: "investments",
  summary: "Deletes an operation written by hand; its legs are kept as revisions.",
  actions: [],
  params: byEvent,
  response: null,
  status: 204,
  errors: INVESTMENT_ERRORS,
  example: { params: { accountId: ACCOUNT_ID, eventId: EVENT_ID } },
});

export const reconcileHolding = defineRoute({
  id: "reconcile_investment_holding",
  method: "POST",
  path: "/investments/{accountId}/holdings/{holdingId}/reconciliation",
  scope: "write",
  capability: "investments",
  summary:
    "A dated decision on a manual position the provider's reading may cover: covered by the provider, " +
    "partly (`quantity`), outside its scope (`product`), or reopened.",
  actions: [],
  params: z.object({ accountId: id(), holdingId: id() }),
  body: reconciliationBody,
  response: null,
  status: 204,
  errors: INVESTMENT_ERRORS,
  example: {
    params: { accountId: ACCOUNT_ID, holdingId: HOLDING_ID },
    body: {
      kind: "covered_by_provider",
      effectiveOn: "2026-11-01",
      quantity: null,
      product: null,
      readingId: READING_ID,
    },
  },
});

export const confirmZero = defineRoute({
  id: "confirm_investment_zero",
  method: "POST",
  path: "/investments/{accountId}/readings/{readingId}/zero",
  scope: "write",
  capability: "investments",
  summary: "Confirms that a reading of zero is real: the service was emptied.",
  actions: [],
  params: z.object({ accountId: id(), readingId: id() }),
  response: null,
  status: 204,
  errors: INVESTMENT_ERRORS,
  example: { params: { accountId: ACCOUNT_ID, readingId: READING_ID } },
});

export const linkTransfer = defineRoute({
  id: "link_investment_transfer",
  method: "POST",
  path: "/investments/{accountId}/transfers",
  scope: "write",
  capability: "investments",
  summary:
    "Links a withdrawal and a deposit of two services as one transfer, as the proposals pair them: the " +
    "portfolio leaves it out, each service keeps it as a flow. Answers the id of the pair.",
  actions: [],
  params: byService,
  body: transferBody,
  response: created,
  status: 201,
  errors: INVESTMENT_ERRORS,
  example: {
    params: { accountId: ACCOUNT_ID },
    body: { withdrawalId: EVENT_ID, depositId: DEPOSIT_ID },
    response: { id: TRANSFER_ID },
  },
});

export const unlinkTransfer = defineRoute({
  id: "unlink_investment_transfer",
  method: "DELETE",
  path: "/investments/{accountId}/transfers/{eventId}",
  scope: "write",
  capability: "investments",
  summary: "Unlinks the transfer one of whose legs is the event: both are flows again.",
  actions: [],
  params: byEvent,
  response: null,
  status: 204,
  errors: INVESTMENT_ERRORS,
  example: { params: { accountId: ACCOUNT_ID, eventId: EVENT_ID } },
});
