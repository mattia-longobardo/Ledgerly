// scripts/investments-cutoff.ts — the 12 months of every synced investment service, settled now
// (PERS-145): what the next sync pass would do anyway (`settleCutoff`), run once at the deploy so the
// numbers are right before the first pass. Only services connected new are touched: a Wallet manager
// account, a handover or a manual service is skipped by `settleCutoff` itself. Idempotent.
//
// Usage (on the homelab, after the deploy): sh scripts/on-homelab.sh scripts/investments-cutoff.ts
import { and, asc, eq, ne } from "drizzle-orm";
import { accounts } from "../src/modules/accounts/schema";
import { investmentAccounts } from "../src/modules/investments/schema";
import { settleCutoff } from "../src/modules/investments/sync";
import { userPreferences } from "../src/modules/users/schema";
import { getDb } from "../src/platform/db/client";

const rows = await getDb()
  .select({
    userId: investmentAccounts.userId,
    accountId: investmentAccounts.accountId,
    provider: investmentAccounts.provider,
    name: accounts.name,
    timeZone: userPreferences.timeZone,
  })
  .from(investmentAccounts)
  .innerJoin(accounts, eq(accounts.id, investmentAccounts.accountId))
  .leftJoin(userPreferences, eq(userPreferences.userId, investmentAccounts.userId))
  .where(and(ne(investmentAccounts.provider, "manual")))
  .orderBy(asc(investmentAccounts.userId), asc(investmentAccounts.accountId));

for (const row of rows) {
  const settled = await settleCutoff(
    { userId: row.userId, timeZone: row.timeZone ?? "Europe/Rome" },
    row.accountId,
  );
  console.log(
    `[cutoff] ${row.provider} ${row.accountId}: cutoff=${settled.cutoff ?? "none"} events=${settled.events} readings=${settled.readings} holdings=${settled.holdings} opening=${settled.openingCents ?? "-"} gaps=${settled.gaps}`,
  );
}
process.exit(0);
