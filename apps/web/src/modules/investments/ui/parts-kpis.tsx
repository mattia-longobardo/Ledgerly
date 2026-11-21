"use client";

// The parts of a P&L (docs/design/investments-ux.md §3.1, §4.2): four tiles — the unrealized only with
// a position open at the end (PERS-145) — and under them the amounts that close the sum, when they are
// not zero: tiles + that line = the hero, to the cent. Every amount is a field of the API.
import { useTranslations } from "next-intl";
import { cn } from "@ledgerly/ui/cn";
import { KpiTile } from "@ledgerly/ui/kpi-tile";
import { TONE_TEXT, toneOfSign } from "@ledgerly/ui/tone";
import { centsOf, type Money } from "./present";

interface Parts {
  realized: string;
  unrealized: string | null;
  income: string;
  fees: string;
  fx: string;
  feesAndFx: string;
  corrections: string;
  unattributed: string;
}

const tone = (amount: string | null) => toneOfSign(centsOf(amount));

/** The amounts that close the sum: corrections, what no part explains, the transfers; only those not zero. */
export function ClosingLine({
  rows,
  money,
}: {
  rows: readonly { key: "corrections" | "unattributed" | "transfers"; amount: string }[];
  money: Money;
}) {
  const text = useTranslations("investments");
  const closing = rows.filter((row) => centsOf(row.amount) !== 0n);
  if (closing.length === 0) return null;
  return (
    <p data-testid="pnl-closing" className="flex flex-wrap gap-x-4 gap-y-1 text-sm text-muted">
      {closing.map((row) => (
        <span key={row.key} data-cents={String(centsOf(row.amount))}>
          {text(`home.kpis.${row.key}`)}{" "}
          <strong className={cn("font-semibold tabular-nums", TONE_TEXT[tone(row.amount)])}>
            {money(row.amount, { signed: true })}
          </strong>
        </span>
      ))}
    </p>
  );
}

export function PartsKpis({
  parts,
  transfers,
  openPositions,
  money,
}: {
  parts: Parts;
  transfers: string;
  /** The positions open at the end of the period, over every service. */
  openPositions: number;
  money: Money;
}) {
  const text = useTranslations("investments");
  const signed = (amount: string | null) => money(amount, { signed: true });
  return (
    <div className="flex flex-col gap-2">
      <div className="grid grid-cols-2 gap-4 @4xl:grid-cols-4">
        <KpiTile
          label={text("home.kpis.realized")}
          value={signed(parts.realized)}
          valueTone={tone(parts.realized)}
          note={text("home.kpis.realizedNote")}
        />
        {(openPositions > 0 || parts.unrealized === null) && (
          <KpiTile
            label={text("home.kpis.unrealized")}
            value={signed(parts.unrealized)}
            valueTone={tone(parts.unrealized)}
            note={
              parts.unrealized === null
                ? text("home.kpis.unrealizedUnknown")
                : text("home.kpis.unrealizedNote", { count: openPositions })
            }
          />
        )}
        <KpiTile
          label={text("home.kpis.income")}
          value={signed(parts.income)}
          valueTone={tone(parts.income)}
          note={text("home.kpis.incomeNote")}
        />
        <KpiTile
          label={text("home.kpis.feesFx")}
          value={signed(parts.feesAndFx)}
          valueTone={tone(parts.feesAndFx)}
          note={text("home.kpis.feesFxNote", { fees: signed(parts.fees), fx: signed(parts.fx) })}
        />
      </div>
      <ClosingLine
        rows={[
          { key: "corrections", amount: parts.corrections },
          { key: "unattributed", amount: parts.unattributed },
          { key: "transfers", amount: transfers },
        ]}
        money={money}
      />
    </div>
  );
}
