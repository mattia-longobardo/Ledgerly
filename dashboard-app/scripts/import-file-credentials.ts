import { readFileSync } from "node:fs";
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import * as schema from "@/lib/db/schema";
import type { DbClient } from "@/lib/db/client";
import { ownerUserId } from "@/platform/auth/owner";
import { withSystemContext, withUserContext } from "@/platform/db/context";
import { permissionsForRoles } from "@/platform/auth/permissions";
import { createCredentialCipher } from "@/platform/integrations/crypto";
import { providerRegistry } from "@/platform/integrations/registry";
import { ensureProvidersRegistered } from "@/platform/integrations/register-all";
import { recordAudit } from "@/platform/audit/record";
import type { IntegrationDeps } from "@/modules/integrations/application/deps";
import { DrizzleConnectionsRepository } from "@/modules/integrations/infrastructure/drizzle-connections-repository";
import { DrizzleSyncJobsRepository } from "@/modules/integrations/infrastructure/drizzle-sync-jobs-repository";
import { DrizzleSyncRunsRepository } from "@/modules/integrations/infrastructure/drizzle-sync-runs-repository";
import { DrizzleWebhookDeliveriesRepository } from "@/modules/integrations/infrastructure/drizzle-webhook-deliveries-repository";
import {
  importFileCredentials,
  type FileCredentials,
} from "@/modules/integrations/application/import-file-credentials";
import { users } from "@/lib/db/schema";
import { eq } from "drizzle-orm";

/**
 * A mounted secret, or null when there is genuinely no file there.
 *
 * "Missing" and "unreadable" are deliberately NOT the same answer. A file that
 * exists but cannot be read — wrong owner, wrong mode, a directory where a file
 * was expected — is a deployment mistake, and swallowing it would report
 * `skipped: no_file` in the runbook's success check while the credential
 * silently failed to migrate. Only ENOENT is a legitimate "not mounted".
 */
function readTrimmed(path: string | undefined): string | null {
  if (!path) return null;
  let value: string;
  try {
    value = readFileSync(path, "utf8");
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw new Error(
      `Could not read ${path}: ${err instanceof Error ? err.message : String(err)}. ` +
        "Fix the mount or its permissions and re-run; do not treat this as 'not configured'.",
    );
  }
  const trimmed = value.trim();
  return trimmed === "" ? null : trimmed;
}

async function main(): Promise<void> {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL is required");
  const encryptionKey = process.env.APP_ENCRYPTION_KEY;
  if (!encryptionKey) throw new Error("APP_ENCRYPTION_KEY is required");

  ensureProvidersRegistered();
  const pool = new Pool({ connectionString: url, max: 2 });
  try {
    const db = drizzle(pool, { schema }) as unknown as DbClient;
    const owner = await ownerUserId(db);
    if (!owner) throw new Error("No active owner; run the app once so the bootstrap seed can run");
    const [row] = await db.select({ organizationId: users.organizationId }).from(users).where(eq(users.id, owner));

    const walletToken = readTrimmed(process.env.WALLET_TOKEN_FILE ?? "/secrets/wallet-token");
    const trekToken = readTrimmed(process.env.TREK_TOKEN_FILE ?? "/secrets/trek-token");
    const trekUrl = process.env.TREK_URL?.trim();
    const files: FileCredentials = {
      ...(walletToken ? { wallet: { token: walletToken } } : {}),
      ...(trekToken && trekUrl && trekUrl !== "https://"
        ? { trek: { baseUrl: trekUrl.replace(/\/+$/, ""), token: trekToken } }
        : {}),
    };

    // The deps bag is assembled by hand rather than through `integrationDeps`,
    // because that calls `credentialCipher()` → `env()`, and Ruling R16 keeps
    // one-off scripts off the full application environment. It is the same
    // shape, built around a cipher made from `APP_ENCRYPTION_KEY` alone.
    const cipher = createCredentialCipher(encryptionKey);
    const buildDeps = (client: DbClient): IntegrationDeps => ({
      connections: new DrizzleConnectionsRepository(client),
      jobs: new DrizzleSyncJobsRepository(client),
      runs: new DrizzleSyncRunsRepository(client),
      deliveries: new DrizzleWebhookDeliveriesRepository(client),
      cipher,
      registry: providerRegistry,
      db: client,
      clock: { now: () => new Date() },
      audit: (e) => recordAudit(client, e),
      inUserContext: (userId, fn) => withUserContext(db, { userId }, (tx) => fn(buildDeps(tx))),
      inSystemContext: (fn) => withSystemContext(db, (tx) => fn(buildDeps(tx))),
    });

    const result = await importFileCredentials(buildDeps(db))(
      {
        userId: owner,
        organizationId: row!.organizationId,
        roles: ["owner"],
        permissions: permissionsForRoles(["owner"]),
      },
      files,
    );

    console.log(JSON.stringify(result, null, 2));
  } finally {
    await pool.end();
  }
}

await main();
