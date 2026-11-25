"use client";

import { useTranslations } from "next-intl";
import { useState } from "react";
import { parseCents } from "@ledgerly/format/cents";
import {
  formatDate,
  formatMoney,
  NULL_DISPLAY,
  type NumberFormat,
  type UiLocale,
} from "@ledgerly/format/format";
import type { RouteOutput } from "@ledgerly/api-client";
import { Button } from "@ledgerly/ui/button";
import { Card, CardHeader } from "@ledgerly/ui/card";
import { useApi } from "@ledgerly/ui/data";
import { notify } from "@ledgerly/ui/toast";
import { answerTransferProposal, giroconti } from "./commands";

type Proposal = RouteOutput<typeof giroconti.listTransferProposals>["proposals"][number];

interface Format {
  accounts: readonly { id: string; name: string }[];
  locale: UiLocale;
  numberFormat: NumberFormat;
}

/**
 * The giroconti found by amount and day that are not sure enough to be paired (decision 7A): the
 * person confirms or rejects each, and nothing is paired until then. Nothing is drawn when none waits.
 */
export function TransferProposals(format: Format) {
  const text = useTranslations("expenses.transfer");
  const proposals = useApi(giroconti.listTransferProposals, {});
  const [answering, setAnswering] = useState<string | null>(null);
  const list = proposals.data?.proposals ?? [];
  if (list.length === 0) return null;

  function answer(id: string, accept: boolean) {
    setAnswering(id);
    answerTransferProposal(id, accept)
      .then((result) => {
        if (!result.ok) return notify(text("failed"), "error");
        notify(accept ? text("toasts.paired") : text("toasts.rejected"));
      })
      .catch(() => notify(text("failed"), "error"))
      .finally(() => setAnswering(null));
  }

  return (
    <Card padded={false} data-testid="transfer-proposals">
      <CardHeader title={text("proposals.title", { count: list.length })} />
      <p className="px-4 pb-2 text-sm text-muted">{text("proposals.description")}</p>
      <ul className="flex flex-col">
        {list.map((proposal) => (
          <ProposalRow
            key={proposal.id}
            proposal={proposal}
            format={format}
            disabled={answering !== null}
            onAnswer={(accept) => answer(proposal.id, accept)}
          />
        ))}
      </ul>
    </Card>
  );
}

/** One proposal: the route, the two days, the amount, and its two answers. */
function ProposalRow({
  proposal,
  format,
  disabled,
  onAnswer,
}: {
  proposal: Proposal;
  format: Format;
  disabled: boolean;
  onAnswer: (accept: boolean) => void;
}) {
  const text = useTranslations("expenses.transfer");
  const nameOf = (id: string) => format.accounts.find((account) => account.id === id)?.name ?? NULL_DISPLAY;
  const route = text("route", { from: nameOf(proposal.out.accountId), to: nameOf(proposal.in.accountId) });
  return (
    <li className="flex flex-wrap items-center gap-x-3 gap-y-2 border-t border-border px-4 py-2.5">
      <span className="flex min-w-0 flex-1 flex-col">
        <span className="font-medium break-words">{route}</span>
        <span className="text-sm text-muted">
          {text("proposals.days", {
            out: formatDate(proposal.out.on, "long", format.locale),
            in: formatDate(proposal.in.on, "long", format.locale),
          })}
        </span>
      </span>
      <span className="font-medium tabular-nums">
        {formatMoney(parseCents(proposal.in.amount), format.numberFormat)}
      </span>
      <span className="flex gap-2 max-sm:w-full">
        <Button
          size="sm"
          className="max-sm:flex-1"
          disabled={disabled}
          aria-label={text("proposals.rejectLabel", { route })}
          onClick={() => onAnswer(false)}
        >
          {text("proposals.reject")}
        </Button>
        <Button
          size="sm"
          variant="primary"
          className="max-sm:flex-1"
          disabled={disabled}
          aria-label={text("proposals.acceptLabel", { route })}
          onClick={() => onAnswer(true)}
        >
          {text("proposals.accept")}
        </Button>
      </span>
    </li>
  );
}
