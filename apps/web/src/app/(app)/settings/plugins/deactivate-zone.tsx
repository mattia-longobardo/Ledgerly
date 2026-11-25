"use client";

import { useTranslations } from "next-intl";
import { useRef } from "react";
import { Button } from "@ledgerly/ui/button";
import { useDeactivate } from "./deactivate-dialogs";

/**
 * The end of a plugin's page (plugin-settings.md §2.2, §3.3; PERS-615 §2): what «Deactivate» does in
 * one sentence, and the button. The dialog reads its counts before it opens; the focus goes back to
 * the button on closing.
 */
export function DeactivateZone({
  slug,
  provider,
  calendar,
  empty,
}: {
  slug: string;
  provider: string;
  /** A calendar of days off: it has no account to turn «manual» (UX review, point 3). */
  calendar: boolean;
  /** Nothing read yet: nothing to convert. */
  empty: boolean;
}) {
  const t = useTranslations("settings.plugin.deactivate");
  const opener = useRef<HTMLButtonElement>(null);
  const { open, opening, dialogs, failure } = useDeactivate({ slug, provider, finalFocus: opener });
  const zone = empty ? "zoneEmpty" : calendar ? "zoneCalendar" : "zone";
  return (
    <div
      className="flex flex-col gap-3 px-4 py-3.5 md:flex-row md:items-center md:justify-between"
      data-testid="deactivate-zone"
    >
      <p className="text-sm">{t(zone, { provider })}</p>
      {failure}
      <Button
        ref={opener}
        variant="danger"
        size="sm"
        className="w-full shrink-0 md:w-auto"
        aria-busy={opening}
        onClick={open}
      >
        {t("open", { provider })}
      </Button>
      {dialogs}
    </div>
  );
}

/** «Deactivate {provider}…» alone: the second choice of «Needs cleanup» (PERS-615 §2, mockup 06). */
export function DeactivateButton({ slug, provider }: { slug: string; provider: string }) {
  const words = useTranslations("settings.plugin.deactivate");
  const opener = useRef<HTMLButtonElement>(null);
  const { open, opening, dialogs, failure } = useDeactivate({ slug, provider, finalFocus: opener });
  return (
    <div className="flex flex-col gap-2">
      <Button
        ref={opener}
        variant="danger"
        size="md"
        className="w-full self-start md:w-auto"
        aria-busy={opening}
        onClick={open}
      >
        {words("choose", { provider })}
      </Button>
      {failure}
      {dialogs}
    </div>
  );
}
