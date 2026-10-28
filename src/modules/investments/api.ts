import "server-only";
import { Hono } from "hono";
import { z } from "zod";
import type { ApiEnv } from "@/platform/api/auth";
import { withToken } from "@/platform/api/auth";
import { fail } from "@/platform/api/errors";
import { instant, money } from "@/platform/api/json";
import type { CivilDate } from "@/platform/dates";
import {
  type HoldingRow,
  investmentsPortfolio,
  type Portfolio,
  serviceHoldings,
  type ServiceSummary,
} from "./queries";
import type { Xirr } from "./xirr";

/**
 * Investments on `/api/v1` and on the MCP (docs/design/investments.md §5.5, SEC-08), behind the
 * scope `investments:read` and never `read`. The answers are built here, field by field, from the
 * module's own queries — the same numbers the screen shows — and carry nothing of a connection:
 * no key, no key check, no `last_error`, no provider's external id, no state of the sync.
 *
 * Money is a decimal string, as everywhere on the API; a return is a ratio (0.05 = 5 %).
 */
export const investmentsApi = new Hono<ApiEnv>();

/** Why a return is missing: no value or no complete history, or XIRR has no single solution. */
type XirrStatus = "ok" | "no_solution" | "multiple_solutions" | "unavailable";

function ratio(value: number | null): number | null {
  return value === null || !Number.isFinite(value) ? null : Number(value.toFixed(6));
}

function xirrJson(result: Xirr | null): { xirr: number | null; xirrStatus: XirrStatus } {
  if (result === null) return { xirr: null, xirrStatus: "unavailable" };
  if (result.status === "ok") return { xirr: ratio(result.rate), xirrStatus: "ok" };
  return { xirr: null, xirrStatus: result.status === "none" ? "no_solution" : "multiple_solutions" };
}

function civil(at: Date | null): CivilDate | null {
  return at ? instant(at)!.slice(0, 10) : null;
}

export function serviceJson(one: ServiceSummary) {
  return {
    accountId: one.account.id,
    name: one.account.name,
    category: one.investment.category,
    provider: one.investment.provider,
    origin: one.origin,
    mode: one.mode,
    currency: one.account.currency,
    value: money(one.valueCents),
    displayValue: money(one.displayCents),
    change30Days: money(one.change30Cents),
    invested: money(one.performance.investedCents),
    gain: money(one.performance.gainCents),
    simpleReturn: ratio(one.performance.simpleReturn),
    ...xirrJson(one.xirr),
    reliable: one.reliable,
    reliableFrom: civil(one.reliableFrom),
    weight: ratio(one.weight),
    lastUpdate: one.lastUpdate,
  };
}

export function portfolioJson(portfolio: Portfolio) {
  const { totals } = portfolio;
  return {
    on: portfolio.todayOn,
    currency: portfolio.currency,
    totals: {
      value: money(totals.valueCents),
      valuePartial: totals.partial,
      invested: money(totals.investedCents),
      gain: money(totals.gainCents),
      simpleReturn: ratio(totals.simpleReturn),
      ...xirrJson(totals.xirr),
      includesExchangeEffect: totals.fxEffect,
    },
    services: portfolio.services.map(serviceJson),
  };
}

export function holdingJson(row: HoldingRow) {
  return {
    asset: {
      name: row.asset.name,
      class: row.asset.class,
      symbol: row.asset.symbol,
      isin: row.asset.isin,
      currency: row.asset.currency,
    },
    product: row.product,
    origin: row.origin,
    quantity: row.quantityText,
    unitPrice: row.priceText,
    priceCurrency: row.state.priceCurrency,
    pricedOn: row.state.pricedOn,
    value: money(row.state.valueCents),
    gain: money(row.gainCents),
    weight: ratio(row.weight),
    conflict: row.conflict,
  };
}

export function holdingsJson(view: NonNullable<Awaited<ReturnType<typeof serviceHoldings>>>) {
  return {
    accountId: view.account.id,
    name: view.account.name,
    currency: view.currency,
    on: view.on,
    holdings: view.holdings.map(holdingJson),
  };
}

investmentsApi.get("/investments", withToken("investments:read"), async (c) => {
  return c.json(portfolioJson(await investmentsPortfolio(c.get("ctx"))));
});

investmentsApi.get("/investments/:accountId/holdings", withToken("investments:read"), async (c) => {
  const id = z.uuid().safeParse(c.req.param("accountId"));
  if (!id.success) return fail(c, "invalid");
  // Another person's service is `not_found`, as on the screen: every query underneath is scoped.
  const view = await serviceHoldings(c.get("ctx"), id.data);
  if (!view) return fail(c, "not_found");
  return c.json(holdingsJson(view));
});
