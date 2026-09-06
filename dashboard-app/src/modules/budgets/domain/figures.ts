// Money as decimal strings; dates "YYYY-MM-DD"; months "YYYY-MM-01".

export interface AmountVersionLike {
  initialAmount: string;
  effectiveFrom: string;
}

export interface AllocationLike {
  id: string;
  amount: string;
  recurrence: "once" | "monthly";
  effectiveFrom: string;
  effectiveTo: string | null;
  sourceKind: "fund" | "account" | "none";
  sourceId: string | null;
}

export interface UsageLike {
  amount: string;
  occurredAt: string;
}

export interface BudgetFigures {
  initial: string;
  allocated: string;
  used: string;
  remaining: string;
  goalProgress: number | null;
}

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

/** Calendar months between two "YYYY-MM-DD" dates, counting both partial end months as one each. 0 when through < from. */
export function monthsInclusive(from: string, through: string): number {
  if (through < from) return 0;
  const fromYear = Number(from.slice(0, 4));
  const fromMonth = Number(from.slice(5, 7));
  const throughYear = Number(through.slice(0, 4));
  const throughMonth = Number(through.slice(5, 7));
  return (throughYear - fromYear) * 12 + (throughMonth - fromMonth) + 1;
}

export function initialAt(versions: readonly AmountVersionLike[], asOf: string): string {
  let current: AmountVersionLike | null = null;
  for (const version of versions) {
    if (version.effectiveFrom > asOf) continue;
    if (current === null || version.effectiveFrom > current.effectiveFrom) current = version;
  }
  return current === null ? "0.00" : current.initialAmount;
}

/** R6-2: a monthly allocation contributes amount × months from effectiveFrom through min(effectiveTo, asOf). */
export function allocatedThrough(allocations: readonly AllocationLike[], asOf: string): string {
  const total = allocations.reduce((sum, allocation) => {
    if (allocation.effectiveFrom > asOf) return sum;
    const amount = cents(allocation.amount);
    if (allocation.recurrence === "once") return sum + amount;
    const through = allocation.effectiveTo !== null && allocation.effectiveTo < asOf
      ? allocation.effectiveTo
      : asOf;
    const months = monthsInclusive(allocation.effectiveFrom, through);
    return sum + amount * BigInt(months);
  }, 0n);
  return formatCents(total);
}

export function usedThrough(usages: readonly UsageLike[], asOf: string): string {
  const total = usages.reduce(
    (sum, usage) => (usage.occurredAt <= asOf ? sum + cents(usage.amount) : sum),
    0n,
  );
  return formatCents(total);
}

/** remaining = initial + allocated − used; goalProgress = remaining ÷ goal, rounded to 4 decimals, null when goalAmount is null or zero. */
export function figures(
  input: {
    versions: readonly AmountVersionLike[];
    allocations: readonly AllocationLike[];
    usages: readonly UsageLike[];
    goalAmount: string | null;
  },
  asOf: string,
): BudgetFigures {
  const initial = initialAt(input.versions, asOf);
  const allocated = allocatedThrough(input.allocations, asOf);
  const used = usedThrough(input.usages, asOf);
  const remaining = formatCents(cents(initial) + cents(allocated) - cents(used));

  let goalProgress: number | null = null;
  if (input.goalAmount !== null) {
    const goalCents = cents(input.goalAmount);
    if (goalCents !== 0n) {
      const ratio = Number(cents(remaining)) / Number(goalCents);
      goalProgress = Math.round(ratio * 10000) / 10000;
    }
  }

  return { initial, allocated, used, remaining, goalProgress };
}

/** balance − allocatedThrough(allocationsAgainstSource); null when balance is null. */
export function availableInSource(
  balance: string | null,
  allocationsAgainstSource: readonly AllocationLike[],
  asOf: string,
): string | null {
  if (balance === null) return null;
  const allocated = allocatedThrough(allocationsAgainstSource, asOf);
  return formatCents(cents(balance) - cents(allocated));
}
