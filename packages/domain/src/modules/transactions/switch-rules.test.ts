import { describe, expect, it } from "vitest";
import { addDays, type CivilDate } from "../../shared/dates";
import {
  compareSources,
  comparisonFrom,
  isDoubleOf,
  matchDoubles,
  planTransfers,
  type SwitchMovement,
  type TransferCandidate,
  textScore,
} from "./switch-rules";

/** A small deterministic generator: the same scenario at every run. */
function random(seed: number): () => number {
  let state = seed;
  return () => {
    state = (state * 1_103_515_245 + 12_345) % 2_147_483_648;
    return state / 2_147_483_648;
  };
}

const PAYEES = [
  "MENSA AZIENDALE",
  "SUPERMERCATO CENTRO",
  "FARMACIA SAN MARCO",
  "BAR STAZIONE",
  "LIBRERIA",
  "CARBURANTE",
];

interface Scenario {
  local: SwitchMovement[];
  bank: SwitchMovement[];
  /** The bank's id of each local movement, when the bank has it. */
  truth: Map<string, string>;
}

/**
 * The spike's scenarios (03-releases.md N4): the source and the bank list the same movements, the
 * bank books each one up to `maxShift` days later, and a share of the movements is on one side only.
 * Some amounts repeat, as a canteen's do.
 */
function scenario(seed: number, count: number, maxShift: number, missingShare: number): Scenario {
  const next = random(seed);
  const local: SwitchMovement[] = [];
  const bank: SwitchMovement[] = [];
  const truth = new Map<string, string>();
  const start: CivilDate = "2026-10-01";
  for (let at = 0; at < count; at += 1) {
    const day = addDays(start, Math.floor(next() * 30));
    const payee = PAYEES[Math.floor(next() * PAYEES.length)];
    // A few amounts on purpose: several movements share one.
    const amountCents = -BigInt(100 * (1 + Math.floor(next() * 12)));
    const id = `l-${at}`;
    const bankId = `b-${at}`;
    const fate = next();
    if (fate < missingShare / 2) {
      local.push({ id, day, amountCents, text: payee });
      continue;
    }
    if (fate < missingShare) {
      bank.push({ id: bankId, day, amountCents, text: `POS ${payee}` });
      continue;
    }
    local.push({ id, day, amountCents, text: payee });
    bank.push({
      id: bankId,
      day: addDays(day, Math.floor(next() * (maxShift + 1))),
      amountCents,
      text: `POS ${payee}`,
    });
    truth.set(id, bankId);
  }
  return { local, bank, truth };
}

/** What the criteria of N4 ask of any comparison, on any data. */
function holdsTheRules({ local, bank, truth }: Scenario) {
  const result = compareSources(local, bank);
  const amountOf = new Map([...local, ...bank].map((one) => [one.id, one.amountCents]));
  const count = (list: SwitchMovement[], amount: bigint) =>
    list.filter((one) => one.amountCents === amount).length;

  // Criterion 2: no bank movement is tied in a group whose counts differ.
  for (const match of result.matched) {
    const amount = amountOf.get(match.localId)!;
    expect(amountOf.get(match.bankId)).toBe(amount);
    expect(count(local, amount)).toBe(count(bank, amount));
  }
  // Every movement is in exactly one place of the report.
  const placed = [
    ...result.matched.flatMap((one) => [one.localId, one.bankId]),
    ...result.toCheck.flatMap((one) => [...one.localIds, ...one.bankIds]),
    ...result.onlyLocal,
    ...result.onlyBank,
  ];
  expect(new Set(placed).size).toBe(placed.length);
  expect(placed.length).toBe(local.length + bank.length);
  // A tied movement is tied to a movement of the same amount, and no group is tied twice.
  const right = result.matched.filter((one) => truth.get(one.localId) === one.bankId).length;
  return { result, right };
}

describe("compareSources (rule M1 corrected, the three scenarios of the spike)", () => {
  it("ties every movement when the two sides have the same day and the same movements", () => {
    const data = scenario(1, 120, 0, 0);
    const { result } = holdsTheRules(data);
    expect(result.toCheck).toEqual([]);
    expect(result.onlyLocal).toEqual([]);
    expect(result.onlyBank).toEqual([]);
    expect(result.matched).toHaveLength(data.truth.size);
  });

  it("with 0-3 days and 3% of differences, ties no group whose counts differ", () => {
    const data = scenario(7, 200, 3, 0.03);
    const { result } = holdsTheRules(data);
    expect(result.toCheck.length + result.onlyLocal.length + result.onlyBank.length).toBeGreaterThan(0);
    expect(result.matched.length).toBeGreaterThan(0);
  });

  it("with 0-5 days and 5% of differences, ties no group whose counts differ", () => {
    const data = scenario(42, 200, 5, 0.05);
    const { result } = holdsTheRules(data);
    expect(result.toCheck.length + result.onlyLocal.length + result.onlyBank.length).toBeGreaterThan(0);
    expect(result.matched.length).toBeGreaterThan(0);
  });

  it("puts a group with more movements on one side in To check, whole, and ties none of it", () => {
    const local: SwitchMovement[] = [
      { id: "l1", day: "2026-11-06", amountCents: -1200n, text: "Mensa" },
      { id: "l2", day: "2026-11-07", amountCents: -1200n, text: "Mensa" },
      { id: "l3", day: "2026-11-10", amountCents: -1200n, text: "Mensa" },
    ];
    const bank: SwitchMovement[] = [
      { id: "b1", day: "2026-11-06", amountCents: -1200n, text: "POS MENSA AZIENDALE" },
      { id: "b2", day: "2026-11-10", amountCents: -1200n, text: "POS MENSA AZIENDALE" },
    ];
    expect(compareSources(local, bank)).toEqual({
      matched: [],
      toCheck: [{ amountCents: -1200n, localIds: ["l1", "l2", "l3"], bankIds: ["b1", "b2"] }],
      onlyLocal: [],
      onlyBank: [],
    });
  });

  it("prefers the text, then the nearest day, inside a group of the same count", () => {
    const local: SwitchMovement[] = [
      { id: "l1", day: "2026-11-02", amountCents: -500n, text: "Farmacia" },
      { id: "l2", day: "2026-11-02", amountCents: -500n, text: "Libreria" },
    ];
    const bank: SwitchMovement[] = [
      { id: "b1", day: "2026-11-03", amountCents: -500n, text: "POS LIBRERIA" },
      { id: "b2", day: "2026-11-04", amountCents: -500n, text: "POS FARMACIA" },
    ];
    expect(compareSources(local, bank).matched).toEqual([
      { localId: "l1", bankId: "b2" },
      { localId: "l2", bankId: "b1" },
    ]);
  });

  it("sends a group to To check when a movement finds none inside the window", () => {
    const local: SwitchMovement[] = [{ id: "l1", day: "2026-11-01", amountCents: -500n, text: "x" }];
    const bank: SwitchMovement[] = [{ id: "b1", day: "2026-11-09", amountCents: -500n, text: "x" }];
    expect(compareSources(local, bank).toCheck).toHaveLength(1);
  });

  it("reads from ten days before the last day of the source", () => {
    expect(comparisonFrom("2026-11-14")).toBe("2026-11-04");
  });

  it("scores the words two texts share", () => {
    expect(textScore("Mensa", "POS MENSA AZIENDALE")).toBe(1);
    expect(textScore("Bar", "Edicola")).toBe(0);
    expect(textScore("", "x")).toBe(0);
  });
});

const move = (
  id: string,
  accountId: string,
  day: CivilDate,
  amount: bigint,
  currency = "EUR",
): TransferCandidate => ({
  id,
  accountId,
  day,
  amountCents: amount,
  currency,
});

describe("planTransfers (decision H40, 04-now.md §4.6.1 point 9)", () => {
  it("joins a money out and a money in of the same amount between the account and another of the bank", () => {
    const plan = planTransfers(
      "current",
      ["savings"],
      [
        move("o1", "current", "2025-03-05", -50_000n),
        move("i1", "savings", "2025-03-06", 50_000n),
        move("o2", "savings", "2026-02-02", -20_000n),
        move("i2", "current", "2026-02-02", 20_000n),
      ],
    );
    expect(plan.pairs).toEqual([
      {
        outId: "o2",
        inId: "i2",
        fromAccountId: "savings",
        toAccountId: "current",
        outDay: "2026-02-02",
        inDay: "2026-02-02",
        amountCents: 20_000n,
        currency: "EUR",
      },
      {
        outId: "o1",
        inId: "i1",
        fromAccountId: "current",
        toAccountId: "savings",
        outDay: "2025-03-05",
        inDay: "2025-03-06",
        amountCents: 50_000n,
        currency: "EUR",
      },
    ]);
    expect(plan.byYear).toEqual([
      { year: 2026, count: 1, amountCents: 20_000n },
      { year: 2025, count: 1, amountCents: 50_000n },
    ]);
    expect(plan.ambiguous).toBe(0);
  });

  it("makes no pair from two equal moves of a day against one: the counts differ", () => {
    const plan = planTransfers(
      "current",
      ["savings"],
      [
        move("o1", "current", "2026-03-05", -50_000n),
        move("o2", "current", "2026-03-05", -50_000n),
        move("i1", "savings", "2026-03-05", 50_000n),
      ],
    );
    expect(plan.pairs).toEqual([]);
    expect(plan.ambiguous).toBe(1);
  });

  it("pairs two equal moves of a day when both sides have two, in order", () => {
    const plan = planTransfers(
      "current",
      ["savings"],
      [
        move("o1", "current", "2026-03-05", -50_000n),
        move("o2", "current", "2026-03-05", -50_000n),
        move("i1", "savings", "2026-03-05", 50_000n),
        move("i2", "savings", "2026-03-06", 50_000n),
      ],
    );
    expect(plan.pairs.map((pair) => [pair.outId, pair.inId])).toEqual([
      ["o1", "i1"],
      ["o2", "i2"],
    ]);
  });

  it("joins nothing across currencies, beyond five days, or between two accounts that are not the switched one", () => {
    const plan = planTransfers(
      "current",
      ["savings", "deposit"],
      [
        move("o1", "current", "2026-03-05", -50_000n, "EUR"),
        move("i1", "savings", "2026-03-05", 50_000n, "USD"),
        move("o2", "current", "2026-04-01", -10_000n),
        move("i2", "savings", "2026-04-07", 10_000n),
        move("o3", "savings", "2026-05-01", -7_000n),
        move("i3", "deposit", "2026-05-01", 7_000n),
        move("o4", "current", "2026-06-01", -9_000n),
        move("i4", "elsewhere", "2026-06-01", 9_000n),
      ],
    );
    expect(plan.pairs).toEqual([]);
    expect(plan.ambiguous).toBe(0);
  });

  it("leaves a whole group alone when its order in time cannot pair it inside the window", () => {
    const plan = planTransfers(
      "current",
      ["savings"],
      [
        move("o1", "current", "2026-03-01", -1_000n),
        move("o2", "current", "2026-03-06", -1_000n),
        move("i1", "savings", "2026-03-06", 1_000n),
        move("i2", "savings", "2026-03-11", 1_000n),
      ],
    );
    // o1-i1 (5 days) and o2-i2 (5 days) are inside the window: one group, paired in order.
    expect(plan.pairs).toHaveLength(2);
    const far = planTransfers(
      "current",
      ["savings"],
      [
        move("o1", "current", "2026-03-01", -1_000n),
        move("o2", "current", "2026-03-11", -1_000n),
        move("i1", "savings", "2026-03-06", 1_000n),
        move("i2", "savings", "2026-03-07", 1_000n),
      ],
    );
    // Sorted by day: o1-i1 is 5 days, o2-i2 is 4 days back; all joined, both pairs inside.
    expect(far.pairs).toHaveLength(2);
  });
});

describe("matchDoubles", () => {
  const m = (id: string, day: string, cents: bigint, text = ""): SwitchMovement => ({
    id,
    day: day as SwitchMovement["day"],
    amountCents: cents,
    text,
  });

  it("ties every double to a movement kept, and lets the kept account have more", () => {
    const doubles = [m("d1", "2026-11-03", -500n, "POS BAR"), m("d2", "2026-11-05", 1000n)];
    const kept = [
      m("k1", "2026-11-02", -500n, "Bar"),
      m("k2", "2026-10-01", -500n, "Bar"),
      m("k3", "2026-11-05", 1000n),
      m("k4", "2026-11-06", -250n),
    ];
    expect(matchDoubles(doubles, kept)).toEqual({
      matched: [
        { doubleId: "d1", keptId: "k1" },
        { doubleId: "d2", keptId: "k3" },
      ],
      unmatched: [],
    });
  });

  it("ties no double of a group with more doubles than movements kept", () => {
    const doubles = [m("d1", "2026-11-03", -500n), m("d2", "2026-11-04", -500n)];
    const kept = [m("k1", "2026-11-03", -500n)];
    expect(matchDoubles(doubles, kept)).toEqual({ matched: [], unmatched: ["d1", "d2"] });
  });

  it("ties no double of a group when one finds nothing inside the window", () => {
    const doubles = [m("d1", "2026-11-03", -500n), m("d2", "2026-11-20", -500n)];
    const kept = [m("k1", "2026-11-03", -500n), m("k2", "2026-10-01", -500n)];
    expect(matchDoubles(doubles, kept).unmatched).toEqual(["d1", "d2"]);
  });

  it("never ties two doubles to the same movement kept", () => {
    const doubles = [m("d1", "2026-11-03", -500n), m("d2", "2026-11-03", -500n)];
    const kept = [m("k1", "2026-11-03", -500n), m("k2", "2026-11-04", -500n)];
    const kepts = matchDoubles(doubles, kept).matched.map((pair) => pair.keptId);
    expect(new Set(kepts).size).toBe(2);
  });
});

describe("isDoubleOf", () => {
  it("is a double when every movement has its twin and none was written by hand", () => {
    expect(isDoubleOf({ movements: 3, manual: 0 }, { unmatched: [] })).toBe(true);
  });

  it("is not a double with a movement left alone, a movement by hand or no movement", () => {
    expect(isDoubleOf({ movements: 3, manual: 0 }, { unmatched: ["d1"] })).toBe(false);
    expect(isDoubleOf({ movements: 3, manual: 1 }, { unmatched: [] })).toBe(false);
    expect(isDoubleOf({ movements: 0, manual: 0 }, { unmatched: [] })).toBe(false);
  });
});
