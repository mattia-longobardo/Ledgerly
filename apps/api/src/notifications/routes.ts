// The alerts of a person (rewrite plan R5e): «Da fare», the apps' periodic check, the read state and
// the channels of each event. The email of the monthly summary is the person's own preference.
import type { Hono } from "hono";
import {
  getNotificationPreferences,
  listNotifications,
  listTodo,
  markNotificationRead,
  NOTIFICATIONS_ROUTES,
  type RouteContract,
  setNotificationPreference,
} from "@ledgerly/api-contract";
import {
  chooseChannels,
  deviceFeed,
  markRead,
  NotificationError,
  notificationChoices,
  resolve,
  syncFacts,
  todoOf,
} from "@ledgerly/domain/platform/notifications";
import { fundsByAccount, fundsToVerify } from "@ledgerly/domain/funds";
import { transfersToConfirm } from "@ledgerly/domain/investments";
import { payslipsAwaitingReview } from "@ledgerly/domain/payroll";
import type { Ctx } from "@ledgerly/domain/platform/context";
import { listConnections } from "@ledgerly/domain/platform/integrations";
import { waitingForCategory } from "@ledgerly/domain/transactions";
import { changePreferences, getPreferences } from "@ledgerly/domain/users";
import { ApiRefusal, type ApiEnv, type Guard, serve } from "../serve";

/** A refusal of the rules, as the route's code. */
async function refusing<T>(work: () => Promise<T>): Promise<T> {
  try {
    return await work();
  } catch (error) {
    if (error instanceof NotificationError) throw new ApiRefusal(error.code);
    throw error;
  }
}

/** A count above zero is one fact about all of them; zero is none. */
const counted = (count: number) => (count === 0 ? [] : [{ subject: "all", params: { count } }]);

/**
 * «Da fare» as it is now, before it is read (R5e): the states of the modules that ask for an action
 * become facts or close theirs, and the facts of a connection that is gone are closed. Here, where
 * the modules are known: the service of the alerts knows none of them (10-modularity.md §10.3).
 */
async function refreshFacts(ctx: Ctx): Promise<void> {
  await syncFacts(ctx, "transactions_to_categorize", async () => counted(await waitingForCategory(ctx)));
  await syncFacts(ctx, "payslips_to_review", async () => counted(await payslipsAwaitingReview(ctx)));
  await syncFacts(ctx, "transfers_to_confirm", async () => counted(await transfersToConfirm(ctx)));
  await syncFacts(ctx, "fund_to_verify", async () =>
    (await fundsToVerify(ctx)).map((id) => ({ subject: id, targetId: id })),
  );
  const connections = (await listConnections(ctx)).map((connection) => connection.id);
  await resolve(ctx, "connection_failed", { keep: connections });
  await resolve(ctx, "connection_stale", { keep: connections });
  await resolve(ctx, "connection_expiring", { keepPrefixes: connections.map((id) => `${id}:`) });
}

/**
 * A fund's target with the id of its page (R5b): the account that holds its value, whose page in
 * Investments is the fund's. One read of the funds, and only when a fund is among the targets.
 */
async function withFundAccounts<T extends { target: { page: string; id: string | null } }>(
  ctx: Ctx,
  items: readonly T[],
) {
  const accountOf = items.some((item) => item.target.page === "fund")
    ? new Map([...(await fundsByAccount(ctx))].map(([accountId, fund]) => [fund.id, accountId]))
    : new Map<string, string>();
  return items.map((item) =>
    item.target.page === "fund"
      ? { ...item, target: { ...item.target, pageId: accountOf.get(item.target.id ?? "") ?? null } }
      : item,
  );
}

export function serveNotifications(app: Hono<ApiEnv>, guard: Guard): readonly RouteContract[] {
  serve(app, guard, listTodo, async ({ ctx }) => {
    await refreshFacts(ctx);
    return { items: await withFundAccounts(ctx, await todoOf(ctx)) };
  });
  serve(app, guard, listNotifications, async ({ ctx, query }) => {
    await refreshFacts(ctx);
    const feed = await refusing(() => deviceFeed(ctx, query));
    return { ...feed, items: await withFundAccounts(ctx, feed.items) };
  });
  serve(app, guard, markNotificationRead, ({ ctx, params }) => refusing(() => markRead(ctx, params.id)));
  serve(app, guard, getNotificationPreferences, async ({ ctx }) =>
    notificationChoices(ctx, (await getPreferences(ctx)).monthlySummary),
  );
  serve(app, guard, setNotificationPreference, async ({ ctx, params, body }) => {
    await refusing(() => chooseChannels(ctx, params.event, body));
    if (params.event === "monthly_summary" && body.email !== undefined) {
      await changePreferences(ctx, { monthlySummary: body.email });
    }
    return notificationChoices(ctx, (await getPreferences(ctx)).monthlySummary);
  });
  return NOTIFICATIONS_ROUTES;
}
