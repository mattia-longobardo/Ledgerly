import { getTranslations } from "next-intl/server";
import { PROVIDER_SCHEDULE } from "@ledgerly/domain/investments/client";
import { DEFAULT_SYNC_SCHEDULE, isPluginProvider } from "@ledgerly/domain/platform/integrations/client";
import { formatInstant, type UiLocale } from "@ledgerly/format/format";
import type { WireConnection } from "./connection-view";
import { ConnectionSchedule } from "@/ui/connection-schedule";

/**
 * When one connection is read by itself (ux/n2-connection-status.md §8): the control for a source
 * of the core, the provider's fixed times for a plugin, and nothing to change while the person has
 * the plugin off. On the page of a source and, for the services, on "Advanced".
 */
export async function ScheduleCell({
  connection,
  name,
  provider,
  active,
  ctx,
}: {
  connection: Pick<WireConnection, "id" | "provider" | "schedule" | "nextSyncAt" | "service">;
  /** The connection's name and its provider's, as the person reads them. */
  name: string;
  provider: string;
  active: boolean;
  ctx: { locale: UiLocale; timeZone: string };
}) {
  const t = await getTranslations("settings.connections");
  const times = connection.schedule.rules.reduce(
    (sum, rule) => sum + (rule.kind === "times" ? rule.times.length : 0),
    0,
  );
  const next = connection.nextSyncAt ? formatInstant(new Date(connection.nextSyncAt), ctx) : null;
  if (!active) return <span className="text-muted">{t("text.pausedProvider", { provider })}</span>;
  if (isPluginProvider(connection.provider)) {
    // The schedule of a plugin's connection is the provider's own: no control.
    return (
      <span className={times === 0 ? "text-muted" : undefined}>
        {times === 0
          ? t("advanced.schedule.off")
          : next === null
            ? t("advanced.schedule.fixedNoNext", { count: times })
            : t("advanced.schedule.fixed", { count: times, time: next })}
      </span>
    );
  }
  return (
    <ConnectionSchedule
      connectionId={connection.id}
      name={name}
      schedule={connection.schedule}
      // What "Use recommended" fills in: a service with a key reads at the provider's own times.
      recommended={connection.service === null ? DEFAULT_SYNC_SCHEDULE : PROVIDER_SCHEDULE}
      next={next}
      timeZone={ctx.timeZone}
    />
  );
}
