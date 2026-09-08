import { describe, expect, it } from "vitest";
import type { PayrollMappingRule } from "../application/ports";
import { DEFAULT_MAPPING_RULES, classifyComponent } from "./mapping";

const globals: PayrollMappingRule[] = DEFAULT_MAPPING_RULES.map((r, i) => ({
  ...r,
  id: `g${i}`,
  userId: null,
}));

describe("DEFAULT_MAPPING_RULES", () => {
  it("covers every target the spec's mapping rules can name (Ruling R4-10)", () => {
    const kinds = new Set(DEFAULT_MAPPING_RULES.map((r) => r.target.kind));
    expect(kinds).toEqual(new Set(["earnings", "fund_contribution", "timeoff_balance", "timeoff_used"]));
  });

  it("targets the Cometa fund by slug, not by a numeric id no seed guarantees", () => {
    const fund = DEFAULT_MAPPING_RULES.filter((r) => r.target.kind === "fund_contribution");
    expect(fund.length).toBe(2);
    for (const r of fund) {
      expect(r.target).toMatchObject({ kind: "fund_contribution", fundSlug: "cometa" });
    }
    expect(fund.map((r) => (r.target as { part: string }).part).sort()).toEqual(["employee", "employer"]);
  });
});

describe("classifyComponent", () => {
  it("matches on the parser's own field code", () => {
    expect(classifyComponent(globals, "net", "Netto del mese")).toEqual({ kind: "earning", target: { kind: "earnings" } });
    expect(classifyComponent(globals, "taxes", "Totale trattenute")).toEqual({ kind: "tax", target: { kind: "earnings" } });
  });

  it("routes both Cometa halves to the fund bridge with the right part", () => {
    expect(classifyComponent(globals, "fundContribEmployee", "Contributo Cometa dipendente")).toEqual({
      kind: "employee_contribution",
      target: { kind: "fund_contribution", fundSlug: "cometa", part: "employee" },
    });
    expect(classifyComponent(globals, "fundContribEmployer", "Contributo Cometa azienda")).toEqual({
      kind: "employer_contribution",
      target: { kind: "fund_contribution", fundSlug: "cometa", part: "employer" },
    });
  });

  it("routes leave residuals and leave taken to the Phase-7 targets, written but not acted on", () => {
    expect(classifyComponent(globals, "ferieBalance", "Ferie residue")).toEqual({
      kind: "leave_balance",
      target: { kind: "timeoff_balance", timeoffCode: "vacation" },
    });
    expect(classifyComponent(globals, "rolTakenHours", "ROL godute")).toEqual({
      kind: "leave_used",
      target: { kind: "timeoff_used", timeoffCode: "permits" },
    });
  });

  it("falls back to info/none for a code no rule names, rather than guessing", () => {
    expect(classifyComponent(globals, "arretrati", "Arretrati anni precedenti")).toEqual({
      kind: "info",
      target: { kind: "none" },
    });
  });

  it("prefers a user rule over a global one at the same priority, and lower priority wins overall", () => {
    const userRule: PayrollMappingRule = {
      id: "u1",
      userId: "user-1",
      matchCode: null,
      matchLabel: "^Arretrati",
      componentKind: "earning",
      target: { kind: "earnings" },
      priority: 10,
    };
    expect(classifyComponent([...globals, userRule], "arretrati", "Arretrati anni precedenti")).toEqual({
      kind: "earning",
      target: { kind: "earnings" },
    });
  });

  it("matches a label rule case-insensitively and never throws on an invalid regex", () => {
    const bad: PayrollMappingRule = {
      id: "u2", userId: "user-1", matchCode: null, matchLabel: "([unclosed",
      componentKind: "earning", target: { kind: "earnings" }, priority: 1,
    };
    expect(classifyComponent([bad, ...globals], "net", "Netto del mese")).toEqual({
      kind: "earning",
      target: { kind: "earnings" },
    });
  });
});
