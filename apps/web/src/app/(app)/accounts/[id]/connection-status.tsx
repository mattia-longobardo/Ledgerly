"use client";

// The state of the connection an account comes from, for the header of the account's page
// (ux/n2-connection-status.md §3.3, decision Q3): the same state and the same sentence as the row
// of Settings › Integrations, in its short form. The state is `GET /connections`'s (`status`, the
// server's one rule); the screen only says it, with the time phrases of `@ledgerly/format/dates`.
import { useTranslations } from "next-intl";
import { useEffect } from "react";
import { connections } from "@ledgerly/api-contract/settings";
import type { RouteOutput } from "@ledgerly/api-client";
import { relativeNext, relativePast } from "@ledgerly/format/dates";
import { formatDate, formatInstant, type UiLocale } from "@ledgerly/format/format";
import { ConnectionRow, type ConnectionRowProps, type RowAction } from "@ledgerly/ui/connection-row";
import { invalidate, useApi } from "@ledgerly/ui/data";
import { useRunConnection } from "../../settings/plugins/connection-row";

export type ApiConnection = RouteOutput<typeof connections.listConnections>["connections"][number];
type StatusKind = NonNullable<ApiConnection["status"]["action"]>;
type Text = ReturnType<typeof useTranslations<"settings.connections">>;

const SETTINGS = "/settings/plugins";
/** While a reading runs the row reads again: every 5 seconds, for 2 minutes at most. */
const REFRESH_MS = 5_000;
const REFRESH_FOR_MS = 120_000;

/** The time phrases of the row, in the person's zone and words. */
function phrases(text: Text, where: { locale: UiLocale; timeZone: string }, now: Date) {
  const day = (date: string) => formatDate(date, "dayMonth", where.locale);
  return {
    past(instant: Date): string {
      const when = relativePast(instant, now, where.timeZone);
      if (when.key === "now") return text("when.now");
      if (when.key === "minutes") return text("when.minutes", { count: when.count });
      if (when.key === "hours") return text("when.hours", { count: when.count });
      if (when.key === "yesterday") return text("when.yesterday", { time: when.time });
      return text("when.date", { date: day(when.date), time: when.time });
    },
    next(instant: string | null): string {
      const when = relativeNext(instant === null ? null : new Date(instant), now, where.timeZone);
      if (when.key === "soon") return text("next.soon");
      if (when.key === "today") return text("next.today", { time: when.time });
      if (when.key === "tomorrow") return text("next.tomorrow", { time: when.time });
      return text("next.date", { date: day(when.date), time: when.time });
    },
  };
}

/**
 * The short row's state of one connection. `keyHref`: where the provider's key is replaced, when that
 * is not Settings › Integrations (a service of Investments has its own page).
 */
export function connectionStatus(
  text: Text,
  connection: ApiConnection,
  where: { locale: UiLocale; timeZone: string; keyHref: string | null },
  now: Date,
): ConnectionRowProps["status"] {
  const words = phrases(text, where, now);
  const lastOk = connection.lastOkAt === null ? null : new Date(connection.lastOkAt);
  // "Updated …" and "Late …" need a good reading to name; without one the row says when it tries.
  const said = connection.status.text;
  const kind = (said === "ok" || said === "late") && lastOk === null ? "lateNever" : said;
  const instant = kind === "ok" || kind === "late" ? lastOk : null;
  return {
    // A key that may only read is a state of its own: amber, not «Action needed».
    value: said === "readOnly" ? "readOnly" : connection.status.value,
    text: text(`text.${kind}`, {
      when: lastOk === null ? "" : words.past(lastOk),
      next: words.next(connection.nextAttempt ?? connection.nextSyncAt),
      name: connection.name,
      provider: connection.providerName,
    }),
    at: instant === null ? null : instant.toISOString(),
    title: instant === null ? null : formatInstant(instant, where),
    action: actionOf(text, connection, where.keyHref),
  };
}

/** Where each action of a state leads from an account's page; an action without a place is a call. */
function placesOf(connection: ApiConnection, keyHref: string | null): Partial<Record<StatusKind, string>> {
  if (!connection.provider.startsWith("plugin:")) return { replaceKey: keyHref ?? SETTINGS };
  return {
    renew: `/banks/connect?renew=${connection.id}`,
    replaceKey: `${SETTINGS}?replace=1`,
    chooseAccounts: `/banks/connect?step=accounts&c=${connection.id}`,
  };
}

/** The action of the state, when the provider can do it from an account's page; null when it cannot. */
function actionOf(text: Text, connection: ApiConnection, keyHref: string | null): RowAction | null {
  const kind = connection.status.action;
  if (kind === null) return null;
  const label = text(`actions.${kind}`);
  if (kind === "resume" || kind === "enable") return { kind, label };
  // A plugin the person turned off can do nothing but be turned on again.
  if (!connection.providerActive) return null;
  const href = placesOf(connection, keyHref)[kind];
  if (href !== undefined) return { kind, label, href };
  return kind === "update" ? { kind, label } : null;
}

/** The short row of the connection `connectionId`, read from `GET /connections`; nothing while it loads. */
export function AccountConnection({
  connectionId,
  keyHref,
  format,
}: {
  connectionId: string;
  keyHref: string | null;
  format: { locale: UiLocale; timeZone: string };
}) {
  const text = useTranslations("settings.connections");
  const list = useApi(connections.listConnections, {});
  const run = useRunConnection();
  const connection = list.data?.connections.find((one) => one.id === connectionId) ?? null;
  const running = connection?.status.value === "running";
  useEffect(() => {
    if (!running) return;
    const started = Date.now();
    const timer = setInterval(() => {
      if (Date.now() - started > REFRESH_FOR_MS) clearInterval(timer);
      else if (document.visibilityState === "visible") invalidate(connections.listConnections);
    }, REFRESH_MS);
    return () => clearInterval(timer);
  }, [running]);
  if (connection === null) return null;
  return (
    <ConnectionRow
      id={connection.id}
      name={connection.name}
      detail={null}
      status={connectionStatus(text, connection, { ...format, keyHref }, new Date())}
      notice={null}
      history={null}
      historyMore={null}
      menu={[]}
      compact
      run={async (id, kind) => {
        const result = await run(id, kind);
        // A reading that starts says so on the row: the list is read again.
        invalidate(connections.listConnections);
        return result;
      }}
    />
  );
}
