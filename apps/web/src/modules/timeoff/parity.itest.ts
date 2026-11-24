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
import { oldLeaveTypes, type OldTypes } from "../../../../../test/leave-types";

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
  /** A type as the action read it (R5g: an id, where it was a kind). */
  const TYPE = z.uuid();
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
      write(async () =>
        timeoff.bookLeave(ctx, {
          from: input.from,
          to: input.to,
          typeId: TYPE.parse(input.typeId),
          fraction: optionalNumber(input.fraction) ?? 1,
          note: input.note.trim() || null,
          editedTypeId: input.editedTypeId == null ? null : TYPE.parse(input.editedTypeId),
          ...(input.otherTypeId == null ? {} : { otherTypeId: TYPE.parse(input.otherTypeId) }),
        }),
      ),
    removeLeave: (ctx: Ctx, target: { id: string } | { date: string }) =>
      write(() => timeoff.unbookLeave(ctx, removal.parse(target))),
    removeLeaveRange: (ctx: Ctx, range: { from: string; to: string }) =>
      write(() => timeoff.unbookLeaveRange(ctx, range)),
    // R5g: an allowance is a type's, with the carry-over a person states when no payslip says it.
    saveTypeAllowance: (
      ctx: Ctx,
      input: { typeId: string; year: number; days: string; carriedDays: string },
    ) =>
      write(async () => {
        await timeoff.saveTypeAllowance(ctx, input.typeId, input.year, {
          days: optionalNumber(input.days),
          carriedDays: optionalNumber(input.carriedDays),
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

/** The panel's fields, with the person's own types (R5g: each person has their own ids). */
const fields = (types: OldTypes, overrides: Partial<LeaveFormInput> = {}): LeaveFormInput => ({
  from: MON,
  to: TUE,
  typeId: types.vacation,
  fraction: "1",
  note: " am ",
  ...overrides,
});

let alice: Ctx;
let bob: Ctx;
let types: Map<string, OldTypes>;

/** An answer of `ctx` with each of their type ids written as its old kind: two people's ids differ. */
function asKinds<T>(ctx: Ctx, answer: T): unknown {
  let text = JSON.stringify(answer);
  for (const [kind, id] of Object.entries(types.get(ctx.userId) ?? {})) text = text.replaceAll(id, kind);
  return JSON.parse(text);
}

/** The days a person has, without what tells two people's rows apart: the ids, the type's id. */
async function daysOf(ctx: Ctx) {
  const view = await yearOf(ctx);
  return asKinds(
    ctx,
    bookedOf(view.rows).map((day) => ({ ...day, id: "" })),
  );
}
const requestPass = vi.fn(async () => {});

beforeEach(async () => {
  await resetDatabase();
  alice = contextFor((await createTestUser()).id);
  bob = contextFor((await createTestUser()).id);
  types = new Map([
    [alice.userId, await oldLeaveTypes(alice)],
    [bob.userId, await oldLeaveTypes(bob)],
  ]);
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
  const NOBODYS = "0190a1b2-c3d4-7e5f-8a9b-0c1d2e3f4a5b";
  it.each<[string, (types: OldTypes) => LeaveFormInput]>([
    ["a range with a note to trim", (t) => fields(t)],
    ["half days", (t) => fields(t, { fraction: "0.5" })],
    ["«½ + ½»", (t) => fields(t, { fraction: "0.5", otherTypeId: t.rol })],
    ["a weekend only", (t) => fields(t, { from: SAT, to: SAT })],
    ["a type of somebody else's", (t) => fields(t, { typeId: NOBODYS })],
    ["a type nobody can read", (t) => fields(t, { typeId: "holiday" })],
    ["a second half nobody defined", (t) => fields(t, { fraction: "0.5", otherTypeId: "nap" })],
    ["a size nobody can read", (t) => fields(t, { fraction: "abc" })],
  ])("answers and stores the same for %s", async (_case, input) => {
    const old = await actions.saveLeaveRange(alice, input(types.get(alice.userId) as OldTypes));
    const now = await asPerson(bob, () =>
      calls.saveLeaveRangeAction(input(types.get(bob.userId) as OldTypes)),
    );
    expect(now).toEqual(old);
    expect(await daysOf(bob)).toEqual(await daysOf(alice));
  });

  it("removes a row, a date and a range, and undoes, as the actions did", async () => {
    for (const ctx of [alice, bob])
      await asPerson(ctx, () =>
        calls.saveLeaveRangeAction(fields(types.get(ctx.userId) as OldTypes, { to: FRI })),
      );
    const firstOf = async (ctx: Ctx) => bookedOf((await yearOf(ctx)).rows)[0].id;

    const old = await actions.removeLeave(alice, { id: await firstOf(alice) });
    const now = await asPerson(bob, async () => calls.removeLeaveAction({ id: await firstOf(bob) }));
    expect(asKinds(bob, now)).toEqual(asKinds(alice, old));
    expect(asKinds(alice, await actions.removeLeave(alice, { date: TUE }))).toEqual(
      asKinds(bob, await asPerson(bob, () => calls.removeLeaveAction({ date: TUE }))),
    );
    expect(await actions.removeLeave(alice, { date: "16 June" })).toEqual(
      await asPerson(bob, () => calls.removeLeaveAction({ date: "16 June" })),
    );
    const range = { from: MON, to: FRI };
    const oldRange = await actions.removeLeaveRange(alice, range);
    const newRange = await asPerson(bob, () => calls.removeLeaveRangeAction(range));
    expect(asKinds(bob, newRange)).toEqual(asKinds(alice, oldRange));
    expect(await daysOf(bob)).toEqual(await daysOf(alice));

    if (!newRange.ok) throw new Error("the range was not removed");
    expect(await asPerson(bob, () => calls.undoLeaveAction(newRange.undo))).toEqual({ ok: true });
    if (!oldRange.ok) throw new Error("the range was not removed by the action");
    await timeoff.undoLeave(alice, oldRange.undo);
    expect(await daysOf(bob)).toEqual(await daysOf(alice));
  });

  // R5g: the four old kinds a migrated person has as types; sickness became "other".
  it.each(["vacation", "rol", "comp", "other"] as const)(
    "asks the external calendar for a pass after a %s day exactly when its type goes there",
    async (kind) => {
      const own = types.get(alice.userId) as OldTypes;
      const type = (await timeoff.listLeaveTypes(alice)).find((one) => one.id === own[kind]);
      expect(
        await asPerson(alice, () =>
          calls.saveLeaveRangeAction(fields(own, { from: FRI, to: FRI, typeId: own[kind] })),
        ),
      ).toMatchObject({
        ok: true,
        days: 1,
      });
      expect(requestPass).toHaveBeenCalledTimes(type?.toCalendar ? 1 : 0);
    },
  );

  it("states an allowance from the typed days, either separator, and refuses what nobody can read", async () => {
    const typed = (ctx: Ctx, days = "22,5") => ({
      typeId: (types.get(ctx.userId) as OldTypes).vacation,
      year: 2026,
      days,
      carriedDays: " 4 ",
    });
    expect(await asPerson(bob, () => settings.saveTypeAllowanceAction(typed(bob)))).toEqual(
      await actions.saveTypeAllowance(alice, typed(alice)),
    );
    const stated = async (ctx: Ctx) => asKinds(ctx, await timeoff.listTypeAllowances(ctx));
    expect(await stated(bob)).toEqual(await stated(alice));
    expect(await stated(alice)).toEqual([{ typeId: "vacation", year: 2026, days: 22.5, carriedDays: 4 }]);
    expect(await asPerson(bob, () => settings.saveTypeAllowanceAction(typed(bob, "four")))).toEqual(
      await actions.saveTypeAllowance(alice, typed(alice, "four")),
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
    const own = types.get(alice.userId) as OldTypes;
    await asPerson(alice, () =>
      settings.saveTypeAllowanceAction({ typeId: own.vacation, year: 2026, days: "20", carriedDays: "" }),
    );
    await asPerson(alice, () =>
      settings.saveTypeAllowanceAction({ typeId: own.rol, year: 2026, days: "4", carriedDays: "" }),
    );
    await asPerson(alice, () => calls.saveLeaveRangeAction(fields(own, { from: FRI, to: FRI })));
    const before = await yearOf(alice);

    // What the board hands the panel: the days of the table still booked, and the route's inputs.
    const days = liveDays(bookedOf(before.rows));
    const vacation = own.vacation;
    const range = {
      from: MON,
      to: TUE,
      typeId: vacation,
      fraction: 1,
      otherTypeId: null,
      editedTypeId: null,
    };
    const residuals = Object.fromEntries(
      before.balances.map((one: { typeId: string; residualInput: unknown }) => [
        one.typeId,
        one.residualInput,
      ]),
    );
    const preview = client.previewLeaveRange(range, {
      days,
      holidays: new Set(before.holidays),
      types: before.types,
      workDays: before.workDays,
      minutesPerDay: before.minutesPerDay,
      residuals,
      window: before.window,
    });
    const ofVacation = <T extends { typeId: string }>(list: readonly T[]) =>
      list.filter((day) => day.typeId === vacation);
    const forecastOf = (view: typeof before) =>
      view.balances.find((one: { typeId: string }) => one.typeId === vacation).forecastInput;
    const forecast = client.forecastChange(forecastOf(before), range, before.window, {
      before: ofVacation(days),
      after: ofVacation(preview.after),
    });

    expect(await asPerson(alice, () => calls.saveLeaveRangeAction(fields(own, { note: "" })))).toMatchObject({
      ok: true,
    });
    const after = await yearOf(alice);
    const balance = preview.balances.find((one) => one.typeId === vacation);
    expect(balance?.afterMinutes).toBe(
      after.balances.find((one: { typeId: string }) => one.typeId === vacation).residual.remainingMinutes,
    );
    const saved = liveDays(bookedOf(after.rows));
    expect(forecast?.afterMinutes).toBe(
      client.forecastChange(forecastOf(after), range, after.window, { before: saved, after: saved })
        ?.beforeMinutes,
    );
  });
});
