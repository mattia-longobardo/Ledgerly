"use client";

// The way from a disconnection to the source's page, where the source is deactivated.
import { useTranslations } from "use-intl";
import { Link } from "./router";

/**
 * Under "Disconnect" (plugin-settings.md §4.2): a disconnection keeps the settings, and the way
 * to stop using a source for good is on the source's page.
 */
export function DeactivateLink({ href, provider }: { href: string; provider: string }) {
  const text = useTranslations("settings.plugin");
  return (
    <Link
      href={href}
      className="focus-ring inline-flex min-h-6 items-center self-start rounded-xs text-accent underline underline-offset-2"
    >
      {text("disconnect.toDeactivate", { provider })}
    </Link>
  );
}
