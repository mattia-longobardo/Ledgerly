import "server-only";
import { and, eq, inArray } from "drizzle-orm";
import { z } from "zod";
import { getAccount } from "@/modules/accounts/queries";
import { isFutureDate } from "@/modules/accounts/rules";
import {
  createAccount,
  deleteBalanceEntry,
  removeAccount,
  saveBalanceEntry,
} from "@/modules/accounts/service";
import { chargeCandidates } from "@/modules/transactions/queries";
import { payeeKeyOf } from "@/modules/transactions/rules";
import type { Ctx } from "@/platform/context";
import { isCivilDate, today } from "@/platform/dates";
import { getDb } from "@/platform/db/client";
import { hasPgError, UNIQUE_VIOLATION } from "@/platform/db/errors";
import { userScoped } from "@/platform/db/scope";
import type { Cents } from "@/platform/money";
import { fundDepositRules, fundDeposits, funds, fundValuations } from "./schema";

export type Fund = typeof funds.$inferSelect;
export type FundDeposit = typeof fundDeposits.$inferSelect;
export type FundValuation = typeof fundValuations.$inferSelect;

export type FundErrorCode =
  "not_found" | "invalid" | "invalid_account" | "duplicate_name" | "archived" | "linked" | "future_date";

export class FundError extends Error {
  constructor(readonly code: FundErrorCode) {
    super(code);
    this.name = "FundError";
  }
}

const civilDate = z.string().refine(isCivilDate, "Not a civil date");
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
  isin: optionalText(12).refine(
    (value) => value === null || /^[A-Z]{2}[A-Z0-9]{9}[0-9]$/.test(value),
    "Not an ISIN",
  ),
  compartment: optionalText(80),
  debitAccountId: z.uuid().nullable().default(null),
  debitDay: z.number().int().min(1).max(31).nullable().default(null),
  ter: z
    .string()
    .regex(/^0(\.\d{1,6})?$|^1(\.0{1,6})?$/)
    .nullable()
    .default(null),
  startOn: civilDate,
  monthlyCents: z.bigint().positive().nullable().default(null),
  depositFeeCents: z.bigint().nonnegative().nullable().default(null),
});

export type FundInput = z.input<typeof fundInputSchema>;

const depositSchema = z.object({
  on: civilDate,
  chargedCents: z.bigint().positive(),
  feeCents: z.bigint().nonnegative().nullable(),
  note: optionalText(200),
});

async function requireFund(ctx: Pick<Ctx, "userId">, id: string): Promise<Fund> {
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

/** An account a fund points at: this user's own, open. */
async function requireAccount(ctx: Pick<Ctx, "userId">, id: string | null) {
  if (id === null) return null;
  const account = await getAccount(ctx, id);
  if (!account || account.state === "archived") throw new FundError("invalid_account");
  return account;
}

function duplicateName<T>(write: Promise<T>): Promise<T> {
  return write.catch((error: unknown) => {
    if (hasPgError(error, UNIQUE_VIOLATION, "funds_user_name_uq")) throw new FundError("duplicate_name");
    if (hasPgError(error, UNIQUE_VIOLATION, "funds_valuation_account_uq"))
      throw new FundError("invalid_account");
    throw error;
  });
}

/**
 * A new PAC (spec §7.7). Its value lives on a valuation account: an existing manual one of this
 * user's that no other fund uses, or a new `investment` account named after it. An initial capital
 * (the design's field) is the plan's first deposit, on its start date (plan F4 §3.6.4).
 */
export async function createFund(
  ctx: Ctx,
  input: FundInput & { valuationAccountId: string | null; initialCents?: Cents | null },
): Promise<Fund> {
  const parsed = fundInputSchema.parse(input);
  await requireAccount(ctx, parsed.debitAccountId);
  let valuationAccountId = input.valuationAccountId;
  let created = false;
  if (valuationAccountId === null) {
    const account = await createAccount(ctx, {
      name: parsed.name,
      type: "investment",
      currency: "EUR",
      color: null,
      reference: "",
      purpose: "",
      openedOn: parsed.startOn,
      notes: "",
      openingBalance: null,
    });
    valuationAccountId = account.id;
    created = true;
  } else {
    const account = await requireAccount(ctx, valuationAccountId);
    if (account?.origin !== "manual") throw new FundError("invalid_account");
  }
  let fund: Fund;
  try {
    [fund] = await duplicateName(
      getDb()
        .insert(funds)
        .values(userScoped(ctx).stamp({ ...parsed, type: "pac" as const, valuationAccountId }))
        .returning(),
    );
  } catch (error) {
    // The account made for it would otherwise be left behind with no fund.
    if (created) await removeAccount(ctx, valuationAccountId);
    throw error;
  }
  if (input.initialCents) {
    await addDeposit(ctx, fund.id, {
      on: parsed.startOn,
      chargedCents: input.initialCents,
      feeCents: 0n,
      note: null,
    });
  }
  return fund;
}

/** The fund's own settings; its valuation account is fixed at creation, with its history. */
export async function updateFund(ctx: Pick<Ctx, "userId">, id: string, input: FundInput): Promise<Fund> {
  await requireFund(ctx, id);
  const parsed = fundInputSchema.parse(input);
  await requireAccount(ctx, parsed.debitAccountId);
  const [row] = await duplicateName(
    getDb()
      .update(funds)
      .set(parsed)
      .where(and(eq(funds.id, id), userScoped(ctx).owns(funds)))
      .returning(),
  );
  return row;
}

/** Archive (design: "hides the fund but keeps its history") or bring it back. */
export async function setFundState(
  ctx: Pick<Ctx, "userId">,
  id: string,
  state: "active" | "archived",
): Promise<void> {
  await requireFund(ctx, id);
  await getDb()
    .update(funds)
    .set({ state, archivedAt: state === "archived" ? new Date() : null })
    .where(and(eq(funds.id, id), userScoped(ctx).owns(funds)));
}

/**
 * A valuation (spec §7.7): a `manual` balance on the valuation account on that day — the value's one
 * home, which net worth reads — and the units and note beside it. A second valuation on the same
 * day replaces the first.
 */
export async function recordValuation(
  ctx: Ctx,
  fundId: string,
  input: { on: string; cents: Cents; units?: string | null; note?: string | null },
): Promise<FundValuation> {
  const fund = await requireOpenFund(ctx, fundId);
  if (!isCivilDate(input.on)) throw new FundError("invalid");
  if (isFutureDate(input.on, today(ctx.timeZone))) throw new FundError("future_date");
  const units = input.units === undefined || input.units === null || input.units === "" ? null : input.units;
  if (units !== null && !/^\d+(\.\d{1,6})?$/.test(units)) throw new FundError("invalid");
  const note = input.note?.trim() ? input.note.trim().slice(0, 200) : null;
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

/** Deleting a valuation deletes its balance; the valuation row goes with it (cascade). */
export async function deleteValuation(
  ctx: Pick<Ctx, "userId" | "timeZone">,
  valuationId: string,
): Promise<void> {
  const [row] = await getDb()
    .select({ balanceEntryId: fundValuations.balanceEntryId })
    .from(fundValuations)
    .where(and(eq(fundValuations.id, valuationId), userScoped(ctx).owns(fundValuations)));
  if (!row) throw new FundError("not_found");
  await deleteBalanceEntry(ctx, row.balanceEntryId);
}

/** A deposit entered by hand (design: "Add deposit"): debited, fee, and the invested it makes. */
export async function addDeposit(
  ctx: Pick<Ctx, "userId" | "timeZone">,
  fundId: string,
  input: { on: string; chargedCents: Cents; feeCents: Cents | null; note: string | null },
): Promise<FundDeposit> {
  await requireOpenFund(ctx, fundId);
  const parsed = depositSchema.parse(input);
  if (parsed.feeCents !== null && parsed.feeCents > parsed.chargedCents) throw new FundError("invalid");
  if (isFutureDate(parsed.on, today(ctx.timeZone))) throw new FundError("future_date");
  const [row] = await getDb()
    .insert(fundDeposits)
    .values(userScoped(ctx).stamp({ fundId, ...parsed, source: "manual" as const }))
    .returning();
  return row;
}

async function requireDeposit(ctx: Pick<Ctx, "userId">, id: string): Promise<FundDeposit> {
  const [row] = await getDb()
    .select()
    .from(fundDeposits)
    .where(and(eq(fundDeposits.id, id), userScoped(ctx).owns(fundDeposits)));
  if (!row) throw new FundError("not_found");
  return row;
}

/** A deposit corrected by hand; one matched from a movement keeps its link. */
export async function updateDeposit(
  ctx: Pick<Ctx, "userId" | "timeZone">,
  id: string,
  input: { on: string; chargedCents: Cents; feeCents: Cents | null; note: string | null },
): Promise<FundDeposit> {
  await requireDeposit(ctx, id);
  const parsed = depositSchema.parse(input);
  if (parsed.feeCents !== null && parsed.feeCents > parsed.chargedCents) throw new FundError("invalid");
  if (isFutureDate(parsed.on, today(ctx.timeZone))) throw new FundError("future_date");
  const [row] = await getDb()
    .update(fundDeposits)
    .set(parsed)
    .where(and(eq(fundDeposits.id, id), userScoped(ctx).owns(fundDeposits)))
    .returning();
  return row;
}

/**
 * A manual deposit can go. One matched from a movement cannot: the rule would bring it straight
 * back — the movement is hidden in Expenses instead, and hidden movements are never matched.
 */
export async function deleteDeposit(ctx: Pick<Ctx, "userId">, id: string): Promise<void> {
  const deposit = await requireDeposit(ctx, id);
  if (deposit.source === "rule" && deposit.transactionId !== null) throw new FundError("linked");
  await getDb()
    .delete(fundDeposits)
    .where(and(eq(fundDeposits.id, id), userScoped(ctx).owns(fundDeposits)));
}

/** The deposit rule of a fund (spec §7.7): payee text, account (any if none), on or off. */
export async function saveDepositRule(
  ctx: Pick<Ctx, "userId" | "timeZone">,
  fundId: string,
  input: { payeeMatch: string; accountId: string | null; active: boolean },
): Promise<void> {
  await requireFund(ctx, fundId);
  const payeeMatch = input.payeeMatch.trim();
  if (payeeMatch.length < 1 || payeeMatch.length > 80) throw new FundError("invalid");
  await requireAccount(ctx, input.accountId);
  const values = { payeeMatch, accountId: input.accountId, active: input.active };
  await getDb()
    .insert(fundDepositRules)
    .values(userScoped(ctx).stamp({ fundId, ...values }))
    .onConflictDoUpdate({ target: fundDepositRules.fundId, set: values });
  await matchDeposits(ctx, [fundId]);
}

/**
 * The movements that become deposits by themselves (spec §7.7, plan F4 §3.4.9): for every active
 * rule of an open fund, the visible outgoing movements (expense or giroconto) on the rule's account
 * — any account without one — from the fund's start, whose payee contains the text without spaces
 * or case, and that no deposit holds yet. Debited = the movement; fee = the fund's fee per deposit
 * (unknown without one). Idempotent: a movement makes one deposit (unique key), and a deposit
 * edited by hand is never touched again.
 */
export async function matchDeposits(
  ctx: Pick<Ctx, "userId" | "timeZone">,
  fundIds?: readonly string[],
): Promise<{ written: number }> {
  const rules = await getDb()
    .select({ rule: fundDepositRules, fund: funds })
    .from(fundDepositRules)
    .innerJoin(funds, eq(funds.id, fundDepositRules.fundId))
    .where(
      and(
        userScoped(ctx).owns(fundDepositRules),
        eq(fundDepositRules.active, true),
        eq(funds.state, "active"),
        fundIds === undefined ? undefined : inArray(fundDepositRules.fundId, [...fundIds]),
      ),
    );
  let written = 0;
  const todayOn = today(ctx.timeZone);
  for (const { rule, fund } of rules) {
    const needle = payeeKeyOf(rule.payeeMatch);
    if (needle === null) continue;
    const candidates = (
      await chargeCandidates(ctx, {
        accountId: rule.accountId,
        from: fund.startOn,
        to: todayOn,
        types: ["expense", "transfer"],
      })
    ).filter((candidate) => (payeeKeyOf(candidate.payee) ?? "").includes(needle));
    if (candidates.length === 0) continue;
    const rows = await getDb()
      .insert(fundDeposits)
      .values(
        candidates.map((candidate) =>
          userScoped(ctx).stamp({
            fundId: fund.id,
            on: candidate.on,
            chargedCents: candidate.cents,
            feeCents:
              fund.depositFeeCents !== null && fund.depositFeeCents <= candidate.cents
                ? fund.depositFeeCents
                : null,
            transactionId: candidate.id,
            source: "rule" as const,
          }),
        ),
      )
      .onConflictDoNothing({ target: fundDeposits.transactionId })
      .returning({ id: fundDeposits.id });
    written += rows.length;
  }
  return { written };
}
