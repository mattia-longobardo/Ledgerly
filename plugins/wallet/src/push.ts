/**
 * One movement written in the core, created in Wallet (`POST /push`), once whatever goes wrong in
 * between. The record carries a marker with the core's key in its note; a movement asked for
 * before (`askedOn`) is looked for by that marker first and taken when it is there, so a request
 * whose answer was lost is never repeated. The create has no field for the payee: an edit sends it.
 */
import type { PushResponse } from "@ledgerly/plugin-contract";
import { isCivilDate } from "./days";
import { PluginFailure, WalletError } from "./failure";
import { type Wallet, write } from "./http";
import { noteWithMarker, sendMarker } from "./marker";
import { centsToDecimal, parseCents } from "./money";
import { createdRecordsSchema } from "./payloads";
import { patchRecord } from "./edit";
import { recordsWithNote } from "./records";

interface PushRequest {
  idempotencyKey: string;
  askedOn: string | null;
  movement: {
    accountExternalId: string;
    day: string;
    amount: string;
    payee: string | null;
    note: string | null;
    categoryExternalId: string | null;
  };
}

/**
 * Whether a failure is about this movement only: Wallet answered and said no (a 4xx that is not
 * about the token or the rate), or answered a shape nobody can read. Anything else is the
 * connection's, and the core stops asking.
 */
export function isMovementRefusal(error: unknown): boolean {
  if (!(error instanceof WalletError)) return false;
  if (error.kind === "payload") return true;
  const status = error.status ?? 0;
  return error.kind === "http" && status >= 400 && status < 500 && status !== 429;
}

/**
 * One new record, its amount written by hand as its exact decimal. The category is left out
 * rather than sent as `null` when there is none: an unfiled record is what the absent field means.
 * `null` when the answer carries no id that can be read: the record may exist all the same.
 */
async function createRecord(wallet: Wallet, request: PushRequest, cents: bigint): Promise<string | null> {
  const { movement } = request;
  const category =
    movement.categoryExternalId === null
      ? ""
      : `,"categoryId":${JSON.stringify(movement.categoryExternalId)}`;
  const note = noteWithMarker(movement.note, request.idempotencyKey);
  const body = `[{"accountId":${JSON.stringify(movement.accountExternalId)},"amount":${centsToDecimal(cents)},"recordDate":${JSON.stringify(movement.day)},"note":${JSON.stringify(note)}${category}}]`;
  const created = await write(wallet, { path: "/records", method: "POST", body }, createdRecordsSchema);
  return created[0]?.id ?? null;
}

/** The record of an earlier request, on the day that request named: the same amount first. */
async function findAsked(wallet: Wallet, request: PushRequest, cents: bigint): Promise<string | null> {
  if (request.askedOn === null) return null;
  const found = await recordsWithNote(wallet, {
    accountId: request.movement.accountExternalId,
    day: request.askedOn,
    marker: sendMarker(request.idempotencyKey),
  });
  return (found.find((record) => record.cents === cents) ?? found[0])?.id ?? null;
}

/** A payee Wallet did not take stays the core's own: it never fails a record that is already there. */
async function sendPayee(wallet: Wallet, id: string, payee: string | null): Promise<boolean> {
  if (payee === null) return true;
  try {
    return (await patchRecord(wallet, { id, counterParty: payee })).saved;
  } catch {
    return false;
  }
}

export async function pushMovement(wallet: Wallet, request: PushRequest): Promise<PushResponse> {
  const days = [request.movement.day, request.askedOn ?? request.movement.day];
  if (!days.every(isCivilDate)) throw new PluginFailure("invalid_request");
  const cents = parseCents(request.movement.amount);
  let id: string | null;
  try {
    id = (await findAsked(wallet, request, cents)) ?? (await createRecord(wallet, request, cents));
  } catch (error) {
    if (isMovementRefusal(error)) throw new PluginFailure("refused");
    throw error;
  }
  if (id === null) return { externalId: null, payeeSent: false };
  return { externalId: id, payeeSent: await sendPayee(wallet, id, request.movement.payee) };
}
