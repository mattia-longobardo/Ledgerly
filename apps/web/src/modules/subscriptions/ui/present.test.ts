// «Every N weeks or months» and the optional vote (R5a, D4, D5) as the Subscriptions page shows them.
import { createTranslator } from "next-intl";
import { describe, expect, it } from "vitest";
import en from "../../../../../../messages/en.json";
import it_ from "../../../../../../messages/it.json";
import { frequencyText, presentRow } from "./present";

const text = createTranslator({ locale: "en", messages: en, namespace: "subscriptions" });
const testo = createTranslator({ locale: "it", messages: it_, namespace: "subscriptions" });

const ROW = {
  id: "s1",
  name: "Barber",
  state: "active",
  categoryId: null,
  category: null,
  categoryColor: null,
  accountId: null,
  account: null,
  price: "18.00",
  cycle: "custom",
  every: { unit: "week", count: 6 },
  chargeOn: "2026-11-02",
  nextChargeOn: "2026-12-14",
  utility: 5,
  noVote: true,
  payeeMatch: null,
  tolerance: "5.00",
  lastMatch: null,
  current: null,
  monthly: "13.00",
  yearly: "156.00",
} as const;

describe("frequencyText", () => {
  it("says a cycle by its name and «every N» by its count", () => {
    expect(frequencyText({ cycle: "monthly" }, text)).toBe("Monthly");
    expect(frequencyText({ cycle: "custom", every: { unit: "week", count: 6 } }, text)).toBe("Every 6 weeks");
    expect(frequencyText({ cycle: "custom", every: { unit: "month", count: 2 } }, testo)).toBe("Ogni 2 mesi");
  });
});

describe("presentRow", () => {
  it("opens «every 6 weeks» with no vote in the form as it was saved", () => {
    const view = presentRow({ ...ROW }, text, { numberFormat: "it-IT", locale: "en" });
    expect(view.frequency).toBe("Every 6 weeks");
    expect(view.utility).toBeNull();
    expect(view.draft).toMatchObject({ cycle: "custom", every: { unit: "week", count: 6 }, noVote: true });
  });

  it("keeps a vote and a cycle of the list as they are", () => {
    const view = presentRow(
      { ...ROW, cycle: "monthly", every: undefined, noVote: undefined, utility: 7 },
      text,
      {
        numberFormat: "it-IT",
        locale: "en",
      },
    );
    expect(view.frequency).toBe("Monthly");
    expect(view.utility).toBe(7);
    expect(view.draft).toMatchObject({ cycle: "monthly", noVote: false, utility: 7 });
  });
});
