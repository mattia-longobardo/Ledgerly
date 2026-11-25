/**
 * The bridge from the words of contract 2 to the modules' own vocabularies (spec §7.1, §7.2): a
 * movement and an account of the source as the transactions and the accounts modules receive them.
 */
import type { SourceMovement } from "@ledgerly/plugin-contract";
import { normalizeIban } from "@ledgerly/domain/platform/iban";
import { civilDateIn, startOfDayIn } from "@ledgerly/domain/shared/dates";
import { parseCents } from "@ledgerly/domain/shared/money";
import type { SourceAccount, SourceCategory } from "./calls";
import type { IncomingMovement, RemoteAccount } from "./ports";

/**
 * The instant to store, under one invariant: `civilDateIn(occurredAtOf(movement, tz), tz)` is
 * `movement.occurredOn`, in every zone, always.
 *
 * `occurredOn` is the day the source stamped and the only day the provider will filter a window on;
 * the instant is a refinement of it, useful for ordering inside a day. The two can disagree —
 * `2026-01-20T23:40:00Z` is the 21st in Rome and the 20th to the source, and west of Greenwich the
 * drift goes the other way — and nothing can reconcile them afterwards, because `occurredOn` is
 * persisted nowhere (spec §9 allows F2 one migration, and it is spent). So when the instant
 * disagrees with its own day it is dropped in favour of midnight of `occurredOn` in the user's
 * zone: a lost time of day costs an ordering inside one day, while a wrong day moves the movement
 * to another month in the interface and — worse — out of the window the source filters on, where it
 * would be declared gone every hour (spec §7.2).
 */
function occurredAtOf(movement: { occurredAt: Date | null; occurredOn: string }, timeZone: string): Date {
  return (
    timeOn(movement.occurredOn, movement.occurredAt, timeZone) ?? startOfDayIn(movement.occurredOn, timeZone)
  );
}

/**
 * The instant of a movement when it falls on its own day in the person's zone, else `null`: the
 * invariant of {@link occurredAtOf}, for every provider that gives a day and maybe a time. `null`
 * means the time of day is not known, and the row says so (`time_known`).
 */
export function timeOn(day: string, instant: Date | null, timeZone: string): Date | null {
  return instant !== null && civilDateIn(instant, timeZone) === day ? instant : null;
}

/**
 * A movement of the source as the transactions module receives it (spec §7.2). Three things are
 * this file's own work, because the two shapes do not line up:
 *
 * 1. the amount is the contract's decimal text, made cents here with the core's own `parseCents`;
 * 2. `occurredAt` is required there and optional here, and one invariant decides it — see
 *    {@link occurredAtOf}: the civil date the app reads back from the stored instant is **always**
 *    `occurredOn`, the day the source itself stamped;
 * 3. a type or a state the plugin could not name falls back to the sign and to `cleared`, and a
 *    category the record carries by its id alone takes its name from the `/categories` read —
 *    §9.1 adopts a category by its exact name.
 */
/**
 * The category a movement counts under: the record's own when it carries one with its name — name
 * and group, measured at the collaudo — else the list's entry for its id. The record is preferred
 * whole: it also covers a category created between the `/categories` read and this window, and a
 * record saying "no group" is fresher than the list.
 */
function namedCategory(movement: SourceMovement, listed: SourceCategory | undefined) {
  const category = movement.category;
  const named = category !== null && category.name !== null ? category : listed;
  if (named === undefined)
    return { categoryName: null, categoryGroupExternalId: null, categoryGroupName: null };
  return {
    categoryName: named.name,
    categoryGroupExternalId: named.groupExternalId,
    categoryGroupName: named.groupName,
  };
}

/** The category a movement is filed under, by its record or, for an id alone, by the list. */
function categoryOf(movement: SourceMovement, categories: ReadonlyMap<string, SourceCategory>) {
  const category = movement.category;
  const listed = category === null ? undefined : categories.get(category.externalId);
  return {
    // The source's own word for a giroconto: its built-in Transfer category, whatever the record
    // type says. The source leaves such a movement out of its statistics, and so does the app.
    transfer: category?.transfer === true || listed?.transfer === true,
    categoryExternalId: category?.externalId ?? null,
    ...namedCategory(movement, listed),
  };
}

export function toIncomingMovement(
  movement: SourceMovement,
  categories: ReadonlyMap<string, SourceCategory>,
  timeZone: string,
): IncomingMovement {
  const { transfer, ...filed } = categoryOf(movement, categories);
  const amountCents = parseCents(movement.amount);
  const instant = movement.instant === null ? null : new Date(movement.instant);
  // A record this app wrote carries its marker in the note (`send.ts`): the plugin gives the note
  // the person's own again, and the key says which waiting movement the record is.
  return {
    externalId: movement.externalId,
    counterpartExternalId: movement.counterpartExternalId,
    occurredAt: occurredAtOf({ occurredAt: instant, occurredOn: movement.day }, timeZone),
    timeKnown: timeOn(movement.day, instant, timeZone) !== null,
    amountCents,
    currency: movement.currency,
    // A type the source did not name is the sign's, which is what `resolveType` (T3) concludes anyway.
    type: transfer ? "transfer" : (movement.type ?? (amountCents < 0n ? "expense" : "income")),
    // A state the source does not say is `cleared`, the column's own default: a movement it has happened.
    state: movement.state ?? "cleared",
    payee: movement.payee,
    note: movement.note,
    sentKey: movement.sentKey,
    ...filed,
    labels: movement.labels,
  };
}

/**
 * An account of the source as the accounts module's lifecycle rules receive it (spec §7.1). Only a
 * number that is an IBAN is kept (04-now.md §4.6.1): the plugin gives the source's number as it is.
 */
export function toRemoteAccount(account: SourceAccount, provider: string): RemoteAccount {
  const iban = normalizeIban(account.identifier);
  return {
    provider,
    providerAccountId: account.externalId,
    name: account.name,
    type: account.type,
    currency: account.currency,
    ...(iban ? { iban } : {}),
  };
}
