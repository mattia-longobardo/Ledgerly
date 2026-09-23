import "server-only";
import { and, asc, count, eq } from "drizzle-orm";
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
  parseInvestmentSheet,
  type PlatformInput,
  platformInputSchema,
  valuationInputSchema,
} from "./rules";
import { investmentMovements, investmentPlatforms, investmentValuations } from "./schema";

export type Platform = typeof investmentPlatforms.$inferSelect;
export type Movement = typeof investmentMovements.$inferSelect;
export type Valuation = typeof investmentValuations.$inferSelect;

export type InvestmentErrorCode =
  "not_found" | "duplicate_name" | "future_date" | "invalid_transaction" | "already_linked" | "empty_sheet";

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

// ——— The spreadsheet —————————————————————————————————————————————————————————————————————————

export interface SheetImport {
  imported: number;
  /** Rows already imported by an earlier run of the same file. */
  skipped: number;
  /** Line numbers that could not be read. */
  invalid: number[];
  /** Rows dated after today, left out. */
  future: number;
  platformsCreated: number;
}

/**
 * Imports the owner's spreadsheet: platforms are matched by name (case aside) and created when
 * missing; each row remembers where it came from, so a second import of the same file, or of the
 * same file with new rows at the bottom, adds only what is new.
 */
export async function importSheet(ctx: Pick<Ctx, "userId" | "timeZone">, text: string): Promise<SheetImport> {
  const { rows, invalid } = parseInvestmentSheet(text);
  if (rows.length === 0) throw new InvestmentError("empty_sheet");
  const todayOn = today(ctx.timeZone);
  const usable = rows.filter((row) => !isFutureDate(row.on, todayOn));
  const future = rows.length - usable.length;
  return getDb().transaction(async (tx) => {
    const existing = await tx
      .select({ id: investmentPlatforms.id, name: investmentPlatforms.name })
      .from(investmentPlatforms)
      .where(userScoped(ctx).owns(investmentPlatforms))
      .orderBy(asc(investmentPlatforms.name), asc(investmentPlatforms.id));
    const byName = new Map(existing.map((platform) => [platform.name.toLocaleLowerCase(), platform.id]));
    const missing = [
      ...new Map(usable.map((row) => [row.platform.toLocaleLowerCase(), row.platform])).entries(),
    ]
      .filter(([key]) => !byName.has(key))
      .map(([, name]) => name);
    if (missing.length > 0) {
      const created = await tx
        .insert(investmentPlatforms)
        .values(missing.map((name) => userScoped(ctx).stamp({ name, url: null })))
        .returning({ id: investmentPlatforms.id, name: investmentPlatforms.name });
      for (const platform of created) byName.set(platform.name.toLocaleLowerCase(), platform.id);
    }
    const written =
      usable.length === 0
        ? []
        : await tx
            .insert(investmentMovements)
            .values(
              usable.map((row) =>
                userScoped(ctx).stamp({
                  platformId: byName.get(row.platform.toLocaleLowerCase()) as string,
                  kind: row.kind,
                  amountCents: row.amountCents,
                  on: row.on,
                  sheetKey: row.key,
                }),
              ),
            )
            .onConflictDoNothing({ target: [investmentMovements.userId, investmentMovements.sheetKey] })
            .returning({ id: investmentMovements.id });
    return {
      imported: written.length,
      skipped: usable.length - written.length,
      invalid,
      future,
      platformsCreated: missing.length,
    };
  });
}
