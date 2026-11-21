"use client";

// The parts of a service's P&L (§3.3, PERS-145), or, for a manual service (PERS-335), its value against
// the money put in. Every figure is a field of `GET /investments/{accountId}`.
import { useTranslations } from "next-intl";
import { formatDate, NULL_DISPLAY } from "@ledgerly/format/format";
import { KpiTile } from "@ledgerly/ui/kpi-tile";
import { toneOfSign } from "@ledgerly/ui/tone";
import { ClosingLine } from "../parts-kpis";
import { centsOf } from "../present";
import { useProviderWords, withName } from "../provider-words";
import type { ServicePage } from "../service/service-view";

type Manual = NonNullable<ServicePage["overview"]["service"]["manualPnl"]>;

export function ManualKpis({ page, manual }: { page: ServicePage; manual: Manual }) {
  const text = useTranslations("investments");
  const { money, percent, say } = page;
  return (
    <section
      aria-labelledby="manual-pnl-title"
      data-testid="manual-pnl"
      data-pnl-cents={manual.pnl === null ? "" : String(centsOf(manual.pnl))}
      data-invested-cents={String(centsOf(manual.invested))}
      className="flex flex-col gap-2"
    >
      <h2 id="manual-pnl-title" className="sr-only">
        {text("service.manual.title")}
      </h2>
      <div className="grid grid-cols-1 gap-4 @lg:grid-cols-3">
        <KpiTile
          label={text("service.manual.value")}
          value={manual.value === null ? NULL_DISPLAY : money(manual.value)}
          note={
            manual.valuedOn === null
              ? text("service.manual.noValueNote")
              : text("service.manual.valuedOn", { date: formatDate(manual.valuedOn, "long", say.locale) })
          }
        />
        <KpiTile
          label={text("service.manual.invested")}
          value={money(manual.invested)}
          note={text("service.manual.investedNote")}
        />
        <KpiTile
          label={text("service.manual.pnl")}
          value={manual.pnl === null ? NULL_DISPLAY : money(manual.pnl, { signed: true })}
          valueTone={toneOfSign(centsOf(manual.pnl))}
          delta={manual.rate === null ? undefined : percent(manual.rate)}
          deltaTone={toneOfSign(manual.rate)}
          note={text("service.manual.pnlNote")}
        />
      </div>
      {manual.stale && (
        <p data-testid="manual-stale" className="text-sm text-warn">
          {manual.valuedOn === null
            ? text("service.manual.noValue")
            : text("service.manual.stale", {
                date: formatDate(manual.valuedOn, "long", say.locale),
                days: manual.staleDays,
              })}
        </p>
      )}
    </section>
  );
}

type Local = NonNullable<ServicePage["overview"]["pnl"]["local"]>;

export function ServiceKpis({ page, parts }: { page: ServicePage; parts: Local }) {
  const text = useTranslations("investments");
  const { money, overview } = page;
  const { service, pnl } = overview;
  const signed = (amount: string | null) => money(amount, { signed: true });
  const tone = (amount: string | null) => toneOfSign(centsOf(amount));
  // A provider that sums dividends into the value: a KPI it cannot give says why (S2).
  const includedNote = useProviderWords(service.provider?.id)?.incomeIncludedNote;
  const incomeIncluded = includedNote !== undefined && centsOf(parts.income) === 0n;
  return (
    <div className="flex flex-col gap-2">
      <div className="grid grid-cols-1 gap-4 @lg:grid-cols-2 @4xl:grid-cols-4">
        <KpiTile
          label={text("service.kpis.realized")}
          value={signed(parts.realized)}
          valueTone={tone(parts.realized)}
          note={text("service.kpis.realizedNote")}
        />
        {(pnl.openPositions > 0 || parts.unrealized === null) && (
          // Only with a position open at the end (PERS-145): a sold one is all in the realized.
          <KpiTile
            label={text("service.kpis.unrealized")}
            value={signed(parts.unrealized)}
            valueTone={tone(parts.unrealized)}
            note={
              parts.unrealized === null
                ? text("service.kpis.unrealizedUnknown")
                : text("service.kpis.unrealizedNote", { count: pnl.openPositions })
            }
          />
        )}
        {incomeIncluded ? (
          <KpiTile
            label={text("service.kpis.income")}
            value={text("service.kpis.incomeIncluded")}
            note={withName(includedNote ?? "", service.name)}
          />
        ) : (
          <KpiTile
            label={text("service.kpis.income")}
            value={signed(parts.income)}
            valueTone={tone(parts.income)}
            note={text("service.kpis.incomeNote")}
          />
        )}
        <KpiTile
          label={text("service.kpis.fees")}
          value={signed(parts.fees)}
          valueTone={tone(parts.fees)}
          note={text("service.kpis.feesNote")}
        />
      </div>
      <ClosingLine
        rows={[
          { key: "corrections", amount: parts.corrections },
          { key: "unattributed", amount: parts.unattributed },
        ]}
        money={money}
      />
    </div>
  );
}
