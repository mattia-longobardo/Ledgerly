// The port of the daily prices (rewrite plan R5d): a source the module asks for closes. The adapter
// is a plugin with `prices.daily` (`plugin-host`); `apps/worker` connects the two.
import type { CivilDate } from "../../shared/dates";

export interface PriceRequest {
  listings: { key: string; ticker: string; mic: string; currency: string }[];
  from: CivilDate;
  to: CivilDate;
}

export interface PriceAnswer {
  bars: { key: string; on: string; close: string; currency: string }[];
  errors: { key: string; code: "unknown_symbol" | "no_data" | "rate_limited" | "provider_down" }[];
}

export interface PriceSource {
  /** The plugin's id: what `source` says on each price. */
  id: string;
  closes(request: PriceRequest): Promise<PriceAnswer>;
}
