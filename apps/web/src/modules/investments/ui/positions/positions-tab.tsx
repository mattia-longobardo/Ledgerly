"use client";

// A service's Positions (docs/design/investments-ux.md §3.4, U4): the positions open on the period's last
// day with what they added to it, the ones the period closed, every close ever, and the contributions of
// all of them closing on the Overview's P&L to the cent (PERS-113). A past period shows its positions
// on its last day; today's are a link. Read from `GET /investments/{accountId}/positions`.
import { useTranslations } from "next-intl";
import { useEffect } from "react";
import { investments } from "@ledgerly/api-contract/investments";
import { formatDate } from "@ledgerly/format/format";
import { useApi, useLatest } from "@ledgerly/ui/data";
import { LinkTabs } from "@ledgerly/ui/link-controls";
import { Loaded } from "@ledgerly/ui/loaded";
import { Link, useRouter } from "@ledgerly/ui/router";
import { withParams } from "@ledgerly/ui/url";
import type { ServicePage } from "../service/service-view";
import { ClosedPositions } from "./closed-positions";
import { ContributionsCard } from "./contributions-card";
import { OpenPositions } from "./open-positions";
import { type PositionsPage, positionsPage } from "./positions-view";

const STATUSES = ["closed", "all"] as const;

function PositionsView({ view }: { view: PositionsPage }) {
  const text = useTranslations("investments.positions");
  const { page, positions, past, short } = view;
  const status = STATUSES.find((key) => key === page.search.get("status")) ?? "open";
  const grouping = page.search.get("by") === "class" ? "class" : "asset";
  const options = [
    {
      value: "open",
      label: past
        ? text("openAt", { date: formatDate(positions.period.to, "dayMonth", page.say.locale) })
        : text("open"),
      count: positions.open.rows.length,
    },
    {
      value: "closed",
      label: short ? text("closedIn", { period: short }) : text("closedInPeriod"),
      count: positions.closedInPeriod.groups.length,
    },
    { value: "all", label: text("all"), count: positions.closedEver.groups.length },
  ];
  return (
    <>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <LinkTabs
          label={text("status")}
          path={`/investments/${page.id}/positions`}
          params={{ ...page.section.params }}
          name="status"
          current={status}
          options={options}
        />
        {past && status === "open" && (
          <Link
            href={withParams(`/investments/${page.id}/positions`, {}, { status: "open" })}
            className="focus-ring inline-flex min-h-6 items-center rounded-sm text-sm text-accent hover:underline"
          >
            {text("today")} →
          </Link>
        )}
      </div>
      {positions.status === "undetermined" && (
        <p className="text-sm text-warn">{text("undetermined", { period: page.name })}</p>
      )}
      {status === "open" ? (
        <OpenPositions view={view} grouping={grouping} />
      ) : (
        <ClosedPositions view={view} all={status === "all"} />
      )}
      {positions.contributions && <ContributionsCard view={view} contributions={positions.contributions} />}
    </>
  );
}

function PositionsRead({ page }: { page: ServicePage }) {
  const read = useLatest(
    useApi(investments.getInvestmentPositions, { params: { accountId: page.id }, query: page.section.api }),
  );
  return (
    <Loaded state={read}>{(positions) => <PositionsView view={positionsPage(page, positions)} />}</Loaded>
  );
}

/** A manual service keeps no positions (PERS-335): its value and P&L are on the Overview. */
function ToOverview({ page }: { page: ServicePage }) {
  const router = useRouter();
  const overview = page.href("overview");
  useEffect(() => router.replace(overview), [router, overview]);
  return null;
}

export function PositionsTab({ page }: { page: ServicePage }) {
  if (page.overview.service.origin === "manual") return <ToOverview page={page} />;
  return <PositionsRead page={page} />;
}
