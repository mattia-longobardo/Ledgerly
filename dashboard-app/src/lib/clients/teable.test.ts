import { beforeEach, describe, expect, it, vi } from "vitest";
import { UpstreamError } from "@/lib/contracts";
import {
  clearFieldMapCache,
  deleteAllocationField,
  findMonthRecords,
  getFieldMap,
  listAllocationRecords,
  pivotToSeries,
  recordMonthKey,
  sortAllocationRecords,
  upsertAllocationRow,
} from "./teable";

process.env.DATABASE_URL = "postgres://dashboard@localhost/dashboard";
process.env.AUTH_URL = "https://dash.example.test";
process.env.AUTH_SECRET = "a".repeat(40);
process.env.OIDC_ISSUER = "https://auth.example.test/application/o/dashboard/";
process.env.OIDC_CLIENT_ID = "client";
process.env.OIDC_CLIENT_SECRET = "secret";
process.env.AUTHORIZED_SUB = "sub-123";
process.env.TEABLE_URL = "https://teable.example.test";
process.env.TEABLE_TOKEN = "teable-token";
process.env.TEABLE_TABLE_ID = "tblTest";
process.env.PAPERLESS_URL = "https://paperless.example.test";
process.env.PAPERLESS_TOKEN = "paperless-token";
process.env.CRON_SECRET = "c".repeat(20);
process.env.WEBHOOK_SECRET = "w".repeat(20);

const fetchMock = vi.fn();
globalThis.fetch = fetchMock as unknown as typeof fetch;

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function call(i: number): { url: string; init: RequestInit } {
  const c = fetchMock.mock.calls[i];
  if (!c) throw new Error(`no fetch call #${i}`);
  return { url: String(c[0]), init: (c[1] ?? {}) as RequestInit };
}

const FIELDS = [
  { id: "fldDate", name: "Date", type: "date" },
  { id: "fldIng", name: "ING", type: "number" },
  { id: "fldRev", name: "Revolut", type: "number" },
  { id: "fldTotal", name: "TOTAL", type: "formula", isComputed: true },
];

beforeEach(() => {
  fetchMock.mockReset();
  clearFieldMapCache();
});

describe("listAllocationRecords", () => {
  it("pages until a short page comes back", async () => {
    fetchMock
      .mockResolvedValueOnce(
        json({ records: [{ id: "r1", fields: {} }, { id: "r2", fields: {} }] }),
      )
      .mockResolvedValueOnce(json({ records: [{ id: "r3", fields: {} }] }));

    const records = await listAllocationRecords({ take: 2 });

    expect(records.map((r) => r.id)).toEqual(["r1", "r2", "r3"]);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(call(0).url).toContain("skip=0");
    expect(call(0).url).toContain("take=2");
    expect(call(1).url).toContain("skip=2");
  });

  it("stops immediately on an empty table", async () => {
    fetchMock.mockResolvedValueOnce(json({ records: [] }));
    await expect(listAllocationRecords()).resolves.toEqual([]);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("sorts by the Date cell, not by the order Teable hands rows back in", async () => {
    // Regression: the client used to pass orderBy [{fieldId:"Date"}] — a field
    // NAME where Teable wants an id — and Teable ignored it without an error.
    // Confirmed against the live table on 2026-09-01: it returns the
    // 2026-09-01 row BEFORE the 2026-08-31 one, i.e. creation order.
    fetchMock.mockResolvedValueOnce(
      json({
        records: [
          { id: "recSep", fields: { Date: "2026-09-01T20:56:18.000Z", ING: 251 } },
          { id: "recAugLate", fields: { Date: "2026-08-31T22:00:00.000Z", ING: 251 } },
          { id: "recAug", fields: { Date: "2026-08-01T11:54:25.000Z", ING: 6955.46 } },
        ],
      }),
    );

    const records = await listAllocationRecords();

    expect(records.map((r) => r.id)).toEqual(["recAug", "recAugLate", "recSep"]);
  });

  it("no longer sends an orderBy Teable would silently ignore", async () => {
    fetchMock.mockResolvedValueOnce(json({ records: [] }));
    await listAllocationRecords();
    expect(call(0).url).not.toContain("orderBy");
  });

  it("passes an explicit orderBy through for a caller that knows the field ids", async () => {
    fetchMock.mockResolvedValueOnce(json({ records: [] }));
    await listAllocationRecords({ orderBy: '[{"fieldId":"fldF5Zed4cJlKyapPyd","order":"asc"}]' });
    expect(decodeURIComponent(call(0).url)).toContain("fldF5Zed4cJlKyapPyd");
  });

  it("sends the bearer token", async () => {
    fetchMock.mockResolvedValueOnce(json({ records: [] }));
    await listAllocationRecords();
    const headers = call(0).init.headers as Record<string, string>;
    expect(headers.authorization).toBe("Bearer teable-token");
  });

  it("surfaces a 401 with the raw payload", async () => {
    fetchMock.mockResolvedValueOnce(json({ message: "Unauthorized" }, 401));
    const err = (await listAllocationRecords().catch((e: unknown) => e)) as UpstreamError;
    expect(err).toBeInstanceOf(UpstreamError);
    expect(err.retryable).toBe(false);
    expect(err.detail).toEqual({ message: "Unauthorized" });
  });
});

describe("getFieldMap", () => {
  it("caches after the first call", async () => {
    fetchMock.mockResolvedValue(json(FIELDS));
    await getFieldMap();
    await getFieldMap();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});

/**
 * Fetch order for an upsert: 0 = GET /field (the rename guard), 1 = GET /record
 * (the month lookup), 2 = the POST or PATCH.
 */
const EMPTY_TABLE = { records: [] };

/** A row already in the table, as Teable hands it back. */
function existingRow(id: string, date: string, extra: Record<string, unknown> = {}) {
  return {
    id,
    fields: {
      Date: date,
      ING: 1,
      Revolut: 2,
      EToro: 111,
      "Buddy Bank": 222,
      IsyBank: 333,
      Mediolanum: 444,
      Binance: 555,
      "Fondo Cometa": 666,
      Fideuram: 777,
      TOTAL: 888,
      ...extra,
    },
  };
}

describe("upsertAllocationRow", () => {
  it("creates when the month has no row yet, posting only Date, ING and Revolut", async () => {
    fetchMock
      .mockResolvedValueOnce(json(FIELDS))
      .mockResolvedValueOnce(json(EMPTY_TABLE))
      .mockResolvedValueOnce(json({ records: [{ id: "recNew", fields: {} }] }));

    const result = await upsertAllocationRow({ date: "2026-09-01", ing: 1234.56, revolut: 78.9 });

    expect(result).toEqual({ recordId: "recNew", action: "created" });
    const post = call(2);
    expect(post.init.method).toBe("POST");
    expect(JSON.parse(String(post.init.body))).toEqual({
      fieldKeyType: "name",
      records: [{ fields: { Date: "2026-09-01", ING: 1234.56, Revolut: 78.9 } }],
    });
  });

  it("does not treat another month's row as a match", async () => {
    fetchMock
      .mockResolvedValueOnce(json(FIELDS))
      .mockResolvedValueOnce(json({ records: [existingRow("recAug", "2026-08-01T11:54:25.000Z")] }))
      .mockResolvedValueOnce(json({ records: [{ id: "recNew", fields: {} }] }));

    const result = await upsertAllocationRow({ date: "2026-09-01", ing: 1, revolut: 2 });

    expect(result.action).toBe("created");
    expect(call(2).init.method).toBe("POST");
  });

  it("patches in place when the month already has a row", async () => {
    fetchMock
      .mockResolvedValueOnce(json(FIELDS))
      .mockResolvedValueOnce(json({ records: [existingRow("recSep", "2026-09-01T20:56:18.000Z")] }))
      .mockResolvedValueOnce(json({ id: "recSep", fields: {} }));

    const result = await upsertAllocationRow({ date: "2026-09-01", ing: 251, revolut: 15413.59 });

    expect(result).toEqual({ recordId: "recSep", action: "updated" });
    const patch = call(2);
    expect(patch.init.method).toBe("PATCH");
    expect(patch.url).toContain("/record/recSep");
    // The single-record shape, not the create's `records` array — verified
    // against the live instance's OpenAPI document on 2026-09-01.
    expect(JSON.parse(String(patch.init.body))).toEqual({
      fieldKeyType: "name",
      record: { fields: { ING: 251, Revolut: 15413.59 } },
    });
  });

  it("never sends Date, a hand-tracked column or the computed TOTAL on an update", async () => {
    fetchMock
      .mockResolvedValueOnce(json(FIELDS))
      .mockResolvedValueOnce(json({ records: [existingRow("recSep", "2026-09-01T20:56:18.000Z")] }))
      .mockResolvedValueOnce(json({ id: "recSep", fields: {} }));

    await upsertAllocationRow({ date: "2026-09-01", ing: 251, revolut: 15413.59 });

    const sent = JSON.parse(String(call(2).init.body)) as { record: { fields: Record<string, unknown> } };
    expect(Object.keys(sent.record.fields).sort()).toEqual(["ING", "Revolut"]);
    for (const forbidden of [
      "Date",
      "TOTAL",
      "EToro",
      "Buddy Bank",
      "IsyBank",
      "Mediolanum",
      "Binance",
      "Fondo Cometa",
      "Fideuram",
    ]) {
      expect(sent.record.fields).not.toHaveProperty(forbidden);
    }
  });

  it("matches on the Europe/Rome month, so a 23:02Z row on the 31st is the NEXT month", async () => {
    // recg7M7DY8vfA4npBjN in the live table: stored 2026-05-31T23:02Z, which is
    // 2026-06-01 01:02 in Rome — June's row. A UTC slice(0,7) would call it May
    // and append a second June row on top of it.
    fetchMock
      .mockResolvedValueOnce(json(FIELDS))
      .mockResolvedValueOnce(json({ records: [existingRow("recJun", "2026-05-31T23:02:14.000Z")] }))
      .mockResolvedValueOnce(json({ id: "recJun", fields: {} }));

    const result = await upsertAllocationRow({ date: "2026-06-01", ing: 1, revolut: 2 });

    expect(result).toEqual({ recordId: "recJun", action: "updated" });
  });

  it("patches the newest of several matches, reports the others and creates nothing", async () => {
    // The two 2026-09 rows the live table held on 2026-09-01, in the order
    // Teable actually returned them (creation order, newest Date first). The
    // owner has since merged them by hand; the case is kept because nothing
    // upstream prevents the table drifting back into it.
    fetchMock
      .mockResolvedValueOnce(json(FIELDS))
      .mockResolvedValueOnce(
        json({
          records: [
            existingRow("rec41rYnDKuR6WV9786", "2026-09-01T20:56:18.000Z"),
            existingRow("recE2yriad1cOxQxQQK", "2026-08-31T22:00:00.000Z"),
          ],
        }),
      )
      .mockResolvedValueOnce(json({ id: "rec41rYnDKuR6WV9786", fields: {} }));

    const result = await upsertAllocationRow({ date: "2026-09-01", ing: 251, revolut: 15413.59 });

    expect(result).toEqual({
      recordId: "rec41rYnDKuR6WV9786",
      action: "updated",
      duplicates: ["recE2yriad1cOxQxQQK"],
    });
    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(call(2).init.method).toBe("PATCH");
    // Nothing is deleted: the owner decides what happens to the older row.
    expect(fetchMock.mock.calls.some((c) => (c[1] as RequestInit | undefined)?.method === "DELETE")).toBe(
      false,
    );
  });

  it("converges on ONE row when a retry replays the same month", async () => {
    fetchMock
      .mockResolvedValueOnce(json(FIELDS))
      .mockResolvedValueOnce(json(EMPTY_TABLE))
      .mockResolvedValueOnce(json({ records: [{ id: "recNew", fields: {} }] }));

    const first = await upsertAllocationRow({ date: "2026-09-01", ing: 251, revolut: 15413.59 });
    expect(first.action).toBe("created");

    // Second run: the field map is cached, so only the list + the write go out,
    // and the list now contains the row the first run created.
    fetchMock
      .mockResolvedValueOnce(json({ records: [existingRow("recNew", "2026-09-01")] }))
      .mockResolvedValueOnce(json({ id: "recNew", fields: {} }));

    const second = await upsertAllocationRow({ date: "2026-09-01", ing: 251, revolut: 15413.59 });

    expect(second).toEqual({ recordId: "recNew", action: "updated" });
    expect(fetchMock).toHaveBeenCalledTimes(5);
    const methods = fetchMock.mock.calls.map((c) => (c[1] as RequestInit | undefined)?.method ?? "GET");
    expect(methods.filter((m) => m === "POST")).toHaveLength(1);
  });

  it("refuses to write when a field was renamed upstream", async () => {
    fetchMock.mockResolvedValueOnce(json(FIELDS.filter((f) => f.name !== "Revolut")));

    const err = (await upsertAllocationRow({
      date: "2026-09-01",
      ing: 1,
      revolut: 2,
    }).catch((e: unknown) => e)) as UpstreamError;

    expect(err).toBeInstanceOf(UpstreamError);
    expect(err.message).toContain("Revolut");
    // Guard runs before the month lookup, so nothing else went out.
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("rejects a non date-only date before touching the network", async () => {
    await expect(
      upsertAllocationRow({ date: "2026-09-01T00:00:00Z", ing: 1, revolut: 2 }),
    ).rejects.toThrow(/YYYY-MM-DD/);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("rejects a non-finite balance before touching the network", async () => {
    await expect(
      upsertAllocationRow({ date: "2026-09-01", ing: Number.NaN, revolut: 2 }),
    ).rejects.toThrow(/non-finite/);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("keeps the raw payload of a 400 field mismatch", async () => {
    fetchMock
      .mockResolvedValueOnce(json(FIELDS))
      .mockResolvedValueOnce(json(EMPTY_TABLE))
      .mockResolvedValueOnce(json({ message: "Field Revolut not found" }, 400));

    const err = (await upsertAllocationRow({
      date: "2026-09-01",
      ing: 1,
      revolut: 2,
    }).catch((e: unknown) => e)) as UpstreamError;

    expect(err.retryable).toBe(false);
    expect(err.detail).toEqual({ message: "Field Revolut not found" });
  });
});

describe("recordMonthKey / findMonthRecords", () => {
  it("reads a date-only cell as its own Rome month", () => {
    expect(recordMonthKey({ id: "r", fields: { Date: "2026-09-01" } })).toBe("2026-09-01");
    expect(recordMonthKey({ id: "r", fields: { Date: "2026-08-31" } })).toBe("2026-08-01");
  });

  it("is null for a row with no usable date, and such rows never match a month", () => {
    expect(recordMonthKey({ id: "r", fields: {} })).toBeNull();
    expect(recordMonthKey({ id: "r", fields: { Date: "not a date" } })).toBeNull();
    expect(findMonthRecords([{ id: "r", fields: {} }], "2026-09-01")).toEqual([]);
  });

  it("returns the month's rows ascending by Date, whatever order they arrived in", () => {
    const found = findMonthRecords(
      [
        { id: "recSep", fields: { Date: "2026-09-01T20:56:18.000Z" } },
        { id: "recAugLate", fields: { Date: "2026-08-31T22:00:00.000Z" } },
        { id: "recAug", fields: { Date: "2026-08-01T11:54:25.000Z" } },
      ],
      "2026-09-15",
    );
    // Note the input date is mid-month: only its month key matters.
    expect(found.map((r) => r.id)).toEqual(["recAugLate", "recSep"]);
  });
});

describe("pivotToSeries", () => {
  it("maps columns to account keys and keeps empty cells as gaps", () => {
    const points = pivotToSeries([
      {
        id: "r1",
        fields: {
          Date: "2026-08-01",
          ING: 1000,
          Revolut: 0,
          Fideuram: null,
          "Fondo Cometa": "1.234,56",
          TOTAL: 2234.56,
        },
      },
    ]);

    const byKey = Object.fromEntries(points.map((p) => [p.key, p.value]));
    expect(byKey.ing).toBe(1000);
    expect(byKey.revolut_total).toBe(0);
    expect(byKey.fideuram).toBeNull();
    expect(byKey.cometa).toBe(1234.56);
    expect(byKey.total).toBe(2234.56);
    expect(points.every((p) => p.month === "2026-08-01")).toBe(true);
  });

  it("skips absent columns rather than inventing zeros", () => {
    const points = pivotToSeries([{ id: "r1", fields: { Date: "2026-08-01", ING: 5 } }]);
    expect(points).toHaveLength(1);
    expect(points[0]?.key).toBe("ing");
  });

  it("derives the month in Europe/Rome from a UTC timestamp", () => {
    const points = pivotToSeries([
      { id: "r1", fields: { Date: "2026-09-30T22:00:00.000Z", ING: 1 } },
    ]);
    expect(points[0]?.month).toBe("2026-10-01");
  });

  it("drops rows without a usable date", () => {
    expect(pivotToSeries([{ id: "r1", fields: { ING: 5 } }])).toEqual([]);
  });
});

describe("sortAllocationRecords", () => {
  it("puts rows with no usable date last, in the order they arrived", () => {
    const sorted = sortAllocationRecords([
      { id: "bad1", fields: {} },
      { id: "b", fields: { Date: "2026-02-01" } },
      { id: "bad2", fields: { Date: "not a date" } },
      { id: "a", fields: { Date: "2026-01-01" } },
    ]);
    expect(sorted.map((r) => r.id)).toEqual(["a", "b", "bad1", "bad2"]);
  });

  it("does not mutate its input", () => {
    const input = [
      { id: "b", fields: { Date: "2026-02-01" } },
      { id: "a", fields: { Date: "2026-01-01" } },
    ];
    sortAllocationRecords(input);
    expect(input.map((r) => r.id)).toEqual(["b", "a"]);
  });
});

describe("pivotToSeries ordering", () => {
  it("keeps two rows of the same month in Date order, so last-wins is latest-wins", () => {
    // Both of these are 2026-09 in Europe/Rome: 2026-08-31T22:00Z is
    // 2026-09-01T00:00 in Rome.
    const points = pivotToSeries(
      sortAllocationRecords([
        { id: "recSep", fields: { Date: "2026-09-01T20:56:18.000Z", Revolut: 15413.59 } },
        { id: "recAugLate", fields: { Date: "2026-08-31T22:00:00.000Z", Revolut: 15575.11 } },
      ]),
    );
    const revolut = points.filter((p) => p.key === "revolut_total");
    expect(revolut.map((p) => p.value)).toEqual([15575.11, 15413.59]);
    expect(revolut.every((p) => p.month === "2026-09-01")).toBe(true);
  });
});

describe("deleteAllocationField", () => {
  const WITH_ETORO = [...FIELDS, { id: "fldEtoro", name: "EToro", type: "number" }];

  it("resolves the field id from the map and DELETEs that field", async () => {
    fetchMock
      .mockResolvedValueOnce(json(WITH_ETORO)) // getFieldMap
      .mockResolvedValueOnce(new Response(null, { status: 200 })); // the delete

    const res = await deleteAllocationField("EToro");

    expect(res).toEqual({ deleted: true });
    const del = call(1);
    expect(del.init.method).toBe("DELETE");
    expect(del.url).toContain("/api/table/tblTest/field/fldEtoro");
  });

  it("is a no-op success when the column is absent — no DELETE is sent", async () => {
    fetchMock.mockResolvedValueOnce(json(FIELDS)); // no EToro in the map

    const res = await deleteAllocationField("EToro");

    expect(res).toEqual({ deleted: false });
    expect(fetchMock).toHaveBeenCalledTimes(1); // only the field list, never a delete
  });

  it("treats a 404 from the delete as already-gone, not a failure", async () => {
    fetchMock
      .mockResolvedValueOnce(json(WITH_ETORO))
      .mockResolvedValueOnce(json({ message: "field not found" }, 404));

    const res = await deleteAllocationField("EToro");

    expect(res).toEqual({ deleted: false });
  });

  it("raises UpstreamError on a real upstream failure", async () => {
    fetchMock
      .mockResolvedValueOnce(json(WITH_ETORO))
      .mockResolvedValueOnce(json({ message: "boom" }, 500));

    await expect(deleteAllocationField("EToro")).rejects.toBeInstanceOf(UpstreamError);
  });
});
