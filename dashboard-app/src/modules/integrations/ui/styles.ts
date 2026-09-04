/** The same values `settings/_components/SettingsForms.tsx` uses privately. */
export const FIELD =
  "min-h-11 w-full min-w-0 rounded-md border border-border bg-surface px-3 text-body text-fg";
export const LABEL = "text-caption tracking-wide text-fg-muted uppercase";
export const PRIMARY =
  "inline-flex min-h-11 self-start items-center justify-center gap-2 rounded-md bg-accent px-4 text-body-sm font-medium text-accent-contrast transition-colors hover:bg-accent-hover disabled:opacity-40";
export const SECONDARY =
  "inline-flex min-h-11 self-start items-center justify-center rounded-md border border-border bg-surface px-4 text-body-sm font-medium text-fg transition-colors hover:bg-surface-hover disabled:opacity-40";
export const DANGER =
  "inline-flex min-h-11 self-start items-center justify-center rounded-md border border-negative px-4 text-body-sm font-medium text-negative transition-colors hover:bg-negative/5 disabled:opacity-40";

export const STATUS_LABEL: Record<string, string> = {
  connected: "Connected",
  error: "Error",
  disabled: "Disabled",
  disconnected: "Not connected",
};

export const STATUS_TONE: Record<string, string> = {
  connected: "text-positive",
  error: "text-negative",
  disabled: "text-fg-muted",
  disconnected: "text-fg-muted",
};
