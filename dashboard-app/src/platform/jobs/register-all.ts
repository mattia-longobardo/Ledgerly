import { registerJob } from "./registry";
import { runSweep } from "@/lib/jobs/sweep";
import { runSyncQueue } from "@/lib/jobs/sync-queue";
import { runTrekSyncJob } from "@/lib/jobs/trek-sync-job";
import { runWalletRefresh } from "@/lib/jobs/wallet-refresh";
import { runWalletAccountsSync } from "@/lib/jobs/wallet-accounts-sync";
import { runWalletTransactionsSync } from "@/lib/jobs/wallet-transactions-sync";
import { runMonthlyClose } from "@/lib/jobs/monthly-close";

let done = false;

export function ensureJobsRegistered(): void {
  if (done) return;
  done = true;
  registerJob({ name: "sweep", tier: "hourly", run: (i) => runSweep({ trigger: i.trigger, now: i.now }) });
  registerJob({ name: "trek_sync", tier: "hourly", run: (i) => runTrekSyncJob({ trigger: i.trigger }) });
  registerJob({ name: "wallet_refresh", tier: "daily", run: (i) => runWalletRefresh({ trigger: i.trigger, now: i.now }) });
  registerJob({ name: "wallet_accounts_sync", tier: "daily", run: (i) => runWalletAccountsSync({ trigger: i.trigger }) });
  // Same "hourly" tier as `transactionsSync.schedule` in `wallet-provider-adapter.ts`.
  registerJob({ name: "wallet_transactions_sync", tier: "hourly", run: (i) => runWalletTransactionsSync({ trigger: i.trigger }) });
  registerJob({ name: "monthly_close", tier: "monthly", run: (i) => runMonthlyClose({ trigger: i.trigger, now: i.now }) });
  registerJob({ name: "sync_queue", tier: "hourly", run: (i) => runSyncQueue({ trigger: i.trigger }) });
}
