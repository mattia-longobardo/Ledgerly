"use client";

// The state of a sync (audit UI-ACC-1): «kept by hand», «never», or how long ago the last good
// reading was, in the coarse steps of the design's «Last synced» column. One model for every place
// that says it: whether the account is kept by hand, and the instant of its last sync.
import { useTranslations } from "use-intl";

type Since = { unit: "never" } | { unit: "minutes" | "hours" | "days"; count: number };

/** How long ago an instant was, in the coarse steps the design's "Last synced" column uses. */
export function since(instant: Date | null, now: Date): Since {
  if (instant === null) return { unit: "never" };
  const minutes = Math.max(0, Math.round((now.getTime() - instant.getTime()) / 60_000));
  if (minutes < 60) return { unit: "minutes", count: minutes };
  const hours = Math.round(minutes / 60);
  if (hours < 48) return { unit: "hours", count: hours };
  return { unit: "days", count: Math.round(hours / 24) };
}

export function SyncStatus({
  manual = false,
  lastSyncedAt,
  now,
}: {
  /** Kept by hand: there is no sync to speak of. */
  manual?: boolean;
  /** ISO of the last good sync, or null when there has been none. */
  lastSyncedAt: string | null;
  /** ISO of the moment the page speaks of, so the server and the browser say the same. */
  now: string;
}) {
  const text = useTranslations("accounts");
  if (manual) return text("origins.manual");
  const synced = since(lastSyncedAt === null ? null : new Date(lastSyncedAt), new Date(now));
  return synced.unit === "never"
    ? text("synced.never")
    : text(`synced.${synced.unit}`, { count: synced.count });
}
