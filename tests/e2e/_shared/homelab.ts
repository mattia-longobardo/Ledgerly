// tests/e2e/_shared/homelab.ts — runs the seed next to the deployed site, where its database is reachable.
import { execFileSync } from "node:child_process";
import { SITE_USERS } from "./env";

/**
 * `scripts/seed-e2e.ts <mode>` through `scripts/on-homelab.sh`: on the homelab's internal network,
 * with the application's own environment, since the sessions it writes must be signed with the
 * deployed site's secret and the users must land in the site's database. The site gets only the
 * users its tests need (SITE_USERS).
 */
export function runSeed(mode: "seed" | "remove"): void {
  const args = mode === "seed" ? ["seed", "--only", SITE_USERS.join(",")] : ["remove"];
  execFileSync("sh", ["scripts/on-homelab.sh", "scripts/seed-e2e.ts", ...args], { stdio: "inherit" });
}
