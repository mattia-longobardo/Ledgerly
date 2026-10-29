import { createTranslator } from "use-intl/core";
import { describe, expect, it } from "vitest";
import en from "../../../messages/en.json";
import it_ from "../../../messages/it.json";
import {
  type ActivityT,
  describeEvent,
  type DescribedEvent,
  type DescribedLeg,
  familyOf,
  kindsOf,
  quantityText,
} from "./activity";
import { OPERATION_KINDS } from "./rules";

const translator = (locale: "en" | "it"): ActivityT => {
  const t = createTranslator({
    locale,
    messages: locale === "en" ? en : it_,
    namespace: "investments.activity",
  });
  return (key, values) => (t as (key: string, values?: Record<string, string>) => string)(key, values);
};
const FORMATS = { en: "en-US", it: "it-IT" } as const;

const leg = (over: Partial<DescribedLeg>): DescribedLeg => ({
  kind: "deposit",
  assetName: null,
  assetClass: null,
  product: null,
  quantity: null,
  unitPrice: null,
  priceCurrency: null,
  ...over,
});
const event = (
  over: Partial<DescribedLeg>,
  rest: Partial<Omit<DescribedEvent, "leg">> = {},
): DescribedEvent => ({
  leg: leg(over),
  note: null,
  counterpart: null,
  ...rest,
});

const spacex = { assetName: "SpaceX", assetClass: "stock" as const, quantity: "6.870000000000000000" };

/** Every kind of event, with the sentence of §5.2 in English and in Italian. */
const CASES: [string, DescribedEvent, string, string][] = [
  [
    "a buy",
    event({ kind: "buy", ...spacex, unitPrice: "164.620000000000", priceCurrency: "USD" }),
    "Bought 6.87 SpaceX at $164.62",
    "Acquisto 6,87 SpaceX a 164,62 USD",
  ],
  [
    "a sale",
    event({ kind: "sell", ...spacex, unitPrice: "202.94", priceCurrency: "USD" }),
    "Sold 6.87 SpaceX at $202.94",
    "Vendita 6,87 SpaceX a 202,94 USD",
  ],
  [
    "a close, as a sale, of a copied position",
    event({ kind: "close", ...spacex, product: "copy", unitPrice: "199.77", priceCurrency: "USD" }),
    "Sold 6.87 SpaceX at $199.77 (copy)",
    "Vendita 6,87 SpaceX a 199,77 USD (copy)",
  ],
  ["a deposit", event({ kind: "deposit" }), "Deposit", "Versamento"],
  [
    "a deposit from another service",
    event({ kind: "deposit" }, { counterpart: "eToro Money" }),
    "Deposit from eToro Money",
    "Versamento da eToro Money",
  ],
  [
    "a withdrawal to another service",
    event({ kind: "withdrawal" }, { counterpart: "eToro Money" }),
    "Withdrawal to eToro Money",
    "Prelievo verso eToro Money",
  ],
  [
    "a staking reward",
    event({
      kind: "income",
      assetName: "Solana",
      assetClass: "crypto",
      product: "staking",
      quantity: "0.012345678912",
    }),
    "Staking 0.01234568 Solana",
    "Staking 0,01234568 Solana",
  ],
  [
    "an Earn reward",
    event({ kind: "income", assetName: "BNB", assetClass: "crypto", product: "earn", quantity: "2.5" }),
    "Reward 2.5 BNB",
    "Reward 2,5 BNB",
  ],
  [
    "a dividend",
    event({ kind: "income", assetName: "NVIDIA", assetClass: "stock" }),
    "Dividend NVIDIA",
    "Dividendo NVIDIA",
  ],
  ["an income in cash", event({ kind: "income" }), "Income", "Provento"],
  [
    "a fee with its reason and asset",
    event({ kind: "fee", assetName: "NVDA" }, { note: "Overnight" }),
    "Fee Overnight NVDA",
    "Commissione Overnight NVDA",
  ],
  [
    "a correction",
    event({ kind: "adjustment" }, { note: "Missing cash 3–10 March" }),
    "Correction: Missing cash 3–10 March",
    "Correzione: Missing cash 3–10 March",
  ],
  ["the opening cash", event({ kind: "opening_cash" }), "Opening cash", "Cassa iniziale"],
  [
    "an opening position",
    event({ kind: "opening_position", assetName: "IWDA", assetClass: "etf", quantity: "12.123456" }),
    "Opening position 12.1235 IWDA",
    "Posizione iniziale 12,1235 IWDA",
  ],
  [
    "a valuation",
    event({ kind: "valuation", assetName: "BTP 2030", unitPrice: "101.5", priceCurrency: "EUR" }),
    "Valued BTP 2030 at €101.50",
    "Valutazione BTP 2030 a 101,50 €",
  ],
  [
    "an account value",
    event({ kind: "account_valuation" }),
    "Account value updated",
    "Valore del conto aggiornato",
  ],
];

describe("describeEvent (§5.2)", () => {
  it.each(CASES)("writes %s in English and in Italian", (_, input, english, italian) => {
    expect(describeEvent(input, translator("en"), FORMATS.en).sentence).toBe(english);
    expect(describeEvent(input, translator("it"), FORMATS.it).sentence.replace(/ /g, " ")).toBe(italian);
  });

  it("covers every kind of event", () => {
    const kinds = new Set(CASES.map(([, input]) => input.leg.kind));
    expect([...kinds].sort()).toEqual([...OPERATION_KINDS].sort());
  });

  it("never shows a leg's name", () => {
    for (const [, input] of CASES) {
      for (const locale of ["en", "it"] as const) {
        const { sentence } = describeEvent(input, translator(locale), FORMATS[locale]);
        expect(sentence).not.toMatch(/\b(base|quote|main)\b/);
      }
    }
  });

  it("splits the type from the rest of the sentence", () => {
    const sold = describeEvent(
      event({ kind: "sell", ...spacex, unitPrice: "202.94", priceCurrency: "USD" }),
      translator("it"),
      FORMATS.it,
    );
    expect(sold.label).toBe("Vendita");
    expect(sold.detail?.replace(/ /g, " ")).toBe("6,87 SpaceX a 202,94 USD");
  });
});

describe("quantityText", () => {
  it("keeps four decimals, eight for a coin under one unit", () => {
    expect(quantityText("1234.567891", "stock", "en-US")).toBe("1,234.5679");
    expect(quantityText("0.000012345678", "crypto", "en-US")).toBe("0.00001235");
    expect(quantityText("1.000012345678", "crypto", "en-US")).toBe("1");
    expect(quantityText("0.5", "stock", "en-US")).toBe("0.5");
  });
});

describe("families (§3.5)", () => {
  it("put every kind in one chip", () => {
    const all = ["trades", "flows", "income", "fees", "other"].flatMap((family) =>
      kindsOf(family as "trades"),
    );
    expect(all.sort()).toEqual([...OPERATION_KINDS].sort());
    expect(familyOf("close")).toBe("trades");
    expect(familyOf("opening_cash")).toBe("flows");
  });
});
