import { ExternalLink } from "lucide-react";
import type { Metadata, Route } from "next";
import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { getAccount } from "@/modules/accounts/queries";
import { ServiceActions } from "@/modules/investments/ui/dialogs";
import {
  ServiceCrumb,
  ServicePeriodControl,
  type ServiceTab,
  ServiceTabs,
} from "@/modules/investments/ui/service-nav";
import { requireSession } from "@/platform/auth/session";
import { today } from "@/platform/dates";
import { Badge } from "@/ui/badge";
import { Page } from "@/ui/shell/page";
import { alertsOf, firstDayOf, instantText, loadService, providerOf, serviceContextOf } from "./service-data";

export async function generateMetadata({
  params,
}: LayoutProps<"/investments/[accountId]">): Promise<Metadata> {
  const ctx = await requireSession();
  const { accountId } = await params;
  const account = await getAccount(ctx, accountId);
  return { title: account?.name ?? (await getTranslations("investments"))("title") };
}

/**
 * A service (docs/design/investments-ux.md §1.1, §3.2, U3): its header — what it is, how its sync
 * stands, its commands — the four tabs as routes, and the period, drawn once for every tab. The
 * period lives in the address; the tabs carry it from one to the next.
 */
export default async function InvestmentServiceLayout({
  children,
  params,
}: LayoutProps<"/investments/[accountId]">) {
  const ctx = await requireSession();
  const { accountId } = await params;
  const t = await getTranslations("investments");
  const detail = await loadService(accountId);
  if (!detail) notFound();
  const { summary, sync } = detail;
  const account = summary.account;
  const synced = summary.origin === "synced";
  const url = summary.investment.url ?? summary.provider?.url ?? null;
  const base = `/investments/${accountId}`;
  const alerts = alertsOf(detail);

  const tabs: ServiceTab[] = [
    { key: "overview", href: base, label: t("tabs.overview") },
    { key: "positions", href: `${base}/positions`, label: t("tabs.positions") },
    { key: "activity", href: `${base}/activity`, label: t("tabs.activity") },
    {
      key: "connection",
      href: `${base}/connection`,
      // A manual account has nothing connected: its settings and corrections only (§1.1).
      label: sync ? t("tabs.connection") : t("tabs.settings"),
      badge:
        alerts > 0 ? (
          <Badge tone="warn">
            <span aria-hidden>{alerts}</span>
            <span className="sr-only">{t("tabs.alerts", { count: alerts })}</span>
          </Badge>
        ) : undefined,
    },
  ];

  // The sync in words (S12): never "Per asset" or "Managed since", which are in Connection.
  const state = !sync
    ? t("header.state.manual")
    : !sync.connected
      ? t("header.state.disconnected")
      : sync.state === "revoked"
        ? t("header.state.revoked")
        : sync.state === "error" && sync.lastError
          ? t("header.state.error", { error: sync.lastError })
          : sync.lastOkAt
            ? t("header.state.synced", {
                when: instantText(sync.lastOkAt, ctx, (time) => t("header.today", { time })),
              })
            : t("header.state.never");
  const stateTone =
    sync?.connected && (sync.state === "revoked" || sync.state === "error") ? "text-warn" : "";

  return (
    <Page
      title={<ServiceCrumb name={account.name} tabs={tabs} />}
      parent={{ href: "/investments" as Route, label: t("title") }}
    >
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div className="flex min-w-0 flex-col gap-1">
          <p className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-sm text-muted">
            <span>{t(`categories.${summary.investment.category}`)}</span>
            <span aria-hidden>·</span>
            <span data-testid="sync-state" className={stateTone}>
              {state}
            </span>
            {url && (
              <>
                <span aria-hidden>·</span>
                <a
                  href={url}
                  target="_blank"
                  rel="noopener noreferrer"
                  aria-label={t("actions.openSite", { name: account.name })}
                  className="focus-ring inline-flex min-h-6 items-center gap-1 rounded-[4px] text-accent hover:underline"
                >
                  {t("header.openSite", { name: account.name })}
                  <ExternalLink aria-hidden className="size-3.5" />
                </a>
              </>
            )}
          </p>
          <h1 className="text-title font-semibold tracking-[-0.02em]">{account.name}</h1>
        </div>
        <ServiceActions
          context={serviceContextOf(detail, ctx)}
          provider={providerOf(detail)}
          connected={synced && (sync?.connected ?? false)}
        />
      </header>

      <div className="flex flex-wrap items-end justify-between gap-x-4 gap-y-3">
        <div className="min-w-0 flex-1">
          <ServiceTabs label={t("tabs.label")} tabs={tabs} />
        </div>
        <ServicePeriodControl
          todayOn={today(ctx.timeZone)}
          firstOn={firstDayOf(detail)}
          locale={ctx.locale}
          hiddenOn={[`${base}/connection`]}
        />
      </div>

      {children}
    </Page>
  );
}
