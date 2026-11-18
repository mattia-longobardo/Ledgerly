import { and, desc, eq, isNull, ne } from "drizzle-orm";
import type { Ctx } from "../../../platform/context";
import { addDays, type CivilDate } from "../../../platform/dates";
import { getDb, type Tx } from "../../../platform/db/client";
import { userScoped } from "../../../platform/db/scope";
import {
  type AssetRef,
  type CoverageWindow,
  type HoldingsSnapshot,
  type KeyCheck,
} from "../../../platform/integrations/investments/source";
import type { Cents } from "../../../platform/money";
import {
  emptyReadingStatus,
  formatDecimal,
  type KeyCheckOrigin,
  missingPricesOf,
  parseDecimal,
  PRICE_SCALE,
  QUANTITY_SCALE,
  RATE_SCALE,
  type ReadingStatus,
} from "../rules";
import {
  investmentAssets,
  investmentEvents,
  investmentHoldings,
  investmentKeyChecks,
  investmentOperations,
  investmentReadingPositions,
  investmentReadings,
  investmentReadingScopes,
  investmentSyncCoverage,
} from "../schema";
import { type InvestmentAccount } from "../service";
import { ATTESTATION_TEXT_VERSIONS } from "./sources";

// ——— Writing what a source read ————————————————————————————————————————————————————————————

/** The asset a provider names, found by class and symbol or created (§1.4). */
export async function assetFor(ctx: Pick<Ctx, "userId">, tx: Tx, ref: AssetRef): Promise<string> {
  const find = async () =>
    (
      await tx
        .select({ id: investmentAssets.id })
        .from(investmentAssets)
        .where(
          and(
            userScoped(ctx).owns(investmentAssets),
            eq(investmentAssets.class, ref.class),
            eq(investmentAssets.symbol, ref.symbol),
            isNull(investmentAssets.mic),
          ),
        )
        .limit(1)
    )[0]?.id ?? null;
  const found = await find();
  if (found) return found;
  const [row] = await tx
    .insert(investmentAssets)
    .values(
      userScoped(ctx).stamp({
        class: ref.class,
        name: ref.name,
        symbol: ref.symbol,
        currency: ref.currency,
        priceSource: "provider" as const,
      }),
    )
    .onConflictDoNothing()
    .returning({ id: investmentAssets.id });
  return row?.id ?? (await find()) ?? "";
}

/** The provider's position of an asset in a product (§1.4), for the legs of its events. */
export async function providerHoldingFor(
  ctx: Pick<Ctx, "userId">,
  tx: Tx,
  investmentAccountId: string,
  assetId: string,
  product: string,
  on: CivilDate,
): Promise<string> {
  const where = and(
    userScoped(ctx).owns(investmentHoldings),
    eq(investmentHoldings.investmentAccountId, investmentAccountId),
    eq(investmentHoldings.assetId, assetId),
    eq(investmentHoldings.origin, "provider"),
    eq(investmentHoldings.product, product),
  );
  const [found] = await tx.select({ id: investmentHoldings.id }).from(investmentHoldings).where(where);
  if (found) return found.id;
  const [row] = await tx
    .insert(investmentHoldings)
    .values(
      userScoped(ctx).stamp({
        investmentAccountId,
        assetId,
        origin: "provider" as const,
        product,
        openedOn: on,
      }),
    )
    .returning({ id: investmentHoldings.id });
  return row.id;
}

interface ReadingWrite {
  on: CivilDate;
  observedAt: Date;
  status: ReadingStatus;
  totalCents: Cents;
  cashCents: Cents | null;
  externalAccountId: string;
  snapshot: HoldingsSnapshot | null;
  scopes: readonly { product: string; complete: boolean }[];
}

/** A reading of a day (§1.6): the last of the day replaces the earlier one, with its positions. */
export async function writeReading(
  ctx: Pick<Ctx, "userId">,
  tx: Tx,
  investment: InvestmentAccount,
  input: ReadingWrite,
) {
  await tx
    .delete(investmentReadings)
    .where(
      and(
        userScoped(ctx).owns(investmentReadings),
        eq(investmentReadings.investmentAccountId, investment.id),
        eq(investmentReadings.on, input.on),
      ),
    );
  const positions = input.snapshot?.positions ?? [];
  const [reading] = await tx
    .insert(investmentReadings)
    .values(
      userScoped(ctx).stamp({
        investmentAccountId: investment.id,
        on: input.on,
        observedAt: input.observedAt,
        status: input.status,
        totalCents: input.totalCents,
        cashCents: input.cashCents,
        missingPrices: missingPricesOf(
          positions.map((one) => ({
            valueCents: one.valueCents,
            quantity: parseDecimal(one.quantity, QUANTITY_SCALE),
          })),
        ),
      }),
    )
    .returning({ id: investmentReadings.id });
  for (const position of positions) {
    const assetId = await assetFor(ctx, tx, position.asset);
    await tx.insert(investmentReadingPositions).values(
      userScoped(ctx).stamp({
        readingId: reading.id,
        assetId,
        product: position.product,
        quantity: formatDecimal(parseDecimal(position.quantity, QUANTITY_SCALE), QUANTITY_SCALE),
        price:
          position.price === null
            ? null
            : formatDecimal(parseDecimal(position.price, PRICE_SCALE), PRICE_SCALE),
        priceCurrency: position.priceCurrency,
        priceAt: position.priceAt ?? input.observedAt,
        priceSource: position.priceSource,
        fxRate:
          position.fxRate === null || position.fxRate === undefined
            ? null
            : formatDecimal(parseDecimal(position.fxRate, RATE_SCALE), RATE_SCALE),
        fxSource: position.fxSource ?? null,
        valueCents: position.valueCents,
        costCents: position.costCents ?? null,
      }),
    );
  }
  if (input.scopes.length > 0) {
    await tx.insert(investmentReadingScopes).values(
      input.scopes.map((scope) =>
        userScoped(ctx).stamp({
          readingId: reading.id,
          externalAccountId: input.externalAccountId,
          product: scope.product,
          complete: scope.complete,
        }),
      ),
    );
  }
  return reading.id;
}

/** R5: a complete answer, a partial one, or an empty one that counts only when it is believable. */
export async function statusOf(
  ctx: Pick<Ctx, "userId">,
  tx: Tx,
  investment: InvestmentAccount,
  snapshot: HoldingsSnapshot,
  on: CivilDate,
): Promise<ReadingStatus> {
  if (!snapshot.empty) return snapshot.complete ? "complete" : "partial";
  const [previous] = await tx
    .select({ totalCents: investmentReadings.totalCents, status: investmentReadings.status })
    .from(investmentReadings)
    .where(
      and(
        userScoped(ctx).owns(investmentReadings),
        eq(investmentReadings.investmentAccountId, investment.id),
        ne(investmentReadings.status, "pending_zero"),
      ),
    )
    .orderBy(desc(investmentReadings.on))
    .limit(1);
  const since = addDays(on, -7);
  const withdrawals = await tx
    .select({ on: investmentEvents.on })
    .from(investmentOperations)
    .innerJoin(investmentEvents, eq(investmentEvents.id, investmentOperations.eventId))
    .where(
      and(
        userScoped(ctx).owns(investmentOperations),
        eq(investmentEvents.investmentAccountId, investment.id),
        eq(investmentOperations.kind, "withdrawal"),
      ),
    );
  return emptyReadingStatus({
    previousCents: previous?.totalCents ?? null,
    withdrawalWithin7Days: withdrawals.some((row) => row.on >= since && row.on <= on),
  });
}

export async function writeCoverage(
  ctx: Pick<Ctx, "userId">,
  tx: Tx,
  connectionId: string,
  kind: "holdings" | "flows",
  windows: readonly CoverageWindow[],
) {
  const streams = [...new Set(windows.map((window) => window.stream))];
  for (const stream of streams) {
    await tx
      .delete(investmentSyncCoverage)
      .where(
        and(
          userScoped(ctx).owns(investmentSyncCoverage),
          eq(investmentSyncCoverage.connectionId, connectionId),
          eq(investmentSyncCoverage.stream, stream),
        ),
      );
  }
  if (windows.length === 0) return;
  await tx.insert(investmentSyncCoverage).values(
    windows.map((window) =>
      userScoped(ctx).stamp({
        connectionId,
        kind,
        stream: window.stream,
        fromAt: window.fromAt,
        toAt: window.toAt,
        status: window.status,
        reason: window.reason,
      }),
    ),
  );
}

export async function insertKeyCheck(
  ctx: Pick<Ctx, "userId">,
  db: Tx | ReturnType<typeof getDb>,
  input: {
    investmentAccountId: string;
    connectionId: string | null;
    provider: string;
    origin: KeyCheckOrigin;
    check: KeyCheck | null;
    now: Date;
  },
) {
  await db.insert(investmentKeyChecks).values(
    userScoped(ctx).stamp({
      investmentAccountId: input.investmentAccountId,
      connectionId: input.connectionId,
      provider: input.provider,
      origin: input.origin,
      checkedAt: input.now,
      result: input.check?.result ?? ("error" as const),
      permissions: input.check?.permissions ?? {},
      ipRestricted: input.check?.ipRestricted ?? null,
      attestationTextVersion:
        input.origin === "connect" || input.origin === "replace"
          ? (ATTESTATION_TEXT_VERSIONS[input.provider] ?? null)
          : null,
    }),
  );
}

/** The key is no longer the connection's (replaced, disconnected, refused): ask to revoke it (SEC-07). */
export async function retireKeys(
  ctx: Pick<Ctx, "userId">,
  db: Tx | ReturnType<typeof getDb>,
  investmentAccountId: string,
  now: Date,
) {
  await db
    .update(investmentKeyChecks)
    .set({ retiredAt: now })
    .where(
      and(
        userScoped(ctx).owns(investmentKeyChecks),
        eq(investmentKeyChecks.investmentAccountId, investmentAccountId),
        isNull(investmentKeyChecks.retiredAt),
      ),
    );
}
