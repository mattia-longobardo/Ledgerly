// Funds · the reads the writes need: a fund, a source, a fee of this user, and what is taken.
import { and, asc, eq, inArray } from "drizzle-orm";
import type { Ctx } from "../../../platform/context";
import { getDb } from "../../../platform/db/client";
import { hasPgError, UNIQUE_VIOLATION } from "../../../platform/db/errors";
import { userScoped } from "../../../platform/db/scope";
import { getAccount } from "../../accounts";
import { fundContributionSources, fundFees, funds } from "../schema";
import { PAYROLL_COMPONENTS, type PayrollComponent } from "../sources";
import {
  type Fund,
  FundError,
  type FundFee,
  type FundSource,
  type ParsedFee,
  type ParsedSource,
} from "./model";

// ——— Reads the writes need ————————————————————————————————————————————————————————————————————

export async function requireFund(ctx: Pick<Ctx, "userId">, id: string): Promise<Fund> {
  const [row] = await getDb()
    .select()
    .from(funds)
    .where(and(eq(funds.id, id), userScoped(ctx).owns(funds)));
  if (!row) throw new FundError("not_found");
  return row;
}

export async function requireOpenFund(ctx: Pick<Ctx, "userId">, id: string): Promise<Fund> {
  const fund = await requireFund(ctx, id);
  if (fund.state === "archived") throw new FundError("archived");
  return fund;
}

/** An account a source points at: this user's own, open. */
export async function requireAccount(ctx: Pick<Ctx, "userId">, id: string | null) {
  if (id === null) return null;
  const account = await getAccount(ctx, id);
  if (!account || account.state === "archived") throw new FundError("invalid_account");
  return account;
}

export function duplicateName<T>(write: Promise<T>): Promise<T> {
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

export async function requireSource(ctx: Pick<Ctx, "userId">, id: string): Promise<FundSource> {
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

export async function requireFreeComponents(
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
export function sourceValues(source: ParsedSource, current: FundSource | null = null) {
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
export function requireFeeScope(fee: ParsedFee, sources: readonly Pick<FundSource, "id" | "kind">[]): void {
  const source = fee.sourceId === null ? null : sources.find((one) => one.id === fee.sourceId);
  if (fee.sourceId !== null && !source) throw new FundError("not_found");
  if (fee.component !== null && source?.kind !== "payroll") throw new FundError("invalid");
  if (fee.basis === "on_assets" && (fee.sourceId !== null || fee.component !== null)) {
    throw new FundError("invalid");
  }
}
