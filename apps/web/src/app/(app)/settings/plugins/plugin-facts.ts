// What the list and the page of a plugin say of it (H56, PERS-615 §2-§3), built on the web's server
// from `GET /plugins` and `GET /connections`: the word of its state, the line with the main fact, what
// it reads and writes, its connections (the one that needs the person most first) and its main action.
// The server decides every state; this file only puts it into words. No provider is named here.
import "server-only";
import { getTranslations } from "next-intl/server";
import { connections as connectionRoutes, sources } from "@ledgerly/api-contract/settings";
import { civilDateIn } from "@ledgerly/domain/shared/dates";
import { formatDate, type UiLocale } from "@ledgerly/format/format";
import type { Tone } from "@ledgerly/ui/tone";
import { apiRead } from "@/platform/api-read";
import type { ConnectionRowProps } from "./connection-row";
import { connectionRows, OWN_DIALOGS, RUNS_PER_CONNECTION, type WireConnection } from "./connection-view";
import { isOn, type Plugin, type PluginStatus, primaryOf, STATUS_TONE, statusOf } from "./plugin-model";
import type { RowPrimary } from "./plugin-row";
import { bankRows } from "./source-rows";

export const PLUGINS = "/settings/plugins";
export const pageOf = (slug: string) => `${PLUGINS}/${slug}`;

type Who = { locale: UiLocale; timeZone: string };
type Words = Awaited<ReturnType<typeof getTranslations<"settings.plugins">>>;

interface OwnConnection {
  connection: WireConnection;
  row: ConnectionRowProps;
}

export interface PluginView {
  plugin: Plugin;
  status: PluginStatus;
  word: string;
  tone: Tone;
  text: string;
  reads: string[];
  writes: string[];
  /** The plugin's connections, the one that needs the person most first. */
  own: OwnConnection[];
  primary: RowPrimary;
  /** The connection «Update now» of the menu reads. */
  update: string | null;
  /** What still depends on the plugin, one line each (H55: what «Deactivate» converts). */
  leftovers: string[];
}

interface Said {
  words: Words;
  update: string;
  day: (instant: string) => string;
  list: Intl.ListFormat;
}

function leftoversOf(plugin: Plugin, { words }: Said): string[] {
  const { accounts, categories, pendingTx, pendingDays } = plugin.leftovers;
  return [
    accounts > 0 && words("leftovers.accounts", { count: accounts }),
    categories > 0 && words("leftovers.categories", { count: categories, name: plugin.name }),
    pendingTx > 0 && words("leftovers.pendingTx", { count: pendingTx }),
    pendingDays > 0 && words("leftovers.pendingDays", { count: pendingDays }),
  ].filter((line): line is string => typeof line === "string");
}

/** How many things are left: one thing says «depends», more say «depend». */
const total = (leftovers: Plugin["leftovers"]) =>
  Object.values(leftovers).reduce((sum, count) => sum + count, 0);

/** The line under the name: the main fact of the state (§3). */
function textOf(plugin: Plugin, status: PluginStatus, own: OwnConnection[], said: Said): string {
  const { words } = said;
  const name = plugin.name;
  if (status === "not_active")
    return plugin.deactivatedAt === null
      ? plugin.description
      : words("text.deactivated", { description: plugin.description, date: said.day(plugin.deactivatedAt) });
  if (status === "not_connected") return words("text.notConnected", { name });
  if (status === "disconnected") return words("text.disconnected", { count: plugin.leftovers.accounts });
  if (status === "needs_cleanup") {
    const left = leftoversOf(plugin, said);
    return left.length === 0
      ? words("text.needsCleanupAccess", { name })
      : words("text.needsCleanup", { name, what: said.list.format(left), count: total(plugin.leftovers) });
  }
  const told = own[0]?.row.status.text || plugin.description;
  return own.length > 1 ? `${told} · ${words("text.connections", { count: own.length })}` : told;
}

/** The action of the connection that needs the person most: its own, or «Try again», «Update now». */
function connectionAction(status: PluginStatus, worst: OwnConnection, href: string, said: Said): RowPrimary {
  if (status === "action_needed") {
    const action = worst.row.status.action;
    if (action === null) return { kind: "link", label: said.words("actions.open"), href, strong: true };
    // A key or the accounts chosen in a dialog of the page: the page, where the dialog is.
    return { kind: "link", label: action.label, href: action.href ?? `${href}#connection`, strong: true };
  }
  const error = status === "error";
  return {
    kind: "run",
    label: error ? said.words("actions.retry") : said.update,
    connectionId: worst.connection.id,
    action: "update",
    strong: error,
  };
}

/** The main action: a step of the plugin, a page, or the action of the connection that needs it. */
function primaryFor(plugin: Plugin, status: PluginStatus, own: OwnConnection[], said: Said): RowPrimary {
  const { words } = said;
  const href = pageOf(plugin.id);
  const kind = primaryOf(status);
  if (kind === "activate") return { kind: "activate", label: words("actions.activate") };
  if (kind === "connect" || kind === "reconnect")
    return { kind: "link", label: words(`actions.${kind}`), href: `${href}?step=connect`, strong: true };
  if (kind === "fix") return { kind: "link", label: words("actions.fix"), href, strong: true };
  const worst = own[0];
  return kind === null || worst === undefined ? null : connectionAction(status, worst, href, said);
}

/** The plugins of the person and their connections, read once for the list or the page. */
export async function pluginViews(ctx: Who, now: Date = new Date()) {
  const [pluginsRead, connectionsRead, rows, words, text] = await Promise.all([
    apiRead(sources.listPlugins, {}),
    apiRead(connectionRoutes.listConnections, { query: { runs: RUNS_PER_CONNECTION } }),
    connectionRows(ctx, now),
    getTranslations("settings.plugins"),
    getTranslations("settings.connections"),
  ]);
  const connections = connectionsRead?.connections ?? [];
  const day = (instant: string) =>
    formatDate(civilDateIn(new Date(instant), ctx.timeZone), "long", ctx.locale);
  const said: Said = {
    words,
    update: text("actions.update"),
    day,
    list: new Intl.ListFormat(ctx.locale, { type: "conjunction" }),
  };

  /** The connections of a plugin: one per bank for a bank plugin, the one of a plugin of the core. */
  function ownOf(plugin: Plugin): OwnConnection[] {
    if (plugin.kind === "bank")
      return bankRows({ connections, rows, text, day, locale: ctx.locale, now }, plugin.id, isOn(plugin));
    const connection = connections.find((one) => one.provider === `plugin:${plugin.id}`);
    if (connection === undefined) return [];
    const row = rows.row({ connection, detail: plugin.description, capabilities: OWN_DIALOGS });
    return [{ connection, row }];
  }

  const views = (pluginsRead?.plugins ?? []).map((plugin): PluginView => {
    const status = statusOf(plugin);
    const own = ownOf(plugin);
    const updates = plugin.pluginState === "connected" && status !== "reading";
    return {
      plugin,
      status,
      word: words(`states.${status}`),
      tone: STATUS_TONE[status],
      text: textOf(plugin, status, own, said),
      reads: plugin.capabilities.reads.map((kind) => words(`reads.${kind}`)),
      writes: plugin.capabilities.writes.map((kind) => words(`writes.${kind}`)),
      own,
      primary: primaryFor(plugin, status, own, said),
      update: updates ? (own[0]?.connection.id ?? null) : null,
      leftovers: leftoversOf(plugin, said),
    };
  });

  return { views, absent: rows.absent, day };
}
