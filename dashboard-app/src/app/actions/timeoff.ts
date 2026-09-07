"use server";

import { revalidatePath } from "next/cache";
import { db } from "@/lib/db";
import { openPrincipalConnection } from "@/modules/integrations/ui/principal-connection";
import { InvalidInputError, NotFoundError } from "@/modules/timeoff/application/errors";
import type { TimeoffCode, TimeoffEvent } from "@/modules/timeoff/application/ports";
import { removeEvent } from "@/modules/timeoff/application/remove-event";
import { setEvent } from "@/modules/timeoff/application/set-event";
import { drizzleTimeoffStore } from "@/modules/timeoff/infrastructure/trek-store";
import {
  disabledTrekSync,
  runTrekSync,
  type TrekSyncResult,
} from "@/modules/timeoff/infrastructure/trek-sync";
import { runForPrincipal } from "@/modules/timeoff/ui/deps";
import { PermissionDeniedError } from "@/platform/auth/principal";
import { errorMessage, fail, succeed, text, type ActionResult } from "./types";

const TIMEOFF_PATHS = ["/", "/company/time-off"] as const;

function revalidateTimeoff(): void {
  for (const path of TIMEOFF_PATHS) revalidatePath(path);
}

/** The one place a thrown error becomes copy the Time Off page can show. */
function mapError(err: unknown): string {
  if (err instanceof PermissionDeniedError) return "You do not have permission to change time off.";
  if (err instanceof NotFoundError) return "There is no time off booked on that day.";
  if (err instanceof InvalidInputError) return err.message;
  return errorMessage(err);
}

const CODES: readonly string[] = ["vacation", "comp", "permits", "sick", "other"];

/**
 * Books or changes one day.
 *
 * Local-first, and that is the whole design: the row is staged with
 * `pendingOp = 'upsert'` and the Trek sync sends it on. The edit therefore
 * survives Trek being down, and there is exactly one write route to the
 * provider — the same one the hourly pass takes. Nothing here talks to Trek.
 */
export async function setTimeoffEventAction(formData: FormData): Promise<ActionResult<TimeoffEvent>> {
  const date = text(formData.get("date")) ?? "";
  const fraction = text(formData.get("fraction")) ?? "1.00";
  const typeCode = text(formData.get("typeCode")) ?? "";
  const note = text(formData.get("note"));

  if (fraction !== "1.00" && fraction !== "0.50") {
    return fail("A day is booked either whole or half.");
  }
  if (!CODES.includes(typeCode)) return fail("Pick a time off type.");

  try {
    const saved = await runForPrincipal((deps, principal) =>
      setEvent(deps)(principal, { date, fraction, typeCode: typeCode as TimeoffCode, note }),
    );
    revalidateTimeoff();
    return succeed(saved);
  } catch (err) {
    return fail(mapError(err));
  }
}

/**
 * Removes one day. Whether the row is deleted outright or kept as a tombstone
 * for the sync to carry upstream is `removeEvent`'s decision, not this one's.
 */
export async function removeTimeoffEventAction(formData: FormData): Promise<ActionResult<null>> {
  const date = text(formData.get("date")) ?? "";

  try {
    await runForPrincipal((deps, principal) => removeEvent(deps)(principal, date));
    revalidateTimeoff();
    return succeed(null);
  } catch (err) {
    return fail(mapError(err));
  }
}

/**
 * The in-app "Sync now" — the replacement for the retired `syncLeaveNow`.
 *
 * Identical to what the hourly pass calls, deliberately: `runTrekSync` is a
 * plain function so the two cannot drift, and both contend for the same lock,
 * so pressing this while a pass runs comes back `skipped` rather than starting
 * a second conversation with Trek. `skipped` is reported as SUCCESS: nothing
 * was lost, the staged rows are still staged, and the pass that holds the lock
 * delivers them.
 */
export async function syncTimeoffNowAction(formData: FormData): Promise<ActionResult<TrekSyncResult>> {
  const rawYear = text(formData.get("year"));
  const year = rawYear === null ? new Date().getFullYear() : Number(rawYear);
  if (!Number.isInteger(year) || year < 2000 || year > 2100) return fail("That is not a valid year.");

  try {
    // Outside `runForPrincipal`: a sync talks to Trek over the network, and a
    // network call must never happen inside an open RLS transaction. The sync
    // takes a `TimeoffStore`, which opens one short context per database step.
    const opened = await openPrincipalConnection("trek");
    if (!opened) return succeed(disabledTrekSync(year));

    const sync = await runTrekSync({
      year,
      call: { config: { baseUrl: opened.credentials.baseUrl!, token: opened.credentials.token! } },
      userId: opened.connection.userId,
      store: drizzleTimeoffStore(db),
    });
    revalidateTimeoff();
    if (sync.status === "failed") {
      return fail(sync.errors[0] ?? "The time off sync failed. Trek did not answer.");
    }
    return succeed(sync);
  } catch (err) {
    return fail(mapError(err));
  }
}
