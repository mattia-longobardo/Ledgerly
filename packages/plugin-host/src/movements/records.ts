/**
 * A person's edit of a movement of a source, written **to the source** (owner, 2026-09-24), for a
 * source whose plugin has the capability `editRecord`.
 *
 * A movement's type, amount and payee belong to the provider (spec §7.2), and its note is a local
 * edit the source never hears of — unless the source takes edits: then they can be changed from the
 * Expenses screen, and the change goes to the source first: only once the source has accepted it is
 * it applied here, from the record the source answers with, through the same merge a sync uses. The
 * two sides never disagree about a value this screen says was saved.
 *
 * The edit goes through the plugin (`POST /records/edit` of contract 2, rewrite plan R5c): it reads
 * the record, works out the patch the source can express, and answers the record as the source
 * holds it, or why the source said no — a code, never the source's words.
 *
 * The network is used outside any transaction (spec §4.3): ask the plugin, then apply the answer
 * in the module's own short writes.
 */
import type { Ctx } from "@ledgerly/domain/platform/context";
import { type Connection, externalIdsOf } from "@ledgerly/domain/platform/integrations";
import { type Cents, centsToDecimal } from "@ledgerly/domain/shared/money";
import { connectionsThatCan } from "../capabilities";
import { callCode, connectionSource } from "./calls";
import { toIncomingMovement } from "./incoming";
import { movementsSink } from "./ports";
import { syncSourceNow } from "./sync";

const TRANSACTION_ENTITY = "transaction";

/** What the Expenses screen submits: the whole of the editable movement, as it should now be. */
interface SourceRecordEdit {
  type: "income" | "expense" | "transfer";
  /** The size of the amount, always positive: the type decides the sign it reaches the source with. */
  amountCents: Cents;
  payee: string | null;
  note: string | null;
}

type SourceEditOutcome =
  | { state: "saved" }
  /** Everything submitted was already what the source holds: nothing was sent. */
  | { state: "unchanged" }
  /** No usable connection to a source that takes edits, or the movement did not come from one. */
  | { state: "not_linked" }
  /** The source answered and refused the edit; `reason` is a code of contract 2 (`zero_amount`…). */
  | { state: "refused"; reason: string }
  /** The call never landed (the call's code), or the source has no such record any more (`gone`). */
  | { state: "failed"; reason: string };

/** The connections an edit may write through: a source that takes edits, not revoked. */
async function editableConnections(ctx: Pick<Ctx, "userId">): Promise<Connection[]> {
  return (await connectionsThatCan(ctx, "editRecord")).filter((one) => one.state !== "revoked");
}

/**
 * "Sync now" of the source a manual movement waits for, without a session (`retry_manual_send`):
 * `false` when `provider` is no source the person has a usable connection to.
 */
export async function syncSourceFor(ctx: Ctx, provider: string): Promise<boolean> {
  const connection = (await connectionsThatCan(ctx, "source.read")).find(
    (one) => one.provider === provider && one.state !== "revoked",
  );
  if (!connection) return false;
  await syncSourceNow(ctx, connection.id);
  return true;
}

/**
 * The movements among `ids` that can be edited at their source: a source that takes edits is
 * connected and the movement came from it. Everything else keeps the local-only details panel.
 */
export async function editableAtSource(
  ctx: Pick<Ctx, "userId">,
  ids: readonly string[],
): Promise<Set<string>> {
  const editable = new Set<string>();
  if (ids.length === 0) return editable;
  for (const connection of await editableConnections(ctx)) {
    const linked = await externalIdsOf(ctx, connection.provider, TRANSACTION_ENTITY, ids);
    for (const id of linked.keys()) editable.add(id);
  }
  return editable;
}

/** The fields of the movement a saved edit hands back to the source (see `releaseLocalEdits`). */
const PUSHED_FIELDS = ["amountCents", "type", "payee", "note"] as const;

/** The movement's id at a source that takes edits, and the connection to it; `null` for none. */
async function linkOf(ctx: Pick<Ctx, "userId">, transactionId: string) {
  for (const connection of await editableConnections(ctx)) {
    const externalId = (
      await externalIdsOf(ctx, connection.provider, TRANSACTION_ENTITY, [transactionId])
    ).get(transactionId);
    if (externalId) return { connection, externalId };
  }
  return null;
}

/** Asks the source to take the edit; the answer, or the code of a call that never landed. */
async function askSource(
  ctx: Pick<Ctx, "userId">,
  link: { connection: Connection; externalId: string },
  edit: SourceRecordEdit,
) {
  try {
    const source = await connectionSource(ctx, link.connection);
    const size = edit.amountCents < 0n ? -edit.amountCents : edit.amountCents;
    return await source.edit({
      externalId: link.externalId,
      edit: { type: edit.type, amount: centsToDecimal(size), payee: edit.payee, note: edit.note },
    });
  } catch (error) {
    return { state: "failed" as const, reason: callCode(error) ?? "failed" };
  }
}

/**
 * Writes a person's edit of one movement to its source, then here. Never throws for anything the
 * source does: a refusal, a network failure or a rejected token is an answer to show the person,
 * and nothing has been changed here in any of those cases.
 */
export async function editAtSource(
  ctx: Pick<Ctx, "userId" | "timeZone">,
  transactionId: string,
  edit: SourceRecordEdit,
): Promise<SourceEditOutcome> {
  const sink = movementsSink();
  const row = await sink.getTransaction(ctx, transactionId);
  if (!row) return { state: "not_linked" };
  const link = await linkOf(ctx, row.id);
  if (!link) return { state: "not_linked" };

  const answer = await askSource(ctx, link, edit);
  if (answer.state === "failed" || answer.state === "unchanged") return answer;
  // A record the source no longer has is no refusal of the edit: there is nothing left to edit.
  if (answer.state === "refused") {
    return answer.reason === "gone" ? { state: "failed", reason: "gone" } : answer;
  }

  // The source holds the new values now: the fields follow it again, and its answer is applied the
  // way a sync would apply it. A missing answer leaves the row to the next pass, which reads it.
  await sink.releaseLocalEdits(ctx, row.id, PUSHED_FIELDS);
  if (answer.movement) {
    await sink.upsertFromProvider(
      ctx,
      row.accountId,
      [toIncomingMovement(answer.movement, new Map(), ctx.timeZone)],
      { provider: link.connection.provider },
    );
  }
  return { state: "saved" };
}
