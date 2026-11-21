// What the parts of a service's Positions share (§3.4, U4): the answer of
// `GET /investments/{accountId}/positions` for the period, its assets, and the words of a row.
import type { RouteOutput } from "@ledgerly/api-client";
import type { investments } from "@ledgerly/api-contract/investments";
import type { ServicePage } from "../service/service-view";

type Positions = RouteOutput<typeof investments.getInvestmentPositions>;
export type OpenRow = Positions["open"]["rows"][number];
export type ClosedGroup = Positions["closedEver"]["groups"][number];
type Asset = Positions["assets"][number];

export interface PositionsPage {
  page: ServicePage;
  positions: Positions;
  assetOf: (assetId: string | null) => Asset | undefined;
  /** The period ended before today: its positions are those of its last day, without commands. */
  past: boolean;
  /** «2025» for a year, null otherwise. */
  short: string | null;
}

export function positionsPage(page: ServicePage, positions: Positions): PositionsPage {
  const assets = new Map(positions.assets.map((asset) => [asset.id, asset]));
  const { period } = positions;
  return {
    page,
    positions,
    assetOf: (assetId) => (assetId === null ? undefined : assets.get(assetId)),
    past: period.to < positions.on,
    short: period.kind === "year" ? String(period.year) : null,
  };
}
