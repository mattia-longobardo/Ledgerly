import { registerJob } from "./registry";
import { runSweep } from "@/lib/jobs/sweep";
import { runTrekSyncJob } from "@/lib/jobs/trek-sync-job";
import { runWalletRefresh } from "@/lib/jobs/wallet-refresh";
import { runWalletAccountsSync } from "@/lib/jobs/wallet-accounts-sync";
import { runMonthlySnapshot } from "@/lib/jobs/monthly-snapshot";

let done = false;

export function ensureJobsRegistered(): void {
  if (done) return;
  done = true;
  registerJob({ name: "sweep", tier: "hourly", run: (i) => runSweep({ trigger: i.trigger, now: i.now }) });
  registerJob({ name: "trek_sync", tier: "hourly", run: (i) => runTrekSyncJob({ trigger: i.trigger }) });
  registerJob({ name: "wallet_refresh", tier: "daily", run: (i) => runWalletRefresh({ trigger: i.trigger, now: i.now }) });
  registerJob({ name: "wallet_accounts_sync", tier: "daily", run: (i) => runWalletAccountsSync({ trigger: i.trigger }) });
  registerJob({ name: "monthly_snapshot", tier: "monthly", run: (i) => runMonthlySnapshot({ trigger: i.trigger }) });
}
