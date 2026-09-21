import "server-only";
import { Hono } from "hono";
import { z } from "zod";
import type { ApiEnv } from "@/platform/api/auth";
import { withToken } from "@/platform/api/auth";
import { fail } from "@/platform/api/errors";
import { centsFrom, instant, money } from "@/platform/api/json";
import { today } from "@/platform/dates";
import { AccountError } from "./service";
import { saveBalanceEntry } from "./service";
import { balancesOn, getAccount, listAccounts, listBalanceEntries } from "./queries";

/**
 * The accounts module's `/api/v1` routes (spec §4.2, §9.3). Nothing here reads a table: it calls
 * the module's own services, so the REST surface has no second implementation of anything (D5).
 *
 * Money leaves as a decimal string, never as a number: cents are `bigint` here and JSON has no
 * integer wide enough to be trusted with money.
 */
export const accountsApi = new Hono<ApiEnv>();

const MAX_ENTRIES = 200;

accountsApi.get("/accounts", withToken("read"), async (c) => {
  const ctx = c.get("ctx");
  const accounts = await listAccounts(ctx);
  const latest = await balancesOn(
    ctx,
    accounts.map((account) => account.id),
    today(ctx.timeZone),
  );
  return c.json({
    accounts: accounts.map((account) => ({
      id: account.id,
      name: account.name,
      type: account.type,
      currency: account.currency,
      origin: account.origin,
      state: account.state,
      inNetWorth: account.inNetWorth,
      countsAsLiquid: account.countsAsLiquid,
      balance: money(latest.get(account.id) ?? null),
      lastSyncedAt: instant(account.lastSyncedAt),
    })),
  });
});

accountsApi.get("/accounts/:id/balances", withToken("read"), async (c) => {
  const ctx = c.get("ctx");
  const id = z.uuid().safeParse(c.req.param("id"));
  if (!id.success) return fail(c, "invalid");
  // Another user's account is `not_found`, exactly as it is on the screen: `getAccount` is scoped.
  if (!(await getAccount(ctx, id.data))) return fail(c, "not_found");
  const limit = z.coerce
    .number()
    .int()
    .min(1)
    .max(MAX_ENTRIES)
    .catch(MAX_ENTRIES)
    .parse(c.req.query("limit"));
  const entries = await listBalanceEntries(ctx, id.data, limit);
  return c.json({
    balances: entries.map((entry) => ({
      id: entry.id,
      on: entry.on,
      balance: money(entry.balanceCents),
      available: money(entry.availableCents),
      source: entry.source,
      note: entry.note,
      capturedAt: instant(entry.capturedAt),
    })),
  });
});

/** A reading recorded by a script (spec §5.3 scope `write`): the same call the form makes. */
accountsApi.post("/accounts/:id/balances", withToken("write"), async (c) => {
  const ctx = c.get("ctx");
  const id = z.uuid().safeParse(c.req.param("id"));
  if (!id.success) return fail(c, "invalid");
  let body: Record<string, unknown>;
  try {
    body = (await c.req.json()) as Record<string, unknown>;
  } catch {
    return fail(c, "invalid");
  }
  // Amounts arrive as decimal strings and the services take `bigint` cents: the translation is
  // here, once, so no route re-invents a rounding of its own.
  const cents = centsFrom(body?.balance);
  if (cents === null) return fail(c, "invalid");
  const available =
    body?.available === undefined || body.available === null ? null : centsFrom(body.available);
  if (body?.available != null && available === null) return fail(c, "invalid");
  try {
    const entry = await saveBalanceEntry(ctx, id.data, {
      on: body?.on,
      cents,
      availableCents: available,
      note: body?.note ?? "",
    });
    return c.json(
      {
        id: entry.id,
        on: entry.on,
        balance: money(entry.balanceCents),
        source: entry.source,
      },
      201,
    );
  } catch (error) {
    if (error instanceof AccountError) return fail(c, error.code === "not_found" ? "not_found" : "invalid");
    if (error instanceof z.ZodError) return fail(c, "invalid");
    throw error;
  }
});
