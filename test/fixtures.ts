// test/fixtures.ts — the user, account and Wallet movement every F3 integration test starts from.
import { createAccount } from "@/modules/accounts/service";
import type { IncomingTransaction } from "@/modules/transactions/rules";
import type { Ctx } from "@/platform/context";
import { createTestUser } from "./users";

export function contextFor(userId: string): Ctx {
  return { userId, role: "user", locale: "en", timeZone: "Europe/Rome", numberFormat: "it-IT" };
}

export async function newContext(): Promise<Ctx> {
  return contextFor((await createTestUser()).id);
}

export async function anAccount(ctx: Ctx, name = "ING Conto Arancio"): Promise<string> {
  const account = await createAccount(ctx, {
    name,
    type: "checking",
    currency: "EUR",
    color: null,
    reference: "",
    purpose: "",
    openedOn: null,
    notes: "",
    openingBalance: null,
  });
  return account.id;
}

let sequence = 0;

/** One movement as Wallet hands it over, with only what a test cares about overridden. */
export function movement(overrides: Partial<IncomingTransaction> = {}): IncomingTransaction {
  sequence += 1;
  return {
    externalId: `w-${sequence}`,
    counterpartExternalId: null,
    occurredAt: new Date("2026-03-10T09:00:00Z"),
    amountCents: -2_500n,
    currency: "EUR",
    type: "expense",
    state: "cleared",
    payee: "Esselunga",
    note: null,
    categoryExternalId: null,
    categoryName: "Groceries",
    categoryGroupExternalId: null,
    categoryGroupName: null,
    labels: [],
    ...overrides,
  };
}
