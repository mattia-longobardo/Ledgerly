"use client";

// What each position added to the period, open or sold (PERS-113 · 9), and the parts that are no
// position's: they add up to the Overview's P&L, to the cent. Fields of the API.
import { useTranslations } from "next-intl";
import { Card, CardHeader } from "@ledgerly/ui/card";
import { cn } from "@ledgerly/ui/cn";
import { Link } from "@ledgerly/ui/router";
import { TONE_TEXT, toneOfSign } from "@ledgerly/ui/tone";
import { centsOf } from "../present";
import type { PositionsPage } from "./positions-view";

type Contributions = NonNullable<PositionsPage["positions"]["contributions"]>;
type Row = Contributions["rows"][number];

const PARTS = ["income", "fees", "corrections", "valueChange", "unattributed"] as const;

function ContributionRow({ view, row }: { view: PositionsPage; row: Row }) {
  const text = useTranslations("investments.positions");
  const width = Math.abs(row.bar) * 50;
  const state = row.costUnknown
    ? text("contributions.noCost")
    : row.open && row.sold
      ? text("contributions.partlySold")
      : row.open
        ? text("contributions.open")
        : text("contributions.sold");
  return (
    <li
      data-testid="contribution-row"
      data-cents={String(centsOf(row.pnl))}
      className="flex items-center justify-between gap-3 border-t border-border px-4 py-2 text-sm"
    >
      <span className="flex min-w-0 flex-1 flex-col">
        <Link
          href={view.page.href("activity", { asset: row.assetId ?? undefined })}
          className="focus-ring inline-flex min-h-6 max-w-full items-center rounded-sm font-medium hover:underline"
        >
          <span className="truncate">{view.assetOf(row.assetId)?.name ?? text("unknownAsset")}</span>
        </Link>
        <span className="text-xs text-muted">{state}</span>
      </span>
      <span aria-hidden className="relative block h-2 w-24 shrink-0 rounded-full bg-track max-md:hidden">
        <span className="absolute inset-y-[-2px] left-1/2 w-px bg-border" />
        <span
          className="absolute inset-y-0 rounded-full"
          style={{
            width: `${width}%`,
            left: row.bar >= 0 ? "50%" : `${50 - width}%`,
            background: row.bar >= 0 ? "var(--pos)" : "var(--neg)",
          }}
        />
      </span>
      <span
        className={cn(
          "w-28 shrink-0 text-right font-medium tabular-nums",
          TONE_TEXT[toneOfSign(centsOf(row.pnl))],
        )}
      >
        {view.page.money(row.pnl, { signed: true })}
      </span>
    </li>
  );
}

/** The total, «the same as the Overview's», and the bridge to the display currency. */
function TotalLine({ view, contributions }: { view: PositionsPage; contributions: Contributions }) {
  const text = useTranslations("investments.positions");
  const { page, positions } = view;
  const inDisplay = (amount: string) =>
    page.money(amount, { signed: true, currency: positions.displayCurrency });
  const bridge =
    positions.display && positions.currency !== positions.displayCurrency
      ? text("contributions.bridge", {
          display: inDisplay(positions.display.pnl),
          fx: inDisplay(positions.display.fx),
        })
      : null;
  return (
    <li className="flex flex-wrap items-center justify-between gap-x-3 gap-y-0.5 border-t border-border bg-bg px-4 py-2.5 text-sm font-semibold">
      <span>
        {text("contributions.total")}
        <span className="ml-2 font-normal text-muted">{text("contributions.same")}</span>
      </span>
      <span
        data-testid="positions-total"
        data-cents={String(centsOf(contributions.total))}
        className={cn("tabular-nums", TONE_TEXT[toneOfSign(centsOf(contributions.total))])}
      >
        {page.money(contributions.total, { signed: true })}
      </span>
      {bridge && (
        <span data-testid="positions-bridge" className="w-full text-right font-normal text-muted">
          {bridge}
        </span>
      )}
    </li>
  );
}

export function ContributionsCard({
  view,
  contributions,
}: {
  view: PositionsPage;
  contributions: Contributions;
}) {
  const text = useTranslations("investments.positions");
  const { money, name } = view.page;
  const parts = PARTS.map((key) => ({ key, amount: contributions[key] })).filter(
    (part) => centsOf(part.amount) !== 0n,
  );
  return (
    <Card padded={false} className="min-w-0">
      <CardHeader title={text("contributions.title", { period: name })} />
      <p className="-mt-1.5 px-4 pb-2.5 text-sm text-muted">{text("contributions.note")}</p>
      <ul className="flex flex-col" data-testid="contributions">
        {contributions.rows.length === 0 && (
          <li className="border-t border-border px-4 py-2.5 text-sm text-muted">
            {text("contributions.empty", { period: name })}
          </li>
        )}
        {contributions.rows.map((row) => (
          <ContributionRow key={row.key} view={view} row={row} />
        ))}
        {parts.map((part) => (
          <li
            key={part.key}
            data-testid="contribution-part"
            data-cents={String(centsOf(part.amount))}
            className="flex items-center justify-between gap-3 border-t border-border px-4 py-2 text-sm"
          >
            <span className="text-muted">{text(`contributions.${part.key}`)}</span>
            <span
              className={cn("shrink-0 font-medium tabular-nums", TONE_TEXT[toneOfSign(centsOf(part.amount))])}
            >
              {money(part.amount, { signed: true })}
            </span>
          </li>
        ))}
        <TotalLine view={view} contributions={contributions} />
      </ul>
    </Card>
  );
}
