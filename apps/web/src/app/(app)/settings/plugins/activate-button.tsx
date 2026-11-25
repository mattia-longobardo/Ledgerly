"use client";

import { useTranslations } from "next-intl";
import { useEffect, useState, useTransition } from "react";
import { Button } from "@ledgerly/ui/button";
import { useRouter } from "@ledgerly/ui/router";
import { notify } from "@ledgerly/ui/toast";
import { activatePlugin, type PluginActionResult } from "./plugin-calls";

/** The refusal of «Activate» (PERS-615 §5), in the words of the person; `null` while there is none. */
export function useActivate(pluginId: string, provider: string) {
  const text = useTranslations("settings.plugins");
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function activate() {
    setError(null);
    startTransition(async () => {
      const result = await activatePlugin(pluginId).catch((): PluginActionResult => ({
        ok: false,
        error: "failed",
      }));
      if (!result.ok) {
        setError(
          result.error === "not_available"
            ? text("errors.notAvailable", { name: provider })
            : text("errors.activate", { code: result.error }),
        );
        return;
      }
      notify(text("toasts.enabled", { name: provider }));
      // «Activate» opens the page with «Connect» in focus (§1): connecting is the next step.
      router.push(`/settings/plugins/${pluginId}?step=connect`);
      router.refresh();
    });
  }

  const failure =
    error === null ? null : (
      <p role="alert" className="text-sm text-neg" data-testid="activate-error">
        {error}
      </p>
    );
  return { activate, pending, failure };
}

/** «Activate {provider}»: an explicit step, for every plugin (§1, decision without confirmation 2). */
export function ActivateButton({
  pluginId,
  provider,
  label,
  variant = "primary",
}: {
  pluginId: string;
  provider: string;
  label: string;
  variant?: "primary" | "secondary";
}) {
  const { activate, pending, failure } = useActivate(pluginId, provider);
  return (
    <div className="flex flex-col gap-2">
      <Button
        variant={variant}
        size="md"
        className="w-full self-start md:w-auto"
        disabled={pending}
        aria-busy={pending}
        onClick={activate}
      >
        {label}
      </Button>
      {failure}
    </div>
  );
}

/**
 * After «Activate», the page opens with «Connect» in focus (PERS-615 §1): the first button of the
 * section of the connection, once, when the address says so (`?step=connect`).
 */
export function FocusOnArrival({ target }: { target: string }) {
  useEffect(() => {
    if (new URLSearchParams(window.location.search).get("step") !== "connect") return;
    document.querySelector<HTMLElement>(`#${target} button, #${target} a[href]`)?.focus();
  }, [target]);
  return null;
}
