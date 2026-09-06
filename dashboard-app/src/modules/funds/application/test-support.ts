import type { AuditInput } from "@/platform/audit/record";
import { testPrincipal } from "@/test/principal";
import {
  MemoryContributionsRepository,
  MemoryFundsRepository,
  MemoryIssuesRepository,
  MemoryPlansRepository,
  MemorySchedulesRepository,
} from "../infrastructure/memory-repositories";
import type { Fund, UseCaseDeps } from "./ports";

export function fundHarness() {
  const audits: AuditInput[] = [];
  const accountLinks = new Map<string, { currency: string }>();
  const latest = new Map<string, { asOf: string; balance: string }>();
  const monthly = new Map<string, { month: string; balance: string }[]>();
  const expectedBySlug = new Map<string, string[]>();
  const records: { id: string; month: string }[] = [];
  const funds = new MemoryFundsRepository();
  let locks = 0;
  const originalLock = funds.lock.bind(funds);
  funds.lock = async (userId, id) => {
    locks += 1;
    return originalLock(userId, id);
  };

  const deps = {
    accountLinks: {
      get: async (userId: string, accountId: string) => accountLinks.get(`${userId}:${accountId}`) ?? null,
    },
    funds,
    schedules: new MemorySchedulesRepository(),
    plans: new MemoryPlansRepository(),
    contributions: new MemoryContributionsRepository(),
    issues: new MemoryIssuesRepository(),
    valuations: {
      latest: async (_userId: string, accountId: string) => latest.get(accountId) ?? null,
      monthly: async (_userId: string, accountId: string) => monthly.get(accountId) ?? [],
    },
    payrollMonths: {
      liveMonths: async () => [...new Set(records.map((row) => row.month))],
      liveRecords: async (_userId: string, includeExtraordinary = false) => includeExtraordinary ? [...records] : [...records],
      expectedMonths: async (_userId: string, fundSlug: string) => expectedBySlug.get(fundSlug) ?? [],
    },
    clock: { now: () => new Date("2026-09-06T10:00:00Z") },
    audit: async (event: AuditInput) => { audits.push(event); },
  };

  return {
    deps: deps as UseCaseDeps,
    audits,
    accountLinks,
    latest,
    monthly,
    expectedBySlug,
    records,
    lockCount: () => locks,
  };
}

export async function seedFund(deps: UseCaseDeps, overrides: Partial<Fund> = {}): Promise<Fund> {
  const principal = testPrincipal();
  return deps.funds.create({
    userId: overrides.userId ?? principal.userId,
    slug: overrides.slug ?? "cometa",
    name: overrides.name ?? "Cometa",
    kind: overrides.kind ?? "pension",
    currency: overrides.currency ?? "EUR",
    accountId: overrides.accountId ?? null,
  });
}
