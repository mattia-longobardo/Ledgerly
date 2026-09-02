import { sql } from "drizzle-orm";
import type { DbClient } from "./client";

/**
 * Bootstrap the owner from the legacy allowlist, once. After this the users
 * table governs access and AUTHORIZED_SUB is read only while the table is empty.
 */
export async function bootstrapOwner(
  db: DbClient,
  input: { subject: string; email?: string | null },
): Promise<{ created: boolean }> {
  const result = await db.execute(sql`
    WITH org AS (SELECT id FROM organizations ORDER BY created_at LIMIT 1),
    u AS (
      INSERT INTO users (organization_id, email, display_name)
      SELECT org.id, ${input.email ?? null}, 'Owner' FROM org
      WHERE NOT EXISTS (SELECT 1 FROM users)
      RETURNING id
    ),
    r AS (INSERT INTO user_roles (user_id, role_code) SELECT id, 'owner' FROM u)
    INSERT INTO user_identities (user_id, provider, subject) SELECT id, 'authentik', ${input.subject} FROM u
  `);
  return { created: (result.rowCount ?? 0) > 0 };
}
