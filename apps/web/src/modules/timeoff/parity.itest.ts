// R3 parity of Time off (03-releases.md §R3, criterion 11). The writes: what a Server Action did with
// what a person typed is what `calls.ts` does through the routes, on the same fields — the same
// answer, the same days stored, the same pass of the external calendar. The Server Actions are gone;
// `actions` is what they did, line for line. The preview: what the leave panel shows before
// «Confirm», worked out from the answer of `GET /timeoff/{year}` as the board hands it over, is what
// the same route answers once the range is saved (the exception of the orchestrator: the panel runs
// `previewLeaveRange` and `forecastChange` of `timeoff/client` over the route's inputs).
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import type { Ctx } from "@domain/platform/context";
import { goesToCalendar, LEAVE_DAY_KINDS } from "@domain/modules/timeoff/rules";
import {
  HOLIDAY_SOURCES,
  HolidayError,
  listCountries,
  type HolidayCountry,
  type HolidaySource,
  type HolidaySubdivision,
} from "@ledgerly/domain/platform/holidays";
import { closeDatabase, resetDatabase } from "../../../../../test/db";
import type { LeaveFormInput } from "./calls";
import { createTestUser } from "../../../../../test/users";

vi.mock("next/server", () => ({ after: () => {} }));
vi.mock("next/headers", () => ({ headers: async () => new Headers() }));

const { adapters } = await import("@/app/api/v1/[[...route]]/composition");
const { apiRoutes, wireDomain } = await import("@ledgerly/api");
const timeoff = await import("@ledgerly/domain/timeoff");
const client = await import("@ledgerly/domain/timeoff/client");
const calls = await import("./calls");
const settings = await import("@/app/(app)/timeoff/settings/calls");
const { bookedOf, liveDays } = await import("./ui/booked");

/** Whose session the routes see: the person of the call in progress. */
let session: Ctx;

const routes = apiRoutes({
  ...adapters,
  guard: () => async (context, next) => {
    context.set("ctx", session);
    await next();
  },
});
/** What the holiday sources answer: Nager's list of countries, or nothing at all. */
let sources: "nager" | "down" = "down";
const NAGER = [{ countryCode: "IT", name: "Italy" }];

// `call` of the API client reaches the routes as the browser would, under `/api/v1`; the holiday
// sources are the test's.
vi.stubGlobal("fetch", async (url: string, init: RequestInit) => {
  if (url.startsWith("/api/v1/")) return routes.request(url.replace(/^\/api\/v1/, ""), init);
  if (sources === "nager" && url.endsWith("/api/v3/AvailableCountries")) return Response.json(NAGER);
  throw new TypeError("fetch failed");
});

function contextFor(userId: string): Ctx {
  return {
    userId,
    role: "user",
    locale: "en",
    timeZone: "Europe/Rome",
    numberFormat: "it-IT",
    displayCurrency: "EUR",
  };
}

/** The year as the route answers it, for the person of `ctx`. */
async function yearOf(ctx: Ctx) {
  session = ctx;
  const response = await routes.request("/timeoff/2026");
  return response.json();
}

/** A call of `calls.ts` in the session of `ctx`. */
async function asPerson<T>(ctx: Ctx, work: () => Promise<T>): Promise<T> {
  session = ctx;
  return work();
}

/** The deleted Server Actions: the fields read on the server, the use case, the code of a refusal. */
const actions = (() => {
  const KINDS = z.enum(LEAVE_DAY_KINDS);
  function optionalNumber(value: string): number | null {
    const text = value.trim().replace(",", ".");
    if (text === "") return null;
    const parsed = Number(text);
    if (!Number.isFinite(parsed)) throw new timeoff.TimeOffError("invalid_input");
    return parsed;
  }
  function failed(error: unknown) {
    if (error instanceof timeoff.TimeOffError) {
      return error.refused.length > 0
        ? { ok: false as const, error: error.code, refused: [...error.refused] }
        : { ok: false as const, error: error.code };
    }
    if (error instanceof z.ZodError || error instanceof RangeError)
      return { ok: false as const, error: "invalid" };
    throw error;
  }
  async function write<T extends object>(work: () => Promise<T>) {
    try {
      return { ok: true as const, ...(await work()) };
    } catch (error) {
      return failed(error);
    }
  }
  const holidayFailed = (error: unknown) => {
    if (error instanceof HolidayError) return { ok: false as const, error: "unreachable" };
    return { ok: false as const, error: "failed" };
  };
  const removal = z.union([z.object({ id: z.uuid() }), z.object({ date: z.iso.date() })]);
  const SOURCES = z.enum(HOLIDAY_SOURCES);
  const isSource = (source: string): source is HolidaySource => SOURCES.safeParse(source).success;
  return {
    saveLeaveRange: (ctx: Ctx, input: LeaveFormInput) =>
      write(() =>
        timeoff.bookLeave(ctx, {
          from: input.from,
          to: input.to,
          kind: KINDS.parse(input.kind),
          fraction: optionalNumber(input.fraction) ?? 1,
          note: input.note.trim() || null,
          editedKind: input.editedKind == null ? null : KINDS.parse(input.editedKind),
          ...(input.otherKind == null ? {} : { otherKind: KINDS.parse(input.otherKind) }),
        }),
      ),
    removeLeave: (ctx: Ctx, target: { id: string } | { date: string }) =>
      write(() => timeoff.unbookLeave(ctx, removal.parse(target))),
    removeLeaveRange: (ctx: Ctx, range: { from: string; to: string }) =>
      write(() => timeoff.unbookLeaveRange(ctx, range)),
    saveAllowance: (
      ctx: Ctx,
      input: { year: string; vacationDays: string; rolDays: string; totalDays: string; note: string },
    ) =>
      write(async () => {
        await timeoff.saveAllowance(ctx, Number(input.year), {
          vacationDays: optionalNumber(input.vacationDays),
          rolDays: optionalNumber(input.rolDays),
          totalDays: optionalNumber(input.totalDays),
          note: input.note.trim() || null,
        });
        return {};
      }),
    holidayCountries: async (
      ctx: Ctx,
    ): Promise<{ ok: true; countries: HolidayCountry[] } | { ok: false; error: string }> => {
      try {
        return { ok: true, countries: await listCountries(ctx.locale) };
      } catch (error) {
        return holidayFailed(error);
      }
    },
    /** The one refusal of the places that needs no source to answer: a source nobody defined. */
    holidaySubdivisions: (
      source: string,
    ): { ok: true; places: HolidaySubdivision[] } | { ok: false; error: string } | null =>
      isSource(source) ? null : { ok: false, error: "invalid" },
  };
})();

// A week of December 2026, Monday to Friday, and its Saturday: no holiday of any calendar falls in it.
const MON = "2026-12-14";
const TUE = "2026-12-15";
const FRI = "2026-12-18";
const SAT = "2026-12-19";

const fields = (overrides: Partial<LeaveFormInput> = {}): LeaveFormInput => ({
  from: MON,
  to: TUE,
  kind: "vacation",
  fraction: "1",
  note: " am ",
  ...overrides,
});

/** The days a person has, without what tells two people's rows apart. */
async function daysOf(ctx: Ctx) {
  const view = await yearOf(ctx);
  return bookedOf(view.rows).map((day) => ({ ...day, id: "" }));
}

let alice: Ctx;
let bob: Ctx;
const requestPass = vi.fn(async () => {});

beforeEach(async () => {
  await resetDatabase();
  alice = contextFor((await createTestUser()).id);
  bob = contextFor((await createTestUser()).id);
  requestPass.mockClear();
  // The external calendar of the test: what `LeaveChanged` asks of it, and nothing else.
  timeoff.wireTimeoff({
    calendar: { passNow: async () => null, isBusy: () => false, requestPass, figuresOf: async () => null },
  });
});

afterAll(async () => {
  wireDomain();
  vi.unstubAllGlobals();
  await closeDatabase();
});

describe("parity of the leave panel's writes: Server Action = call of the route", () => {
  it.each([
    ["a range with a note to trim", fields()],
    ["half days", fields({ fraction: "0.5" })],
    ["«½ + ½»", fields({ fraction: "0.5", otherKind: "rol" })],
    ["a weekend only", fields({ from: SAT, to: SAT })],
    ["a kind nobody defined", fields({ kind: "holiday" })],
    ["a second half nobody defined", fields({ fraction: "0.5", otherKind: "nap" })],
    ["a size nobody can read", fields({ fraction: "abc" })],
  ])("answers and stores the same for %s", async (_case, input) => {
    const old = await actions.saveLeaveRange(alice, input);
    const now = await asPerson(bob, () => calls.saveLeaveRangeAction(input));
    expect(now).toEqual(old);
    expect(await daysOf(bob)).toEqual(await daysOf(alice));
  });

  it("removes a row, a date and a range, and undoes, as the actions did", async () => {
    for (const ctx of [alice, bob])
      await asPerson(ctx, () => calls.saveLeaveRangeAction(fields({ to: FRI })));
    const firstOf = async (ctx: Ctx) => bookedOf((await yearOf(ctx)).rows)[0].id;

    const old = await actions.removeLeave(alice, { id: await firstOf(alice) });
    const now = await asPerson(bob, async () => calls.removeLeaveAction({ id: await firstOf(bob) }));
    expect(now).toEqual(old);
    expect(await actions.removeLeave(alice, { date: TUE })).toEqual(
      await asPerson(bob, () => calls.removeLeaveAction({ date: TUE })),
    );
    expect(await actions.removeLeave(alice, { date: "16 June" })).toEqual(
      await asPerson(bob, () => calls.removeLeaveAction({ date: "16 June" })),
    );
    const range = { from: MON, to: FRI };
    const oldRange = await actions.removeLeaveRange(alice, range);
    const newRange = await asPerson(bob, () => calls.removeLeaveRangeAction(range));
    expect(newRange).toEqual(oldRange);
    expect(await daysOf(bob)).toEqual(await daysOf(alice));

    if (!newRange.ok) throw new Error("the range was not removed");
    expect(await asPerson(bob, () => calls.undoLeaveAction(newRange.undo))).toEqual({ ok: true });
    await timeoff.undoLeave(alice, oldRange.ok ? oldRange.undo : newRange.undo);
    expect(await daysOf(bob)).toEqual(await daysOf(alice));
  });

  it.each(LEAVE_DAY_KINDS)(
    "asks the external calendar for a pass after a %s day exactly when the rules send it",
    async (kind) => {
      expect(
        await asPerson(alice, () => calls.saveLeaveRangeAction(fields({ from: FRI, to: FRI, kind }))),
      ).toMatchObject({
        ok: true,
        days: 1,
      });
      expect(requestPass).toHaveBeenCalledTimes(goesToCalendar(kind) ? 1 : 0);
    },
  );

  it("states an allowance from the typed days, either separator, and refuses what nobody can read", async () => {
    const typed = { year: "2026", vacationDays: "22,5", rolDays: " 4 ", totalDays: "", note: " contract " };
    expect(await asPerson(bob, () => settings.saveAllowanceAction(typed))).toEqual(
      await actions.saveAllowance(alice, typed),
    );
    const stated = async (ctx: Ctx) => {
      const allowance = await timeoff.allowanceOf(ctx, 2026);
      return [allowance?.vacationDays, allowance?.rolDays, allowance?.totalDays, allowance?.note];
    };
    expect(await stated(bob)).toEqual(await stated(alice));
    const unreadable = { ...typed, rolDays: "four" };
    expect(await asPerson(bob, () => settings.saveAllowanceAction(unreadable))).toEqual(
      await actions.saveAllowance(alice, unreadable),
    );
  });

  it("lists the countries the sources name, and says when neither answers", async () => {
    sources = "nager";
    expect(await asPerson(bob, () => settings.holidayCountriesAction())).toEqual(
      await actions.holidayCountries(alice),
    );
    sources = "down";
    expect(await asPerson(bob, () => settings.holidayCountriesAction())).toEqual(
      await actions.holidayCountries(alice),
    );
    expect(await actions.holidayCountries(alice)).toEqual({ ok: false, error: "unreachable" });
  });

  it("refuses a holiday source nobody defined, before any source is asked", async () => {
    expect(await settings.holidaySubdivisionsAction("calendarific", "IT")).toEqual(
      actions.holidaySubdivisions("calendarific"),
    );
  });
});

describe("parity of the leave panel's preview: before «Confirm» = the route after the save", () => {
  it("shows the residual and the forecast the route answers once the range is saved", async () => {
    await asPerson(alice, () =>
      settings.saveAllowanceAction({
        year: "2026",
        vacationDays: "20",
        rolDays: "4",
        totalDays: "",
        note: "",
      }),
    );
    await asPerson(alice, () => calls.saveLeaveRangeAction(fields({ from: FRI, to: FRI })));
    const before = await yearOf(alice);

    // What the board hands the panel: the days of the table still booked, and the route's inputs.
    const days = liveDays(bookedOf(before.rows));
    const range = {
      from: MON,
      to: TUE,
      kind: "vacation" as const,
      fraction: 1,
      otherKind: null,
      editedKind: null,
    };
    const preview = client.previewLeaveRange(range, {
      days,
      holidays: new Set(before.holidays),
      residuals: before.residualInputs,
      year: 2026,
    });
    const ofVacation = <T extends { kind: string }>(list: readonly T[]) =>
      list.filter((day) => day.kind === "vacation");
    const forecast = client.forecastChange(before.forecastInputs.vacation, range, 2026, {
      before: ofVacation(days),
      after: ofVacation(preview.after),
    });

    expect(await asPerson(alice, () => calls.saveLeaveRangeAction(fields({ note: "" })))).toMatchObject({
      ok: true,
    });
    const after = await yearOf(alice);
    const balance = preview.balances.find((one) => one.kind === "vacation");
    expect(balance?.afterMinutes).toBe(after.vacation.residual.remainingMinutes);
    const saved = liveDays(bookedOf(after.rows));
    expect(forecast?.afterMinutes).toBe(
      client.forecastChange(after.forecastInputs.vacation, range, 2026, { before: saved, after: saved })
        ?.beforeMinutes,
    );
  });
});
