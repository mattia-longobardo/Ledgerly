import { listAccounts } from "@/modules/accounts/application/list-accounts";
import { runForPrincipal as runForAccountPrincipal } from "@/modules/accounts/ui/run";
import { getFundDetail, type FundDetail } from "../application/get-fund-detail";
import { listFunds } from "../application/list-funds";
import { NotFoundError } from "../application/errors";
import type { FundSummary } from "../application/summary";
import { runForPrincipal } from "./run";

const DECIMAL = /^(-?)(\d+)(?:\.(\d+))?$/;

function cents(value: string): bigint {
  const match = DECIMAL.exec(value.trim());
  if (!match) throw new Error(`Invalid money value: ${value}`);
  const [, sign, whole, fraction = ""] = match;
  return BigInt(`${sign}${whole}${(fraction + "00").slice(0, 2)}`);
}

function money(value: bigint): string {
  const negative = value < 0n;
  const absolute = (negative ? -value : value).toString().padStart(3, "0");
  return `${negative ? "-" : ""}${absolute.slice(0, -2)}.${absolute.slice(-2)}`;
}

export function totalFundValue(
  summaries: readonly FundSummary[],
): { value: string | null; unvalued: number } {
  const valued = summaries.filter(
    (summary): summary is FundSummary & { value: string } => summary.value !== null,
  );
  const currencies = new Set(valued.map((summary) => summary.fund.currency));
  return {
    value: valued.length === 0 || currencies.size > 1
      ? null
      : money(valued.reduce((sum, summary) => sum + cents(summary.value), 0n)),
    unvalued: summaries.length - valued.length,
  };
}

export function fundValueCurrency(summaries: readonly FundSummary[]): string | null {
  const currencies = new Set(
    summaries.filter((summary) => summary.value !== null).map((summary) => summary.fund.currency),
  );
  return currencies.size === 1 ? [...currencies][0]! : null;
}

export interface FundAccountOption {
  id: string;
  name: string;
  currency: string;
}

export async function loadFundsSummary(): Promise<FundSummary[]> {
  return runForPrincipal((deps, principal) => listFunds(deps)(principal));
}

export async function loadFundDetail(id: string): Promise<FundDetail | null> {
  return runForPrincipal((deps, principal) =>
    getFundDetail(deps)(principal, id).catch((error: unknown) => {
      if (error instanceof NotFoundError) return null;
      throw error;
    }),
  );
}

/** Runs after a funds load has completed, in the accounts module's own user context. */
export async function loadFundAccounts(): Promise<FundAccountOption[]> {
  return runForAccountPrincipal(async (deps, principal) => {
    const rows = await listAccounts(deps)(principal, { months: 1 });
    return rows
      .filter((row) => row.account.status === "active")
      .map((row) => ({
        id: row.account.id,
        name: row.account.name,
        currency: row.account.currency,
      }));
  });
}
