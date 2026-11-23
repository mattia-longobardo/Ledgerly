import { describe, expect, it } from "vitest";
import { lookupIsin, searchText, SourceError } from "./service/sources";

// Public example ISIN (ISO 6166), no person's data.
const ISIN = "US0378331005";

/** A fake of the two registers: an answer by host, and the requests made. */
function registers(answers: { openfigi?: unknown; firds?: unknown; status?: number }) {
  const asked: string[] = [];
  const fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = new URL(String(input));
    asked.push(`${init?.method ?? "GET"} ${url.host}${url.pathname}`);
    const body = url.host === "api.openfigi.com" ? answers.openfigi : answers.firds;
    return new Response(JSON.stringify(body ?? {}), { status: answers.status ?? 200 });
  }) as typeof globalThis.fetch;
  return { fetch, asked };
}

const FIRDS = {
  response: {
    docs: [{ gnr_full_name: "Example Inc", gnr_cfi_code: "ESVUFR", gnr_notional_curr_code: "USD" }],
  },
};

describe("an ISIN at the registers", () => {
  it("gives its name, class and currency from FIRDS, and one market per MIC from OpenFIGI", async () => {
    const { fetch, asked } = registers({
      firds: FIRDS,
      openfigi: [
        {
          data: [
            { ticker: "EXA", exchCode: "UW", shareClassFIGI: "BBG000000001", securityType: "Common Stock" },
            { ticker: "EXA", exchCode: "UN", shareClassFIGI: "BBG000000001" },
            { ticker: "EXA", exchCode: "GR", shareClassFIGI: "BBG000000001" },
            { ticker: "EXAX", exchCode: "GY", shareClassFIGI: "BBG000000001" },
            { ticker: "EXA", exchCode: "IM", shareClassFIGI: "BBG000000001" },
            { ticker: "EXA", exchCode: "ZZ", shareClassFIGI: "BBG000000001" },
          ],
        },
      ],
    });
    expect(await lookupIsin(ISIN, { fetch })).toEqual({
      isin: ISIN,
      figi: "BBG000000001",
      name: "Example Inc",
      class: "stock",
      cfi: "ESVUFR",
      currency: "USD",
      listings: [
        { mic: "XMIL", ticker: "EXA", currency: "EUR" },
        { mic: "XETR", ticker: "EXAX", currency: "EUR" },
        { mic: "XNYS", ticker: "EXA", currency: "USD" },
      ],
    });
    expect(asked.sort()).toEqual([
      "GET registers.esma.europa.eu/solr/esma_registers_firds/select",
      "POST api.openfigi.com/v3/mapping",
    ]);
  });

  it("is null when neither register knows it, and never asked when it is no ISIN", async () => {
    const { fetch, asked } = registers({
      firds: { response: { docs: [] } },
      openfigi: [{ warning: "No identifier found." }],
    });
    expect(await lookupIsin(ISIN, { fetch })).toBeNull();
    expect(await lookupIsin("US0378331006", { fetch })).toBeNull();
    expect(asked).toHaveLength(2);
  });

  it("is an error when a register is down or answers something else", async () => {
    await expect(lookupIsin(ISIN, registers({ status: 503 }))).rejects.toBeInstanceOf(SourceError);
    await expect(
      lookupIsin(ISIN, registers({ firds: FIRDS, openfigi: { odd: true } })),
    ).rejects.toBeInstanceOf(SourceError);
  });
});

describe("a text at OpenFIGI's search", () => {
  it("gives one instrument per share class, with a market the plugin reads", async () => {
    const { fetch } = registers({
      openfigi: {
        data: [
          {
            name: "EXAMPLE ETF",
            ticker: "EXE",
            exchCode: "IM",
            shareClassFIGI: "BBG000000002",
            securityType: "ETP",
          },
          {
            name: "EXAMPLE ETF",
            ticker: "EXE",
            exchCode: "FP",
            shareClassFIGI: "BBG000000002",
            securityType: "ETP",
          },
          { name: "ELSEWHERE", ticker: "ELS", exchCode: "ZZ", shareClassFIGI: "BBG000000003" },
          { name: "NO CLASS", ticker: "NOC", exchCode: "IM" },
        ],
      },
    });
    expect(await searchText("example", { fetch })).toEqual([
      {
        isin: null,
        figi: "BBG000000002",
        name: "EXAMPLE ETF",
        class: "etf",
        cfi: null,
        currency: "EUR",
        listings: [
          { mic: "XMIL", ticker: "EXE", currency: "EUR" },
          { mic: "XPAR", ticker: "EXE", currency: "EUR" },
        ],
      },
    ]);
  });
});
