// Transactions · the giroconti between a person's accounts (decisions 6A–10A of 2026-11-25): a
// giroconto has no category, it has the other account — one of the person's, or one outside
// Ledgerly. What the person decides by hand, and the pairs found by amount and day that wait for them.
import { z } from "zod";
import { defineRoute } from "../route";
import { civilDate, id, money } from "../primitives";
import {
  ACCOUNT_ID,
  byTransaction,
  OTHER_TRANSACTION_ID,
  TRANSACTION_ERRORS,
  TRANSACTION_ID,
} from "./shared";

const PROPOSAL_ID = "5e6f7a8b-9c0d-4e1f-8a2b-3c4d5e6f7a8b";
const OTHER_ACCOUNT_ID = "2a3b4c5d-6e7f-4a8b-9c0d-1e2f3a4b5c6d";

export const setTransferSide = defineRoute({
  id: "set_transfer_side",
  method: "PUT",
  path: "/transactions/{id}/transfer",
  scope: "write",
  capability: "transactions",
  summary:
    "The other side of a movement, chosen by the person: `account` makes it a giroconto with one of " +
    "their accounts (paired at once when the other leg there is unique, else it waits for it), " +
    "`outside` a giroconto with an account outside Ledgerly (out of income, spending and budgets), " +
    "`none` an income or a spending again, by its sign. A leg of a pair leaves it; the other leg " +
    "waits for the person. A giroconto has no category.",
  actions: [],
  params: byTransaction,
  body: z.discriminatedUnion("kind", [
    z.object({ kind: z.literal("account"), accountId: id() }),
    z.object({ kind: z.literal("outside") }),
    z.object({ kind: z.literal("none") }),
  ]),
  response: null,
  status: 204,
  errors: TRANSACTION_ERRORS,
  example: { params: { id: TRANSACTION_ID }, body: { kind: "account", accountId: ACCOUNT_ID } },
});

export const pairTransfer = defineRoute({
  id: "pair_transfer",
  method: "POST",
  path: "/transactions/transfer-pairs",
  scope: "write",
  capability: "transactions",
  summary:
    "Pairs two movements of two of the person's accounts, money out and money in, as one giroconto. " +
    "The amounts may differ (two currencies). A pair made by hand is never undone by the automatic " +
    "pairing; each movement leaves the pair it was in.",
  actions: [],
  body: z.object({ ids: z.tuple([id(), id()]) }),
  response: null,
  status: 204,
  errors: TRANSACTION_ERRORS,
  example: { body: { ids: [TRANSACTION_ID, OTHER_TRANSACTION_ID] } },
});

const proposalLeg = z.object({
  id: id(),
  accountId: id(),
  on: civilDate(),
  amount: money(),
  currency: z.string(),
  payee: z.string().nullable(),
});

export const listTransferProposals = defineRoute({
  id: "list_transfer_proposals",
  method: "GET",
  path: "/transactions/transfer-proposals",
  scope: "read",
  capability: "transactions",
  summary:
    "The giroconti found by amount and day that are not sure enough to be paired: the same amount " +
    "on several legs at the same distance. The person confirms or rejects each; nothing is paired " +
    "until then. The oldest money out first.",
  actions: [],
  response: z.object({ proposals: z.array(z.object({ id: id(), out: proposalLeg, in: proposalLeg })) }),
  errors: [],
  example: {
    response: {
      proposals: [
        {
          id: PROPOSAL_ID,
          out: {
            id: TRANSACTION_ID,
            accountId: ACCOUNT_ID,
            on: "2026-10-14",
            amount: "-250.00",
            currency: "EUR",
            payee: "Giroconto",
          },
          in: {
            id: OTHER_TRANSACTION_ID,
            accountId: OTHER_ACCOUNT_ID,
            on: "2026-10-14",
            amount: "250.00",
            currency: "EUR",
            payee: null,
          },
        },
      ],
    },
  },
});

export const answerTransferProposal = defineRoute({
  id: "answer_transfer_proposal",
  method: "POST",
  path: "/transactions/transfer-proposals/{id}",
  scope: "write",
  capability: "transactions",
  summary:
    "The person's answer to a proposed giroconto: `accept` pairs the two as by hand and drops the " +
    "other proposals of the same movements; a refusal is kept, so the pair is never proposed again.",
  actions: [],
  params: z.object({ id: id() }),
  body: z.object({ accept: z.boolean() }),
  response: null,
  status: 204,
  errors: ["invalid", "not_found", "conflict"],
  example: { params: { id: PROPOSAL_ID }, body: { accept: true } },
});
