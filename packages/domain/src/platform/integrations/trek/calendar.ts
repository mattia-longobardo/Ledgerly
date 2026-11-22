// Trek as the external calendar of time off (audit TOF-1): the adapter of the port
// `LeaveCalendarSync`, wired by `wireDomain` in `apps/api`. Until R5c makes Trek a plugin.
import type { LeaveCalendarSync } from "../../../modules/timeoff";
import { enqueue } from "../../jobs/queue";
import { isTrekBusy, syncTrekNow, trekConnection, trekStatsOf } from "./sync";

export const trekCalendar: LeaveCalendarSync = {
  passNow: (ctx) => syncTrekNow(ctx),
  isBusy: (error) => isTrekBusy(error),
  figuresOf: (ctx, year) => trekStatsOf(ctx, year),
  /**
   * The «update now» of the connection, run by the worker (the task of `tasks.updateConnection` of
   * the web): a person with no Trek link asks for nothing.
   */
  async requestPass(ctx) {
    const connection = await trekConnection(ctx);
    if (!connection) return;
    await enqueue({
      kind: "connection-update",
      key: `connection:${connection.id}`,
      payload: { userId: ctx.userId, connectionId: connection.id, presence: null },
    });
  },
};
