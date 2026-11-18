// scripts/seed-e2e/accounts.ts — the users and the data of the flow `accounts` (tests/e2e/accounts/).
import { eq } from "drizzle-orm";
import { BANK_PLUGIN_ID as BANK_PLUGIN } from "../../src/app/(app)/banks/plugin";
import { accounts } from "@domain/modules/accounts/schema";
import { createAccount } from "@domain/modules/accounts/service";
import { parseKeyRing, sealJson } from "@domain/platform/crypto";
import { addDays, today } from "@domain/platform/dates";
import { getDb } from "@domain/platform/db/client";
import { readEnv } from "@domain/platform/env";
import { pluginProvider } from "@domain/platform/integrations/rules";
import { integrationConnections } from "@domain/platform/integrations/schema";
import { savePluginConnection } from "@domain/platform/integrations/service";
import { findInstancePlugin } from "@domain/platform/plugins/queries";
import { pluginUserCredentials } from "@domain/platform/plugins/schema";
import { connectionBag, setPluginActive } from "../../src/platform/plugins/service";
import { USERS } from "../../tests/e2e/_shared/env";
import { contextOf, syncedAccount } from "./common";

/**
 * The display-currency journey (docs/design/investments.md §1.8): one account in EUR and one in
 * USD. The USD one is converted at the stored rates (`fx_rates`: the ECB's on the site, one
 * invented fixing on a preview), so the spec checks the currency of the totals, never a converted
 * figure.
 */
export async function seedCurrency(): Promise<void> {
  const ctx = await contextOf(USERS.currency.email);
  const on = addDays(today(ctx.timeZone), -3);
  for (const [name, type, currency] of [
    ["Conto EUR", "checking", "EUR"],
    ["Broker USD", "investment", "USD"],
  ] as const) {
    await createAccount(ctx, {
      name,
      type,
      currency,
      color: null,
      reference: "",
      purpose: "",
      openedOn: null,
      notes: "",
      openingBalance: { on, cents: 1_000_00n },
    });
  }
}

/**
 * Release N3.1 (ux/n3-categories-manual.md §6.4, §9.8): an account of a source that takes the
 * movements written here and gives its own categories. Four categories of the source — one matched
 * to another, one that has just arrived — and two manual movements on their way: one that waits,
 * one the source did not take. There is no connection behind the account: nothing here is ever
 * sent, and "Retry sending" finds no source to update.
 */
/**
 * Release N4b: an account kept by a source, a bank whose same account is not in Ledgerly yet (the
 * same IBAN, an example of the standard), and the bank's plugin turned on. The dry run is never
 * started by a test: it would ask a bank. Its own user: the switch journey changes nothing else.
 */
export async function seedSwitching(email: string = USERS.switching.email): Promise<void> {
  const ctx = await contextOf(email);
  const iban = "IT60X0542811101000000123456";
  const current = await syncedAccount(ctx, "e2e-switching-1", "Conto da passare");
  await getDb().update(accounts).set({ iban, ibanFromSource: true }).where(eq(accounts.id, current));
  if (!(await findInstancePlugin(BANK_PLUGIN))) return;
  await setPluginActive(ctx, { pluginId: BANK_PLUGIN, active: true });
  await getDb()
    .insert(pluginUserCredentials)
    .values({
      userId: ctx.userId,
      pluginId: BANK_PLUGIN,
      credentials: sealJson(parseKeyRing(readEnv().APP_ENCRYPTION_KEY), {
        applicationId: "e2e-not-an-application",
        privateKey: "e2e-not-a-key",
      }),
      savedAt: new Date(),
    });
  const connection = await savePluginConnection(ctx, {
    provider: pluginProvider(BANK_PLUGIN),
    instanceKey: "IT:Banca Esempio",
    credentials: connectionBag(
      "e2e-not-a-session",
      [
        {
          externalId: "e2e-switch-current",
          stableId: "e2e-switch-stable-current",
          name: "Conto corrente",
          identifier: iban,
          currency: "EUR",
          kind: "CACC",
        },
      ],
      { chosen: true, skipped: ["e2e-switch-stable-current"] },
    ),
    expiresAt: new Date(Date.now() + 170 * 86_400_000),
  });
  // Days away: no pass of the dispatcher comes while the test users exist.
  await getDb()
    .update(integrationConnections)
    .set({ nextSyncAt: new Date(Date.now() + 48 * 3_600_000), lastOkAt: new Date() })
    .where(eq(integrationConnections.id, connection.id));
}
