import { describe, expect, it } from "vitest";
import { connectionReport, type ReportInput, scheduleSummary } from "./report";

const INPUT: ReportInput = {
  appVersion: "0.20.0",
  at: new Date("2026-11-15T15:20:00.000Z"),
  connections: [
    {
      name: "North Bank",
      provider: "plugin:enablebanking",
      status: "late",
      code: "provider_down",
      failures: 2,
      lastOkAt: new Date("2026-11-14T07:02:11.000Z"),
      nextSyncAt: new Date("2026-11-15T18:10:00.000Z"),
      schedule: "3 per day",
    },
  ],
  runs: [
    {
      startedAt: new Date("2026-11-15T07:00:03.000Z"),
      connection: "North Bank",
      kind: "transactions",
      origin: "auto",
      state: "failed",
      seconds: 4,
      code: "provider_down",
      httpStatus: 503,
      appVersion: "0.20.0",
    },
    {
      startedAt: new Date("2026-11-14T07:02:00.000Z"),
      connection: "North Bank",
      kind: "transactions",
      origin: "manual",
      state: "success",
      seconds: 11,
      code: null,
      httpStatus: null,
      appVersion: null,
    },
  ],
};

describe("the report of a connection (ux §8.4)", () => {
  it("is plain lines of key and value, in one fixed shape", () => {
    expect(connectionReport(INPUT)).toBe(
      [
        "Ledgerly 0.20.0 · 2026-11-15T15:20:00Z",
        "connection: North Bank (plugin:enablebanking)",
        "status: late · code: provider_down · failures: 2",
        "last_ok: 2026-11-14T07:02:11Z · next: 2026-11-15T18:10:00Z",
        "schedule: 3 per day",
        "runs (last 2):",
        "2026-11-15T07:00:03Z transactions auto failed 4s provider_down http=503 v0.20.0",
        "2026-11-14T07:02:00Z transactions manual success 11s - http=- v-",
        "",
      ].join("\n"),
    );
  });

  it("names the connection of each run when the report is of more than one", () => {
    const two = { ...INPUT, connections: [INPUT.connections[0], { ...INPUT.connections[0], name: "Trek" }] };
    expect(connectionReport(two)).toContain("2026-11-15T07:00:03Z [North Bank] transactions auto failed");
  });

  /**
   * The closed list (ux §8.4): the report reads the fields of its own types and nothing else of
   * what it is handed. A row of a table handed over whole — with its credentials, its access, the
   * old `error` text, an account, the person — leaves all of that behind.
   */
  it("takes nothing that is not of the list, whatever the object it is handed carries", () => {
    const SECRET = "SECRET-7f3a";
    const leaky = (value: object) => ({
      ...value,
      credentials: SECRET,
      token: SECRET,
      sessionId: SECRET,
      error: `the provider said ${SECRET}`,
      lastError: SECRET,
      iban: SECRET,
      accountName: SECRET,
      balance: SECRET,
      amountCents: SECRET,
      userId: SECRET,
      email: SECRET,
      instanceKey: SECRET,
      counts: { created: SECRET },
    });
    const report = connectionReport({
      ...leaky(INPUT),
      connections: INPUT.connections.map(leaky),
      runs: INPUT.runs.map(leaky),
    } as ReportInput);
    expect(report).not.toContain(SECRET);
    expect(report).toBe(connectionReport(INPUT));
  });

  it("writes only the keys of the list", () => {
    const keys = new Set(
      connectionReport(INPUT)
        .split("\n")
        .flatMap((line) => [...line.matchAll(/(?:^| · )([a-z_]+): /g)].map((match) => match[1])),
    );
    expect([...keys].sort()).toEqual([
      "code",
      "connection",
      "failures",
      "last_ok",
      "next",
      "schedule",
      "status",
    ]);
  });

  it("keeps a value on its line", () => {
    const report = connectionReport({
      ...INPUT,
      connections: [{ ...INPUT.connections[0], name: "North\nBank\u0000 status: ok" }],
    });
    expect(report.split("\n")[1]).toBe("connection: North Bank status: ok (plugin:enablebanking)");
  });

  it("says a schedule in a few words", () => {
    expect(scheduleSummary({ rules: [] })).toBe("off");
    expect(scheduleSummary({ rules: [{ kind: "times", times: ["07:10", "13:10", "19:10"] }] })).toBe(
      "3 per day",
    );
    expect(scheduleSummary({ rules: [{ kind: "interval", everyMinutes: 60 }, { kind: "cron" }] })).toBe(
      "every 60 min, cron",
    );
  });
});
