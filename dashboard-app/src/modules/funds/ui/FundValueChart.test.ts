import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { FundValueChart } from "./FundValueChart";

describe("exact Funds chart text", () => {
  it("retains exact decimal strings in the accessible data table", () => {
    const html = renderToStaticMarkup(createElement(FundValueChart, {
      label: "Fund history", currency: "EUR",
      series: [{ key: "value", label: "Value", points: [
        { month: "2026-08-01", value: "90000000000000.01" },
        { month: "2026-09-01", value: "-120000000000000.01" },
      ] }],
    }));
    expect(html).toContain("90.000.000.000.000,01\u00a0€");
    expect(html).toContain("-120.000.000.000.000,01\u00a0€");
  });

  it("preserves exact cents in the single-point chart fallback", () => {
    const html = renderToStaticMarkup(createElement(FundValueChart, {
      label: "Fund history", currency: "EUR",
      series: [{ key: "value", label: "Value", points: [{ month: "2026-09-01", value: "99999999999999.99" }] }],
    }));
    expect(html).toContain("99.999.999.999.999,99\u00a0€");
  });
});
