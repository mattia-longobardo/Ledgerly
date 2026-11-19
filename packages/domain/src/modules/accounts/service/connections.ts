import { z } from "zod";
import { and, asc, eq, inArray, sql } from "drizzle-orm";
import type { Ctx } from "../../../platform/context";
import { getDb } from "../../../platform/db/client";
import { hasPgError, UNIQUE_VIOLATION } from "../../../platform/db/errors";
import { userScoped } from "../../../platform/db/scope";
import { groupBy } from "../../../shared/collections";
import { CONNECTION_CHANNELS } from "../rules";
import { accountConnections } from "../schema";
import { AccountError, requireAccount } from "./guards";

// ——— What hangs off an account (spec §7.1; owner, 2026-09-21) ———————————————————————————————————

export type AccountConnection = typeof accountConnections.$inferSelect;

const connectionSchema = z.object({
  channel: z.enum(CONNECTION_CHANNELS),
  name: z.string().trim().min(1).max(60),
  note: z
    .string()
    .trim()
    .max(120)
    .transform((value) => (value === "" ? null : value))
    .nullable()
    .default(null),
});
export type ConnectionInput = z.input<typeof connectionSchema>;

/** The unique key is case-insensitive, so "Paypal" twice on one channel is one connection. */
function connectionWrite<T>(write: Promise<T>): Promise<T> {
  return write.catch((error: unknown) => {
    if (hasPgError(error, UNIQUE_VIOLATION, "account_connections_uq")) {
      throw new AccountError("duplicate_connection");
    }
    throw error;
  });
}

/**
 * Everything hanging off one account, the IBAN's before the card's and alphabetical inside each:
 * the order a person reads a list in, and one a second query cannot shuffle.
 */
export async function connectionsOf(
  ctx: Pick<Ctx, "userId">,
  accountId: string,
): Promise<AccountConnection[]> {
  return getDb()
    .select()
    .from(accountConnections)
    .where(and(eq(accountConnections.accountId, accountId), userScoped(ctx).owns(accountConnections)))
    .orderBy(
      asc(accountConnections.channel),
      asc(sql`lower(${accountConnections.name})`),
      asc(accountConnections.id),
    );
}

/** The same, for several accounts at once: the list page draws them all and asks once. */
export async function connectionsByAccount(
  ctx: Pick<Ctx, "userId">,
  accountIds: readonly string[],
): Promise<Map<string, AccountConnection[]>> {
  if (accountIds.length === 0) return new Map();
  const rows = await getDb()
    .select()
    .from(accountConnections)
    .where(
      and(userScoped(ctx).owns(accountConnections), inArray(accountConnections.accountId, [...accountIds])),
    )
    .orderBy(
      asc(accountConnections.channel),
      asc(sql`lower(${accountConnections.name})`),
      asc(accountConnections.id),
    );
  return groupBy(rows, (row) => row.accountId);
}

export async function addConnection(
  ctx: Pick<Ctx, "userId">,
  accountId: string,
  input: ConnectionInput,
): Promise<AccountConnection> {
  await requireAccount(ctx, accountId);
  const parsed = connectionSchema.safeParse(input);
  if (!parsed.success) throw new AccountError("invalid");
  const [row] = await connectionWrite(
    getDb()
      .insert(accountConnections)
      .values(userScoped(ctx).stamp({ accountId, ...parsed.data }))
      .returning(),
  );
  return row;
}

export async function updateConnection(
  ctx: Pick<Ctx, "userId">,
  id: string,
  input: ConnectionInput,
): Promise<AccountConnection> {
  const parsed = connectionSchema.safeParse(input);
  if (!parsed.success) throw new AccountError("invalid");
  const [row] = await connectionWrite(
    getDb()
      .update(accountConnections)
      .set(parsed.data)
      .where(and(eq(accountConnections.id, id), userScoped(ctx).owns(accountConnections)))
      .returning(),
  );
  if (!row) throw new AccountError("not_found");
  return row;
}

export async function removeConnection(ctx: Pick<Ctx, "userId">, id: string): Promise<void> {
  const removed = await getDb()
    .delete(accountConnections)
    .where(and(eq(accountConnections.id, id), userScoped(ctx).owns(accountConnections)))
    .returning({ id: accountConnections.id });
  if (removed.length === 0) throw new AccountError("not_found");
}
