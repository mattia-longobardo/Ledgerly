"use client";

import { useTranslations } from "next-intl";
import { server } from "@ledgerly/api-contract/settings";
import type { RouteOutput } from "@ledgerly/api-client";
import { cn } from "@ledgerly/ui/cn";
import { useApi } from "@ledgerly/ui/data";
import { type Tone, TONE_TEXT } from "@ledgerly/ui/tone";

type PluginDiagnostic = RouteOutput<typeof server.getDiagnostics>["plugins"][number];

const LOOK: Record<PluginDiagnostic["state"], { dot: string; tone: Tone }> = {
  up: { dot: "bg-pos", tone: "pos" },
  down: { dot: "bg-neg", tone: "neg" },
  never: { dot: "bg-faint", tone: "muted" },
  incompatible: { dot: "bg-warn", tone: "warn" },
};

/**
 * Admin › Server, "Diagnostics" (ux/n2-connection-status.md §9; decision H29): whether each
 * plugin of the instance answers, from `GET /server/diagnostics`. Read only, and nothing of any
 * person — no connection, no reading, no error of a connection: the log of a person's readings is
 * that person's alone.
 */
export function DiagnosticsCard({ prefs }: { prefs: { locale: string; timeZone: string } }) {
  const text = useTranslations("settings.diagnostics");
  const answer = useApi(server.getDiagnostics, {});
  if (answer.error && answer.data === undefined) {
    return (
      <p role="alert" className="p-4 text-neg">
        {text("unavailable")}
      </p>
    );
  }
  if (answer.data === undefined) return null;
  const { plugins } = answer.data;
  if (plugins.length === 0) return <p className="p-4 text-muted">{text("empty")}</p>;

  const time = new Intl.DateTimeFormat(prefs.locale, {
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
    timeZone: prefs.timeZone,
  });
  /** The second line of a plugin, one branch per state so the catalogue keys stay literal. */
  const detail = (plugin: PluginDiagnostic): string => {
    if (plugin.state === "never") return text("neverDetail");
    if (plugin.state === "incompatible")
      return text("incompatibleDetail", { version: plugin.contract ?? "" });
    if (plugin.at === null) return "";
    const moment = time.format(new Date(plugin.at));
    return plugin.state === "up" ? text("checked", { time: moment }) : text("since", { time: moment });
  };

  return (
    <ul className="flex flex-col">
      {plugins.map((plugin) => (
        <li
          key={plugin.id}
          data-testid="plugin-diagnostic"
          data-state={plugin.state}
          className="flex flex-col gap-x-5 gap-y-0.5 border-b border-border px-4 py-3 last:border-0 md:flex-row md:items-start md:justify-between"
        >
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-x-2">
              <span aria-hidden className={cn("size-[7px] shrink-0 rounded-full", LOOK[plugin.state].dot)} />
              <span className="min-w-0 font-semibold break-words">{plugin.name}</span>
              <span
                className={cn("text-sm font-medium whitespace-nowrap", TONE_TEXT[LOOK[plugin.state].tone])}
              >
                {text(plugin.state)}
              </span>
            </div>
            <p className="mt-0.5 text-sm text-muted">{detail(plugin)}</p>
          </div>
          {plugin.version !== null && plugin.contract !== null && (
            <span className="text-sm whitespace-nowrap text-muted">
              {text("version", { version: plugin.version, contract: plugin.contract })}
            </span>
          )}
        </li>
      ))}
    </ul>
  );
}
