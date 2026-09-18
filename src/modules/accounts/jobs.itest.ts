// What the daily alerts job of §10.2 sends, and what it deliberately does not: §10.4 has one
// "sync failed or out of date" condition, and the connection reports it
// (`modules/transactions/jobs.ts`), not one email per account of the same dead link.
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import type { Ctx } from "@/platform/context";
import { WALLET_PROVIDER } from "@/platform/integrations/rules";
import { closeDatabase, resetDatabase } from "../../../test/db";
import { createTestUser } from "../../../test/users";
import { accountAlertsJob } from "./jobs";
import { accountsView } from "./queries";
import type { RemoteAccount } from "./rules";
import { applyProviderAccounts } from "./service";

const REMOTE: RemoteAccount = {
  provider: WALLET_PROVIDER,
  providerAccountId: "w-acc-1",
  name: "Revolut",
  type: "checking",
  currency: "EUR",
};

const daysAgo = (n: number) => new Date(Date.now() - n * 24 * 60 * 60 * 1000);

let ctx: Ctx;

describe("accountAlertsJob", () => {
  beforeEach(async () => {
    await resetDatabase();
    const person = await createTestUser();
    ctx = { userId: person.id, role: "user", locale: "en", timeZone: "Europe/Rome", numberFormat: "it-IT" };
  });
  afterAll(closeDatabase);

  // The account still shows "stale sync" in the interface — §7.1 wants it there — and sends no
  // email: one dead token would otherwise be one email per account, and an account the provider
  // stopped returning (`unavailable`, never deleted) would be one a week for ever.
  it("raises a stale sync as an alert and mails nobody about it", async () => {
    await applyProviderAccounts(ctx, WALLET_PROVIDER, [REMOTE], daysAgo(3));

    const view = await accountsView(ctx);
    expect(view.alerts.map((alert) => alert.kind)).toEqual(["stale_sync"]);

    expect(await accountAlertsJob.run()).toMatchObject({ users: 1, failed: 0, sent: 0 });
  });
});
