"use client";

import { useTranslations } from "next-intl";
import { useState, useTransition } from "react";
import { Switch } from "@ledgerly/ui/switch";
import { notify } from "@ledgerly/ui/toast";
import { saveHideAmounts } from "./calls";

/**
 * The switch of «Hide amounts» (R5e, D3): saved for the person, so it is on in every app. The shell
 * draws the pages again once the preferences are read again (`useRedrawOnChange`).
 */
export function HideAmountsSwitch({ initial }: { initial: boolean }) {
  const text = useTranslations("settings.privacy");
  const [hidden, setHidden] = useState(initial);
  const [pending, startTransition] = useTransition();

  function change(next: boolean) {
    setHidden(next);
    startTransition(async () => {
      try {
        await saveHideAmounts(next);
      } catch {
        setHidden(!next);
        notify(text("failed"), "error");
      }
    });
  }

  return (
    <div className="flex items-start justify-between gap-4">
      <div className="flex flex-col gap-1">
        <span id="hide-amounts-label" className="font-medium">
          {text("hideAmounts")}
        </span>
        <span id="hide-amounts-hint" className="text-sm text-muted">
          {text("hint")}
        </span>
      </div>
      <Switch
        checked={hidden}
        onCheckedChange={change}
        labelledBy="hide-amounts-label"
        describedBy="hide-amounts-hint"
        disabled={pending}
        data-testid="hide-amounts"
      />
    </div>
  );
}
