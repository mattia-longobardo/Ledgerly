"use client";

// The catalog (docs/design/investments.md §4.2, investments-ux.md §3.7), read from
// `GET /investments/catalog` (rewrite plan R3): Accounts, Online brokers, Crypto with what can be added
// today — the manual account and the providers with a key — and the providers still to come closed under
// "Coming soon", with their count (C1, C2).
import { ExternalLink } from "lucide-react";
import { useTranslations } from "next-intl";
import { investments } from "@ledgerly/api-contract/investments";
import { profile } from "@ledgerly/api-contract/settings";
import type { RouteOutput } from "@ledgerly/api-client";
import { type NumberFormat, numberStyle } from "@ledgerly/format/format";
import { Badge } from "@ledgerly/ui/badge";
import { ButtonLink } from "@ledgerly/ui/button";
import { Card } from "@ledgerly/ui/card";
import { useApi } from "@ledgerly/ui/data";
import { Loaded } from "@ledgerly/ui/loaded";
import { ConnectProviderButton, CreateManualServiceButton } from "@/modules/investments/client";
import { appRoute } from "@/platform/route";

/** The catalog's id of the manual account: several providers to come connect by hand too. */
const MANUAL = "manual";

type Catalog = RouteOutput<typeof investments.getInvestmentsCatalog>;

type Provider = Catalog["providers"][number];

interface CardProps {
  provider: Provider;
  existing: Catalog["existing"];
  numberFormat: NumberFormat;
}

/** What a card offers: the manual account, a provider to connect, the service it opens, its site. */
function CardActions({ provider, existing, numberFormat }: CardProps) {
  const text = useTranslations("investments");
  const manual = provider.id === MANUAL;
  const connectable =
    !manual &&
    provider.connect === "apikey" &&
    provider.status === "available" &&
    provider.connected.length === 0;
  return (
    <div className="mt-auto flex flex-wrap items-center gap-2 pt-1">
      {manual && <CreateManualServiceButton existing={existing} numberFormat={numberFormat} />}
      {connectable && (
        <ConnectProviderButton provider={provider} existing={existing} numberFormat={numberFormat} />
      )}
      {provider.connected.length === 1 && (
        <ButtonLink href={appRoute(`/investments/${provider.connected[0].accountId}`)} size="sm">
          {text("actions.open")}
        </ButtonLink>
      )}
      {provider.url && (
        <a
          href={provider.url}
          target="_blank"
          rel="noopener noreferrer"
          aria-label={text("actions.openSite", { name: provider.name })}
          className="focus-ring inline-flex min-h-6 items-center gap-1 rounded-sm text-sm text-accent hover:underline"
        >
          {text("actions.openSiteShort")}
          <ExternalLink aria-hidden className="size-3.5" />
        </a>
      )}
    </div>
  );
}

function descriptionKey(provider: Provider) {
  if (provider.id === MANUAL) return "catalog.manualDescription";
  return provider.status === "available" ? "catalog.connectDescription" : "catalog.plannedDescription";
}

function ProviderCard(props: CardProps) {
  const text = useTranslations("investments");
  const { provider } = props;
  const manual = provider.id === MANUAL;
  const status = manual ? "available" : provider.connected.length > 0 ? "connected" : provider.status;
  return (
    <li className="min-w-0">
      <Card className="flex h-full min-w-0 flex-col gap-2" data-testid="catalog-card">
        <div className="flex items-start justify-between gap-2">
          <h3 className="truncate font-semibold">{manual ? text("catalog.manualName") : provider.name}</h3>
          <Badge tone={status === "planned" ? "neutral" : status === "connected" ? "pos" : "accent"}>
            {text(`catalog.status.${status}`)}
          </Badge>
        </div>
        <p className="text-sm text-muted">{text(descriptionKey(provider))}</p>
        {provider.connected.length > 0 && (
          <p className="truncate text-sm">
            {text("catalog.linked", { names: provider.connected.map((one) => one.name).join(", ") })}
          </p>
        )}
        <CardActions {...props} />
      </Card>
    </li>
  );
}

const SECTIONS = ["accounts", "broker", "crypto"] as const;

function Sections({ view, numberFormat }: { view: Catalog; numberFormat: NumberFormat }) {
  const text = useTranslations("investments");
  // The providers not connectable yet, closed under one "Coming soon" with their count (C2).
  const planned = view.providers.filter(
    (provider) => provider.id !== MANUAL && provider.status === "planned" && provider.connected.length === 0,
  );
  const card = (provider: Provider) => (
    <ProviderCard
      key={provider.id}
      provider={provider}
      existing={view.existing}
      numberFormat={numberFormat}
    />
  );
  return (
    <>
      {SECTIONS.map((section) => {
        const listed = view.providers.filter(
          (provider) => provider.category === section && !planned.includes(provider),
        );
        if (listed.length === 0) return null;
        return (
          <section key={section} className="flex flex-col gap-3" aria-labelledby={`catalog-${section}`}>
            <h2 id={`catalog-${section}`} className="text-lg font-semibold">
              {text(`catalog.sections.${section}`)}
            </h2>
            <ul className="grid gap-4 @2xl:grid-cols-2 @5xl:grid-cols-3">{listed.map(card)}</ul>
          </section>
        );
      })}
      {planned.length > 0 && (
        <details data-testid="catalog-planned">
          <summary className="focus-ring inline-flex min-h-6 cursor-pointer items-center gap-1 rounded-sm text-lg font-semibold">
            {text("catalog.plannedSection", { count: planned.length })}
          </summary>
          <ul className="mt-3 grid gap-4 @2xl:grid-cols-2 @5xl:grid-cols-3">{planned.map(card)}</ul>
        </details>
      )}
    </>
  );
}

export function CatalogScreen() {
  const preferences = useApi(profile.getPreferences, {});
  const catalog = useApi(investments.getInvestmentsCatalog, {});
  return (
    <Loaded state={preferences}>
      {(prefs) => (
        <Loaded state={catalog}>
          {(view) => <Sections view={view} numberFormat={numberStyle(prefs)} />}
        </Loaded>
      )}
    </Loaded>
  );
}
