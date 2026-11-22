// The services (§1.3): the accounts a service can open on, a manual service, its value and its address.
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import {
  createAccount,
  readingsAt,
  getAccount,
  listAccounts,
  removeAccount,
  saveBalanceEntry,
} from "../../accounts";
import type { Ctx } from "../../../platform/context";
import { addDays, today } from "../../../shared/dates";
import type { Cents } from "../../../shared/money";
import { getDb } from "../../../platform/db/client";
import { userScoped } from "../../../platform/db/scope";
import { accountTypeOf, MANUAL_PROVIDER } from "../catalog";
import { fundAccounts } from "../ports";
import { INVESTMENT_CATEGORIES, type InvestmentCategory, MANUAL_MODE } from "../rules";
import { investmentAccountPeriods, investmentAccounts } from "../schema";
import { civilDate } from "../../../shared/inputs";
import { requireInvestmentAccount } from "./book";
import { insertEvent } from "./events";
import { InvestmentError, notFuture } from "./types";

// ——— Services —————————————————————————————————————————————————————————————————————————————

const url = z
  .string()
  .trim()
  .max(500)
  .transform((value) => (value === "" || /^[a-z][a-z0-9+.-]*:/i.test(value) ? value : `https://${value}`))
  .refine((value) => {
    if (value === "") return true;
    try {
      const parsed = new URL(value);
      return (parsed.protocol === "https:" || parsed.protocol === "http:") && parsed.hostname.includes(".");
    } catch {
      return false;
    }
  }, "Not a web address")
  .transform((value) => (value === "" ? null : value));

export const manualServiceSchema = z.object({
  accountId: z.uuid(),
  category: z.enum(INVESTMENT_CATEGORIES),
  url: url.nullable().default(null),
});
export type ManualServiceInput = z.input<typeof manualServiceSchema>;

/**
 * The accounts a service may use (§1.3, PERS-342): open accounts of Accounts of type investment or
 * crypto that no other module writes — not a fund's valuation account, not already a service. An
 * account synced by Wallet is offered too: a manual service only reads it. A provider, which
 * writes the account, still needs a manual one (`origin`, checked by the connection).
 */
export async function eligibleAccounts(ctx: Pick<Ctx, "userId">) {
  const [all, funded, managed] = await Promise.all([
    listAccounts(ctx),
    fundAccounts().accountIds(ctx),
    getDb()
      .select({ accountId: investmentAccounts.accountId })
      .from(investmentAccounts)
      .where(userScoped(ctx).owns(investmentAccounts)),
  ]);
  const taken = new Set([...funded, ...managed.map((row) => row.accountId)]);
  return all.map((account) => ({
    account,
    // A fund's account first: since release N6 it is a pension account, and "it holds a fund" says
    // more than "it is not an investment account".
    reason: funded.has(account.id)
      ? ("fund" as const)
      : account.type !== "investment" && account.type !== "crypto"
        ? ("type" as const)
        : taken.has(account.id)
          ? ("managed" as const)
          : null,
  }));
}

/**
 * A manual service (§4.2, PERS-342): an account of Accounts the module shows, never a new one. It
 * writes nothing to the account: its value stays the account's balance and its deposits and
 * withdrawals the account's movements. The opening is the balance before its first day, so a
 * movement of that day counts once, as a deposit or a withdrawal.
 */
export async function createManualService(
  ctx: Ctx,
  input: ManualServiceInput,
): Promise<{ accountId: string }> {
  const parsed = manualServiceSchema.parse(input);
  const todayOn = today(ctx.timeZone);
  const now = new Date();
  const eligible = (await eligibleAccounts(ctx)).find((one) => one.account.id === parsed.accountId);
  if (!eligible || eligible.reason !== null) throw new InvestmentError("not_eligible");
  const opening =
    (await readingsAt(ctx, [parsed.accountId], addDays(todayOn, -1))).get(parsed.accountId) ?? null;
  return getDb().transaction(async (tx) => {
    const [investment] = await tx
      .insert(investmentAccounts)
      .values(
        userScoped(ctx).stamp({
          accountId: parsed.accountId,
          category: parsed.category,
          provider: MANUAL_PROVIDER,
          managedSince: todayOn,
          url: parsed.url,
          openedOn: eligible.account.openedOn ?? todayOn,
        }),
      )
      .returning();
    await tx.insert(investmentAccountPeriods).values(
      userScoped(ctx).stamp({
        investmentAccountId: investment.id,
        fromOn: todayOn,
        startsAt: now,
        mode: MANUAL_MODE,
        origin: "manual" as const,
        reason: "opening" as const,
      }),
    );
    if (opening !== null) {
      await insertEvent(ctx, tx, investment.id, {
        on: todayOn,
        occurredAt: now,
        origin: "conversion",
        legs: [{ leg: "main", kind: "opening_cash", amountCents: opening }],
      });
    }
    return { accountId: parsed.accountId };
  });
}

/**
 * A manual service on a new account of Accounts (R5b, audit OP-8): the account with today's value as
 * its first balance, then the service. Two writes of two modules: when the second fails, the account
 * is removed, so neither stays alone.
 */
export async function createManualServiceWithAccount(
  ctx: Ctx,
  input: {
    name: string;
    category: InvestmentCategory;
    currency: string;
    valueCents: Cents;
    url: string | null;
  },
): Promise<{ accountId: string }> {
  const account = await createAccount(ctx, {
    name: input.name,
    type: accountTypeOf(input.category),
    currency: input.currency,
    openingBalance: { on: today(ctx.timeZone), cents: input.valueCents },
  });
  try {
    return await createManualService(ctx, {
      accountId: account.id,
      category: input.category,
      url: input.url,
    });
  } catch (error) {
    await removeAccount(ctx, account.id);
    throw error;
  }
}

/**
 * "Update value" of a manual service (§1.3, PERS-342): a manual balance of its account in Accounts,
 * the one source of its value. Refused on an account a provider reads (Wallet): there the value
 * is the provider's, and a correction belongs to Accounts.
 */
export const serviceValueSchema = z.object({
  on: civilDate(),
  cents: z.bigint().nonnegative(),
});
export type ServiceValueInput = z.input<typeof serviceValueSchema>;

export async function updateServiceValue(
  ctx: Ctx,
  accountId: string,
  input: ServiceValueInput,
): Promise<void> {
  const parsed = serviceValueSchema.parse(input);
  notFuture(ctx, parsed.on);
  const investment = await requireInvestmentAccount(ctx, accountId);
  const account = await getAccount(ctx, accountId);
  if (!account) throw new InvestmentError("not_found");
  if (investment.provider !== MANUAL_PROVIDER || account.origin !== "manual") {
    throw new InvestmentError("not_editable");
  }
  await saveBalanceEntry(ctx, accountId, { on: parsed.on, cents: parsed.cents });
}

export async function updateServiceUrl(
  ctx: Pick<Ctx, "userId">,
  accountId: string,
  value: string,
): Promise<void> {
  const parsed = url.parse(value);
  const investment = await requireInvestmentAccount(ctx, accountId);
  await getDb()
    .update(investmentAccounts)
    .set({ url: parsed })
    .where(and(eq(investmentAccounts.id, investment.id), userScoped(ctx).owns(investmentAccounts)));
}
