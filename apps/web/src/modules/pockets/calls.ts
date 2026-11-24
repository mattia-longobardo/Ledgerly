// The calls of Pockets to `/api/v1` (rewrite plan R3): each keeps the answer of the Server Action it
// replaces, so the dialogs read one shape. An amount is read in the person's number format here, on
// the client, and goes on the wire as a decimal string (`amountInput`, audit POC-6).
import { pockets } from "@ledgerly/api-contract/pockets";
import { call } from "@ledgerly/api-client";
import { invalidate } from "@ledgerly/ui/data";
import { decimalOf, refusal, writing, type WriteResult } from "@/platform/writes";

export type PocketResult = WriteResult;
type CreateResult = { ok: true; id: string } | { ok: false; error: string };

/** The pocket dialog: amounts as typed, an empty one being no amount at all. */
export interface PocketForm {
  name: string;
  accountId: string | null;
  target: string;
  monthly: string;
  /** `YYYY-MM-01`. */
  startMonth: string;
  /** The day of the month it accrues on, 1 to 31 (R5a); absent, the server's. */
  accrualDay?: number;
}

/**
 * What a pocket's write changes: the Pockets page, Overview's tile, a pocket's page, the candidates.
 * The write ends once they are read again, so a dialog opened next starts from the new values.
 */
function changed(): Promise<void> {
  return invalidate(
    pockets.listPockets,
    pockets.getPocketsOverview,
    pockets.getPocket,
    pockets.listPocketCandidates,
  );
}

const write = (work: () => Promise<unknown>) => writing(work, changed);

const optionalDecimal = (typed: string) => (typed.trim() === "" ? null : decimalOf(typed));

async function bodyOf(form: PocketForm) {
  return {
    name: form.name,
    color: null,
    accountId: form.accountId || null,
    target: await optionalDecimal(form.target),
    monthly: await optionalDecimal(form.monthly),
    startMonth: form.startMonth,
    accrualDay: form.accrualDay,
  };
}

export async function createPocket(form: PocketForm): Promise<CreateResult> {
  try {
    const { id } = await call(pockets.createPocket, { body: await bodyOf(form) });
    await changed();
    return { ok: true, id };
  } catch (error) {
    return refusal(error);
  }
}

export function updatePocket(id: string, form: PocketForm): Promise<PocketResult> {
  return write(async () => call(pockets.updatePocket, { params: { id }, body: await bodyOf(form) }));
}

export function setPocketState(id: string, state: "active" | "paused" | "archived"): Promise<PocketResult> {
  return write(() => call(pockets.setPocketState, { params: { id }, body: { state } }));
}

export function addToPocket(id: string, input: { amount: string; on: string }): Promise<PocketResult> {
  return write(async () =>
    call(pockets.addToPocket, {
      params: { id },
      body: { amount: await decimalOf(input.amount), on: input.on },
    }),
  );
}

export function linkExpense(id: string, transaction: string): Promise<PocketResult> {
  return write(() => call(pockets.linkPocketExpense, { params: { id, transaction } }));
}

export function unlinkExpense(id: string, transaction: string): Promise<PocketResult> {
  return write(() => call(pockets.unlinkPocketExpense, { params: { id, transaction } }));
}

export function addPlannedExpense(
  id: string,
  input: { amount: string; dueOn: string; description: string },
): Promise<PocketResult> {
  return write(async () =>
    call(pockets.addPlannedExpense, {
      params: { id },
      body: { amount: await decimalOf(input.amount), dueOn: input.dueOn, description: input.description },
    }),
  );
}

export function removePlannedExpense(id: string): Promise<PocketResult> {
  return write(() => call(pockets.removePlannedExpense, { params: { id } }));
}
