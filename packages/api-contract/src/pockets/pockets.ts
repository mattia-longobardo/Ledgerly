// Pockets (rewrite plan R2, 05-refactor.md §5.5 «pockets»; audit POC-1, POC-6): the open pockets as
// the Pockets page and `list_pockets` show them, Overview's tile, one pocket's page, the expenses a
// standalone pocket can take, and the eight writes of the pages. Amounts in are decimal strings
// (`amountInput`): the conversion from the person's number format stays with the client (POC-6).
import { z } from "zod";
import { defineRoute } from "../route";
import { amountInput, civilDate, hexColor, id, money, monthStart } from "../primitives";
import {
  ACCOUNT_ID,
  archivedPocket,
  byPocket,
  HISTORY_MONTHS,
  INTEREST_REASONS,
  linkCandidate,
  MAX_DESCRIPTION,
  MAX_NAME,
  PLANNED_ID,
  plannedExpense,
  POCKET_ERRORS,
  POCKET_ID,
  POCKET_ROW_EXAMPLE,
  POCKET_STATES,
  pocketExpense,
  pocketRow,
  TRANSACTION_ID,
} from "./shared";

export const listPockets = defineRoute({
  id: "list_pockets",
  method: "GET",
  path: "/pockets",
  scope: "read",
  capability: "pockets",
  summary:
    "The open pockets with what is left in each, the totals of the Pockets page (earmarked, the backing " +
    "accounts' balance, what is free on them, the monthly accruals), the archived pockets and the " +
    "accounts a pocket can rest on.",
  actions: [],
  response: z.object({
    pockets: z.array(pocketRow),
    archived: z.array(archivedPocket),
    totals: z.object({
      /** What the open pockets have left. */
      earmarked: money(),
      /** The backing accounts' balance; null with no pocket on an account or one balance unknown. */
      backing: money().nullable(),
      /** `backing − earmarked` of the pockets on an account; null as `backing`. */
      free: money().nullable(),
      /** What the active pockets are given each month. */
      monthly: money(),
    }),
    backingAccounts: z.array(z.object({ id: id(), name: z.string(), free: money().nullable() })),
    /** The day of the next monthly accrual. */
    nextAccrual: civilDate(),
    /** The open accounts a pocket can rest on. */
    accounts: z.array(z.object({ id: id(), name: z.string() })),
  }),
  errors: [],
  mcp: {
    title: "Pockets",
    description:
      "The open pockets with what is left in each, their target and monthly amount, and the totals " +
      "of the Pockets page: earmarked, the backing accounts' balance and what is free on them.",
  },
  example: {
    response: {
      pockets: [POCKET_ROW_EXAMPLE],
      archived: [{ id: PLANNED_ID, name: "Old car", color: null, target: null, monthly: "50.00" }],
      totals: { earmarked: "620.00", backing: "5000.00", free: "4380.00", monthly: "100.00" },
      backingAccounts: [{ id: ACCOUNT_ID, name: "Savings", free: "4380.00" }],
      nextAccrual: "2026-11-01",
      accounts: [{ id: ACCOUNT_ID, name: "Savings" }],
    },
  },
});

export const getPocketsOverview = defineRoute({
  id: "get_pockets_overview",
  method: "GET",
  path: "/pockets/overview",
  scope: "read",
  capability: "pockets",
  summary:
    "Overview's «Pockets» tile: what the open pockets have left, what they are given each month, how many.",
  actions: [],
  response: z.object({ total: money(), monthly: money(), count: z.number().int() }),
  errors: [],
  example: { response: { total: "620.00", monthly: "100.00", count: 1 } },
});

export const listPocketCandidates = defineRoute({
  id: "list_pocket_candidates",
  method: "GET",
  path: "/pockets/candidates",
  scope: "read",
  capability: "pockets",
  summary:
    "The expenses a standalone pocket can take: the visible expenses of the last 120 days, not on an " +
    "account a pocket rests on and not filed under a pocket yet. Newest first.",
  actions: [],
  response: z.object({ candidates: z.array(linkCandidate) }),
  errors: [],
  example: {
    response: {
      candidates: [
        { id: TRANSACTION_ID, on: "2026-10-12", amount: "84.00", payee: "Ryanair", account: "Checking" },
      ],
    },
  },
});

export const getPocket = defineRoute({
  id: "get_pocket",
  method: "GET",
  path: "/pockets/{id}",
  scope: "read",
  capability: "pockets",
  summary:
    `One open pocket's page: its row, what it was given, accrued and spent, the target's progress, the ` +
    `estimated interest, the month-end balance of the last ${HISTORY_MONTHS} months, its expenses and the ` +
    "planned ones. `not_found` for an archived pocket.",
  actions: [],
  params: byPocket,
  response: z.object({
    pocket: pocketRow.extend({
      /** Every accrual, deposit and adjustment since the start. */
      budget: money(),
      /** What the monthly accruals have added since the start. */
      accrued: money(),
      /** Spent since the start, negative. */
      spent: money(),
      /** `target − balance`; null without a target or once reached. */
      toGo: money().nullable(),
      /** Months to the target; 0 once reached, null without a target or a monthly amount. */
      eta: z.number().int().nullable(),
      /** The month the target is reached at this pace; null as `eta`. */
      etaMonth: monthStart().nullable(),
      /** The account's interest of the last twelve months × the pocket's share of it; null unknown. */
      interest: money().nullable(),
      interestReason: z.enum(INTEREST_REASONS),
      /** What is free on its account after its pockets; null for a standalone one or unknown. */
      freeOnAccount: money().nullable(),
    }),
    /** Oldest first, one balance per month; null before any movement. */
    history: z.array(z.object({ month: monthStart(), balance: money().nullable() })),
    expenses: z.array(pocketExpense),
    planned: z.array(plannedExpense),
  }),
  errors: ["not_found"],
  example: {
    params: { id: POCKET_ID },
    response: {
      pocket: {
        ...POCKET_ROW_EXAMPLE,
        budget: "1000.00",
        accrued: "1000.00",
        spent: "-380.00",
        toGo: "880.00",
        eta: 9,
        etaMonth: "2027-07-01",
        interest: "4.12",
        interestReason: "estimate",
        freeOnAccount: "4380.00",
      },
      history: [{ month: "2026-10-01", balance: "620.00" }],
      expenses: [
        {
          id: TRANSACTION_ID,
          on: "2026-10-12",
          amount: "84.00",
          payee: "Ryanair",
          note: null,
          account: "Savings",
          linked: false,
          manual: false,
        },
      ],
      planned: [
        { id: PLANNED_ID, description: "Hotel", amount: "200.00", dueOn: "2026-12-01", overdue: false },
      ],
    },
  },
});

/** The pocket dialog: an empty amount is no amount at all. */
const pocketBody = z
  .object({
    name: z.string().trim().min(1).max(MAX_NAME),
    color: hexColor().nullable(),
    accountId: id().nullable(),
    target: amountInput().nullable(),
    monthly: amountInput().nullable(),
    startMonth: monthStart(),
  })
  .strict();

const POCKET_BODY_EXAMPLE = {
  name: "Holiday",
  color: "#3366cc",
  accountId: ACCOUNT_ID,
  target: "1500",
  monthly: "100",
  startMonth: "2026-01-01",
};

export const createPocket = defineRoute({
  id: "create_pocket",
  method: "POST",
  path: "/pockets",
  scope: "write",
  capability: "pockets",
  summary:
    "Creates a pocket, on an open account or standalone. Target and monthly are positive decimal strings, " +
    "or null.",
  actions: ["createPocketAction"],
  body: pocketBody,
  response: z.object({ id: id() }),
  status: 201,
  errors: POCKET_ERRORS,
  example: { body: POCKET_BODY_EXAMPLE, response: { id: POCKET_ID } },
});

export const updatePocket = defineRoute({
  id: "update_pocket",
  method: "PUT",
  path: "/pockets/{id}",
  scope: "write",
  capability: "pockets",
  summary: "Changes a pocket: every field of the dialog, as `POST /pockets` takes them.",
  actions: ["updatePocketAction"],
  params: byPocket,
  body: pocketBody,
  response: null,
  status: 204,
  errors: POCKET_ERRORS,
  example: { params: { id: POCKET_ID }, body: POCKET_BODY_EXAMPLE },
});

export const setPocketState = defineRoute({
  id: "set_pocket_state",
  method: "PUT",
  path: "/pockets/{id}/state",
  scope: "write",
  capability: "pockets",
  summary: "Pauses, resumes, archives or restores a pocket.",
  actions: ["setPocketStateAction"],
  params: byPocket,
  body: z.object({ state: z.enum(POCKET_STATES) }).strict(),
  response: null,
  status: 204,
  errors: POCKET_ERRORS,
  example: { params: { id: POCKET_ID }, body: { state: "paused" } },
});

export const addToPocket = defineRoute({
  id: "add_to_pocket",
  method: "POST",
  path: "/pockets/{id}/deposits",
  scope: "write",
  capability: "pockets",
  summary:
    "Adds money to a pocket's budget on a day, today or before. The amount is a positive decimal string.",
  actions: ["addToPocketAction"],
  params: byPocket,
  body: z.object({ amount: amountInput(), on: civilDate() }).strict(),
  response: null,
  status: 204,
  errors: POCKET_ERRORS,
  example: { params: { id: POCKET_ID }, body: { amount: "50", on: "2026-10-20" } },
});

const byExpense = z.object({ id: id(), transaction: id() });

export const linkPocketExpense = defineRoute({
  id: "link_pocket_expense",
  method: "PUT",
  path: "/pockets/{id}/expenses/{transaction}",
  scope: "write",
  capability: "pockets",
  summary:
    "Files an expense under a standalone pocket (`GET /pockets/candidates` lists the ones it can take).",
  actions: ["linkExpenseAction"],
  params: byExpense,
  response: null,
  status: 204,
  errors: POCKET_ERRORS,
  example: { params: { id: POCKET_ID, transaction: TRANSACTION_ID } },
});

export const unlinkPocketExpense = defineRoute({
  id: "unlink_pocket_expense",
  method: "DELETE",
  path: "/pockets/{id}/expenses/{transaction}",
  scope: "write",
  capability: "pockets",
  summary: "Takes an expense filed by hand out of a standalone pocket.",
  actions: ["unlinkExpenseAction"],
  params: byExpense,
  response: null,
  status: 204,
  errors: POCKET_ERRORS,
  example: { params: { id: POCKET_ID, transaction: TRANSACTION_ID } },
});

export const addPlannedExpense = defineRoute({
  id: "add_planned_expense",
  method: "POST",
  path: "/pockets/{id}/planned",
  scope: "write",
  capability: "pockets",
  summary: "Plans an expense on a pocket for a day, today or later. The amount is a positive decimal string.",
  actions: ["addPlannedExpenseAction"],
  params: byPocket,
  body: z
    .object({
      amount: amountInput(),
      dueOn: civilDate(),
      description: z.string().trim().min(1).max(MAX_DESCRIPTION),
    })
    .strict(),
  response: null,
  status: 204,
  errors: POCKET_ERRORS,
  example: {
    params: { id: POCKET_ID },
    body: { amount: "200", dueOn: "2026-12-01", description: "Hotel" },
  },
});

export const removePlannedExpense = defineRoute({
  id: "remove_planned_expense",
  method: "DELETE",
  path: "/pockets/planned/{id}",
  scope: "write",
  capability: "pockets",
  summary: "Removes a planned expense (the `id` of `planned[]` in `GET /pockets/{id}`).",
  actions: ["removePlannedExpenseAction"],
  params: z.object({ id: id() }),
  response: null,
  status: 204,
  errors: POCKET_ERRORS,
  example: { params: { id: PLANNED_ID } },
});
