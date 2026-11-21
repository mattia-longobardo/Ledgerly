// The writes of a service's register (rewrite plan R2, 05-refactor.md §5.5 «investments»): a manual
// service, its address and its value, the operations a person writes on a holding, the decisions on
// a provider's reading, and the transfers between two services. Refusals: `INVESTMENT_REFUSALS`.
import { z } from "zod";
import { id } from "../primitives";
import { defineRoute } from "../route";
import {
  manualServiceBody,
  operationBody,
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
    "type, or already a service.",
  actions: ["createManualServiceAction"],
  body: manualServiceBody,
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
  actions: ["updateServiceUrlAction"],
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
  actions: ["updateServiceValueAction"],
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
    "Writes a valuation, a sale, a close or an income on a service (not in the future). A deposit, a " +
    "withdrawal, an account valuation or a correction comes from Accounts or the provider: `409` " +
    "`not_editable`. Answers the event's id.",
  actions: ["recordOperationAction"],
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

export const deleteOperation = defineRoute({
  id: "delete_investment_operation",
  method: "DELETE",
  path: "/investments/{accountId}/operations/{eventId}",
  scope: "write",
  capability: "investments",
  summary: "Deletes an operation written by hand; its legs are kept as revisions.",
  actions: ["deleteOperationAction"],
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
  actions: ["reconcileAction"],
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
  actions: ["confirmZeroAction"],
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
  actions: ["linkTransferAction"],
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
  actions: ["unlinkTransferAction"],
  params: byEvent,
  response: null,
  status: 204,
  errors: INVESTMENT_ERRORS,
  example: { params: { accountId: ACCOUNT_ID, eventId: EVENT_ID } },
});
