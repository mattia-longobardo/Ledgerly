import { and, asc, desc, eq } from "drizzle-orm";
import type { Ctx } from "../../../platform/context";
import { getDb } from "../../../platform/db/client";
import { userScoped } from "../../../platform/db/scope";
import { type Connection } from "../../../platform/integrations/service";
import { providerOf } from "../catalog";
import { investmentKeyChecks, investmentSyncCoverage } from "../schema";
import { type InvestmentAccount } from "../service";
import { connectionOf } from "./connect";

// ——— What the service page shows (§4.3) ——————————————————————————————————————————————————————

export interface SyncStatus {
  provider: string;
  connected: boolean;
  state: Connection["state"] | null;
  lastOkAt: Date | null;
  lastError: string | null;
  nextSyncAt: Date | null;
  lastCheck: {
    result: (typeof investmentKeyChecks.$inferSelect)["result"];
    checkedAt: Date;
    ipRestricted: boolean | null;
  } | null;
  keySetAt: Date | null;
  /** Retired keys not yet confirmed revoked at the provider (SEC-07). */
  revokePending: boolean;
  /** 90 days after the key was set: time to rotate it (§5.3). */
  rotateDue: boolean;
  coverage: {
    kind: string;
    stream: string;
    fromAt: Date;
    toAt: Date;
    status: (typeof investmentSyncCoverage.$inferSelect)["status"];
    reason: string | null;
  }[];
  /** The first day from which every flow is covered (§2.4); `null` while one never is. */
  reliableFrom: Date | null;
  complete: boolean;
}

const ROTATE_AFTER_MS = 90 * 86_400_000;

export async function syncStatus(
  ctx: Pick<Ctx, "userId">,
  investment: InvestmentAccount,
  now: Date = new Date(),
): Promise<SyncStatus | null> {
  const checks = await getDb()
    .select()
    .from(investmentKeyChecks)
    .where(
      and(
        userScoped(ctx).owns(investmentKeyChecks),
        eq(investmentKeyChecks.investmentAccountId, investment.id),
      ),
    )
    .orderBy(desc(investmentKeyChecks.checkedAt), desc(investmentKeyChecks.id));
  const connection = investment.provider === "manual" ? null : await connectionOf(ctx, investment.provider);
  if (!connection && checks.length === 0) return null;
  const coverage = connection
    ? await getDb()
        .select()
        .from(investmentSyncCoverage)
        .where(
          and(
            userScoped(ctx).owns(investmentSyncCoverage),
            eq(investmentSyncCoverage.connectionId, connection.id),
          ),
        )
        .orderBy(asc(investmentSyncCoverage.stream), asc(investmentSyncCoverage.fromAt))
    : [];
  const flows = coverage.filter((row) => row.kind === "flows");
  const streams = [...new Set(flows.map((row) => row.stream))];
  let reliableFrom: Date | null = null;
  let complete = streams.length > 0;
  for (const stream of streams) {
    const rows = flows.filter((row) => row.stream === stream);
    const last = rows.at(-1);
    if (!last || last.status !== "complete") {
      complete = false;
      reliableFrom = null;
      break;
    }
    if (rows.some((row) => row.status !== "complete")) complete = false;
    if (reliableFrom === null || last.fromAt > reliableFrom) reliableFrom = last.fromAt;
  }
  const active = checks.filter((check) => check.retiredAt === null);
  const set =
    active.filter((check) => check.origin === "connect" || check.origin === "replace").at(0) ?? null;
  const last = active[0] ?? null;
  return {
    provider: investment.provider === "manual" ? (checks[0]?.provider ?? "manual") : investment.provider,
    connected: connection !== null,
    state: connection?.state ?? null,
    lastOkAt: connection?.lastOkAt ?? null,
    lastError: connection?.lastError ?? null,
    nextSyncAt: connection?.nextSyncAt ?? null,
    lastCheck: last
      ? { result: last.result, checkedAt: last.checkedAt, ipRestricted: last.ipRestricted }
      : null,
    keySetAt: set?.checkedAt ?? null,
    revokePending: checks.some((check) => check.retiredAt !== null && check.revokedAtProviderAt === null),
    rotateDue: set !== null && now.getTime() - set.checkedAt.getTime() >= ROTATE_AFTER_MS,
    coverage: coverage.map((row) => ({
      kind: row.kind,
      stream: row.stream,
      fromAt: row.fromAt,
      toAt: row.toAt,
      status: row.status,
      reason: row.reason,
    })),
    reliableFrom: complete ? null : reliableFrom,
    complete,
  };
}

/** The name of an investment provider as a person knows it; its id when the catalogue has none. */
export function investmentProviderName(provider: string): string {
  return providerOf(provider)?.name ?? provider;
}
