import "server-only";
import { asc } from "drizzle-orm";
import { redactForLog } from "@/platform/auth/logger";
import { users } from "@/platform/auth/schema";
import type { Ctx } from "@/platform/context";
import { getDb } from "@/platform/db/client";
import { numberStyle } from "@/platform/format";
import { getPreferences } from "./service";

/** A user as a scheduled job meets them: who, and where to write if they must be told. */
export interface Person {
  id: string;
  email: string;
}

async function everyone(): Promise<Person[]> {
  return getDb().select({ id: users.id, email: users.email }).from(users).orderBy(asc(users.id));
}

/** The context a job acts in for one user: their own language, zone and number format. */
export async function contextFor(person: Pick<Person, "id">): Promise<Ctx> {
  const preferences = await getPreferences({ userId: person.id });
  return {
    userId: person.id,
    role: "user",
    locale: preferences.locale,
    timeZone: preferences.timeZone,
    numberFormat: numberStyle(preferences),
  };
}

/**
 * Runs `body` for every user, keeping one user's failure to that user (spec §10.1). The counters
 * it returns become the job's recorded detail. Every module's jobs iterate this way.
 */
export async function forEachUser(
  job: string,
  body: (person: Person, ctx: Ctx) => Promise<void>,
): Promise<{ users: number; failed: number }> {
  let failed = 0;
  const people = await everyone();
  for (const person of people) {
    try {
      await body(person, await contextFor(person));
    } catch (error) {
      failed += 1;
      console.error(`[${job}] failed for one user`, redactForLog(error));
    }
  }
  return { users: people.length, failed };
}
