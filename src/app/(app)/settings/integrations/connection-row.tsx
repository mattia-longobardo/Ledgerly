import { useTranslations } from "next-intl";
import type { ReactNode } from "react";
import { cn } from "@/ui/cn";
import { type Tone, TONE_TEXT } from "@/ui/tone";

/** What a row says the link is, including the state the database has no row for. */
export type ConnectionState = "absent" | "active" | "error" | "revoked";

const DOT: Record<ConnectionState, string> = {
  absent: "bg-faint",
  active: "bg-pos",
  error: "bg-neg",
  revoked: "bg-faint",
};

const STATUS_TONE: Record<ConnectionState, Tone> = {
  absent: "muted",
  active: "pos",
  error: "neg",
  revoked: "muted",
};

/**
 * One connection on Settings › Integrations: the same columns for every provider, data source or
 * investment service (PERS-158), so state, last sync, schedule and actions line up down the page.
 * What differs is only what the actions do, so they come in from the caller.
 */
export function ConnectionRow({
  name,
  role,
  state,
  lastSync,
  schedule,
  actions,
}: {
  name: string;
  role: string;
  state: ConnectionState;
  /** Already formatted by the page, which owns the locale and the zone; null when it never ran. */
  lastSync: string | null;
  /** The schedule control; the fixed label when there is no link yet. */
  schedule?: ReactNode;
  actions: ReactNode;
}) {
  const t = useTranslations("settings.integrations");
  return (
    <div className="@container">
      <div className="grid grid-cols-1 gap-x-5 gap-y-3 px-4 py-3.5 @min-[560px]:@max-[819px]:grid-cols-2 @min-[820px]:grid-cols-[minmax(0,1fr)_128px_minmax(0,1.4fr)_auto]">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-x-2">
            <span aria-hidden className={cn("size-[7px] shrink-0 rounded-full", DOT[state])} />
            <span className="min-w-0 font-semibold">{name}</span>
            <span className={cn("text-sm font-medium whitespace-nowrap", TONE_TEXT[STATUS_TONE[state]])}>
              {t(`states.${state}`)}
            </span>
          </div>
          <p className="mt-0.5 text-sm text-muted">{role}</p>
        </div>

        <div className="text-sm">
          <div className="text-muted">{t("fields.lastSync")}</div>
          <div className="mt-0.5 font-medium">{lastSync ?? t("fields.never")}</div>
        </div>

        <div className="min-w-0 text-sm">
          <div className="text-muted">{t("fields.schedule")}</div>
          {schedule ?? <div className="mt-0.5 font-medium">{t("schedule")}</div>}
        </div>

        <div className="flex flex-wrap items-center gap-2 @min-[560px]:@max-[819px]:col-span-2 @min-[820px]:w-[236px] @min-[820px]:justify-end">
          {actions}
        </div>
      </div>
    </div>
  );
}
