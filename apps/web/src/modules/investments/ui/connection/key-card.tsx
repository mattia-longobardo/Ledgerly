"use client";

// The key of a connected service (§4.3, §5): its state, its last check, the IP restriction, when it last
// read and when it was set, the schedule, and the commands; the retired keys to revoke; where the data
// comes from. Never a credential: the session's route answers only what the page shows.
import { useTranslations } from "next-intl";
import { connections } from "@ledgerly/api-contract/settings";
import { PROVIDER_SCHEDULE } from "@ledgerly/domain/investments/client";
import { civilDateIn } from "@ledgerly/format/dates";
import { formatDate, formatInstant, NULL_DISPLAY } from "@ledgerly/format/format";
import { Badge } from "@ledgerly/ui/badge";
import { Card } from "@ledgerly/ui/card";
import { useApi } from "@ledgerly/ui/data";
import { ConnectionSchedule } from "@/ui/connection-schedule";
import { KeyCheckLine } from "../key-check";
import { instantText } from "../present";
import { useProviderWords } from "../provider-words";
import type { ServicePage } from "../service/service-view";
import { ConfirmRevokedButton, DisconnectButton, ReplaceKeyButton, SyncButtons } from "../sync";
import type { Connection, Sync } from "./connection-view";

/** The schedule of the connection, from Settings › Integrations' own read. */
function Schedule({ page, sync, name }: { page: ServicePage; sync: Sync; name: string }) {
  const text = useTranslations("investments");
  const integrations = useTranslations("settings.integrations");
  const read = useApi(connections.listConnections, {});
  const connection = read.data?.connections.find((one) => one.id === sync.connectionId);
  if (!connection) return null;
  return (
    <div className="text-sm">
      <div className="text-muted">{integrations("fields.schedule")}</div>
      <ConnectionSchedule
        connectionId={connection.id}
        name={name}
        schedule={connection.schedule}
        // A service's connection is always a provider's key: two readings a day are what it starts on.
        recommended={PROVIDER_SCHEDULE}
        next={sync.nextSyncAt ? formatInstant(new Date(sync.nextSyncAt), page.say) : null}
        timeZone={page.say.timeZone}
      />
      <p className="mt-1.5 text-muted">{text("sync.readingsNote")}</p>
    </div>
  );
}

function KeyFacts({ page, connection, sync }: { page: ServicePage; connection: Connection; sync: Sync }) {
  const text = useTranslations("investments");
  const { say } = page;
  const check = sync.lastCheck;
  return (
    <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-4 gap-y-1.5 text-sm">
      <dt className="text-muted">{text("connection.key.permissions")}</dt>
      <dd>
        {check ? (
          <KeyCheckLine
            text={text("sync.keyCheck", {
              result: text(`sync.results.${check.result}`),
              date: instantText(check.checkedAt, say, (time) => text("header.today", { time })),
            })}
            ipRestricted={null}
          />
        ) : (
          NULL_DISPLAY
        )}
      </dd>
      {connection.provider?.ipWhitelist && (
        <>
          <dt className="text-muted">{text("connection.key.ip")}</dt>
          <dd className="flex flex-col">
            <span>{check?.ipRestricted ? text("connection.key.ipOn") : text("connection.key.ipOff")}</span>
            {!check?.ipRestricted && (
              <span className="text-muted">{text("connection.key.ipAdvice", { name: connection.name })}</span>
            )}
          </dd>
        </>
      )}
      <dt className="text-muted">{text("sync.lastOk")}</dt>
      <dd>{sync.lastOkAt ? formatInstant(new Date(sync.lastOkAt), say) : NULL_DISPLAY}</dd>
      <dt className="text-muted">{text("sync.keySet")}</dt>
      <dd>
        {sync.keySetAt
          ? formatDate(civilDateIn(new Date(sync.keySetAt), say.timeZone), "long", say.locale)
          : NULL_DISPLAY}
      </dd>
    </dl>
  );
}

function Revoke({ page, connection }: { page: ServicePage; connection: Connection }) {
  const text = useTranslations("investments");
  return (
    <div className="flex flex-col gap-2 rounded-[6px] border border-border p-3 text-sm">
      <p className="font-medium">{text("sync.revokeTitle")}</p>
      <p className="text-muted">{text("sync.revokeSteps")}</p>
      <div className="flex flex-wrap items-center gap-2">
        {connection.provider?.revokeUrl && (
          <a
            href={connection.provider.revokeUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="focus-ring inline-flex min-h-6 items-center gap-1 rounded-sm text-accent hover:underline"
          >
            {text("sync.revokeOpen")}
          </a>
        )}
        <ConfirmRevokedButton accountId={page.id} />
      </div>
    </div>
  );
}

export function KeyCard({
  page,
  connection,
  sync,
}: {
  page: ServicePage;
  connection: Connection;
  sync: Sync;
}) {
  const text = useTranslations("investments");
  const brand = useProviderWords(sync.provider)?.brand;
  const state = sync.state ?? "error";
  return (
    <Card className="flex min-w-0 flex-col gap-3" data-testid="service-connection">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-lg font-semibold">{text("connection.key.title")}</h2>
        {sync.connected && (
          <Badge tone={state === "active" ? "pos" : state === "revoked" ? "neg" : "warn"}>
            {text(`sync.states.${state}`)}
          </Badge>
        )}
      </div>
      {sync.connected ? (
        <>
          <KeyFacts page={page} connection={connection} sync={sync} />
          {sync.lastError && (
            <p className="text-sm text-warn">{text("sync.lastError", { error: sync.lastError })}</p>
          )}
          {sync.rotateDue && <p className="text-sm text-warn">{text("sync.rotate")}</p>}
          <Schedule page={page} sync={sync} name={connection.name} />
          <div className="flex flex-wrap gap-2">
            <SyncButtons accountId={page.id} />
            {connection.provider && <ReplaceKeyButton accountId={page.id} provider={connection.provider} />}
            <DisconnectButton accountId={page.id} name={connection.name} />
          </div>
        </>
      ) : (
        <p className="text-sm text-muted">{text("sync.disconnected")}</p>
      )}
      {sync.revokePending && <Revoke page={page} connection={connection} />}
      {brand && <p className="text-xs text-muted">{brand}</p>}
    </Card>
  );
}
