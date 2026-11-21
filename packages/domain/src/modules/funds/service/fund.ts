// Funds · the fund itself: created with its account, sources and fees, changed, archived.
import { and, eq } from "drizzle-orm";
import type { Ctx } from "../../../platform/context";
import { getDb } from "../../../platform/db/client";
import { userScoped } from "../../../platform/db/scope";
import { isDisplayCurrency } from "../../../platform/fx/rules";
import { isCivilDate, today } from "../../../shared/dates";
import { createAccount, isFutureDate, removeAccount } from "../../accounts";
import { fundContributionSources, fundFees, funds } from "../schema";
import { matchDebits } from "./debits";
import {
  feeInputSchema,
  type Fund,
  FundError,
  type FundInput,
  fundInputSchema,
  type NewFundInput,
  sourceInputSchema,
} from "./model";
import {
  duplicateName,
  requireAccount,
  requireFreeComponents,
  requireFund,
  sourcesOf,
  sourceValues,
  takenComponents,
} from "./reads";
import { recordValuation } from "./valuations";

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
