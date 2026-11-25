// scripts/seed-e2e/timeoff.ts — the users and the data of the flow `timeoff` (tests/e2e/timeoff/).
import { saveLeaveDay, saveTypeAllowance } from "@domain/modules/timeoff/service";
import { oldLeaveTypes } from "../../test/leave-types";
import { today } from "@domain/shared/dates";
import { contextOf, workingDay } from "./common";

/**
 * Time off (F7): the year's allowance and three days off in it — one taken, one planned, and half
 * a day of ROL — so the cards, the calendar and both table filters all have something to show.
 * The dates are worked out from today so the seed does not go stale, and only working days are
 * booked: the service refuses anything else.
 */
export async function seedTimeOff(email: string): Promise<void> {
  const ctx = await contextOf(email);
  const on = today(ctx.timeZone);
  const year = Number(on.slice(0, 4));
  // Days for both kinds since N9, and no carry-over to state: that one comes from the payslip.
  const types = await oldLeaveTypes(ctx);
  await saveTypeAllowance(ctx, types.vacation, year, { days: 26 });
  await saveTypeAllowance(ctx, types.rol, year, { days: 4 });
  await saveLeaveDay(ctx, { from: workingDay(on, -14), typeId: types.vacation, fraction: 1 });
  await saveLeaveDay(ctx, { from: workingDay(on, 21), typeId: types.vacation, fraction: 1 });
  await saveLeaveDay(ctx, { from: workingDay(on, -7), typeId: types.rol, fraction: 0.5 });
}
