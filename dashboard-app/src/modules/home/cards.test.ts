import { describe, expect, it } from "vitest";
import { permissionsForRoles } from "@/platform/auth/permissions";
import type { Capabilities } from "@/platform/capabilities/resolve";
import { cardState, HOME_CARDS, isCardVisible, visibleCards, type HomeCard } from "./cards";

function caps(overrides: Partial<Capabilities> = {}): Capabilities {
  return {
    features: {
      accounts: true,
      funds: true,
      budgets: true,
      expenses: false,
      interests: false,
      payroll: false,
      timeoff: false,
    },
    integrations: { wallet: "not_configured", trek: "not_configured", payroll: "not_configured" },
    permissions: permissionsForRoles(["owner"]),
    data: { hasAccounts: false, hasPayrollRecords: false },
    ...overrides,
  };
}

const EXPENSES_CARD: HomeCard = {
  key: "total_balance",
  title: "Expenses",
  href: "/finance/expenses",
  requires: { feature: "expenses" },
};

const WRITE_GATED_CARD: HomeCard = {
  key: "accounts_sync",
  title: "Manage accounts",
  href: "/finance/accounts",
  requires: { permission: "accounts.write" },
};

describe("isCardVisible", () => {
  it("hides a card requiring the expenses feature without wallet connected", () => {
    expect(isCardVisible(EXPENSES_CARD, caps())).toBe(false);
  });

  it("shows the same card once the feature it requires is on", () => {
    const withExpenses = caps({ features: { ...caps().features, expenses: true } });
    expect(isCardVisible(EXPENSES_CARD, withExpenses)).toBe(true);
  });

  it("gates on the integration being connected, not merely configured", () => {
    const card: HomeCard = { ...EXPENSES_CARD, requires: { integration: "wallet" } };
    expect(isCardVisible(card, caps())).toBe(false);
    expect(
      isCardVisible(card, caps({ integrations: { ...caps().integrations, wallet: "error" } })),
    ).toBe(false);
    expect(
      isCardVisible(card, caps({ integrations: { ...caps().integrations, wallet: "connected" } })),
    ).toBe(true);
  });

  it("never hides on a missing permission alone", () => {
    const viewer = caps({ permissions: permissionsForRoles(["viewer"]) });
    expect(isCardVisible(WRITE_GATED_CARD, viewer)).toBe(true);
  });

  it("shows a card with no requirements regardless of capabilities", () => {
    const bare: HomeCard = { ...EXPENSES_CARD, requires: {} };
    expect(isCardVisible(bare, caps())).toBe(true);
  });
});

describe("cardState", () => {
  it("returns permission_denied for a viewer on a card requiring accounts.write", () => {
    const viewer = caps({ permissions: permissionsForRoles(["viewer"]) });
    expect(cardState(WRITE_GATED_CARD, viewer)).toEqual({ state: "permission_denied" });
  });

  it("returns null when the caller holds the required permission", () => {
    const owner = caps({ permissions: permissionsForRoles(["owner"]) });
    expect(cardState(WRITE_GATED_CARD, owner)).toBeNull();
  });

  it("returns null for a card with no permission requirement", () => {
    expect(cardState(HOME_CARDS[0]!, caps())).toBeNull();
  });
});

describe("HOME_CARDS and visibleCards", () => {
  it("defines the four cards with their target sections", () => {
    expect(HOME_CARDS.map((c) => c.key)).toEqual(["total_balance", "accounts_sync", "funds", "leave"]);
    expect(HOME_CARDS.find((c) => c.key === "total_balance")?.href).toBe("/finance/accounts");
    expect(HOME_CARDS.find((c) => c.key === "accounts_sync")?.href).toBe("/settings/integrations");
    expect(HOME_CARDS.find((c) => c.key === "funds")?.href).toBe("/finance/funds");
    expect(HOME_CARDS.find((c) => c.key === "leave")?.href).toBe("/work");
  });

  it("hides accounts_sync until Wallet is connected and leave until timeoff is on", () => {
    const bare = visibleCards(caps());
    expect(bare.map((c) => c.key)).toEqual(["total_balance", "funds"]);

    const full = visibleCards(
      caps({
        features: { ...caps().features, timeoff: true },
        integrations: { ...caps().integrations, wallet: "connected" },
      }),
    );
    expect(full.map((c) => c.key)).toEqual(["total_balance", "accounts_sync", "funds", "leave"]);
  });

  it("keeps every card visible for a viewer: permission gating is cardState's job, not visibleCards'", () => {
    const viewer = caps({
      permissions: permissionsForRoles(["viewer"]),
      features: { ...caps().features, timeoff: true },
      integrations: { ...caps().integrations, wallet: "connected" },
    });
    expect(visibleCards(viewer)).toHaveLength(4);
  });
});

/**
 * The exact scenarios the Home page composes against: which cards
 * `page.tsx` renders, and when a permission gate — as opposed to a
 * feature/integration one — is the reason a card's content is withheld.
 */
describe("Home composition", () => {
  it("accounts_sync is absent when Wallet is not configured", () => {
    const notConfigured = visibleCards(caps({ integrations: { ...caps().integrations, wallet: "not_configured" } }));
    expect(notConfigured.some((c) => c.key === "accounts_sync")).toBe(false);

    const configured = visibleCards(caps({ integrations: { ...caps().integrations, wallet: "connected" } }));
    expect(configured.some((c) => c.key === "accounts_sync")).toBe(true);
  });

  it("leave is absent when the timeoff feature is off", () => {
    const off = visibleCards(caps({ features: { ...caps().features, timeoff: false } }));
    expect(off.some((c) => c.key === "leave")).toBe(false);

    const on = visibleCards(caps({ features: { ...caps().features, timeoff: true } }));
    expect(on.some((c) => c.key === "leave")).toBe(true);
  });

  it("a viewer gets permission_denied only for cards that declare a permission they lack", () => {
    const viewer = caps({
      permissions: permissionsForRoles(["viewer"]),
      features: { ...caps().features, timeoff: true },
      integrations: { ...caps().integrations, wallet: "connected" },
    });

    // None of the real HOME_CARDS declares a `permission` today, so a
    // viewer — who only holds `accounts.read` — is denied none of them.
    for (const card of visibleCards(viewer)) {
      expect(cardState(card, viewer)).toBeNull();
    }

    // A card that DOES declare one a viewer lacks is denied, distinctly
    // from one whose declared permission the viewer does hold.
    const readGated: HomeCard = { ...HOME_CARDS[0]!, requires: { permission: "accounts.read" } };
    const writeGated: HomeCard = { ...HOME_CARDS[0]!, requires: { permission: "accounts.write" } };
    expect(cardState(readGated, viewer)).toBeNull();
    expect(cardState(writeGated, viewer)).toEqual({ state: "permission_denied" });
  });
});
