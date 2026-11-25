// Time off (rewrite plan R2, 05-refactor.md §5.5): every route of the module and of its holiday
// calendars, all of them the domain's use cases, the ones the Server Actions call.
import type { Hono } from "hono";
import { z } from "zod";
import { TIMEOFF, TIMEOFF_ROUTES, type RouteContract } from "@ledgerly/api-contract";
import {
  HolidayError,
  HolidayServiceError,
  countDaysByCalendar,
  keepCalendar,
  listCalendars,
  listCountries,
  listSubdivisions,
  refetchCalendar,
  removeCalendar,
} from "@ledgerly/domain/platform/holidays";
import { today } from "@ledgerly/domain/shared/dates";
import {
  TimeOffError,
  addRestDay,
  bookLeave,
  calendarSync,
  deleteLeaveType,
  deleteRestDay,
  leaveSettingsOf,
  listLeaveTypes,
  listRestDays,
  saveLeaveSettings,
  saveLeaveType,
  saveTypeAllowance,
  timeOffView,
  unbookLeave,
  unbookLeaveRange,
  undoLeave,
} from "@ledgerly/domain/timeoff";
import { type ApiEnv, ApiRefusal, type Guard, serve } from "../serve";
import { timeOffYear } from "./dto";

const { timeoff, holidays, types: leaveTypes } = TIMEOFF;

/** Runs a use case of the module and turns its refusal into the contract's. */
async function refusing<T>(work: () => Promise<T>): Promise<T> {
  try {
    return await work();
  } catch (error) {
    if (error instanceof TimeOffError) {
      if (error.code === "not_found") throw new ApiRefusal("not_found");
      if (error.code === "not_bookable")
        throw new ApiRefusal("conflict", error.code, undefined, { refused: error.refused });
      if (error.code === "conflict" || error.code === "in_use") throw new ApiRefusal("conflict", error.code);
      throw new ApiRefusal("invalid", error.code);
    }
    if (error instanceof HolidayServiceError) {
      if (error.code === "not_found") throw new ApiRefusal("not_found");
      if (error.code === "invalid_input") throw new ApiRefusal("invalid", error.code);
      throw new ApiRefusal("conflict", error.code);
    }
    // The source of a holiday calendar did not answer: the calendar is kept, the error on its row.
    if (error instanceof HolidayError) throw new ApiRefusal("unavailable");
    if (error instanceof z.ZodError || error instanceof RangeError)
      throw new ApiRefusal("invalid", "invalid_input");
    throw error;
  }
}

function serveTypes(app: Hono<ApiEnv>, guard: Guard): void {
  const typeOut = ({
    id,
    name,
    color,
    unit,
    hasAllowance,
    toCalendar,
  }: Awaited<ReturnType<typeof saveLeaveType>>) => ({
    id,
    name,
    color,
    unit,
    hasAllowance,
    toCalendar,
  });
  serve(app, guard, leaveTypes.listLeaveTypes, async ({ ctx }) => ({
    types: (await listLeaveTypes(ctx)).map(typeOut),
  }));
  serve(app, guard, leaveTypes.createLeaveType, async ({ ctx, body }) =>
    typeOut(await refusing(() => saveLeaveType(ctx, null, body))),
  );
  serve(app, guard, leaveTypes.updateLeaveType, async ({ ctx, params, body }) =>
    typeOut(await refusing(() => saveLeaveType(ctx, params.id, body))),
  );
  serve(app, guard, leaveTypes.deleteLeaveType, async ({ ctx, params }) => {
    await refusing(() => deleteLeaveType(ctx, params.id));
  });
  serve(app, guard, leaveTypes.saveTypeAllowance, async ({ ctx, params, body }) =>
    refusing(() => saveTypeAllowance(ctx, params.id, Number(params.year), body)),
  );
  serve(app, guard, leaveTypes.getLeaveSettings, async ({ ctx }) => leaveSettingsOf(ctx));
  serve(app, guard, leaveTypes.saveLeaveSettings, async ({ ctx, body }) =>
    refusing(() => saveLeaveSettings(ctx, body)),
  );
  serve(app, guard, leaveTypes.listRestDays, async ({ ctx }) => ({
    days: (await listRestDays(ctx)).map(({ id, month, day, name }) => ({ id, month, day, name })),
  }));
  serve(app, guard, leaveTypes.addRestDay, async ({ ctx, body }) => {
    const { id, month, day, name } = await refusing(() => addRestDay(ctx, body));
    return { id, month, day, name };
  });
  serve(app, guard, leaveTypes.deleteRestDay, async ({ ctx, params }) => {
    await refusing(() => deleteRestDay(ctx, params.id));
  });
}

function serveYear(app: Hono<ApiEnv>, guard: Guard): void {
  serve(app, guard, timeoff.getTimeOff, async ({ ctx, params }) => {
    const year = Number(params.year);
    const [view, external] = await Promise.all([
      refusing(() => timeOffView(ctx, year)),
      calendarSync().figuresOf(ctx, year),
    ]);
    return timeOffYear(view, external);
  });
}

function serveLeave(app: Hono<ApiEnv>, guard: Guard): void {
  serve(app, guard, timeoff.saveLeave, async ({ ctx, body }) => {
    return refusing(() =>
      bookLeave(ctx, {
        ...body,
        editedTypeId: body.editedTypeId ?? null,
        otherTypeId: body.otherTypeId ?? null,
      }),
    );
  });
  serve(app, guard, timeoff.undoLeave, async ({ ctx, body }) => {
    const rows = body.rows.map((row) => ({ ...row, minutes: row.minutes ?? null }));
    await refusing(() => undoLeave(ctx, { dates: body.dates, rows }));
  });
  serve(app, guard, timeoff.removeLeaveRange, async ({ ctx, query }) =>
    refusing(() => unbookLeaveRange(ctx, query)),
  );
  serve(app, guard, timeoff.removeLeaveDay, async ({ ctx, params }) =>
    refusing(() => unbookLeave(ctx, { id: params.id })),
  );
  serve(app, guard, timeoff.removeLeaveOnDate, async ({ ctx, params }) =>
    refusing(() => unbookLeave(ctx, { date: params.date })),
  );
}

function serveHolidays(app: Hono<ApiEnv>, guard: Guard): void {
  serve(app, guard, holidays.listHolidayCountries, async ({ ctx }) => ({
    countries: await refusing(() => listCountries(ctx.locale)),
  }));
  serve(app, guard, holidays.listHolidaySubdivisions, async ({ ctx, query }) => ({
    places: await refusing(() => listSubdivisions(query.source, query.country, ctx.locale)),
  }));
  serve(app, guard, holidays.listHolidayCalendars, async ({ ctx }) => {
    const year = Number(today(ctx.timeZone).slice(0, 4));
    const [calendars, counts] = await Promise.all([listCalendars(ctx), countDaysByCalendar(ctx, year)]);
    return {
      calendars: calendars.map((one) => ({
        id: one.id,
        label: one.label,
        source: one.source,
        country: one.country,
        subdivision: one.subdivision,
        lastSyncedAt: one.lastSyncedAt?.toISOString() ?? null,
        lastError: one.lastError,
        days: counts[one.id] ?? 0,
      })),
    };
  });
  serve(app, guard, holidays.addHolidayCalendar, async ({ ctx, body }) => {
    // A fetch that fails keeps the calendar, as the action does: the answer says the source failed.
    const calendar = await refusing(() => keepCalendar(ctx, body));
    return { id: calendar.id };
  });
  serve(app, guard, holidays.removeHolidayCalendar, async ({ ctx, params }) => {
    await refusing(() => removeCalendar(ctx, params.id));
  });
  serve(app, guard, holidays.refreshHolidayCalendar, async ({ ctx, params }) => {
    await refusing(() => refetchCalendar(ctx, params.id));
  });
}

/** Every route of time off. */
export function serveTimeOff(app: Hono<ApiEnv>, guard: Guard): readonly RouteContract[] {
  serveTypes(app, guard);
  serveYear(app, guard);
  serveLeave(app, guard);
  serveHolidays(app, guard);
  return TIMEOFF_ROUTES;
}
