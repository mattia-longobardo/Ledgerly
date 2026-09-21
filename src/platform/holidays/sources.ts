/**
 * The two places public holidays are fetched from (M3), behind one interface.
 *
 * Neither is ours, both are free and neither needs a key, so the only things this file insists on
 * are the ones that protect the caller: every answer is parsed before it is believed, a source
 * that is down is a source that is down (never an empty year quietly written over a good one), and
 * nothing here touches the database.
 *
 * `fetch` is injected so the tests never leave the process.
 */
import { z } from "zod";
import type { CivilDate } from "../dates";
import type { HolidaySource } from "./rules";

const DEFAULT_TIMEOUT_MS = 15_000;

export interface HolidayCountry {
  source: HolidaySource;
  /** ISO 3166-1 alpha-2. */
  code: string;
  name: string;
  /** Whether this source can name places inside the country. */
  hasSubdivisions: boolean;
}

export interface HolidaySubdivision {
  /** The source's own code, which is what a subscription stores. */
  code: string;
  name: string;
  /** "Lombardia · Milano", so a flat picker still reads as a place. */
  path: string;
}

export interface FetchedHoliday {
  on: CivilDate;
  name: string;
  nationwide: boolean;
}

export type HolidayErrorKind = "network" | "timeout" | "http" | "payload" | "unsupported";

export class HolidayError extends Error {
  constructor(
    readonly kind: HolidayErrorKind,
    message: string,
    readonly status: number | null = null,
  ) {
    super(message);
    this.name = "HolidayError";
  }
}

export interface HolidayFetchOptions {
  fetch?: typeof globalThis.fetch;
  timeoutMs?: number;
  /** Overridden in tests; the real hosts are the defaults. */
  openHolidaysBase?: string;
  nagerBase?: string;
}

async function getJson(url: string, options: HolidayFetchOptions): Promise<unknown> {
  const doFetch = options.fetch ?? globalThis.fetch;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), options.timeoutMs ?? DEFAULT_TIMEOUT_MS);
  let response: Response;
  try {
    response = await doFetch(url, {
      headers: { accept: "application/json" },
      signal: controller.signal,
    });
  } catch (error) {
    const aborted = controller.signal.aborted;
    throw new HolidayError(
      aborted ? "timeout" : "network",
      aborted
        ? `${hostOf(url)} did not answer in time`
        : `${hostOf(url)} could not be reached: ${error instanceof Error ? error.message : String(error)}`,
    );
  } finally {
    clearTimeout(timer);
  }

  if (!response.ok) {
    throw new HolidayError("http", `${hostOf(url)} answered HTTP ${response.status}`, response.status);
  }
  const text = await response.text().catch(() => "");
  try {
    return JSON.parse(text) as unknown;
  } catch {
    throw new HolidayError("payload", `${hostOf(url)} did not answer with JSON`);
  }
}

function hostOf(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    return "the holiday service";
  }
}

function parse<T>(schema: z.ZodType<T>, raw: unknown, what: string): T {
  const parsed = schema.safeParse(raw);
  if (parsed.success) return parsed.data;
  throw new HolidayError("payload", `unexpected ${what} shape from the holiday service`);
}

/* openholidaysapi.org — Europe, down to the province, with the local feasts */

const OPEN_HOLIDAYS_BASE = "https://openholidaysapi.org";

/** Their strings are a list of translations; the wanted language, else English, else the first. */
const localisedSchema = z.array(z.object({ language: z.string(), text: z.string() })).min(1);

function pick(texts: { language: string; text: string }[], language: string): string {
  const wanted = language.toUpperCase();
  return (
    texts.find((one) => one.language.toUpperCase() === wanted)?.text ??
    texts.find((one) => one.language.toUpperCase() === "EN")?.text ??
    texts[0].text
  );
}

const openCountrySchema = z.object({ isoCode: z.string().length(2), name: localisedSchema });

const openSubdivisionSchema: z.ZodType<{
  code: string;
  name: { language: string; text: string }[];
  children?: unknown[];
}> = z.object({
  code: z.string().min(2),
  name: localisedSchema,
  children: z.array(z.lazy(() => openSubdivisionSchema)).optional(),
});

const openHolidaySchema = z.object({
  startDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  endDate: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .optional(),
  name: localisedSchema,
  nationwide: z.boolean().optional(),
});

/* date.nager.at — the rest of the world, country only */

const NAGER_BASE = "https://date.nager.at";

const nagerCountrySchema = z.object({ countryCode: z.string().length(2), name: z.string().min(1) });

const nagerHolidaySchema = z.object({
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  localName: z.string().nullish(),
  name: z.string().min(1),
  global: z.boolean().nullish(),
});

/* What the rest of the app calls */

/**
 * Every country either source can answer for, sorted by name, with the finer source winning where
 * both reach. A source that is down is left out rather than failing the list: somebody adding a
 * Japanese calendar should not be stopped by a European service having a bad afternoon.
 */
export async function listCountries(
  language: string,
  options: HolidayFetchOptions = {},
): Promise<HolidayCountry[]> {
  const openBase = options.openHolidaysBase ?? OPEN_HOLIDAYS_BASE;
  const nagerBase = options.nagerBase ?? NAGER_BASE;

  const [open, nager] = await Promise.all([
    getJson(`${openBase}/Countries?languageIsoCode=${language.toUpperCase()}`, options)
      .then((raw) => parse(z.array(openCountrySchema), raw, "country list"))
      .catch(() => null),
    getJson(`${nagerBase}/api/v3/AvailableCountries`, options)
      .then((raw) => parse(z.array(nagerCountrySchema), raw, "country list"))
      .catch(() => null),
  ]);

  if (open === null && nager === null) {
    throw new HolidayError("network", "neither holiday service could be reached");
  }

  const byCode = new Map<string, HolidayCountry>();
  // Nager first, so OpenHolidays overwrites it wherever it reaches: it is the finer of the two.
  for (const country of nager ?? []) {
    byCode.set(country.countryCode.toUpperCase(), {
      source: "nager",
      code: country.countryCode.toUpperCase(),
      name: country.name,
      hasSubdivisions: false,
    });
  }
  for (const country of open ?? []) {
    byCode.set(country.isoCode.toUpperCase(), {
      source: "openholidays",
      code: country.isoCode.toUpperCase(),
      name: pick(country.name, language),
      hasSubdivisions: true,
    });
  }
  return [...byCode.values()].sort((a, b) => a.name.localeCompare(b.name));
}

/**
 * The places inside a country, flattened depth-first so a region is followed by its provinces and
 * a single `<select>` still reads as a place. Only OpenHolidays names them; Nager has no such
 * endpoint, and saying so is better than offering an empty list.
 */
export async function listSubdivisions(
  source: HolidaySource,
  country: string,
  language: string,
  options: HolidayFetchOptions = {},
): Promise<HolidaySubdivision[]> {
  if (source !== "openholidays") return [];
  const base = options.openHolidaysBase ?? OPEN_HOLIDAYS_BASE;
  const raw = await getJson(
    `${base}/Subdivisions?countryIsoCode=${country.toUpperCase()}&languageIsoCode=${language.toUpperCase()}`,
    options,
  );
  const tree = parse(z.array(openSubdivisionSchema), raw, "subdivision list");

  const flat: HolidaySubdivision[] = [];
  const walk = (nodes: typeof tree, parents: string[]): void => {
    for (const node of nodes) {
      const name = pick(node.name, language);
      const path = [...parents, name];
      flat.push({ code: node.code, name, path: path.join(" · ") });
      walk((node.children ?? []) as typeof tree, path);
    }
  };
  walk(tree, []);
  return flat;
}

/**
 * One calendar's holidays for one year.
 *
 * OpenHolidays can return a holiday that spans days (a bridge, a school break); each day of the
 * span is emitted, because what the caller asks is "is this date a holiday". Nager's `global` flag
 * is its own word for nationwide.
 */
export async function fetchHolidays(
  source: HolidaySource,
  country: string,
  subdivision: string | null,
  year: number,
  language: string,
  options: HolidayFetchOptions = {},
): Promise<FetchedHoliday[]> {
  if (source === "openholidays") {
    const base = options.openHolidaysBase ?? OPEN_HOLIDAYS_BASE;
    const query = new URLSearchParams({
      countryIsoCode: country.toUpperCase(),
      languageIsoCode: language.toUpperCase(),
      validFrom: `${year}-01-01`,
      validTo: `${year}-12-31`,
    });
    if (subdivision !== null) query.set("subdivisionCode", subdivision);
    const raw = await getJson(`${base}/PublicHolidays?${query.toString()}`, options);
    const rows = parse(z.array(openHolidaySchema), raw, "holidays");
    return rows.flatMap((row) =>
      daysOf(row.startDate, row.endDate ?? row.startDate, year).map((on) => ({
        on,
        name: pick(row.name, language),
        nationwide: row.nationwide ?? true,
      })),
    );
  }

  const base = options.nagerBase ?? NAGER_BASE;
  const raw = await getJson(`${base}/api/v3/PublicHolidays/${year}/${country.toUpperCase()}`, options);
  const rows = parse(z.array(nagerHolidaySchema), raw, "holidays");
  return rows
    .filter((row) => row.date.startsWith(String(year)))
    .map((row) => ({
      on: row.date,
      name: row.localName?.trim() || row.name,
      nationwide: row.global ?? true,
    }));
}

/** Every date of a closed span, bounded to the year asked for and to a sane length. */
function daysOf(from: CivilDate, to: CivilDate, year: number): CivilDate[] {
  const dates: CivilDate[] = [];
  const start = new Date(`${from}T00:00:00Z`);
  const end = new Date(`${to}T00:00:00Z`);
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) return dates;
  for (let at = start; at <= end && dates.length < 400; at = new Date(at.getTime() + 86_400_000)) {
    const on = at.toISOString().slice(0, 10);
    if (on.startsWith(String(year))) dates.push(on);
  }
  return dates;
}
