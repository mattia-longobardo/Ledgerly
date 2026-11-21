// R3 parity of the period in the address: what the client screens of Funds ask `/api/v1` for
// (`parseSectionQuery` of packages/ui) is the period the server pages measured (`sectionPeriod` of the
// domain), for every preset, a step back, the days of the picker and an unreadable address.
import { describe, expect, it } from "vitest";
import { sectionPeriod } from "@ledgerly/domain/investments";
import { parseSectionQuery } from "@ledgerly/ui/period";

const TODAY = "2026-11-21";

/** The period the domain measured, as the query of the API names it. */
function domainApi(raw: Record<string, string>) {
  const { period } = sectionPeriod(raw, TODAY);
  if (period.kind === "all") return { period: "all" };
  if (period.kind === "year") return { period: String(period.year) };
  return { period: "custom", from: period.from, to: period.to };
}

const ADDRESSES: Record<string, string>[] = [
  {},
  { preset: "all" },
  { preset: "ytd", off: "1" },
  { preset: "ytd", off: "3" },
  { preset: "thisMonth" },
  { preset: "lastMonth", off: "2" },
  { preset: "last3Months" },
  { from: "2025-03-01", to: "2025-06-30" },
  { from: "2025-01-01", to: "2025-12-31" },
  { from: "2026-01-01", to: "2026-11-21" },
  { from: "2027-01-01", to: "2027-02-01" },
  { from: "2025-06-30", to: "2025-03-01" },
  { preset: "nonsense", off: "x" },
];

describe("the period of Funds in the address", () => {
  it.each(ADDRESSES)("asks the API for what the server page measured: %o", (raw) => {
    const asked = parseSectionQuery(raw, TODAY);
    const measured = domainApi(raw);
    // The API caps a custom period at today, as the page did: the address may say a later end.
    if (measured.period === "custom" && "to" in asked.api) {
      expect({ ...asked.api, to: asked.api.to < TODAY ? asked.api.to : TODAY }).toEqual(measured);
    } else {
      expect(asked.api).toEqual(measured);
    }
    const { stepperParams, params, preset, offset } = sectionPeriod(raw, TODAY);
    expect({
      stepperParams: asked.stepperParams,
      params: asked.params,
      preset: asked.preset,
      offset: asked.offset,
    }).toEqual({
      stepperParams,
      params,
      preset,
      offset,
    });
  });
});
