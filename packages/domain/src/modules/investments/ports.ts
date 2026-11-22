// The ports of investments (10-modularity.md §10.3). Out: the adapter of the port
// `ManagedAccountsPort` of accounts (audit ACC-8), which accounts Investments manages. In: the
// accounts that hold a fund's value, which no service may use; declared here and realised by funds,
// so this module never imports funds (R5b, INV-9). The application wires both (`wireDomain`).
import type { Ctx } from "../../platform/context";
import { managedSinceOf, serviceAccountIds } from "./managed";

export const managedAccountsOfInvestments = { managedSinceOf, serviceAccountIds };

/** The accounts of the funds, as investments reads them. */
interface FundAccounts {
  accountIds(ctx: Pick<Ctx, "userId">): Promise<Set<string>>;
}

declare global {
  var ledgerlyFundAccounts: FundAccounts | undefined;
}

/** Wires the port; the application calls it once per process, before any request or job. */
export function wireInvestments(ports: { funds: FundAccounts }): void {
  globalThis.ledgerlyFundAccounts = ports.funds;
}

export function fundAccounts(): FundAccounts {
  const wired = globalThis.ledgerlyFundAccounts;
  if (!wired) throw new Error("investments: the ports are not wired (wireDomain of @ledgerly/api)");
  return wired;
}
