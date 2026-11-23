// The row of a connection on the pages of the integrations (ux/n2-connection-status.md §2, §3, §4),
// built on the web's server from the connection `GET /connections` answers: the state the server
// decided, its sentence, the one action and the menu, and the history of the readings. The row
// itself is a client component that draws what this file gives it. Nothing here names a provider.
import "server-only";
import { getTranslations } from "next-intl/server";
import type { connections } from "@ledgerly/api-contract/settings";
import type { RouteOutput } from "@ledgerly/api-client";
import {
  clock,
  codeKey,
  daysToExpiry,
  historyOf,
  relativeNext,
  relativePast,
} from "@ledgerly/domain/platform/integrations/client";
import { addDays, civilDateIn } from "@ledgerly/domain/shared/dates";
import { formatDate, formatInstant, type UiLocale } from "@ledgerly/format/format";
import type { ActionKind, ConnectionRowProps, HistoryItem, RowAction } from "./connection-row";

/** A connection as `GET /connections` answers it. */
export type WireConnection = RouteOutput<typeof connections.listConnections>["connections"][number];
type Status = WireConnection["status"];
type StatusAction = NonNullable<Status["action"]>;

type Who = { locale: UiLocale; timeZone: string };

/** What a provider lets a person do with one of its connections, and where each thing is done. */
export interface Capabilities {
  /** "Update now": a reading the person asks for. */
  update: boolean;
  /** Where a new access is given, for a provider whose access ends. */
  renewHref?: string;
  /** Where the key is replaced; `"own"` when the parent of the row opens its own dialog. */
  replaceKey?: string | "own";
  /** Where the accounts are chosen; `"own"` when the parent of the row opens its own dialog. */
  chooseAccountsHref?: string | "own";
  /** "Test the connection". */
  test?: boolean;
  /** The provider's own page of settings. */
  settingsHref?: string;
  /** "Disconnect", done by the parent of the row. */
  disconnect?: boolean;
}

/** A provider whose row sits in a card with its own dialogs: key, test, disconnect. */
export const OWN_DIALOGS: Capabilities = { update: true, replaceKey: "own", test: true, disconnect: true };

interface RowFacts {
  connection: WireConnection;
  detail: string | null;
  capabilities: Capabilities;
}

/** The runs a row groups into its history: `GET /connections?runs=…`. */
export const RUNS_PER_CONNECTION = 40;
/** The readings a row shows. */
const HISTORY_ITEMS = 10;

export function advancedHref(connectionId: string): string {
  return `/settings/plugins/advanced?c=${connectionId}`;
}

const instantOf = (iso: string | null): Date | null => (iso === null ? null : new Date(iso));

/**
 * Builds the rows of a page. One translator and one "now" for all of them: two rows of the same
 * page never disagree about the time.
 */
export async function connectionRows(ctx: Who, now: Date = new Date()) {
  const t = await getTranslations("settings.connections");
  const day = (date: string) => formatDate(date, "dayMonth", ctx.locale);

  function past(at: Date): string {
    const when = relativePast(at, now, ctx.timeZone);
    if (when.key === "now") return t("when.now");
    if (when.key === "minutes") return t("when.minutes", { count: when.count });
    if (when.key === "hours") return t("when.hours", { count: when.count });
    if (when.key === "yesterday") return t("when.yesterday", { time: when.time });
    return t("when.date", { date: day(when.date), time: when.time });
  }

  function next(at: Date | null): string {
    const when = relativeNext(at, now, ctx.timeZone);
    if (when.key === "soon") return t("next.soon");
    if (when.key === "today") return t("next.today", { time: when.time });
    if (when.key === "tomorrow") return t("next.tomorrow", { time: when.time });
    return t("next.date", { date: day(when.date), time: when.time });
  }

  /** The label of an action, one branch per kind so the catalogue keys stay literal. */
  function labelFor(kind: ActionKind): string {
    if (kind === "update") return t("actions.update");
    if (kind === "renew") return t("actions.renew");
    if (kind === "replaceKey") return t("actions.replaceKey");
    if (kind === "chooseAccounts") return t("actions.chooseAccounts");
    if (kind === "resume") return t("actions.resume");
    if (kind === "enable") return t("actions.enable");
    if (kind === "connect") return t("actions.connect");
    if (kind === "test") return t("actions.test");
    if (kind === "settings") return t("actions.settings");
    if (kind === "advanced") return t("actions.advanced");
    return t("actions.disconnect");
  }

  const action = (kind: ActionKind, href?: string, danger?: boolean): RowAction => ({
    kind,
    label: labelFor(kind),
    ...(href === undefined ? {} : { href }),
    ...(danger ? { danger } : {}),
  });

  /** The action of a state, when the provider can do it; `null` when it cannot. */
  function actionOf(kind: StatusAction | null, facts: RowFacts): RowAction | null {
    const can = facts.capabilities;
    if (kind === "update") return can.update ? action("update") : null;
    if (kind === "renew") return can.renewHref ? action("renew", can.renewHref) : null;
    if (kind === "replaceKey") {
      if (can.replaceKey === undefined) return null;
      return can.replaceKey === "own" ? action("replaceKey") : action("replaceKey", can.replaceKey);
    }
    if (kind === "chooseAccounts") {
      if (can.chooseAccountsHref === undefined) return null;
      return can.chooseAccountsHref === "own"
        ? action("chooseAccounts")
        : action("chooseAccounts", can.chooseAccountsHref);
    }
    if (kind === "resume" || kind === "enable") return action(kind);
    return null;
  }

  function sentence(status: Status, facts: RowFacts): { text: string; at: Date | null } {
    const { connection } = facts;
    const names = { name: connection.name, provider: connection.providerName };
    const attempt = next(instantOf(connection.nextAttempt ?? connection.nextSyncAt));
    const lastOk = instantOf(connection.lastOkAt);
    if (status.text === "ok" && lastOk !== null) {
      return { text: t("text.ok", { when: past(lastOk) }), at: lastOk };
    }
    if (status.text === "late" && lastOk !== null) {
      return { text: t("text.late", { when: past(lastOk), next: attempt }), at: lastOk };
    }
    if (status.text === "running") return { text: t("text.running"), at: null };
    if (status.text === "lateLimit")
      return { text: t("text.lateLimit", { ...names, next: attempt }), at: null };
    if (status.text === "consentExpired") return { text: t("text.consentExpired", names), at: null };
    if (status.text === "keyInvalid") return { text: t("text.keyInvalid", names), at: null };
    if (status.text === "readOnly") return { text: t("text.readOnly", names), at: null };
    if (status.text === "pending") return { text: t("text.pending"), at: null };
    if (status.text === "pausedSchedule") return { text: t("text.pausedSchedule"), at: null };
    if (status.text === "pausedProvider") return { text: t("text.pausedProvider", names), at: null };
    return { text: t("text.lateNever", { next: attempt }), at: null };
  }

  function historyItems(facts: RowFacts): { items: HistoryItem[]; more: boolean } {
    const names = { name: facts.connection.name, provider: facts.connection.providerName };
    const today = civilDateIn(now, ctx.timeZone);
    const entries = historyOf(
      facts.connection.runs.map((run) => ({ ...run, startedAt: new Date(run.startedAt) })),
    );
    const items = entries.slice(0, HISTORY_ITEMS).map((entry): HistoryItem => {
      const on = civilDateIn(entry.at, ctx.timeZone);
      const time = clock(entry.at, ctx.timeZone);
      const label =
        on === today
          ? t("history.today", { time })
          : on === addDays(today, -1)
            ? t("history.yesterday", { time })
            : t("history.date", { date: day(on), time });
      let text = "";
      if (entry.outcome === "ok") {
        text =
          entry.news.length === 0
            ? t("history.nothing")
            : entry.news.map((one) => newsText(one.key, one.count)).join(" · ");
      } else if (entry.outcome === "failed" && entry.errorCode !== null) {
        text = t(`codes.${codeKey(entry.errorCode)}`, names);
      } else if (entry.outcome === "skipped") {
        text = t("history.nothingToRead");
      }
      return { at: entry.at.toISOString(), when: label, outcome: entry.outcome, text, byYou: entry.manual };
    });
    return { items, more: entries.length > HISTORY_ITEMS };
  }

  /** What a reading brought, one branch per key so the catalogue keys stay literal. */
  function newsText(key: string, count: number): string {
    if (key === "accountsNew") return t("history.news.accountsNew", { count });
    if (key === "balancesUpdated") return t("history.news.balancesUpdated", { count });
    if (key === "movementsNew") return t("history.news.movementsNew", { count });
    if (key === "movementsUpdated") return t("history.news.movementsUpdated", { count });
    if (key === "daysSent") return t("history.news.daysSent", { count });
    if (key === "daysReceived") return t("history.news.daysReceived", { count });
    if (key === "positionsRead") return t("history.news.positionsRead", { count });
    return t("history.news.operationsNew", { count });
  }

  /** The row of a connection that exists. */
  function row(facts: RowFacts): ConnectionRowProps {
    const { connection, capabilities: can } = facts;
    const label = { name: connection.name };
    const status = connection.status;
    const { text, at } = sentence(status, facts);
    const primary = actionOf(status.action, facts);
    const off = status.text === "pausedProvider";

    // The menu, in the order of §3.2: what the provider can do and the button does not already.
    const menu: RowAction[] = [];
    const add = (item: RowAction | null) => {
      if (item !== null && item.kind !== primary?.kind) menu.push(item);
    };
    if (!off) {
      if (status.value !== "running" && status.value !== "action") add(actionOf("update", facts));
      add(actionOf("renew", facts));
      add(actionOf("replaceKey", facts));
      // Which accounts arrive here, at any time and not only before the first reading: an account
      // deleted here comes back only when it is chosen again (PERS-419).
      add(actionOf("chooseAccounts", facts));
      if (can.test) add(action("test"));
      if (can.settingsHref) add(action("settings", can.settingsHref));
    }
    add(action("advanced", advancedHref(connection.id)));
    if (!off && can.disconnect) add(action("disconnect", undefined, true));

    // The end of the access, from 14 days before it; after it the state says so itself.
    const days = daysToExpiry(instantOf(connection.expiresAt), now, ctx.timeZone);
    const conflict = connection.ibanConflicts[0];
    const notice =
      days !== null && days <= 14 && !off && status.value !== "action"
        ? { text: t("expiry.days", { days, name: label.name }), action: actionOf("renew", facts) }
        : conflict !== undefined && !off
          ? { text: t("notices.ibanExists", { name: label.name, account: conflict }), action: null }
          : null;

    const history = historyItems(facts);
    return {
      id: connection.id,
      name: label.name,
      detail: facts.detail,
      status: {
        value: status.value,
        text,
        at: at === null ? null : at.toISOString(),
        title: at === null ? null : formatInstant(at, ctx),
        action: primary,
      },
      notice,
      history: history.items,
      historyMore: history.more ? advancedHref(connection.id) : null,
      menu,
    };
  }

  /** The row of a connection that does not exist yet: "Not connected", and "Connect". */
  function absent(id: string, name: string, detail: string | null): ConnectionRowProps {
    return {
      id,
      name,
      detail,
      // The word "Not connected" beside the name says it all: no sentence under it.
      status: { value: "absent", text: "", at: null, title: null, action: action("connect") },
      notice: null,
      history: null,
      historyMore: null,
      menu: [],
    };
  }

  return { row, absent, next };
}
