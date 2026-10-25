import "server-only";
import { createTranslator } from "use-intl/core";
import { forEachUser } from "@/modules/users/jobs";
import { formatDate, formatMoney, formatWholePercent, type UiLocale } from "@/platform/format";
import { monthKey, today } from "@/platform/dates";
import { readEnv } from "@/platform/env";
import type { JobDefinition } from "@/platform/jobs/registry";
import type { JobDetail } from "@/platform/jobs/schema";
import { clearNotification, notifyOnce } from "@/platform/notifications/service";
import en from "../../../messages/en.json";
import it from "../../../messages/it.json";
import { alertSettings, budgetsView } from "./queries";
import { budgetSlug, DEFAULT_ALERT_SETTINGS, reachedThreshold, thresholdReached } from "./rules";
import { budgetName } from "./ui/present";

const CATALOGUES = { en, it } as const;

export const BUDGET_ALERT_KIND = "budget_threshold";

/**
 * The key carries the month, so a threshold emails once a month at most; the cooldown only has to
 * outlast the month, and the log's 90-day retention outlasts the cooldown.
 */
const COOLDOWN_HOURS = 24 * 35;

function alertMail(locale: UiLocale, over: boolean, values: Record<string, string>) {
  const t = createTranslator({
    locale,
    messages: CATALOGUES[locale],
    namespace: over ? "emails.budgetOver" : "emails.budgetNear",
  });
  return { subject: t("subject", values), text: t("body", values) };
}

/**
 * The budget alerts (spec §7.3): every budget of the current month, in the user's own zone, that
 * has reached one of the thresholds its owner chose on its page — 85 % and over the limit until
 * they choose otherwise — emails once for that threshold and month.
 *
 * Hourly, after `wallet-sync`, so an alert follows the movement that caused it within the hour.
 * One email per pass and budget: when a single movement walks past several thresholds, only the
 * highest is news. A threshold the budget has fallen back under (a refund, a limit raised) is
 * forgotten, so reaching it again later in the month emails again.
 */
export const budgetAlertsJob: JobDefinition = {
  name: "budgets-alerts",
  tier: "hourly",
  async run(): Promise<JobDetail> {
    const now = new Date();
    let sent = 0;
    const counts = await forEachUser("budgets-alerts", async (person, ctx) => {
      const month = monthKey(today(ctx.timeZone, now));
      const [view, settings] = await Promise.all([budgetsView(ctx, month), alertSettings(ctx)]);
      if (view.rows.length === 0) return;
      const t = createTranslator({
        locale: ctx.locale,
        messages: CATALOGUES[ctx.locale],
        namespace: "budgets",
      });
      for (const row of view.rows) {
        const alerts = settings.get(row.key) ?? DEFAULT_ALERT_SETTINGS;
        const keyOf = (percent: number) => `${row.key}|${month}|${percent}`;
        for (const percent of alerts.thresholds) {
          if (alerts.enabled && thresholdReached(row.spentCents, row.limitCents, percent)) continue;
          await clearNotification(person.id, BUDGET_ALERT_KIND, keyOf(percent));
        }
        if (!alerts.enabled) continue;
        const reached = reachedThreshold(row.spentCents, row.limitCents, alerts.thresholds);
        if (reached === null) continue;
        const over = row.spentCents > row.limitCents;
        const money = (cents: bigint) => formatMoney(cents, ctx.numberFormat);
        const delivered = await notifyOnce(
          {
            userId: person.id,
            kind: BUDGET_ALERT_KIND,
            key: keyOf(reached),
            cooldownHours: COOLDOWN_HOURS,
            mail: {
              to: person.email,
              ...alertMail(ctx.locale, over, {
                budget: budgetName(row, t("allCategories")),
                account: row.accountName ?? t("allAccounts"),
                month: formatDate(month, "monthYear", ctx.locale),
                percent: formatWholePercent(row.percent, ctx.numberFormat),
                threshold: formatWholePercent(reached, ctx.numberFormat),
                spent: money(row.spentCents),
                limit: money(row.limitCents),
                left: money(row.limitCents - row.spentCents),
                excess: money(row.spentCents - row.limitCents),
                url: `${readEnv().BETTER_AUTH_URL}/budgets/${budgetSlug(row)}`,
              }),
            },
          },
          now,
        );
        if (delivered) sent += 1;
      }
    });
    return { ...counts, sent };
  },
};
