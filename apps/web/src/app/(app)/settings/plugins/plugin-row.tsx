"use client";

import { useTranslations } from "next-intl";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { Button } from "@ledgerly/ui/button";
import { cn } from "@ledgerly/ui/cn";
import { ActionMenu } from "@ledgerly/ui/menu";
import { Modal } from "@ledgerly/ui/modal";
import { notify } from "@ledgerly/ui/toast";
import { TONE_TEXT } from "@ledgerly/ui/tone";
import { setPluginActive } from "./plugin-calls";

/**
 * What the browser is told about a plugin (ux/n1-plugin-bank.md §2.2): its name and description
 * from the manifest, in the person's language, and what it is for this person. Nothing of the
 * plugin's own state, and nothing of any other person.
 */
interface PluginRowProps {
  id: string;
  name: string;
  description: string;
  state: "available" | "active" | "paused";
  /** The day the person last turned it off, already formatted; only for `paused`. */
  pausedSince: string | null;
  /** Whether credentials are saved: turning off then asks first (§2.3). */
  hasCredentials: boolean;
  connections: number;
}

/**
 * One plugin in "Data sources": the name, "Active" or "Not active", and the one thing the person
 * can do — turn it on, or off. Turning on asks nothing and calls nothing; turning off asks only
 * when credentials are saved.
 */
export function PluginRow({
  id,
  name,
  description,
  state,
  pausedSince,
  hasCredentials,
  connections,
}: PluginRowProps) {
  const t = useTranslations("settings.plugins");
  const [confirming, setConfirming] = useState(false);
  const [failed, setFailed] = useState(false);
  const [pending, startTransition] = useTransition();
  // The rows come from the page's server render until Settings › Integrations reads `/api/v1` itself.
  const router = useRouter();
  const active = state === "active";

  function change(next: boolean) {
    startTransition(async () => {
      let ok = false;
      try {
        ok = (await setPluginActive(id, next)).ok;
      } catch {
        ok = false;
      }
      setFailed(!ok);
      if (!ok) return;
      setConfirming(false);
      notify(next ? t("toasts.enabled", { name }) : t("toasts.disabled", { name }));
      router.refresh();
    });
  }

  return (
    <div className="flex flex-col" data-testid="plugin-row" data-plugin={id} data-state={state}>
      <div className="flex flex-wrap items-start justify-between gap-x-5 gap-y-3 px-4 py-3.5">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-x-2">
            <span
              aria-hidden
              className={cn("size-[7px] shrink-0 rounded-full", active ? "bg-pos" : "bg-faint")}
            />
            <span className="min-w-0 font-semibold">{name}</span>
            <span
              className={cn("text-sm font-medium whitespace-nowrap", TONE_TEXT[active ? "pos" : "muted"])}
            >
              {active ? t("states.active") : t("states.inactive")}
            </span>
          </div>
          <p className="mt-0.5 text-sm text-muted">{description}</p>
        </div>
        <div className="flex items-center gap-2">
          {active ? (
            <ActionMenu
              label={name}
              items={[
                {
                  label: t("actions.disable"),
                  onSelect: () => {
                    setFailed(false);
                    if (hasCredentials) setConfirming(true);
                    else change(false);
                  },
                },
              ]}
            />
          ) : (
            <Button size="sm" variant="primary" disabled={pending} onClick={() => change(true)}>
              {t("actions.enable")}
            </Button>
          )}
        </div>
      </div>

      {state === "paused" && pausedSince !== null && (
        <p className="border-t border-border px-4 py-2.5 text-sm text-muted">
          {t("detail.paused", { date: pausedSince })}
        </p>
      )}

      {failed && !confirming && (
        <p role="alert" className="border-t border-border px-4 py-2.5 text-sm text-neg">
          {t("errors.failed")}
        </p>
      )}

      <Modal
        open={confirming}
        onOpenChange={(open) => !open && setConfirming(false)}
        title={t("disable.title", { name })}
        description={t("disable.description", { name })}
        width={420}
        footer={
          <>
            <Button size="sm" onClick={() => setConfirming(false)}>
              {t("disable.cancel")}
            </Button>
            <Button variant="danger" size="sm" disabled={pending} onClick={() => change(false)}>
              {t("disable.confirm")}
            </Button>
          </>
        }
      >
        <div className="flex flex-col gap-2 text-sm">
          {connections > 0 && <p>{t("disable.links", { count: connections })}</p>}
          {failed && (
            <p role="alert" className="text-neg">
              {t("errors.failed")}
            </p>
          )}
        </div>
      </Modal>
    </div>
  );
}
