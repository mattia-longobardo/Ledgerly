// The vocabularies, the bodies and the answers of the purchase plans (rewrite plan R5d, step 2): the
// routes are in `plans.ts`, which re-exports all of this.
import { z } from "zod";
import { amountInput, civilDate, id, money } from "../primitives";
import { INSTRUMENT_ID } from "./shared";

export const PLAN_FREQUENCIES = ["week", "month", "quarter"] as const;
export const PLAN_MODES = ["propose", "auto"] as const;
export const PLAN_STATES = ["active", "paused", "ended"] as const;
export const PLAN_RUN_STATES = ["pending", "waiting_price", "proposed", "recorded", "skipped"] as const;
/** Why the job left an `auto` instalment to the person (P2): the refusal of the purchase. */
export const PLAN_RUN_REASONS = [
  "negative_cash",
  "quantity_exceeded",
  "wrong_mode",
  "before_period",
] as const;
/** The past due dates «Record the past instalments» takes at once (P4). */
export const MAX_BACKFILL_RUNS = 60;

export const PLAN_ID = "6f708192-a3b4-45c6-87d8-708192a3b4c5";
export const RUN_ID = "708192a3-b4c5-46d7-98e9-8192a3b4c5d6";

/** A quantity or a unit price: a plain decimal, not negative. */
const decimalInput = () => z.string().regex(/^\s*\d+(\.\d+)?\s*$/);
export const byPlan = z.object({ accountId: id(), planId: id() });
export const byRun = z.object({ accountId: id(), planId: id(), runId: id() });

/** A percentage, as the fees of the funds ("0.19" is 0,19 %). */
const percentInput = () => z.string().regex(/^\d{1,3}(\.\d{1,4})?$/);

/** The fee of each instalment (E3): an amount, or a percentage of the instalment ("0.19" is 0,19 %). */
const fee = z
  .object({ amount: amountInput().nullable().default(null), rate: percentInput().nullable().default(null) })
  .strict()
  .refine((value) => (value.amount === null) !== (value.rate === null), "An amount or a rate");

/** An amount in the plan's currency, or a percentage ("0.19" is 0,19 %). */
const feeOut = z.object({ amount: money().nullable(), rate: z.string().nullable() });

export const planOut = z.object({
  id: id(),
  name: z.string(),
  /** The asset bought, with the instrument and the market of the order. */
  asset: z.object({ id: id(), name: z.string(), instrumentId: id().nullable(), mic: z.string().nullable() }),
  /** The currency of the amount and of the fee: the asset's, the one of its price (ISO 4217). */
  currency: z.string(),
  /** Each instalment buys for an amount, or a quantity: one of the two is null. */
  amount: money().nullable(),
  quantity: z.string().nullable(),
  /** A plan for an amount buys fractions of a unit, or whole units only (P3). */
  fractions: z.boolean(),
  frequency: z.enum(PLAN_FREQUENCIES),
  /** Every `interval` weeks, months or quarters. */
  interval: z.number().int(),
  /** The day of the month (1-31; the month's last when shorter), or of the week (1 Monday - 7) for `week`. */
  day: z.number().int(),
  startOn: civilDate(),
  /** The plan ends on a day or after a number of instalments, or never: at most one is set. */
  endOn: civilDate().nullable(),
  runsLimit: z.number().int().nullable(),
  /** The account the instalment is paid from (P1 B): only to find its bank movement, never a deposit. */
  debitAccountId: id().nullable(),
  fee: feeOut.nullable(),
  mode: z.enum(PLAN_MODES),
  state: z.enum(PLAN_STATES),
  nextDueOn: civilDate().nullable(),
  /** Instalments waiting for the person: to confirm, or with no price yet. */
  toConfirm: z.number().int(),
  waitingPrice: z.number().int(),
});

export const PLAN_EXAMPLE = {
  id: PLAN_ID,
  name: "Monthly world ETF",
  asset: {
    id: "091a2b3c-4d5e-4f60-9172-1a2b3c4d5e6f",
    name: "An ETF",
    instrumentId: INSTRUMENT_ID,
    mic: "XMIL",
  },
  currency: "EUR",
  amount: "100.00",
  quantity: null,
  fractions: true,
  frequency: "month",
  interval: 1,
  day: 5,
  startOn: "2026-01-05",
  endOn: null,
  runsLimit: null,
  debitAccountId: null,
  fee: { amount: "2.95", rate: null },
  mode: "propose",
  state: "active",
  nextDueOn: "2026-12-05",
  toConfirm: 0,
  waitingPrice: 0,
} as const;

export const plansList = z.object({ accountId: id(), plans: z.array(planOut) });

export const planBody = z
  .object({
    name: z.string().trim().min(1).max(80),
    instrumentId: id(),
    mic: z
      .string()
      .regex(/^[A-Z0-9]{4}$/)
      .nullable()
      .default(null),
    amount: amountInput().nullable().default(null),
    quantity: decimalInput().nullable().default(null),
    fractions: z.boolean().default(true),
    frequency: z.enum(PLAN_FREQUENCIES),
    interval: z.number().int().min(1).max(12).default(1),
    day: z.number().int().min(1).max(31),
    startOn: civilDate(),
    endOn: civilDate().nullable().default(null),
    runsLimit: z.number().int().min(1).max(600).nullable().default(null),
    debitAccountId: id().nullable().default(null),
    fee: fee.nullable().default(null),
    mode: z.enum(PLAN_MODES).default("propose"),
  })
  .strict()
  .refine((plan) => (plan.amount === null) !== (plan.quantity === null), "An amount or a quantity")
  .refine((plan) => plan.endOn === null || plan.runsLimit === null, "An end day or a number of instalments")
  .refine((plan) => plan.frequency !== "week" || plan.day <= 7, "A day of the week is 1-7");

export const planUpdateBody = z
  .object({
    name: z.string().trim().min(1).max(80).optional(),
    mode: z.enum(PLAN_MODES).optional(),
    state: z.enum(PLAN_STATES).optional(),
    endOn: civilDate().nullable().optional(),
    runsLimit: z.number().int().min(1).max(600).nullable().optional(),
    debitAccountId: id().nullable().optional(),
    fee: fee.nullable().optional(),
  })
  .strict();

/** What a proposed instalment would write: the form, filled in. */
const proposal = z.object({
  on: civilDate(),
  quantity: z.string(),
  unitPrice: z.string(),
  amount: money(),
  fee: money(),
});

export const runOut = z.object({
  id: id(),
  dueOn: civilDate(),
  state: z.enum(PLAN_RUN_STATES),
  /** The currency of the price and of the proposal: the asset's (ISO 4217). */
  currency: z.string(),
  /** The close the instalment is priced at, and its day: the first on or after the due date. */
  price: z.string().nullable(),
  priceOn: civilDate().nullable(),
  /** Since when no price was found: after 5 working days the person types it. */
  waitingSince: civilDate().nullable(),
  /** Why the job did not write it in `auto` (P2): `negative_cash`, `quantity_exceeded`; null otherwise. */
  reason: z.enum(PLAN_RUN_REASONS).nullable(),
  proposal: proposal.nullable(),
  /** The movement of the debit account the matcher found for it (E7): proposed, linked only when the person says. */
  debit: z
    .object({
      transactionId: id(),
      on: civilDate(),
      amount: money(),
      /** The bank account's currency. */
      currency: z.string(),
      payee: z.string().nullable(),
      linked: z.boolean(),
    })
    .nullable(),
  /** The purchase written, and whether the job wrote it («automatic»). */
  eventId: id().nullable(),
  automatic: z.boolean(),
});

export const runsList = z.object({ planId: id(), runs: z.array(runOut) });

/** A confirmation may correct the proposal: its day, its quantity, its price and its fee. */
export const confirmBody = z
  .object({
    on: civilDate().optional(),
    quantity: decimalInput().optional(),
    unitPrice: decimalInput().optional(),
    fee: amountInput().optional(),
  })
  .strict();

/** A past due date «Record the past instalments» offers, with the proposal at its close when known. */
const pastRunOut = z.object({
  dueOn: civilDate(),
  /** The first close on or after the due date, and its day; null when the registry has none. */
  price: z.string().nullable(),
  priceOn: civilDate().nullable(),
  proposal: proposal.nullable(),
});

export const pastRunsList = z.object({
  planId: id(),
  /** The currency of the prices and of the proposals: the asset's (ISO 4217). */
  currency: z.string(),
  /** The oldest past due dates with nothing recorded or skipped, at most 60, oldest first. */
  runs: z.array(pastRunOut),
  /** More past due dates follow the 60: they come once these are recorded. */
  more: z.boolean(),
});

export const backfillBody = z
  .object({
    runs: z
      .array(
        z
          .object({
            dueOn: civilDate(),
            on: civilDate(),
            quantity: decimalInput(),
            unitPrice: decimalInput(),
            fee: amountInput().nullable().default(null),
          })
          .strict(),
      )
      .min(1)
      .max(MAX_BACKFILL_RUNS),
  })
  .strict();
