// The writes of the purchase plans of a manual portfolio to `/api/v1` (rewrite plan R5d, step 2;
// 11-standardization.md §11.3). What a person typed is read here, in their number format, and goes on
// the wire as the contract's decimals; a fee's rate is a percentage, typed and sent as such. Nothing
// is computed: the server proposes each instalment and writes it.
import { plans } from "@ledgerly/api-contract/investments";
import type { NumberFormat } from "@ledgerly/format/format";
import { call } from "@ledgerly/api-client";
import { invalidate } from "@ledgerly/ui/data";
import { type ActionResult, amountOf, attempt, decimalOf, done, type Failure, formatOf } from "./calls";

type PlanFrequency = (typeof plans.PLAN_FREQUENCIES)[number];
type PlanMode = (typeof plans.PLAN_MODES)[number];
type PlanState = (typeof plans.PLAN_STATES)[number];

/** A plan's fee: none, an amount per instalment, or a percentage of it (E3). */
export interface PlanFee {
  kind: "none" | "amount" | "rate";
  value: string;
}

/** What a plan's form edits: what the server lets a plan change after it is made. */
export interface PlanEdit {
  name: string;
  mode: PlanMode;
  /** The plan ends never, on a day, or after a number of instalments. */
  end: "never" | "date" | "count";
  endOn: string;
  runsLimit: string;
  debitAccountId: string;
  fee: PlanFee;
}

/** A new plan: its instrument, its size and its schedule beside what a plan can change. */
export interface PlanForm extends PlanEdit {
  instrumentId: string;
  mic: string | null;
  size: "amount" | "quantity";
  amount: string;
  quantity: string;
  fractions: boolean;
  frequency: PlanFrequency;
  interval: string;
  day: string;
  startOn: string;
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

function editBody(form: PlanEdit, format: NumberFormat) {
  return {
    name: form.name,
    mode: form.mode,
    endOn: form.end === "date" ? form.endOn || null : null,
    runsLimit: form.end === "count" ? wholeOf(form.runsLimit) : null,
    debitAccountId: form.debitAccountId || null,
    fee: feeOf(form.fee, format),
  };
}

/** A write of the plans: on success the plans' reads and the portfolio's are stale. */
async function planWrite<T extends object>(work: () => Promise<T>): Promise<({ ok: true } & T) | Failure> {
  const result = await attempt(work);
  if (result.ok) invalidate(plans.listPlans, plans.listPlanRuns, plans.listPastRuns);
  return result;
}

export function createPlan(accountId: string, form: PlanForm): Promise<ActionResult> {
  return planWrite(async () => {
    const format = await formatOf();
    const byAmount = form.size === "amount";
    const body = {
      ...editBody(form, format),
      instrumentId: form.instrumentId,
      mic: form.mic,
      amount: byAmount ? required(amountOf(form.amount, format)) : null,
      quantity: byAmount ? null : required(decimalOf(form.quantity, format)),
      fractions: form.fractions,
      frequency: form.frequency,
      interval: wholeOf(form.interval),
      day: wholeOf(form.day),
      startOn: form.startOn,
    };
    return call(plans.createPlan, { params: { accountId }, body });
  });
}

export function updatePlan(accountId: string, planId: string, form: PlanEdit): Promise<ActionResult> {
  return planWrite(async () => {
    const body = editBody(form, await formatOf());
    return done(call(plans.updatePlan, { params: { accountId, planId }, body }));
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

/** The proposal as the person left it: each field typed is a correction (§11.3.2). */
export interface RunConfirmation {
  on: string;
  quantity: string;
  unitPrice: string;
  fee: string;
}

export function confirmRun(ref: RunRef, form: RunConfirmation): Promise<ActionResult> {
  return planWrite(async () => {
    const format = await formatOf();
    const quantity = decimalOf(form.quantity, format);
    const unitPrice = decimalOf(form.unitPrice, format);
    const fee = amountOf(form.fee, format);
    // An empty field is no correction: the server keeps its proposal.
    const body = {
      ...(form.on === "" ? {} : { on: form.on }),
      ...(quantity === null ? {} : { quantity }),
      ...(unitPrice === null ? {} : { unitPrice }),
      ...(fee === null ? {} : { fee }),
    };
    return done(call(plans.confirmPlanRun, { params: ref, body }));
  });
}

export function skipRun(ref: RunRef): Promise<ActionResult> {
  return planWrite(() => done(call(plans.skipPlanRun, { params: ref })));
}

/** Links a recorded instalment to the bank movement the server proposed (E7). */
export function linkRunDebit(ref: RunRef): Promise<ActionResult> {
  return planWrite(() => done(call(plans.linkPlanRunDebit, { params: ref })));
}

/** A row of «Record the past instalments», as typed. */
export interface BackfillRow {
  dueOn: string;
  on: string;
  quantity: string;
  unitPrice: string;
  fee: string;
}

/** «Record the past instalments» (P4): every row or none. */
export function backfillPlan(
  accountId: string,
  planId: string,
  rows: readonly BackfillRow[],
): Promise<ActionResult> {
  return planWrite(async () => {
    const format = await formatOf();
    const runs = rows.map((row) => ({
      dueOn: row.dueOn,
      on: row.on || row.dueOn,
      quantity: required(decimalOf(row.quantity, format)),
      unitPrice: required(decimalOf(row.unitPrice, format)),
      fee: amountOf(row.fee, format),
    }));
    return done(call(plans.backfillPlan, { params: { accountId, planId }, body: { runs } }));
  });
}
