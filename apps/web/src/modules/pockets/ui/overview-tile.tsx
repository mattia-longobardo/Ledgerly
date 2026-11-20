"use client";

import { useTranslations } from "next-intl";
import { pockets } from "@ledgerly/api-contract/pockets";
import { parseCents } from "@ledgerly/format/cents";
import { formatMoney, type NumberFormat } from "@ledgerly/format/format";
import { useApi } from "@ledgerly/ui/data";
import { KpiTile } from "@ledgerly/ui/kpi-tile";
import { Loaded } from "@ledgerly/ui/loaded";

/** Overview's fourth tile (design, F3): what the open pockets have left, from `GET /pockets/overview`. */
export function PocketsOverviewTile({ numberFormat }: { numberFormat: NumberFormat }) {
  const text = useTranslations("pockets");
  const read = useApi(pockets.getPocketsOverview, {});
  return (
    <Loaded state={read}>
      {(tile) => (
        <KpiTile
          label={text("overview.label")}
          value={formatMoney(parseCents(tile.total), numberFormat)}
          delta={text("overview.perMonth", {
            amount: formatMoney(parseCents(tile.monthly), numberFormat, { decimals: false }),
          })}
          deltaTone="pos"
          note={text("kpis.count", { count: tile.count })}
        />
      )}
    </Loaded>
  );
}
