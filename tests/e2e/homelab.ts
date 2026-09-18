// tests/e2e/homelab.ts — runs the seed next to the deployed site, where its database is reachable.
import { execFileSync } from "node:child_process";

/**
 * `scripts/seed-e2e.ts <mode>` through `scripts/on-homelab.sh`: on the homelab's internal network,
 * with the application's own environment, since the sessions it writes must be signed with the
 * deployed site's secret and the users must land in the site's database.
 */
export function runSeed(mode: "seed" | "remove"): void {
  execFileSync("sh", ["scripts/on-homelab.sh", "scripts/seed-e2e.ts", mode], { stdio: "inherit" });
}
