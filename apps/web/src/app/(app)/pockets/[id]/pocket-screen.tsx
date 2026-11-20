"use client";

// One pocket (spec §7.4), read from `/api/v1` (rewrite plan R3): every figure is a field of
// `GET /pockets/{id}` — what is left, to go, the months to the target, after the planned expenses, the
// interest — and the screen formats it.
import { useTranslations } from "next-intl";
import { pockets as pocketRoutes } from "@ledgerly/api-contract/pockets";
import type { RouteOutput } from "@ledgerly/api-client";
import { parseCents } from "@ledgerly/format/cents";
import { formatWholePercent, NULL_DISPLAY } from "@ledgerly/format/format";
import { Card, CardHeader } from "@ledgerly/ui/card";
import { MiniBars } from "@ledgerly/ui/chart";
import { useApi } from "@ledgerly/ui/data";
import { HeroFigure } from "@ledgerly/ui/hero-figure";
import { Loaded } from "@ledgerly/ui/loaded";
import { ProgressBar } from "@ledgerly/ui/progress-bar";
import { Page } from "@ledgerly/ui/shell/page";
import { Stat, StatGrid } from "@ledgerly/ui/stat";
import { type DialogContext, PocketActions, useDialogContext } from "@/modules/pockets/client";
import { ExpensesCard, PlannedCard } from "./pocket-lists";
import { type PocketFormat, pocketFormat } from "./pocket-format";

type Detail = RouteOutput<typeof pocketRoutes.getPocket>;
type Pocket = Detail["pocket"];

const negative = (amount: string) => parseCents(amount) < 0n;

const INTEREST_NOTE = {
  standalone: "detail.interestStandalone",
  estimate: "detail.interestEstimate",
  no_interest_data: "detail.interestUnknown",
} as const;

/** How far the target is: the bar, then what is left to go and when, or that it is reached. */
function Progress({
  pocket,
  context,
  format,
}: {
  pocket: Pocket;
  context: DialogContext;
  format: PocketFormat;
}) {
  const text = useTranslations("pockets");
  if (pocket.target === null)
    return (
      <div className="flex flex-wrap items-center justify-between gap-2 rounded-card border border-dashed border-border2 p-3 text-sm text-muted">
        <span>{text("detail.openEnded")}</span>
      </div>
    );
  const funded = text("detail.funded", {
    percent: formatWholePercent(pocket.percent ?? 0, context.numberFormat),
  });
  const eta =
    pocket.eta === null || pocket.etaMonth === null
      ? text("detail.noEta")
      : text("detail.eta", { months: pocket.eta, month: format.date(pocket.etaMonth, "monthYear") });
  return (
    <div className="flex flex-col gap-1.5">
      <ProgressBar value={(pocket.percent ?? 0) / 100} label={funded} />
      <div className="flex flex-wrap justify-between gap-2 text-sm tabular-nums">
        <span>{funded}</span>
        <span className="text-muted">
          {pocket.eta === 0
            ? text("detail.reached")
            : `${text("detail.toGo", { amount: format.money(pocket.toGo) })} · ${eta}`}
        </span>
      </div>
    </div>
  );
}

/** The five figures under the hero: given, spent, monthly, after the planned expenses, interest. */
function Figures({ pocket, format }: { pocket: Pocket; format: PocketFormat }) {
  const text = useTranslations("pockets");
  const { money } = format;
  return (
    <StatGrid columns={5}>
      <Stat className="gap-0.5" label={text("detail.budget")} value={money(pocket.budget)} />
      <Stat
        className="gap-0.5"
        label={text("detail.spent")}
        value={parseCents(pocket.spent) === 0n ? NULL_DISPLAY : money(pocket.spent)}
        tone={negative(pocket.spent) ? "neg" : undefined}
      />
      <Stat
        className="gap-0.5"
        label={text("detail.monthly")}
        value={pocket.monthly === null ? text("detail.manual") : money(pocket.monthly)}
      />
      <Stat
        className="gap-0.5"
        label={text("detail.afterPlanned")}
        value={pocket.planned.count === 0 ? NULL_DISPLAY : money(pocket.planned.after)}
        tone={negative(pocket.planned.after) ? "neg" : undefined}
      />
      <Stat
        className="gap-0.5"
        label={text("detail.interest")}
        value={money(pocket.interest)}
        note={text(INTEREST_NOTE[pocket.interestReason])}
      />
    </StatGrid>
  );
}

function DetailCard({
  pocket,
  context,
  format,
}: {
  pocket: Pocket;
  context: DialogContext;
  format: PocketFormat;
}) {
  const text = useTranslations("pockets");
  const { money, date } = format;
  const standalone = pocket.accountId === null;
  return (
    <Card className="flex flex-col gap-4" data-testid="pocket-detail">
      <HeroFigure
        caption={`${pocket.name} · ${
          pocket.account ? text("detail.onAccount", { account: pocket.account }) : text("detail.standalone")
        } · ${text("detail.since", { month: date(pocket.startMonth, "monthYear") })}`}
        value={money(pocket.balance)}
        tone={negative(pocket.balance) ? "neg" : undefined}
        note={text("detail.left")}
        aside={{
          label: pocket.target === null ? text("detail.noTargetLabel") : text("detail.target"),
          value: pocket.target === null ? NULL_DISPLAY : money(pocket.target, { decimals: false }),
        }}
      />
      {pocket.state === "paused" && <p className="text-sm text-warn">{text("detail.paused")}</p>}
      <Progress pocket={pocket} context={context} format={format} />
      <Figures pocket={pocket} format={format} />
      <p className="text-sm text-muted">
        {standalone ? text("detail.howStandalone") : text("detail.howBacked")}
      </p>
      <PocketActions place="detail" pocket={pocket} context={context} />
    </Card>
  );
}

function HistoryCard({ detail, format }: { detail: Detail; format: PocketFormat }) {
  const text = useTranslations("pockets");
  const { pocket, history } = detail;
  const { money, date } = format;
  return (
    <Card padded={false} className="min-w-0">
      <CardHeader
        title={text("chart.title")}
        actions={
          <span className="text-sm text-muted">
            {pocket.target === null ? text("chart.noTarget") : text("chart.topIsTarget")}
          </span>
        }
      />
      <div className="px-4 pb-4">
        <MiniBars
          values={history.map((month) => (month.balance === null ? null : Number(month.balance)))}
          labels={history.map((month) => `${date(month.month, "monthShort")} · ${money(month.balance)}`)}
          xLabels={history.map((month) => date(month.month, "month"))}
          target={pocket.target === null ? null : Number(pocket.target)}
          summary={text("chart.summary", { name: pocket.name, value: money(pocket.balance) })}
        />
      </div>
    </Card>
  );
}

/** «Link an expense» opens on the expenses the page has read already, as when the server drew it. */
function ReadCandidates() {
  useApi(pocketRoutes.listPocketCandidates, {});
  return null;
}

function PocketView({ detail, context }: { detail: Detail; context: DialogContext }) {
  const format = pocketFormat(context);
  return (
    <>
      {detail.pocket.accountId === null && <ReadCandidates />}
      <h1 className="text-title font-semibold tracking-title max-md:sr-only">{detail.pocket.name}</h1>
      <DetailCard pocket={detail.pocket} context={context} format={format} />
      <div className="grid items-start gap-4 @4xl:grid-cols-2">
        <HistoryCard detail={detail} format={format} />
        <PlannedCard detail={detail} format={format} />
      </div>
      <ExpensesCard detail={detail} format={format} />
    </>
  );
}

/** A pocket's page; the server has already answered 404 for a pocket that is not open. */
export function PocketScreen({ id }: { id: string }) {
  const text = useTranslations("pockets");
  const read = useApi(pocketRoutes.getPocket, { params: { id } });
  const context = useDialogContext();
  const pocket = read.data?.pocket;
  return (
    <Page
      title={pocket?.name ?? ""}
      parent={{ href: "/pockets", label: text("title") }}
      actions={pocket && context && <PocketActions place="topbar" pocket={pocket} context={context} />}
    >
      <Loaded state={read}>{(detail) => context && <PocketView detail={detail} context={context} />}</Loaded>
    </Page>
  );
}
