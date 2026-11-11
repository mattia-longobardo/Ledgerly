import { eq } from "drizzle-orm";
import { getDb } from "@/platform/db/client";
import type { Ctx } from "@/platform/context";
import { createManualService, type ManualServiceInput } from "@/modules/investments/service";
import { investmentAccountPeriods, investmentAccounts } from "@/modules/investments/schema";

/**
 * A service whose book keeps positions, for the tests of the per-asset engine. The app creates a
 * manual service only as value-only (PERS-335); the engine still values positions for the synced
 * services and for the periods written before, so its tests open a manual service and turn its
 * first period to `assets` — or a test turns it to `synced` afterwards, as a provider would.
 */
export async function assetsService(ctx: Ctx, input: ManualServiceInput): Promise<{ accountId: string }> {
  const created = await createManualService(ctx, input);
  const [investment] = await getDb()
    .select({ id: investmentAccounts.id })
    .from(investmentAccounts)
    .where(eq(investmentAccounts.accountId, created.accountId));
  await getDb()
    .update(investmentAccountPeriods)
    .set({ mode: "assets" })
    .where(eq(investmentAccountPeriods.investmentAccountId, investment.id));
  return created;
}
