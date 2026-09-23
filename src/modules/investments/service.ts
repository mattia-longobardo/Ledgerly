import "server-only";
import { and, count, eq } from "drizzle-orm";
import { isFutureDate } from "@/modules/accounts/rules";
import { getTransaction } from "@/modules/transactions/queries";
import type { Ctx } from "@/platform/context";
import { today } from "@/platform/dates";
import { getDb } from "@/platform/db/client";
import { hasPgError, UNIQUE_VIOLATION } from "@/platform/db/errors";
import { userScoped } from "@/platform/db/scope";
import type { Cents } from "@/platform/money";
import {
  type MovementInput,
  movementInputSchema,
  type MovementKind,
  type PlatformInput,
  platformInputSchema,
  valuationInputSchema,
} from "./rules";
import { investmentMovements, investmentPlatforms, investmentValuations } from "./schema";

export type Platform = typeof investmentPlatforms.$inferSelect;
export type Movement = typeof investmentMovements.$inferSelect;
export type Valuation = typeof investmentValuations.$inferSelect;

export type InvestmentErrorCode =
  "not_found" | "duplicate_name" | "future_date" | "invalid_transaction" | "already_linked";

export class InvestmentError extends Error {
  constructor(readonly code: InvestmentErrorCode) {
    super(code);
    this.name = "InvestmentError";
  }
}

async function requirePlatform(ctx: Pick<Ctx, "userId">, id: string): Promise<Platform> {
  const [row] = await getDb()
    .select()
    .from(investmentPlatforms)
    .where(and(eq(investmentPlatforms.id, id), userScoped(ctx).owns(investmentPlatforms)));
  if (!row) throw new InvestmentError("not_found");
  return row;
}

async function requireMovement(ctx: Pick<Ctx, "userId">, id: string): Promise<Movement> {
  const [row] = await getDb()
    .select()
    .from(investmentMovements)
    .where(and(eq(investmentMovements.id, id), userScoped(ctx).owns(investmentMovements)));
  if (!row) throw new InvestmentError("not_found");
  return row;
}

function translated<T>(write: Promise<T>): Promise<T> {
  return write.catch((error: unknown) => {
    if (hasPgError(error, UNIQUE_VIOLATION, "investment_platforms_user_name_uq")) {
      throw new InvestmentError("duplicate_name");
    }
    if (hasPgError(error, UNIQUE_VIOLATION, "investment_movements_transaction_uq")) {
      throw new InvestmentError("already_linked");
    }
    throw error;
  });
}

/**
 * A bank movement may document a platform movement only when it is the person's own and goes the
 * same way: money out of the account for a deposit, money into it for a withdrawal.
 */
async function requireLinkable(
  ctx: Pick<Ctx, "userId">,
  transactionId: string | null,
  kind: MovementKind,
): Promise<void> {
  if (transactionId === null) return;
  const transaction = await getTransaction(ctx, transactionId);
  if (!transaction) throw new InvestmentError("invalid_transaction");
  const outgoing = transaction.amountCents < 0n;
  if ((kind === "deposit") !== outgoing || transaction.amountCents === 0n) {
    throw new InvestmentError("invalid_transaction");
  }
}

// ——— Platforms —————————————————————————————————————————————————————————————————————————————

export async function createPlatform(ctx: Pick<Ctx, "userId">, input: PlatformInput): Promise<Platform> {
  const parsed = platformInputSchema.parse(input);
  const [row] = await translated(
    getDb().insert(investmentPlatforms).values(userScoped(ctx).stamp(parsed)).returning(),
  );
  return row;
}

export async function updatePlatform(
  ctx: Pick<Ctx, "userId">,
  id: string,
  input: PlatformInput,
): Promise<Platform> {
  await requirePlatform(ctx, id);
  const parsed = platformInputSchema.parse(input);
  const [row] = await translated(
    getDb()
      .update(investmentPlatforms)
      .set(parsed)
      .where(and(eq(investmentPlatforms.id, id), userScoped(ctx).owns(investmentPlatforms)))
      .returning(),
  );
  return row;
}

/** Deletes a platform and its history; says how many movements went with it. */
export async function deletePlatform(ctx: Pick<Ctx, "userId">, id: string): Promise<{ movements: number }> {
  await requirePlatform(ctx, id);
  return getDb().transaction(async (tx) => {
    const [{ movements }] = await tx
      .select({ movements: count() })
      .from(investmentMovements)
      .where(and(eq(investmentMovements.platformId, id), userScoped(ctx).owns(investmentMovements)));
    await tx
      .delete(investmentPlatforms)
      .where(and(eq(investmentPlatforms.id, id), userScoped(ctx).owns(investmentPlatforms)));
    return { movements };
  });
}

// ——— Movements —————————————————————————————————————————————————————————————————————————————

async function checkedMovement(ctx: Pick<Ctx, "userId" | "timeZone">, input: MovementInput) {
  const parsed = movementInputSchema.parse(input);
  if (isFutureDate(parsed.on, today(ctx.timeZone))) throw new InvestmentError("future_date");
  await requirePlatform(ctx, parsed.platformId);
  await requireLinkable(ctx, parsed.transactionId, parsed.kind);
  return parsed;
}

export async function createMovement(
  ctx: Pick<Ctx, "userId" | "timeZone">,
  input: MovementInput,
): Promise<Movement> {
  const parsed = await checkedMovement(ctx, input);
  const [row] = await translated(
    getDb().insert(investmentMovements).values(userScoped(ctx).stamp(parsed)).returning(),
  );
  return row;
}

export async function updateMovement(
  ctx: Pick<Ctx, "userId" | "timeZone">,
  id: string,
  input: MovementInput,
): Promise<Movement> {
  await requireMovement(ctx, id);
  const parsed = await checkedMovement(ctx, input);
  const [row] = await translated(
    getDb()
      .update(investmentMovements)
      .set(parsed)
      .where(and(eq(investmentMovements.id, id), userScoped(ctx).owns(investmentMovements)))
      .returning(),
  );
  return row;
}

export async function deleteMovement(ctx: Pick<Ctx, "userId">, id: string): Promise<void> {
  await requireMovement(ctx, id);
  await getDb()
    .delete(investmentMovements)
    .where(and(eq(investmentMovements.id, id), userScoped(ctx).owns(investmentMovements)));
}

// ——— Valuations ————————————————————————————————————————————————————————————————————————————

/** "Update value": what the platform shows today (or on a past day). A second one that day replaces it. */
export async function setValuation(
  ctx: Pick<Ctx, "userId" | "timeZone">,
  platformId: string,
  input: { valueCents: Cents; on: string },
): Promise<void> {
  const parsed = valuationInputSchema.parse(input);
  if (isFutureDate(parsed.on, today(ctx.timeZone))) throw new InvestmentError("future_date");
  await requirePlatform(ctx, platformId);
  await getDb()
    .insert(investmentValuations)
    .values(userScoped(ctx).stamp({ platformId, on: parsed.on, valueCents: parsed.valueCents }))
    .onConflictDoUpdate({
      target: [investmentValuations.platformId, investmentValuations.on],
      set: { valueCents: parsed.valueCents },
    });
}

export async function deleteValuation(ctx: Pick<Ctx, "userId">, id: string): Promise<void> {
  const [row] = await getDb()
    .delete(investmentValuations)
    .where(and(eq(investmentValuations.id, id), userScoped(ctx).owns(investmentValuations)))
    .returning({ id: investmentValuations.id });
  if (!row) throw new InvestmentError("not_found");
}
