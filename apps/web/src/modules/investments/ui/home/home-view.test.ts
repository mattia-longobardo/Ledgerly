import { PALETTE } from "@ledgerly/design-tokens";
import { describe, expect, it } from "vitest";
import { chartLayers, chipKpis, type HomeContext } from "./home-view";

type Home = HomeContext["home"];

const series = (accountId: string, bars: (string | null)[]) => ({
  accountId,
  bars,
  values: bars,
  returns: bars.map(() => null),
});

/** Invented ids and names: a service with its colour, one with the palette's, and two funds. */
const home = {
  services: [
    { accountId: "s1", name: "Service A", color: "#123456", colorIndex: 0 },
    { accountId: "s2", name: "Service B", color: null, colorIndex: 1 },
  ],
  groups: [
    { id: "stocks_crypto", kpis: { gain: "1.00" }, rows: [{ accountId: "s1", name: "Service A" }] },
    {
      id: "pension_funds",
      kpis: { gain: "2.00" },
      rows: [
        { accountId: "f1", name: "Fund A" },
        { accountId: "f2", name: "Fund B" },
      ],
    },
  ],
  total: { gain: "3.00" },
  chart: {
    services: [series("s1", ["1.00", "0.00"]), series("s2", [null, "2.00"])],
    funds: [
      { ...series("f2", [null, "5.00"]), fundId: "x" },
      { ...series("f1", ["3.00", null]), fundId: "y" },
    ],
  },
} as unknown as Home;

describe("chartLayers", () => {
  it("draws the services, then the funds in the list's order, a fund in the palette's colour after them", () => {
    const layers = chartLayers(home);
    expect(layers.map((layer) => [layer.key, layer.label, layer.color])).toEqual([
      ["s1", "Service A", "#123456"],
      ["s2", "Service B", PALETTE[1]],
      ["f1", "Fund A", PALETTE[2 % PALETTE.length]],
      ["f2", "Fund B", PALETTE[3 % PALETTE.length]],
    ]);
    // A month with no reading stays null: never a zero.
    expect(layers[2]!.series.bars).toEqual(["3.00", null]);
  });

  it("draws only what the server drew for the chip: no fund without `funds`, no service without its series", () => {
    const servicesOnly = { ...home, chart: { ...home.chart, funds: undefined } } as Home;
    expect(chartLayers(servicesOnly).map((layer) => layer.key)).toEqual(["s1", "s2"]);
    const fundsOnly = { ...home, chart: { ...home.chart, services: [] } } as Home;
    expect(chartLayers(fundsOnly).map((layer) => layer.key)).toEqual(["f1", "f2"]);
  });
});

describe("chipKpis", () => {
  it("gives the total for «All», the group's KPIs for a group, null for a group with no row", () => {
    expect(chipKpis(home, "all")?.gain).toBe("3.00");
    expect(chipKpis(home, "pension_funds")?.gain).toBe("2.00");
    expect(chipKpis({ ...home, groups: [] } as Home, "stocks_crypto")).toBeNull();
  });
});
