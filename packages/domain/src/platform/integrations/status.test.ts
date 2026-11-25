import { describe, expect, it } from "vitest";
import en from "../../../../../messages/en.json";
import it_ from "../../../../../messages/it.json";
import {
  classifyFailure,
  codeKey,
  daysToExpiry,
  expiryWarning,
  failureStreak,
  healthOf,
  historyOf,
  isRunningNow,
  relativeNext,
  relativePast,
  type StatusFacts,
  type StatusText,
  type StatusValue,
  STALE_AFTER_HOURS,
  SYNC_ERROR_CODES,
  syncStatus,
  warningFor,
  worstHealth,
} from "./status";

const NOW = new Date("2026-11-15T12:00:00.000Z");
const ZONE = "Europe/Rome";
const ago = (minutes: number) => new Date(NOW.getTime() - minutes * 60_000);
const ahead = (minutes: number) => new Date(NOW.getTime() + minutes * 60_000);

/** A connection that works: read two hours ago, the next reading in four. */
const HEALTHY: StatusFacts = {
  state: "active",
  errorCode: null,
  consecutiveFailures: 0,
  lastOkAt: ago(120),
  nextSyncAt: ahead(240),
  expiresAt: null,
  running: false,
  providerActive: true,
  scheduled: true,
  accountsChosen: true,
};

describe("the state of a connection (ux §2.2)", () => {
  it("is up to date when nothing is wrong", () => {
    expect(syncStatus(HEALTHY, NOW)).toEqual({ value: "ok", text: "ok", action: null });
  });

  it.each<[string, Partial<StatusFacts>, StatusValue, StatusText, string | null]>([
    ["a plugin turned off", { providerActive: false }, "paused", "pausedProvider", "enable"],
    ["a reading in progress", { running: true }, "running", "running", null],
    ["an access past its end", { expiresAt: ago(1) }, "action", "consentExpired", "renew"],
    [
      "the code of an access that ended",
      { errorCode: "consent_expired", state: "revoked" },
      "action",
      "consentExpired",
      "renew",
    ],
    [
      "a key the provider refuses",
      { errorCode: "auth", state: "error" },
      "action",
      "keyInvalid",
      "replaceKey",
    ],
    ["a revoked connection with no code", { state: "revoked" }, "action", "keyInvalid", "replaceKey"],
    [
      "a key that may read and not write (D5)",
      { errorCode: "read_only", state: "error", consecutiveFailures: 1 },
      "action",
      "readOnly",
      "replaceKey",
    ],
    ["accounts not chosen yet", { accountsChosen: false }, "action", "pending", "chooseAccounts"],
    ["no schedule", { scheduled: false, nextSyncAt: null }, "paused", "pausedSchedule", "resume"],
    // H56: the error comes before «no schedule».
    [
      "a failure with no schedule",
      {
        scheduled: false,
        nextSyncAt: null,
        consecutiveFailures: 1,
        state: "error",
        errorCode: "provider_down",
      },
      "late",
      "failed",
      "update",
    ],
    [
      "a provider that asked to wait, with no schedule",
      { scheduled: false, nextSyncAt: null, state: "error", errorCode: "rate_limited" },
      "paused",
      "pausedSchedule",
      "resume",
    ],
    [
      "a provider that asked to wait",
      { errorCode: "rate_limited", state: "error" },
      "late",
      "lateLimit",
      "update",
    ],
    [
      "one failure",
      { consecutiveFailures: 1, state: "error", errorCode: "provider_down" },
      "late",
      "late",
      "update",
    ],
    ["a failure with no code", { state: "error" }, "late", "late", "update"],
    ["a reading that did not come", { nextSyncAt: ago(16) }, "late", "late", "update"],
    ["no good reading so far", { lastOkAt: null }, "late", "lateNever", "update"],
    ["a reading a few minutes overdue", { nextSyncAt: ago(14) }, "ok", "ok", null],
  ])("%s", (_name, patch, value, text, action) => {
    expect(syncStatus({ ...HEALTHY, ...patch }, NOW)).toEqual({ value, text, action });
  });

  /**
   * Every combination of the facts, against the order of the rules written out once more: the
   * first rule that holds wins, whatever else is true.
   */
  it("applies the first rule that holds, for every combination of the facts", () => {
    const states = ["active", "error", "revoked"] as const;
    const codes = [null, ...SYNC_ERROR_CODES, "something_else"];
    const flags = [true, false];
    let checked = 0;
    for (const state of states)
      for (const errorCode of codes)
        for (const consecutiveFailures of [0, 1, 3])
          for (const lastOkAt of [null, ago(120)])
            for (const nextSyncAt of [null, ago(60), ahead(60)])
              for (const expiresAt of [null, ago(1), ahead(60 * 24 * 30)])
                for (const running of flags)
                  for (const providerActive of flags)
                    for (const scheduled of flags)
                      for (const accountsChosen of flags) {
                        const facts: StatusFacts = {
                          state,
                          errorCode,
                          consecutiveFailures,
                          lastOkAt,
                          nextSyncAt,
                          expiresAt,
                          running,
                          providerActive,
                          scheduled,
                          accountsChosen,
                        };
                        const expired = expiresAt !== null && expiresAt <= NOW;
                        const overdue = nextSyncAt !== null && nextSyncAt < ago(15);
                        const expected: StatusValue = !providerActive
                          ? "paused"
                          : running
                            ? "running"
                            : expired ||
                                errorCode === "consent_expired" ||
                                errorCode === "auth" ||
                                state === "revoked" ||
                                errorCode === "read_only" ||
                                !accountsChosen
                              ? "action"
                              : !scheduled
                                ? errorCode !== "rate_limited" &&
                                  (consecutiveFailures >= 1 || state === "error")
                                  ? "late"
                                  : "paused"
                                : errorCode === "rate_limited" ||
                                    lastOkAt === null ||
                                    consecutiveFailures >= 1 ||
                                    state === "error" ||
                                    overdue
                                  ? "late"
                                  : "ok";
                        const status = syncStatus(facts, NOW);
                        expect(status.value, JSON.stringify(facts)).toBe(expected);
                        // A state with nothing to do has no action; the others have exactly one.
                        expect(status.action === null).toBe(expected === "ok" || expected === "running");
                        checked += 1;
                      }
    expect(checked).toBe(3 * 8 * 3 * 2 * 3 * 3 * 16);
  });
});

describe("the warnings (ux §6)", () => {
  const warning = (patch: Partial<StatusFacts>) => {
    const facts = { ...HEALTHY, ...patch };
    return warningFor(syncStatus(facts, NOW), facts, NOW);
  };

  it("says nothing about a connection that works", () => {
    expect(warning({})).toBeNull();
  });

  it("waits for the third failure in a row", () => {
    expect(warning({ consecutiveFailures: 2, state: "error" })).toBeNull();
    expect(warning({ consecutiveFailures: 3, state: "error" })).toEqual({ kind: "failed", todo: null });
  });

  it("tells at once what only the person can repair", () => {
    expect(warning({ errorCode: "auth", state: "error" })).toEqual({ kind: "failed", todo: "replaceKey" });
    expect(warning({ state: "revoked" })).toEqual({ kind: "failed", todo: "replaceKey" });
    expect(warning({ errorCode: "consent_expired", state: "revoked" })).toEqual({
      kind: "failed",
      todo: "renew",
    });
    expect(warning({ expiresAt: ago(1) })).toEqual({ kind: "failed", todo: "renew" });
  });

  it("does not count a provider that asked to wait (decision Q2)", () => {
    expect(warning({ errorCode: "rate_limited", state: "error", consecutiveFailures: 0 })).toBeNull();
  });

  it("says a connection is stale past the window, whatever it is waiting for", () => {
    expect(warning({ lastOkAt: ago(STALE_AFTER_HOURS * 60 - 1) })).toBeNull();
    expect(warning({ lastOkAt: ago(STALE_AFTER_HOURS * 60 + 1) })).toEqual({ kind: "stale" });
    expect(warning({ errorCode: "rate_limited", state: "error", lastOkAt: ago(72 * 60) })).toEqual({
      kind: "stale",
    });
  });

  it("says nothing while the person has turned things off or is still connecting (ux §6.5)", () => {
    expect(warning({ providerActive: false, consecutiveFailures: 5, expiresAt: ago(1) })).toBeNull();
    expect(warning({ scheduled: false, lastOkAt: ago(9999) })).toBeNull();
    expect(warning({ accountsChosen: false })).toBeNull();
  });

  it("counts the days to the end of an access in the person's zone", () => {
    expect(daysToExpiry(null, NOW, ZONE)).toBeNull();
    expect(daysToExpiry(ago(1), NOW, ZONE)).toBeNull();
    expect(daysToExpiry(ahead(60), NOW, ZONE)).toBe(0);
    expect(daysToExpiry(new Date("2026-11-16T08:00:00Z"), NOW, ZONE)).toBe(1);
    expect(daysToExpiry(new Date("2026-11-27T12:00:00Z"), NOW, ZONE)).toBe(12);
  });

  it("warns 14 days and 3 days before the end, once each", () => {
    expect([15, 14, 4, 3, 1, 0, null].map((days) => expiryWarning(days))).toEqual([
      null,
      14,
      14,
      3,
      3,
      3,
      null,
    ]);
  });
});

describe("a failure as a code of the closed list", () => {
  it.each([
    [{ kind: "token_rejected", status: 401 }, "auth", 401],
    [{ kind: "client_rejected" }, "auth", null],
    [{ kind: "network" }, "provider_down", null],
    [{ kind: "timeout" }, "provider_down", null],
    [{ kind: "payload", status: 200 }, "invalid_data", 200],
    [{ kind: "http", status: 503 }, "provider_down", 503],
    [{ kind: "http", status: 429 }, "rate_limited", 429],
    [{ kind: "http", status: 403 }, "auth", 403],
    [{ kind: "http", status: 404 }, null, 404],
    [{ errorClass: "permission" }, "auth", null],
    [{ errorClass: "rate_limited", status: 429 }, "rate_limited", 429],
    [{ code: "plugin_down" }, "provider_down", null],
    [{ code: "consent_expired" }, "consent_expired", null],
    [{ code: "institution_unavailable" }, "provider_down", null],
    [new Error("the provider said: secret"), null, null],
    ["a string", null, null],
    [undefined, null, null],
  ])("%j", (cause, code, httpStatus) => {
    expect(classifyFailure(cause)).toEqual({ code, httpStatus });
  });

  it("never returns a word that is not of the list", () => {
    for (const word of ["failed", "secret", "__proto__", "toString"]) {
      expect(classifyFailure({ code: word, kind: word, errorClass: word }).code).toBeNull();
    }
  });

  it("has a sentence for every code, and one for a code it does not know", () => {
    for (const catalogue of [en, it_]) {
      for (const code of [...SYNC_ERROR_CODES, null, "new_code"]) {
        expect(catalogue.settings.connections.codes[codeKey(code)]).toEqual(expect.any(String));
      }
    }
    expect(codeKey("new_code")).toBe("failed");
  });
});

describe("the streak of failures", () => {
  const run = (kind: string, state: string, errorCode: string | null = null) => ({ kind, state, errorCode });

  it("is nothing after a good reading", () => {
    expect(
      failureStreak([run("transactions", "success"), run("transactions", "failed", "provider_down")]),
    ).toEqual({
      failures: 0,
      errorCode: null,
    });
  });

  it("counts the failures in a row of the kind that fails, whatever the other kind does", () => {
    const runs = [
      run("transactions", "failed", "provider_down"),
      run("accounts", "success"),
      run("transactions", "failed", "invalid_data"),
      run("accounts", "success"),
      run("transactions", "failed", "provider_down"),
      run("accounts", "success"),
      run("transactions", "success"),
      run("transactions", "failed", "provider_down"),
    ];
    expect(failureStreak(runs)).toEqual({ failures: 3, errorCode: "provider_down" });
  });

  it("steps over a provider that asked to wait: neither a failure nor a good reading (Q2)", () => {
    expect(
      failureStreak([
        run("transactions", "failed", "rate_limited"),
        run("transactions", "failed", "rate_limited"),
        run("transactions", "failed", "provider_down"),
      ]),
    ).toEqual({ failures: 1, errorCode: "rate_limited" });
    expect(failureStreak([run("transactions", "failed", "rate_limited")])).toEqual({
      failures: 0,
      errorCode: "rate_limited",
    });
  });

  it("never counts a pass that ended read-only, and sends no mail for it: the state stays on the connection (D5)", () => {
    const runs = [
      run("leave", "failed", "read_only"),
      run("leave", "failed", "read_only"),
      run("leave", "failed", "read_only"),
    ];
    const streak = failureStreak(runs);
    expect(streak).toEqual({ failures: 0, errorCode: "read_only" });
    const facts = {
      ...HEALTHY,
      state: "error" as const,
      consecutiveFailures: streak.failures,
      errorCode: streak.errorCode,
    };
    expect(syncStatus(facts, NOW).text).toBe("readOnly");
    expect(warningFor(syncStatus(facts, NOW), facts, NOW)).toBeNull();
    expect(
      warningFor(
        syncStatus({ ...facts, lastOkAt: ago(72 * 60) }, NOW),
        { ...facts, lastOkAt: ago(72 * 60) },
        NOW,
      ),
    ).toBeNull();
  });

  it("ignores the runs that attempted nothing or have not ended", () => {
    expect(
      failureStreak([
        run("leave", "running"),
        run("leave", "skipped"),
        run("leave", "failed"),
        run("leave", "failed"),
      ]),
    ).toEqual({ failures: 2, errorCode: null });
    expect(failureStreak([])).toEqual({ failures: 0, errorCode: null });
  });
});

describe("times as a person says them (ux §2.3)", () => {
  it.each([
    [0.5, { key: "now" }],
    [5, { key: "minutes", count: 5 }],
    [59, { key: "minutes", count: 59 }],
    [120, { key: "hours", count: 2 }],
    // 13:00 in Rome minus 14 hours is 23:00 of the day before.
    [14 * 60, { key: "yesterday", time: "23:00" }],
    [3 * 24 * 60, { key: "date", date: "2026-11-12", time: "13:00" }],
  ])("%d minutes ago", (minutes, expected) => {
    expect(relativePast(ago(minutes), NOW, ZONE)).toEqual(expected);
  });

  it.each([
    [null, { key: "soon" }],
    [-30, { key: "soon" }],
    [0.5, { key: "soon" }],
    [60, { key: "today", time: "14:00" }],
    [20 * 60, { key: "tomorrow", time: "09:00" }],
    [3 * 24 * 60, { key: "date", date: "2026-11-18", time: "13:00" }],
  ])("in %s minutes", (minutes, expected) => {
    expect(relativeNext(minutes === null ? null : ahead(minutes), NOW, ZONE)).toEqual(expected);
  });
});

describe("the history of a connection (ux §4)", () => {
  const at = (minutes: number) => ago(minutes);
  const one = (
    kind: string,
    state: string,
    startedAt: Date,
    extra: { origin?: string | null; errorCode?: string | null; counts?: Record<string, number> } = {},
  ) => ({
    kind,
    state,
    startedAt,
    origin: extra.origin === undefined ? "auto" : extra.origin,
    errorCode: extra.errorCode ?? null,
    counts: extra.counts ?? null,
  });

  it("makes one reading of the runs of one pass, with what each kind brought", () => {
    const entries = historyOf([
      one("transactions", "success", at(59), { counts: { created: 12, updated: 1, skipped: 40 } }),
      one("accounts", "success", at(60), { counts: { updated: 2 } }),
      one("transactions", "success", at(119), { counts: { created: 0 } }),
      one("accounts", "success", at(120), { counts: { updated: 0 } }),
    ]);
    expect(entries).toEqual([
      {
        at: at(60),
        outcome: "ok",
        errorCode: null,
        manual: false,
        news: [
          { key: "balancesUpdated", count: 2 },
          { key: "movementsNew", count: 12 },
          { key: "movementsUpdated", count: 1 },
        ],
      },
      { at: at(120), outcome: "ok", errorCode: null, manual: false, news: [] },
    ]);
  });

  it("is failed when a kind of the pass failed, with that kind's code and no counts", () => {
    const [entry] = historyOf([
      one("transactions", "failed", at(59), { errorCode: "provider_down" }),
      one("accounts", "success", at(60), { counts: { updated: 2 } }),
    ]);
    expect(entry).toMatchObject({ outcome: "failed", errorCode: "provider_down", news: [] });
  });

  it("shows no code for a failure that has none, or one it does not know", () => {
    expect(historyOf([one("leave", "failed", at(5))])[0]).toMatchObject({
      outcome: "failed",
      errorCode: null,
    });
    expect(
      historyOf([one("leave", "failed", at(5), { errorCode: "a provider's own words" })])[0].errorCode,
    ).toBeNull();
  });

  it("keeps two readings the person started apart, and says they started them", () => {
    const entries = historyOf([
      one("leave", "success", at(1), { origin: "manual", counts: { applied: 3 } }),
      one("leave", "success", at(2), { origin: "manual" }),
      one("leave", "skipped", at(70)),
    ]);
    expect(entries.map((entry) => [entry.outcome, entry.manual])).toEqual([
      ["ok", true],
      ["ok", true],
      ["skipped", false],
    ]);
    expect(entries[0].news).toEqual([{ key: "daysSent", count: 3 }]);
  });

  it("does not join a manual run to an automatic one, nor runs far apart", () => {
    expect(
      historyOf([
        one("transactions", "success", at(1), { origin: "manual" }),
        one("accounts", "success", at(2), { origin: "auto" }),
      ]),
    ).toHaveLength(2);
    expect(
      historyOf([one("transactions", "success", at(1)), one("accounts", "success", at(30))]),
    ).toHaveLength(2);
  });

  it("has a sentence for every kind of news", () => {
    const keys = historyOf([
      one("flows", "success", at(1), { counts: { created: 1 } }),
      one("holdings", "success", at(2), { counts: { created: 1 } }),
      one("leave", "success", at(40), { counts: { applied: 1, adopted: 1 } }),
      one("transactions", "success", at(80), { counts: { created: 1, updated: 1 } }),
      one("accounts", "success", at(81), { counts: { created: 1, updated: 1 } }),
    ]).flatMap((entry) => entry.news.map((news) => news.key));
    expect(keys).toHaveLength(8);
    for (const catalogue of [en, it_]) {
      const news: Record<string, string> = catalogue.settings.connections.history.news;
      for (const key of keys) expect(news[key]).toEqual(expect.any(String));
      expect(Object.keys(news).sort()).toEqual([...keys].sort());
    }
  });

  it("calls a run a reading in progress for an hour, then an orphan", () => {
    expect(isRunningNow({ state: "running", startedAt: ago(59) }, NOW)).toBe(true);
    expect(isRunningNow({ state: "running", startedAt: ago(61) }, NOW)).toBe(false);
    expect(isRunningNow({ state: "success", startedAt: ago(1) }, NOW)).toBe(false);
  });
});

/**
 * Criterion 1 of N2: no technical word in the normal view. The texts of a connection's row, its
 * history and its actions are `settings.connections` without `advanced` (the page where the
 * technical words are allowed, ux §1.2).
 */
describe("the words of the normal view (ux §1.2)", () => {
  const FORBIDDEN = {
    it: [
      "plugin",
      "sync",
      "sincronizzazione",
      "sincronizza",
      "token",
      "sessione",
      "job",
      "run",
      "api",
      "http",
      "429",
      "cron",
      "log",
    ],
    en: [
      "plugin",
      "sync",
      "synchronization",
      "token",
      "session",
      "job",
      "run",
      "api",
      "http",
      "429",
      "cron",
      "log",
    ],
  };

  function texts(node: unknown, path: string): [string, string][] {
    if (typeof node === "string") return [[path, node]];
    return Object.entries(node as Record<string, unknown>).flatMap(([key, value]) =>
      texts(value, path === "" ? key : `${path}.${key}`),
    );
  }

  it.each([
    ["it", it_],
    ["en", en],
  ] as const)("has no technical word in %s", (locale, catalogue) => {
    const normal = Object.fromEntries(
      Object.entries(catalogue.settings.connections).filter(([key]) => key !== "advanced"),
    );
    const found = texts(normal, "").flatMap(([path, text]) => {
      // ICU arguments are names, not words a person reads.
      const words = text
        .replace(/\{[^{}]*?[,}]/g, " ")
        .toLowerCase()
        .split(/[^\p{L}\p{N}]+/u);
      return FORBIDDEN[locale].filter((word) => words.includes(word)).map((word) => `${path}: ${word}`);
    });
    expect(found).toEqual([]);
    for (const code of SYNC_ERROR_CODES) {
      expect(texts(normal, "").filter(([, text]) => text.includes(code))).toEqual([]);
    }
  });
});

describe("the health of a connection (H56)", () => {
  const health = (patch: Partial<StatusFacts>) => {
    const facts = { ...HEALTHY, ...patch };
    return healthOf(syncStatus(facts, NOW), facts);
  };

  it.each<[string, Partial<StatusFacts>, string | null]>([
    ["up to date", {}, "up_to_date"],
    ["a reading in progress", { running: true }, "reading"],
    ["no schedule", { scheduled: false, nextSyncAt: null }, "on_demand"],
    ["a failure with no schedule", { scheduled: false, consecutiveFailures: 1, state: "error" }, "error"],
    [
      "a failure with a schedule",
      { consecutiveFailures: 1, state: "error", errorCode: "provider_down" },
      "error",
    ],
    ["a provider that asked to wait", { errorCode: "rate_limited", state: "error" }, "late"],
    ["a reading that did not come", { nextSyncAt: ago(16) }, "late"],
    ["an access past its end", { expiresAt: ago(1) }, "action_needed"],
    ["a plugin turned off", { providerActive: false }, null],
  ])("%s", (_name, patch, expected) => {
    expect(health(patch)).toBe(expected);
  });

  it("is the worst of the connections' for a plugin, null without any", () => {
    expect(worstHealth(["up_to_date", "late", "reading"])).toBe("late");
    expect(worstHealth(["on_demand", "error", "action_needed"])).toBe("action_needed");
    expect(worstHealth([null, "up_to_date"])).toBe("up_to_date");
    expect(worstHealth([])).toBeNull();
  });

  it("sends no warning for a failure with no schedule: the person started it", () => {
    const facts = { ...HEALTHY, scheduled: false, consecutiveFailures: 5, state: "error" as const };
    expect(warningFor(syncStatus(facts, NOW), facts, NOW)).toBeNull();
  });
});
