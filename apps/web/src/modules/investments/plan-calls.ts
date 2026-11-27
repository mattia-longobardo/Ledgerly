// The writes of the purchase plans of a manual portfolio to `/api/v1` (R5d; baskets of whole shares,
// docs/design/investments-plans-whole-shares.md §5). What a person typed is read here, in their number
// format, and goes on the wire as the contract's decimals; a weight and a fee's rate are percentages,
// typed and sent as such. Nothing is computed: the server proposes each execution, previews the
// corrections and writes the purchases.
import { plans } from "@ledgerly/api-contract/investments";
import type { NumberFormat } from "@ledgerly/format/format";
import { call, type RouteOutput } from "@ledgerly/api-client";
import { invalidate } from "@ledgerly/ui/data";
import {
  type ActionResult,
  amountOf,
  attempt,
  decimalOf,
  done,
  type Failure,
  failure,
  formatOf,
} from "./calls";

type PlanFrequency = (typeof plans.BASKET_FREQUENCIES)[number];
type PlanState = (typeof plans.PLAN_STATES)[number];

/** A plan's fee: none, an amount per purchase, or a percentage of it (E3). */
export interface PlanFee {
  kind: "none" | "amount" | "rate";
  value: string;
}

/**
 * An instrument of a basket as the form holds it: one the plan already has (its `assetId`), or one
 * picked in the registry on a market; its weight as typed.
 */
export interface PlanInstrument {
  key: string;
  name: string;
  weight: string;
  assetId: string | null;
  instrumentId: string | null;
  mic: string | null;
}

/** What a plan's form edits (PERS-681 §7): the same fields for a new plan and for one made. */
export interface PlanForm {
  name: string;
  /** The amount of each execution in the portfolio's currency; fees are on top (D1). */
  amount: string;
  instruments: PlanInstrument[];
  frequency: PlanFrequency;
  interval: string;
  day: string;
  startOn: string;
  /** The plan ends never, on a day, or after a number of executions. */
  end: "never" | "date" | "count";
  endOn: string;
  runsLimit: string;
  debitAccountId: string;
  fee: PlanFee;
}

/** A whole number as typed, or a refusal of the field. */
function wholeOf(typed: string): number {
  const value = Number(typed.trim());
  if (typed.trim() === "" || !Number.isInteger(value)) throw new RangeError(`Not a whole number: "${typed}"`);
  return value;
}

function required(value: string | null): string {
  if (value === null) throw new RangeError("Empty field");
  return value;
}

function feeOf(fee: PlanFee, format: NumberFormat) {
  if (fee.kind === "none") return null;
  if (fee.kind === "amount") return { amount: required(amountOf(fee.value, format)), rate: null };
  return { amount: null, rate: required(decimalOf(fee.value, format)) };
}

function instrumentOf(row: PlanInstrument, format: NumberFormat) {
  const weight = required(decimalOf(row.weight, format));
  if (row.assetId !== null) return { assetId: row.assetId, weight };
  return { instrumentId: required(row.instrumentId), mic: row.mic, weight };
}

/** What a plan made and a new one share: its size, its instruments, its schedule and its end. */
function planBody(form: PlanForm, format: NumberFormat) {
  return {
    name: form.name,
    amount: required(amountOf(form.amount, format)),
    instruments: form.instruments.map((row) => instrumentOf(row, format)),
    frequency: form.frequency,
    interval: wholeOf(form.interval),
    // A working day has no day of its own: the contract does not read it.
    day: form.frequency === "day" ? 1 : wholeOf(form.day),
    endOn: form.end === "date" ? form.endOn || null : null,
    runsLimit: form.end === "count" ? wholeOf(form.runsLimit) : null,
    debitAccountId: form.debitAccountId || null,
    fee: feeOf(form.fee, format),
  };
}

/** A write of the plans: on success the plans' reads and the portfolio's are stale. */
async function planWrite<T extends object>(work: () => Promise<T>): Promise<({ ok: true } & T) | Failure> {
  const result = await attempt(work);
  if (result.ok) invalidate(plans.listPlans, plans.listPlanRuns);
  return result;
}

export function createPlan(accountId: string, form: PlanForm): Promise<ActionResult> {
  return planWrite(async () => {
    const body = { ...planBody(form, await formatOf()), startOn: form.startOn };
    return call(plans.createPlan, { params: { accountId }, body });
  });
}

/**
 * A plan made changes from its next execution: an open proposal stays as it is (§5). Its cadence goes
 * only when changed: the server starts a new cadence from today.
 */
export function updatePlan(
  accountId: string,
  planId: string,
  form: PlanForm,
  before: PlanForm,
): Promise<ActionResult> {
  return planWrite(async () => {
    const format = await formatOf();
    const { frequency, interval, day, ...body } = planBody(form, format);
    const was = planBody({ ...before, amount: form.amount }, format);
    const cadence =
      frequency === was.frequency && interval === was.interval && day === was.day
        ? {}
        : { frequency, interval, day };
    return done(call(plans.updatePlan, { params: { accountId, planId }, body: { ...body, ...cadence } }));
  });
}

/** Pauses a plan, starts it again or ends it. */
export function setPlanState(accountId: string, planId: string, state: PlanState): Promise<ActionResult> {
  return planWrite(() => done(call(plans.updatePlan, { params: { accountId, planId }, body: { state } })));
}

/** An instalment of a plan, as its route names it. */
interface RunRef {
  accountId: string;
  planId: string;
  runId: string;
}

/** A line of «Review the proposal» as typed: a price, shares (empty: the server's proposal) and a fee. */
export interface LineTyped {
  assetId: string;
  unitPrice: string;
  quantity: string;
  fee: string;
}

export type RunPreview = RouteOutput<typeof plans.previewPlanRun>;

/**
 * The proposal with the corrections typed, as the server computes it (§2.4): a price typed proposes
 * the shares again, shares typed win. Nothing is written, so nothing goes stale.
 */
export async function previewRun(
  ref: RunRef,
  lines: readonly LineTyped[],
): Promise<({ ok: true } & RunPreview) | Failure> {
  try {
    const format = await formatOf();
    const body = {
      lines: lines.flatMap((line) => {
        const unitPrice = decimalOf(line.unitPrice, format);
        const quantity = decimalOf(line.quantity, format);
        if (unitPrice === null && quantity === null) return [];
        return [
          {
            assetId: line.assetId,
            ...(unitPrice === null ? {} : { unitPrice }),
            ...(quantity === null ? {} : { quantity }),
          },
        ];
      }),
    };
    return { ok: true, ...(await call(plans.previewPlanRun, { params: ref, body })) };
  } catch (error) {
    return failure(error);
  }
}

/**
 * Confirms an execution (§4.3): every line, its shares and its real price, or 0 shares and no price;
 * all purchases or none.
 */
export function confirmRun(
  ref: RunRef,
  day: string,
  lines: readonly (LineTyped & { quantity: string })[],
): Promise<ActionResult> {
  return planWrite(async () => {
    const format = await formatOf();
    const body = {
      ...(day === "" ? {} : { on: day }),
      lines: lines.map((line) => {
        const fee = amountOf(line.fee, format);
        // A line with no price goes with none; the server refuses it with shares (`invalid`).
        const unitPrice = decimalOf(line.unitPrice, format);
        return {
          assetId: line.assetId,
          quantity: required(decimalOf(line.quantity, format)),
          ...(unitPrice === null ? {} : { unitPrice }),
          ...(fee === null ? {} : { fee }),
        };
      }),
    };
    return call(plans.confirmPlanRun, { params: ref, body });
  });
}

export function skipRun(ref: RunRef): Promise<ActionResult> {
  return planWrite(() => done(call(plans.skipPlanRun, { params: ref })));
}

/** Links a recorded execution to the bank movement the server proposed (E7). */
export function linkRunDebit(ref: RunRef): Promise<ActionResult> {
  return planWrite(() => done(call(plans.linkPlanRunDebit, { params: ref })));
}
