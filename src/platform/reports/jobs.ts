import "server-only";
import { createTranslator } from "use-intl/core";
import { forEachUser } from "@/modules/users/jobs";
import { getPreferences } from "@/modules/users/service";
import { addMonths, monthKey, today } from "@/platform/dates";
import { formatDate, formatMoney, type NumberFormat, type UiLocale } from "@/platform/format";
import type { JobDefinition } from "@/platform/jobs/registry";
import type { JobDetail } from "@/platform/jobs/schema";
import { notifyOnce } from "@/platform/notifications/service";
import en from "../../../messages/en.json";
import it from "../../../messages/it.json";
import { monthlyFigures } from "./monthly";

const CATALOGUES = { en, it } as const;

/**
 * One a month is the whole point, and the log is what guarantees it: `notifyOnce` claims the slot
 * `(user, "monthly_summary", month)` in a single conditional upsert, so a tick that runs twice —
 * or two workers racing — still sends one email.
 */
const COOLDOWN_HOURS = 24 * 20;

function summaryMail(locale: UiLocale, values: Record<string, string | number>) {
  const t = createTranslator({
    locale,
    messages: CATALOGUES[locale],
    namespace: "emails.monthlySummary",
  });
  return { subject: t("subject", values), text: t("body", values) };
}

const money = (cents: bigint | null, format: NumberFormat) => formatMoney(cents, format);

/**
 * The 1st of the month (spec §10.2, §10.4): what the month just ended looked like, to whoever
 * asked for it in their preferences.
 *
 * Last in the monthly tier, after `accounts-snapshot` and `pockets-accrual`, because it reports
 * numbers those two have just settled — `JOBS` is ordered and `runTier` runs a tier in that order.
 *
 * Two switches decide whether it leaves: the user's own `monthly_summary` preference (until F8 it
 * was saved and read by nobody) and the instance-wide one in Admin › Server, which `notifyOnce`
 * applies through the `monthlySummary` category.
 */
export const monthlySummaryJob: JobDefinition = {
  name: "monthly-summary",
  tier: "monthly",
  async run(): Promise<JobDetail> {
    const now = new Date();
    let sent = 0;
    let wanted = 0;
    const counts = await forEachUser("monthly-summary", async (person, ctx) => {
      const preferences = await getPreferences(ctx);
      if (!preferences.monthlySummary) return;
      wanted += 1;
      // The month that just ended, in the user's own zone: a person east or west of the server
      // must not be told about the wrong month.
      const month = addMonths(monthKey(today(ctx.timeZone, now)), -1);
      const figures = await monthlyFigures(ctx, month, now);
      const delivered = await notifyOnce(
        {
          userId: person.id,
          kind: "monthly_summary",
          key: month,
          cooldownHours: COOLDOWN_HOURS,
          category: "monthlySummary",
          mail: {
            to: person.email,
            ...summaryMail(ctx.locale, {
              // A `MonthKey` is already the first day of its month (`platform/dates`).
              month: formatDate(month, "monthYear", ctx.locale),
              netWorth: money(figures.netWorthCents, ctx.numberFormat),
              income: money(figures.incomeCents, ctx.numberFormat),
              expense: money(figures.expenseCents, ctx.numberFormat),
              net: money(figures.netCents, ctx.numberFormat),
              transactions: figures.transactions,
            }),
          },
        },
        now,
      );
      if (delivered) sent += 1;
    });
    return { ...counts, wanted, sent };
  },
};
