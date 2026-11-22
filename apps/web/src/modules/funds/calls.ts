// The writes of Funds to `/api/v1` (rewrite plan R3): each keeps the name and the answer of the Server
// Action it replaces. What a person typed is read here, in their number format, and goes on the wire
// as the contract's decimal strings; a fee's rate goes as the percentage they wrote. A refusal keeps
// its words: the route's reason (`duplicate_name`, `component_taken`…) or its code, and `detail` is
// the other fund's name that `other` carries.
import { COMPONENTS, funds, register, setup } from "@ledgerly/api-contract/funds";
import { accounts as accountRoutes } from "@ledgerly/api-contract/accounts";
import { profile } from "@ledgerly/api-contract/settings";
import { ApiError, call, type RouteOutput } from "@ledgerly/api-client";
import { centsToDecimal, parseCents } from "@ledgerly/format/cents";
import { type NumberFormat, numberSeparators, numberStyle, parseAmount } from "@ledgerly/format/format";
import { invalidate, read } from "@ledgerly/ui/data";
import { feeModes, needsPeriod } from "@ledgerly/domain/shared/fees";
import {
  type ContributionForm,
  type FeeForm,
  type FundForm,
  parseScope,
  type SourceForm,
  type WizardForm,
} from "@ledgerly/domain/funds/client";
import { refusal } from "@/platform/writes";

export type ActionResult =
  | { ok: true; id?: string; count?: number; accountId?: string }
  /** `detail` says more about some errors: the fund that holds a payslip component already. */
  | { ok: false; error: string; detail?: string | null };

type Failure = Extract<ActionResult, { ok: false }>;

/** What `DELETE /funds/{id}/sources/{sourceId}` answered: «Undo» sends it back as it is. */
type RemovedSource = RouteOutput<typeof setup.removeSource>;

function failed(error: unknown): Failure {
  // A field the client cannot read: `invalid`, as the Server Action answered.
  if (error instanceof RangeError) return { ok: false, error: "invalid" };
  const answer = refusal(error);
  return error instanceof ApiError && error.other !== null ? { ...answer, detail: error.other } : answer;
}

/**
 * What a write of Funds made stale, read again: every read of the section, and the accounts that hold
 * a fund's value. It replaces the `revalidatePath` of the Server Actions.
 */
export function fundsChanged(): void {
  invalidate(
    funds.getFunds,
    funds.getFund,
    funds.getFundValuations,
    funds.getFundContributions,
    funds.getFundSettings,
    funds.getFundMovementCandidates,
    funds.getFundSetup,
    accountRoutes.listAccounts,
  );
}

async function write<T extends object>(work: () => Promise<T | void>): Promise<ActionResult> {
  try {
    const answer = { ok: true as const, ...(await work()) };
    fundsChanged();
    return answer;
  } catch (error) {
    return failed(error);
  }
}

/** The person's number format, as the forms are typed in. */
async function formatOf(): Promise<NumberFormat> {
  return numberStyle(await read(profile.getPreferences, {}));
}

/** An amount as typed, as the contract's decimal; empty is zero where the form says so. */
function decimal(text: string, format: NumberFormat, emptyIsZero = false): string {
  if (emptyIsZero && text.trim() === "") return "0.00";
  return centsToDecimal(parseAmount(text, format));
}

function whole(text: string): number {
  if (!/^\d{1,3}$/.test(text.trim())) throw new RangeError(`Not a whole number: "${text}"`);
  return Number(text.trim());
}

/** A percentage as typed ("0,45"), as the contract takes it ("0.45"): above 0 and up to 100. */
function percent(text: string, format: NumberFormat): string {
  const { decimal: point, group } = numberSeparators(format);
  const plain = text
    .replace(/[\s %]/g, "")
    .replaceAll(group, "")
    .replace(point, ".");
  if (!/^\d{1,3}(\.\d{1,4})?$/.test(plain) || Number(plain) <= 0 || Number(plain) > 100) {
    throw new RangeError(`Not a percentage: "${text}"`);
  }
  return plain;
}

const fundBody = (form: FundForm) => ({
  name: form.name,
  provider: form.provider,
  compartment: form.compartment,
  startOn: form.startOn,
  code: form.code,
});

function sourceBody(form: SourceForm, format: NumberFormat) {
  if (form.kind === "manual") return { kind: "manual" as const };
  if (form.kind === "payroll") {
    return {
      kind: "payroll" as const,
      components: form.components,
      accrualPeriod: form.accrualPeriod,
      employer: form.employer,
      due: form.hasDue ? { day: whole(form.dueDay), offsetMonths: whole(form.dueOffsetMonths) } : null,
      toleranceDays: form.toleranceDays.trim() === "" ? 15 : whole(form.toleranceDays),
      note: form.note,
      keepDueEntries: form.customDue && !form.hasDue,
    };
  }
  return {
    kind: "bank_debit" as const,
    amount: decimal(form.amount, format),
    frequency: { count: whole(form.frequencyCount), unit: form.frequencyUnit },
    debitDay: form.debitDay.trim() === "" ? null : whole(form.debitDay),
    accountId: form.accountId || null,
    payeeMatch: form.payeeMatch,
    validFrom: form.validFrom || null,
    validTo: form.validTo || null,
  };
}

/** A fee's fields, the source left as the key the form holds (an id, or `#<index>` in a new fund). */
function feeFields(form: FeeForm, format: NumberFormat) {
  const modes = feeModes(form.basis);
  const mode = modes.includes(form.mode) ? form.mode : modes[0];
  const { key, component } =
    form.basis === "on_assets" ? { key: null, component: null } : parseScope(form.scope);
  return {
    key,
    fee: {
      label: form.label,
      basis: form.basis,
      amount: mode === "amount" ? decimal(form.value, format) : null,
      rate: mode === "rate" ? percent(form.value, format) : null,
      period: needsPeriod(form.basis) ? form.period : null,
      component,
      validFrom: form.validFrom || null,
      validTo: form.validTo || null,
      note: form.note,
    },
  };
}

// ——— The fund ————————————————————————————————————————————————————————————————————————————————

/** «Create fund», the last step of the form. `count`: the payslip periods the fund received. */
export function createFundAction(form: WizardForm): Promise<ActionResult> {
  return write(async () => {
    const format = await formatOf();
    const answer = await call(funds.createFund, {
      body: {
        fund: fundBody(form.fund),
        currency: form.currency || null,
        value: form.value.trim() === "" ? null : { on: form.valueOn, value: decimal(form.value, format) },
        sources: form.sources.map((source) => sourceBody(source, format)),
        fees: form.fees.map((one) => {
          const { key, fee } = feeFields(one, format);
          // In this form a fee names a source by its place in the list: `#0`, `#1`.
          return { ...fee, source: key === null ? null : Number(key.slice(1)) };
        }),
      },
    });
    // The fund's page is its account's in Investments (R5b, B1b): the new fund's account is read back.
    const { fund } = await call(funds.getFundSettings, { params: { id: answer.id } });
    return { id: answer.id, count: answer.published, accountId: fund.accountId };
  });
}

export function updateFundAction(id: string, form: FundForm): Promise<ActionResult> {
  return write(() => call(funds.updateFund, { params: { id }, body: fundBody(form) }).then(() => ({ id })));
}

export function setFundStateAction(id: string, state: "active" | "archived"): Promise<ActionResult> {
  return write(() => call(funds.setFundState, { params: { id }, body: { state } }).then(() => ({ id })));
}

// ——— Valuations —————————————————————————————————————————————————————————————————————————————

export interface ValuationFormInput {
  on: string;
  value: string;
  note: string;
}

async function valuationBody(input: ValuationFormInput) {
  return { on: input.on, value: decimal(input.value, await formatOf()), note: input.note };
}

export function recordValuationAction(fundId: string, input: ValuationFormInput): Promise<ActionResult> {
  return write(async () => {
    await call(register.recordValuation, { params: { id: fundId }, body: await valuationBody(input) });
    return { id: fundId };
  });
}

/** «Edit» on a valuation row: a new day moves the value, it never leaves a second one behind. */
export function updateValuationAction(
  fundId: string,
  valuationId: string,
  input: ValuationFormInput,
): Promise<ActionResult> {
  return write(async () => {
    const body = await valuationBody(input);
    await call(register.updateValuation, { params: { id: fundId, valuationId }, body });
    return { id: fundId };
  });
}

export function deleteValuationAction(fundId: string, valuationId: string): Promise<ActionResult> {
  return write(() =>
    call(register.deleteValuation, { params: { id: fundId, valuationId } }).then(() => ({ id: fundId })),
  );
}

// ——— Contributions and the other operations ————————————————————————————————————————————————————

/** The period of a form, `<year>-<index>`, as the contract's competence; `""` is none. */
function competenceOf(period: string): { year: number; index: number } | null {
  if (period === "") return null;
  const [year, index] = period.split("-").map(Number);
  return { year, index };
}

function operationBody(form: ContributionForm, format: NumberFormat) {
  const fee = form.feeUnknown ? null : decimal(form.fee, format, true);
  if (form.kind === "voluntary") {
    return {
      kind: "voluntary" as const,
      on: form.on,
      amount: decimal(form.amount, format),
      fee,
      transactionId: form.transactionId || null,
      note: form.note,
    };
  }
  if (form.kind === "payroll") {
    return {
      kind: "payroll" as const,
      on: form.on,
      worker: decimal(form.worker, format, true),
      employer: decimal(form.employer, format, true),
      tfr: decimal(form.tfr, format, true),
      competence: competenceOf(form.period),
      fee,
      note: form.note,
    };
  }
  return {
    kind: "other" as const,
    classification: form.classification,
    on: form.on,
    amount: decimal(form.amount, format, true),
    competence: form.classification === "enrollment" ? competenceOf(form.period) : null,
    fee,
    note: form.note,
  };
}

/** «Record contribution» and its edit: one form for every operation a person writes. */
export function saveContributionAction(fundId: string, form: ContributionForm): Promise<ActionResult> {
  return write(async () => {
    const body = operationBody(form, await formatOf());
    if (form.id === null) await call(register.addOperation, { params: { id: fundId }, body });
    else await call(register.updateOperation, { params: { id: fundId, operationId: form.id }, body });
    return { id: fundId };
  });
}

export function deleteContributionAction(fundId: string, operationId: string): Promise<ActionResult> {
  return write(() =>
    call(register.deleteOperation, { params: { id: fundId, operationId } }).then(() => ({ id: fundId })),
  );
}

// ——— Sources ——————————————————————————————————————————————————————————————————————————————————

/** «Add source» and its edit. A payslip source publishes the applied payslips: `count` of them. */
export function saveSourceAction(fundId: string, form: SourceForm): Promise<ActionResult> {
  return write(async () => {
    const body = sourceBody(form, await formatOf());
    const answer =
      form.id === null
        ? await call(setup.addSource, { params: { id: fundId }, body })
        : await call(setup.updateSource, { params: { id: fundId, sourceId: form.id }, body });
    return { id: fundId, count: answer.published };
  });
}

export function setSourceStateAction(
  fundId: string,
  sourceId: string,
  state: "active" | "paused",
): Promise<ActionResult> {
  return write(() =>
    call(setup.setSourceState, { params: { id: fundId, sourceId }, body: { state } }).then(() => ({
      id: fundId,
    })),
  );
}

/** Removes a source with no contribution. The answer is what «Undo» sends back. */
export async function removeSourceAction(
  fundId: string,
  sourceId: string,
): Promise<{ ok: true; removed: RemovedSource } | Failure> {
  try {
    const removed = await call(setup.removeSource, { params: { id: fundId, sourceId } });
    fundsChanged();
    return { ok: true, removed };
  } catch (error) {
    return failed(error);
  }
}

/** «Undo» of a removal: the source comes back with the id it had, and so do its own fees. */
export function restoreSourceAction(fundId: string, removed: RemovedSource): Promise<ActionResult> {
  return write(() =>
    call(setup.restoreSource, { params: { id: fundId }, body: removed }).then(() => ({ id: fundId })),
  );
}

/** Settings › «Rebuild from payslips»: `count` periods published. */
export function rebuildCompetencesAction(fundId: string): Promise<ActionResult> {
  return write(async () => ({
    count: (await call(setup.rebuildCompetences, { params: { id: fundId } })).published,
  }));
}

// ——— Fees ———————————————————————————————————————————————————————————————————————————————————

/** «Add fee», its edit, and the «Undo» of a removal (`keepId`: the fee comes back as it was). */
export function saveFeeAction(
  fundId: string,
  form: FeeForm,
  options: { keepId?: boolean } = {},
): Promise<ActionResult> {
  return write(async () => {
    const { key, fee } = feeFields(form, await formatOf());
    const body = { ...fee, sourceId: key };
    if (form.id === null) await call(setup.addFee, { params: { id: fundId }, body });
    else if (options.keepId)
      await call(setup.addFee, { params: { id: fundId }, body: { ...body, id: form.id } });
    else await call(setup.updateFee, { params: { id: fundId, feeId: form.id }, body });
    return { id: fundId };
  });
}

export function removeFeeAction(fundId: string, feeId: string): Promise<ActionResult> {
  return write(() => call(setup.removeFee, { params: { id: fundId, feeId } }).then(() => ({ id: fundId })));
}

// ——— «Find this charge everywhere» ——————————————————————————————————————————————————————————

/** What the app would match on, and what it already finds, before anything is saved. Read-only. */
export async function proposeDebitMatchAction(fundId: string, transactionId: string, accountId: string) {
  try {
    const { found } = await call(setup.debitMatch, {
      params: { id: fundId },
      query: { transactionId, accountId: accountId || undefined },
    });
    if (found === null) return { ok: true as const, found: null };
    const { median, ...rest } = found;
    // The dialog formats cents; the wire's decimal is read, not computed.
    const medianCents = median === null ? null : parseCents(median).toString();
    return { ok: true as const, found: { ...rest, medianCents } };
  } catch (error) {
    return failed(error);
  }
}

// ——— The reviewer's word on a difference —————————————————————————————————————————————————————

/** What the page sends: the period and the component, with the note. The numbers are the server's. */
interface DecisionFormInput {
  year: number;
  quarter: number;
  component: string;
  note: string;
}

function decisionParams(fundId: string, year: number, index: number, component: string) {
  const known = COMPONENTS.find((one) => one === component);
  if (known === undefined) throw new RangeError(`Not a component: "${component}"`);
  return { id: fundId, year, index, component: known };
}

export function decideDifferenceAction(fundId: string, input: DecisionFormInput): Promise<ActionResult> {
  return write(() =>
    call(register.decideDifference, {
      params: decisionParams(fundId, input.year, input.quarter, input.component),
      body: { note: input.note },
    }).then(() => ({ id: fundId })),
  );
}

export function clearDecisionAction(
  fundId: string,
  year: number,
  quarter: number,
  component: string,
): Promise<ActionResult> {
  return write(() =>
    call(register.clearDecision, { params: decisionParams(fundId, year, quarter, component) }).then(() => ({
      id: fundId,
    })),
  );
}
