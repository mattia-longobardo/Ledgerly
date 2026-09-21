import "server-only";
import { createTranslator } from "use-intl/core";
import { forEachUser } from "@/modules/users/jobs";
import { today } from "@/platform/dates";
import { formatMoney, type UiLocale } from "@/platform/format";
import type { JobDefinition } from "@/platform/jobs/registry";
import type { JobDetail } from "@/platform/jobs/schema";
import { clearNotification, notifyOnce } from "@/platform/notifications/service";
import en from "../../../messages/en.json";
import it from "../../../messages/it.json";
import { accountsView } from "./queries";
import { runSnapshot, snapshotMonthFor } from "./service";

const CATALOGUES = { en, it } as const;

/** A condition that lasts for weeks is worth one email a week, not one a day. */
const ALERT_COOLDOWN_HOURS = 24 * 7;

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

/** The one alert of this job that becomes an email (see the job's own note below). */
function lowBalanceMail(locale: UiLocale, values: Record<string, string>) {
  const t = createTranslator({
    locale,
    messages: CATALOGUES[locale],
    namespace: "emails.lowBalance",
  });
  return { subject: t("subject", values), text: t("body", values) };
}

/**
 * The account alerts of §7.1 that become an email of §10.4.
 *
 * `low_balance` does: it is about *this* account's own threshold, and only this account's balance
 * can clear it.
 *
 * `stale_sync` does not, and it is the one condition of §10.4 with two implementations. It stays
 * an alert — the interface shows it on the account, which is where §7.1 wants it — but the email
 * belongs to the connection (`modules/transactions/jobs.ts`), for three reasons:
 *
 * 1. The two always fire together. `saveProviderBalance` is the only thing that moves
 *    `accounts.last_synced_at`, and it only runs when the connection answers; so every account of
 *    a dead connection goes stale with it. Ten accounts meant eleven emails a week about one
 *    refused token.
 * 2. The actionable sentence is the connection's. A stale account whose *link* is dead is not
 *    separate news from the dead link, and pasting a new token is the only fix for either.
 * 3. An account the provider stopped returning is `unavailable`, not out of date. §7.1 forbids
 *    deleting it and nothing will ever read it again, so "has not synced recently" was an email a
 *    week, for ever, about a state no action can change.
 *
 * The record is still cleared for both kinds, which also forgets what earlier passes sent.
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
        if (alert.kind !== "low_balance") continue;
        const row = view.rows.find((one) => one.account.id === alert.accountId);
        if (!row) continue;
        const delivered = await notifyOnce({
          userId: person.id,
          kind: alert.kind,
          key: alert.accountId,
          cooldownHours: ALERT_COOLDOWN_HOURS,
          mail: {
            to: person.email,
            ...lowBalanceMail(ctx.locale, {
              account: row.account.name,
              balance: formatMoney(row.balance, ctx.numberFormat),
              threshold: formatMoney(row.account.lowBalanceCents, ctx.numberFormat),
            }),
          },
        });
        if (delivered) sent += 1;
      }
    });
    return { ...counts, sent };
  },
};
