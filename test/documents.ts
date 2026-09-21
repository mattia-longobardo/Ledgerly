// test/documents.ts — raw access to imported documents, for integration tests that stage a state
// the services never produce by themselves (a stuck reading, a lost original, an expired one).
import { eq } from "drizzle-orm";
import { documents } from "@/modules/imports/schema";
import { getDb } from "@/platform/db/client";

type Patch = Partial<typeof documents.$inferInsert>;

export async function patchDocument(id: string, patch: Patch): Promise<void> {
  await getDb().update(documents).set(patch).where(eq(documents.id, id));
}

/** Every document row, whoever owns it; `userId` narrows it to one person's. */
export async function allDocuments(userId?: string) {
  const query = getDb().select().from(documents);
  return userId ? query.where(eq(documents.userId, userId)) : query;
}
