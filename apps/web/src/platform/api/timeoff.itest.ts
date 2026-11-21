// The routes of time off (rewrite plan R2, 05-refactor.md §5.5): each Server Action's use case
// through its route, the person's own data only, `LeaveChanged` from a route as from an action, and
// page = route = MCP tool. The leave panel's preview («before → after») is the client's, from the
// pure functions of `timeoff/client` over the answer of `GET /timeoff/{year}`: it must be what the
// same route answers after the save. The guard is the test's: `api.itest.ts` proves the tokens.
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { Ctx } from "@domain/platform/context";
import { closeDatabase, resetDatabase } from "../../../../../test/db";
import { createTestUser } from "../../../../../test/users";

vi.mock("next/server", () => ({ after: () => {} }));
vi.mock("next/headers", () => ({ headers: async () => new Headers() }));

const { reads, adapters } = await import("@/app/api/v1/[[...route]]/composition");
const { apiRoutes, wireDomain } = await import("@ledgerly/api");
const timeoff = await import("@ledgerly/domain/timeoff");
const client = await import("@ledgerly/domain/timeoff/client");

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

async function send(ctx: Ctx, method: string, path: string, body?: unknown) {
  const routes = apiRoutes({
    ...adapters,
    guard: () => async (context, next) => {
      context.set("ctx", ctx);
      await next();
    },
  });
  const response = await routes.request(path, {
    method,
    headers: { "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await response.text();
  return { status: response.status, body: text === "" ? null : JSON.parse(text) };
}

// A week of December 2026, Monday to Friday: no holiday of any calendar falls in it.
const MON = "2026-12-14";
const TUE = "2026-12-15";
const FRI = "2026-12-18";
const SAT = "2026-12-19";

const leave = (overrides: Record<string, unknown> = {}) => ({
  from: MON,
  to: TUE,
  kind: "vacation",
  fraction: 1,
  note: null,
  editedKind: null,
  otherKind: null,
  ...overrides,
});

let alice: Ctx;
let bob: Ctx;
const requestPass = vi.fn(async () => {});

beforeEach(async () => {
  await resetDatabase();
  alice = contextFor((await createTestUser()).id);
  bob = contextFor((await createTestUser()).id);
  requestPass.mockClear();
  // The external calendar of the test: what `LeaveChanged` asks of it, and nothing else.
  timeoff.wireTimeoff({ calendar: { passNow: async () => null, isBusy: () => false, requestPass } });
});

afterAll(async () => {
  wireDomain();
  await closeDatabase();
});

describe("the routes of time off", () => {
  it("state an allowance and answer it in days, and list it", async () => {
    const saved = await send(alice, "PUT", "/timeoff/allowances/2026", {
      vacationDays: 22,
      rolDays: 4.5,
      totalDays: null,
      note: "contract",
    });
    expect(saved).toEqual({
      status: 200,
      body: { year: 2026, vacationDays: 22, rolDays: 4.5, totalDays: null, note: "contract" },
    });
    expect((await send(alice, "GET", "/timeoff/allowances")).body).toEqual({ allowances: [saved.body] });
    expect((await send(bob, "GET", "/timeoff/allowances")).body).toEqual({ allowances: [] });
    expect((await send(alice, "PUT", "/timeoff/allowances/2026", { vacationDays: -1 })).status).toBe(400);
  });

  it("book, remove and undo through the routes, with the answer «Undo» sends back", async () => {
    const booked = await send(alice, "POST", "/timeoff/leave", leave());
    expect(booked).toEqual({
      status: 200,
      body: { undo: { dates: [MON, TUE], rows: [] }, days: 2, removed: 0, pending: 0 },
    });
    const year = (await send(alice, "GET", "/timeoff/2026")).body;
    const day = year.rows.find((row: { on: string }) => row.on === MON);
    expect(day).toMatchObject({ source: "day", kind: "vacation", origin: "manual", sync: "upsert" });

    const byId = await send(alice, "DELETE", `/timeoff/leave/${day.id}`);
    expect(byId.body).toMatchObject({ removed: 1, pending: 0 });
    expect((await send(alice, "POST", "/timeoff/leave/undo", byId.body.undo)).status).toBe(204);
    const byDate = await send(alice, "DELETE", `/timeoff/days/${TUE}`);
    expect(byDate.body).toMatchObject({ removed: 1 });
    const range = await send(alice, "DELETE", `/timeoff/leave?from=${MON}&to=${FRI}`);
    expect(range.body).toMatchObject({ days: 1, removed: 1 });
    // Nothing left to remove: an empty undo, as the action answers.
    expect((await send(alice, "DELETE", `/timeoff/leave?from=${MON}&to=${FRI}`)).body).toEqual({
      undo: { dates: [MON], rows: [] },
      days: 0,
      removed: 0,
      pending: 0,
    });
  });

  it("refuse in the contract's words, with the dates a booking cannot have", async () => {
    expect(await send(alice, "POST", "/timeoff/leave", leave({ from: SAT, to: SAT }))).toEqual({
      status: 409,
      body: { error: "conflict", reason: "not_bookable", refused: [{ on: SAT, reason: "weekend" }] },
    });
    expect(
      (await send(alice, "POST", "/timeoff/leave", leave({ from: "2026-01-01", to: "2026-12-31" }))).body,
    ).toEqual({ error: "invalid", reason: "range_too_long" });
    expect((await send(alice, "POST", "/timeoff/leave", leave({ to: "2026-12-01" }))).status).toBe(400);
    await send(alice, "POST", "/timeoff/leave", leave());
    const day = (await send(alice, "GET", "/timeoff/2026")).body.rows[0];
    // Bob cannot remove Alice's day, nor see it.
    expect((await send(bob, "DELETE", `/timeoff/leave/${day.id}`)).status).toBe(404);
    expect((await send(bob, "GET", "/timeoff/2026")).body.rows).toEqual([]);
  });

  it("raise LeaveChanged for a day the external calendar has to hear about, as the action does", async () => {
    await send(alice, "POST", "/timeoff/leave", leave({ kind: "other" }));
    expect(requestPass).not.toHaveBeenCalled();
    await send(alice, "POST", "/timeoff/leave", leave({ from: FRI, to: FRI }));
    expect(requestPass).toHaveBeenCalledWith({ userId: alice.userId });
  });

  it("keep no holiday calendar until one is added, and refuse one that is not there", async () => {
    expect((await send(alice, "GET", "/timeoff/holidays/calendars")).body).toEqual({ calendars: [] });
    const unknown = "0190a1b2-c3d4-7e5f-8a9b-0c1d2e3f4a5b";
    expect((await send(alice, "DELETE", `/timeoff/holidays/calendars/${unknown}`)).status).toBe(404);
    expect((await send(alice, "POST", `/timeoff/holidays/calendars/${unknown}/refresh`)).status).toBe(404);
  });
});

describe("parity of time off: page = route = MCP tool, preview = answer after the save", () => {
  it("answers the tool and the route with the page's numbers", async () => {
    await send(alice, "PUT", "/timeoff/allowances/2026", {
      vacationDays: 20,
      rolDays: 4,
      totalDays: 24,
      note: null,
    });
    await send(alice, "POST", "/timeoff/leave", leave());
    const route = (await send(alice, "GET", "/timeoff/2026")).body;
    const tool = reads.find((one) => one.name === "get_time_off")!;
    expect(await tool.run(alice, { year: "2026" })).toEqual(route);

    const page = await timeoff.timeOffView(alice, 2026);
    expect(route.vacation).toEqual(page.vacation);
    expect(route.rol).toEqual(page.rol);
    expect(route.totals).toEqual(page.totals);
    expect(route.months).toEqual(page.months);
    expect(route.accrual).toEqual(page.accrual);
    expect(route.overdrawn).toEqual(page.overdrawn);
  });

  it("previews in the panel what the route answers once the range is saved", async () => {
    await send(alice, "PUT", "/timeoff/allowances/2026", {
      vacationDays: 20,
      rolDays: 4,
      totalDays: null,
      note: null,
    });
    await send(alice, "POST", "/timeoff/leave", leave({ from: FRI, to: FRI }));
    const before = (await send(alice, "GET", "/timeoff/2026")).body;

    // What the panel computes before «Confirm», from the route's answer only.
    const range = {
      from: MON,
      to: TUE,
      kind: "vacation" as const,
      fraction: 1,
      otherKind: null,
      editedKind: null,
    };
    const booked = before.residualInputs.vacation.days;
    const preview = client.previewLeaveRange(range, {
      days: booked,
      holidays: new Set(before.holidays),
      residuals: before.residualInputs,
      year: 2026,
    });
    const forecast = client.forecastChange(before.forecastInputs.vacation, range, 2026, {
      before: booked,
      after: preview.after.filter((one) => one.kind === "vacation"),
    });

    await send(alice, "POST", "/timeoff/leave", leave());
    const after = (await send(alice, "GET", "/timeoff/2026")).body;
    const balance = preview.balances.find((one) => one.kind === "vacation");
    expect(balance?.afterMinutes).toBe(after.vacation.residual.remainingMinutes);
    const saved = after.residualInputs.vacation.days;
    expect(forecast?.afterMinutes).toBe(
      client.forecastChange(after.forecastInputs.vacation, range, 2026, { before: saved, after: saved })
        ?.beforeMinutes,
    );
  });
});
