import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { BudgetsOverviewCard } from "@/modules/budgets/ui/overview-card";
import { pocketsTotal } from "@ledgerly/domain/pockets";
import { requireSession } from "@/platform/auth/session";
import { monthKey, today } from "@ledgerly/domain/shared/dates";
import { formatMoney } from "@ledgerly/domain/platform/format";
import { KpiTile } from "@ledgerly/ui/kpi-tile";
import { OverviewScreen } from "./overview-screen";

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getTranslations("overview"))("title") };
}

/**
 * Overview: the accounts and the net worth come from `/api/v1` in the client screen. The pockets
 * tile and the budgets card belong to modules not on the API yet, so they are still drawn here.
 */
export default async function OverviewPage() {
  const ctx = await requireSession();
  const tp = await getTranslations("pockets");
  const pockets = await pocketsTotal(ctx);
  return (
    <OverviewScreen
      pockets={
        // The fourth tile of the design, deferred by F1 until pockets existed (F3).
        <KpiTile
          label={tp("overview.label")}
          value={formatMoney(pockets.totalCents, ctx.numberFormat)}
          delta={tp("overview.perMonth", {
            amount: formatMoney(pockets.monthlyCents, ctx.numberFormat, { decimals: false }),
          })}
          deltaTone="pos"
          note={tp("kpis.count", { count: pockets.count })}
        />
      }
      budgets={<BudgetsOverviewCard ctx={ctx} month={monthKey(today(ctx.timeZone))} />}
    />
  );
}
