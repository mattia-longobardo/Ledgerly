// src/app/(app)/accounts/[id]/context.ts — what an account's page reads around its figures, and the
// accounts of the banks the switch can move it to, as `/api/v1` answers them (rewrite plan R2). The
// web composes them, as it composes the switch, because the registry of providers and the bank's
// plugin are the web's, until R4. No IBAN leaves here, whole or masked (H45): only two flags.
import "server-only";
import { z } from "zod";
import { type Account, getAccount, openSwitchOf } from "@ledgerly/domain/accounts";
import type { Ctx } from "@ledgerly/domain/platform/context";
import { normalizeIban } from "@ledgerly/domain/platform/iban";
import { listConnections } from "@ledgerly/domain/platform/integrations";
import { findInstancePlugin, isPluginActive, listPluginConnections } from "@ledgerly/domain/platform/plugins";
import { rulesOnAccount } from "@ledgerly/domain/interests";
import { managedSinceOf, serviceAccountIds } from "@ledgerly/domain/investments";
import { pocketsOnAccount } from "@ledgerly/domain/pockets";
import { subscriptionsOnAccount } from "@ledgerly/domain/subscriptions";
import { centsToDecimal } from "@ledgerly/domain/shared/money";
import { bankKindLabel, labelOf } from "@/platform/integrations/registry";
import { BANK_PLUGIN_ID } from "../../banks/plugin";
import { providerName } from "../../banks/provider-name";
import { freeBankAccounts, switchable } from "./switch/switch";

/** What a switch counted when it was applied; only `transfers` is shown. */
const counts = z.object({ transfers: z.number().int().optional() });

/** The switch to the bank as the page's «Data source» shows it (ux/n4-account-switch.md §2.2, §9.1). */
async function switchOf(ctx: Ctx, account: Account) {
  const open = await openSwitchOf(ctx, account.id);
  if (open === null) return null;
  return {
    source: (await labelOf({ provider: open.fromProvider, instanceKey: "" }, ctx.locale)).name,
    appliedAt: open.appliedAt.toISOString(),
    cutDate: open.cutDate,
    transfers: counts.safeParse(open.counts).data?.transfers ?? 0,
    publishes: (open.interestModes ?? []).length > 0,
    joined:
      open.mergedAccountId === null ? null : ((await getAccount(ctx, open.mergedAccountId))?.name ?? null),
    sourceConnected: (await listConnections(ctx)).some((one) => one.provider === open.fromProvider),
  };
}

/** «Move to the bank» with no open switch: nothing unless the person turned the bank's plugin on. */
async function switchOfferOf(ctx: Ctx, account: Account): Promise<"none" | "connect_first" | "offer"> {
  if (
    !switchable(account) ||
    !(await findInstancePlugin(BANK_PLUGIN_ID)) ||
    !(await isPluginActive(ctx, BANK_PLUGIN_ID))
  ) {
    return "none";
  }
  return (await listPluginConnections(ctx, BANK_PLUGIN_ID)).length > 0 ? "offer" : "connect_first";
}

export async function accountContext(ctx: Ctx, account: Account) {
  const [providerLabel, managed, inInvestments, pockets, paying, rules, open] = await Promise.all([
    providerName(ctx, account.provider),
    managedSinceOf(ctx, account.id),
    serviceAccountIds(ctx, [account.id]),
    pocketsOnAccount(ctx, account.id),
    subscriptionsOnAccount(ctx, account.id),
    rulesOnAccount(ctx, account.id),
    switchOf(ctx, account),
  ]);
  return {
    providerLabel,
    inInvestments: inInvestments.has(account.id),
    managed: managed !== null,
    pockets: pockets.map((pocket) => ({ id: pocket.id, name: pocket.name })),
    subscriptions: { count: paying.count, monthly: centsToDecimal(paying.monthlyCents) },
    interestRules: rules.map((rule) => ({
      id: rule.id,
      tiers: rule.tiers.map((tier) => ({
        upTo: tier.upToCents === null ? null : centsToDecimal(tier.upToCents),
        annualRate: tier.annualRate,
      })),
    })),
    switch: open,
    switchOffer: open === null ? await switchOfferOf(ctx, account) : ("none" as const),
  };
}

/**
 * The step «Account» of the switch (§4): the free accounts of the banks, named as «Choose the
 * accounts» names them, with the bank's IBAN said as `sameIban` / `otherIban` and never written.
 */
export async function switchCandidates(ctx: Ctx, account: Account) {
  const own = account.iban;
  const banks = await freeBankAccounts(ctx, account.id, account.currency, bankKindLabel(ctx.locale));
  return {
    banks: banks.map((bank) => ({
      connectionId: bank.connectionId,
      bank: bank.bank,
      expired: bank.expired,
      accounts: bank.accounts.map((choice) => {
        const theirs = normalizeIban(choice.identifier);
        return {
          bankAccountId: choice.providerAccountId,
          name: choice.name,
          currency: choice.currency,
          here: choice.here,
          sameIban: own !== null && theirs === own,
          otherIban: own !== null && theirs !== null && theirs !== own,
        };
      }),
    })),
  };
}
