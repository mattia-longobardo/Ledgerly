"use client";

// The Activity of a manual service (PERS-342): the money in and out of the period and the movements of
// its account that make it, with the way to Accounts, where they are kept.
import { useTranslations } from "next-intl";
import { formatDate } from "@ledgerly/format/format";
import { Card, CardHeader } from "@ledgerly/ui/card";
import { cn } from "@ledgerly/ui/cn";
import { KpiTile } from "@ledgerly/ui/kpi-tile";
import { Link } from "@ledgerly/ui/router";
import { TONE_TEXT, toneOfSign } from "@ledgerly/ui/tone";
import { centsOf } from "../present";
import type { ServicePage } from "../service/service-view";
import type { Movements } from "./activity-view";

function MovementsList({ page, movements }: { page: ServicePage; movements: Movements }) {
  const text = useTranslations("investments");
  const { money, say } = page;
  const describe = (payee: string | null, amount: string) =>
    payee ??
    text((centsOf(amount) ?? 0n) > 0n ? "activityTab.families.deposit" : "activityTab.families.withdrawal");
  if (movements.rows.length === 0)
    return (
      <p className="mt-3 border-t border-border px-4 py-6 text-center text-sm text-muted">
        {text("activityTab.empty")}
      </p>
    );
  return (
    <ul className="mt-3 flex flex-col">
      {movements.rows.map((row) => (
        <li
          key={row.id}
          data-testid="activity-item"
          className="flex items-start justify-between gap-3 border-t border-border px-4 py-2.5 text-sm"
        >
          <span className="flex min-w-0 flex-col gap-0.5">
            <span className="truncate">{describe(row.payee, row.amount)}</span>
            <span className="text-xs text-muted">{formatDate(row.on, "long", say.locale)}</span>
          </span>
          <span
            className={cn("shrink-0 font-medium tabular-nums", TONE_TEXT[toneOfSign(centsOf(row.amount))])}
          >
            {money(row.amount, { signed: true })}
          </span>
        </li>
      ))}
    </ul>
  );
}

export function ManualActivity({ page, movements }: { page: ServicePage; movements: Movements }) {
  const text = useTranslations("investments");
  const signed = (amount: string) => page.money(amount, { signed: true });
  return (
    <>
      <div className="grid grid-cols-1 gap-4 @lg:grid-cols-3">
        <KpiTile
          label={text("activityTab.deposits")}
          value={signed(movements.deposits)}
          valueTone={toneOfSign(centsOf(movements.deposits))}
        />
        <KpiTile
          label={text("activityTab.withdrawals")}
          value={signed(movements.withdrawals)}
          valueTone={toneOfSign(centsOf(movements.withdrawals))}
        />
        <KpiTile label={text("activityTab.net")} value={signed(movements.net)} />
      </div>
      <Card padded={false} className="min-w-0" data-testid="manual-activity">
        <CardHeader title={text("activityTab.accountMovements")} />
        <p className="flex flex-wrap items-center gap-x-2 px-4 text-sm text-muted">
          {text("activityTab.accountMovementsNote")}
          <Link
            href={`/accounts/${page.id}`}
            className="focus-ring inline-flex min-h-6 items-center rounded-sm text-accent hover:underline"
          >
            {text("activityTab.openAccount")}
          </Link>
        </p>
        <MovementsList page={page} movements={movements} />
      </Card>
    </>
  );
}
