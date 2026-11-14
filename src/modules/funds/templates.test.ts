import { describe, expect, it } from "vitest";
import { applyTemplate, FUND_TEMPLATES, type FundTemplate } from "./templates";

const TEMPLATE: FundTemplate = {
  id: "esempio",
  name: "Esempio Previdenza",
  sources: [
    { kind: "manual" },
    { kind: "payroll", accrualPeriod: "quarter", hasDue: true, dueDay: "20" },
    { kind: "bank_debit", amount: "100", debitDay: "5" },
  ],
  fees: [
    { label: "Quota associativa", basis: "periodic", value: "12", period: "year", scope: "#1" },
    { label: "Sul TFR", basis: "per_contribution", value: "1,50", scope: "#1:tfr" },
    { label: "Gestione", basis: "on_assets", mode: "rate", value: "0,45" },
    { label: "Senza sorgente", basis: "one_off", value: "10", scope: "#7" },
  ],
};

describe("fund templates", () => {
  it("ships with no template: the form shows no template field", () => {
    expect(FUND_TEMPLATES).toEqual([]);
  });

  it("gives the sources in the order of the form, each a whole source form", () => {
    const { sources } = applyTemplate(TEMPLATE);
    expect(sources.map((source) => source.kind)).toEqual(["payroll", "bank_debit", "manual"]);
    expect(sources[0]).toMatchObject({
      id: null,
      state: "active",
      accrualPeriod: "quarter",
      hasDue: true,
      dueDay: "20",
      dueOffsetMonths: "1",
      toleranceDays: "15",
      components: ["worker", "employer", "tfr"],
    });
    expect(sources[1]).toMatchObject({
      amount: "100",
      debitDay: "5",
      frequencyCount: "1",
      frequencyUnit: "month",
    });
  });

  it("gives the fees, their scope moved with the source", () => {
    const { fees } = applyTemplate(TEMPLATE);
    expect(fees.map((fee) => [fee.label, fee.scope])).toEqual([
      ["Quota associativa", "#0"],
      ["Sul TFR", "#0:tfr"],
      ["Gestione", ""],
      ["Senza sorgente", ""],
    ]);
    expect(fees[2]).toMatchObject({
      id: null,
      basis: "on_assets",
      mode: "rate",
      value: "0,45",
      period: "year",
    });
  });

  it("keeps one source per kind and gives nothing for an empty template", () => {
    expect(
      applyTemplate({ id: "x", name: "X", sources: [{ kind: "bank_debit" }, { kind: "bank_debit" }] })
        .sources,
    ).toHaveLength(1);
    expect(applyTemplate({ id: "x", name: "X" })).toEqual({ sources: [], fees: [] });
  });
});
