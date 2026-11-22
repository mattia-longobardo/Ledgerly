"use client";

import type { Route } from "next";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useRef, useState, useTransition } from "react";
import { Button } from "@ledgerly/ui/button";
import { Modal } from "@ledgerly/ui/modal";
import { notify } from "@ledgerly/ui/toast";
import type { DeactivationCounts } from "./deactivate";
import { deactivateSourceAction, deactivationCountsAction } from "./deactivate-calls";

/**
 * The end of a source's page (plugin-settings.md §2.2, §3.3): what "Turn off" does, and the button.
 * The dialog reads its counts from the server before it opens, and lists only the lines above 0.
 * The first focus is "Cancel" (the first button of the dialog); Esc closes; the focus goes back to
 * the button that opened it.
 */
export function DeactivateZone({ slug, provider }: { slug: string; provider: string }) {
  const t = useTranslations("settings.plugin");
  const router = useRouter();
  const [counts, setCounts] = useState<DeactivationCounts | null>(null);
  const [failed, setFailed] = useState(false);
  const [opening, startOpening] = useTransition();
  const [pending, startTransition] = useTransition();
  // The focus goes back here on closing: the dialog is opened by an action, not by a trigger.
  const opener = useRef<HTMLButtonElement>(null);

  function open() {
    if (opening) return;
    setFailed(false);
    startOpening(async () => {
      try {
        const result = await deactivationCountsAction(slug);
        if (result.ok) setCounts(result.counts);
        else setFailed(true);
      } catch {
        setFailed(true);
      }
    });
  }

  function confirm() {
    setFailed(false);
    startTransition(async () => {
      let accounts: number | null = null;
      try {
        const result = await deactivateSourceAction(slug);
        if (result.ok) accounts = result.accounts;
      } catch {
        accounts = null;
      }
      if (accounts === null) {
        setFailed(true);
        return;
      }
      setCounts(null);
      notify(t("deactivate.done", { provider, count: accounts }));
      router.push("/settings/integrations" as Route);
    });
  }

  const lines =
    counts === null
      ? []
      : [
          counts.accounts > 0 && t("deactivate.accounts", { count: counts.accounts }),
          counts.categories > 0 && t("deactivate.categories", { count: counts.categories, provider }),
          counts.rules > 0 && t("deactivate.rules", { count: counts.rules, provider }),
          counts.unsent > 0 && t("deactivate.unsent", { count: counts.unsent }),
          counts.pendingDays > 0 && t("deactivate.pendingDays", { count: counts.pendingDays, provider }),
          t("deactivate.credentials"),
        ].filter((line): line is string => typeof line === "string");

  return (
    <div className="flex flex-col gap-3 px-4 py-3.5" data-testid="deactivate-zone">
      <p className="text-sm text-muted">{t("deactivate.zone", { provider })}</p>
      {failed && counts === null && (
        <p role="alert" className="text-sm text-neg">
          {t("deactivate.failed")}
        </p>
      )}
      <Button
        ref={opener}
        variant="danger"
        size="sm"
        className="w-full self-end md:w-auto"
        aria-busy={opening}
        onClick={open}
      >
        {t("deactivate.open", { provider })}
      </Button>

      {counts !== null && (
        <Modal
          open
          onOpenChange={(next) => {
            if (!next && !pending) setCounts(null);
          }}
          title={t("deactivate.title", { provider })}
          description={t("deactivate.body", { provider })}
          width={460}
          finalFocus={opener}
          footer={
            <>
              <Button size="sm" disabled={pending} onClick={() => setCounts(null)}>
                {t("deactivate.cancel")}
              </Button>
              <Button variant="danger" size="sm" disabled={pending} aria-busy={pending} onClick={confirm}>
                {pending ? t("deactivate.busy") : t("deactivate.confirm", { provider })}
              </Button>
            </>
          }
        >
          <div className="flex flex-col gap-2 text-sm">
            <p className="font-semibold" id="deactivate-what">
              {t("deactivate.what")}
            </p>
            <ul
              className="flex list-disc flex-col gap-1 pl-5"
              aria-labelledby="deactivate-what"
              data-testid="deactivate-lines"
            >
              {lines.map((line) => (
                <li key={line}>{line}</li>
              ))}
            </ul>
            {failed && (
              <p role="alert" className="text-neg">
                {t("deactivate.failed")}
              </p>
            )}
          </div>
        </Modal>
      )}
    </div>
  );
}
