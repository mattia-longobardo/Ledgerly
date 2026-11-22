// R3 parity of Payroll (03-releases.md §R3, criterion 11). The writes: what a Server Action did with
// what a person typed is what `calls.ts` does through the routes, on the same fields — the same
// answer, the same review after it. The pages: what the old pages drew from the domain's views
// (`present.ts` before R3, line for line in `old`) is what the screens draw from the routes. The
// Server Actions are gone, but the upload; `actions` is what they did, line for line.
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { Ctx } from "@domain/platform/context";
import { deleteFolder, ensureBucket } from "@domain/platform/storage";
import type { DocumentState, Evidence } from "@ledgerly/domain/imports/client";
import { CODE_ROLES as WIRE_ROLES } from "@ledgerly/api-contract/payroll";
import {
  CODE_ROLES,
  effectiveValue,
  FIELD_GROUPS,
  FIELD_NAMES,
  FIELDS as CLIENT_FIELDS,
  type FieldGroup,
  type FieldName,
  isDerived,
  type PayslipType,
  type RegisterRow,
  SUMMED_FIELDS,
  type SummedField,
  type YearSummary,
} from "@ledgerly/domain/payroll/client";
import { formatAmountInput, formatDate, formatMoney, NULL_DISPLAY, parseAmount } from "@ledgerly/format/format";
import { type Cents, centsToDecimal, parseCents } from "@ledgerly/domain/shared/money";
import { numberStyle } from "@ledgerly/format/format";
import { closeDatabase, resetDatabase } from "../../../../../test/db";
import { MARCH, MARCH_UNKNOWN_CODE } from "../../../../../test/fixtures/payroll/samples";
import { twinPdf, type TwinPayslip } from "../../../../../test/fixtures/payroll/twin";
import { createTestUser } from "../../../../../test/users";

vi.mock("next/server", () => ({ after: () => {} }));
vi.mock("next/headers", () => ({ headers: async () => new Headers() }));

const { adapters } = await import("@/app/api/v1/[[...route]]/composition");
const { apiRoutes } = await import("@ledgerly/api");
const payroll = await import("@ledgerly/domain/payroll");
const { ImportError } = await import("@ledgerly/domain/imports");
const calls = await import("./calls");
const settings = await import("@/app/(app)/payroll/settings/calls");
const present = await import("./ui/present");

/** Whose session the routes see: the person of the call in progress. */
let session: Ctx;

const routes = apiRoutes({
  ...adapters,
  guard: () => async (context, next) => {
    context.set("ctx", session);
    await next();
  },
});

// `call` of the API client reaches the routes as the browser would, under `/api/v1`.
vi.stubGlobal("fetch", async (url: string, init: RequestInit) => {
  if (url.startsWith("/api/v1/")) return routes.request(url.replace(/^\/api\/v1/, ""), init);
  throw new TypeError("fetch failed");
});

async function get(ctx: Ctx, path: string) {
  session = ctx;
  return (await routes.request(path)).json();
}

/** A person whose number format is the one their preferences give the screens. */
async function person(): Promise<Ctx> {
  const userId = (await createTestUser()).id;
  const ctx: Ctx = { userId, role: "user", locale: "en", timeZone: "Europe/Rome", numberFormat: "it-IT", displayCurrency: "EUR" };
  return { ...ctx, numberFormat: numberStyle(await get(ctx, "/preferences")) };
}

/** A call of `calls.ts` in the session of `ctx`. */
async function asPerson<T>(ctx: Ctx, work: () => Promise<T>): Promise<T> {
  session = ctx;
  return work();
}

/** A payslip read and waiting for review: its document id. */
async function read(ctx: Ctx, twin: TwinPayslip): Promise<string> {
  const { document } = await payroll.uploadPayslip(ctx, { name: `${twin.period}.pdf`, bytes: await twinPdf(twin) });
  await payroll.processPayslip(ctx, document.id);
  return document.id;
}

/** The deleted Server Actions: the fields read on the server, the use case, the code of a refusal. */
const actions = (() => {
  function failed(error: unknown): { ok: false; error: string } {
    if (error instanceof payroll.PayrollError || error instanceof ImportError) return { ok: false, error: error.code };
    if (error instanceof RangeError) return { ok: false, error: "invalid_value" };
    throw error;
  }
  async function write<T extends object>(work: () => Promise<T>) {
    try {
      return { ok: true as const, ...(await work()) };
    } catch (error) {
      return failed(error);
    }
  }
  const none = async () => ({});
  function canonical(ctx: Ctx, field: string, typed: string): string {
    if (!payroll.isFieldName(field)) throw new payroll.PayrollError("invalid_value");
    const unit = payroll.FIELDS[field].unit;
    if (unit === "eur" || unit === "hours") return centsToDecimal(parseAmount(typed, ctx.numberFormat));
    return typed.trim();
  }
  return {
    decideField: (ctx: Ctx, id: string, field: string, typed: string | null) =>
      write(() =>
        payroll.decideField(ctx, id, field, typed === null ? null : canonical(ctx, field, typed)).then(none),
      ),
    verify: (ctx: Ctx, id: string, acknowledgeFailures: boolean) =>
      write(() => payroll.verifyPayslip(ctx, id, { acknowledgeFailures }).then(none)),
    apply: (ctx: Ctx, id: string) => write(() => payroll.applyPayslip(ctx, id).then(none)),
    reject: (ctx: Ctx, id: string) => write(() => payroll.rejectPayslip(ctx, id).then(none)),
    retry: (ctx: Ctx, id: string) => write(() => payroll.retryPayslip(ctx, id).then(none)),
    remove: (ctx: Ctx, id: string) => write(() => payroll.deletePayslip(ctx, id)),
    reopen: (ctx: Ctx, id: string) => write(async () => ({ restored: (await payroll.reopenPayslip(ctx, id)).restored })),
    rename: (ctx: Ctx, id: string, name: string) => write(() => payroll.renamePayslip(ctx, id, name).then(none)),
    setCode: (ctx: Ctx, code: string, role: string, note: string) =>
      write(() => payroll.setCodeRole(ctx, { code, role, note }).then(none)),
    resetCode: (ctx: Ctx, code: string) => write(() => payroll.resetCode(ctx, code).then(none)),
    fill: (ctx: Ctx, id: string) =>
      write(async () => {
        const { asked, filled } = await payroll.fillWithLlm(ctx, id);
        return { asked: asked.length, filled: filled.length };
      }),
  };
})();

/** The old pages' presentation (`ui/present.ts` before R3), from the domain's views. */
const old = (() => {
  type Format = Pick<Ctx, "numberFormat" | "locale">;
  const DECIMAL = /^-?\d+(\.\d{1,2})?$/;
  function displayValue(field: FieldName, value: string | null, format: Format): string {
    if (value === null) return NULL_DISPLAY;
    const unit = CLIENT_FIELDS[field].unit;
    if (unit === "eur") return DECIMAL.test(value) ? formatMoney(parseCents(value), format.numberFormat) : value;
    if (unit === "hours")
      return DECIMAL.test(value) ? `${formatAmountInput(parseCents(value), format.numberFormat)} h` : value;
    if (unit === "date") return formatDate(value, "long", format.locale);
    return value;
  }
  function inputValue(field: FieldName, value: string | null, format: Format): string {
    if (value === null) return "";
    const unit = CLIENT_FIELDS[field].unit;
    return unit === "eur" || unit === "hours" ? formatAmountInput(parseCents(value), format.numberFormat) : value;
  }
  function fieldGroups(evidence: readonly Evidence[], format: Format) {
    const byField = new Map(evidence.map((row) => [row.field, row]));
    return FIELD_GROUPS.map((group: FieldGroup) => ({
      group,
      fields: FIELD_NAMES.filter((field) => CLIENT_FIELDS[field].group === group).flatMap((field) => {
        const row = byField.get(field);
        if (!row) return [];
        const current = effectiveValue(row);
        return [
          {
            field,
            derived: isDerived(field),
            value: displayValue(field, current, format),
            input: inputValue(field, current, format),
            original: row.verification === "corrected" ? displayValue(field, row.value, format) : null,
            origin: row.origin,
            verification: row.verification,
            confidence: Number(row.confidence),
            sourceLabel: row.sourceLabel,
            derivedFrom: (row.derivedFrom ?? []).filter((name) => Object.hasOwn(CLIENT_FIELDS, name)),
            page: row.page,
            bbox: row.bbox && row.bbox.length === 4 ? row.bbox : null,
            unit: CLIENT_FIELDS[field].unit,
          },
        ];
      }),
    })).filter((group) => group.fields.length > 0);
  }
  function moneyCells(values: Record<SummedField, Cents | null>, format: Format): Record<SummedField, string> {
    const cells = {} as Record<SummedField, string>;
    for (const field of SUMMED_FIELDS) cells[field] = formatMoney(values[field], format.numberFormat);
    return cells;
  }
  const hours = (value: string | null | undefined, format: Format) =>
    value === null || value === undefined ? NULL_DISPLAY : `${formatAmountInput(parseCents(value), format.numberFormat)} h`;
  function rowCells({ payslip, document, leaveLeft, openWarnings }: RegisterRow, format: Format) {
    const values = {} as Record<SummedField, Cents | null>;
    for (const field of SUMMED_FIELDS) values[field] = payslip[field];
    const state: DocumentState = document.state;
    const badge: PayslipType | null = payslip.type === "ordinary" ? null : payslip.type;
    return {
      id: document.id,
      href: `/payroll/${document.id}`,
      month: payslip.period ? formatDate(payslip.period, "monthYear", format.locale) : String(payslip.year),
      badge,
      state,
      applied: payslip.active,
      fileName: document.fileName,
      hasOriginal: document.storageKey !== null,
      values: moneyCells(values, format),
      vacationLeft: hours(leaveLeft.vacation, format),
      rolLeft: hours(leaveLeft.rol, format),
      warnings: openWarnings,
    };
  }
  const registerGroups = (years: readonly YearSummary[], format: Format) =>
    years.map((year) => ({
      year: year.year,
      rows: year.rows.map((row) => rowCells(row, format)),
      totals: moneyCells(year.totals, format),
      averages: moneyCells(year.averages, format),
      hasApplied: year.rows.some((row) => row.payslip.active),
    }));
  return { fieldGroups, registerGroups };
})();

/** One payslip's review as a person reads it, without what tells two people's payslips apart. */
async function reviewOf(ctx: Ctx, id: string) {
  const review = await get(ctx, `/payroll/payslips/${id}`);
  if (!review.document) return review;
  return {
    state: review.document.state,
    fields: present.fieldGroups(review.fields, ctx),
    checks: review.checks,
    warnings: review.warnings,
    blocking: review.blocking,
    leaveEvents: review.leaveEvents,
    llmFill: review.llmFill,
  };
}

let alice: Ctx;
let bob: Ctx;

beforeAll(ensureBucket);
beforeEach(async () => {
  await resetDatabase();
  alice = await person();
  bob = await person();
});
afterAll(async () => {
  await deleteFolder("payslips/");
  vi.unstubAllGlobals();
  await closeDatabase();
});

describe("payroll, old page = new screen", () => {
  it("draws the same review and the same register", async () => {
    const applied = await read(alice, MARCH);
    await payroll.verifyPayslip(alice, applied);
    await payroll.applyPayslip(alice, applied);
    const waiting = await read(alice, MARCH_UNKNOWN_CODE);

    for (const id of [applied, waiting]) {
      const view = await payroll.reviewView(alice, id);
      const review = await get(alice, `/payroll/payslips/${id}`);
      expect(present.fieldGroups(review.fields, alice)).toEqual(old.fieldGroups(view!.evidence, alice));
      expect(review.checks.map((check: { id: string; status: string }) => [check.id, check.status])).toEqual(
        view!.assembled.checks.map((check) => [check.id, check.status]),
      );
      expect(review.periodLabel).toBe(view!.assembled.values.periodLabel ?? null);
    }
    const register = await get(alice, "/payroll/payslips");
    const view = await payroll.registerView(alice);
    expect(present.registerGroups(register.years, alice)).toEqual(old.registerGroups(view.years, alice));
    expect([register.awaiting, register.inFlight, register.applied]).toEqual([view.awaiting, view.inFlight, view.applied]);
  });
});

describe("payroll, old Server Action = new call", () => {
  it("decides, verifies, applies, reopens, renames and deletes alike", async () => {
    const [mine, theirs] = [await read(alice, MARCH), await read(bob, MARCH)];
    const field = (name: string) => ({ field: name, unit: payroll.isFieldName(name) ? payroll.FIELDS[name].unit : "text" });
    const both = async (
      before: () => Promise<unknown>,
      after: () => Promise<unknown>,
    ) => {
      const answers = [await before(), await asPerson(bob, after)];
      expect(answers[1]).toEqual(answers[0]);
      expect(await reviewOf(bob, theirs)).toEqual(await reviewOf(alice, mine));
      return answers[0];
    };

    // A correction typed in the person's format, a value no one can read, a derived value, a confirmation.
    await both(() => actions.decideField(alice, mine, "netPay", "1512,00"), () => calls.decideFieldAction(theirs, field("netPay"), "1512,00"));
    await both(() => actions.decideField(alice, mine, "netPay", "abc"), () => calls.decideFieldAction(theirs, field("netPay"), "abc"));
    await both(() => actions.decideField(alice, mine, "gross", "1,00"), () => calls.decideFieldAction(theirs, field("gross"), "1,00"));
    await both(() => actions.verify(alice, mine, false), () => calls.verifyPayslipAction(theirs, false));
    await both(() => actions.decideField(alice, mine, "netPay", "1511,00"), () => calls.decideFieldAction(theirs, field("netPay"), "1511,00"));
    await both(() => actions.decideField(alice, mine, "netPay", null), () => calls.decideFieldAction(theirs, field("netPay"), null));
    await both(() => actions.apply(alice, mine), () => calls.applyPayslipAction(theirs));
    await both(() => actions.verify(alice, mine, false), () => calls.verifyPayslipAction(theirs, false));
    await both(() => actions.apply(alice, mine), () => calls.applyPayslipAction(theirs));
    await both(() => actions.reopen(alice, mine), () => calls.reopenPayslipAction(theirs));
    await both(() => actions.fill(alice, mine), () => calls.fillWithLlmAction(theirs));
    await both(() => actions.rename(alice, mine, "march.pdf"), () => calls.renamePayslipAction(theirs, "march.pdf"));
    await both(() => actions.rename(alice, mine, "  "), () => calls.renamePayslipAction(theirs, "  "));
    await both(() => actions.retry(alice, mine), () => calls.retryPayslipAction(theirs));
    await both(() => actions.reject(alice, mine), () => calls.rejectPayslipAction(theirs));
    await both(() => actions.remove(alice, mine), () => calls.deletePayslipDocumentAction(theirs));
    // Gone: the next write is refused alike.
    await both(() => actions.reject(alice, mine), () => calls.rejectPayslipAction(theirs));
  });

  it("deletes an applied payslip alike: it leaves the register first", async () => {
    const [mine, theirs] = [await read(alice, MARCH), await read(bob, MARCH)];
    for (const [ctx, id] of [[alice, mine], [bob, theirs]] as const) {
      await payroll.verifyPayslip(ctx, id);
      await payroll.applyPayslip(ctx, id);
    }
    const before = await actions.remove(alice, mine);
    expect(await asPerson(bob, () => calls.deletePayslipDocumentAction(theirs))).toEqual(before);
    expect(before).toEqual({ ok: true, unapplied: true, restored: false });
    expect(await get(bob, "/payroll/payslips")).toEqual(await get(alice, "/payroll/payslips"));
  });

  it("sets and resets a code of the map alike, with the same roles to choose from", async () => {
    expect(WIRE_ROLES).toEqual(CODE_ROLES);
    const pairs: [() => Promise<unknown>, () => Promise<unknown>][] = [
      [() => actions.setCode(alice, " 5555 ", "statistical", " a note "), () => settings.setCodeRoleAction(" 5555 ", "statistical", " a note ")],
      [() => actions.setCode(alice, "9424", "separate_payment", ""), () => settings.setCodeRoleAction("9424", "separate_payment", "")],
      [() => actions.setCode(alice, "abc", "statistical", ""), () => settings.setCodeRoleAction("abc", "statistical", "")],
      [() => actions.setCode(alice, "5556", "nothing", ""), () => settings.setCodeRoleAction("5556", "nothing", "")],
      [() => actions.resetCode(alice, "9424"), () => settings.resetCodeAction("9424")],
    ];
    for (const [before, after] of pairs) {
      expect(await asPerson(bob, after)).toEqual(await before());
      expect(await get(bob, "/payroll/codes")).toEqual(await get(alice, "/payroll/codes"));
    }
  });
});
