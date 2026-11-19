// Accounts · «move an account to the bank» (rewrite plan R2, 05-refactor.md §5.5;
// ux/n4-account-switch.md). The check reads the bank and the source of before, so it is a `POST`
// even if it writes nothing of its own. A refusal is `conflict` with the code of the closed list in
// `reason` (`not_allowed`, `source_unavailable`, `bank_unavailable`, `consent_expired`,
// `account_gone`, `stale`, `busy`, `failed`); a wait the bank asks for is `rate_limited` with the
// moment to try again in `reason`. Nothing a bank or a source said travels in an answer.
import { z } from "zod";
import { defineRoute } from "../route";
import { id } from "../primitives";
import { ACCOUNT_ID, byAccount } from "./shared";

const SWITCH_ERRORS = ["invalid", "not_found", "conflict"] as const;
const CONNECTION_ID = "4b3a2c1d-0e9f-4a8b-9c7d-6e5f4a3b2c1d";
const BANK_ACCOUNT_ID = "9e0f1a2b-3c4d-4e5f-8a6b-7c8d9e0f1a2b";
const FINGERPRINT = "f3a9c2";

/** One movement of the report: cents signed, as text. */
const movement = z.object({ day: z.string(), text: z.string(), cents: z.string() });

const report = z.object({
  fingerprint: z.string(),
  connectionId: id(),
  bankAccountId: id(),
  bank: z.string(),
  cutDate: z.string(),
  from: z.string(),
  unsent: z.array(
    z.object({
      day: z.string(),
      text: z.string(),
      cents: z.string(),
      state: z.enum(["to_send", "not_sent"]),
    }),
  ),
  balance: z.object({
    kind: z.string().nullable(),
    on: z.string().nullable(),
    local: z.string().nullable(),
    bank: z.string().nullable(),
    equal: z.boolean(),
  }),
  matched: z.array(movement.extend({ bankDay: z.string(), bankText: z.string() })),
  toCheck: z.array(z.object({ cents: z.string(), local: z.array(movement), bank: z.array(movement) })),
  onlyLocal: z.array(movement),
  onlyBank: z.array(movement),
  fresh: z.array(movement),
  transfers: z.object({
    pairs: z.array(
      z.object({
        outDay: z.string(),
        inDay: z.string(),
        from: z.string(),
        to: z.string(),
        cents: z.string(),
        byPerson: z.boolean(),
      }),
    ),
    byYear: z.array(z.object({ year: z.number().int(), count: z.number().int(), cents: z.string() })),
    totalCents: z.string(),
    ambiguous: z.number().int(),
  }),
  publishes: z.boolean(),
  join: z
    .object({
      account: z.string(),
      total: z.number().int(),
      matched: z.number().int(),
      unmatched: z.array(movement),
      manual: z.number().int(),
      categories: z.number().int(),
      notes: z.number().int(),
    })
    .nullable(),
});

const target = { connectionId: id(), bankAccountId: id() };

export const checkAccountSwitch = defineRoute({
  id: "check_account_switch",
  method: "POST",
  path: "/accounts/{id}/switch/check",
  scope: "write",
  capability: "accounts",
  summary:
    "The dry run of moving the account to a bank's account: the report the person reads before «Apply».",
  actions: ["checkSwitchAction"],
  params: byAccount,
  body: z.object(target).strict(),
  response: report,
  errors: SWITCH_ERRORS,
  example: {
    params: { id: ACCOUNT_ID },
    body: { connectionId: CONNECTION_ID, bankAccountId: BANK_ACCOUNT_ID },
    response: {
      fingerprint: FINGERPRINT,
      connectionId: CONNECTION_ID,
      bankAccountId: BANK_ACCOUNT_ID,
      bank: "Example Bank",
      cutDate: "2026-11-01",
      from: "2026-08-01",
      unsent: [],
      balance: { kind: "closing", on: "2026-11-17", local: "1200.00", bank: "1200.00", equal: true },
      matched: [
        { day: "2026-11-02", text: "Rent", cents: "-80000", bankDay: "2026-11-02", bankText: "RENT" },
      ],
      toCheck: [],
      onlyLocal: [],
      onlyBank: [],
      fresh: [],
      transfers: { pairs: [], byYear: [], totalCents: "0", ambiguous: 0 },
      publishes: false,
      join: null,
    },
  },
});

export const applyAccountSwitch = defineRoute({
  id: "apply_account_switch",
  method: "POST",
  path: "/accounts/{id}/switch",
  scope: "write",
  capability: "accounts",
  summary:
    "Applies the switch the report described: only with the report's `fingerprint` (`conflict`, reason `stale`).",
  actions: ["applySwitchAction"],
  params: byAccount,
  body: z.object({ ...target, fingerprint: z.string().min(1) }).strict(),
  response: z.object({ matched: z.number().int(), transfers: z.number().int(), fresh: z.number().int() }),
  errors: SWITCH_ERRORS,
  example: {
    params: { id: ACCOUNT_ID },
    body: { connectionId: CONNECTION_ID, bankAccountId: BANK_ACCOUNT_ID, fingerprint: FINGERPRINT },
    response: { matched: 41, transfers: 3, fresh: 2 },
  },
});

export const undoAccountSwitch = defineRoute({
  id: "undo_account_switch",
  method: "DELETE",
  path: "/accounts/{id}/switch",
  scope: "write",
  capability: "accounts",
  summary: "«Undo switch»: the account goes back to its source of before.",
  actions: ["undoSwitchAction"],
  params: byAccount,
  response: null,
  status: 204,
  errors: SWITCH_ERRORS,
  example: { params: { id: ACCOUNT_ID } },
});
