import { beforeEach, describe, expect, it, vi } from "vitest";
import type { LatestBalance } from "@/lib/repo/balances";

interface RunRow {
  id: number;
  jobName: string;
  trigger: string;
  dedupeKey: string | null;
  status: string;
  error: string | null;
  detail: Record<string, unknown> | null;
}

interface SnapshotRow {
  monthKey: string;
  ing: string;
  revolut: string;
  status: string;
  teableRecordId: string | null;
  capturedAt: Date;
}

const store = vi.hoisted(() => {
  Object.assign(process.env, {
    DATABASE_URL: "postgres://dashboard@localhost/dashboard",
    AUTH_URL: "https://dash.example.test",
    AUTH_SECRET: "a".repeat(40),
    OIDC_ISSUER: "https://auth.example.test/application/o/dashboard/",
    OIDC_CLIENT_ID: "client",
    OIDC_CLIENT_SECRET: "secret",
    AUTHORIZED_SUB: "sub-123",
    TEABLE_URL: "https://teable.example.test",
    TEABLE_TOKEN: "teable-token",
    PAPERLESS_URL: "https://paperless.example.test",
    PAPERLESS_TOKEN: "paperless-token",
    CRON_SECRET: "c".repeat(20),
    WEBHOOK_SECRET: "w".repeat(20),
    GOTIFY_URL: "https://gotify.example.test",
    GOTIFY_TOKEN: "gotify-token",
    SNAPSHOT_GRACE_DAYS: "3",
  });
  return {
    runs: [] as RunRow[],
    snapshots: new Map<string, SnapshotRow>(),
    /** The hand-tracked registry the empty=0 valuation is driven by. */
    tracked: [] as Array<{
      slug: string;
      label: string;
      teableColumn: string;
      visible: boolean;
      sortOrder: number;
      createdAt: Date;
    }>,
    /** Stands in for `balance_snapshots`, so idempotency can be tested for real. */
    written: [] as Array<{
      source: string;
      accountKey: string;
      balance: string;
      capturedAt?: Date;
    }>,
    nextRunId: 1,
  };
});

vi.mock("@/lib/repo/jobs", () => ({
  startRun: vi.fn(
    async (input: { jobName: string; trigger: string; dedupeKey?: string | null }) => {
      const row: RunRow = {
        id: store.nextRunId++,
        jobName: input.jobName,
        trigger: input.trigger,
        dedupeKey: input.dedupeKey ?? null,
        status: "running",
        error: null,
        detail: null,
      };
      store.runs.push(row);
      return row;
    },
  ),
  finishRun: vi.fn(
    async (
      id: number,
      status: string,
      extra?: { error?: string; detail?: Record<string, unknown> },
    ) => {
      const row = store.runs.find((r) => r.id === id);
      if (!row) throw new Error(`finishRun for unknown run ${id}`);
      row.status = status;
      row.error = extra?.error ?? null;
      row.detail = extra?.detail ?? null;
    },
  ),
  allMonthKeys: vi.fn(async () => [...store.snapshots.keys()]),
  pendingTeableWrites: vi.fn(async () =>
    [...store.snapshots.values()].filter((r) => r.status === "pending_teable"),
  ),
  markSnapshotStatus: vi.fn(async (monthKey: string, status: string) => {
    const row = store.snapshots.get(monthKey);
    if (row) row.status = status;
  }),
  recentRuns: vi.fn(async (jobName?: string) =>
    [...store.runs].reverse().filter((r) => !jobName || r.jobName === jobName),
  ),
}));

vi.mock("@/lib/repo/balances", async () => {
  const { monthKey } = await import("@/lib/time");
  return {
    latestBalances: vi.fn(async () => [] as LatestBalance[]),
    recordSnapshots: vi.fn(
      async (
        rows: Array<{
          source: string;
          accountKey: string;
          balance: string;
          capturedAt?: Date;
        }>,
      ) => {
        store.written.push(...rows);
      },
    ),
    /** The real query is a DISTINCT over `(account_key, Rome month, balance)`. */
    recordedTeableMonths: vi.fn(async () => {
      const seen = new Map<string, { accountKey: string; month: string; balance: string }>();
      for (const row of store.written) {
        if (row.source !== "teable") continue;
        const month = monthKey(row.capturedAt ?? new Date());
        seen.set(`${row.accountKey}@${month}@${row.balance}`, {
          accountKey: row.accountKey,
          month,
          balance: row.balance,
        });
      }
      return [...seen.values()];
    }),
  };
});

vi.mock("@/lib/repo/tracked-accounts", () => ({
  list: vi.fn(async () => store.tracked),
}));

vi.mock("@/lib/repo/payslips", () => ({ knownDocIds: vi.fn(async () => [] as number[]) }));

vi.mock("@/lib/clients/paperless", () => ({ listPayslipDocuments: vi.fn(async () => []) }));

/** The sweep must not touch Wallet any more: that moved to `wallet_refresh`. */
vi.mock("@/lib/clients/wallet", () => ({ getBalances: vi.fn() }));

/** `pivotToSeries` stays real: the cache refresh is only correct if the pivot is. */
vi.mock("@/lib/clients/teable", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/clients/teable")>();
  return { ...actual, listAllocationRecords: vi.fn(async () => []) };
});

vi.mock("@/lib/jobs/monthly-snapshot", () => ({
  JOB_NAME: "monthly_snapshot",
  runMonthlySnapshot: vi.fn(async (input: { monthKey?: string }) => ({
    job: "monthly_snapshot",
    status: "success",
    detail: { monthKey: input.monthKey },
  })),
}));

vi.mock("@/lib/jobs/payslip-ingest", () => ({
  ingestPayslipDocument: vi.fn(async () => ({ job: "payslip_ingest", status: "success" })),
}));

vi.mock("@/lib/jobs/heartbeat", () => ({ touchHeartbeat: vi.fn(async () => true) }));

vi.mock("@/lib/clients/http", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/clients/http")>();
  return { ...actual, httpRequest: vi.fn(async () => new Response("{}", { status: 200 })) };
});

import { httpRequest } from "@/lib/clients/http";
import { listPayslipDocuments } from "@/lib/clients/paperless";
import { listAllocationRecords } from "@/lib/clients/teable";
import { getBalances } from "@/lib/clients/wallet";
import { touchHeartbeat } from "@/lib/jobs/heartbeat";
import { runMonthlySnapshot } from "@/lib/jobs/monthly-snapshot";
import { ingestPayslipDocument } from "@/lib/jobs/payslip-ingest";
import { latestBalances, recordSnapshots } from "@/lib/repo/balances";
import { markSnapshotStatus } from "@/lib/repo/jobs";
import { knownDocIds } from "@/lib/repo/payslips";
import { runSweep } from "@/lib/jobs/sweep";

const BALANCES = {
  ing: 1234.56,
  revolut: 789.01,
  breakdown: { ing: 1234.56, revolut_main: 500, revolut_savings: 200.01, revolut_holidays: 89 },
} as const;

/** Contents of the read cache, keyed by account, for `latestBalances`. */
let cache: Record<string, LatestBalance> = {};

function cached(key: string, source: "wallet" | "teable", capturedAt: Date): LatestBalance {
  return { accountKey: key, source, balance: "1.00", capturedAt };
}

function alerts(): Array<{ title: string; message: string; priority: number }> {
  return vi.mocked(httpRequest).mock.calls.map((call) =>
    JSON.parse(String(call[2]?.body ?? "{}")) as {
      title: string;
      message: string;
      priority: number;
    },
  );
}

function done(monthKey: string): SnapshotRow {
  return {
    monthKey,
    ing: "1000.00",
    revolut: "500.00",
    status: "done",
    teableRecordId: "rec_1",
    capturedAt: new Date(`${monthKey}T21:59:00Z`),
  };
}

/** A registry row for the mock; only slug + teableColumn drive the sweep. */
function track(slug: string, teableColumn: string): (typeof store.tracked)[number] {
  return { slug, label: slug, teableColumn, visible: true, sortOrder: 0, createdAt: new Date(0) };
}

/** The five real hand-tracked accounts, as `migrate.ts` seeds them. */
const TRACKED_FIVE: typeof store.tracked = [
  track("etoro", "EToro"),
  track("buddy_bank", "Buddy Bank"),
  track("isybank", "IsyBank"),
  track("mediolanum", "Mediolanum"),
  track("binance", "Binance"),
];

beforeEach(() => {
  store.runs.length = 0;
  store.snapshots.clear();
  store.written.length = 0;
  store.nextRunId = 1;
  store.tracked = [...TRACKED_FIVE];
  cache = {};
  vi.clearAllMocks();
  vi.mocked(latestBalances).mockImplementation(async (keys?: string[]) =>
    (keys ?? []).map((k) => cache[k]).filter((r): r is LatestBalance => r !== undefined),
  );
  vi.mocked(getBalances).mockResolvedValue(BALANCES);
  vi.mocked(listAllocationRecords).mockResolvedValue([]);
  vi.mocked(listPayslipDocuments).mockResolvedValue([]);
  vi.mocked(knownDocIds).mockResolvedValue([]);
  vi.mocked(touchHeartbeat).mockResolvedValue(true);
  vi.mocked(httpRequest).mockResolvedValue(new Response("{}", { status: 200 }));
  vi.mocked(runMonthlySnapshot).mockImplementation(async (input) => ({
    job: "monthly_snapshot",
    status: "success",
    detail: { monthKey: input.monthKey },
  }));
});

describe("snapshot catch-up and the grace window", () => {
  it("leaves the due day to the 23:59 cron", async () => {
    store.snapshots.set("2026-08-01", done("2026-08-01"));

    const result = await runSweep({ now: new Date("2026-09-01T09:07:00Z") });

    expect(result.detail?.snapshotCatchUp).toEqual({ "2026-09-01": "due" });
    expect(runMonthlySnapshot).not.toHaveBeenCalled();
    expect(alerts()).toEqual([]);
  });

  it("runs a missed month late on day 2, inside the grace window", async () => {
    store.snapshots.set("2026-08-01", done("2026-08-01"));

    const result = await runSweep({ now: new Date("2026-09-03T09:07:00Z") });

    expect(runMonthlySnapshot).toHaveBeenCalledWith(
      expect.objectContaining({ monthKey: "2026-09-01", trigger: "sweep" }),
    );
    expect(result.detail?.snapshotCatchUp).toEqual({ "2026-09-01": "success" });
    expect(alerts()).toEqual([]);
  });

  it("marks day 5 as missed, alerts once at priority 8, and never retries it", async () => {
    store.snapshots.set("2026-08-01", done("2026-08-01"));
    const now = new Date("2026-09-06T09:07:00Z");

    const result = await runSweep({ now });

    expect(runMonthlySnapshot).not.toHaveBeenCalled();
    expect(markSnapshotStatus).toHaveBeenCalledWith("2026-09-01", "missed");
    expect(result.detail?.snapshotCatchUp).toEqual({ "2026-09-01": "missed" });
    const sent = alerts();
    expect(sent).toHaveLength(1);
    expect(sent[0]?.priority).toBe(8);
    expect(sent[0]?.title).toContain("2026-09-01");
    expect(
      store.runs.some((r) => r.jobName === "monthly_snapshot" && r.status === "missed"),
    ).toBe(true);

    // The hour after: still missed, but silent — the decision is the owner's.
    const second = await runSweep({ now: new Date("2026-09-06T10:07:00Z") });
    expect(second.detail?.snapshotCatchUp).toEqual({ "2026-09-01": "missed_already_reported" });
    expect(alerts()).toHaveLength(1);
  });

  it("does not invent months when no snapshot has ever been taken", async () => {
    const result = await runSweep({ now: new Date("2026-09-06T09:07:00Z") });

    expect(result.detail?.snapshotCatchUp).toEqual({ "2026-09-01": "missed" });
    expect(runMonthlySnapshot).not.toHaveBeenCalled();
  });
});

describe("Teable write retries", () => {
  it("replays every row stuck in pending_teable before looking for new months", async () => {
    store.snapshots.set("2026-07-01", {
      ...done("2026-07-01"),
      status: "pending_teable",
      teableRecordId: null,
    });
    store.snapshots.set("2026-08-01", done("2026-08-01"));

    const result = await runSweep({ now: new Date("2026-08-15T09:07:00Z") });

    expect(runMonthlySnapshot).toHaveBeenCalledTimes(1);
    expect(runMonthlySnapshot).toHaveBeenCalledWith(
      expect.objectContaining({ monthKey: "2026-07-01", trigger: "sweep" }),
    );
    expect(result.detail?.pendingRetries).toEqual({ "2026-07-01": "success" });
  });

  it("never re-discovers a poisoned month", async () => {
    store.snapshots.set("2026-08-01", { ...done("2026-08-01"), status: "poisoned" });

    const result = await runSweep({ now: new Date("2026-08-15T09:07:00Z") });

    expect(runMonthlySnapshot).not.toHaveBeenCalled();
    expect(result.detail?.snapshotCatchUp).toEqual({});
    expect(alerts()).toEqual([]);
  });
});

describe("payslip polling fallback", () => {
  it("ingests only documents that are not already known", async () => {
    vi.mocked(listPayslipDocuments).mockResolvedValue([
      { id: 11, title: "old", added: "2026-07-03T00:00:00Z", tags: [22] },
      { id: 12, title: "new", added: "2026-08-03T00:00:00Z", tags: [22] },
    ]);
    vi.mocked(knownDocIds).mockResolvedValue([11]);

    const result = await runSweep({ now: new Date("2026-08-15T09:07:00Z") });

    expect(ingestPayslipDocument).toHaveBeenCalledTimes(1);
    expect(ingestPayslipDocument).toHaveBeenCalledWith({ docId: 12, trigger: "sweep" });
    expect(result.detail?.payslipPolling).toEqual({ seen: 2, ingested: { 12: "success" } });
  });
});

describe("Teable cache refresh", () => {
  const now = new Date("2026-08-15T09:07:00Z");

  /** Only the rows the Teable step wrote, in the order it wrote them. */
  function teableRows() {
    return vi
      .mocked(recordSnapshots)
      .mock.calls.map((c) => c[0])
      .flat()
      .filter((r) => r.source === "teable");
  }

  function latestRows() {
    return teableRows().filter(
      (r) => (r.raw as { kind?: string } | undefined)?.kind === "latest",
    );
  }

  function historyRows() {
    return teableRows().filter(
      (r) => (r.raw as { kind?: string } | undefined)?.kind === "history",
    );
  }

  it("never calls Wallet — that moved to the daily wallet_refresh job", async () => {
    cache.fideuram = cached("fideuram", "teable", new Date("2026-08-15T08:40:00Z"));
    cache.cometa = cached("cometa", "teable", new Date("2026-08-15T08:40:00Z"));

    await runSweep({ now });

    expect(getBalances).not.toHaveBeenCalled();
  });

  it("skips Teable while the cache is inside its 1-hour refresh budget", async () => {
    cache.fideuram = cached("fideuram", "teable", new Date("2026-08-15T09:00:00Z"));
    cache.cometa = cached("cometa", "teable", new Date("2026-08-15T09:00:00Z"));

    const result = await runSweep({ now });

    expect(listAllocationRecords).not.toHaveBeenCalled();
    expect(result.detail?.teableCache).toBe("fresh");
  });

  it("caches the newest Allocation value per column without clobbering Wallet-owned keys", async () => {
    // Only Binance is hand-tracked here, to keep the per-column assertion sharp;
    // the empty=0 rule for the full five is exercised in its own tests below.
    store.tracked = [track("binance", "Binance")];
    vi.mocked(listAllocationRecords).mockResolvedValue([
      {
        id: "rec_jul",
        fields: { Date: "2026-07-01", ING: 900, Fideuram: 5000, "Fondo Cometa": 3000, TOTAL: 8900 },
      },
      {
        id: "rec_aug",
        fields: {
          Date: "2026-08-01",
          ING: 1234.56,
          Revolut: 789.01,
          Fideuram: 5100,
          "Fondo Cometa": 3050,
          EToro: null,
          Binance: 250,
          TOTAL: 10423.57,
        },
      },
    ]);

    const result = await runSweep({ now });

    expect(latestRows().map((r) => r.accountKey).sort()).toEqual([
      "binance",
      "cometa",
      "fideuram",
    ]);
    expect(latestRows().every((r) => r.capturedAt === now)).toBe(true);
    expect(result.detail?.teableCache).toMatchObject({ newestMonth: "2026-08-01", keys: 3 });
  });

  it("never caches the TOTAL formula column", async () => {
    // Its formula is ING+Buddy Bank+Mediolanum+IsyBank+EToro+Binance+Fideuram+
    // Revolut: no Fondo Cometa, and on an app-written row no hand-tracked
    // account either. Net worth is summed from the columns instead.
    vi.mocked(listAllocationRecords).mockResolvedValue([
      { id: "rec", fields: { Date: "2026-08-01", Fideuram: 1, "Fondo Cometa": 2, TOTAL: 3 } },
    ]);

    await runSweep({ now });

    expect(teableRows().some((r) => r.accountKey === "total")).toBe(false);
  });

  it("falls back to an account's last non-empty month when the newest cell is blank", async () => {
    // The real case: the September 2026 Allocation row was filled in for
    // Fideuram but left blank for Fondo Cometa. Keying off the newest month
    // alone dropped Cometa from the cache entirely, so the dashboard showed
    // nothing for it even though August held 2.228,13.
    vi.mocked(listAllocationRecords).mockResolvedValue([
      {
        id: "rec_aug",
        fields: { Date: "2026-08-01", Fideuram: 4884.25, "Fondo Cometa": 2228.13, TOTAL: 21494.35 },
      },
      {
        id: "rec_sep",
        fields: { Date: "2026-09-01", Fideuram: 5174.54, "Fondo Cometa": null, TOTAL: 20839.13 },
      },
    ]);

    const result = await runSweep({ now });

    const byKey = Object.fromEntries(latestRows().map((r) => [r.accountKey, r.balance]));
    expect(byKey.cometa).toBe("2228.13"); // carried from August, not dropped
    expect(byKey.fideuram).toBe("5174.54"); // September, the newest
    expect(result.detail?.teableCache).toMatchObject({
      months: { cometa: "2026-08-01", fideuram: "2026-09-01" },
    });
  });

  it("prefers the later row when two share a month", async () => {
    // 2026-08-31T22:00Z is 2026-09-01 in Europe/Rome, so both of these are
    // September. `listAllocationRecords` hands rows over in Date order (that
    // contract is tested in teable.test.ts); the refresh must then take the
    // LAST of them, not the first it happens to see.
    vi.mocked(listAllocationRecords).mockResolvedValue([
      { id: "rec_early", fields: { Date: "2026-08-31T22:00:00.000Z", Fideuram: 4000 } },
      { id: "rec_late", fields: { Date: "2026-09-01T20:56:18.000Z", Fideuram: 5174.54 } },
    ]);

    await runSweep({ now });

    const byKey = Object.fromEntries(latestRows().map((r) => [r.accountKey, r.balance]));
    expect(byKey.fideuram).toBe("5174.54");
  });
});

describe("Teable history backfill", () => {
  const now = new Date("2026-08-15T09:07:00Z");

  const ROWS = [
    {
      id: "rec_jun",
      fields: {
        Date: "2026-06-01",
        ING: 4992.65,
        "Buddy Bank": 1500,
        Binance: null,
        Fideuram: 4390.17,
        TOTAL: 20993.34,
      },
    },
    {
      id: "rec_jul",
      fields: {
        Date: "2026-07-01",
        ING: 5691.91,
        "Buddy Bank": 1750,
        Binance: 1800,
        Fideuram: 4657.72,
        TOTAL: 21595.58,
      },
    },
  ];

  function historyRows() {
    return vi
      .mocked(recordSnapshots)
      .mock.calls.map((c) => c[0])
      .flat()
      .filter((r) => r.source === "teable" && (r.raw as { kind?: string })?.kind === "history");
  }

  it("writes one row per (account, month) stamped at the month it belongs to", async () => {
    // Buddy Bank + Binance are the hand-tracked columns in these rows.
    store.tracked = [track("buddy_bank", "Buddy Bank"), track("binance", "Binance")];
    vi.mocked(listAllocationRecords).mockResolvedValue(ROWS);

    const result = await runSweep({ now });

    const written = historyRows().map((r) => [
      r.accountKey,
      r.balance,
      r.capturedAt?.toISOString(),
    ]);
    expect(written).toEqual(
      expect.arrayContaining([
        ["buddy_bank", "1500", "2026-06-01T00:00:00.000Z"],
        ["buddy_bank", "1750", "2026-07-01T00:00:00.000Z"],
        ["fideuram", "4390.17", "2026-06-01T00:00:00.000Z"],
        ["fideuram", "4657.72", "2026-07-01T00:00:00.000Z"],
        ["binance", "1800", "2026-07-01T00:00:00.000Z"],
      ]),
    );
    // June's Binance cell is blank — for a HAND-TRACKED account that is a real 0
    // now, not a gap, so the net-worth series can sum it. (Managed columns like
    // Fideuram still leave a gap; that is tested elsewhere.)
    expect(written).toContainEqual(["binance", "0", "2026-06-01T00:00:00.000Z"]);
    expect(result.detail?.teableCache).toMatchObject({ backfilled: written.length });
  });

  it("backfills Wallet-owned keys for closed months only", async () => {
    // Without ING history the net-worth curve would be missing five figures for
    // every month before this app existed, then jump when it started. But the
    // CURRENT month stays Wallet's: a live capture must never be outranked.
    vi.mocked(listAllocationRecords).mockResolvedValue([
      ...ROWS,
      { id: "rec_now", fields: { Date: "2026-08-01", ING: 6955.46, Fideuram: 4884.25 } },
    ]);

    await runSweep({ now });

    const ing = historyRows().filter((r) => r.accountKey === "ing");
    expect(ing.map((r) => r.capturedAt?.toISOString())).toEqual([
      "2026-06-01T00:00:00.000Z",
      "2026-07-01T00:00:00.000Z",
    ]);
  });

  it("is idempotent: a second sweep over the same table writes no history at all", async () => {
    vi.mocked(listAllocationRecords).mockResolvedValue(ROWS);

    await runSweep({ now });
    const first = historyRows().length;
    expect(first).toBeGreaterThan(0);

    vi.mocked(recordSnapshots).mockClear();
    const second = await runSweep({ now: new Date("2026-08-15T10:07:00Z") });

    expect(historyRows()).toEqual([]);
    expect(second.detail?.teableCache).toMatchObject({ backfilled: 0 });
  });

  it("picks up a value the owner corrected by hand, once", async () => {
    vi.mocked(listAllocationRecords).mockResolvedValue(ROWS);
    await runSweep({ now });

    // June's Buddy Bank was 1500; the owner fixes it to 1450.
    const corrected = structuredClone(ROWS);
    corrected[0]!.fields["Buddy Bank"] = 1450;
    vi.mocked(listAllocationRecords).mockResolvedValue(corrected);

    vi.mocked(recordSnapshots).mockClear();
    await runSweep({ now: new Date("2026-08-15T10:07:00Z") });
    expect(historyRows().map((r) => [r.accountKey, r.balance])).toEqual([
      ["buddy_bank", "1450"],
    ]);

    // And it settles: the next sweep sees the new fingerprint and stops.
    vi.mocked(recordSnapshots).mockClear();
    await runSweep({ now: new Date("2026-08-15T11:07:00Z") });
    expect(historyRows()).toEqual([]);
  });

  it("does not care that Postgres reads 820 back as 820.00", async () => {
    // Teable hands back a bare `820`; `numeric(14,2)` reads back "820.00".
    // Comparing those as text would re-insert every row on every sweep.
    vi.mocked(listAllocationRecords).mockResolvedValue([
      { id: "rec", fields: { Date: "2026-06-01", "Buddy Bank": 820 } },
    ]);
    await runSweep({ now });
    store.written
      .filter((r) => r.accountKey === "buddy_bank")
      .forEach((r) => {
        r.balance = "820.00";
      });

    vi.mocked(recordSnapshots).mockClear();
    await runSweep({ now: new Date("2026-08-15T10:07:00Z") });

    expect(historyRows()).toEqual([]);
  });
});

describe("resilience", () => {
  it("keeps going after a failing step, reports it, and still touches the heartbeat", async () => {
    vi.mocked(listPayslipDocuments).mockRejectedValue(new Error("paperless 502"));

    const result = await runSweep({ now: new Date("2026-08-15T09:07:00Z") });

    expect(result.status).toBe("failed");
    expect(result.error).toContain("payslip_polling: paperless 502");
    // The steps after the failure still ran.
    expect(listAllocationRecords).toHaveBeenCalledTimes(1);
    expect(touchHeartbeat).toHaveBeenCalledWith(new Date("2026-08-15T09:07:00Z"));
    expect(store.runs.find((r) => r.jobName === "sweep")?.status).toBe("failed");
  });

  it("records a clean sweep as a success run", async () => {
    store.snapshots.set("2026-08-01", done("2026-08-01"));

    const result = await runSweep({ now: new Date("2026-08-15T09:07:00Z") });

    expect(result.status).toBe("success");
    expect(result.detail?.heartbeat).toBe(true);
    expect(store.runs.filter((r) => r.jobName === "sweep")).toHaveLength(1);
    expect(alerts()).toEqual([]);
  });
});
