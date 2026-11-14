import "server-only";
import { randomUUID } from "node:crypto";
import { and, asc, eq, inArray, isNull, or } from "drizzle-orm";
import { z } from "zod";
import { getAccount } from "@/modules/accounts/queries";
import { isFutureDate } from "@/modules/accounts/rules";
import {
  createAccount,
  deleteBalanceEntry,
  removeAccount,
  saveBalanceEntry,
} from "@/modules/accounts/service";
import { chargeCandidates, getTransaction } from "@/modules/transactions/queries";
import { payeeKeyOf } from "@/modules/transactions/rules";
import type { Ctx } from "@/platform/context";
import { type CivilDate, daysBetween, isCivilDate, today } from "@/platform/dates";
import { getDb } from "@/platform/db/client";
import { hasPgError, UNIQUE_VIOLATION } from "@/platform/db/errors";
import { userScoped } from "@/platform/db/scope";
import { isDisplayCurrency } from "@/platform/fx/rules";
import type { Cents } from "@/platform/money";
import { carriesKey, type Detection, recurrenceKeyOf, summarise } from "./detect";
import { contributionFee, FEE_BASES, FEE_PERIODS, feeModes, needsPeriod } from "./fees";
import { type ManualClass, MANUAL_CLASSES } from "./pension/rules";
import { fundContributionSources, fundFees, fundOperations, funds, fundValuations } from "./schema";
import {
  type AccrualPeriod,
  ACCRUAL_PERIODS,
  INTERVAL_UNITS,
  parseDueEntries,
  PAYROLL_COMPONENTS,
  type PayrollComponent,
  periodsPerYear,
  type SourceState,
} from "./sources";

export type Fund = typeof funds.$inferSelect;
export type FundSource = typeof fundContributionSources.$inferSelect;
export type FundFee = typeof fundFees.$inferSelect;
export type FundOperation = typeof fundOperations.$inferSelect;
export type FundValuation = typeof fundValuations.$inferSelect;

export type FundErrorCode =
  | "not_found"
  | "invalid"
  | "invalid_account"
  | "duplicate_name"
  | "archived"
  | "linked"
  | "future_date"
  | "movement_taken"
  /** A component of the payslip already goes to another fund; `detail` is that fund's name. */
  | "component_taken"
  /** The fund already has an active payslip source: one at a time. */
  | "payroll_active"
  /** A source with contributions is paused, never removed. */
  | "has_contributions"
  | "before_start";

export class FundError extends Error {
  constructor(
    readonly code: FundErrorCode,
    readonly detail: string | null = null,
  ) {
    super(code);
    this.name = "FundError";
  }
}

// ——— Inputs ——————————————————————————————————————————————————————————————————————————————————

const civilDate = z.string().refine(isCivilDate, "Not a civil date");
const optionalDate = z
  .string()
  .nullable()
  .default(null)
  .transform((value) => (value === "" ? null : value))
  .refine((value) => value === null || isCivilDate(value), "Not a civil date");
const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .transform((value) => (value === "" ? null : value))
    .nullable()
    .default(null);

export const fundInputSchema = z.object({
  name: z.string().trim().min(1).max(80),
  provider: optionalText(80),
  compartment: optionalText(80),
  startOn: civilDate,
  code: optionalText(40),
});
export type FundInput = z.input<typeof fundInputSchema>;

const payrollSourceSchema = z.object({
  kind: z.literal("payroll"),
  components: z
    .array(z.enum(PAYROLL_COMPONENTS))
    .min(1)
    .max(3)
    .refine((list) => new Set(list).size === list.length, "Twice the same component"),
  accrualPeriod: z.enum(ACCRUAL_PERIODS),
  employer: optionalText(120),
  /** The due date of each period's transfer; `null` for a source with no due dates. */
  due: z
    .object({ day: z.number().int().min(1).max(31), offsetMonths: z.number().int().min(0).max(3) })
    .nullable()
    .default(null),
  toleranceDays: z.number().int().min(0).max(120).default(15),
  note: optionalText(300),
  /** Keeps the explicit due dates a source already has; a rule in `due` replaces them. */
  keepDueEntries: z.boolean().default(false),
});

const bankDebitSourceSchema = z.object({
  kind: z.literal("bank_debit"),
  amountCents: z.bigint().positive(),
  frequency: z.object({ count: z.number().int().min(1).max(120), unit: z.enum(INTERVAL_UNITS) }),
  debitDay: z.number().int().min(1).max(31).nullable().default(null),
  accountId: z.uuid().nullable().default(null),
  payeeMatch: z.string().trim().min(1).max(80),
  validFrom: optionalDate,
  validTo: optionalDate,
});

const manualSourceSchema = z.object({ kind: z.literal("manual") });

export const sourceInputSchema = z.discriminatedUnion("kind", [
  payrollSourceSchema,
  bankDebitSourceSchema,
  manualSourceSchema,
]);
export type SourceInput = z.input<typeof sourceInputSchema>;
type ParsedSource = z.output<typeof sourceInputSchema>;

export const feeInputSchema = z
  .object({
    label: z.string().trim().min(1).max(80),
    basis: z.enum(FEE_BASES),
    amountCents: z.bigint().positive().nullable().default(null),
    /** A fraction as text: "0.0045" is 0,45 %. */
    rate: z
      .string()
      .regex(/^(0(\.\d{1,6})?|1(\.0{1,6})?)$/)
      .nullable()
      .default(null),
    period: z.enum(FEE_PERIODS).nullable().default(null),
    sourceId: z.uuid().nullable().default(null),
    component: z.enum(PAYROLL_COMPONENTS).nullable().default(null),
    validFrom: optionalDate,
    validTo: optionalDate,
    note: optionalText(300),
  })
  .superRefine((fee, context) => {
    const mode = fee.amountCents !== null ? "amount" : "rate";
    const fail = (message: string) => context.addIssue({ code: "custom", message });
    if ((fee.amountCents === null) === (fee.rate === null)) fail("An amount or a rate, not both");
    else if (!feeModes(fee.basis).includes(mode)) fail("This basis does not take this value");
    if (fee.rate !== null && Number(fee.rate) <= 0) fail("A rate above zero");
    if (needsPeriod(fee.basis) !== (fee.period !== null)) fail("A period for this basis only");
    if (fee.validFrom !== null && fee.validTo !== null && fee.validTo < fee.validFrom) fail("Validity");
  });
export type FeeInput = z.input<typeof feeInputSchema>;
type ParsedFee = z.output<typeof feeInputSchema>;

/** A new fund, as the four steps of the form hand it over: nothing is written before this. */
export interface NewFundInput {
  fund: FundInput;
  /** The currency of the account that holds the value; the display currency when left out. */
  currency?: string | null;
  /** Today's value, with its day; `null` for a fund with no value yet. */
  value?: { on: string; cents: Cents } | null;
  sources: SourceInput[];
  /** `sourceIndex` names a source of this same input, before it has an id. */
  fees: (Omit<FeeInput, "sourceId"> & { sourceIndex?: number | null })[];
}

// ——— Reads the writes need ————————————————————————————————————————————————————————————————————

export async function requireFund(ctx: Pick<Ctx, "userId">, id: string): Promise<Fund> {
  const [row] = await getDb()
    .select()
    .from(funds)
    .where(and(eq(funds.id, id), userScoped(ctx).owns(funds)));
  if (!row) throw new FundError("not_found");
  return row;
}

async function requireOpenFund(ctx: Pick<Ctx, "userId">, id: string): Promise<Fund> {
  const fund = await requireFund(ctx, id);
  if (fund.state === "archived") throw new FundError("archived");
  return fund;
}

/** An account a source points at: this user's own, open. */
async function requireAccount(ctx: Pick<Ctx, "userId">, id: string | null) {
  if (id === null) return null;
  const account = await getAccount(ctx, id);
  if (!account || account.state === "archived") throw new FundError("invalid_account");
  return account;
}

function duplicateName<T>(write: Promise<T>): Promise<T> {
  return write.catch((error: unknown) => {
    if (hasPgError(error, UNIQUE_VIOLATION, "funds_user_name_uq")) throw new FundError("duplicate_name");
    throw error;
  });
}

export async function sourcesOf(ctx: Pick<Ctx, "userId">, fundIds: readonly string[]): Promise<FundSource[]> {
  if (fundIds.length === 0) return [];
  return getDb()
    .select()
    .from(fundContributionSources)
    .where(
      and(
        userScoped(ctx).owns(fundContributionSources),
        inArray(fundContributionSources.fundId, [...fundIds]),
      ),
    )
    .orderBy(asc(fundContributionSources.createdAt), asc(fundContributionSources.id));
}

export async function feesOf(ctx: Pick<Ctx, "userId">, fundIds: readonly string[]): Promise<FundFee[]> {
  if (fundIds.length === 0) return [];
  return getDb()
    .select()
    .from(fundFees)
    .where(and(userScoped(ctx).owns(fundFees), inArray(fundFees.fundId, [...fundIds])))
    .orderBy(asc(fundFees.createdAt), asc(fundFees.id));
}

async function requireSource(ctx: Pick<Ctx, "userId">, id: string): Promise<FundSource> {
  const [row] = await getDb()
    .select()
    .from(fundContributionSources)
    .where(and(eq(fundContributionSources.id, id), userScoped(ctx).owns(fundContributionSources)));
  if (!row) throw new FundError("not_found");
  return row;
}

/**
 * The components of the payslip another fund already takes, with that fund's name: a line of a
 * payslip goes to one fund only. A paused source and an archived fund take none.
 *
 * A payslip's competence is one row (until the `PayslipApplied` event of release R2 hands each
 * component to its own fund), so the fund the payslip feeds takes the whole payslip: while one
 * does, every component is taken.
 */
export async function takenComponents(
  ctx: Pick<Ctx, "userId">,
  except: { sourceId?: string; fundId?: string } = {},
): Promise<Map<PayrollComponent, string>> {
  const rows = await getDb()
    .select({ id: fundContributionSources.id, fundId: funds.id, fund: funds.name })
    .from(fundContributionSources)
    .innerJoin(funds, eq(funds.id, fundContributionSources.fundId))
    .where(
      and(
        userScoped(ctx).owns(fundContributionSources),
        eq(fundContributionSources.kind, "payroll"),
        eq(fundContributionSources.state, "active"),
        eq(funds.state, "active"),
      ),
    )
    .orderBy(asc(fundContributionSources.createdAt), asc(fundContributionSources.id));
  const holder = rows.find((row) => row.id !== except.sourceId && row.fundId !== except.fundId);
  return new Map(holder ? PAYROLL_COMPONENTS.map((component) => [component, holder.fund]) : []);
}

async function requireFreeComponents(
  ctx: Pick<Ctx, "userId">,
  sources: readonly ParsedSource[],
  except: { sourceId?: string; fundId?: string } = {},
): Promise<void> {
  const wanted = sources.flatMap((source) => (source.kind === "payroll" ? source.components : []));
  if (wanted.length === 0) return;
  const taken = await takenComponents(ctx, except);
  for (const component of wanted) {
    const holder = taken.get(component);
    if (holder !== undefined) throw new FundError("component_taken", holder);
  }
}

/** The columns of a source, from its input: the ones its kind does not use are `null`. */
function sourceValues(source: ParsedSource, current: FundSource | null = null) {
  const none = {
    components: null,
    accrualPeriod: null,
    employer: null,
    dueDay: null,
    dueOffsetMonths: null,
    dueEntries: null,
    toleranceDays: null,
    accountId: null,
    payeeMatch: null,
    amountCents: null,
    debitDay: null,
    intervalCount: null,
    intervalUnit: null,
    validFrom: null,
    validTo: null,
    note: null,
  };
  if (source.kind === "payroll") {
    // Explicit dates are of one period kind: a source that changes its period loses them.
    const keeps =
      source.keepDueEntries &&
      source.due === null &&
      current !== null &&
      current.accrualPeriod === source.accrualPeriod;
    return {
      ...none,
      kind: source.kind,
      components: [...source.components].sort(
        (a, b) => PAYROLL_COMPONENTS.indexOf(a) - PAYROLL_COMPONENTS.indexOf(b),
      ),
      accrualPeriod: source.accrualPeriod,
      employer: source.employer,
      dueDay: source.due?.day ?? null,
      dueOffsetMonths: source.due?.offsetMonths ?? null,
      dueEntries: keeps ? current.dueEntries : null,
      toleranceDays: source.toleranceDays,
      note: source.note,
    };
  }
  if (source.kind === "bank_debit") {
    if (source.validFrom !== null && source.validTo !== null && source.validTo < source.validFrom) {
      throw new FundError("invalid");
    }
    return {
      ...none,
      kind: source.kind,
      accountId: source.accountId,
      payeeMatch: source.payeeMatch,
      amountCents: source.amountCents,
      debitDay: source.debitDay,
      intervalCount: source.frequency.count,
      intervalUnit: source.frequency.unit,
      validFrom: source.validFrom,
      validTo: source.validTo,
    };
  }
  return { ...none, kind: source.kind };
}

/** A fee may name a source of its own fund only, and a component only of a payslip source. */
function requireFeeScope(fee: ParsedFee, sources: readonly Pick<FundSource, "id" | "kind">[]): void {
  const source = fee.sourceId === null ? null : sources.find((one) => one.id === fee.sourceId);
  if (fee.sourceId !== null && !source) throw new FundError("not_found");
  if (fee.component !== null && source?.kind !== "payroll") throw new FundError("invalid");
  if (fee.basis === "on_assets" && (fee.sourceId !== null || fee.component !== null)) {
    throw new FundError("invalid");
  }
}

// ——— The fund ————————————————————————————————————————————————————————————————————————————————

/**
 * A new pension fund, with where its money comes from and what it costs. Its value lives on a new
 * `pension` account named after it — in net worth, never cash —, in the currency asked for. Nothing
 * is taken from another fund: a fund with no source and no fee is a fund whose contributions and
 * values are written by hand.
 *
 * The account and the fund are two writes of two modules. A fund that cannot be written takes its
 * account back with it.
 */
export async function createFund(ctx: Ctx, input: NewFundInput): Promise<Fund> {
  const parsed = fundInputSchema.parse(input.fund);
  const todayOn = today(ctx.timeZone);
  if (isFutureDate(parsed.startOn, todayOn)) throw new FundError("future_date");
  const currency = input.currency ?? ctx.displayCurrency;
  if (!isDisplayCurrency(currency)) throw new FundError("invalid");
  const value = input.value ?? null;
  if (value !== null) {
    if (!isCivilDate(value.on) || value.cents < 0n) throw new FundError("invalid");
    if (isFutureDate(value.on, todayOn)) throw new FundError("future_date");
    if (value.on < parsed.startOn) throw new FundError("before_start");
  }
  const sources = input.sources.map((source) => sourceInputSchema.parse(source));
  if (sources.filter((source) => source.kind === "manual").length > 1) throw new FundError("invalid");
  if (sources.filter((source) => source.kind === "payroll").length > 1) throw new FundError("invalid");
  await requireFreeComponents(ctx, sources);
  for (const source of sources) {
    if (source.kind === "bank_debit") await requireAccount(ctx, source.accountId);
  }
  const fees = input.fees.map(({ sourceIndex, ...fee }) => ({
    sourceIndex: sourceIndex ?? null,
    fee: feeInputSchema.parse({ ...fee, sourceId: null }),
  }));
  for (const { sourceIndex, fee } of fees) {
    const source = sourceIndex === null ? null : sources[sourceIndex];
    if (sourceIndex !== null && !source) throw new FundError("invalid");
    if (fee.component !== null && source?.kind !== "payroll") throw new FundError("invalid");
    if (fee.basis === "on_assets" && source) throw new FundError("invalid");
  }
  const [taken] = await getDb()
    .select({ id: funds.id })
    .from(funds)
    .where(and(userScoped(ctx).owns(funds), eq(funds.name, parsed.name)));
  if (taken) throw new FundError("duplicate_name");

  const account = await createAccount(ctx, {
    name: parsed.name,
    type: "pension",
    currency,
    color: null,
    reference: "",
    purpose: "",
    openedOn: parsed.startOn,
    notes: "",
    openingBalance: null,
  });
  let fund: Fund;
  try {
    fund = await getDb().transaction(async (tx) => {
      const [row] = await duplicateName(
        tx
          .insert(funds)
          .values(userScoped(ctx).stamp({ ...parsed, valuationAccountId: account.id }))
          .returning(),
      );
      const ids: string[] = [];
      for (const source of sources) {
        const [written] = await tx
          .insert(fundContributionSources)
          .values(userScoped(ctx).stamp({ fundId: row.id, ...sourceValues(source) }))
          .returning({ id: fundContributionSources.id });
        ids.push(written.id);
      }
      if (fees.length > 0) {
        await tx.insert(fundFees).values(
          fees.map(({ sourceIndex, fee }) =>
            userScoped(ctx).stamp({
              fundId: row.id,
              ...fee,
              sourceId: sourceIndex === null ? null : ids[sourceIndex],
            }),
          ),
        );
      }
      return row;
    });
  } catch (error) {
    // The account made for it would otherwise be left behind with no fund.
    await removeAccount(ctx, account.id);
    throw error;
  }
  if (value !== null) await recordValuation(ctx, fund.id, { on: value.on, cents: value.cents });
  if (sources.some((source) => source.kind === "bank_debit")) await matchDebits(ctx, [fund.id]);
  return fund;
}

/** The fund's own fields. Its account, and the account's currency, are fixed at creation. */
export async function updateFund(ctx: Pick<Ctx, "userId">, id: string, input: FundInput): Promise<Fund> {
  await requireFund(ctx, id);
  const parsed = fundInputSchema.parse(input);
  const [row] = await duplicateName(
    getDb()
      .update(funds)
      .set(parsed)
      .where(and(eq(funds.id, id), userScoped(ctx).owns(funds)))
      .returning(),
  );
  return row;
}

/** Archive (the fund is hidden, its history stays) or bring it back. */
export async function setFundState(
  ctx: Pick<Ctx, "userId">,
  id: string,
  state: "active" | "archived",
): Promise<void> {
  const fund = await requireFund(ctx, id);
  if (state === "active" && fund.state !== "active") {
    // The payslip may feed another fund by now: this one comes back when its own source is paused.
    const own = (await sourcesOf(ctx, [id])).filter(
      (source) => source.kind === "payroll" && source.state === "active",
    );
    const holder = own.length === 0 ? undefined : (await takenComponents(ctx)).get("worker");
    if (holder !== undefined) throw new FundError("component_taken", holder);
  }
  await getDb()
    .update(funds)
    .set({ state, archivedAt: state === "archived" ? new Date() : null })
    .where(and(eq(funds.id, id), userScoped(ctx).owns(funds)));
}

// ——— Sources ————————————————————————————————————————————————————————————————————————————————

/**
 * One active payslip source per fund: a second one — another employer — is added once the first is
 * paused, so that the fund's periods are counted one way at a time.
 */
async function requireOnePayroll(
  ctx: Pick<Ctx, "userId">,
  fundId: string,
  source: { kind: string },
  exceptSourceId?: string,
): Promise<void> {
  if (source.kind !== "payroll") return;
  const active = (await sourcesOf(ctx, [fundId])).some(
    (one) => one.kind === "payroll" && one.state === "active" && one.id !== exceptSourceId,
  );
  if (active) throw new FundError("payroll_active");
}

/** A source added from Settings. More than one debit and more than one payslip source may exist. */
export async function addSource(
  ctx: Pick<Ctx, "userId" | "timeZone">,
  fundId: string,
  input: SourceInput,
): Promise<FundSource> {
  await requireOpenFund(ctx, fundId);
  const parsed = sourceInputSchema.parse(input);
  await requireFreeComponents(ctx, [parsed], { fundId });
  await requireOnePayroll(ctx, fundId, parsed);
  if (parsed.kind === "bank_debit") await requireAccount(ctx, parsed.accountId);
  const [row] = await getDb()
    .insert(fundContributionSources)
    .values(userScoped(ctx).stamp({ fundId, ...sourceValues(parsed) }))
    .returning()
    .catch((error: unknown) => {
      // One "payments by hand" per fund: it only says where the button is.
      if (hasPgError(error, UNIQUE_VIOLATION, "fund_contribution_sources_manual_uq")) {
        throw new FundError("invalid");
      }
      throw error;
    });
  if (parsed.kind === "bank_debit") await matchDebits(ctx, [fundId]);
  return row;
}

/** A source corrected. Its kind stays: a debit does not become a payslip. */
export async function updateSource(
  ctx: Pick<Ctx, "userId" | "timeZone">,
  sourceId: string,
  input: SourceInput,
): Promise<FundSource> {
  const current = await requireSource(ctx, sourceId);
  await requireOpenFund(ctx, current.fundId);
  const parsed = sourceInputSchema.parse(input);
  if (parsed.kind !== current.kind) throw new FundError("invalid");
  if (current.state === "active") await requireFreeComponents(ctx, [parsed], { fundId: current.fundId });
  if (parsed.kind === "bank_debit") await requireAccount(ctx, parsed.accountId);
  const [row] = await getDb()
    .update(fundContributionSources)
    .set(sourceValues(parsed, current))
    .where(and(eq(fundContributionSources.id, sourceId), userScoped(ctx).owns(fundContributionSources)))
    .returning();
  if (parsed.kind === "bank_debit" && row.state === "active") await matchDebits(ctx, [row.fundId]);
  return row;
}

/** Pause a source, or bring it back. A paused debit expects nothing and finds nothing. */
export async function setSourceState(
  ctx: Pick<Ctx, "userId" | "timeZone">,
  sourceId: string,
  state: SourceState,
): Promise<void> {
  const current = await requireSource(ctx, sourceId);
  await requireOpenFund(ctx, current.fundId);
  if (state === "active" && current.kind === "payroll") {
    const holder = (await takenComponents(ctx, { fundId: current.fundId })).get("worker");
    if (holder !== undefined) throw new FundError("component_taken", holder);
    await requireOnePayroll(ctx, current.fundId, { kind: "payroll" }, sourceId);
  }
  await getDb()
    .update(fundContributionSources)
    .set({ state })
    .where(and(eq(fundContributionSources.id, sourceId), userScoped(ctx).owns(fundContributionSources)));
  if (state === "active" && current.kind === "bank_debit") await matchDebits(ctx, [current.fundId]);
}

/**
 * How many contributions each source has. Those of a payslip source are the operations tied to it
 * and the fund's contributions and enrolments tied to no source: the ones a document wrote before
 * release N6 came from the payslips too. With several payslip sources, the untied ones count for
 * the oldest: it was there first.
 */
export function contributionsBySource(
  sources: readonly Pick<FundSource, "id" | "fundId" | "kind">[],
  operations: readonly Pick<FundOperation, "fundId" | "sourceId" | "classification">[],
): Map<string, number> {
  const counts = new Map<string, number>(sources.map((source) => [source.id, 0]));
  for (const operation of operations) {
    if (operation.sourceId !== null) {
      if (counts.has(operation.sourceId)) counts.set(operation.sourceId, counts.get(operation.sourceId)! + 1);
      continue;
    }
    if (operation.classification !== "contribution" && operation.classification !== "enrollment") continue;
    const payroll = sources.find((source) => source.fundId === operation.fundId && source.kind === "payroll");
    if (payroll) counts.set(payroll.id, counts.get(payroll.id)! + 1);
  }
  return counts;
}

export interface RemovedSource {
  source: FundSource;
  /** The fees that applied to it alone: they go with it, and come back with it. */
  fees: FundFee[];
}

/**
 * A source with no contribution is removed, with the fees that applied to it alone. One with
 * contributions is not: it is paused, so that its contributions keep their origin.
 */
export async function removeSource(ctx: Pick<Ctx, "userId">, sourceId: string): Promise<RemovedSource> {
  const source = await requireSource(ctx, sourceId);
  await requireOpenFund(ctx, source.fundId);
  const siblings = await sourcesOf(ctx, [source.fundId]);
  const operations = await getDb()
    .select({
      fundId: fundOperations.fundId,
      sourceId: fundOperations.sourceId,
      classification: fundOperations.classification,
    })
    .from(fundOperations)
    .where(and(userScoped(ctx).owns(fundOperations), eq(fundOperations.fundId, source.fundId)));
  const counts = contributionsBySource(siblings, operations);
  if ((counts.get(sourceId) ?? 0) > 0) throw new FundError("has_contributions");
  const fees = (await feesOf(ctx, [source.fundId])).filter((fee) => fee.sourceId === sourceId);
  await getDb()
    .delete(fundContributionSources)
    .where(and(eq(fundContributionSources.id, sourceId), userScoped(ctx).owns(fundContributionSources)));
  return { source, fees };
}

/** The explicit due dates of a source as they are stored: well-formed ones, or `null` for none. */
function explicitDueEntries(value: unknown, period: AccrualPeriod) {
  const entries = parseDueEntries(value, period);
  return entries.length > 0 ? entries : null;
}

/** "Undo" of a removal: the same rows, with the ids they had, so nothing that named them breaks. */
export async function restoreSource(
  ctx: Pick<Ctx, "userId">,
  fundId: string,
  removed: {
    source: SourceInput & { id: string; state: SourceState };
    /** The explicit due dates the source had, as `removeSource` returned them. */
    dueEntries?: unknown;
    fees: (FeeInput & { id: string })[];
  },
): Promise<void> {
  await requireOpenFund(ctx, fundId);
  const { id, state, ...rest } = removed.source;
  const parsed = sourceInputSchema.parse(rest);
  const sourceId = z.uuid().parse(id);
  if (state === "active") {
    await requireFreeComponents(ctx, [parsed], { fundId });
    await requireOnePayroll(ctx, fundId, parsed);
  }
  if (parsed.kind === "bank_debit") await requireAccount(ctx, parsed.accountId);
  const fees = removed.fees.map(({ id: feeId, ...fee }) => ({
    id: z.uuid().parse(feeId),
    ...feeInputSchema.parse({ ...fee, sourceId }),
  }));
  await getDb().transaction(async (tx) => {
    await tx.insert(fundContributionSources).values(
      userScoped(ctx).stamp({
        id: sourceId,
        fundId,
        state: z.enum(["active", "paused"]).parse(state),
        ...sourceValues(parsed),
        ...(parsed.kind === "payroll" && parsed.due === null
          ? { dueEntries: explicitDueEntries(removed.dueEntries, parsed.accrualPeriod) }
          : {}),
      }),
    );
    if (fees.length > 0) {
      await tx.insert(fundFees).values(fees.map((fee) => userScoped(ctx).stamp({ fundId, ...fee })));
    }
  });
}

// ——— Fees ———————————————————————————————————————————————————————————————————————————————————

export async function addFee(
  ctx: Pick<Ctx, "userId">,
  fundId: string,
  input: FeeInput & { id?: string },
): Promise<FundFee> {
  await requireOpenFund(ctx, fundId);
  const { id, ...rest } = input;
  const parsed = feeInputSchema.parse(rest);
  requireFeeScope(parsed, await sourcesOf(ctx, [fundId]));
  const [row] = await getDb()
    .insert(fundFees)
    .values(
      userScoped(ctx).stamp({ fundId, ...parsed, ...(id === undefined ? {} : { id: z.uuid().parse(id) }) }),
    )
    .returning();
  return row;
}

async function requireFee(ctx: Pick<Ctx, "userId">, id: string): Promise<FundFee> {
  const [row] = await getDb()
    .select()
    .from(fundFees)
    .where(and(eq(fundFees.id, id), userScoped(ctx).owns(fundFees)));
  if (!row) throw new FundError("not_found");
  return row;
}

export async function updateFee(ctx: Pick<Ctx, "userId">, feeId: string, input: FeeInput): Promise<FundFee> {
  const current = await requireFee(ctx, feeId);
  await requireOpenFund(ctx, current.fundId);
  const parsed = feeInputSchema.parse(input);
  requireFeeScope(parsed, await sourcesOf(ctx, [current.fundId]));
  const [row] = await getDb()
    .update(fundFees)
    .set(parsed)
    .where(and(eq(fundFees.id, feeId), userScoped(ctx).owns(fundFees)))
    .returning();
  return row;
}

/** A fee removed. The contributions already recorded keep the fee each of them states. */
export async function removeFee(ctx: Pick<Ctx, "userId">, feeId: string): Promise<FundFee> {
  const current = await requireFee(ctx, feeId);
  await requireOpenFund(ctx, current.fundId);
  await getDb()
    .delete(fundFees)
    .where(and(eq(fundFees.id, feeId), userScoped(ctx).owns(fundFees)));
  return current;
}

// ——— Valuations —————————————————————————————————————————————————————————————————————————————

export interface ValuationInput {
  on: string;
  cents: Cents;
  units?: string | null;
  note?: string | null;
}

/** A valuation's day (never in the future) and the two fields the balance has no place for. */
function valuationFields(
  ctx: Pick<Ctx, "timeZone">,
  input: ValuationInput,
): { units: string | null; note: string | null } {
  if (!isCivilDate(input.on)) throw new FundError("invalid");
  if (isFutureDate(input.on, today(ctx.timeZone))) throw new FundError("future_date");
  const units = input.units === undefined || input.units === null || input.units === "" ? null : input.units;
  if (units !== null && !/^\d+(\.\d{1,6})?$/.test(units)) throw new FundError("invalid");
  return { units, note: input.note?.trim() ? input.note.trim().slice(0, 200) : null };
}

/**
 * A valuation (spec §7.7): a `manual` balance on the valuation account on that day — the value's one
 * home, which net worth reads — and the units and note beside it. A second valuation on the same
 * day replaces the first.
 */
export async function recordValuation(
  ctx: Ctx,
  fundId: string,
  input: ValuationInput,
): Promise<FundValuation> {
  const fund = await requireOpenFund(ctx, fundId);
  const { units, note } = valuationFields(ctx, input);
  const entry = await saveBalanceEntry(ctx, fund.valuationAccountId, {
    on: input.on,
    cents: input.cents,
    note: note ?? "",
  });
  const [row] = await getDb()
    .insert(fundValuations)
    .values(
      userScoped(ctx).stamp({ fundId, balanceEntryId: entry.id, units, note, source: "manual" as const }),
    )
    .onConflictDoUpdate({ target: fundValuations.balanceEntryId, set: { units, note } })
    .returning();
  return row;
}

async function requireValuation(ctx: Pick<Ctx, "userId">, valuationId: string): Promise<FundValuation> {
  const [row] = await getDb()
    .select()
    .from(fundValuations)
    .where(and(eq(fundValuations.id, valuationId), userScoped(ctx).owns(fundValuations)));
  if (!row) throw new FundError("not_found");
  return row;
}

/**
 * A valuation corrected by hand (day, value, units, note). The value's one home is the `manual`
 * balance of the valuation account, so a new day **moves** that balance instead of adding a second:
 * the value is written on the new day, the valuation row follows it inside one transaction — taking
 * with it any valuation that already sat there, which is what «one value per day» means — and only
 * then is the balance of the old day dropped, with nothing left pointing at it. A valuation read
 * from a statement before release N6 (`import`) is not edited here: it stays as it was read.
 */
export async function updateValuation(
  ctx: Ctx,
  valuationId: string,
  input: ValuationInput,
): Promise<FundValuation> {
  const current = await requireValuation(ctx, valuationId);
  if (current.source !== "manual") throw new FundError("invalid");
  const fund = await requireOpenFund(ctx, current.fundId);
  const { units, note } = valuationFields(ctx, input);
  const previousEntryId = current.balanceEntryId;
  const entry = await saveBalanceEntry(ctx, fund.valuationAccountId, {
    on: input.on,
    cents: input.cents,
    note: note ?? "",
  });
  if (entry.id === previousEntryId) {
    const [row] = await getDb()
      .update(fundValuations)
      .set({ units, note })
      .where(and(eq(fundValuations.id, valuationId), userScoped(ctx).owns(fundValuations)))
      .returning();
    return row;
  }
  const row = await getDb().transaction(async (tx) => {
    await tx
      .delete(fundValuations)
      .where(and(eq(fundValuations.balanceEntryId, entry.id), userScoped(ctx).owns(fundValuations)));
    const [moved] = await tx
      .update(fundValuations)
      .set({ balanceEntryId: entry.id, units, note })
      .where(and(eq(fundValuations.id, valuationId), userScoped(ctx).owns(fundValuations)))
      .returning();
    return moved;
  });
  await deleteBalanceEntry(ctx, previousEntryId);
  return row;
}

/** Deleting a valuation deletes its balance; the valuation row goes with it (cascade). */
export async function deleteValuation(
  ctx: Pick<Ctx, "userId" | "timeZone">,
  valuationId: string,
): Promise<void> {
  const row = await requireValuation(ctx, valuationId);
  await deleteBalanceEntry(ctx, row.balanceEntryId);
}

// ——— Contributions and the other operations written by hand ————————————————————————————————————

const fee = z.bigint().nonnegative().nullable();

/**
 * What a person writes in the register. A contribution is voluntary (one amount, which may be tied
 * to the movement that paid it) or from the payslip (the three components, as the fund states them,
 * for a period). The other operations are not contributions: joining, a transfer in from another
 * fund, a change of compartment, an exit. `feeCents: null` is a fee nobody knows yet.
 */
export const contributionSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("voluntary"),
    on: civilDate,
    amountCents: z.bigint().positive(),
    feeCents: fee,
    transactionId: z.uuid().nullable().default(null),
    note: optionalText(200),
  }),
  z.object({
    kind: z.literal("payroll"),
    on: civilDate,
    workerCents: z.bigint().nonnegative(),
    employerCents: z.bigint().nonnegative(),
    tfrCents: z.bigint().nonnegative(),
    /** The period the transfer is for, counted as the fund's payslip source counts it. */
    period: z
      .object({ year: z.number().int().min(1990).max(2200), index: z.number().int().min(1).max(12) })
      .nullable()
      .default(null),
    feeCents: fee,
    note: optionalText(200),
  }),
  z.object({
    kind: z.literal("other"),
    classification: z.enum(["enrollment", "transfer_in", "switch", "withdrawal"]),
    on: civilDate,
    amountCents: z.bigint().nonnegative(),
    feeCents: fee,
    note: optionalText(200),
  }),
]);
export type ContributionInput = z.input<typeof contributionSchema>;

/** The class an operation written by hand has, for the form that edits it. */
export const isManualClass = (value: string): value is ManualClass =>
  (MANUAL_CLASSES as readonly string[]).includes(value);

/** The columns of an operation, from what a person wrote. */
async function operationValues(ctx: Pick<Ctx, "userId" | "timeZone">, fund: Fund, input: ContributionInput) {
  const parsed = contributionSchema.parse(input);
  if (isFutureDate(parsed.on, today(ctx.timeZone))) throw new FundError("future_date");
  const feesCents = parsed.feeCents ?? 0n;
  const amounts = { workerCents: 0n, employerCents: 0n, tfrCents: 0n, otherCents: 0n };
  const base = {
    operationDate: parsed.on,
    feesCents,
    feesUnknown: parsed.feeCents === null,
    note: parsed.note,
    competenceYear: null as number | null,
    competenceQuarter: null as number | null,
    transactionId: null as string | null,
    sourceId: null as string | null,
  };
  if (parsed.kind === "voluntary") {
    if (feesCents > parsed.amountCents) throw new FundError("invalid");
    // The foreign key knows the movement exists, not whose it is: only the user's own can be tied.
    if (parsed.transactionId !== null && !(await getTransaction(ctx, parsed.transactionId))) {
      throw new FundError("not_found");
    }
    return {
      ...base,
      ...amounts,
      classification: "voluntary" as const,
      workerCents: parsed.amountCents,
      netCents: parsed.amountCents - feesCents,
      transactionId: parsed.transactionId,
    };
  }
  if (parsed.kind === "payroll") {
    const gross = parsed.workerCents + parsed.employerCents + parsed.tfrCents;
    if (gross <= 0n || feesCents > gross) throw new FundError("invalid");
    const payroll = (await sourcesOf(ctx, [fund.id])).filter((one) => one.kind === "payroll");
    const source = payroll.find((one) => one.state === "active") ?? payroll[0] ?? null;
    if (parsed.period !== null) {
      const limit = source?.accrualPeriod ? periodsPerYear(source.accrualPeriod) : 4;
      if (parsed.period.index > limit) throw new FundError("invalid");
    }
    return {
      ...base,
      ...amounts,
      classification: "contribution" as const,
      workerCents: parsed.workerCents,
      employerCents: parsed.employerCents,
      tfrCents: parsed.tfrCents,
      netCents: gross - feesCents,
      competenceYear: parsed.period?.year ?? null,
      competenceQuarter: parsed.period?.index ?? null,
      sourceId: source?.id ?? null,
    };
  }
  const { classification, amountCents } = parsed;
  if (classification === "switch") {
    // A change of compartment moves no money across the fund's boundary: only its cost is written.
    if (amountCents !== 0n) throw new FundError("invalid");
    return { ...base, ...amounts, classification, netCents: -feesCents };
  }
  if (amountCents <= 0n) throw new FundError("invalid");
  if (classification === "withdrawal") {
    // What left the position, positive: the flows read it as money out, never as a loss.
    return { ...base, ...amounts, classification, otherCents: amountCents, netCents: -amountCents };
  }
  if (feesCents > amountCents) throw new FundError("invalid");
  return { ...base, ...amounts, classification, otherCents: amountCents, netCents: amountCents - feesCents };
}

const movementTaken = (error: unknown): never => {
  if (hasPgError(error, UNIQUE_VIOLATION, "fund_operations_transaction_uq")) {
    throw new FundError("movement_taken");
  }
  throw error;
};

/** A contribution, or another operation, written by hand in the fund's register. */
export async function addContribution(
  ctx: Pick<Ctx, "userId" | "timeZone">,
  fundId: string,
  input: ContributionInput,
): Promise<FundOperation> {
  const fund = await requireOpenFund(ctx, fundId);
  const values = await operationValues(ctx, fund, input);
  const [row] = await getDb()
    .insert(fundOperations)
    .values(
      userScoped(ctx).stamp({
        fundId,
        originKey: `manual:${randomUUID()}`,
        originalType: values.classification,
        originalState: null,
        source: "manual" as const,
        ...values,
      }),
    )
    .returning()
    .catch(movementTaken);
  return row;
}

async function requireOperation(ctx: Pick<Ctx, "userId">, id: string): Promise<FundOperation> {
  const [row] = await getDb()
    .select()
    .from(fundOperations)
    .where(and(eq(fundOperations.id, id), userScoped(ctx).owns(fundOperations)));
  if (!row) throw new FundError("not_found");
  return row;
}

/**
 * An operation corrected by hand. One the job found among the movements keeps its movement and its
 * source: only its day, its amount, its fee and its note change — the fee is how an unknown one
 * becomes known. One read from a document before release N6 is not edited: it stays as it was read.
 */
export async function updateContribution(
  ctx: Pick<Ctx, "userId" | "timeZone">,
  operationId: string,
  input: ContributionInput,
): Promise<FundOperation> {
  const current = await requireOperation(ctx, operationId);
  if (current.source === "import") throw new FundError("linked");
  const fund = await requireOpenFund(ctx, current.fundId);
  const values = await operationValues(ctx, fund, input);
  if (current.source === "rule") {
    if (values.classification !== "voluntary") throw new FundError("invalid");
    values.transactionId = current.transactionId;
    values.sourceId = current.sourceId;
  }
  const [row] = await getDb()
    .update(fundOperations)
    .set({
      ...values,
      originalType: current.source === "rule" ? current.originalType : values.classification,
    })
    .where(and(eq(fundOperations.id, operationId), userScoped(ctx).owns(fundOperations)))
    .returning()
    .catch(movementTaken);
  return row;
}

/**
 * An operation written by hand can go. One the job tied to a movement cannot: the job would bring it
 * straight back — the movement is hidden in Expenses instead, and hidden movements are never
 * matched. One read from a document before release N6 stays: it is the fund's history.
 */
export async function deleteContribution(ctx: Pick<Ctx, "userId">, operationId: string): Promise<void> {
  const current = await requireOperation(ctx, operationId);
  if (current.source === "import") throw new FundError("linked");
  if (current.source === "rule" && current.transactionId !== null) throw new FundError("linked");
  await getDb()
    .delete(fundOperations)
    .where(and(eq(fundOperations.id, operationId), userScoped(ctx).owns(fundOperations)));
}

// ——— The recurring debits found among the movements ——————————————————————————————————————————

/** An identifier without the spaces or dots a bank may print inside it (`detect.ts`). */
function compactKey(value: string): string {
  return value.replace(/[\s.]+/g, "").toUpperCase();
}

/**
 * Days between a debit that lost its movement and the movement that takes it back. When the bank
 * source gives the same debit a new id, the old row is purged and the new one arrives as a movement
 * no operation holds: it takes the orphan back — same amount, within these days — instead of making
 * a second contribution (owner, 2026-10-25: the debit of 19 October counted six times).
 */
const READOPT_DAYS = 3;

const laterOf = (a: CivilDate, b: CivilDate | null): CivilDate => (b !== null && b > a ? b : a);
const earlierOf = (a: CivilDate, b: CivilDate | null): CivilDate => (b !== null && b < a ? b : a);

/**
 * The movements that become contributions by themselves: for every active recurring debit of an
 * open fund, the visible outgoing movements (expense or giroconto) on the source's account — any
 * account without one — inside the plan's dates, whose payee contains the text without spaces or
 * case, and that no operation holds yet. Each becomes a `voluntary` operation with `source = rule`.
 * The fee is what the fund's list takes from each contribution of that source; unknown without one.
 *
 * Idempotent: a movement makes one operation (unique key), and an operation edited by hand is never
 * touched again. The period of the plan decides nothing here: what was debited is written whenever
 * it was debited, and the period only says whether a debit is late (`debitStatus`).
 */
export async function matchDebits(
  ctx: Pick<Ctx, "userId" | "timeZone">,
  fundIds?: readonly string[],
): Promise<{ written: number }> {
  const sources = await getDb()
    .select({ source: fundContributionSources, fund: funds })
    .from(fundContributionSources)
    .innerJoin(funds, eq(funds.id, fundContributionSources.fundId))
    .where(
      and(
        userScoped(ctx).owns(fundContributionSources),
        eq(fundContributionSources.kind, "bank_debit"),
        eq(fundContributionSources.state, "active"),
        eq(funds.state, "active"),
        fundIds === undefined ? undefined : inArray(fundContributionSources.fundId, [...fundIds]),
      ),
    )
    .orderBy(asc(fundContributionSources.createdAt), asc(fundContributionSources.id));
  if (sources.length === 0) return { written: 0 };
  const fees = await feesOf(ctx, [...new Set(sources.map(({ fund }) => fund.id))]);
  let written = 0;
  const todayOn = today(ctx.timeZone);
  for (const { source, fund } of sources) {
    const needle = source.payeeMatch === null ? null : payeeKeyOf(source.payeeMatch);
    if (source.payeeMatch === null || needle === null) continue;
    const from = laterOf(fund.startOn, source.validFrom);
    const to = earlierOf(todayOn, source.validTo);
    if (from > to) continue;
    // A source's text may be a payee or the creditor identifier of the direct debit that pays the
    // fund (`detect.ts`). The first lives in the payee, the second in the bank's own text, so both
    // are looked at: a text made from an identifier would otherwise match nothing.
    const identifier = compactKey(source.payeeMatch);
    const candidates = (
      await chargeCandidates(ctx, {
        accountId: source.accountId,
        from,
        to,
        types: ["expense", "transfer"],
      })
    ).filter(
      (candidate) =>
        (payeeKeyOf(candidate.payee) ?? "").includes(needle) ||
        compactKey(`${candidate.payee ?? ""} ${candidate.note ?? ""}`).includes(identifier),
    );
    if (candidates.length === 0) continue;
    const held = new Set(
      (
        await getDb()
          .select({ id: fundOperations.transactionId })
          .from(fundOperations)
          .where(
            and(
              userScoped(ctx).owns(fundOperations),
              inArray(
                fundOperations.transactionId,
                candidates.map((candidate) => candidate.id),
              ),
            ),
          )
      ).map((row) => row.id),
    );
    const orphans = await getDb()
      .select({
        id: fundOperations.id,
        on: fundOperations.operationDate,
        chargedCents: fundOperations.workerCents,
      })
      .from(fundOperations)
      .where(
        and(
          userScoped(ctx).owns(fundOperations),
          eq(fundOperations.fundId, fund.id),
          eq(fundOperations.source, "rule"),
          isNull(fundOperations.transactionId),
          or(eq(fundOperations.sourceId, source.id), isNull(fundOperations.sourceId)),
        ),
      );
    const fresh: typeof candidates = [];
    for (const candidate of candidates) {
      if (held.has(candidate.id)) continue;
      const nearest = orphans
        .filter(
          (orphan) =>
            orphan.chargedCents === candidate.cents &&
            Math.abs(daysBetween(orphan.on, candidate.on)) <= READOPT_DAYS,
        )
        .sort(
          (a, b) => Math.abs(daysBetween(a.on, candidate.on)) - Math.abs(daysBetween(b.on, candidate.on)),
        )[0];
      if (nearest === undefined) {
        fresh.push(candidate);
        continue;
      }
      orphans.splice(orphans.indexOf(nearest), 1);
      await getDb()
        .update(fundOperations)
        .set({ transactionId: candidate.id, sourceId: source.id })
        .where(and(eq(fundOperations.id, nearest.id), userScoped(ctx).owns(fundOperations)));
    }
    if (fresh.length === 0) continue;
    const own = fees.filter((one) => one.fundId === fund.id);
    const rows = await getDb()
      .insert(fundOperations)
      .values(
        fresh.map((candidate) => {
          const feeCents = contributionFee(own, {
            on: candidate.on,
            chargedCents: candidate.cents,
            sourceId: source.id,
          });
          return userScoped(ctx).stamp({
            fundId: fund.id,
            originKey: `rule:${candidate.id}`,
            originalType: "voluntary",
            classification: "voluntary" as const,
            originalState: null,
            operationDate: candidate.on,
            workerCents: candidate.cents,
            feesCents: feeCents ?? 0n,
            feesUnknown: feeCents === null,
            netCents: candidate.cents - (feeCents ?? 0n),
            transactionId: candidate.id,
            source: "rule" as const,
            sourceId: source.id,
          });
        }),
      )
      .onConflictDoNothing()
      .returning({ id: fundOperations.id });
    written += rows.length;
  }
  return { written };
}

/**
 * "Find this charge everywhere": from one movement of a debit, the most durable name it carries —
 * the creditor identifier of the direct debit, its mandate reference, or failing both its payee
 * (`detect.ts`) — and every other charge that carries the same name.
 *
 * It only reads. What it returns is a proposal the person sees before anything is written: how
 * many charges were found, from when, what they usually cost and how far apart they fall. Saving
 * the source is a second, deliberate step, and that is what brings the past ones in as
 * contributions and keeps the future ones coming.
 */
export async function proposeDebitMatch(
  ctx: Pick<Ctx, "userId" | "timeZone">,
  fundId: string,
  transactionId: string,
  accountId: string | null = null,
): Promise<Detection | null> {
  const fund = await requireFund(ctx, fundId);
  const todayOn = today(ctx.timeZone);
  // Every outgoing movement since the fund started, on the account asked for when there is one. The
  // chosen movement is looked for among them, so a movement of somebody else's is simply not there.
  const candidates = await chargeCandidates(ctx, {
    accountId,
    from: fund.startOn,
    to: todayOn,
    types: ["expense", "transfer"],
  });
  const chosen = candidates.find((candidate) => candidate.id === transactionId);
  if (!chosen) return null;
  const key = recurrenceKeyOf(chosen);
  if (key === null) return null;
  return summarise(
    key,
    candidates
      .filter((candidate) => carriesKey(candidate, key))
      .map((candidate) => ({ on: candidate.on, cents: candidate.cents })),
  );
}
