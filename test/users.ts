import { randomUUID } from "node:crypto";
import { getDb } from "@/platform/db/client";
import { users } from "@/platform/auth/schema";

/** Inserts a bare user row (no credentials) for service-level tests. */
export async function createTestUser(email = `${randomUUID()}@example.test`) {
  const [row] = await getDb()
    .insert(users)
    .values({ email, name: email.split("@")[0], role: "user" })
    .returning({ id: users.id, email: users.email });
  return row;
}
