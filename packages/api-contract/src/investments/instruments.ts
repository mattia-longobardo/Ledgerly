// The registry of instruments (rewrite plan R5d): the search «Record operation» starts from. The
// registry is the instance's, from OpenFIGI and ESMA FIRDS; a person reads only what they search for,
// and nothing of what other people hold.
import { z } from "zod";
import { id } from "../primitives";
import { defineRoute } from "../route";
import { ASSET_CLASSES, INSTRUMENT_ID } from "./shared";

/** A market an instrument is listed on: `priced` when the daily job has a source for it. */
const listing = z.object({
  mic: z.string(),
  ticker: z.string().nullable(),
  currency: z.string(),
  priced: z.boolean(),
});

export const instrumentHit = z.object({
  instrumentId: id(),
  isin: z.string().nullable(),
  name: z.string(),
  class: z.enum(ASSET_CLASSES),
  currency: z.string(),
  /** In the order the form proposes the market: Borsa Italiana, Xetra, Euronext, then the others. */
  listings: z.array(listing),
});

export const searchInstruments = defineRoute({
  id: "search_instruments",
  method: "GET",
  path: "/instruments/search",
  scope: "investments:read",
  capability: "investments",
  summary:
    "Instruments by ISIN, name or ticker, with the markets they are listed on, at most 20. What the " +
    "registry does not know yet is looked up at OpenFIGI and ESMA FIRDS and kept; when they do not " +
    "answer, `complete` is false and only the known instruments are listed.",
  actions: [],
  query: z.object({ q: z.string().trim().min(2).max(60) }),
  response: z.object({ items: z.array(instrumentHit).max(20), complete: z.boolean() }),
  errors: ["invalid"],
  example: {
    query: { q: "IE00BK5BQT80" },
    response: {
      items: [
        {
          instrumentId: INSTRUMENT_ID,
          isin: "IE00BK5BQT80",
          name: "Vanguard FTSE All-World UCITS ETF USD Acc",
          class: "etf",
          currency: "USD",
          listings: [
            { mic: "XMIL", ticker: "VWCE", currency: "EUR", priced: true },
            { mic: "XETR", ticker: "VWCE", currency: "EUR", priced: true },
          ],
        },
      ],
      complete: true,
    },
  },
});
