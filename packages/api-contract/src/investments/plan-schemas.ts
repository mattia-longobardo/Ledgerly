// The vocabularies, the bodies and the answers of the purchase plans (rewrite plan R5d, step 2): the
// routes are in `plans.ts`, which re-exports all of this.
import { z } from "zod";
import { amountInput, civilDate, id, money } from "../primitives";
import { INSTRUMENT_ID } from "./shared";

export const PLAN_FREQUENCIES = ["day", "week", "month", "quarter"] as const;
export const PLAN_MODES = ["propose", "auto"] as const;
export const PLAN_STATES = ["active", "paused", "ended"] as const;
/** `single`: a plan of R5d, one instrument; `basket`: 1-10 by weight, whole shares, proposals (PERS-681). */
export const PLAN_MODELS = ["single", "basket"] as const;
/** A basket's cadence: every N working days (Monday-Friday), weeks or months. */
export const BASKET_FREQUENCIES = ["day", "week", "month"] as const;
/** A line of a basket's execution: shares to buy, none (one costs more than its part), or no price yet. */
export const PLAN_LINE_STATES = ["buy", "too_expensive", "price_missing"] as const;
/** A basket buys at most this many instruments. */
export const MAX_PLAN_INSTRUMENTS = 10;
/** `expired`: a proposal still open when the next due date came (PERS-681 §4.3). */
export const PLAN_RUN_STATES = [
  "pending",
  "waiting_price",
  "proposed",
  "recorded",
  "skipped",
  "expired",
] as const;
/** Why the job left an `auto` instalment to the person (P2): the refusal of the purchase. */
export const PLAN_RUN_REASONS = [
  "negative_cash",
  "quantity_exceeded",
  "wrong_mode",
  "before_period",
  // A basket plan (PERS-681): a working day with no close of its own, and a converted plan with no amount.
  "market_closed",
  "amount_missing",
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
/** A basket's weight: a percentage with at most 2 decimals ("33.33"), all of them 100. */
const weightInput = () => z.string().regex(/^\d{1,3}(\.\d{1,2})?$/);

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
  /** `basket` for every plan made or converted since PERS-681; `single` only after a rollback. */
  model: z.enum(PLAN_MODELS),
  /**
   * A basket's instruments, heaviest first, each with its weight in percent ("50", "33.33"). For a
   * basket, `amount` is the amount of each execution in `currency` (the portfolio's): null on a
   * converted plan, «amount to type»; `asset` is the heaviest instrument; `quantity` is null.
   */
  instruments: z.array(
    z.object({
      assetId: id(),
      name: z.string(),
      instrumentId: id().nullable(),
      mic: z.string().nullable(),
      weight: z.string(),
    }),
  ),
  /** A basket's carry to its next execution (what the last one did not spend; may be negative). */
  carry: money(),
});

export const PLAN_EXAMPLE = {
  id: PLAN_ID,
  name: "Monthly ETFs",
  asset: {
    id: "091a2b3c-4d5e-4f60-9172-1a2b3c4d5e6f",
    name: "An ETF",
    instrumentId: INSTRUMENT_ID,
    mic: "XMIL",
  },
  currency: "EUR",
  amount: "100.00",
  quantity: null,
  fractions: false,
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
  model: "basket",
  instruments: [
    {
      assetId: "091a2b3c-4d5e-4f60-9172-1a2b3c4d5e6f",
      name: "An ETF",
      instrumentId: INSTRUMENT_ID,
      mic: "XMIL",
      weight: "100",
    },
  ],
  carry: "24.75",
} as const;

export const plansList = z.object({ accountId: id(), plans: z.array(planOut) });

/** An instrument of a basket: one of the portfolio's assets, or an instrument of the registry on a market. */
const basketInstrument = z.union([
  z.object({ assetId: id(), weight: weightInput() }).strict(),
  z
    .object({
      instrumentId: id(),
      mic: z
        .string()
        .regex(/^[A-Z0-9]{4}$/)
        .nullable()
        .default(null),
      weight: weightInput(),
    })
    .strict(),
]);

/**
 * A basket plan (PERS-681): 1-10 instruments whose weights make 100, the amount of each execution in
 * the portfolio's currency (fees are on top), a cadence, a start today or later. The body of R5d (one
 * `instrumentId` with an `amount` or a `quantity`) is refused: `invalid`.
 */
export const planBody = z
  .object({
    name: z.string().trim().min(1).max(80),
    amount: amountInput(),
    instruments: z.array(basketInstrument).min(1).max(MAX_PLAN_INSTRUMENTS),
    frequency: z.enum(BASKET_FREQUENCIES),
    /** Every `interval` working days, weeks or months. */
    interval: z.number().int().min(1).max(12).default(1),
    /** The day of the month (1-31), or of the week (1 Monday - 7) for `week`; not read for `day`. */
    day: z.number().int().min(1).max(31).default(1),
    startOn: civilDate(),
    endOn: civilDate().nullable().default(null),
    runsLimit: z.number().int().min(1).max(600).nullable().default(null),
    debitAccountId: id().nullable().default(null),
    /** The fee of each purchase, outside the amount (D1). */
    fee: fee.nullable().default(null),
  })
  .strict()
  .refine((plan) => plan.endOn === null || plan.runsLimit === null, "An end day or a number of executions")
  .refine((plan) => plan.frequency !== "week" || plan.day <= 7, "A day of the week is 1-7");

export const planUpdateBody = z
  .object({
    name: z.string().trim().min(1).max(80).optional(),
    /** A basket only: the amount of each execution, its instruments and its cadence, from the next execution. */
    amount: amountInput().optional(),
    instruments: z.array(basketInstrument).min(1).max(MAX_PLAN_INSTRUMENTS).optional(),
    frequency: z.enum(BASKET_FREQUENCIES).optional(),
    interval: z.number().int().min(1).max(12).optional(),
    day: z.number().int().min(1).max(31).optional(),
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

/** A line of a basket's execution: the close used, the shares proposed or confirmed and what they cost. */
export const runLineOut = z.object({
  assetId: id(),
  name: z.string(),
  /** The weight in percent, copied from the plan when the execution was proposed. */
  weight: z.string(),
  /** The close and its currency and day; null with no price yet. */
  price: z.string().nullable(),
  priceCurrency: z.string().nullable(),
  priceOn: civilDate().nullable(),
  /** Units of the portfolio's currency per unit of the instrument's (ECB); null in the same currency. */
  fxRate: z.string().nullable(),
  /** The part of the budget, the whole shares and what they cost, in the run's `currency`. */
  target: money(),
  quantity: z.string(),
  spent: money(),
  state: z.enum(PLAN_LINE_STATES),
  /** The purchase written for the line, once confirmed. */
  eventId: id().nullable(),
});

/**
 * A basket's execution (PERS-681): its budget (amount plus the carry in), the carry in, and the carry
 * out once closed (`recorded`, `skipped`, `expired`); the lines, heaviest first. All null and empty
 * for a plan of R5d, whose `proposal` they replace.
 */
const basketRunOut = z.object({
  budget: money().nullable(),
  carryIn: money().nullable(),
  carryOut: money().nullable(),
  lines: z.array(runLineOut),
});

export const runsList = z.object({ planId: id(), runs: z.array(runOut.extend(basketRunOut.shape)) });

/** Corrections to preview on a basket's proposal: a price typed proposes its shares again; shares typed win. */
export const previewBody = z
  .object({
    lines: z
      .array(
        z
          .object({
            assetId: id(),
            unitPrice: decimalInput().optional(),
            quantity: decimalInput().optional(),
          })
          .strict(),
      )
      .default([]),
  })
  .strict();

/** The proposal with the corrections, as the server computes it: nothing is written. */
export const previewOut = z.object({
  runId: id(),
  currency: z.string(),
  budget: money(),
  spent: money(),
  carryOut: money(),
  lines: z.array(runLineOut.omit({ priceCurrency: true, priceOn: true, eventId: true })),
});

/**
 * A confirmation may correct the proposal: its day, its quantity, its price and its fee. A basket's
 * execution gives `lines` instead: every line of it, each once, with the shares bought (0: none) and
 * the real price; the fee of each purchase is the plan's unless typed.
 */
export const confirmBody = z
  .object({
    on: civilDate().optional(),
    quantity: decimalInput().optional(),
    unitPrice: decimalInput().optional(),
    fee: amountInput().optional(),
    lines: z
      .array(
        z
          .object({
            assetId: id(),
            quantity: decimalInput(),
            unitPrice: decimalInput(),
            fee: amountInput().optional(),
          })
          .strict(),
      )
      .min(1)
      .max(MAX_PLAN_INSTRUMENTS)
      .optional(),
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
