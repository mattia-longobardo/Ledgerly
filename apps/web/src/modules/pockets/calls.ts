// The calls of Pockets to `/api/v1` (rewrite plan R3): each keeps the answer of the Server Action it
// replaces, so the dialogs read one shape. An amount is read in the person's number format here, on
// the client, and goes on the wire as a decimal string (`amountInput`, audit POC-6).
import { pockets } from "@ledgerly/api-contract/pockets";
import { profile } from "@ledgerly/api-contract/settings";
import { ApiError, call } from "@ledgerly/api-client";
import { centsToDecimal } from "@ledgerly/format/cents";
import { numberStyle, parseAmount } from "@ledgerly/format/format";
import { invalidate, read } from "@ledgerly/ui/data";

export type PocketResult = { ok: true } | { ok: false; error: string };
type CreateResult = { ok: true; id: string } | { ok: false; error: string };

/** The pocket dialog: amounts as typed, an empty one being no amount at all. */
export interface PocketForm {
  name: string;
  accountId: string | null;
  target: string;
  monthly: string;
  /** `YYYY-MM-01`. */
  startMonth: string;
}

/** What a pocket's write changes: the Pockets page, Overview's tile, a pocket's page, the candidates. */
function changed(): void {
  invalidate(
    pockets.listPockets,
    pockets.getPocketsOverview,
    pockets.getPocket,
    pockets.listPocketCandidates,
  );
}

/** A typed amount the client cannot read: `invalid`, as the Server Action answered. */
class Unreadable extends Error {}

/** The refusal's reason (`duplicate_name`, `future_date`…) or its code; a failure of the server throws. */
function refusal(error: unknown): { ok: false; error: string } {
  if (error instanceof Unreadable) return { ok: false, error: "invalid" };
  if (error instanceof ApiError && error.status < 500)
    return { ok: false, error: error.reason ?? error.code };
  throw error;
}

async function writing(work: () => Promise<unknown>): Promise<PocketResult> {
  try {
    await work();
    changed();
    return { ok: true };
  } catch (error) {
    return refusal(error);
  }
}

/** An amount typed in the person's format, as the decimal of the contract. */
async function decimalOf(typed: string): Promise<string> {
  const style = numberStyle(await read(profile.getPreferences, {}));
  try {
    return centsToDecimal(parseAmount(typed, style));
  } catch {
    throw new Unreadable();
  }
}

const optionalDecimal = (typed: string) => (typed.trim() === "" ? null : decimalOf(typed));

async function bodyOf(form: PocketForm) {
  return {
    name: form.name,
    color: null,
    accountId: form.accountId || null,
    target: await optionalDecimal(form.target),
    monthly: await optionalDecimal(form.monthly),
    startMonth: form.startMonth,
  };
}

export async function createPocket(form: PocketForm): Promise<CreateResult> {
  try {
    const { id } = await call(pockets.createPocket, { body: await bodyOf(form) });
    changed();
    return { ok: true, id };
  } catch (error) {
    return refusal(error);
  }
}

export function updatePocket(id: string, form: PocketForm): Promise<PocketResult> {
  return writing(async () => call(pockets.updatePocket, { params: { id }, body: await bodyOf(form) }));
}

export function setPocketState(id: string, state: "active" | "paused" | "archived"): Promise<PocketResult> {
  return writing(() => call(pockets.setPocketState, { params: { id }, body: { state } }));
}

export function addToPocket(id: string, input: { amount: string; on: string }): Promise<PocketResult> {
  return writing(async () =>
    call(pockets.addToPocket, {
      params: { id },
      body: { amount: await decimalOf(input.amount), on: input.on },
    }),
  );
}

export function linkExpense(id: string, transaction: string): Promise<PocketResult> {
  return writing(() => call(pockets.linkPocketExpense, { params: { id, transaction } }));
}

export function unlinkExpense(id: string, transaction: string): Promise<PocketResult> {
  return writing(() => call(pockets.unlinkPocketExpense, { params: { id, transaction } }));
}

export function addPlannedExpense(
  id: string,
  input: { amount: string; dueOn: string; description: string },
): Promise<PocketResult> {
  return writing(async () =>
    call(pockets.addPlannedExpense, {
      params: { id },
      body: { amount: await decimalOf(input.amount), dueOn: input.dueOn, description: input.description },
    }),
  );
}

export function removePlannedExpense(id: string): Promise<PocketResult> {
  return writing(() => call(pockets.removePlannedExpense, { params: { id } }));
}
