"use client";

// The row of a connection on the web: the row of `packages/ui` with what every connection does
// through `/api/v1/connections` (`connection-calls.ts`), whose codes are translated here into the
// sentences the row shows.
import { useTranslations } from "next-intl";
import type { ComponentProps } from "react";
import { codeKey } from "@ledgerly/domain/platform/integrations/client";
import { ConnectionRow as Row } from "@ledgerly/ui/connection-row";
import { isConnectionKind, runConnectionCall } from "./connection-calls";

export {
  type ActionKind,
  type ConnectionRowProps,
  type HistoryItem,
  type RowAction,
  type RowStatusValue,
} from "@ledgerly/ui/connection-row";
export { DeactivateLink } from "@ledgerly/ui/source-link-row";

type RunResult = { ok: true; toast: string | null } | { ok: false; message: string };

/** The toast of each kind that went through. */
const TOAST = {
  update: "toasts.started",
  resume: "toasts.resumed",
  enable: "toasts.enabled",
  test: "toasts.tested",
  history: "toasts.historyRead",
} as const;

/**
 * Does one thing to one of the person's connections — "Update now", "Turn on again", "Turn on",
 * "Test the connection", "Download the history again" — and answers the sentence to show.
 */
export function useRunConnection() {
  const text = useTranslations("settings.connections");
  // `months` is for "history" only: the row passes no third argument, and none is forwarded.
  return async (connectionId: string, kind: string, ...months: [months?: number]): Promise<RunResult> => {
    const failed: RunResult = { ok: false, message: text("codes.failed") };
    if (!isConnectionKind(kind)) return failed;
    const result = await runConnectionCall(connectionId, kind, ...months);
    if (result.ok) return { ok: true, toast: text(TOAST[kind], result.names) };
    const { refusal: code, names } = result;
    if (names === null) return failed;
    /** One branch per code so the catalogue keys stay literal. */
    if (code === "busy") return { ok: false, message: text("codes.busy") };
    if (code === "unavailable") return { ok: false, message: text("codes.unavailable") };
    if (code === "not_active") return { ok: false, message: text("text.pausedProvider", names) };
    if (code === "pending") return { ok: false, message: text("text.pending") };
    return { ok: false, message: text(`codes.${codeKey(code)}`, names) };
  };
}

export function ConnectionRow(props: Omit<ComponentProps<typeof Row>, "run">) {
  return <Row {...props} run={useRunConnection()} />;
}
