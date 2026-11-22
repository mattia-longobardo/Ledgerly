/**
 * The sources of the registry (decision B4): OpenFIGI for the markets and tickers of a security,
 * ESMA FIRDS for its name, CFI code and currency. Both are public registers with no key; the core
 * calls them itself, prices come from a plugin.
 *
 * Every answer is parsed before it is believed, a source that is down is an error (never an empty
 * list), and nothing here touches the database. `fetch` is injected so the tests never leave the
 * process.
 */
import { z } from "zod";
import { classOf, type InstrumentClass, isIsin, orderListings } from "./rules";

export const OPENFIGI_HOST = "api.openfigi.com";
export const FIRDS_HOST = "registers.esma.europa.eu";
const TIMEOUT_MS = 15_000;

export class SourceError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SourceError";
  }
}

export interface SourceOptions {
  fetch?: typeof globalThis.fetch;
}

export interface FoundListing {
  mic: string;
  ticker: string;
  currency: string;
}

export interface FoundInstrument {
  isin: string | null;
  /** The share class FIGI: the key of an instrument found by name, with no ISIN. */
  figi: string | null;
  name: string;
  class: InstrumentClass;
  cfi: string | null;
  currency: string;
  listings: FoundListing[];
}

/**
 * OpenFIGI's exchange codes → the market's MIC and its usual currency. Only the markets the
 * prices plugin can read; a code that is not here gives no listing. `GR`, Germany's composite, is
 * read on Xetra, as Yahoo does.
 *
 * shortcut: a market's currency is its usual one (an ETF can trade in USD on Xetra); the close the
 * source returns carries its own currency. Read the currency per listing if a source gives it.
 */
const MARKETS: Record<string, { mic: string; currency: string }> = {
  IM: { mic: "XMIL", currency: "EUR" },
  GY: { mic: "XETR", currency: "EUR" },
  GR: { mic: "XETR", currency: "EUR" },
  GF: { mic: "XFRA", currency: "EUR" },
  FP: { mic: "XPAR", currency: "EUR" },
  NA: { mic: "XAMS", currency: "EUR" },
  BB: { mic: "XBRU", currency: "EUR" },
  PL: { mic: "XLIS", currency: "EUR" },
  SM: { mic: "XMAD", currency: "EUR" },
  SW: { mic: "XSWX", currency: "CHF" },
  SE: { mic: "XSWX", currency: "CHF" },
  LN: { mic: "XLON", currency: "GBP" },
  UN: { mic: "XNYS", currency: "USD" },
  UW: { mic: "XNAS", currency: "USD" },
  UQ: { mic: "XNAS", currency: "USD" },
  UR: { mic: "XNAS", currency: "USD" },
  UP: { mic: "ARCX", currency: "USD" },
};

const figiRecord = z.object({
  name: z.string().nullable().optional(),
  ticker: z.string().nullable().optional(),
  exchCode: z.string().nullable().optional(),
  shareClassFIGI: z.string().nullable().optional(),
  securityType: z.string().nullable().optional(),
});
type FigiRecord = z.infer<typeof figiRecord>;

const mappingSchema = z.array(z.object({ data: z.array(figiRecord).optional() }).loose());
const searchSchema = z.object({ data: z.array(figiRecord) });
const firdsSchema = z.object({
  response: z.object({
    docs: z.array(
      z
        .object({
          gnr_full_name: z.string().optional(),
          gnr_cfi_code: z.string().optional(),
          gnr_notional_curr_code: z.string().optional(),
        })
        .loose(),
    ),
  }),
});

/**
 * The markets of the records, one per MIC, in the order the form proposes them. Yahoo's symbol is
 * the same on every US market, so the US keeps one listing.
 */
function listingsOf(records: readonly FigiRecord[]): FoundListing[] {
  const byMic = new Map<string, FoundListing>();
  for (const record of records) {
    const market = MARKETS[record.exchCode ?? ""];
    const ticker = record.ticker?.trim();
    if (!market || !ticker || ticker.length > 20 || byMic.has(market.mic)) continue;
    // Xetra's own code wins over Germany's composite, whatever the order of the records.
    if (record.exchCode === "GR" && records.some((other) => other.exchCode === "GY")) continue;
    byMic.set(market.mic, { mic: market.mic, ticker, currency: market.currency });
  }
  const ordered = orderListings([...byMic.values()]);
  const firstUs = ordered.find((one) => one.currency === "USD" && ["XNYS", "XNAS", "ARCX"].includes(one.mic));
  return ordered.filter((one) => !["XNYS", "XNAS", "ARCX"].includes(one.mic) || one === firstUs);
}

async function call(url: string, init: RequestInit, options: SourceOptions, who: string): Promise<unknown> {
  const doFetch = options.fetch ?? globalThis.fetch;
  let response: Response;
  try {
    response = await doFetch(url, {
      ...init,
      headers: { accept: "application/json", ...init.headers },
      redirect: "error",
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch {
    throw new SourceError(`${who} could not be reached`);
  }
  if (!response.ok) throw new SourceError(`${who} answered HTTP ${response.status}`);
  try {
    const value: unknown = JSON.parse(await response.text());
    return value;
  } catch {
    throw new SourceError(`${who} did not answer with JSON`);
  }
}

const postJson = (body: unknown): RequestInit => ({
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify(body),
});

/** The name, CFI and currency FIRDS gives an ISIN, or null when FIRDS does not know it. */
async function firds(isin: string, options: SourceOptions) {
  const query = new URLSearchParams({ q: `isin:${isin}`, wt: "json", rows: "1" });
  const url = `https://${FIRDS_HOST}/solr/esma_registers_firds/select?${query}`;
  const parsed = firdsSchema.safeParse(await call(url, {}, options, "FIRDS"));
  if (!parsed.success) throw new SourceError("FIRDS answered an unexpected shape");
  const doc = parsed.data.response.docs[0];
  if (!doc) return null;
  const cfi = doc.gnr_cfi_code && /^[A-Z]{6}$/.test(doc.gnr_cfi_code) ? doc.gnr_cfi_code : null;
  const currency =
    doc.gnr_notional_curr_code && /^[A-Z]{3}$/.test(doc.gnr_notional_curr_code)
      ? doc.gnr_notional_curr_code
      : null;
  return { name: doc.gnr_full_name?.trim() || null, cfi, currency };
}

/** The records OpenFIGI maps an ISIN to: none when it does not know it. */
async function figiRecords(isin: string, options: SourceOptions): Promise<FigiRecord[]> {
  const body = postJson([{ idType: "ID_ISIN", idValue: isin }]);
  const parsed = mappingSchema.safeParse(
    await call(`https://${OPENFIGI_HOST}/v3/mapping`, body, options, "OpenFIGI"),
  );
  if (!parsed.success || parsed.data.length !== 1)
    throw new SourceError("OpenFIGI answered an unexpected shape");
  return parsed.data[0].data ?? [];
}

/** What FIRDS says of an ISIN; all null when it does not know it. */
interface Registered {
  name: string | null;
  cfi: string | null;
  currency: string | null;
}

function instrumentOf(isin: string, records: readonly FigiRecord[], registered: Registered): FoundInstrument {
  const listings = listingsOf(records);
  const named = records.find((one) => one.name)?.name?.trim();
  return {
    isin,
    figi: records.find((one) => one.shareClassFIGI)?.shareClassFIGI ?? null,
    name: (registered.name ?? named ?? isin).slice(0, 200),
    class: classOf(registered.cfi, records[0]?.securityType ?? null),
    cfi: registered.cfi,
    currency: registered.currency ?? listings[0]?.currency ?? "EUR",
    listings,
  };
}

/** An ISIN at OpenFIGI and FIRDS: its markets, name, class and currency; null when neither knows it. */
export async function lookupIsin(isin: string, options: SourceOptions = {}): Promise<FoundInstrument | null> {
  if (!isIsin(isin)) return null;
  const [records, registered] = await Promise.all([figiRecords(isin, options), firds(isin, options)]);
  if (records.length === 0 && registered === null) return null;
  return instrumentOf(isin, records, registered ?? { name: null, cfi: null, currency: null });
}

/**
 * A name or a ticker at OpenFIGI's search: one instrument per share class FIGI, with no ISIN
 * (OpenFIGI does not give it). Only the classes the registry keeps, with a market the plugin reads.
 */
export async function searchText(text: string, options: SourceOptions = {}): Promise<FoundInstrument[]> {
  const answer = await call(
    `https://${OPENFIGI_HOST}/v3/search`,
    postJson({ query: text }),
    options,
    "OpenFIGI",
  );
  const parsed = searchSchema.safeParse(answer);
  if (!parsed.success) throw new SourceError("OpenFIGI answered an unexpected shape");
  const byClass = new Map<string, FigiRecord[]>();
  for (const record of parsed.data.data) {
    if (!record.shareClassFIGI) continue;
    byClass.set(record.shareClassFIGI, [...(byClass.get(record.shareClassFIGI) ?? []), record]);
  }
  return [...byClass.entries()].flatMap(([figi, records]) => {
    const listings = listingsOf(records);
    if (listings.length === 0) return [];
    return [
      {
        isin: null,
        figi,
        name: (records.find((one) => one.name)?.name?.trim() ?? figi).slice(0, 200),
        class: classOf(null, records[0].securityType ?? null),
        cfi: null,
        currency: listings[0].currency,
        listings,
      },
    ];
  });
}
