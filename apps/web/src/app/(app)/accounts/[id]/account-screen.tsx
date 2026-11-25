"use client";

// An account's page, read from `/api/v1` (rewrite plan R3): the header is the account, its row of
// `GET /net-worth` and its context; each tab reads only what it shows (audit UI-ACC-7), from a file
// of its own (UI-ACC-8). Every figure is a field of the API: the screen formats.
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useTranslations } from "next-intl";
import type { ReactNode } from "react";
// `accountRoutes`: `accounts` is also the name of the table, which the gate of M5 counts.
import { accounts as accountRoutes, views } from "@ledgerly/api-contract/accounts";
import { profile } from "@ledgerly/api-contract/settings";
import type { RouteOutput } from "@ledgerly/api-client";
import { formatMoney, formatPercent, NULL_DISPLAY, numberStyle } from "@ledgerly/format/format";
import { Badge } from "@ledgerly/ui/badge";
import { useApi } from "@ledgerly/ui/data";
import { DetailHeader } from "@ledgerly/ui/detail-header";
import { Loaded } from "@ledgerly/ui/loaded";
import { StateWord } from "@ledgerly/ui/plugin-row";
import { Page } from "@ledgerly/ui/shell/page";
import { EmptyState } from "@ledgerly/ui/states";
import { SyncStatus } from "@ledgerly/ui/sync-status";
import { TabLinks } from "@ledgerly/ui/tab-links";
import { TONE_TEXT, toneOfSign } from "@ledgerly/ui/tone";
import { type CardFormat, centsOf, colorFor, CsvImportButton, counterValue } from "@/modules/accounts/client";
import { AccountConnection } from "./connection-status";
import { EntriesTab } from "./entries-tab";
import { OverviewTab } from "./overview-tab";
import { SettingsTab } from "./settings-tab";
import { StoppedBanner } from "./source-state";

const TABS = ["overview", "transactions", "entries", "settings"] as const;

type NetWorth = RouteOutput<typeof views.getNetWorth>;

/** What every tab knows of the account: read once, for the header. */
export interface AccountPage {
  account: RouteOutput<typeof accountRoutes.getAccount>;
  /** The account today, in `GET /net-worth`. */
  row: NetWorth["accounts"][number];
  /** Its place in the list, the one `colorFor` colours it by. */
  index: number;
  context: RouteOutput<typeof views.getAccountContext>;
  format: CardFormat;
  /** Where the balance comes from: "Manual", or the provider that syncs it. */
  source: string;
  color: string;
}

export function AccountScreen({ id }: { id: string }) {
  const text = useTranslations("accounts");
  const preferences = useApi(profile.getPreferences, {});
  const account = useApi(accountRoutes.getAccount, { params: { id } });
  // The header and the KPIs speak of today whatever window the chart shows (spec §7.1, F2.5). An
  // archived account still has its page, with «Restore account»: the view includes it.
  const today = useApi(views.getNetWorth, { query: { includeArchived: "true" } });
  const context = useApi(views.getAccountContext, { params: { id } });
  return (
    <Page title={account.data?.name ?? ""} parent={{ href: "/accounts", label: text("title") }}>
      <Loaded state={preferences}>
        {(prefs) => (
          <Loaded state={account}>
            {(read) => (
              <Loaded state={today}>
                {(view) => (
                  <Loaded state={context}>
                    {(around) => (
                      <AccountView
                        view={view}
                        page={{
                          account: read,
                          context: around,
                          format: {
                            locale: prefs.locale,
                            timeZone: prefs.timeZone,
                            numberFormat: numberStyle(prefs),
                          },
                        }}
                      />
                    )}
                  </Loaded>
                )}
              </Loaded>
            )}
          </Loaded>
        )}
      </Loaded>
    </Page>
  );
}

function AccountView({
  view,
  page: read,
}: {
  view: NetWorth;
  page: Pick<AccountPage, "account" | "context" | "format">;
}) {
  const text = useTranslations("accounts");
  const detailText = useTranslations("accounts.detail");
  const search = useSearchParams();
  const { account } = read;
  const index = view.accounts.findIndex((one) => one.id === account.id);
  if (index < 0) return null;
  const row = view.accounts[index];
  // Still tied to its source, with no connection to it: the source was disconnected, and a new
  // connection to it ties the account again (ux n1 §5.4).
  const disconnected =
    row.service === null &&
    account.origin === "synced" &&
    read.context.connectionId === null &&
    account.sourceState !== "stopped";
  const source = sourceOf(text, { ...read, row }, disconnected);
  const page: AccountPage = { ...read, row, index, source, color: colorFor(account, index) };
  const requested = search.get("tab");
  const tab = TABS.find((key) => key === requested) ?? "overview";
  const tabs = TABS.map((key) => ({
    href: key === "overview" ? `/accounts/${account.id}` : `/accounts/${account.id}?tab=${key}`,
    label: detailText(`tabs.${key}`),
    active: key === tab,
  }));
  return (
    <>
      <Header page={page} view={view} disconnected={disconnected} />
      <TabLinks label={detailText("tabs.label")} tabs={tabs} />
      {tab === "overview" && <OverviewTab page={page} />}
      {tab === "transactions" && (
        <EmptyState
          title={detailText("transactions.title")}
          description={detailText("transactions.description")}
        />
      )}
      {tab === "entries" && <EntriesTab page={page} />}
      {tab === "settings" && <SettingsTab page={page} />}
    </>
  );
}

type AccountsText = ReturnType<typeof useTranslations<"accounts">>;

/** Where the balance comes from: the provider of its Investments service, "Manual", or its source. */
function sourceOf(
  text: AccountsText,
  { account, row, context }: Pick<AccountPage, "account" | "row" | "context">,
  disconnected: boolean,
): string {
  if (row.service !== null) return text("origins.syncedWith", { provider: row.service.provider });
  if (account.origin === "manual") return text("origins.manual");
  return text(disconnected ? "origins.disconnectedFrom" : "origins.syncedWith", {
    provider: context.providerLabel ?? "",
  });
}

/** How fresh the balance is: «Stopped» for an account whose plugin is off, else its last reading. */
function syncMeta(page: AccountPage, stopped: string): ReactNode {
  const { account, row } = page;
  if (account.sourceState === "stopped") return <StateWord word={stopped} tone="warn" />;
  if (account.origin !== "synced" && row.service === null) return null;
  return (
    <span>
      <SyncStatus
        lastSyncedAt={row.service?.lastSyncedAt ?? row.lastSyncedAt}
        now={new Date().toISOString()}
      />
    </span>
  );
}

function Header({ page, view, disconnected }: { page: AccountPage; view: NetWorth; disconnected: boolean }) {
  const text = useTranslations("accounts");
  const detailText = useTranslations("accounts.detail");
  const { account, row } = page;
  return (
    <DetailHeader
      meta={[
        <>
          <span aria-hidden className="size-2 rounded-full" style={{ background: page.color }} />
          <span>{text(`types.${account.type}`)}</span>
        </>,
        disconnected ? <Badge tone="warn">{page.source}</Badge> : <span>{page.source}</span>,
        syncMeta(page, text("origins.stopped")),
      ]}
      tags={
        <>
          {account.state !== "active" && <Badge tone="warn">{text(`states.${account.state}`)}</Badge>}
          {row.stale && <Badge tone="warn">{text("stale")}</Badge>}
          {page.context.inInvestments && (
            <Link
              href={`/investments/${account.id}`}
              className="focus-ring inline-flex min-h-6 items-center rounded-sm text-accent hover:underline"
            >
              {detailText("managedInInvestments")}
            </Link>
          )}
        </>
      }
      above={
        account.sourceState === "stopped" ? (
          <StoppedBanner page={page} />
        ) : (
          page.context.connectionId !== null && (
            <AccountConnection
              connectionId={page.context.connectionId}
              // A service of Investments fed by a provider has its key replaced on its own page.
              keyHref={row.service !== null ? `/investments/${account.id}/connection` : null}
              format={page.format}
            />
          )
        )
      }
      title={account.name}
      actions={<CsvImport page={page} />}
    >
      <Figures page={page} view={view} />
    </DetailHeader>
  );
}

/** «Import CSV», only on an open account «a mano»: the route refuses any other (R5c). */
function CsvImport({ page }: { page: AccountPage }) {
  const { account, row } = page;
  if (account.origin !== "manual" || account.state !== "active" || row.service !== null) return null;
  return (
    <CsvImportButton
      accountId={account.id}
      accountName={account.name}
      currency={account.currency}
      format={page.format}
    />
  );
}

/** Today's balance, its line in the display currency, its change this month and its share. */
function Figures({ page, view }: { page: AccountPage; view: NetWorth }) {
  const detailText = useTranslations("accounts.detail");
  const { account, row, format } = page;
  const own = { currency: account.currency };
  const change = centsOf(row.change.amount);
  const counter = counterValue(
    { currency: row.currency, display: { balance: centsOf(row.display.balance) } },
    view.currency,
    format.numberFormat,
  );
  return (
    <p className="flex flex-wrap items-baseline gap-3">
      <span className="text-hero-sm font-semibold tracking-title">
        {formatMoney(centsOf(row.balance), format.numberFormat, own)}
      </span>
      {counter && <span className="text-sm text-muted">{counter}</span>}
      <span className={`text-sm font-medium ${TONE_TEXT[toneOfSign(change)]}`}>
        {change === null ? NULL_DISPLAY : formatMoney(change, format.numberFormat, { signed: true, ...own })}{" "}
        {detailText("thisMonth")}
      </span>
      <span className="text-sm text-muted">
        {detailText("shareOfNetWorth", { value: formatPercent(row.share, format.numberFormat) })}
      </span>
    </p>
  );
}
