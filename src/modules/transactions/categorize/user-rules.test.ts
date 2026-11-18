import { describe, expect, it } from "vitest";
import {
  conditionMatches,
  firstMatch,
  type RuleCondition,
  type RuleFacts,
  ruleInputSchema,
  type RuleMovement,
  ruleMatches,
} from "./user-rules";

const ACCOUNT = "00000000-0000-4000-8000-000000000001";
const OTHER = "00000000-0000-4000-8000-000000000002";
const CATEGORY = "00000000-0000-4000-8000-0000000000c1";
const IBAN = "IT60X0542811101000000123456";

const movement = (over: Partial<RuleMovement> = {}): RuleMovement => ({
  payee: "Ricarica Carta Prepagata",
  note: null,
  rawText: "PAGAMENTO ACME S.r.l. càrta",
  counterparty: null,
  amountCents: -5_000n,
  currency: "EUR",
  accountId: ACCOUNT,
  manual: false,
  ...over,
});
const facts: RuleFacts = { ownIbans: [{ accountId: OTHER, iban: IBAN }] };
const matches = (condition: RuleCondition, over: Partial<RuleMovement> = {}) =>
  conditionMatches(condition, movement(over), facts);

describe("conditionMatches", () => {
  it("text: contains, without case or accents, on payee, note and the bank's text", () => {
    expect(matches({ field: "text", op: "contains", value: "RICARICA" })).toBe(true);
    expect(matches({ field: "text", op: "contains", value: "carta" })).toBe(true);
    expect(matches({ field: "text", op: "contains", value: "acme srl" })).toBe(true);
    expect(matches({ field: "text", op: "contains", value: "acme s.r.l." })).toBe(true);
    expect(matches({ field: "text", op: "contains", value: "affitto" })).toBe(false);
    expect(matches({ field: "text", op: "contains", value: "cena" }, { note: "Cena con amici" })).toBe(true);
  });

  it("text: does not contain, is, starts with", () => {
    expect(matches({ field: "text", op: "notContains", value: "affitto" })).toBe(true);
    expect(matches({ field: "text", op: "notContains", value: "ricarica" })).toBe(false);
    expect(matches({ field: "text", op: "equals", value: "ricarica carta prepagata" })).toBe(true);
    expect(matches({ field: "text", op: "equals", value: "ricarica" })).toBe(false);
    expect(matches({ field: "text", op: "startsWith", value: "Ricarica" })).toBe(true);
    expect(matches({ field: "text", op: "startsWith", value: "carta" })).toBe(false);
  });

  it("counterparty: its name, else the payee", () => {
    expect(matches({ field: "counterparty", op: "equals", value: "acme" }, { counterparty: "ACME" })).toBe(
      true,
    );
    expect(
      matches({ field: "counterparty", op: "contains", value: "acme" }, { counterparty: "Acme Spa" }),
    ).toBe(true);
    expect(matches({ field: "counterparty", op: "contains", value: "prepagata" })).toBe(true);
    expect(
      matches({ field: "counterparty", op: "contains", value: "x" }, { counterparty: null, payee: null }),
    ).toBe(false);
  });

  it("own account: an IBAN of another account of the person in the text", () => {
    const own: RuleCondition = { field: "ownAccount" };
    expect(matches(own, { rawText: "Bonifico a IT60 X054 2811 1010 0000 0123 456" })).toBe(true);
    expect(matches(own)).toBe(false);
    // The account's own IBAN is not a counterparty.
    expect(matches(own, { accountId: OTHER, rawText: IBAN })).toBe(false);
  });

  it("amount: the size, whatever the sign", () => {
    expect(matches({ field: "amount", op: "gt", cents: 4_999 })).toBe(true);
    expect(matches({ field: "amount", op: "gt", cents: 5_000 })).toBe(false);
    expect(matches({ field: "amount", op: "lt", cents: 5_001 })).toBe(true);
    expect(matches({ field: "amount", op: "equals", cents: 5_000 })).toBe(true);
    expect(matches({ field: "amount", op: "between", cents: 5_000, toCents: 6_000 })).toBe(true);
    expect(matches({ field: "amount", op: "between", cents: 1_000, toCents: 4_999 })).toBe(false);
  });

  it("direction, account, source, currency", () => {
    expect(matches({ field: "direction", value: "out" })).toBe(true);
    expect(matches({ field: "direction", value: "in" })).toBe(false);
    expect(matches({ field: "direction", value: "in" }, { amountCents: 1n })).toBe(true);
    expect(matches({ field: "account", accountIds: [OTHER, ACCOUNT] })).toBe(true);
    expect(matches({ field: "account", accountIds: [OTHER] })).toBe(false);
    expect(matches({ field: "source", value: "bank" })).toBe(true);
    expect(matches({ field: "source", value: "manual" }, { manual: true })).toBe(true);
    expect(matches({ field: "source", value: "bank" }, { manual: true })).toBe(false);
    expect(matches({ field: "currency", value: "EUR" })).toBe(true);
    expect(matches({ field: "currency", value: "USD" })).toBe(false);
  });
});

describe("ruleMatches and firstMatch", () => {
  const rule = (id: string, conditions: RuleCondition[], active = true) => ({ id, active, conditions });

  it("needs every condition", () => {
    const both = rule("a", [
      { field: "text", op: "contains", value: "ricarica" },
      { field: "direction", value: "in" },
    ]);
    expect(ruleMatches(both, movement(), facts)).toBe(false);
    expect(ruleMatches(both, movement({ amountCents: 100n }), facts)).toBe(true);
    expect(ruleMatches(rule("none", []), movement(), facts)).toBe(false);
  });

  it("the first rule that matches decides; an inactive one is skipped (QC5)", () => {
    const amazon = movement({ payee: "Amazon", rawText: null, amountCents: -60_000n });
    const rules = [
      rule("off", [{ field: "text", op: "contains", value: "amazon" }], false),
      rule("shopping", [{ field: "text", op: "contains", value: "amazon" }]),
      rule("home", [{ field: "amount", op: "gt", cents: 50_000 }]),
    ];
    expect(firstMatch(rules, amazon, facts)?.id).toBe("shopping");
    expect(firstMatch([rules[2], rules[1]], amazon, facts)?.id).toBe("home");
    expect(firstMatch(rules, movement({ payee: "Bar", rawText: null }), facts)).toBeNull();
  });
});

describe("ruleInputSchema", () => {
  const base = {
    name: " Ricarica ",
    conditions: [{ field: "text", op: "contains", value: "ricarica" }],
    categoryId: CATEGORY,
  };

  it("reads a rule, with its defaults", () => {
    expect(ruleInputSchema.parse(base)).toEqual({
      name: "Ricarica",
      active: true,
      conditions: base.conditions,
      categoryId: CATEGORY,
      labelIds: [],
      note: null,
    });
  });

  it("refuses no condition, more than 8, a field twice, four texts, a wrong range", () => {
    const text = { field: "text", op: "contains", value: "x" };
    const refused = [
      { ...base, conditions: [] },
      { ...base, conditions: Array.from({ length: 9 }, () => text) },
      {
        ...base,
        conditions: [
          { field: "direction", value: "in" },
          { field: "direction", value: "out" },
        ],
      },
      { ...base, conditions: [text, text, text, text] },
      { ...base, conditions: [{ field: "amount", op: "between", cents: 10, toCents: 5 }] },
      { ...base, conditions: [{ field: "amount", op: "between", cents: 10 }] },
      { ...base, name: "  " },
      { ...base, note: "x".repeat(201) },
    ];
    for (const input of refused) expect(ruleInputSchema.safeParse(input).success).toBe(false);
    expect(ruleInputSchema.safeParse({ ...base, conditions: [text, text, text] }).success).toBe(true);
  });
});
