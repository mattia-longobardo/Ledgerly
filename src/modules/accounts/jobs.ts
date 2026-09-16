import "server-only";
import { asc } from "drizzle-orm";
import { createTranslator } from "use-intl/core";
import { getPreferences } from "@/modules/users/service";
import { redactForLog } from "@/platform/auth/logger";
import { users } from "@/platform/auth/schema";
import type { Ctx } from "@/platform/context";
import { today } from "@/platform/dates";
import { getDb } from "@/platform/db/client";
import { formatMoney, type UiLocale } from "@/platform/format";
import type { JobDefinition } from "@/platform/jobs/registry";
import type { JobDetail } from "@/platform/jobs/schema";
import { clearNotification, notifyOnce } from "@/platform/notifications/service";
import en from "../../../messages/en.json";
import it from "../../../messages/it.json";
import { accountsView } from "./queries";
import type { AlertKind } from "./rules";
import { runSnapshot, snapshotMonthFor } from "./service";

const CATALOGUES = { en, it } as const;

/** A condition that lasts for weeks is worth one email a week, not one a day. */
const ALERT_COOLDOWN_HOURS = 24 * 7;

interface Person {
  id: string;
  email: string;
}

async function everyone(): Promise<Person[]> {
  return getDb().select({ id: users.id, email: users.email }).from(users).orderBy(asc(users.id));
}

async function contextFor(person: Person): Promise<Ctx> {
  const preferences = await getPreferences({ userId: person.id });
  return {
    userId: person.id,
    role: "user",
    locale: preferences.locale,
    timeZone: preferences.timeZone,
    numberFormat: preferences.numberFormat,
  };
}

/**
 * Runs `body` for every user, keeping one user's failure to that user (spec §10.1). The counters
 * it returns become the job's recorded detail.
 */
async function forEachUser(
  job: string,
  body: (person: Person, ctx: Ctx) => Promise<void>,
): Promise<{ users: number; failed: number }> {
  let failed = 0;
  const people = await everyone();
  for (const person of people) {
    try {
      await body(person, await contextFor(person));
    } catch (error) {
      failed += 1;
      console.error(`[${job}] failed for one user`, redactForLog(error));
    }
  }
  return { users: people.length, failed };
}

/**
 * The 1st of the month at 00:05 (spec §10.2): every user's snapshot of the month that just ended,
 * taken in their own timezone so a user east or west of the server is not a month off.
 */
export const accountsSnapshotJob: JobDefinition = {
  name: "accounts-snapshot",
  tier: "monthly",
  async run(): Promise<JobDetail> {
    let balances = 0;
    let warnings = 0;
    const counts = await forEachUser("accounts-snapshot", async (_person, ctx) => {
      const outcome = await runSnapshot(ctx, snapshotMonthFor(today(ctx.timeZone)));
      balances += outcome.written;
      if (outcome.warnings.length > 0) warnings += 1;
    });
    return { ...counts, balancesWritten: balances, withWarnings: warnings };
  },
};

function alertMail(kind: AlertKind, locale: UiLocale, values: Record<string, string>) {
  const t = createTranslator({
    locale,
    messages: CATALOGUES[locale],
    namespace: kind === "low_balance" ? "emails.lowBalance" : "emails.staleSync",
  });
  return { subject: t("subject", values), text: t("body", values) };
}

/**
 * Daily at 12:00 (spec §10.2): a balance under its threshold and a sync that has gone stale, both
 * governed by the account's own settings. An account that is fine again has its record cleared, so
 * the next occurrence is reported straight away instead of waiting out the cooldown.
 */
export const accountAlertsJob: JobDefinition = {
  name: "accounts-alerts",
  tier: "daily",
  async run(): Promise<JobDetail> {
    let sent = 0;
    const counts = await forEachUser("accounts-alerts", async (person, ctx) => {
      const view = await accountsView(ctx);
      const raised = new Set(view.alerts.map((alert) => `${alert.kind}:${alert.accountId}`));
      for (const row of view.rows) {
        for (const kind of ["low_balance", "stale_sync"] as const) {
          if (raised.has(`${kind}:${row.account.id}`)) continue;
          await clearNotification(person.id, kind, row.account.id);
        }
      }
      for (const alert of view.alerts) {
        const row = view.rows.find((one) => one.account.id === alert.accountId);
        if (!row) continue;
        const delivered = await notifyOnce({
          userId: person.id,
          kind: alert.kind,
          key: alert.accountId,
          cooldownHours: ALERT_COOLDOWN_HOURS,
          mail: {
            to: person.email,
            ...alertMail(alert.kind, ctx.locale, {
              account: row.account.name,
              balance: formatMoney(row.balance, ctx.numberFormat),
              threshold: formatMoney(row.account.lowBalanceCents, ctx.numberFormat),
              hours: String(row.account.staleAfterHours),
            }),
          },
        });
        if (delivered) sent += 1;
      }
    });
    return { ...counts, sent };
  },
};
