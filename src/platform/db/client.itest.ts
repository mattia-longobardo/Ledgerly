import { sql } from "drizzle-orm";
import { afterAll, describe, expect, it } from "vitest";
import { closeDatabase } from "../../../test/db";
import { getDb } from "./client";

describe("database client", () => {
  afterAll(closeDatabase);

  it("reaches Postgres 18 with native uuidv7()", async () => {
    const result = await getDb().execute<{ id: string; major: number }>(
      sql`SELECT uuidv7()::text AS id, current_setting('server_version_num')::int / 10000 AS major`,
    );
    expect(result.rows[0].id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-/);
    expect(result.rows[0].major).toBe(18);
  });
});
