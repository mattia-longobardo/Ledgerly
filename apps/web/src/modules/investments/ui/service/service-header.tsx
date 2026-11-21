"use client";

// A service's header (docs/design/investments-ux.md §1.1, §3.2, U3): what it is, how its sync stands,
// its site and its commands. The sync's last error is the Connection tab's read (SEC-08): only the
// session reads it, and only when the sync is in error.
import { ExternalLink } from "lucide-react";
import { useTranslations } from "next-intl";
import { investments } from "@ledgerly/api-contract/investments";
import { useApi } from "@ledgerly/ui/data";
import type { DetailHeader } from "@ledgerly/ui/detail-header";
import { instantText } from "../present";
import { ServiceActions } from "../service-actions";
import type { ServicePage } from "./service-view";

/** «Synced today 07:30», or «Never synced». */
function SyncedText({ page }: { page: ServicePage }) {
  const text = useTranslations("investments");
  const lastOkAt = page.overview.service.sync?.lastOkAt ?? null;
  if (lastOkAt === null) return <>{text("header.state.never")}</>;
  return (
    <>
      {text("header.state.synced", {
        when: instantText(lastOkAt, page.say, (time) => text("header.today", { time })),
      })}
    </>
  );
}

/** «Sync error: …», with the error the Connection tab reads; without one, when it last synced. */
function SyncError({ page }: { page: ServicePage }) {
  const text = useTranslations("investments");
  const read = useApi(investments.getInvestmentConnection, { params: { accountId: page.id } });
  const error = read.data?.sync?.lastError ?? null;
  return error ? <>{text("header.state.error", { error })}</> : <SyncedText page={page} />;
}

/** The sync in words (S12): never "Per asset" or "Managed since", which are in Connection. */
function SyncState({ page }: { page: ServicePage }) {
  const text = useTranslations("investments");
  const { service } = page.overview;
  const sync = service.sync;
  if (!sync)
    return (
      <>{service.accountOrigin === "synced" ? text("header.state.bySource") : text("header.state.manual")}</>
    );
  if (!sync.connected) return <>{text("header.state.disconnected")}</>;
  if (sync.state === "revoked") return <>{text("header.state.revoked")}</>;
  if (sync.state === "error") return <SyncError page={page} />;
  return <SyncedText page={page} />;
}

/** The props of the page's `DetailHeader`. */
export function useServiceHeader(page: ServicePage): Parameters<typeof DetailHeader>[0] {
  const text = useTranslations("investments");
  const { service } = page.overview;
  const sync = service.sync;
  const warn = sync?.connected && (sync.state === "revoked" || sync.state === "error");
  return {
    meta: [
      <span key="category">{text(`categories.${service.category}`)}</span>,
      <span key="state" data-testid="sync-state" className={warn ? "text-warn" : ""}>
        <SyncState page={page} />
      </span>,
      service.url && (
        <a
          key="site"
          href={service.url}
          target="_blank"
          rel="noopener noreferrer"
          aria-label={text("actions.openSite", { name: service.name })}
          className="focus-ring inline-flex min-h-6 items-center gap-1 rounded-sm text-accent hover:underline"
        >
          {text("header.openSite", { name: service.name })}
          <ExternalLink aria-hidden className="size-3.5" />
        </a>
      ),
    ],
    title: service.name,
    actions: (
      <ServiceActions
        context={page.context}
        provider={service.provider}
        connected={service.origin === "synced" && (sync?.connected ?? false)}
      />
    ),
  };
}
