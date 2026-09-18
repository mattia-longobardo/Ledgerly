import { describe, expect, it } from "vitest";
import {
  detectRecurrences,
  displayPayee,
  excludeHidden,
  type IncomingTransaction,
  isHidden,
  isLocallyEdited,
  markLocallyEdited,
  pairTransfers,
  payeeKeyOf,
  normalizeIban,
  type IbanRuleRow,
  planIbanTransfers,
  planProviderMerge,
  planUpstreamRemovals,
  planUserEdit,
  type ProviderResolution,
  type RecurrenceInput,
  resolveType,
  type StoredTransaction,
  toNewTransaction,
  type TransferLeg,
  transferPairKey,
  treeOrder,
  type WindowRow,
} from "./rules";

const ROME = "Europe/Rome";

describe("displayPayee", () => {
  it("trims the provider's payee and turns a blank one into null", () => {
    expect(displayPayee("  Netflix  ")).toBe("Netflix");
    expect(displayPayee("   ")).toBeNull();
    expect(displayPayee(null)).toBeNull();
  });
});

describe("payeeKeyOf", () => {
  it("drops every space and every capital, so one payee has one key", () => {
    expect(payeeKeyOf("Net Flix")).toBe("netflix");
    expect(payeeKeyOf(" NETFLIX\tEUROPE ")).toBe("netflixeurope");
  });

  it("is null for a payee that normalises to nothing: the same answer as a missing one", () => {
    expect(payeeKeyOf("   ")).toBeNull();
    expect(payeeKeyOf("")).toBeNull();
    expect(payeeKeyOf(null)).toBeNull();
  });
});

describe("isHidden", () => {
  const row = (over: Partial<{ hiddenAt: Date | null; removedUpstreamAt: Date | null }> = {}) => ({
    hiddenAt: null,
    removedUpstreamAt: null,
    ...over,
  });

  it("counts a row the user hid", () => {
    expect(isHidden(row({ hiddenAt: new Date("2026-03-01T00:00:00Z") }))).toBe(true);
  });

  it("treats a row the provider stopped returning exactly like a hidden one", () => {
    expect(isHidden(row({ removedUpstreamAt: new Date("2026-03-01T00:00:00Z") }))).toBe(true);
  });

  it("leaves a visible row alone and keeps the order of what it filters", () => {
    const rows = [
      { id: "a", ...row() },
      { id: "b", ...row({ hiddenAt: new Date("2026-03-01T00:00:00Z") }) },
      { id: "c", ...row({ removedUpstreamAt: new Date("2026-03-01T00:00:00Z") }) },
      { id: "d", ...row() },
    ];
    expect(excludeHidden(rows).map((one) => one.id)).toEqual(["a", "d"]);
  });
});

describe("transferPairKey", () => {
  it("is the same key from either leg, because the pair of external ids is ordered", () => {
    expect(transferPairKey("w-2", "w-1")).toBe(transferPairKey("w-1", "w-2"));
  });
});

describe("pairTransfers", () => {
  const leg = (over: Partial<TransferLeg> & Pick<TransferLeg, "id" | "externalId">): TransferLeg => ({
    counterpartExternalId: null,
    transferGroupId: null,
    ...over,
  });

  it("pairs two legs that name each other and gives the group the smallest local id", () => {
    const legs = [
      leg({ id: "t2", externalId: "w-1", counterpartExternalId: "w-2" }),
      leg({ id: "t1", externalId: "w-2", counterpartExternalId: "w-1" }),
    ];
    expect(pairTransfers(legs)).toEqual([
      { id: "t1", transferGroupId: "t1" },
      { id: "t2", transferGroupId: "t1" },
    ]);
  });

  it("does not care which leg arrived first: the group id is the same either way", () => {
    const one = leg({ id: "t2", externalId: "w-1", counterpartExternalId: "w-2" });
    const two = leg({ id: "t1", externalId: "w-2", counterpartExternalId: "w-1" });
    expect(pairTransfers([one, two])).toEqual(pairTransfers([two, one]));
  });

  it("pairs on a reference held by one side only", () => {
    const legs = [
      leg({ id: "t1", externalId: "w-1", counterpartExternalId: "w-2" }),
      leg({ id: "t2", externalId: "w-2" }),
    ];
    expect(pairTransfers(legs)).toEqual([
      { id: "t1", transferGroupId: "t1" },
      { id: "t2", transferGroupId: "t1" },
    ]);
  });

  it("pairs a leg saved in an earlier sync with one that arrives now", () => {
    const stored = leg({ id: "t1", externalId: "w-1", counterpartExternalId: "w-2" });
    const fresh = leg({ id: "t9", externalId: "w-2", counterpartExternalId: "w-1" });
    expect(pairTransfers([stored, fresh])).toEqual([
      { id: "t1", transferGroupId: "t1" },
      { id: "t9", transferGroupId: "t1" },
    ]);
  });

  it("leaves a leg alone while its twin has not been seen yet", () => {
    const legs = [leg({ id: "t1", externalId: "w-1", counterpartExternalId: "w-2" })];
    expect(pairTransfers(legs)).toEqual([]);
  });

  it("never pairs on a matching amount and date: with no reference nothing is a transfer", () => {
    const legs = [leg({ id: "t1", externalId: "w-1" }), leg({ id: "t2", externalId: "w-2" })];
    expect(pairTransfers(legs)).toEqual([]);
  });

  it("ignores a leg that references itself", () => {
    const legs = [leg({ id: "t1", externalId: "w-1", counterpartExternalId: "w-1" })];
    expect(pairTransfers(legs)).toEqual([]);
  });

  it("writes nothing when both legs already carry the right group", () => {
    const legs = [
      leg({ id: "t1", externalId: "w-1", counterpartExternalId: "w-2", transferGroupId: "t1" }),
      leg({ id: "t2", externalId: "w-2", counterpartExternalId: "w-1", transferGroupId: "t1" }),
    ];
    expect(pairTransfers(legs)).toEqual([]);
  });

  it("returns only the leg whose group is wrong", () => {
    const legs = [
      leg({ id: "t1", externalId: "w-1", counterpartExternalId: "w-2", transferGroupId: "t1" }),
      leg({ id: "t2", externalId: "w-2", counterpartExternalId: "w-1" }),
    ];
    expect(pairTransfers(legs)).toEqual([{ id: "t2", transferGroupId: "t1" }]);
  });

  it("decides once for a leg listed twice, as a stored row and as an incoming one", () => {
    const legs = [
      leg({ id: "t1", externalId: "w-1", counterpartExternalId: "w-2" }),
      leg({ id: "t2", externalId: "w-2", counterpartExternalId: "w-1" }),
      leg({ id: "t1", externalId: "w-1", counterpartExternalId: "w-2" }),
    ];
    expect(pairTransfers(legs)).toEqual([
      { id: "t1", transferGroupId: "t1" },
      { id: "t2", transferGroupId: "t1" },
    ]);
  });
});

const incoming = (over: Partial<IncomingTransaction> = {}): IncomingTransaction => ({
  externalId: "w-1",
  counterpartExternalId: null,
  occurredAt: new Date("2026-03-05T10:00:00Z"),
  amountCents: -1299n,
  currency: "EUR",
  type: "expense",
  state: "cleared",
  payee: "Netflix",
  note: null,
  categoryExternalId: "c-1",
  categoryName: "Subscriptions",
  categoryGroupExternalId: null,
  categoryGroupName: null,
  labels: ["fun"],
  ...over,
});

const resolution = (over: Partial<ProviderResolution> = {}): ProviderResolution => ({
  accountId: "a-1",
  categoryId: "cat-1",
  labelIds: ["lab-1"],
  ...over,
});

const stored = (over: Partial<StoredTransaction> = {}): StoredTransaction => ({
  id: "t-1",
  accountId: "a-1",
  occurredAt: new Date("2026-03-05T10:00:00Z"),
  amountCents: -1299n,
  currency: "EUR",
  type: "expense",
  state: "cleared",
  categoryId: "cat-1",
  payee: "Netflix",
  note: null,
  labelIds: ["lab-1"],
  hiddenAt: null,
  removedUpstreamAt: null,
  locallyEdited: [],
  ...over,
});

describe("resolveType", () => {
  it("keeps the provider's word when the sign agrees with it", () => {
    expect(resolveType(incoming({ type: "expense", amountCents: -100n }))).toBe("expense");
    expect(resolveType(incoming({ type: "income", amountCents: 100n }))).toBe("income");
  });

  it("follows the sign when the provider's word contradicts it", () => {
    expect(resolveType(incoming({ type: "income", amountCents: -100n }))).toBe("expense");
    expect(resolveType(incoming({ type: "expense", amountCents: 100n }))).toBe("income");
  });

  it("is a transfer as soon as the provider names a counterpart", () => {
    expect(resolveType(incoming({ type: "expense", counterpartExternalId: "w-2" }))).toBe("transfer");
  });

  it("leaves a documented zero as whatever the provider called it", () => {
    expect(resolveType(incoming({ type: "income", amountCents: 0n }))).toBe("income");
  });
});

describe("toNewTransaction", () => {
  it("takes the amount, the date and the payee from the provider and the rest from the service", () => {
    expect(toNewTransaction(incoming({ payee: " Netflix " }), resolution())).toEqual({
      accountId: "a-1",
      occurredAt: new Date("2026-03-05T10:00:00Z"),
      amountCents: -1299n,
      currency: "EUR",
      type: "expense",
      state: "cleared",
      categoryId: "cat-1",
      payee: "Netflix",
      note: null,
      labelIds: ["lab-1"],
    });
  });
});

describe("planProviderMerge", () => {
  it("writes nothing when the provider repeats what is already stored", () => {
    const plan = planProviderMerge(stored(), incoming(), resolution());
    expect(plan).toEqual({ patch: {}, changed: false, protectedFields: [] });
  });

  it("follows the provider on the payee, the amount and the date", () => {
    const plan = planProviderMerge(
      stored(),
      incoming({
        payee: "Netflix International",
        amountCents: -1399n,
        occurredAt: new Date("2026-03-06T10:00:00Z"),
      }),
      resolution(),
    );
    expect(plan.patch).toEqual({
      payee: "Netflix International",
      amountCents: -1399n,
      occurredAt: new Date("2026-03-06T10:00:00Z"),
    });
    expect(plan.changed).toBe(true);
  });

  it("never overwrites a category the user chose", () => {
    const plan = planProviderMerge(
      stored({ categoryId: "mine", locallyEdited: ["categoryId"] }),
      incoming(),
      resolution({ categoryId: "cat-2" }),
    );
    expect(plan.patch).toEqual({});
    expect(plan.protectedFields).toEqual(["categoryId"]);
  });

  it("never overwrites a note or the labels the user chose", () => {
    const plan = planProviderMerge(
      stored({ note: "mine", labelIds: ["lab-9"], locallyEdited: ["labels", "note"] }),
      incoming({ note: "theirs" }),
      resolution({ labelIds: ["lab-1"] }),
    );
    expect(plan.patch).toEqual({});
    expect(plan.protectedFields).toEqual(["note", "labels"]);
  });

  it("follows the provider on a category and a note the user has not touched", () => {
    const plan = planProviderMerge(
      stored({ categoryId: null, note: null }),
      incoming({ note: "Monthly plan" }),
      resolution({ categoryId: "cat-2" }),
    );
    expect(plan.patch).toEqual({ categoryId: "cat-2", note: "Monthly plan" });
  });

  it("protects even a field the provider owns once it carries the marker", () => {
    const plan = planProviderMerge(
      stored({ locallyEdited: ["amountCents"] }),
      incoming({ amountCents: -9999n }),
      resolution(),
    );
    expect(plan.patch).toEqual({});
    expect(plan.protectedFields).toEqual(["amountCents"]);
  });

  it("reads the labels as a set, so the provider's order is not a change", () => {
    const plan = planProviderMerge(
      stored({ labelIds: ["lab-2", "lab-1"] }),
      incoming(),
      resolution({ labelIds: ["lab-1", "lab-2"] }),
    );
    expect(plan.changed).toBe(false);
  });

  it("writes the labels when the set really differs", () => {
    const plan = planProviderMerge(stored(), incoming(), resolution({ labelIds: ["lab-1", "lab-2"] }));
    expect(plan.patch).toEqual({ labelIds: ["lab-1", "lab-2"] });
  });

  it("corrects the type when the provider's sign contradicts its own word", () => {
    const plan = planProviderMerge(stored({ type: "income" }), incoming({ type: "income" }), resolution());
    expect(plan.patch).toEqual({ type: "expense" });
  });

  it("leaves a hidden row hidden: visibility is not a field a sync writes", () => {
    const plan = planProviderMerge(
      stored({ hiddenAt: new Date("2026-03-06T00:00:00Z") }),
      incoming(),
      resolution(),
    );
    expect(Object.keys(plan.patch)).toEqual([]);
  });
});

describe("planProviderMerge on a giroconto found by IBAN", () => {
  it("keeps a paired leg a transfer when the provider re-sends it as an expense", () => {
    const plan = planProviderMerge(
      stored({ type: "transfer", transferGroupId: "t-1" }),
      incoming({ type: "expense" }),
      resolution(),
    );
    expect(plan.patch.type).toBeUndefined();
  });

  it("still follows the provider for a transfer that is not in a group", () => {
    const plan = planProviderMerge(stored({ type: "transfer" }), incoming({ type: "expense" }), resolution());
    expect(plan.patch.type).toBe("expense");
  });
});

describe("planUserEdit", () => {
  it("marks every field it changes, and only those", () => {
    const plan = planUserEdit(stored(), { categoryId: "cat-2", note: null });
    expect(plan.patch).toEqual({ categoryId: "cat-2" });
    expect(plan.locallyEdited).toEqual(["categoryId"]);
    expect(plan.changed).toBe(true);
  });

  it("claims nothing when the form comes back with the provider's own values", () => {
    const plan = planUserEdit(stored(), { categoryId: "cat-1", note: null, labelIds: ["lab-1"] });
    expect(plan).toEqual({ patch: {}, changed: false, locallyEdited: [] });
  });

  it("marks the labels under the one name the column knows", () => {
    const plan = planUserEdit(stored(), { labelIds: ["lab-2"] });
    expect(plan.patch).toEqual({ labelIds: ["lab-2"] });
    expect(plan.locallyEdited).toEqual(["labels"]);
  });

  it("keeps the markers already there and never repeats one", () => {
    const plan = planUserEdit(stored({ locallyEdited: ["note"] }), { categoryId: "cat-2", note: "kept" });
    expect(plan.locallyEdited).toEqual(["categoryId", "note"]);
  });
});

describe("markLocallyEdited", () => {
  it("is a sorted set, so an unchanged list does not churn", () => {
    expect(markLocallyEdited(["note"], ["categoryId", "note"])).toEqual(["categoryId", "note"]);
    expect(markLocallyEdited(["labels", "categoryId"], [])).toEqual(["categoryId", "labels"]);
  });

  it("answers for one field at a time too", () => {
    expect(isLocallyEdited(["note"], "note")).toBe(true);
    expect(isLocallyEdited(["note"], "payee")).toBe(false);
  });
});

describe("planUpstreamRemovals", () => {
  const window = { from: "2026-03-01", to: "2026-03-08" };
  const row = (over: Partial<WindowRow> & Pick<WindowRow, "id" | "key">): WindowRow => ({
    occurredAt: new Date("2026-03-04T10:00:00Z"),
    removedUpstreamAt: null,
    ...over,
  });

  it("stamps a row inside the window the provider did not return", () => {
    const plan = planUpstreamRemovals([row({ id: "t1", key: "w-1" })], [], window, ROME);
    expect(plan).toEqual({ removed: ["t1"], restored: [] });
  });

  it("leaves a row the provider still returns alone", () => {
    const plan = planUpstreamRemovals([row({ id: "t1", key: "w-1" })], ["w-1"], window, ROME);
    expect(plan).toEqual({ removed: [], restored: [] });
  });

  it("clears the stamp when the provider sends the row again", () => {
    const back = row({
      id: "t1",
      key: "w-1",
      removedUpstreamAt: new Date("2026-03-05T00:00:00Z"),
    });
    expect(planUpstreamRemovals([back], ["w-1"], window, ROME)).toEqual({ removed: [], restored: ["t1"] });
  });

  it("does not stamp a row twice while it stays missing", () => {
    const gone = row({
      id: "t1",
      key: "w-1",
      removedUpstreamAt: new Date("2026-03-05T00:00:00Z"),
    });
    expect(planUpstreamRemovals([gone], [], window, ROME)).toEqual({ removed: [], restored: [] });
  });

  it("says nothing about a row outside the window: it was never asked about", () => {
    const older = row({ id: "t1", key: "w-1", occurredAt: new Date("2026-02-01T10:00:00Z") });
    const newer = row({ id: "t2", key: "w-2", occurredAt: new Date("2026-03-20T10:00:00Z") });
    expect(planUpstreamRemovals([older, newer], [], window, ROME)).toEqual({ removed: [], restored: [] });
  });

  it("places a row on the user's own day, not on the UTC one", () => {
    // 23:30 UTC on the 8th is already the 9th in Rome, which is past the window's last day.
    const late = row({ id: "t1", key: "w-1", occurredAt: new Date("2026-03-08T23:30:00Z") });
    expect(planUpstreamRemovals([late], [], window, ROME)).toEqual({ removed: [], restored: [] });
    expect(planUpstreamRemovals([late], [], window, "UTC")).toEqual({ removed: ["t1"], restored: [] });
  });
});

describe("detectRecurrences", () => {
  const at = (on: string, cents: bigint, over: Partial<RecurrenceInput> = {}): RecurrenceInput => ({
    occurredAt: new Date(`${on}T10:00:00Z`),
    amountCents: cents,
    currency: "EUR",
    payee: "Netflix",
    type: "expense",
    transferGroupId: null,
    hiddenAt: null,
    removedUpstreamAt: null,
    ...over,
  });

  it("finds a monthly charge and expects the next one a mean interval later", () => {
    const rows = [
      at("2026-01-05", -1299n),
      at("2026-02-05", -1299n),
      at("2026-03-05", -1299n),
      at("2026-04-05", -1299n),
    ];
    expect(detectRecurrences(rows, ROME)).toEqual([
      {
        payeeKey: "netflix",
        payee: "Netflix",
        currency: "EUR",
        sign: -1,
        cadence: "monthly",
        intervalDays: 30,
        medianCents: -1299n,
        occurrences: 4,
        lastSeenOn: "2026-04-05",
        nextExpectedOn: "2026-05-05",
      },
    ]);
  });

  it("needs three occurrences: two are a coincidence", () => {
    expect(detectRecurrences([at("2026-01-05", -1299n), at("2026-02-05", -1299n)], ROME)).toEqual([]);
  });

  it("rounds a mean interval that is not a whole number of days half up", () => {
    // 31 and 28 days: a mean of 29.5 becomes 30, and the next date follows the stored interval.
    const rows = [at("2026-01-05", -1299n), at("2026-02-05", -1299n), at("2026-03-05", -1299n)];
    const [pattern] = detectRecurrences(rows, ROME);
    expect(pattern.intervalDays).toBe(30);
    expect(pattern.nextExpectedOn).toBe("2026-04-04");
  });

  it("reads every band, at its own edges", () => {
    const weekly = [at("2026-01-01", -500n), at("2026-01-06", -500n), at("2026-01-15", -500n)];
    expect(detectRecurrences(weekly, ROME)[0].cadence).toBe("weekly");
    const biweekly = [at("2026-01-01", -500n), at("2026-01-13", -500n), at("2026-01-29", -500n)];
    expect(detectRecurrences(biweekly, ROME)[0].cadence).toBe("biweekly");
    const quarterly = [at("2026-01-01", -500n), at("2026-04-01", -500n), at("2026-07-01", -500n)];
    expect(detectRecurrences(quarterly, ROME)[0].cadence).toBe("quarterly");
    const yearly = [at("2024-01-01", -500n), at("2025-01-01", -500n), at("2026-01-01", -500n)];
    expect(detectRecurrences(yearly, ROME)[0].cadence).toBe("yearly");
  });

  it("refuses a gap that falls between two bands", () => {
    const rows = [at("2026-01-01", -500n), at("2026-01-11", -500n), at("2026-01-21", -500n)];
    expect(detectRecurrences(rows, ROME)).toEqual([]);
  });

  it("refuses intervals that do not all land in the same band", () => {
    const rows = [at("2026-01-01", -500n), at("2026-01-08", -500n), at("2026-02-07", -500n)];
    expect(detectRecurrences(rows, ROME)).toEqual([]);
  });

  it("refuses two charges on the same day: a gap of zero is in no band", () => {
    const rows = [at("2026-01-05", -500n), at("2026-01-05", -500n), at("2026-02-05", -500n)];
    expect(detectRecurrences(rows, ROME)).toEqual([]);
  });

  it("accepts an amount exactly ten per cent from the median and refuses the next cent", () => {
    const inside = [at("2026-01-05", -1000n), at("2026-02-05", -1000n), at("2026-03-05", -1100n)];
    expect(detectRecurrences(inside, ROME)[0].medianCents).toBe(-1000n);
    const outside = [at("2026-01-05", -1000n), at("2026-02-05", -1000n), at("2026-03-05", -1101n)];
    expect(detectRecurrences(outside, ROME)).toEqual([]);
  });

  it("takes the two middle amounts when the count is even, rounding the median half up", () => {
    const rows = [
      at("2026-01-05", -1000n),
      at("2026-02-05", -1000n),
      at("2026-03-05", -1101n),
      at("2026-04-05", -1101n),
    ];
    expect(detectRecurrences(rows, ROME)[0].medianCents).toBe(-1051n);
  });

  it("leaves transfers out, by type and by group", () => {
    const byType = [
      at("2026-01-05", -500n, { type: "transfer" }),
      at("2026-02-05", -500n, { type: "transfer" }),
      at("2026-03-05", -500n, { type: "transfer" }),
    ];
    expect(detectRecurrences(byType, ROME)).toEqual([]);
    const byGroup = [
      at("2026-01-05", -500n, { transferGroupId: "t1" }),
      at("2026-02-05", -500n, { transferGroupId: "t1" }),
      at("2026-03-05", -500n, { transferGroupId: "t1" }),
    ];
    expect(detectRecurrences(byGroup, ROME)).toEqual([]);
  });

  it("leaves out a movement with no payee, and one whose payee is only spaces", () => {
    const rows = [
      at("2026-01-05", -500n, { payee: null }),
      at("2026-02-05", -500n, { payee: "   " }),
      at("2026-03-05", -500n, { payee: null }),
    ];
    expect(detectRecurrences(rows, ROME)).toEqual([]);
  });

  it("leaves out what is hidden or gone from the provider, so the pattern falls under three", () => {
    const rows = [
      at("2026-01-05", -500n),
      at("2026-02-05", -500n, { hiddenAt: new Date("2026-02-06T00:00:00Z") }),
      at("2026-03-05", -500n, { removedUpstreamAt: new Date("2026-03-06T00:00:00Z") }),
      at("2026-04-05", -500n),
    ];
    expect(detectRecurrences(rows, ROME)).toEqual([]);
  });

  it("groups a payee whatever its spacing and case", () => {
    const rows = [
      at("2026-01-05", -500n, { payee: "NET FLIX" }),
      at("2026-02-05", -500n),
      at("2026-03-05", -500n, { payee: "netflix " }),
    ];
    const [pattern] = detectRecurrences(rows, ROME);
    expect(pattern.occurrences).toBe(3);
    expect(pattern.payeeKey).toBe("netflix");
    expect(pattern.payee).toBe("netflix");
  });

  it("keeps a credit and a debit under one name as two patterns", () => {
    const rows = [
      at("2026-01-05", -500n),
      at("2026-02-05", -500n),
      at("2026-03-05", -500n),
      at("2026-01-10", 2000n),
      at("2026-02-10", 2000n),
      at("2026-03-10", 2000n),
    ];
    const patterns = detectRecurrences(rows, ROME);
    expect(patterns.map((one) => [one.sign, one.medianCents])).toEqual([
      [-1, -500n],
      [1, 2000n],
    ]);
  });

  it("keeps two currencies under one name as two patterns, sorted deterministically", () => {
    const rows = [
      at("2026-01-05", -500n, { currency: "USD" }),
      at("2026-02-05", -500n, { currency: "USD" }),
      at("2026-03-05", -500n, { currency: "USD" }),
      at("2026-01-06", -500n),
      at("2026-02-06", -500n),
      at("2026-03-06", -500n),
    ];
    expect(detectRecurrences(rows, ROME).map((one) => one.currency)).toEqual(["EUR", "USD"]);
  });

  it("measures the gaps on the user's own days, not on UTC ones", () => {
    const rows = [
      at("2026-01-06", -500n),
      at("2026-02-06", -500n),
      { ...at("2026-03-05", -500n), occurredAt: new Date("2026-03-05T23:30:00Z") },
    ];
    // Half past eleven at night on the 5th in UTC is already the 6th in Rome.
    expect(detectRecurrences(rows, ROME)[0].lastSeenOn).toBe("2026-03-06");
    expect(detectRecurrences(rows, "UTC")[0].lastSeenOn).toBe("2026-03-05");
  });

  it("ignores an amount of zero: it has no sign to group by", () => {
    const rows = [at("2026-01-05", 0n), at("2026-02-05", 0n), at("2026-03-05", 0n)];
    expect(detectRecurrences(rows, ROME)).toEqual([]);
  });
});

describe("treeOrder", () => {
  const row = (id: string, name: string, parentId: string | null = null) => ({ id, name, parentId });

  it("puts each group's sub-categories right after it, keeping the order it was given", () => {
    const rows = [
      row("b", "Books", "f"),
      row("f", "Fun"),
      row("g", "Groceries", "l"),
      row("l", "Living"),
      row("o", "Loose"),
      row("r", "Rent", "l"),
    ];
    expect(treeOrder(rows).map((one) => [one.name, one.depth])).toEqual([
      ["Fun", 0],
      ["Books", 1],
      ["Living", 0],
      ["Groceries", 1],
      ["Rent", 1],
      ["Loose", 0],
    ]);
  });

  it("shows a sub-category whose group is not in the list at the top level, never losing it", () => {
    // An active child of an archived group, when the archived ones are left out.
    expect(treeOrder([row("a", "Apples", "gone"), row("z", "Zoo")])).toEqual([
      { ...row("a", "Apples", "gone"), depth: 0 },
      { ...row("z", "Zoo"), depth: 0 },
    ]);
  });

  it("answers with nothing for nothing", () => {
    expect(treeOrder([])).toEqual([]);
  });
});

// The standard example IBANs of the ISO 13616 documentation: valid check digits, nobody's account.
const IBAN_A = "IT60X0542811101000000123456";
const IBAN_B = "GB82WEST12345698765432";

describe("normalizeIban", () => {
  it("accepts an IBAN written with spaces or in lower case, and returns it compact", () => {
    expect(normalizeIban("it60 x054 2811 1010 0000 0123 456")).toBe(IBAN_A);
    expect(normalizeIban(IBAN_B)).toBe(IBAN_B);
  });

  it("refuses a free-text reference, a wrong check digit and nothing at all", () => {
    expect(normalizeIban("Conto di casa")).toBeNull();
    expect(normalizeIban("IT61X0542811101000000123456")).toBeNull();
    expect(normalizeIban(null)).toBeNull();
  });
});

describe("planIbanTransfers", () => {
  const own = [
    { accountId: "ing", iban: IBAN_A },
    { accountId: "rev", iban: IBAN_B },
  ];
  const row = (over: Partial<IbanRuleRow> & Pick<IbanRuleRow, "id" | "accountId">): IbanRuleRow => ({
    occurredAt: new Date("2026-03-05T10:00:00Z"),
    amountCents: -50_000n,
    currency: "EUR",
    type: "expense",
    transferGroupId: null,
    payee: null,
    note: null,
    ...over,
  });

  it("pairs a leg naming another own account's IBAN with the opposite amount there", () => {
    const rows = [
      row({ id: "t2", accountId: "ing", note: `Bonifico a ${IBAN_B.replace(/(.{4})/g, "$1 ")}` }),
      row({
        id: "t1",
        accountId: "rev",
        amountCents: 50_000n,
        type: "income",
        occurredAt: new Date("2026-03-06T08:00:00Z"),
      }),
    ];
    expect(planIbanTransfers(own, rows)).toEqual([
      { id: "t1", transferGroupId: "t1" },
      { id: "t2", transferGroupId: "t1" },
    ]);
  });

  it("files a leg whose twin is not there as a giroconto of its own", () => {
    expect(planIbanTransfers(own, [row({ id: "t1", accountId: "ing", payee: IBAN_B })])).toEqual([
      { id: "t1", transferGroupId: "t1" },
    ]);
  });

  it("does not pair across more than the clearing days, nor a different amount", () => {
    const rows = [
      row({ id: "t1", accountId: "ing", note: IBAN_B }),
      row({ id: "t2", accountId: "rev", amountCents: 50_000n, occurredAt: new Date("2026-03-20T10:00:00Z") }),
      row({ id: "t3", accountId: "rev", amountCents: 49_999n }),
    ];
    expect(planIbanTransfers(own, rows)).toEqual([{ id: "t1", transferGroupId: "t1" }]);
  });

  it("ignores the account's own IBAN, an unknown one, and every row when no account has an IBAN", () => {
    const rows = [row({ id: "t1", accountId: "ing", note: IBAN_A }), row({ id: "t2", accountId: "ing" })];
    expect(planIbanTransfers(own, rows)).toEqual([]);
    expect(planIbanTransfers([], [row({ id: "t3", accountId: "ing", note: IBAN_B })])).toEqual([]);
  });

  it("never takes a pair apart, and a second run changes nothing", () => {
    const rows = [
      row({ id: "t1", accountId: "ing", note: IBAN_B, type: "transfer", transferGroupId: "t1" }),
      row({ id: "t2", accountId: "rev", amountCents: 50_000n, type: "transfer", transferGroupId: "t1" }),
      // Same amount and day, but t1 is already in a pair.
      row({ id: "t3", accountId: "rev", amountCents: 50_000n }),
    ];
    expect(planIbanTransfers(own, rows)).toEqual([]);
  });

  it("pairs a lone leg once its twin arrives", () => {
    const rows = [
      row({ id: "t5", accountId: "ing", note: IBAN_B, type: "transfer", transferGroupId: "t5" }),
      row({ id: "t7", accountId: "rev", amountCents: 50_000n, type: "income" }),
    ];
    expect(planIbanTransfers(own, rows)).toEqual([{ id: "t7", transferGroupId: "t5" }]);
  });

  it("prefers the twin that names this account back", () => {
    const rows = [
      row({ id: "t1", accountId: "ing", note: IBAN_B }),
      row({ id: "t2", accountId: "rev", amountCents: 50_000n }),
      row({ id: "t3", accountId: "rev", amountCents: 50_000n, note: `da ${IBAN_A}` }),
    ];
    const plan = planIbanTransfers(own, rows);
    expect(plan).toContainEqual({ id: "t3", transferGroupId: "t1" });
    expect(plan.some((one) => one.id === "t2")).toBe(false);
  });
});
