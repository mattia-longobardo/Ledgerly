// What the daily alerts job of §10.2 sends, and what it deliberately does not: §10.4 has one
// "sync failed or out of date" condition, and the connection reports it
// (`modules/transactions/jobs.ts`), not one email per account of the same dead link.
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import type { Ctx } from "@/platform/context";
import { WALLET_PROVIDER } from "@/platform/integrations/rules";
import { closeDatabase, resetDatabase } from "../../../test/db";
import { clearMailbox, hasMail, waitForMail } from "../../../test/mailpit";
import { createTestUser } from "../../../test/users";
import { accountAlertsJob } from "./jobs";
import { accountsView } from "./queries";
import type { RemoteAccount } from "./rules";
import { applyProviderAccounts, createAccount, saveBalanceEntry, updateAccountSettings } from "./service";

const REMOTE: RemoteAccount = {
  provider: WALLET_PROVIDER,
  providerAccountId: "w-acc-1",
  name: "Revolut",
  type: "checking",
  currency: "EUR",
};

const daysAgo = (n: number) => new Date(Date.now() - n * 24 * 60 * 60 * 1000);

let ctx: Ctx;
let email: string;

describe("accountAlertsJob", () => {
  beforeEach(async () => {
    await resetDatabase();
    await clearMailbox();
    const person = await createTestUser();
    email = person.email;
    ctx = { userId: person.id, role: "user", locale: "en", timeZone: "Europe/Rome", numberFormat: "it-IT" };
  });
  afterAll(closeDatabase);

  it("emails a balance under its own threshold (spec §7.1, §10.4)", async () => {
    const account = await createAccount(ctx, {
      name: "Conto corrente",
      type: "checking",
      openingBalance: null,
    });
    await updateAccountSettings(ctx, account.id, {
      name: "Conto corrente",
      type: "checking",
      currency: "EUR",
      groupId: null,
      color: null,
      reference: "",
      purpose: "",
      openedOn: null,
      notes: "",
      inNetWorth: true,
      inSnapshot: true,
      countsAsLiquid: true,
      lowBalanceCents: 50_000n,
      staleAfterHours: 36,
      reminder: "never",
      betweenEntries: "hold",
    });
    await saveBalanceEntry(ctx, account.id, { on: "2026-01-10", cents: 1_000n, note: "" });

    expect(await accountAlertsJob.run()).toMatchObject({ users: 1, failed: 0, sent: 1 });
    expect((await waitForMail(email)).Subject).toContain("below its threshold");
  });

  // The account still shows "stale sync" in the interface — §7.1 wants it there — and sends no
  // email: one dead token would otherwise be one email per account, and an account the provider
  // stopped returning (`unavailable`, never deleted) would be one a week for ever.
  it("raises a stale sync as an alert and mails nobody about it", async () => {
    await applyProviderAccounts(ctx, WALLET_PROVIDER, [REMOTE], daysAgo(3));

    const view = await accountsView(ctx);
    expect(view.alerts.map((alert) => alert.kind)).toEqual(["stale_sync"]);

    expect(await accountAlertsJob.run()).toMatchObject({ users: 1, failed: 0, sent: 0 });
    expect(await hasMail(email)).toBe(false);
  });
});
