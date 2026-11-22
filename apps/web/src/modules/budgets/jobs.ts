import "server-only";
import { createTranslator } from "use-intl/core";
import { forEachUser, type Person } from "@ledgerly/domain/users";
import type { Ctx } from "@ledgerly/domain/platform/context";
import { formatDate, formatMoney, formatWholePercent, type UiLocale } from "@ledgerly/format/format";
import { monthKey, today } from "@ledgerly/domain/shared/dates";
import { readEnv } from "@ledgerly/domain/platform/env";
import type { JobDefinition } from "@/platform/jobs/registry";
import type { JobDetail } from "@ledgerly/domain/platform/jobs";
import { clearNotification, notify } from "@/platform/notifications/service";
import { resolve } from "@ledgerly/domain/platform/notifications";
import en from "../../../../../messages/en.json";
import it from "../../../../../messages/it.json";
import { alertSettings, budgetsView } from "@ledgerly/domain/budgets";

type BudgetRow = Awaited<ReturnType<typeof budgetsView>>["rows"][number];
import {
  budgetName,
  budgetSlug,
  DEFAULT_ALERT_SETTINGS,
  reachedThreshold,
  thresholdReached,
} from "@ledgerly/domain/budgets";

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

/** The email of one budget at its highest threshold reached: the texts of before R5e. */
function budgetMail(ctx: Ctx, row: BudgetRow, month: string, reached: number) {
  const t = createTranslator({ locale: ctx.locale, messages: CATALOGUES[ctx.locale], namespace: "budgets" });
  const money = (cents: bigint) => formatMoney(cents, ctx.numberFormat);
  return alertMail(ctx.locale, row.status === "over", {
    budget: budgetName(row) ?? t("allCategories"),
    account: row.accountName ?? t("allAccounts"),
    month: formatDate(month, "monthYear", ctx.locale),
    percent: formatWholePercent(row.percent, ctx.numberFormat),
    threshold: formatWholePercent(reached, ctx.numberFormat),
    spent: money(row.spentCents),
    limit: money(row.limitCents),
    left: money(row.limitCents - row.spentCents),
    excess: money(row.spentCents - row.limitCents),
    url: `${readEnv().BETTER_AUTH_URL}/budgets/${budgetSlug(row)}`,
  });
}

/** One person's pass: their budgets' alerts of the month. Returns the emails sent. */
async function alertBudgets(person: Person, ctx: Ctx, now: Date): Promise<number> {
  let sent = 0;
  const month = monthKey(today(ctx.timeZone, now));
  const [view, settings] = await Promise.all([budgetsView(ctx, month), alertSettings(ctx)]);
  // The facts of R5e: one per budget and month, at its highest threshold reached.
  const reachedNow: string[] = [];
  if (view.rows.length === 0) {
    await resolve(ctx, "budget_threshold", { keep: [] }, now);
    return 0;
  }
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
    reachedNow.push(`${row.key}|${month}`);
    const delivered = await notify(
      ctx,
      {
        event: "budget_threshold",
        subject: `${row.key}|${month}`,
        targetId: budgetSlug(row),
        params: { percent: reached },
      },
      {
        kind: BUDGET_ALERT_KIND,
        key: keyOf(reached),
        cooldownHours: COOLDOWN_HOURS,
        mail: { to: person.email, ...budgetMail(ctx, row, month, reached) },
      },
      now,
    );
    if (delivered) sent += 1;
  }
  await resolve(ctx, "budget_threshold", { keep: reachedNow }, now);
  return sent;
}

/**
 * The budget alerts (spec §7.3): every budget of the current month, in the user's own zone, that
 * has reached one of the thresholds its owner chose on its page — 85 % and over the limit until
 * they choose otherwise — emails once for that threshold and month.
 *
 * After a sync that changed the movements (`runAfterSync`), so an alert follows the movement that
 * caused it at once.
 * One email per pass and budget: when a single movement walks past several thresholds, only the
 * highest is news. A threshold the budget has fallen back under (a refund, a limit raised) is
 * forgotten, so reaching it again later in the month emails again.
 */
export const budgetAlertsJob: JobDefinition = {
  name: "budgets-alerts",
  tier: "afterSync",
  async run(): Promise<JobDetail> {
    const now = new Date();
    let sent = 0;
    const counts = await forEachUser(
      "budgets-alerts",
      async (person, ctx) => {
        sent += await alertBudgets(person, ctx, now);
      },
      { addon: "budgets" },
    );
    return { ...counts, sent };
  },
};
