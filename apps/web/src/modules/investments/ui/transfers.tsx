"use client";

// Transfers between the person's services (§2.4): link a proposed pair, or unlink a linked leg.
import { useTranslations } from "next-intl";
import { useTransition } from "react";
import { Button } from "@ledgerly/ui/button";
import { useRouter } from "@ledgerly/ui/router";
import { linkTransfer, unlinkTransfer, type ActionResult } from "../calls";
import { useOutcome } from "./dialog-kit";

function useTransferAction() {
  const text = useTranslations("investments");
  const outcome = useOutcome();
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const run = (action: () => Promise<ActionResult>, done: string) =>
    startTransition(async () => {
      outcome(await action(), done);
      router.refresh();
    });
  return { pending, run, text };
}

/** "Link as transfer" on a proposal: both legs get one transfer group, nothing else changes. */
export function LinkTransferButton({
  accountId,
  withdrawalId,
  depositId,
  label,
}: {
  accountId: string;
  withdrawalId: string;
  depositId: string;
  /** What the proposal says, for the button's accessible name. */
  label: string;
}) {
  const { pending, run, text } = useTransferAction();
  return (
    <Button
      size="xs"
      variant="secondary"
      disabled={pending}
      aria-label={`${text("actions.linkTransfer")}: ${label}`}
      onClick={() =>
        run(() => linkTransfer(accountId, withdrawalId, depositId), text("toasts.transferLinked"))
      }
    >
      {text("actions.linkTransfer")}
    </Button>
  );
}

/** "Unlink transfer" on a linked leg: both legs are plain deposits and withdrawals again. */
export function UnlinkTransferButton({
  accountId,
  eventId,
  label,
}: {
  accountId: string;
  eventId: string;
  label: string;
}) {
  const { pending, run, text } = useTransferAction();
  return (
    <Button
      size="xs"
      variant="ghost"
      disabled={pending}
      aria-label={`${text("actions.unlinkTransfer")}: ${label}`}
      onClick={() => run(() => unlinkTransfer(accountId, eventId), text("toasts.transferUnlinked"))}
    >
      {text("actions.unlinkTransfer")}
    </Button>
  );
}
