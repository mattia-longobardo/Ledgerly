// The calls of Subscriptions to `/api/v1` (rewrite plan R3): each keeps the answer of the Server Action
// it replaces, so the dialogs read one shape. The price and the tolerance are read in the person's
// number format here, on the client, and go on the wire as decimal strings (`amountInput`, a plain
// percentage); the conversion of the percentage to the stored fraction is the domain's (SUB-7).
import { subscriptions } from "@ledgerly/api-contract/subscriptions";
import { call } from "@ledgerly/api-client";
import { invalidate } from "@ledgerly/ui/data";
import type { Cycle } from "@ledgerly/domain/subscriptions/client";
import { decimalOf, writing, type WriteResult } from "@/platform/writes";

export type ActionResult = WriteResult;

/** The subscription dialog, as typed. */
interface SubscriptionForm {
  name: string;
  categoryId: string | null;
  paymentAccountId: string | null;
  price: string;
  cycle: Cycle;
  /** The date of one charge: the anchor of the calendar. */
  nextChargeOn: string;
  payeeMatch: string;
  /** Percent, as typed: "5" or "2,5"; empty is the default 5 %. */
  tolerance: string;
  utility: number;
}

/** What a write changes: the page and the suggestions it offers. */
function changed(): void {
  invalidate(subscriptions.listSubscriptions, subscriptions.listSubscriptionSuggestions);
}

const write = (work: () => Promise<unknown>) => writing(work, changed);

async function bodyOf(form: SubscriptionForm) {
  const match = form.payeeMatch.trim();
  return {
    name: form.name,
    categoryId: form.categoryId || null,
    accountId: form.paymentAccountId || null,
    price: await decimalOf(form.price),
    cycle: form.cycle,
    chargeOn: form.nextChargeOn,
    payeeMatch: match === "" ? null : match,
    tolerance: form.tolerance.trim() === "" ? undefined : await decimalOf(form.tolerance),
    utility: form.utility,
  };
}

export function createSubscription(form: SubscriptionForm): Promise<ActionResult> {
  return write(async () => call(subscriptions.createSubscription, { body: await bodyOf(form) }));
}

export function updateSubscription(id: string, form: SubscriptionForm): Promise<ActionResult> {
  return write(async () =>
    call(subscriptions.updateSubscription, { params: { id }, body: await bodyOf(form) }),
  );
}

export function setSubscriptionState(
  id: string,
  state: "active" | "paused" | "cancelled",
): Promise<ActionResult> {
  return write(() => call(subscriptions.setSubscriptionState, { params: { id }, body: { state } }));
}

/** Throws away a cancelled subscription and the charges it had checked (the route: cancelled only). */
export function deleteSubscription(id: string): Promise<ActionResult> {
  return write(() => call(subscriptions.deleteSubscription, { params: { id } }));
}
