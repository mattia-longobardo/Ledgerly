"use client";

// A service's Connection (docs/design/investments-ux.md §3.6, U3): what the provider gives, row by row,
// in words; the readings with the runs of equal ones folded; the manual corrections; the key; the
// settings. A manual account calls it Settings and has only the corrections and the settings. Always
// «today»: no period here (§2.3). Read from `GET /investments/{accountId}/connection`, the session's only.
import { AlertTriangle } from "lucide-react";
import { useTranslations } from "next-intl";
import { investments } from "@ledgerly/api-contract/investments";
import { useApi } from "@ledgerly/ui/data";
import { Loaded } from "@ledgerly/ui/loaded";
import type { ServicePage } from "../service/service-view";
import type { Connection } from "./connection-view";
import { CorrectionsCard } from "./corrections-card";
import { KeyCard } from "./key-card";
import { ReadingsCard } from "./readings-card";
import { ReceivedCard } from "./received-card";
import { SettingsCard } from "./settings-card";

function Alerts({ connection }: { connection: Connection }) {
  const text = useTranslations("investments");
  const { warnings } = connection;
  const alerts = [
    warnings.conflicts > 0 && text("warnings.conflict", { count: warnings.conflicts }),
    warnings.pendingZero && text("warnings.pendingZero"),
    warnings.missingPrices > 0 && text("warnings.missingPrices", { count: warnings.missingPrices }),
    warnings.openAdjustments > 0 && text("warnings.openAdjustments", { count: warnings.openAdjustments }),
  ].filter((line) => typeof line === "string");
  if (alerts.length === 0) return null;
  return (
    <p
      data-testid="connection-alerts"
      className="flex flex-wrap items-center gap-2 rounded-[6px] border border-border bg-warn-bg px-3 py-2 text-sm"
    >
      <AlertTriangle aria-hidden className="size-4 text-warn" />
      <span className="font-medium">{text("connection.alerts")}:</span>
      <span>{alerts.join(" · ")}</span>
    </p>
  );
}

function ConnectionView({ page, connection }: { page: ServicePage; connection: Connection }) {
  const { sync } = connection;
  return (
    <>
      <Alerts connection={connection} />
      <div className="grid items-start gap-4 @4xl:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
        <div className="flex min-w-0 flex-col gap-4">
          {sync && <ReceivedCard page={page} connection={connection} sync={sync} />}
          {sync && <ReadingsCard page={page} connection={connection} />}
          <CorrectionsCard page={page} connection={connection} />
        </div>
        <div className="flex min-w-0 flex-col gap-4">
          {sync && <KeyCard page={page} connection={connection} sync={sync} />}
          <SettingsCard page={page} connection={connection} />
        </div>
      </div>
    </>
  );
}

export function ConnectionTab({ page }: { page: ServicePage }) {
  const read = useApi(investments.getInvestmentConnection, { params: { accountId: page.id } });
  return (
    <Loaded state={read}>{(connection) => <ConnectionView page={page} connection={connection} />}</Loaded>
  );
}
