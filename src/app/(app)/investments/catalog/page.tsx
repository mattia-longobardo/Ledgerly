import { ExternalLink } from "lucide-react";
import type { Metadata, Route } from "next";
import { getTranslations } from "next-intl/server";
import { accountTypeOf, MANUAL_PROVIDER } from "@/modules/investments/catalog";
import { catalogView } from "@/modules/investments/queries";
import { ConnectProviderButton, CreateManualServiceButton } from "@/modules/investments/ui/dialogs";
import { requireSession } from "@/platform/auth/session";
import { Badge } from "@/ui/badge";
import { ButtonLink } from "@/ui/button";
import { Card } from "@/ui/card";
import { Page } from "@/ui/shell/page";

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getTranslations("investments"))("catalog.title") };
}

/**
 * The catalog (docs/design/investments.md §4.2, investments-ux.md §3.7): Accounts, Online brokers,
 * Crypto with what can be added today — the manual account, eToro and Binance — and the providers
 * still to come closed under "Coming soon", with their count (C1, C2).
 */
export default async function InvestmentsCatalogPage() {
  const ctx = await requireSession();
  const t = await getTranslations("investments");
  const view = await catalogView(ctx);
  const sections = ["accounts", "broker", "crypto"] as const;
  // The providers not connectable yet, closed under one "Coming soon" with their count (C2).
  const planned = view.providers.filter(
    (provider) =>
      provider.id !== MANUAL_PROVIDER && provider.status === "planned" && provider.connected.length === 0,
  );
  const card = (provider: (typeof view.providers)[number]) => {
    const manual = provider.id === MANUAL_PROVIDER;
    const connectable =
      !manual &&
      provider.connect === "apikey" &&
      provider.status === "available" &&
      provider.connected.length === 0;
    const status = manual ? "available" : provider.connected.length > 0 ? "connected" : provider.status;
    return (
      <li key={provider.id} className="min-w-0">
        <Card className="flex h-full min-w-0 flex-col gap-2" data-testid="catalog-card">
          <div className="flex items-start justify-between gap-2">
            <h3 className="truncate font-semibold">{manual ? t("catalog.manualName") : provider.name}</h3>
            <Badge tone={status === "planned" ? "neutral" : status === "connected" ? "pos" : "accent"}>
              {t(`catalog.status.${status}`)}
            </Badge>
          </div>
          <p className="text-sm text-muted">
            {manual
              ? t("catalog.manualDescription")
              : provider.status === "available"
                ? t("catalog.connectDescription")
                : t("catalog.plannedDescription")}
          </p>
          {provider.connected.length > 0 && (
            <p className="truncate text-sm">
              {t("catalog.linked", {
                names: provider.connected.map((one) => one.name).join(", "),
              })}
            </p>
          )}
          <div className="mt-auto flex flex-wrap items-center gap-2 pt-1">
            {manual && <CreateManualServiceButton existing={view.existing} numberFormat={ctx.numberFormat} />}
            {connectable && (
              <ConnectProviderButton
                provider={{
                  id: provider.id,
                  name: provider.name,
                  accountType: accountTypeOf(provider.category),
                  ipWhitelist: provider.ipWhitelist,
                  credentialFields: provider.credentialFields,
                  currencies: provider.currencies,
                  defaultCurrency: provider.defaultCurrency,
                  url: provider.url,
                  revokeUrl: provider.revokeUrl,
                }}
                existing={view.existing}
                numberFormat={ctx.numberFormat}
              />
            )}
            {provider.connected.length === 1 && (
              <ButtonLink href={`/investments/${provider.connected[0].accountId}` as Route} size="sm">
                {t("actions.open")}
              </ButtonLink>
            )}
            {provider.url && (
              <a
                href={provider.url}
                target="_blank"
                rel="noopener noreferrer"
                aria-label={t("actions.openSite", { name: provider.name })}
                className="focus-ring inline-flex min-h-6 items-center gap-1 rounded-[4px] text-sm text-accent hover:underline"
              >
                {t("actions.openSiteShort")}
                <ExternalLink aria-hidden className="size-3.5" />
              </a>
            )}
          </div>
        </Card>
      </li>
    );
  };

  return (
    <Page title={t("catalog.title")} parent={{ href: "/investments" as Route, label: t("title") }}>
      <div className="flex flex-col gap-0.5">
        <h1 className="text-title font-semibold tracking-[-0.02em]">{t("catalog.title")}</h1>
        <p className="text-muted">{t("catalog.subtitle")}</p>
      </div>
      {sections.map((section) => {
        const listed = view.providers.filter(
          (provider) => provider.category === section && !planned.includes(provider),
        );
        if (listed.length === 0) return null;
        return (
          <section key={section} className="flex flex-col gap-3" aria-labelledby={`catalog-${section}`}>
            <h2 id={`catalog-${section}`} className="text-lg font-semibold">
              {t(`catalog.sections.${section}`)}
            </h2>
            <ul className="grid gap-4 @2xl:grid-cols-2 @5xl:grid-cols-3">{listed.map(card)}</ul>
          </section>
        );
      })}
      {planned.length > 0 && (
        <details data-testid="catalog-planned">
          <summary className="focus-ring inline-flex min-h-6 cursor-pointer items-center gap-1 rounded-[4px] text-lg font-semibold">
            {t("catalog.plannedSection", { count: planned.length })}
          </summary>
          <ul className="mt-3 grid gap-4 @2xl:grid-cols-2 @5xl:grid-cols-3">{planned.map(card)}</ul>
        </details>
      )}
    </Page>
  );
}
