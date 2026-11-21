"use client";

// The main contributions to the period, open or sold (§3.3, PERS-113 · 9), and the latest events of the
// period with what a sale realized (§3.5). Rows of `GET /investments/{accountId}`.
import { useTranslations } from "next-intl";
import { formatDate } from "@ledgerly/format/format";
import { Card, CardHeader } from "@ledgerly/ui/card";
import { cn } from "@ledgerly/ui/cn";
import { Link } from "@ledgerly/ui/router";
import { TONE_TEXT, toneOfSign } from "@ledgerly/ui/tone";
import { useEventText } from "../event-text";
import { centsOf } from "../present";
import type { ServicePage } from "../service/service-view";

type Contribution = NonNullable<ServicePage["overview"]["contributions"]>["rows"][number];

function CardLink({ href, label }: { href: string; label: string }) {
  return (
    <Link
      href={href}
      className="focus-ring inline-flex min-h-6 items-center rounded-sm text-sm text-accent hover:underline"
    >
      {label} →
    </Link>
  );
}

function stateOf(text: ReturnType<typeof useTranslations<"investments">>, row: Contribution): string {
  if (row.costUnknown) return text("positions.contributions.noCost");
  if (row.open && row.sold) return text("positions.contributions.partlySold");
  return row.open ? text("positions.contributions.open") : text("positions.contributions.sold");
}

export function TopContributions({ page }: { page: ServicePage }) {
  const text = useTranslations("investments");
  const { overview, money } = page;
  const assetOf = new Map(overview.service.assets.map((asset) => [asset.id, asset]));
  const top = (overview.contributions?.rows ?? []).slice(0, 5);
  return (
    <Card padded={false} className="min-w-0">
      <CardHeader
        title={text("service.top.title")}
        actions={<CardLink href={page.href("positions")} label={text("service.top.all")} />}
      />
      {top.length === 0 ? (
        <p className="px-4 pb-4 text-sm text-muted">{text("service.top.empty")}</p>
      ) : (
        <ul className="flex flex-col" data-testid="top-positions">
          {top.map((row) => {
            const asset = row.assetId === null ? undefined : assetOf.get(row.assetId);
            return (
              <li
                key={row.key}
                data-testid="top-position"
                className="flex items-start justify-between gap-3 border-t border-border px-4 py-2.5 text-sm"
              >
                <span className="flex min-w-0 flex-col">
                  <Link
                    href={page.href("activity", { asset: row.assetId ?? undefined })}
                    className="focus-ring inline-flex min-h-6 min-w-0 items-center rounded-sm font-medium hover:underline"
                  >
                    <span className="truncate">{asset?.name ?? text("positions.unknownAsset")}</span>
                  </Link>
                  <span className="text-xs text-muted">
                    {[asset?.symbol, stateOf(text, row)].filter(Boolean).join(" · ")}
                  </span>
                </span>
                <span
                  className={cn("shrink-0 font-medium tabular-nums", TONE_TEXT[toneOfSign(centsOf(row.pnl))])}
                >
                  {money(row.pnl, { signed: true })}
                </span>
              </li>
            );
          })}
        </ul>
      )}
    </Card>
  );
}

export function LatestActivity({ page }: { page: ServicePage }) {
  const text = useTranslations("investments");
  const { overview, money, say } = page;
  const describe = useEventText(say.format);
  return (
    <Card padded={false} className="min-w-0">
      <CardHeader
        title={text("service.latest.title")}
        actions={<CardLink href={page.href("activity")} label={text("service.latest.all")} />}
      />
      {overview.recent.length === 0 ? (
        <p className="px-4 pb-4 text-sm text-muted">{text("service.latest.empty")}</p>
      ) : (
        <ul className="flex flex-col" data-testid="latest-activity">
          {overview.recent.map((row) => (
            <li
              key={row.id}
              className="flex items-start justify-between gap-3 border-t border-border px-4 py-2.5 text-sm"
            >
              <span className="flex min-w-0 flex-col">
                <span>{describe(row).sentence}</span>
                <span className="text-xs text-muted">
                  {formatDate(row.on, "long", say.locale)}
                  {row.realized !== null && (
                    <>
                      {" · "}
                      <span className={TONE_TEXT[toneOfSign(centsOf(row.realized))]}>
                        {money(row.realized, { signed: true })}
                      </span>
                    </>
                  )}
                </span>
              </span>
              <span className="shrink-0 font-medium tabular-nums">
                {money(row.leg.amount, { signed: true })}
              </span>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}
