import { getDb } from "@domain/platform/db/client";
import type { Ctx } from "@domain/platform/context";
import { today } from "@domain/shared/dates";
import { createAccount } from "@domain/modules/accounts/service";
import { accountTypeOf } from "@domain/modules/investments/catalog";
import { type InvestmentCategory } from "@domain/modules/investments/rules";
import { createManualService, rebuild } from "@domain/modules/investments/service";
import { investmentAccountPeriods, investmentAccounts } from "@domain/modules/investments/schema";
import { transactions } from "@domain/modules/transactions/schema";

interface ServiceInput {
  name: string;
  category: InvestmentCategory;
  currency: string;
  url?: string | null;
}

/** An account of Accounts made for a service: Investments creates none (PERS-342). */
async function serviceAccount(
  ctx: Ctx,
  input: { name: string; category: InvestmentCategory; currency: string },
): Promise<string> {
  const account = await createAccount(ctx, {
    name: input.name,
    type: accountTypeOf(input.category),
    currency: input.currency,
  });
  return account.id;
}

/** The target of a provider connection on a new, empty account of Accounts. */
export async function connectTarget(
  ctx: Ctx,
  input: { name: string; category: InvestmentCategory; currency: string },
): Promise<{ kind: "existing"; accountId: string }> {
  return { kind: "existing", accountId: await serviceAccount(ctx, input) };
}

/** A manual service on a new manual account of Accounts: the view the app makes (PERS-342). */
export async function manualService(ctx: Ctx, input: ServiceInput): Promise<{ accountId: string }> {
  const accountId = await serviceAccount(ctx, input);
  return createManualService(ctx, { accountId, category: input.category, url: input.url ?? null });
}

/** The account of a service with a key, as the connection leaves it: no book, no period. */
export async function keyServiceAccount(ctx: Ctx, provider: string): Promise<{ accountId: string }> {
  const accountId = await serviceAccount(ctx, { name: provider, category: "broker", currency: "EUR" });
  await getDb()
    .insert(investmentAccounts)
    .values({
      userId: ctx.userId,
      accountId,
      category: "broker",
      provider,
      managedSince: today(ctx.timeZone),
    });
  return { accountId };
}

/**
 * The provider of {@link engineService}: no catalog entry, no connection — a service the module
 * writes, so the engine's tests can type its operations as a provider would deliver them.
 */
const ENGINE_PROVIDER = "test:engine";

/**
 * A service whose book the module writes, for the tests of the engine (§2): a manual period in
 * `mode`, the module the account's only writer from today. The app makes no such service by hand
 * any more — a manual service is a view on its account (PERS-342) — but the engine still values the
 * books of the synced services and the periods written before, and a test turns this one to
 * `synced` afterwards, as a provider would.
 */
export async function engineService(
  ctx: Ctx,
  input: ServiceInput & { mode?: "assets" | "total" },
): Promise<{ accountId: string }> {
  const accountId = await serviceAccount(ctx, input);
  const todayOn = today(ctx.timeZone);
  const [investment] = await getDb()
    .insert(investmentAccounts)
    .values({
      userId: ctx.userId,
      accountId,
      category: input.category,
      provider: ENGINE_PROVIDER,
      managedSince: todayOn,
      url: input.url ?? null,
      openedOn: todayOn,
    })
    .returning();
  await getDb()
    .insert(investmentAccountPeriods)
    .values({
      userId: ctx.userId,
      investmentAccountId: investment.id,
      fromOn: todayOn,
      startsAt: new Date(),
      mode: input.mode ?? "total",
      origin: "manual",
      reason: "opening",
    });
  await getDb().transaction((tx) => rebuild(ctx, investment, input.currency, todayOn, tx));
  return { accountId };
}

/** {@link engineService} in the per-asset mode. */
export async function assetsService(ctx: Ctx, input: ServiceInput): Promise<{ accountId: string }> {
  return engineService(ctx, { ...input, mode: "assets" });
}

/**
 * A movement of an account as Wallet writes it: what a manual service counts as a deposit (> 0) or
 * a withdrawal (< 0), PERS-342. Noon in Rome, so the day is the same in every zone the tests use.
 */
export async function accountMovement(
  ctx: Ctx,
  accountId: string,
  on: string,
  cents: bigint,
  over: { payee?: string; removed?: boolean } = {},
): Promise<void> {
  await getDb()
    .insert(transactions)
    .values({
      userId: ctx.userId,
      accountId,
      occurredAt: new Date(`${on}T12:00:00+01:00`),
      amountCents: cents,
      currency: "EUR",
      type: cents >= 0n ? "income" : "expense",
      state: "cleared",
      payee: over.payee ?? "Bonifico",
      removedUpstreamAt: over.removed ? new Date() : null,
    });
}
