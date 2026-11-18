/**
 * The manual movements of this app, written to Wallet (rewrite plan N3.1, 04-now.md §4.5): the
 * first step of a pass, before any reading, so the balance and the movements the pass reads next
 * already hold what it has just sent.
 *
 * One movement here is one record there, whatever goes wrong in between:
 *
 * 1. the record carries a **marker** in its note, with the key of the movement. A movement that was
 *    asked for once before ("not sent") is looked for by its marker first, and taken when it is
 *    there: a request whose answer was lost is never repeated;
 * 2. the movement is marked "not sent" **before** Wallet is asked, so a process that dies between
 *    the request and the answer leaves the state that makes the next pass look first;
 * 3. the reading recognises the marker too (`sync.ts`), and takes the waiting movement for the
 *    record instead of importing a second row.
 *
 * This file speaks to the client and to nothing else: what waits, and what becomes of it, is handed
 * in by the pass, which is the one that may reach the modules.
 */
import type { CivilDate } from "../../../shared/dates";
import type { Cents } from "../../../shared/money";
import { type WalletClient, WalletError } from "./client";

/** What a record written from here carries in its note: `ledgerly-movement:<key>`. */
const MARKER = "ledgerly-movement:";
const MARKED = /(?:^|\s)ledgerly-movement:([A-Za-z0-9-]{8,64})\s*$/;

export function sendMarker(key: string): string {
  return `${MARKER}${key}`;
}

/** The note a record is created with: the person's own, then the marker on a line of its own. */
export function noteWithMarker(note: string | null, key: string): string {
  const own = note?.trim() ?? "";
  return own === "" ? sendMarker(key) : `${own}\n${sendMarker(key)}`;
}

/**
 * A note read from Wallet, without the marker, and the key the marker carried. The marker is this
 * app's own business: no screen shows it, and a note that was only the marker is no note.
 */
export function splitSendMarker(note: string | null): { note: string | null; key: string | null } {
  if (note === null) return { note: null, key: null };
  const found = MARKED.exec(note);
  if (!found) return { note, key: null };
  const rest = note.slice(0, found.index).trim();
  return { note: rest === "" ? null : rest, key: found[1] };
}

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
 * Whether a failure says something about one movement only: Wallet answered, and said no to this
 * request (a 4xx that is not about the token or the rate), or answered a shape nobody could read.
 * Anything else is the connection's, and there is no point in asking for the next movement.
 */
export function isMovementRefusal(error: unknown): boolean {
  if (!(error instanceof WalletError)) return false;
  if (error.kind === "payload") return true;
  return (
    error.kind === "http" &&
    error.status !== null &&
    error.status >= 400 &&
    error.status < 500 &&
    error.status !== 429
  );
}

type SendClient = Pick<WalletClient, "recordsWithNote" | "createRecord" | "patchRecord">;

async function sendOne(client: SendClient, movement: MovementToSend, deps: SendDeps): Promise<boolean> {
  const category = await deps.categoryFor(movement.categoryId);
  let recordId: string | null = null;
  if (movement.state === "not_sent") {
    // Asked for once already: the record may be there, with or without an answer that arrived —
    // on the day that request named, whatever day the movement has now.
    const found = await client.recordsWithNote({
      accountId: movement.accountExternalId,
      on: movement.askedOn ?? movement.on,
      marker: sendMarker(movement.key),
    });
    recordId = (found.find((record) => record.amountCents === movement.amountCents) ?? found[0])?.id ?? null;
  }
  if (recordId === null) {
    await deps.markNotSent(movement.id, movement.on);
    const created = await client.createRecord({
      accountId: movement.accountExternalId,
      amountCents: movement.amountCents,
      on: movement.on,
      note: noteWithMarker(movement.note, movement.key),
      categoryId: category?.externalId ?? null,
    });
    // No id that could be read: the record may exist. The reading finds it by its marker.
    if (created.id === null) return false;
    recordId = created.id;
  }
  let payeeSent = movement.payee === null;
  if (movement.payee !== null) {
    // The create has no field for the payee; the edit has. A payee Wallet did not take stays the
    // one written here (`settle` is told), and never fails a movement that is already there.
    try {
      payeeSent = (await client.patchRecord({ id: recordId, counterParty: movement.payee })).ok;
    } catch {
      payeeSent = false;
    }
  }
  return deps.settle(movement.id, {
    externalId: recordId,
    sourceCategoryId: category?.id ?? null,
    payeeSent,
  });
}

/** Sends the movements that wait, the oldest first, and says what became of them. */
export async function sendManualMovements(
  client: SendClient,
  movements: readonly MovementToSend[],
  deps: SendDeps,
): Promise<SendOutcome> {
  const counts = { sent: 0, notSent: 0 };
  for (const movement of movements) {
    try {
      if (await sendOne(client, movement, deps)) counts.sent += 1;
      else counts.notSent += 1;
    } catch (error) {
      counts.notSent += 1;
      await deps.markNotSent(movement.id);
      if (!isMovementRefusal(error)) return { counts, failure: error };
    }
  }
  return { counts, failure: undefined };
}
