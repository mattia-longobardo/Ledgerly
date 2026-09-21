/**
 * The holiday calendars against a real database (M3).
 *
 * The two rules worth defending: a refresh **replaces** a year, so a holiday that was withdrawn
 * can actually leave; and a source that fails writes nothing at all, so a bad afternoon never
 * turns into a year with no holidays in it — which would quietly make Christmas bookable.
 */
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { Ctx } from "@/platform/context";
import { closeDatabase, resetDatabase } from "../../../test/db";
import { newContext } from "../../../test/fixtures";
import {
  HolidayServiceError,
  MAX_CALENDARS,
  addCalendar,
  countDaysByCalendar,
  daysOfCalendar,
  holidaysFor,
  listCalendars,
  markCalendarFailed,
  refreshCalendar,
  removeCalendar,
} from "./service";
import type { HolidayFetchOptions } from "./sources";

let ctx: Ctx;
let other: Ctx;
const YEAR = 2026;
const MILAN = {
  source: "openholidays" as const,
  country: "IT",
  subdivision: "IT-LO-MI",
  label: "Italia · Milano",
};

beforeEach(async () => {
  await resetDatabase();
  ctx = await newContext();
  other = await newContext();
});

afterAll(closeDatabase);

/** A source that answers with exactly these holidays, or fails. */
function source(
  holidays: Array<{ startDate: string; name: string; nationwide?: boolean }>,
): HolidayFetchOptions {
  return {
    openHolidaysBase: "https://open.test",
    nagerBase: "https://nager.test",
    // Answers in whichever shape the URL asks for: the two services agree on nothing, and a
    // calendar's source decides which one it is talking to.
    fetch: vi.fn(async (url: string | URL | Request) => {
      const nager = String(url).includes("/api/v3/");
      const body = holidays.map((one) =>
        nager
          ? { date: one.startDate, localName: one.name, name: one.name, global: one.nationwide ?? true }
          : {
              startDate: one.startDate,
              name: [{ language: "IT", text: one.name }],
              nationwide: one.nationwide ?? true,
            },
      );
      return new Response(JSON.stringify(body), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }) as unknown as typeof globalThis.fetch,
  };
}

const failing: HolidayFetchOptions = {
  openHolidaysBase: "https://open.test",
  nagerBase: "https://nager.test",
  fetch: vi.fn(async () => new Response("down", { status: 503 })) as unknown as typeof globalThis.fetch,
};

describe("subscribing", () => {
  it("adds a calendar, and keeps one user's out of another's", async () => {
    const calendar = await addCalendar(ctx, MILAN);
    expect(calendar).toMatchObject({ source: "openholidays", country: "IT", subdivision: "IT-LO-MI" });
    expect(await listCalendars(ctx)).toHaveLength(1);
    expect(await listCalendars(other)).toHaveLength(0);
  });

  it("refuses the same place twice, but not the whole country beside a province", async () => {
    await addCalendar(ctx, MILAN);
    await expect(addCalendar(ctx, MILAN)).rejects.toThrow(HolidayServiceError);
    // "All of Italy" is a different subscription from "Milan", and both may be kept.
    const whole = await addCalendar(ctx, { ...MILAN, subdivision: null, label: "Italia" });
    expect(whole.subdivision).toBeNull();
    expect(await listCalendars(ctx)).toHaveLength(2);
  });

  it("refuses a country code that is not one", async () => {
    await expect(addCalendar(ctx, { ...MILAN, country: "Italia" })).rejects.toThrow(HolidayServiceError);
  });

  it("stops at as many calendars as anybody keeps", async () => {
    for (let index = 0; index < MAX_CALENDARS; index += 1) {
      await addCalendar(ctx, { ...MILAN, subdivision: `IT-X-${index}`, label: `Place ${index}` });
    }
    await expect(addCalendar(ctx, MILAN)).rejects.toThrow(HolidayServiceError);
  });

  it("takes the days with it when it goes", async () => {
    const calendar = await addCalendar(ctx, MILAN);
    await refreshCalendar(
      ctx,
      calendar,
      YEAR,
      "IT",
      source([{ startDate: "2026-01-01", name: "Capodanno" }]),
    );
    expect(await daysOfCalendar(ctx, calendar.id, YEAR)).toHaveLength(1);

    await removeCalendar(ctx, calendar.id);
    expect(await listCalendars(ctx)).toHaveLength(0);
    // The days went with it: nothing is left under the calendar that is no longer subscribed to.
    expect(await daysOfCalendar(ctx, calendar.id, YEAR)).toHaveLength(0);
    expect(await countDaysByCalendar(ctx, YEAR)).toEqual({});
  });

  it("refuses to remove somebody else's", async () => {
    const calendar = await addCalendar(ctx, MILAN);
    await expect(removeCalendar(other, calendar.id)).rejects.toThrow(HolidayServiceError);
    expect(await listCalendars(ctx)).toHaveLength(1);
  });
});

describe("refreshing", () => {
  it("writes the days, marks the calendar synced, and counts them", async () => {
    const calendar = await addCalendar(ctx, MILAN);
    const written = await refreshCalendar(
      ctx,
      calendar,
      YEAR,
      "IT",
      source([
        { startDate: "2026-01-01", name: "Capodanno" },
        { startDate: "2026-12-07", name: "Sant'Ambrogio", nationwide: false },
      ]),
    );
    expect(written).toBe(2);

    const days = await daysOfCalendar(ctx, calendar.id, YEAR);
    expect(days.map((one) => one.on)).toEqual(["2026-01-01", "2026-12-07"]);
    // The local feast is the interesting one, and it is marked as local.
    expect(days[1].nationwide).toBe(false);

    const [after] = await listCalendars(ctx);
    expect(after.lastSyncedAt).not.toBeNull();
    expect(after.lastError).toBeNull();
    expect(await countDaysByCalendar(ctx, YEAR)).toEqual({ [calendar.id]: 2 });
  });

  it("REPLACES the year, so a holiday that was withdrawn actually goes", async () => {
    const calendar = await addCalendar(ctx, MILAN);
    await refreshCalendar(
      ctx,
      calendar,
      YEAR,
      "IT",
      source([
        { startDate: "2026-01-01", name: "Capodanno" },
        { startDate: "2026-06-15", name: "Festa inventata" },
      ]),
    );
    expect(await daysOfCalendar(ctx, calendar.id, YEAR)).toHaveLength(2);

    // The source has thought better of the second one.
    await refreshCalendar(
      ctx,
      calendar,
      YEAR,
      "IT",
      source([{ startDate: "2026-01-01", name: "Capodanno" }]),
    );
    expect((await daysOfCalendar(ctx, calendar.id, YEAR)).map((one) => one.on)).toEqual(["2026-01-01"]);
  });

  it("leaves another year alone when one is replaced", async () => {
    const calendar = await addCalendar(ctx, MILAN);
    await refreshCalendar(
      ctx,
      calendar,
      2026,
      "IT",
      source([{ startDate: "2026-01-01", name: "Capodanno" }]),
    );
    await refreshCalendar(
      ctx,
      calendar,
      2027,
      "IT",
      source([{ startDate: "2027-01-01", name: "Capodanno" }]),
    );
    await refreshCalendar(ctx, calendar, 2026, "IT", source([{ startDate: "2026-01-06", name: "Epifania" }]));

    expect((await daysOfCalendar(ctx, calendar.id, 2026)).map((one) => one.on)).toEqual(["2026-01-06"]);
    expect((await daysOfCalendar(ctx, calendar.id, 2027)).map((one) => one.on)).toEqual(["2027-01-01"]);
  });

  it("writes NOTHING when the source fails, keeping the days it already had", async () => {
    const calendar = await addCalendar(ctx, MILAN);
    await refreshCalendar(
      ctx,
      calendar,
      YEAR,
      "IT",
      source([{ startDate: "2026-01-01", name: "Capodanno" }]),
    );

    await expect(refreshCalendar(ctx, calendar, YEAR, "IT", failing)).rejects.toThrow();
    // The good answer from before is still there: an empty year would make Christmas bookable.
    expect(await daysOfCalendar(ctx, calendar.id, YEAR)).toHaveLength(1);
  });

  it("records a failure on the row without touching the days", async () => {
    const calendar = await addCalendar(ctx, MILAN);
    await refreshCalendar(
      ctx,
      calendar,
      YEAR,
      "IT",
      source([{ startDate: "2026-01-01", name: "Capodanno" }]),
    );
    await markCalendarFailed(calendar.id, "openholidaysapi.org answered HTTP 503");

    const [after] = await listCalendars(ctx);
    expect(after.lastError).toContain("503");
    expect(after.lastSyncedAt).not.toBeNull();
    expect(await daysOfCalendar(ctx, calendar.id, YEAR)).toHaveLength(1);
  });
});

describe("holidaysFor — the one rule the leave screen asks about", () => {
  it("is the subscribed calendars, once they have days", async () => {
    const calendar = await addCalendar(ctx, MILAN);
    await refreshCalendar(
      ctx,
      calendar,
      YEAR,
      "IT",
      source([{ startDate: "2026-12-07", name: "Sant'Ambrogio", nationwide: false }]),
    );
    const holidays = await holidaysFor(ctx, [YEAR], null);
    expect(holidays.has("2026-12-07")).toBe(true);
    // And only those: the computed Italian list is not mixed in behind them.
    expect(holidays.has("2026-01-01")).toBe(false);
  });

  it("unions more than one calendar, which is the point of keeping several", async () => {
    const italy = await addCalendar(ctx, { ...MILAN, subdivision: null, label: "Italia" });
    const japan = await addCalendar(ctx, {
      source: "nager",
      country: "JP",
      subdivision: null,
      label: "Giappone",
    });
    await refreshCalendar(ctx, italy, YEAR, "IT", source([{ startDate: "2026-01-06", name: "Epifania" }]));
    await refreshCalendar(ctx, japan, YEAR, "IT", source([{ startDate: "2026-05-03", name: "Kenpō" }]));

    const holidays = await holidaysFor(ctx, [YEAR], null);
    expect(holidays.has("2026-01-06")).toBe(true);
    expect(holidays.has("2026-05-03")).toBe(true);
  });

  it("falls back to the computed Italian list for somebody who has set nothing up", async () => {
    const holidays = await holidaysFor(ctx, [YEAR], { month: 12, day: 7 });
    expect(holidays.has("2026-01-01")).toBe(true);
    expect(holidays.has("2026-04-06")).toBe(true); // Easter Monday, computed
    expect(holidays.has("2026-12-07")).toBe(true); // the patron saint from preferences
  });

  it("does NOT fall back for somebody who chose calendars that have not arrived yet", async () => {
    // Guessing Italy for a person who subscribed to Japan would refuse the wrong days.
    await addCalendar(ctx, { source: "nager", country: "JP", subdivision: null, label: "Giappone" });
    expect((await holidaysFor(ctx, [YEAR], { month: 12, day: 7 })).size).toBe(0);
  });

  it("keeps one user's holidays out of another's", async () => {
    const calendar = await addCalendar(ctx, MILAN);
    await refreshCalendar(
      ctx,
      calendar,
      YEAR,
      "IT",
      source([{ startDate: "2026-12-07", name: "Sant'Ambrogio" }]),
    );
    // The other user has no calendars, so they get the computed list, not this one.
    const theirs = await holidaysFor(other, [YEAR], null);
    expect(theirs.has("2026-01-01")).toBe(true);
    expect(theirs.size).toBeGreaterThan(1);
  });

  it("answers for more than one year, which a range crossing new year needs", async () => {
    const calendar = await addCalendar(ctx, MILAN);
    await refreshCalendar(ctx, calendar, 2026, "IT", source([{ startDate: "2026-12-25", name: "Natale" }]));
    await refreshCalendar(
      ctx,
      calendar,
      2027,
      "IT",
      source([{ startDate: "2027-01-01", name: "Capodanno" }]),
    );
    const holidays = await holidaysFor(ctx, [2026, 2027], null);
    expect(holidays.has("2026-12-25")).toBe(true);
    expect(holidays.has("2027-01-01")).toBe(true);
  });
});
