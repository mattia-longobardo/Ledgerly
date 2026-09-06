import type { DbClient } from "@/lib/db/client";
import { recordAudit } from "@/platform/audit/record";
import type { UseCaseDeps } from "../application/ports";
import { drizzleAccountLinkSource } from "./account-link-source";
import { drizzleAccountValuationSource } from "./account-valuation-source";
import { DrizzleContributionsRepository } from "./drizzle-contributions-repository";
import { DrizzleFundsRepository } from "./drizzle-funds-repository";
import { DrizzleIssuesRepository } from "./drizzle-issues-repository";
import { DrizzlePlansRepository, DrizzleSchedulesRepository } from "./drizzle-schedules-plans-repository";
import { drizzlePayrollMonthsSource } from "./payroll-months-source";

export function fundDeps(tx: DbClient, requestId?: string | null): UseCaseDeps {
  return {
    accountLinks: drizzleAccountLinkSource(tx),
    funds: new DrizzleFundsRepository(tx),
    schedules: new DrizzleSchedulesRepository(tx),
    plans: new DrizzlePlansRepository(tx),
    contributions: new DrizzleContributionsRepository(tx),
    issues: new DrizzleIssuesRepository(tx),
    valuations: drizzleAccountValuationSource(tx),
    payrollMonths: drizzlePayrollMonthsSource(tx),
    clock: { now: () => new Date() },
    audit: (event) => recordAudit(tx, { ...event, requestId: requestId ?? null }),
  };
}
