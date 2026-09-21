import { afterAll, beforeEach, describe, expect, it } from "vitest";
import type { Ctx } from "@/platform/context";
import { getObject, listFolder, putObject } from "@/platform/storage";
import { closeDatabase, resetDatabase } from "../../../test/db";
import { createTestUser } from "../../../test/users";
import {
  BACKUP_FOLDER,
  BackupError,
  backupKey,
  backupNow,
  lastBackup,
  postgresVersion,
  pruneBackups,
} from "./service";

function contextFor(userId: string, role: "admin" | "user" = "admin"): Ctx {
  return { userId, role, locale: "en", timeZone: "Europe/Rome", numberFormat: "it-IT" };
}

const NOW = new Date("2026-09-21T12:00:00Z");
const DUMP = new TextEncoder().encode("PGDMP fake custom-format dump");

/**
 * The dump command is injected: the test container has no `pg_dump`, and what is worth testing
 * here is the storing, the record and the retention — the real command is verified once by hand on
 * the deployed site (plan F8 §3.4.14).
 */
const dump = { dump: async () => DUMP };

let admin: Ctx;

beforeEach(async () => {
  await resetDatabase();
  admin = contextFor((await createTestUser()).id);
  for (const object of await listFolder(`${BACKUP_FOLDER}/`)) {
    const { deleteObject } = await import("@/platform/storage");
    await deleteObject(object.key);
  }
});

afterAll(closeDatabase);

describe("backupNow", () => {
  it("refuses anyone who is not an admin", async () => {
    await expect(backupNow(contextFor(admin.userId, "user"), dump, NOW)).rejects.toMatchObject({
      code: "forbidden",
    });
  });

  it("stores the dump and records what it wrote", async () => {
    const result = await backupNow(admin, dump, NOW);
    expect(result.key).toBe(backupKey(NOW));
    expect(result.bytes).toBe(DUMP.length);
    expect(await getObject(result.key)).toEqual(DUMP);
    expect(await lastBackup()).toMatchObject({ key: result.key, bytes: DUMP.length });
    expect((await lastBackup())?.at.toISOString()).toBe(NOW.toISOString());
  });

  it("says nothing was stored when the dump itself failed", async () => {
    const failing = {
      dump: async () => {
        throw new BackupError("dump_failed");
      },
    };
    await expect(backupNow(admin, failing, NOW)).rejects.toMatchObject({ code: "dump_failed" });
    expect(await lastBackup()).toBeNull();
  });
});

describe("backupKey", () => {
  it("sorts by time, because that is how the retention finds the oldest", () => {
    const early = backupKey(new Date("2026-09-21T09:00:00Z"));
    const late = backupKey(new Date("2026-09-21T12:00:00Z"));
    expect([late, early].sort()).toEqual([early, late]);
  });
});

describe("pruneBackups", () => {
  it("keeps the newest and drops the rest", async () => {
    const keys = [
      backupKey(new Date("2026-09-19T12:00:00Z")),
      backupKey(new Date("2026-09-20T12:00:00Z")),
      backupKey(new Date("2026-09-21T12:00:00Z")),
    ];
    for (const key of keys) await putObject(key, DUMP, "application/octet-stream");

    expect(await pruneBackups(2)).toBe(1);
    expect(await getObject(keys[0])).toBeNull();
    expect(await getObject(keys[1])).not.toBeNull();
    expect(await getObject(keys[2])).not.toBeNull();
  });

  it("does nothing when there are fewer than it keeps", async () => {
    await putObject(backupKey(NOW), DUMP, "application/octet-stream");
    expect(await pruneBackups(30)).toBe(0);
  });
});

describe("postgresVersion", () => {
  it("is the server's own version, for the Maintenance card", async () => {
    expect(await postgresVersion()).toMatch(/^\d+/);
  });
});
