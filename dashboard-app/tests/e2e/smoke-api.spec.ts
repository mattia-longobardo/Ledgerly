/**
 * REST smoke against a running instance, authenticated with a personal access
 * token. This is the one end-to-end proof that the deployed application serves
 * its own API: the modules are exercised through `/api/v1`, not through the
 * pages, because the sign-in path goes through Authentik and cannot be driven
 * from here (see `README.md`).
 *
 * It is deliberately small. Every request counts against the caller's own
 * per-principal rate window (300/min), and the point is "the deployment
 * answers", not "the domain is correct" — that is what the integration suite
 * is for.
 *
 * It WRITES: a manual account, a budget with one allocation, a fund with one
 * contribution and one booked day (removed again). Run it against a throwaway
 * database, never against production.
 */

import { expect, test } from "@playwright/test";
import { apiClient, E2E_TOKEN, isoDate, nextMonday, TOKEN_MISSING_MESSAGE, unique } from "./api-client";

interface Identified { id: string }

test.describe("API smoke over a personal access token", () => {
  test.skip(E2E_TOKEN === "", TOKEN_MISSING_MESSAGE);

  test("accounts, budgets, funds and time off answer over Bearer auth", async ({ request }) => {
    const api = apiClient(request);
    const today = isoDate(new Date());
    // Funds address a month as the first day of it, not `YYYY-MM`.
    const month = `${today.slice(0, 7)}-01`;

    // --- accounts -------------------------------------------------------
    await api.expectStatus(await api.get("/accounts"), 200);

    const account = await api.expectJson<Identified>(
      await api.post("/accounts", {
        name: unique("E2E smoke account"),
        type: "checking",
        currency: "EUR",
        openingBalance: { asOf: today, balance: "1500.00" },
      }),
      201,
    );

    const before = await api.expectJson<{ latest: { balance: string } | null }>(
      await api.get(`/accounts/${account.id}`),
      200,
    );
    expect(before.latest?.balance).toBe("1500.00");

    // --- budgets: an allocation is virtual and never moves real money ----
    const budget = await api.expectJson<Identified>(
      await api.post("/budgets", {
        name: unique("E2E smoke budget"),
        description: null,
        currency: "EUR",
        periodKind: "none",
        startDate: today,
        endDate: null,
        goalAmount: null,
        labels: [],
        initialAmount: "1000.00",
      }),
      201,
    );

    await api.expectStatus(
      await api.post(`/budgets/${budget.id}/allocations`, {
        sourceKind: "account",
        sourceId: account.id,
        amount: "200.00",
        recurrence: "once",
        effectiveFrom: today,
      }),
      201,
    );

    const after = await api.expectJson<{ latest: { balance: string } | null }>(
      await api.get(`/accounts/${account.id}`),
      200,
    );
    expect(after.latest?.balance).toBe("1500.00");

    // --- funds ----------------------------------------------------------
    const fund = await api.expectJson<Identified>(
      await api.post("/funds", { slug: unique("e2e-smoke"), name: "E2E smoke fund", kind: "savings" }),
      201,
    );

    await api.expectStatus(
      await api.post(`/funds/${fund.id}/contributions`, {
        typeCode: "voluntary",
        accrualMonth: month,
        amount: "50.00",
      }),
      201,
    );

    // --- time off -------------------------------------------------------
    const workspace = await api.expectJson<{ year: number; types: unknown[] }>(
      await api.get("/timeoff/workspace"),
      200,
    );
    expect(workspace.types.length).toBeGreaterThan(0);

    const day = nextMonday();
    await api.expectStatus(
      await api.put(`/timeoff/events/${day}`, { fraction: "1.00", typeCode: "vacation", note: "e2e smoke" }),
      200,
    );

    const booked = await api.expectJson<{ byDate: Record<string, unknown> }>(
      await api.get("/timeoff/workspace", { year: Number(day.slice(0, 4)) }),
      200,
    );
    expect(booked.byDate[day]).toBeTruthy();

    await api.expectStatus(await api.del(`/timeoff/events/${day}`), 204);
  });
});
