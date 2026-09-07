import { registerJob } from "./registry";
import { runSweep } from "@/lib/jobs/sweep";
import { runSyncQueue } from "@/lib/jobs/sync-queue";
import { runTrekSyncJob } from "@/lib/jobs/trek-sync-job";
import { runWalletAccountsSync } from "@/lib/jobs/wallet-accounts-sync";
import { runWalletTransactionsSync } from "@/lib/jobs/wallet-transactions-sync";
import { runMonthlyClose } from "@/lib/jobs/monthly-close";
import { runInterestAccrualJob } from "@/lib/jobs/interest-accrual";
import { runPayrollIngestJob } from "@/lib/jobs/payroll-ingest";
import { runPayrollRetentionJob } from "@/lib/jobs/payroll-retention";

let done = false;

export function ensureJobsRegistered(): void {
  if (done) return;
  done = true;
  registerJob({ name: "sweep", tier: "hourly", run: (i) => runSweep({ trigger: i.trigger, now: i.now }) });
  registerJob({ name: "trek_sync", tier: "hourly", run: (i) => runTrekSyncJob({ trigger: i.trigger }) });
  registerJob({ name: "wallet_accounts_sync", tier: "daily", run: (i) => runWalletAccountsSync({ trigger: i.trigger }) });
  // Same "hourly" tier as `transactionsSync.schedule` in `wallet-provider-adapter.ts`.
  registerJob({ name: "wallet_transactions_sync", tier: "hourly", run: (i) => runWalletTransactionsSync({ trigger: i.trigger }) });
  registerJob({ name: "monthly_close", tier: "monthly", run: (i) => runMonthlyClose({ trigger: i.trigger, now: i.now }) });
  registerJob({ name: "sync_queue", tier: "hourly", run: (i) => runSyncQueue({ trigger: i.trigger }) });
  registerJob({ name: "interest_accrual", tier: "daily", run: (i) => runInterestAccrualJob({ trigger: i.trigger, now: i.now }) });
  // Hourly: an uploaded payslip should be reviewable within the hour, and a
  // clamd outage is retried on the next tick rather than the next day.
  registerJob({ name: "payroll_ingest", tier: "hourly", run: (i) => runPayrollIngestJob({ trigger: i.trigger, now: i.now }) });
  // Daily (Ruling R4-5): capped at 100 objects a run, so a misconfigured
  // retention window gives a human a day to notice.
  registerJob({ name: "payroll_retention", tier: "daily", run: (i) => runPayrollRetentionJob({ trigger: i.trigger, now: i.now }) });
}
