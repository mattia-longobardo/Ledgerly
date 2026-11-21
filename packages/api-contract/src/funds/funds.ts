// Funds (rewrite plan R2, 05-refactor.md §5.5 «funds»; audit FND-1, FND-3, FND-4): the home of a
// period, the four tabs of a fund, and the writes of the fund itself. Every number comes from the one
// engine of the period (`period.ts` + `home.ts`): the pages, `get_funds`, `get_fund` and the export
// read the same measure.
import { z } from "zod";
import { id } from "../primitives";
import { defineRoute } from "../route";
import { feeBody, fundBody, sourceBody, valuationBody } from "./bodies";
import {
  FEE_EXAMPLE,
  FUND_REF_EXAMPLE,
  GAIN_EXAMPLE,
  LINE_EXAMPLE,
  MEASURE_EXAMPLE,
  PERIOD_EXAMPLE,
  SOURCE_EXAMPLE,
  VALUES_EXAMPLE,
} from "./examples";
import {
  byFund,
  FUND_ERRORS,
  FUND_ID,
  FUND_STATES,
  fundContributions,
  fundOverview,
  fundSettings,
  fundsHome,
  fundValuations,
  periodQuery,
} from "./shared";

const FORECAST_EXAMPLE = {
  monthly: "350.00",
  rates: [0.02, 0.04, 0.06],
  rows: [{ years: 1, values: ["16700.00", "16900.00", "17100.00"] }],
};

export const getFunds = defineRoute({
  id: "get_funds",
  method: "GET",
  path: "/funds",
  scope: "read",
  capability: "funds",
  summary:
    "The pension funds in a period: the portfolio's gain, market return, fees, paid-in money by origin and " +
    "return; each fund's own measure; the bars of the gain, the value by day and, for «All», the years.",
  actions: [],
  query: periodQuery,
  response: fundsHome,
  errors: ["invalid"],
  mcp: {
    title: "Funds",
    description:
      "Every pension fund in a period (default: the year running; `period` = all, a year, or custom with " +
      "`from` and `to`): what the portfolio gained net of what went in, the return, the fees, the money " +
      "paid in by origin (you, employer, TFR), and each fund's own figures. Amounts are decimal strings, " +
      "returns are fractions.",
  },
  example: {
    query: { period: "2026" },
    response: {
      period: PERIOD_EXAMPLE,
      valueToday: "12450.00",
      summary: MEASURE_EXAMPLE,
      funds: [{ ...FUND_REF_EXAMPLE, line: LINE_EXAMPLE, valueToday: "12450.00", stale: false }],
      gain: GAIN_EXAMPLE,
      values: VALUES_EXAMPLE,
      years: [],
    },
  },
});

export const getFund = defineRoute({
  id: "get_fund",
  method: "GET",
  path: "/funds/{id}",
  scope: "read",
  capability: "funds",
  summary: "One fund's Overview in a period: its measure, its value today, its charts and its projection.",
  actions: [],
  params: byFund,
  query: periodQuery,
  response: fundOverview,
  errors: ["invalid", "not_found"],
  mcp: {
    title: "Fund",
    description:
      "One pension fund by id (from get_funds) in a period: value, gain, return, fees, money paid in by " +
      "origin, and the projection at the hypothesis rates.",
    arguments: {
      id: z.uuid().describe("The fund's id."),
      period: periodQuery.shape.period,
      from: periodQuery.shape.from,
      to: periodQuery.shape.to,
    },
    pathArguments: { id: "id" },
  },
  example: {
    params: { id: FUND_ID },
    query: { period: "2026" },
    response: {
      fund: FUND_REF_EXAMPLE,
      period: PERIOD_EXAMPLE,
      beforeFirst: false,
      summary: MEASURE_EXAMPLE,
      line: LINE_EXAMPLE,
      valueToday: "12450.00",
      valueOlderThanOperations: false,
      gain: GAIN_EXAMPLE,
      values: VALUES_EXAMPLE,
      forecast: FORECAST_EXAMPLE,
    },
  },
});

export const getFundValuations = defineRoute({
  id: "get_fund_valuations",
  method: "GET",
  path: "/funds/{id}/valuations",
  scope: "read",
  capability: "funds",
  summary:
    "A fund's Valuations tab: each reading of the period against the one before, and the values recorded.",
  actions: [],
  params: byFund,
  query: periodQuery,
  response: fundValuations,
  errors: ["invalid", "not_found"],
  example: {
    params: { id: FUND_ID },
    response: {
      fundId: FUND_ID,
      period: PERIOD_EXAMPLE,
      lines: [],
      best: null,
      worst: null,
      recorded: [],
    },
  },
});

export const getFundContributions = defineRoute({
  id: "get_fund_contributions",
  method: "GET",
  path: "/funds/{id}/contributions",
  scope: "read",
  capability: "funds",
  summary:
    "A fund's Contributions tab: the register of the period, the periods of the payslip source with what " +
    "they accrued and what the fund credited, and the months accrued and not received.",
  actions: [],
  params: byFund,
  query: periodQuery,
  response: fundContributions,
  errors: ["invalid", "not_found"],
  example: {
    params: { id: FUND_ID },
    response: {
      fundId: FUND_ID,
      period: PERIOD_EXAMPLE,
      operations: [],
      payroll: null,
      accrued: [],
      debit: null,
    },
  },
});

export const getFundSettings = defineRoute({
  id: "get_fund_settings",
  method: "GET",
  path: "/funds/{id}/settings",
  scope: "read",
  capability: "funds",
  summary:
    "A fund's Settings tab: the fund, its sources and fees, and the payslip components other funds take.",
  actions: [],
  params: byFund,
  response: fundSettings,
  errors: ["not_found"],
  example: {
    params: { id: FUND_ID },
    response: {
      fund: FUND_REF_EXAMPLE,
      sources: [SOURCE_EXAMPLE],
      fees: [FEE_EXAMPLE],
      codes: { worker: ["Z10"] },
      taken: [],
    },
  },
});

/**
 * «Create fund», the last step of the form: the fund, its account, its sources and its fees in one
 * write, and the competences of the payslips applied before it when a payslip source feeds it.
 */
export const createFund = defineRoute({
  id: "create_fund",
  method: "POST",
  path: "/funds",
  scope: "write",
  capability: "funds",
  summary:
    "Creates a fund with its account, sources and fees; `fees[].source` names a source of the same body by " +
    "its place in `sources`. Answers the id and how many payslip periods it received.",
  actions: ["createFundAction"],
  body: z
    .object({
      fund: fundBody,
      currency: z.string().length(3).nullable().default(null),
      value: valuationBody.omit({ note: true }).nullable().default(null),
      sources: z.array(sourceBody).max(10),
      fees: z
        .array(
          feeBody
            .omit({ sourceId: true })
            .extend({ source: z.number().int().min(0).nullable().default(null) }),
        )
        .max(20),
    })
    .strict(),
  response: z.object({ id: id(), published: z.number().int() }),
  status: 201,
  errors: FUND_ERRORS,
  example: {
    body: {
      fund: { name: "Fondo Alfa", provider: null, compartment: null, startOn: "2024-01-01", code: null },
      currency: null,
      value: null,
      sources: [{ kind: "manual" }],
      fees: [],
    },
    response: { id: FUND_ID, published: 0 },
  },
});

export const updateFund = defineRoute({
  id: "update_fund",
  method: "PATCH",
  path: "/funds/{id}",
  scope: "write",
  capability: "funds",
  summary: "Renames a fund or changes its provider, compartment, start day or code.",
  actions: ["updateFundAction"],
  params: byFund,
  body: fundBody,
  response: null,
  status: 204,
  errors: FUND_ERRORS,
  example: {
    params: { id: FUND_ID },
    body: {
      name: "Fondo Alfa",
      provider: "Example Pension",
      compartment: null,
      startOn: "2024-01-01",
      code: null,
    },
  },
});

export const setFundState = defineRoute({
  id: "set_fund_state",
  method: "PUT",
  path: "/funds/{id}/state",
  scope: "write",
  capability: "funds",
  summary: "Archives a fund or brings it back.",
  actions: ["setFundStateAction"],
  params: byFund,
  body: z.object({ state: z.enum(FUND_STATES) }).strict(),
  response: null,
  status: 204,
  errors: FUND_ERRORS,
  example: { params: { id: FUND_ID }, body: { state: "archived" } },
});
