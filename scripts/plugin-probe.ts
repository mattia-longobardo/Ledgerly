// scripts/plugin-probe.ts — reads a bank through its plugin and prints numbers only.
//
// For the trial on a real bank (rewrite plan, 04-now.md §4.2) and for whoever has to say what a
// bank exposes: it calls `POST /sync` with the sealed credentials of every connection of a plugin
// and prints the measures of `measureReading` — counts, never a name, a number of an account, an
// amount or a text. It writes nothing to the database.
//
// Run it where both the database and the plugin answer (see docs/operations.md, "Plugins"):
//   node --conditions=react-server --import tsx scripts/plugin-probe.ts [--from YYYY-MM-DD]
import { createHash } from "node:crypto";
import { and, eq, like } from "drizzle-orm";
import { openJson, parseKeyRing } from "../src/platform/crypto";
import { civilDateIn } from "../src/platform/dates";
import { getDb, getPool } from "../src/platform/db/client";
import { readEnv } from "../src/platform/env";
import { integrationConnections } from "../src/platform/integrations/schema";
import { callPlugin, PluginCallError } from "../src/platform/plugins/client";
import { accountSchema, PLUGIN_PATHS, type SyncResponse, syncResponseSchema } from "@plugin-contract/calls";
import { configuredPlugin } from "../src/platform/plugins/queries";
import { measureReading } from "../src/platform/plugins/rules";
import { pluginUserCredentials } from "../src/platform/plugins/schema";

const fromAt = process.argv.indexOf("--from");
const from = fromAt > 0 ? process.argv[fromAt + 1] : null;
if (from !== null && !/^\d{4}-\d{2}-\d{2}$/.test(from)) throw new Error("--from wants YYYY-MM-DD");

const asFixture = process.argv.includes("--fixture");

/** A text with its shape and none of its content: letters to `x`/`X`, digits to `9`. */
function scrub(text: string): string {
  return text
    .replace(/\p{Lu}/gu, "X")
    .replace(/\p{Ll}/gu, "x")
    .replace(/\d/g, "9");
}

/** A bank's own code keeps its four-letter ISO tokens (`PMNT`); the rest is scrubbed. */
function scrubCode(code: string): string {
  return code
    .split(" · ")
    .map((part) => (/^[A-Z]{4}$/.test(part) ? part : scrub(part)))
    .join(" · ");
}

/** An amount with the same number of digits and other digits. */
function scrubAmount(amount: string, salt: number): string {
  let position = 0;
  return amount
    .replace(/\d/g, (digit) => String((Number(digit) * 7 + 3 + salt + position++) % 10))
    .replace(/^0(?=\d)/, "1");
}

/** A day moved back by a fixed number of days: the order and the gaps stay, the days do not. */
function shiftDay(day: string | null): string | null {
  if (day === null) return null;
  return new Date(Date.parse(`${day}T00:00:00Z`) - 417 * 86_400_000).toISOString().slice(0, 10);
}

/**
 * A reading with nothing of the person in it: the shapes of the texts, the kinds, the codes and
 * the order of the days, on a sample of the movements. For the fixtures of the tests.
 */
function anonymous(
  accounts: {
    externalId: string;
    kind: string | null;
    currency: string;
    name: string | null;
    identifier: string | null;
    stableId: string | null;
  }[],
  batches: SyncResponse[],
) {
  const alias = new Map(accounts.map((account, index) => [account.externalId, `account-${index + 1}`]));
  const all = batches.flatMap((batch) => batch.transactions);
  const step = Math.max(1, Math.floor(all.length / 40));
  return {
    accounts: accounts.map((account, index) => ({
      externalId: alias.get(account.externalId),
      stableId: account.stableId === null ? null : `stable-${index + 1}`,
      name: account.name === null ? null : scrub(account.name),
      identifier: account.identifier === null ? null : scrub(account.identifier),
      currency: account.currency,
      kind: account.kind,
    })),
    balances: batches.flatMap((batch) =>
      batch.accounts.map((account, index) => ({
        externalId: alias.get(account.externalId),
        error: account.error,
        balances: account.balances.map((balance) => ({
          ...balance,
          amount: scrubAmount(balance.amount, index),
          date: shiftDay(balance.date),
        })),
      })),
    ),
    transactions: all
      .filter((_, index) => index % step === 0)
      .map((one, index) => ({
        ...one,
        accountExternalId: alias.get(one.accountExternalId),
        externalId: one.externalId === null ? null : scrub(one.externalId),
        bookingDate: shiftDay(one.bookingDate),
        valueDate: shiftDay(one.valueDate),
        amount: scrubAmount(one.amount, index),
        text: one.text.map(scrub),
        counterparty: one.counterparty === null ? null : scrub(one.counterparty),
        bankTransactionCode: one.bankTransactionCode === null ? null : scrubCode(one.bankTransactionCode),
      })),
  };
}

const ring = parseKeyRing(readEnv().APP_ENCRYPTION_KEY);
const connections = await getDb()
  .select()
  .from(integrationConnections)
  .where(like(integrationConnections.provider, "plugin:%"))
  .orderBy(integrationConnections.createdAt);

for (const [index, connection] of connections.entries()) {
  const pluginId = connection.provider.slice("plugin:".length);
  const plugin = configuredPlugin(pluginId);
  const [saved] = await getDb()
    .select({ credentials: pluginUserCredentials.credentials })
    .from(pluginUserCredentials)
    .where(
      and(eq(pluginUserCredentials.userId, connection.userId), eq(pluginUserCredentials.pluginId, pluginId)),
    );
  if (!plugin || !saved) {
    console.log(`connection ${index + 1}: no plugin or no credentials`);
    continue;
  }
  const bag = openJson(ring, connection.credentials);
  const accounts = accountSchema.array().parse(JSON.parse(bag.accounts ?? "[]"));
  const batches: SyncResponse[] = [];
  let cursor: string | null = null;
  let failure: string | null = null;
  try {
    do {
      const batch: SyncResponse = await callPlugin(plugin, PLUGIN_PATHS.sync, syncResponseSchema, {
        body: {
          credentials: openJson(ring, saved.credentials),
          session: { id: bag.sessionId },
          accounts: accounts.map((account) => account.externalId),
          from,
          cursor,
          userPresent: null,
        },
        timeoutMs: 60_000,
      });
      batches.push(batch);
      cursor = batch.cursor;
    } while (cursor !== null && batches.length < 12);
  } catch (error) {
    if (!(error instanceof PluginCallError)) throw error;
    failure = error.code;
  }
  if (asFixture) {
    console.log(JSON.stringify(anonymous(accounts, batches), null, 2));
    continue;
  }
  const errors = batches.flatMap((batch) =>
    batch.accounts.flatMap((account) => (account.error ? [account.error] : [])),
  );
  // One digest of every movement's id, in order: two readings with the same ids give the same
  // digest, and the digest says nothing of the ids.
  const ids = batches
    .flatMap((batch) => batch.transactions.map((one) => `${one.accountExternalId} ${one.externalId ?? ""}`))
    .sort();
  const idsDigest = createHash("sha256").update(ids.join("\n")).digest("hex").slice(0, 16);
  console.log(
    JSON.stringify({
      connection: index + 1,
      idsDigest,
      from: from ?? "longest",
      failure,
      accountErrors: errors,
      measures: measureReading(accounts, batches, civilDateIn(new Date(), "UTC")),
    }),
  );
}
await getPool().end();
