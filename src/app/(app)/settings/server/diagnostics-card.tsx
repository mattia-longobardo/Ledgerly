import { getTranslations } from "next-intl/server";
import type { Ctx } from "@/platform/context";
import { type PluginDiagnostic, pluginDiagnostics } from "@/platform/plugins/queries";
import { cn } from "@/ui/cn";
import { type Tone, TONE_TEXT } from "@/ui/tone";

const LOOK: Record<PluginDiagnostic["state"], { dot: string; tone: Tone }> = {
  up: { dot: "bg-pos", tone: "pos" },
  down: { dot: "bg-neg", tone: "neg" },
  never: { dot: "bg-faint", tone: "muted" },
  incompatible: { dot: "bg-warn", tone: "warn" },
};

/**
 * Admin › Server, "Diagnostics" (ux/n2-connection-status.md §9; decision H29): whether each
 * plugin of the instance answers. Read only, and nothing of any person — no connection, no
 * reading, no error of a connection: the log of a person's readings is that person's alone.
 */
export async function DiagnosticsCard({ ctx }: { ctx: Pick<Ctx, "locale" | "timeZone"> }) {
  const t = await getTranslations("settings.diagnostics");
  let plugins: PluginDiagnostic[];
  try {
    plugins = await pluginDiagnostics(ctx.locale);
  } catch {
    return (
      <p role="alert" className="p-4 text-neg">
        {t("unavailable")}
      </p>
    );
  }
  if (plugins.length === 0) return <p className="p-4 text-muted">{t("empty")}</p>;

  const time = new Intl.DateTimeFormat(ctx.locale, {
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
    timeZone: ctx.timeZone,
  });
  /** The second line of a plugin, one branch per state so the catalogue keys stay literal. */
  const detail = (plugin: PluginDiagnostic): string => {
    if (plugin.state === "never") return t("neverDetail");
    if (plugin.state === "incompatible") return t("incompatibleDetail", { version: plugin.contract ?? "" });
    if (plugin.at === null) return "";
    return plugin.state === "up"
      ? t("checked", { time: time.format(plugin.at) })
      : t("since", { time: time.format(plugin.at) });
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
                {t(plugin.state)}
              </span>
            </div>
            <p className="mt-0.5 text-sm text-muted">{detail(plugin)}</p>
          </div>
          {plugin.version !== null && plugin.contract !== null && (
            <span className="text-sm whitespace-nowrap text-muted">
              {t("version", { version: plugin.version, contract: plugin.contract })}
            </span>
          )}
        </li>
      ))}
    </ul>
  );
}
