"use client";

// A service's Overview (docs/design/investments-ux.md §3.3, U3): the P&L of the period — the very number
// of its row on the home — then how far it can be trusted, its parts, the chart, the main positions and
// the latest activity. The diagnostics live in Connection, never here. One read: the service's own.
import { cn } from "@ledgerly/ui/cn";
import type { ServicePage } from "../service/service-view";
import { OverviewChart, type ServiceView } from "./overview-chart";
import { OverviewHero, PartialStrip } from "./overview-hero";
import { ManualKpis, ServiceKpis } from "./overview-kpis";
import { LatestActivity, TopContributions } from "./overview-lists";

const VIEWS = ["return", "value"] as const;

export function OverviewTab({ page }: { page: ServicePage }) {
  const view: ServiceView = VIEWS.find((key) => key === page.search.get("view")) ?? "pnl";
  const { service, pnl } = page.overview;
  // A manual service (PERS-335): its value against the money put in, never a per-asset split.
  const manual = service.manualPnl;
  return (
    <>
      <OverviewHero page={page} />
      <PartialStrip page={page} />
      {manual && <ManualKpis page={page} manual={manual} />}
      {pnl.local && !manual && <ServiceKpis page={page} parts={pnl.local} />}
      <OverviewChart page={page} view={view} />
      <div className={cn("grid items-start gap-4", !manual && "@4xl:grid-cols-2")}>
        {!manual && <TopContributions page={page} />}
        <LatestActivity page={page} />
      </div>
    </>
  );
}
