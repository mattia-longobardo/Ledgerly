"use client";

// The money in and out of the period, its net and its fees, and the transfers to link (§2.4, §3.5).
import { useTranslations } from "next-intl";
import { formatDate } from "@ledgerly/format/format";
import { Card, CardHeader } from "@ledgerly/ui/card";
import { KpiTile } from "@ledgerly/ui/kpi-tile";
import { toneOfSign } from "@ledgerly/ui/tone";
import { centsOf } from "../present";
import type { ServicePage } from "../service/service-view";
import { LinkTransferButton } from "../transfers";
import type { Events } from "./activity-view";

export function ActivityKpis({ page, events }: { page: ServicePage; events: Events }) {
  const text = useTranslations("investments");
  const { sums } = events;
  const signed = (amount: string) => page.money(amount, { signed: true });
  const net = centsOf(sums.net) ?? 0n;
  return (
    <div className="grid grid-cols-1 gap-4 @lg:grid-cols-2 @4xl:grid-cols-4">
      <KpiTile
        label={text("activityTab.deposits")}
        value={signed(sums.deposits)}
        valueTone={toneOfSign(centsOf(sums.deposits))}
      />
      <KpiTile
        label={text("activityTab.withdrawals")}
        value={signed(sums.withdrawals)}
        valueTone={toneOfSign(centsOf(sums.withdrawals))}
      />
      <KpiTile
        label={text("activityTab.net")}
        value={signed(sums.net)}
        note={
          net > 0n
            ? text("activityTab.netPositive")
            : net < 0n
              ? text("activityTab.netNegative")
              : text("activityTab.netZero")
        }
      />
      <KpiTile
        label={text("activityTab.fees")}
        value={signed(sums.fees)}
        valueTone={toneOfSign(centsOf(sums.fees))}
        note={text("activityTab.feesNote")}
      />
    </div>
  );
}

export function TransferProposals({ page, events }: { page: ServicePage; events: Events }) {
  const text = useTranslations("investments");
  const { say, money } = page;
  if (events.transferProposals.length === 0) return null;
  return (
    <Card padded={false} className="min-w-0" data-testid="transfer-proposals">
      <CardHeader title={text("transfers.title")} />
      <p className="px-4 text-sm text-muted">{text("transfers.description")}</p>
      <ul className="flex flex-col pt-2">
        {events.transferProposals.map((proposal) => {
          const words = text(`transfers.${proposal.direction}`, {
            date: formatDate(proposal.on, "long", say.locale),
            name: proposal.other.accountName,
            other: formatDate(proposal.other.on, "long", say.locale),
          });
          return (
            <li
              key={`${proposal.withdrawalId}:${proposal.depositId}`}
              data-testid="transfer-proposal"
              className="flex flex-wrap items-center justify-between gap-2 border-t border-border px-4 py-3 text-sm"
            >
              <span className="min-w-0">{words}</span>
              <span className="flex shrink-0 items-center gap-2">
                <span className="font-medium tabular-nums">{money(proposal.amount)}</span>
                <LinkTransferButton
                  accountId={page.id}
                  withdrawalId={proposal.withdrawalId}
                  depositId={proposal.depositId}
                  label={words}
                />
              </span>
            </li>
          );
        })}
      </ul>
    </Card>
  );
}
