import { listAccounts } from "@/modules/accounts/application/list-accounts";
import { runForPrincipal as runForAccountPrincipal } from "@/modules/accounts/ui/run";
import { listCategories } from "@/modules/expenses/application/list-categories";
import { listLabels } from "@/modules/expenses/application/list-labels";
import { runForPrincipal as runForExpensePrincipal } from "@/modules/expenses/ui/run";
import { listFunds } from "@/modules/funds/application/list-funds";
import { runForPrincipal as runForFundPrincipal } from "@/modules/funds/ui/run";
import { NotFoundError } from "../application/errors";
import { getBudgetDetail } from "../application/get-budget-detail";
import type { BudgetDetail } from "../application/get-budget-detail";
import { listBudgets } from "../application/list-budgets";
import type { BudgetSummary } from "../application/list-budgets";
import { runForPrincipal } from "./run";

export type { BudgetSummary } from "../application/list-budgets";
export type { AllocationView, BudgetDetail } from "../application/get-budget-detail";

const DECIMAL_RE = /^(-?)(\d+)(?:\.(\d+))?$/;

function cents(value: string): bigint {
  const match = DECIMAL_RE.exec(value.trim());
  if (!match) throw new Error(`not a decimal: ${value}`);
  const [, sign, integer, fraction = ""] = match;
  return BigInt(`${sign}${integer}${(fraction + "00").slice(0, 2)}`);
}

function formatCents(value: bigint): string {
  const negative = value < 0n;
  const absolute = (negative ? -value : value).toString().padStart(3, "0");
  return `${negative ? "-" : ""}${absolute.slice(0, -2)}.${absolute.slice(-2)}`;
}

/** Every budget page load: all of the user's budgets, active and archived, so the list can show status per row. */
export async function loadBudgets(): Promise<BudgetSummary[]> {
  return runForPrincipal((deps, principal) => listBudgets(deps)(principal, { includeArchived: true }));
}

/**
 * Only a missing budget renders as "not found" — anything else (a database
 * failure, a permission edge, a bug in the use case) is a real error and
 * must surface as one, mirroring `loadTransactionDetail` and
 * `loadInterestRuleDetail`.
 */
export async function loadBudgetDetail(id: string): Promise<BudgetDetail | null> {
  return runForPrincipal((deps, principal) =>
    getBudgetDetail(deps)(principal, id).catch((error: unknown) => {
      if (error instanceof NotFoundError) return null;
      throw error;
    }),
  );
}

export interface ActiveBudgetsCard {
  count: number;
  /** Null when there are no active budgets, or their currencies don't agree — never a fabricated sum. */
  remaining: string | null;
}

/**
 * Pure by design (§ conventions: `.test.tsx` never runs, so this is the seam
 * the Home card's logic is actually tested through). Only `status ===
 * "active"` budgets count, mirroring `totalFundValue`'s currency-mismatch
 * handling in the funds module: a single sum across mixed currencies would
 * be a fabricated figure, so it renders `null` instead.
 */
export function activeBudgetsCard(
  summaries: readonly Pick<BudgetSummary, "budget" | "figures">[],
): ActiveBudgetsCard {
  const active = summaries.filter((summary) => summary.budget.status === "active");
  const currencies = new Set(active.map((summary) => summary.budget.currency));
  return {
    count: active.length,
    remaining:
      active.length === 0 || currencies.size > 1
        ? null
        : formatCents(active.reduce((sum, summary) => sum + cents(summary.figures.remaining), 0n)),
  };
}

export interface OptionRow {
  id: string;
  name: string;
}

/**
 * Budgets has no accounts repository of its own, so this opens the accounts
 * module's own context via its own `runForPrincipal` — never nested inside
 * this module's `runForPrincipal`, always called as a sibling await.
 */
export async function loadBudgetAccounts(): Promise<OptionRow[]> {
  return runForAccountPrincipal(async (deps, principal) => {
    const rows = await listAccounts(deps)(principal, { months: 1 });
    return rows
      .filter((row) => row.account.status === "active")
      .map((row) => ({ id: row.account.id, name: row.account.name }));
  });
}

export async function loadBudgetFunds(): Promise<OptionRow[]> {
  return runForFundPrincipal(async (deps, principal) => {
    const funds = await listFunds(deps)(principal);
    return funds.map((summary) => ({ id: summary.fund.id, name: summary.fund.name }));
  });
}

export async function loadBudgetCategories(): Promise<OptionRow[]> {
  return runForExpensePrincipal(async (deps, principal) => {
    const categories = await listCategories(deps)(principal);
    return categories.map((category) => ({ id: category.id, name: category.name }));
  });
}

export async function loadBudgetLabels(): Promise<OptionRow[]> {
  return runForExpensePrincipal(async (deps, principal) => {
    const labels = await listLabels(deps)(principal);
    return labels.map((label) => ({ id: label.id, name: label.name }));
  });
}
