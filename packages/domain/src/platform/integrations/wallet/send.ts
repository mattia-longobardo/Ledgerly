/**
 * The manual movements of this app, written to Wallet (rewrite plan N3.1, 04-now.md §4.5): the
 * first step of a pass, before any reading, so the balance and the movements the pass reads next
 * already hold what it has just sent.
 *
 * One movement here is one record there, whatever goes wrong in between:
 *
 * 1. the record carries a **marker** in its note, with the key of the movement (the plugin writes it
 *    and takes it off on the way back). A movement that was asked for once before ("not sent") is
 *    looked for by its marker first, and taken when it is there: a request whose answer was lost is
 *    never repeated;
 * 2. the movement is marked "not sent" **before** Wallet is asked, so a process that dies between
 *    the request and the answer leaves the state that makes the next pass look first;
 * 3. the reading recognises the marker too (`sentKey`), and takes the waiting movement for the
 *    record instead of importing a second row.
 *
 * This file speaks to the source's calls (`push`, one per movement) and to nothing else: what waits, and what becomes of it, is handed
 * in by the pass, which is the one that may reach the modules.
 */
import { type CivilDate } from "../../../shared/dates";
import { type Cents, centsToDecimal } from "../../../shared/money";
import { callCode, type SourceCalls } from "./calls";

/** A manual movement that waits, with Wallet's own id of its account. */
export interface MovementToSend {
  id: string;
  key: string;
  state: "to_send" | "not_sent";
  accountExternalId: string;
  on: CivilDate;
  /** The day the source was last asked to create it on; `null` when it was never asked. */
  askedOn: CivilDate | null;
  amountCents: Cents;
  payee: string | null;
  note: string | null;
  categoryId: string | null;
}

export interface SendDeps {
  /** Wallet's id of the category the movement is sent with, and the row that holds it; `null` for none. */
  categoryFor(categoryId: string | null): Promise<{ id: string; externalId: string } | null>;
  /**
   * Marks the movement "not sent": before every request, with the day the request names, and
   * after every failure.
   */
  markNotSent(id: string, askedOn?: CivilDate): Promise<void>;
  /** Wallet holds the movement as `externalId`: it is Wallet's own from here on. */
  settle(
    id: string,
    sent: { externalId: string; sourceCategoryId: string | null; payeeSent: boolean },
  ): Promise<boolean>;
}

export interface SendOutcome {
  counts: { sent: number; notSent: number };
  /**
   * What stopped the step, when the connection itself failed (the network, a refused token, a
   * limit): the pass of the movements fails with it. A refusal of one movement is not one.
   */
  failure: unknown;
}

/**
 * Whether a failure says something about one movement only: the plugin says the source refused
 * this request (`refused`). Anything else is the connection's, and there is no point in asking for
 * the next movement.
 */
export function isMovementRefusal(error: unknown): boolean {
  return callCode(error) === "refused";
}

async function sendOne(
  source: Pick<SourceCalls, "push">,
  movement: MovementToSend,
  deps: SendDeps,
): Promise<boolean> {
  const category = await deps.categoryFor(movement.categoryId);
  await deps.markNotSent(movement.id, movement.on);
  // Asked for once already: the plugin looks for the record by its marker first — on the day that
  // request named, whatever day the movement has now — and creates nothing when it is there.
  const sent = await source.push({
    idempotencyKey: movement.key,
    askedOn: movement.state === "not_sent" ? (movement.askedOn ?? movement.on) : null,
    movement: {
      accountExternalId: movement.accountExternalId,
      day: movement.on,
      amount: centsToDecimal(movement.amountCents),
      payee: movement.payee,
      note: movement.note,
      categoryExternalId: category?.externalId ?? null,
    },
  });
  // No id that could be read: the record may exist. The reading finds it by its marker.
  if (sent.externalId === null) return false;
  // A payee Wallet did not take stays the one written here (`settle` is told).
  return deps.settle(movement.id, {
    externalId: sent.externalId,
    sourceCategoryId: category?.id ?? null,
    payeeSent: sent.payeeSent,
  });
}

/** Sends the movements that wait, the oldest first, and says what became of them. */
export async function sendManualMovements(
  source: Pick<SourceCalls, "push">,
  movements: readonly MovementToSend[],
  deps: SendDeps,
): Promise<SendOutcome> {
  const counts = { sent: 0, notSent: 0 };
  for (const movement of movements) {
    try {
      if (await sendOne(source, movement, deps)) counts.sent += 1;
      else counts.notSent += 1;
    } catch (error) {
      counts.notSent += 1;
      await deps.markNotSent(movement.id);
      if (!isMovementRefusal(error)) return { counts, failure: error };
    }
  }
  return { counts, failure: undefined };
}
