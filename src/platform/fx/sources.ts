/**
 * Frankfurter (api.frankfurter.dev), the ECB reference rates over HTTP (investments.md §1.8).
 *
 * Every answer is parsed before it is believed, a service that is down is an error (never an empty
 * series), and nothing here touches the database. `fetch` is injected so the tests never leave the
 * process.
 */
import { z } from "zod";
import { type CivilDate, isCivilDate } from "../dates";
import { eurPerUnitOf, type FxRange, type FxRate } from "./rules";

const FRANKFURTER_BASE = "https://api.frankfurter.dev";
const DEFAULT_TIMEOUT_MS = 30_000;
const CURRENCY = /^[A-Z]{3}$/;

export interface FxFetchOptions {
  fetch?: typeof globalThis.fetch;
  timeoutMs?: number;
  /** Overridden in tests; the real host is the default. */
  base?: string;
}

export class FxError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "FxError";
  }
}

const seriesSchema = z.object({
  base: z.literal("EUR"),
  rates: z.record(z.string(), z.record(z.string(), z.number())),
});

/**
 * The ECB rates of every currency for each working day in `range`, as `fx_rates` stores them.
 * Frankfurter starts the series at the last fixing on or before `range.from`.
 */
export async function fetchEcbRates(range: FxRange, options: FxFetchOptions = {}): Promise<FxRate[]> {
  const base = options.base ?? FRANKFURTER_BASE;
  const url = `${base}/v1/${range.from}..${range.to}?base=EUR`;
  const parsed = seriesSchema.safeParse(await getJson(url, options));
  if (!parsed.success) throw new FxError("unexpected answer shape from Frankfurter");

  const rates: FxRate[] = [];
  for (const [on, byCurrency] of Object.entries(parsed.data.rates)) {
    if (!isCivilDate(on)) throw new FxError("unexpected date in the Frankfurter answer");
    for (const [currency, rate] of Object.entries(byCurrency)) {
      const eurPerUnit = eurPerUnitOf(rate);
      if (!CURRENCY.test(currency) || currency === "EUR" || eurPerUnit === null) continue;
      rates.push({ on: on as CivilDate, currency, eurPerUnit });
    }
  }
  return rates.sort((a, b) => (a.on === b.on ? a.currency.localeCompare(b.currency) : a.on < b.on ? -1 : 1));
}

async function getJson(url: string, options: FxFetchOptions): Promise<unknown> {
  const doFetch = options.fetch ?? globalThis.fetch;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), options.timeoutMs ?? DEFAULT_TIMEOUT_MS);
  let response: Response;
  try {
    response = await doFetch(url, { headers: { accept: "application/json" }, signal: controller.signal });
  } catch (error) {
    throw new FxError(
      controller.signal.aborted
        ? "Frankfurter did not answer in time"
        : `Frankfurter could not be reached: ${error instanceof Error ? error.message : String(error)}`,
    );
  } finally {
    clearTimeout(timer);
  }
  if (!response.ok) throw new FxError(`Frankfurter answered HTTP ${response.status}`);
  try {
    return JSON.parse(await response.text()) as unknown;
  } catch {
    throw new FxError("Frankfurter did not answer with JSON");
  }
}
