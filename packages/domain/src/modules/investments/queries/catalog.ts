// The catalog of the services a person can add (§4.2).
import { type Account, readingsAt } from "../../accounts";
import type { Ctx } from "../../../platform/context";
import { today } from "../../../shared/dates";
import { type Cents } from "../../../shared/money";
import { INVESTMENT_PROVIDERS, type InvestmentProvider } from "../catalog";
import { eligibleAccounts, listInvestmentAccounts } from "../service";

// ——— Catalog (§4.2) ————————————————————————————————————————————————————————————————————————

export interface CatalogView {
  providers: (InvestmentProvider & { connected: { accountId: string; name: string }[] })[];
  /** "Use the existing account": every investment or crypto account, with why it cannot be picked. */
  existing: {
    id: string;
    name: string;
    currency: string;
    type: Account["type"];
    balanceCents: Cents | null;
    reason: "fund" | "type" | "managed" | null;
    /** Its account is read by a source. */
    synced: boolean;
    /** A manual service a provider can be connected to (manual → synced, §2.5). */
    manualService: boolean;
  }[];
}

export async function catalogView(ctx: Pick<Ctx, "userId" | "timeZone">): Promise<CatalogView> {
  const [investments, eligible] = await Promise.all([listInvestmentAccounts(ctx), eligibleAccounts(ctx)]);
  const accounts = new Map(eligible.map((one) => [one.account.id, one.account]));
  const candidates = eligible.filter((one) => one.reason !== "type" && one.account.state !== "archived");
  const balances = await readingsAt(
    ctx,
    candidates.map((one) => one.account.id),
    today(ctx.timeZone),
  );
  return {
    // No entry to come (R5b, decision B1c): «Connect a service» lists only what can be connected.
    providers: INVESTMENT_PROVIDERS.filter((provider) => provider.status !== "planned").map((provider) => ({
      ...provider,
      connected: investments
        .filter((investment) => investment.provider === provider.id)
        .flatMap((investment) => {
          const account = accounts.get(investment.accountId);
          return account && account.state !== "archived"
            ? [{ accountId: account.id, name: account.name }]
            : [];
        }),
    })),
    existing: candidates.map((one) => ({
      id: one.account.id,
      name: one.account.name,
      currency: one.account.currency,
      type: one.account.type,
      balanceCents: balances.get(one.account.id) ?? null,
      reason: one.reason,
      synced: one.account.origin === "synced",
      manualService:
        one.reason === "managed" &&
        investments.some(
          (investment) => investment.accountId === one.account.id && investment.provider === "manual",
        ),
    })),
  };
}
