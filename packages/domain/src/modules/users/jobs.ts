import { asc, eq } from "drizzle-orm";
import { redactForLog } from "../../platform/auth/logger";
import { users } from "../../platform/auth/schema";
import type { AddonId } from "@ledgerly/api-contract";
import { addonOn, type Ctx } from "../../platform/context";
import { getDb } from "../../platform/db/client";
import { getSavedPreferences } from "./service";
import { buildCtx } from "./rules";

/** A user as a scheduled job meets them: who, and where to write if they must be told. */
export interface Person {
  id: string;
  email: string;
}

async function everyone(): Promise<Person[]> {
  return getDb().select({ id: users.id, email: users.email }).from(users).orderBy(asc(users.id));
}

/** One user as a job meets them, or null when the row is gone (the integrations dispatcher). */
export async function personById(id: string): Promise<Person | null> {
  const [row] = await getDb()
    .select({ id: users.id, email: users.email })
    .from(users)
    .where(eq(users.id, id));
  return row ?? null;
}

/** The context a job acts in for one user: their own language, zone and number format. */
export async function contextFor(person: Pick<Person, "id">): Promise<Ctx> {
  return buildCtx({ id: person.id }, await getSavedPreferences({ userId: person.id }));
}

/**
 * Runs `body` for every user — with `addon`, every user who has it on — keeping one user's failure to that user (spec §10.1). The counters
 * it returns become the job's recorded detail. Every module's jobs iterate this way.
 */
export async function forEachUser(
  job: string,
  body: (person: Person, ctx: Ctx) => Promise<void>,
  options: { addon?: AddonId } = {},
): Promise<{ users: number; failed: number }> {
  let failed = 0;
  const people = await everyone();
  for (const person of people) {
    try {
      const ctx = await contextFor(person);
      // A job of an addon the person has off does not run for them (H52, PA10): no write, no alert.
      if (options.addon && !addonOn(ctx, options.addon)) continue;
      await body(person, ctx);
    } catch (error) {
      failed += 1;
      console.error(`[${job}] failed for one user`, redactForLog(error));
    }
  }
  return { users: people.length, failed };
}
