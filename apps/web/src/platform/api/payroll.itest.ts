// The routes of payroll (rewrite plan R2, 05-refactor.md §5.5): each Server Action's use case through
// its route, the person's own data only, `PayslipApplied` from a route as from an action, and page =
// route = MCP tool. The guard is the test's: `api.itest.ts` proves the tokens, `session.itest.ts` the
// session-only «Fill with AI».
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { Ctx } from "@domain/platform/context";
import { deleteFolder, ensureBucket } from "@domain/platform/storage";
import { centsToDecimal } from "@domain/shared/money";
import { closeDatabase, resetDatabase } from "../../../../../test/db";
import { payrollFund } from "../../../../../test/funds";
import { createTestUser } from "../../../../../test/users";
import { MARCH, MARCH_UNKNOWN_CODE } from "../../../../../test/fixtures/payroll/samples";
import { twinPdf, type TwinPayslip } from "../../../../../test/fixtures/payroll/twin";

vi.mock("next/server", () => ({ after: () => {} }));
vi.mock("next/headers", () => ({ headers: async () => new Headers() }));

const { employer, manual } = await import("@ledgerly/api-contract/payroll");
const { reads, adapters } = await import("@/app/api/v1/[[...route]]/composition");
const { apiRoutes } = await import("@ledgerly/api");
const payroll = await import("@ledgerly/domain/payroll");
const { competencesOf } = await import("@domain/modules/funds/pension/service");

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

const tool = (name: string) => reads.find((one) => one.name === name)!;

/** A payslip read and waiting for review: its document id. The bucket wants the real clock. */
async function read(ctx: Ctx, twin: TwinPayslip): Promise<string> {
  const { document } = await payroll.uploadPayslip(ctx, {
    name: `${twin.period}.pdf`,
    bytes: await twinPdf(twin),
  });
  await payroll.processPayslip(ctx, document.id);
  return document.id;
}

let alice: Ctx;
let bob: Ctx;

beforeAll(ensureBucket);
beforeEach(async () => {
  await resetDatabase();
  alice = contextFor((await createTestUser()).id);
  bob = contextFor((await createTestUser()).id);
});
afterEach(() => vi.useRealTimers());
afterAll(async () => {
  await deleteFolder("payslips/");
  await closeDatabase();
});

describe("the routes of payroll", () => {
  it("review, verify and apply through the routes; the fund hears of it as from an action", async () => {
    const fund = await payrollFund(alice, { name: "Fund", startOn: "2020-01-01" });
    const id = await read(alice, MARCH);

    const review = await send(alice, "GET", `/payroll/payslips/${id}`);
    expect(review.status).toBe(200);
    expect(review.body.document).toMatchObject({ id, state: "needs_review", hasOriginal: true });
    expect(review.body.fields.map((field: { field: string }) => field.field)).toContain("netPay");
    expect(await tool("get_payslip").run(alice, { id })).toEqual(review.body);
    expect((await send(bob, "GET", `/payroll/payslips/${id}`)).status).toBe(404);

    // A confirmation answers the review; a derived field is refused.
    const confirmed = await send(alice, "PUT", `/payroll/payslips/${id}/fields/netPay`, { value: null });
    expect(confirmed.status).toBe(200);
    expect(
      confirmed.body.fields.find((field: { field: string }) => field.field === "netPay").verification,
    ).toBe("confirmed");
    expect(await send(alice, "PUT", `/payroll/payslips/${id}/fields/gross`, { value: "1.00" })).toEqual({
      status: 400,
      body: { error: "invalid", reason: "derived_field" },
    });
    // Applying before verifying is the wrong state.
    expect(await send(alice, "POST", `/payroll/payslips/${id}/apply`)).toEqual({
      status: 409,
      body: { error: "conflict", reason: "invalid_state" },
    });
    expect(
      (await send(alice, "POST", `/payroll/payslips/${id}/verify`, { acknowledgeFailures: false })).status,
    ).toBe(204);
    expect((await send(bob, "POST", `/payroll/payslips/${id}/apply`)).status).toBe(404);
    expect((await send(alice, "POST", `/payroll/payslips/${id}/apply`)).status).toBe(204);
    expect((await competencesOf(alice, [fund.id])).get(fund.id)).toHaveLength(1);

    const reopened = await send(alice, "POST", `/payroll/payslips/${id}/reopen`);
    expect(reopened).toEqual({ status: 200, body: { restored: false } });
    expect((await competencesOf(alice, [fund.id])).get(fund.id) ?? []).toHaveLength(0);

    expect((await send(alice, "PATCH", `/payroll/payslips/${id}`, { name: "march.pdf" })).status).toBe(204);
    expect((await send(alice, "GET", `/payroll/payslips/${id}`)).body.document.fileName).toBe("march.pdf");
    expect(await send(alice, "DELETE", `/payroll/payslips/${id}`)).toEqual({
      status: 200,
      body: { unapplied: false, restored: false },
    });
    expect((await send(alice, "GET", `/payroll/payslips/${id}`)).status).toBe(404);
  });

  it("answer the register the page reads, and get_payroll the same", async () => {
    const id = await read(alice, MARCH);
    await payroll.verifyPayslip(alice, id);
    await payroll.applyPayslip(alice, id);
    const waiting = await read(alice, MARCH_UNKNOWN_CODE);

    const register = await send(alice, "GET", "/payroll/payslips");
    expect(register.status).toBe(200);
    expect(await tool("get_payroll").run(alice, {})).toEqual(register.body);
    // Page = route: the same register, field by field.
    const view = await payroll.registerView(alice);
    const [year] = register.body.years;
    expect(year.year).toBe(view.years[0].year);
    expect(year.totals.netPay).toBe(centsToDecimal(view.years[0].totals.netPay!));
    expect(register.body.kpis.net3).toBe(centsToDecimal(view.kpis.net3!));
    const rows = new Map(year.rows.map((row: { id: string }) => [row.id, row]));
    expect(rows.get(id)).toMatchObject({ applied: true, openWarnings: 0, period: "2031-03-01" });
    expect(rows.get(waiting)).toMatchObject({ applied: false });
    const waitingRow = view.years[0].rows.find((row) => row.document?.id === waiting)!;
    expect((rows.get(waiting) as { openWarnings: number }).openWarnings).toBe(waitingRow.openWarnings);
    expect((await send(bob, "GET", "/payroll/payslips")).body.years).toEqual([]);
  });

  it("set and reset a code of the map", async () => {
    const before = await send(alice, "GET", "/payroll/codes");
    expect(before.body.codes.length).toBeGreaterThan(0);
    expect(before.body.codes.every((code: { seeded: boolean }) => code.seeded)).toBe(true);
    expect(await send(alice, "GET", "/payroll/codes")).toEqual({
      status: 200,
      body: { codes: await payroll.codeMapView(alice) },
    });

    expect((await send(alice, "PUT", "/payroll/codes/5555", { role: "statistical", note: "x" })).status).toBe(
      204,
    );
    const added = (await send(alice, "GET", "/payroll/codes")).body.codes.find(
      (code: { code: string }) => code.code === "5555",
    );
    expect(added).toEqual({ code: "5555", role: "statistical", note: "x", seeded: false });
    expect((await send(alice, "PUT", "/payroll/codes/5555", { role: "nothing", note: null })).status).toBe(
      400,
    );
    expect((await send(alice, "DELETE", "/payroll/codes/5555")).status).toBe(204);
    expect((await send(alice, "GET", "/payroll/codes")).body).toEqual(before.body);
    expect(
      (await send(bob, "GET", "/payroll/codes")).body.codes.some(
        (code: { code: string }) => code.code === "5555",
      ),
    ).toBe(false);
  });
});

describe("the routes of a payslip typed by hand and of the employer (rewrite plan R5g)", () => {
  const body = {
    kind: "ordinary",
    year: 2031,
    month: 3,
    extraNumber: null,
    paidOn: null,
    gross: "3000.00",
    taxes: "600.00",
    contributions: "280.00",
    net: "2100.00",
    fields: { irpefGross: "650.00" },
  };
  const byId = (path: string, id: string) => path.replace("{id}", id);

  it("create, read, change and delete a manual payslip; it is in the register and nobody else's", async () => {
    const created = await send(alice, "POST", manual.createManualPayslip.path, body);
    expect(created.status).toBe(201);
    expect(created.body).toMatchObject({
      kind: "ordinary",
      type: "ordinary",
      gross: "3000.00",
      fields: { irpefGross: "650.00" },
    });
    const id = created.body.id as string;
    const register = await send(alice, "GET", "/payroll/payslips");
    expect(register.body.years[0].rows[0]).toMatchObject({
      id,
      payslipId: id,
      source: "manual",
      documentId: null,
      state: "applied",
      fields: { irpefGross: "650.00" },
    });
    expect(register.body.years[0].totals.irpefGross).toBe("650.00");
    expect((await send(bob, "GET", byId(manual.getManualPayslip.path, id))).status).toBe(404);
    const changed = await send(alice, "PUT", byId(manual.updateManualPayslip.path, id), {
      ...body,
      net: "2000.00",
    });
    expect(changed.body.net).toBe("2000.00");
    expect((await send(alice, "POST", manual.createManualPayslip.path, body)).status).toBe(409);
    expect(
      (await send(alice, "POST", manual.createManualPayslip.path, { ...body, month: 4, net: "3000.01" }))
        .status,
    ).toBe(400);
    expect((await send(alice, "DELETE", byId(manual.deleteManualPayslip.path, id))).body).toEqual({
      deletedDocument: false,
    });
    expect((await send(alice, "GET", "/payroll/payslips")).body.years).toEqual([]);
  });

  it("read and save the employer, and give the catalogue of fields", async () => {
    expect((await send(alice, "GET", employer.getPayrollEmployer.path)).body).toEqual({
      payFrequency: "monthly",
      extraMonths: [12],
      configured: false,
    });
    const saved = await send(alice, "PUT", employer.setPayrollEmployer.path, {
      payFrequency: "monthly",
      extraMonths: [12, 6],
    });
    expect(saved.body).toEqual({ payFrequency: "monthly", extraMonths: [12, 6], configured: true });
    expect(
      (
        await send(alice, "PUT", employer.setPayrollEmployer.path, {
          payFrequency: "monthly",
          extraMonths: [1, 2, 3, 4],
        })
      ).status,
    ).toBe(400);
    const fields = (await send(alice, "GET", employer.listPayslipFields.path)).body.fields as {
      key: string;
      base: boolean;
    }[];
    expect(fields.filter((field) => field.base).map((field) => field.key)).toEqual([
      "gross",
      "taxesTotal",
      "employeeSocial",
      "netPay",
    ]);
  });
});
