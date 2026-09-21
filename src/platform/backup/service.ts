import "server-only";
import { spawn } from "node:child_process";
import { sql } from "drizzle-orm";
import { redactForLog } from "@/platform/auth/logger";
import type { Ctx } from "@/platform/context";
import { getDb } from "@/platform/db/client";
import { readEnv } from "@/platform/env";
import { BACKUP_LAST, readSetting } from "@/platform/settings/config";
import { appSettings } from "@/platform/settings/schema";
import { deleteObject, listFolder, putObject } from "@/platform/storage";

/**
 * The daily database backup (spec §10.2, §9.4): `pg_dump -Fc` into S3, thirty kept.
 *
 * The container's filesystem is read-only (spec §5.4), so the dump never touches a disk: it is
 * held in memory up to {@link MAX_BACKUP_BYTES} and uploaded in one call. That is the reason for
 * the cap — not a policy, a consequence — and a database that outgrows it needs a different
 * arrangement rather than a bigger number.
 *
 * The dump is **not encrypted**. A backup that only opens with the application's own key ring is a
 * backup that cannot help in the one situation it exists for: the application lost. It sits in a
 * private bucket, which is where the originals of every payslip already sit (plan F8 §3.6.2).
 */

export const BACKUP_FOLDER = "backups";
export const BACKUPS_KEPT = 30;
export const MAX_BACKUP_BYTES = 256 * 1024 * 1024;
/** A dump that has not finished by then is not going to: an admin is waiting on the button. */
export const DUMP_TIMEOUT_MS = 10 * 60_000;

export type BackupErrorCode = "forbidden" | "dump_failed" | "too_large" | "upload_failed";

export class BackupError extends Error {
  constructor(readonly code: BackupErrorCode) {
    super(code);
    this.name = "BackupError";
  }
}

export interface BackupResult {
  key: string;
  bytes: number;
  at: Date;
}

export type Dump = () => Promise<Uint8Array>;

/**
 * The connection as `pg_dump` wants it, in the **environment** and never on the command line: an
 * argument is visible in the process list, and one of these arguments is a password (spec §5.4).
 */
function connectionEnv(databaseUrl: string): Record<string, string> {
  const url = new URL(databaseUrl);
  return {
    PATH: process.env.PATH ?? "/usr/local/bin:/usr/bin:/bin",
    PGHOST: decodeURIComponent(url.hostname),
    PGPORT: url.port || "5432",
    PGUSER: decodeURIComponent(url.username),
    PGPASSWORD: decodeURIComponent(url.password),
    PGDATABASE: decodeURIComponent(url.pathname.replace(/^\//, "")),
    // `pg_dump` prints its errors in whatever language the environment asks for; the log wants one.
    LC_ALL: "C",
  };
}

/**
 * Runs `pg_dump -Fc` and collects its output. The custom format is compressed already and is what
 * `pg_restore` takes; `--no-owner` and `--no-privileges` so a restore into a fresh database does
 * not need the homelab's exact roles to exist first.
 */
export const dumpDatabase: Dump = () =>
  new Promise((resolve, reject) => {
    const child = spawn("pg_dump", ["-Fc", "--no-owner", "--no-privileges"], {
      env: connectionEnv(readEnv().DATABASE_URL) as NodeJS.ProcessEnv,
      stdio: ["ignore", "pipe", "pipe"],
    });
    const chunks: Buffer[] = [];
    let bytes = 0;
    let stderr = "";
    let failure: BackupError | undefined;
    const timer = setTimeout(() => {
      failure ??= new BackupError("dump_failed");
      child.kill("SIGKILL");
    }, DUMP_TIMEOUT_MS);

    child.stdout.on("data", (chunk: Buffer) => {
      bytes += chunk.length;
      if (bytes > MAX_BACKUP_BYTES) {
        failure ??= new BackupError("too_large");
        child.kill("SIGKILL");
        return;
      }
      chunks.push(chunk);
    });
    // Kept for the log only, and redacted: `pg_dump` quotes the connection it failed on.
    child.stderr.on("data", (chunk: Buffer) => {
      stderr = (stderr + chunk.toString("utf8")).slice(-2000);
    });
    child.on("error", () => {
      clearTimeout(timer);
      // `pg_dump` is not in the image, or cannot be executed.
      reject(failure ?? new BackupError("dump_failed"));
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      if (failure) return reject(failure);
      if (code !== 0) {
        console.error("[backup] pg_dump failed", redactForLog(stderr));
        return reject(new BackupError("dump_failed"));
      }
      resolve(Buffer.concat(chunks));
    });
  });

function requireAdminCtx(ctx: Pick<Ctx, "role">): void {
  if (ctx.role !== "admin") throw new BackupError("forbidden");
}

/** The key of a backup: sortable by name, which is how the retention finds the oldest. */
export function backupKey(at: Date): string {
  return `${BACKUP_FOLDER}/${at.toISOString().replaceAll(/[:.]/g, "-").toLowerCase()}.dump`;
}

/**
 * Takes a backup now. `deps.dump` is injectable so the integration tests do not need `pg_dump`
 * inside the test container — the real path is checked once, by hand, on the deployed site
 * (plan F8 §3.4.14).
 */
export async function backupNow(
  ctx: Pick<Ctx, "role">,
  deps: { dump: Dump } = { dump: dumpDatabase },
  now: Date = new Date(),
): Promise<BackupResult> {
  requireAdminCtx(ctx);
  return runBackup(deps.dump, now);
}

/** The same work without a person asking for it, for the daily job. */
export async function runBackup(dump: Dump, now: Date = new Date()): Promise<BackupResult> {
  const bytes = await dump();
  const key = backupKey(now);
  try {
    await putObject(key, bytes, "application/octet-stream");
  } catch (error) {
    console.error("[backup] could not store the dump", redactForLog(error));
    throw new BackupError("upload_failed");
  }
  const result: BackupResult = { key, bytes: bytes.length, at: now };
  const value = { key, bytes: bytes.length, at: now.toISOString() };
  await getDb()
    .insert(appSettings)
    .values({ key: BACKUP_LAST, value, updatedAt: now })
    .onConflictDoUpdate({ target: appSettings.key, set: { value, updatedAt: now } });
  return result;
}

/** What the Maintenance card says, or null while none has ever been taken. */
export async function lastBackup(): Promise<BackupResult | null> {
  const row = await readSetting(BACKUP_LAST);
  if (!row?.value?.key) return null;
  return {
    key: String(row.value.key),
    bytes: Number(row.value.bytes ?? 0),
    at: new Date(String(row.value.at)),
  };
}

/**
 * Keeps the newest {@link BACKUPS_KEPT} and drops the rest (spec §10.2). The keys sort by their
 * timestamp, so "newest" is the tail of the list and needs no metadata from the store.
 */
export async function pruneBackups(keep: number = BACKUPS_KEPT): Promise<number> {
  const stored = await listFolder(`${BACKUP_FOLDER}/`);
  const stale = stored.slice(0, Math.max(0, stored.length - keep));
  let deleted = 0;
  for (const object of stale) {
    try {
      await deleteObject(object.key);
      deleted += 1;
    } catch (error) {
      console.error("[backup] could not drop an old dump", redactForLog(error));
    }
  }
  return deleted;
}

/** The versions the Maintenance card prints (design row 889), read when it is rendered. */
export async function postgresVersion(): Promise<string | null> {
  try {
    const result = await getDb().execute<{ version: string }>(
      sql`select current_setting('server_version') as version`,
    );
    const rows = (result as unknown as { rows?: { version: string }[] }).rows ?? [];
    return rows[0]?.version ?? null;
  } catch (error) {
    console.error("[backup] could not read the server version", redactForLog(error));
    return null;
  }
}
