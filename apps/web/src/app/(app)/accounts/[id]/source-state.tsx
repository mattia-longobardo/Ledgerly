"use client";

// Where an account stands with its source (H56, PERS-615 §4): an account whose plugin is off is
// «Stopped», says since when, and sends the person to the plugin's page to clean it up; an account
// kept by hand after «Deactivate» says where it came from, in its settings.
import { useTranslations } from "next-intl";
import { sources } from "@ledgerly/api-contract/settings";
import { civilDateIn } from "@ledgerly/format/dates";
import { formatDate } from "@ledgerly/format/format";
import { Banner } from "@ledgerly/ui/banner";
import { ButtonLink } from "@ledgerly/ui/button";
import { useApi } from "@ledgerly/ui/data";
import type { AccountPage } from "./account-screen";

const slugOf = (provider: string | null) => provider?.replace(/^plugin:/, "") ?? "";

function dayOf(page: Pick<AccountPage, "format">, instant: string | null): string {
  if (instant === null) return "";
  return formatDate(civilDateIn(new Date(instant), page.format.timeZone), "long", page.format.locale);
}

/** The banner of a stopped account: it does not update, and «Clean up in {X}». */
export function StoppedBanner({ page }: { page: Pick<AccountPage, "account" | "context" | "format"> }) {
  const text = useTranslations("accounts.stopped");
  const { account } = page;
  if (account.sourceState !== "stopped") return null;
  const provider = page.context.providerLabel ?? slugOf(account.provider);
  return (
    <Banner
      tone="warn"
      title={text("title", { provider })}
      testId="account-stopped"
      action={
        <ButtonLink href={`/settings/plugins/${slugOf(account.provider)}`} variant="primary" size="sm">
          {text("fix", { provider })}
        </ButtonLink>
      }
    >
      {text("body", { provider, date: dayOf(page, account.stoppedSince) })}
    </Banner>
  );
}

/**
 * The sentence of «Data source» in the settings (§4): where the balance comes from, from a plugin that
 * is on, from one that is off (stopped), or kept by hand after one (former). Never «Connected through».
 */
export function useSourceNote(page: Pick<AccountPage, "account" | "context" | "format">): string | undefined {
  const text = useTranslations("accounts.settings.source");
  const plugins = useApi(sources.listPlugins, {});
  const { account } = page;
  const nameOf = (provider: string | null) =>
    plugins.data?.plugins.find((one) => `plugin:${one.id}` === provider)?.name ?? slugOf(provider);
  if (account.sourceState === "stopped")
    return text("stoppedNote", {
      provider: page.context.providerLabel ?? nameOf(account.provider),
      date: dayOf(page, account.stoppedSince),
    });
  if (account.sourceState === "former")
    return text("formerNote", {
      provider: nameOf(account.formerSource),
      date: dayOf(page, account.stoppedSince),
    });
  return undefined;
}
