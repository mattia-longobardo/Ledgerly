import { getTranslations } from "next-intl/server";
import { PROVIDER_SCHEDULE } from "@ledgerly/domain/investments/client";
import { DEFAULT_SYNC_SCHEDULE } from "@ledgerly/domain/platform/integrations/client";
import { BANK_SCHEDULE, MAX_BANK_SYNCS_PER_DAY } from "@ledgerly/domain/platform/plugins";
import { formatInstant, type UiLocale } from "@ledgerly/format/format";
import type { WireConnection } from "./connection-view";
import { ConnectionSchedule } from "@/ui/connection-schedule";

/**
 * When one connection is read by itself (ux/n2-connection-status.md §8): the control for a source
 * read by the core or a bank's plugin (a bank's at most `MAX_BANK_SYNCS_PER_DAY` a day), and nothing to
 * change while the person has the plugin off. On the page of a source and, for the services, on "Advanced".
 */
export async function ScheduleCell({
  connection,
  name,
  provider,
  active,
  ctx,
}: {
  connection: Pick<WireConnection, "id" | "provider" | "schedule" | "nextSyncAt" | "service" | "shared">;
  /** The connection's name and its provider's, as the person reads them. */
  name: string;
  provider: string;
  active: boolean;
  ctx: { locale: UiLocale; timeZone: string };
}) {
  const t = await getTranslations("settings.connections");
  const next = connection.nextSyncAt ? formatInstant(new Date(connection.nextSyncAt), ctx) : null;
  if (!active) return <span className="text-muted">{t("text.pausedProvider", { provider })}</span>;
  const bank = connection.shared !== null;
  return (
    <ConnectionSchedule
      connectionId={connection.id}
      name={name}
      schedule={connection.schedule}
      // What "Use recommended" fills in: a bank's three readings, a service with a key at the provider's own times.
      recommended={
        bank ? BANK_SCHEDULE : connection.service === null ? DEFAULT_SYNC_SCHEDULE : PROVIDER_SCHEDULE
      }
      maxPerDay={bank ? MAX_BANK_SYNCS_PER_DAY : undefined}
      next={next}
      timeZone={ctx.timeZone}
    />
  );
}
