/**
 * The warnings about a connection (ux/n2-connection-status.md §6): one model of mail for every
 * provider, with the connection's name as a parameter (anticipation AN3). The dispatcher calls
 * this after each pass it makes; nothing else sends these mails.
 *
 * - `sync_failed`: at the third failure in a row, or at once when only the person can repair it
 *   (a key the provider refuses, an access that ended).
 * - `sync_stale`: no good reading for longer than the staleness window.
 * - `consent_expiring`: 14 days and 3 days before an access ends, once each.
 *
 * A mail carries the fixed sentence of a code and never what a provider said.
 */
import "server-only";
import { createTranslator } from "use-intl/core";
import type { Person } from "@ledgerly/domain/users";
import type { Ctx } from "@ledgerly/domain/platform/context";
import { civilDateIn } from "@ledgerly/domain/shared/dates";
import { readEnv } from "@ledgerly/domain/platform/env";
import { formatDate } from "@ledgerly/format/format";
import { notify, settle } from "@/platform/notifications/service";
import { resolve } from "@ledgerly/domain/platform/notifications";
import en from "../../../../../messages/en.json";
import it from "../../../../../messages/it.json";
import { labelOf } from "./registry";
import type { Connection } from "@ledgerly/domain/platform/integrations";
import {
  codeKey,
  daysToExpiry,
  expiryWarning,
  type StatusFacts,
  syncStatus,
  warningFor,
} from "@ledgerly/domain/platform/integrations";

const CATALOGUES = { en, it } as const;

/** The keys of `notifications_log`: generic, with the connection as the key of the row. */
export const SYNC_FAILED = "sync_failed";
export const SYNC_STALE = "sync_stale";
export const CONSENT_EXPIRING = "consent_expiring";

/** A condition that lasts for weeks is worth one mail a week, not one a pass. */
const COOLDOWN_HOURS = 24 * 7;
/** A warning of an access's end is sent once: its key names the end and the threshold. */
const ONCE_HOURS = 24 * 400;

function squeeze(text: string): string {
  return text.replace(/\s{2,}/g, " ").trim();
}

/** The facts of a connection the dispatcher has just passed: its provider is on and it is complete. */
function factsOf(connection: Connection, extra: { running?: boolean } = {}): StatusFacts {
  return {
    state: connection.state,
    errorCode: connection.errorCode,
    consecutiveFailures: connection.consecutiveFailures,
    lastOkAt: connection.lastOkAt,
    nextSyncAt: connection.nextSyncAt,
    expiresAt: connection.expiresAt,
    running: extra.running ?? false,
    providerActive: true,
    scheduled: connection.schedule.rules.length > 0,
    accountsChosen: true,
  };
}

/**
 * Sends what the connection is owed after a pass, and forgets the warnings of a connection that
 * is up to date again, so its next trouble is told at once. Returns the warnings sent.
 */
export async function reportConnection(
  person: Pick<Person, "id" | "email">,
  ctx: Pick<Ctx, "locale" | "timeZone">,
  connection: Connection,
  now: Date = new Date(),
): Promise<string[]> {
  const sent: string[] = [];
  const t = createTranslator({ locale: ctx.locale, messages: CATALOGUES[ctx.locale] });
  const label = await labelOf(connection, ctx.locale);
  const names = { name: label.name, provider: label.provider };
  const url = `${readEnv().BETTER_AUTH_URL.replace(/\/+$/, "")}/settings/integrations`;
  const facts = factsOf(connection);
  const status = syncStatus(facts, now);
  const warning = warningFor(status, facts, now);
  const base = { key: connection.id, category: "syncAlerts" as const };
  const who = { userId: person.id };
  // The fact of the connection (R5e): failed or stale, never both open at once.
  const fact = { subject: connection.id, targetId: connection.id };

  if (warning?.kind === "failed") {
    const code =
      status.text === "consentExpired" ? "consent_expired" : status.text === "keyInvalid" ? "auth" : null;
    const reason = t(`settings.connections.codes.${codeKey(code ?? connection.errorCode)}`, names);
    const todo = warning.todo === null ? "" : t(`emails.connection.todo.${warning.todo}`);
    await resolve(who, "connection_stale", { subject: connection.id }, now);
    const delivered = await notify(
      who,
      { ...fact, event: "connection_failed" },
      {
        ...base,
        kind: SYNC_FAILED,
        cooldownHours: COOLDOWN_HOURS,
        mail: {
          to: person.email,
          subject: t("emails.connection.subject", names),
          text: squeeze(t("emails.connection.failedBody", { ...names, reason, todo, url })),
        },
      },
      now,
    );
    if (delivered) sent.push(SYNC_FAILED);
  } else if (warning?.kind === "stale") {
    const since = formatDate(
      civilDateIn(connection.lastOkAt ?? connection.createdAt, ctx.timeZone),
      "long",
      ctx.locale,
    );
    await resolve(who, "connection_failed", { subject: connection.id }, now);
    const delivered = await notify(
      who,
      { ...fact, event: "connection_stale" },
      {
        ...base,
        kind: SYNC_STALE,
        cooldownHours: COOLDOWN_HOURS,
        mail: {
          to: person.email,
          subject: t("emails.connection.subject", names),
          text: t("emails.connection.staleBody", { ...names, since, url }),
        },
      },
      now,
    );
    if (delivered) sent.push(SYNC_STALE);
  } else if (status.value === "ok") {
    await settle(
      who,
      { event: "connection_failed", subject: connection.id },
      { kind: SYNC_FAILED, key: connection.id },
      now,
    );
    await settle(
      who,
      { event: "connection_stale", subject: connection.id },
      { kind: SYNC_STALE, key: connection.id },
      now,
    );
  }

  // The end of an access: only while the connection is otherwise being read (ux §6.5).
  const days = daysToExpiry(connection.expiresAt, now, ctx.timeZone);
  const threshold = expiryWarning(days);
  if (
    threshold !== null &&
    days !== null &&
    connection.expiresAt !== null &&
    status.value !== "paused" &&
    status.value !== "action"
  ) {
    const date = formatDate(civilDateIn(connection.expiresAt, ctx.timeZone), "long", ctx.locale);
    const end = connection.expiresAt.toISOString().slice(0, 10);
    // One mail per threshold and per end: a renewed access has a new end, and warns again.
    const key = `${connection.id}:${threshold}:${end}`;
    // One open fact per connection's end: the 3-day warning closes the 14-day one.
    await resolve(who, "connection_expiring", { prefix: `${connection.id}:`, except: key }, now);
    const delivered = await notify(
      who,
      { event: "connection_expiring", subject: key, targetId: connection.id, params: { days, date: end } },
      {
        ...base,
        kind: CONSENT_EXPIRING,
        key,
        cooldownHours: ONCE_HOURS,
        mail: {
          to: person.email,
          subject: t("emails.connection.expiringSubject", { ...names, days }),
          text: t("emails.connection.expiringBody", { ...names, date, url }),
        },
      },
      now,
    );
    if (delivered) sent.push(CONSENT_EXPIRING);
  } else {
    // No end in sight, or the connection is not being read: no warning of its end is open.
    await resolve(who, "connection_expiring", { prefix: `${connection.id}:` }, now);
  }
  return sent;
}
