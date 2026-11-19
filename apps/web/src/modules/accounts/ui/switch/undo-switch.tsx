"use client";

import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useState, useTransition } from "react";
import { accounts, views } from "@ledgerly/api-contract/accounts";
import { Button } from "@ledgerly/ui/button";
import { invalidate } from "@ledgerly/ui/data";
import { Modal } from "@ledgerly/ui/modal";
import { notify } from "@ledgerly/ui/toast";
import { undoSwitchAction } from "../../calls";

/**
 * "Undo switch" (ux/n4-account-switch.md §10): a confirmation that says what goes back and what to
 * know, then one request. The focus starts on the action that changes nothing.
 */
export function UndoSwitch({
  account,
  source,
  bank,
  since,
  transfers,
  publishes,
  joined = null,
  available,
  accountId,
}: {
  account: string;
  source: string;
  bank: string;
  /** The day of the switch, already in words. */
  since: string;
  transfers: number;
  publishes: boolean;
  /** The bank's account that the switch joined to this one, which takes its bank back. */
  joined?: string | null;
  /** False when the source of before is no longer connected (§10.4). */
  available: boolean;
  accountId: string;
}) {
  const t = useTranslations("accounts.switch.undo");
  const [open, setOpen] = useState(false);
  const [failed, setFailed] = useState(false);
  const [pending, startTransition] = useTransition();
  const router = useRouter();

  function confirm() {
    setFailed(false);
    startTransition(async () => {
      const result = await undoSwitchAction(accountId).catch(() => ({ ok: false }));
      if (!result.ok) {
        setFailed(true);
        return;
      }
      setOpen(false);
      notify(t("done"));
      // The settings tab reads the account from `/api/v1`; the page of the switch is drawn on the server.
      invalidate(accounts.getAccount, views.getAccountContext, views.getNetWorth);
      router.refresh();
    });
  }

  return (
    <>
      <Button size="sm" disabled={!available || pending} onClick={() => setOpen(true)}>
        {t("action")}
      </Button>
      {!available && <p className="text-sm text-muted">{t("unavailable", { source })}</p>}
      <Modal
        open={open}
        onOpenChange={setOpen}
        title={t("title", { account })}
        width={460}
        footer={
          <>
            <Button size="sm" autoFocus onClick={() => setOpen(false)}>
              {t("keep", { bank })}
            </Button>
            <Button variant="danger" size="sm" disabled={pending} onClick={confirm}>
              {pending ? t("working") : t("action")}
            </Button>
          </>
        }
      >
        <div className="flex flex-col gap-2 text-sm">
          {failed && (
            <p role="alert" className="rounded-ctl bg-neg-bg px-3 py-2 text-neg">
              {t("failed", { bank })}
            </p>
          )}
          <p>{t("body", { source, date: since })}</p>
          <p className="font-medium">{t("backTitle")}</p>
          <ul className="list-disc pl-5">
            <li>{t("back.source", { source })}</li>
            <li>{t("back.rows", { source })}</li>
            {transfers > 0 && <li>{t("back.transfers", { count: transfers })}</li>}
            {publishes && <li>{t("back.interests", { source })}</li>}
            {joined !== null && <li>{t("back.joined", { account: joined })}</li>}
          </ul>
          <p className="font-medium">{t("knowTitle")}</p>
          <ul className="list-disc pl-5">
            <li>{t("know.bankRows", { date: since, source })}</li>
            <li>{t("know.bankStays", { bank })}</li>
          </ul>
        </div>
      </Modal>
    </>
  );
}
