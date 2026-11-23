// The leave calendar of a plugin (`leaveCalendar`) as the external calendar of time off (audit
// TOF-1): the adapter of the port `LeaveCalendarSync` of timeoff, wired by `wireDomain` in `apps/api`.
import type { Ctx } from "@ledgerly/domain/platform/context";
import { enqueue } from "@ledgerly/domain/platform/jobs";
import { calendarConnection, calendarFiguresOf, isCalendarBusy, syncCalendarNow } from "./sync";

export const leaveCalendar = {
  passNow: (ctx: Ctx) => syncCalendarNow(ctx),
  isBusy: (error: unknown) => isCalendarBusy(error),
  figuresOf: (ctx: Pick<Ctx, "userId">, year: number) => calendarFiguresOf(ctx, year),
  /**
   * The «update now» of the connection, run by the worker (the task of `tasks.updateConnection` of
   * the web): a person with no calendar asks for nothing.
   */
  async requestPass(ctx: Pick<Ctx, "userId">) {
    const connection = await calendarConnection(ctx);
    if (!connection) return;
    await enqueue({
      kind: "connection-update",
      key: `connection:${connection.id}`,
      payload: { userId: ctx.userId, connectionId: connection.id, presence: null },
    });
  },
};
