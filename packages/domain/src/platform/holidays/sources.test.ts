/**
 * The two holiday services (M3), against a fake `fetch`: nothing here leaves the process.
 *
 * What these defend is mostly the seams between two APIs that do not agree on anything — the shape
 * of a name, the word for "national", whether a holiday is a day or a span — and the rule that a
 * service being down must never look like a year with no holidays in it.
 */
import { describe, expect, it, vi } from "vitest";
import { HolidayError, fetchHolidays, listCountries, listSubdivisions } from "./sources";

const BASES = { openHolidaysBase: "https://open.test", nagerBase: "https://nager.test" };

/** Answers per URL fragment; anything unmatched is a 404. */
function fakeFetch(routes: Record<string, unknown | (() => Response)>) {
  const seen: string[] = [];
  const impl = vi.fn(async (url: string | URL | Request) => {
    const href = String(url);
    seen.push(href);
    for (const [fragment, answer] of Object.entries(routes)) {
      if (!href.includes(fragment)) continue;
      if (typeof answer === "function") return (answer as () => Response)();
      return new Response(JSON.stringify(answer), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }
    return new Response("not found", { status: 404 });
  });
  return { fetch: impl as unknown as typeof globalThis.fetch, seen };
}

const OPEN_COUNTRIES = [
  {
    isoCode: "IT",
    name: [
      { language: "IT", text: "Italia" },
      { language: "EN", text: "Italy" },
    ],
  },
  { isoCode: "DE", name: [{ language: "EN", text: "Germany" }] },
];

const NAGER_COUNTRIES = [
  { countryCode: "IT", name: "Italy" },
  { countryCode: "JP", name: "Japan" },
  { countryCode: "AR", name: "Argentina" },
];

describe("listCountries", () => {
  it("merges both services and lets the finer one win", async () => {
    const fake = fakeFetch({ "/Countries": OPEN_COUNTRIES, "/AvailableCountries": NAGER_COUNTRIES });
    const countries = await listCountries("EN", { ...BASES, fetch: fake.fetch });

    const byCode = Object.fromEntries(countries.map((one) => [one.code, one]));
    // Italy is in both: OpenHolidays wins, because it can name a province.
    expect(byCode.IT).toEqual({
      source: "openholidays",
      code: "IT",
      name: "Italy",
      hasSubdivisions: true,
    });
    // Japan is only in Nager, and comes back as a country with no places inside it.
    expect(byCode.JP).toEqual({ source: "nager", code: "JP", name: "Japan", hasSubdivisions: false });
    expect(countries.map((one) => one.name)).toEqual(["Argentina", "Germany", "Italy", "Japan"]);
  });

  it("names a country in the language asked for", async () => {
    const fake = fakeFetch({ "/Countries": OPEN_COUNTRIES, "/AvailableCountries": [] });
    const countries = await listCountries("IT", { ...BASES, fetch: fake.fetch });
    expect(countries.find((one) => one.code === "IT")?.name).toBe("Italia");
    // No Italian translation for Germany: English rather than nothing.
    expect(countries.find((one) => one.code === "DE")?.name).toBe("Germany");
  });

  it("still answers when one service is down", async () => {
    const fake = fakeFetch({
      "/Countries": () => new Response("boom", { status: 500 }),
      "/AvailableCountries": NAGER_COUNTRIES,
    });
    const countries = await listCountries("EN", { ...BASES, fetch: fake.fetch });
    // Italy falls back to Nager rather than disappearing from the list.
    expect(countries.find((one) => one.code === "IT")?.source).toBe("nager");
    expect(countries).toHaveLength(3);
  });

  it("says so when neither can be reached, instead of answering an empty world", async () => {
    const fake = fakeFetch({
      "/Countries": () => new Response("boom", { status: 500 }),
      "/AvailableCountries": () => new Response("boom", { status: 502 }),
    });
    await expect(listCountries("EN", { ...BASES, fetch: fake.fetch })).rejects.toBeInstanceOf(HolidayError);
  });
});

describe("listSubdivisions", () => {
  const TREE = [
    {
      code: "IT-LO",
      name: [{ language: "IT", text: "Lombardia" }],
      children: [
        { code: "IT-LO-MI", name: [{ language: "IT", text: "Milano" }] },
        { code: "IT-LO-BG", name: [{ language: "IT", text: "Bergamo" }] },
      ],
    },
  ];

  it("flattens the tree so a region is followed by its provinces", async () => {
    const fake = fakeFetch({ "/Subdivisions": TREE });
    expect(await listSubdivisions("openholidays", "IT", "IT", { ...BASES, fetch: fake.fetch })).toEqual([
      { code: "IT-LO", name: "Lombardia", path: "Lombardia" },
      { code: "IT-LO-MI", name: "Milano", path: "Lombardia · Milano" },
      { code: "IT-LO-BG", name: "Bergamo", path: "Lombardia · Bergamo" },
    ]);
  });

  it("offers none for a source that cannot name them, rather than a broken list", async () => {
    const fake = fakeFetch({});
    expect(await listSubdivisions("nager", "JP", "EN", { ...BASES, fetch: fake.fetch })).toEqual([]);
    expect(fake.seen).toHaveLength(0);
  });
});

describe("fetchHolidays", () => {
  it("asks OpenHolidays for one year of one province, and marks the local feast", async () => {
    const fake = fakeFetch({
      "/PublicHolidays": [
        { startDate: "2026-01-01", name: [{ language: "IT", text: "Capodanno" }], nationwide: true },
        {
          startDate: "2026-12-07",
          name: [{ language: "IT", text: "Sant'Ambrogio" }],
          nationwide: false,
        },
      ],
    });
    const holidays = await fetchHolidays("openholidays", "IT", "IT-LO-MI", 2026, "IT", {
      ...BASES,
      fetch: fake.fetch,
    });
    expect(holidays).toEqual([
      { on: "2026-01-01", name: "Capodanno", nationwide: true },
      { on: "2026-12-07", name: "Sant'Ambrogio", nationwide: false },
    ]);
    // The province and the year both reach the query, or the answer would be the whole country.
    expect(fake.seen[0]).toContain("subdivisionCode=IT-LO-MI");
    expect(fake.seen[0]).toContain("validFrom=2026-01-01");
  });

  it("leaves the subdivision out when the whole country was subscribed to", async () => {
    const fake = fakeFetch({ "/PublicHolidays": [] });
    await fetchHolidays("openholidays", "IT", null, 2026, "IT", { ...BASES, fetch: fake.fetch });
    expect(fake.seen[0]).not.toContain("subdivisionCode");
  });

  it("spreads a holiday that spans days over each of them", async () => {
    const fake = fakeFetch({
      "/PublicHolidays": [
        {
          startDate: "2026-04-03",
          endDate: "2026-04-06",
          name: [{ language: "EN", text: "Easter break" }],
          nationwide: true,
        },
      ],
    });
    const holidays = await fetchHolidays("openholidays", "DE", null, 2026, "EN", {
      ...BASES,
      fetch: fake.fetch,
    });
    expect(holidays.map((one) => one.on)).toEqual(["2026-04-03", "2026-04-04", "2026-04-05", "2026-04-06"]);
  });

  it("reads Nager's own words: localName, and `global` for nationwide", async () => {
    const fake = fakeFetch({
      "/PublicHolidays/2026/JP": [
        { date: "2026-05-03", localName: "憲法記念日", name: "Constitution Day", global: true },
        { date: "2026-07-20", localName: "", name: "Marine Day", global: false },
      ],
    });
    expect(await fetchHolidays("nager", "JP", null, 2026, "EN", { ...BASES, fetch: fake.fetch })).toEqual([
      { on: "2026-05-03", name: "憲法記念日", nationwide: true },
      // An empty local name falls back to the English one rather than to nothing.
      { on: "2026-07-20", name: "Marine Day", nationwide: false },
    ]);
  });

  it("drops a date that is not in the year asked for", async () => {
    const fake = fakeFetch({
      "/PublicHolidays/2026/IT": [
        { date: "2025-12-31", name: "New Year's Eve", global: true },
        { date: "2026-01-01", name: "New Year", global: true },
      ],
    });
    const holidays = await fetchHolidays("nager", "IT", null, 2026, "EN", {
      ...BASES,
      fetch: fake.fetch,
    });
    expect(holidays.map((one) => one.on)).toEqual(["2026-01-01"]);
  });

  it("throws rather than answering an empty year when the service fails", async () => {
    const fake = fakeFetch({ "/PublicHolidays": () => new Response("down", { status: 503 }) });
    const error = await fetchHolidays("nager", "IT", null, 2026, "EN", {
      ...BASES,
      fetch: fake.fetch,
    }).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(HolidayError);
    expect((error as HolidayError).kind).toBe("http");
    expect((error as HolidayError).status).toBe(503);
  });

  it("throws on an answer it cannot read, rather than believing half of it", async () => {
    const fake = fakeFetch({ "/PublicHolidays": [{ date: "not a date", name: "?" }] });
    const error = await fetchHolidays("nager", "IT", null, 2026, "EN", {
      ...BASES,
      fetch: fake.fetch,
    }).catch((e: unknown) => e);
    expect((error as HolidayError).kind).toBe("payload");
  });

  it("gives up on a service that never answers", async () => {
    const never = vi.fn(
      async (_url: string | URL | Request, init?: RequestInit) =>
        new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener("abort", () =>
            reject(Object.assign(new Error("aborted"), { name: "AbortError" })),
          );
        }),
    );
    const error = await fetchHolidays("nager", "IT", null, 2026, "EN", {
      ...BASES,
      fetch: never as unknown as typeof globalThis.fetch,
      timeoutMs: 10,
    }).catch((e: unknown) => e);
    expect((error as HolidayError).kind).toBe("timeout");
  });
});
