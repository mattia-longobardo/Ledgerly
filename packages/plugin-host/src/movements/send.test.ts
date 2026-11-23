import { describe, expect, it } from "vitest";
import { PluginCallError } from "@plugin-host/client";
import { parseCents } from "@domain/shared/money";
import { parseJsonPreservingNumbers } from "../../../../plugins/wallet/src/http";
import { sendMarker } from "../../../../plugins/wallet/src/marker";
import { servedSource } from "../../../../test/fixtures/wallet/served-plugin";
import { isMovementRefusal, type MovementToSend, type SendDeps, sendManualMovements } from "./send";

// The manual movements written to the source (rewrite plan N3.1): one movement here is one record
// there, whatever is lost on the way. The source is the plugin served in-process (R5c); the marker
// itself is the plugin's, and `plugins/wallet/src/plugin.test.ts` holds it.

const KEY = "0198a1c2-7d3e-7a4b-9c5d-2e6f7a8b9c0d";

function movement(overrides: Partial<MovementToSend> = {}): MovementToSend {
  return {
    id: "tx-1",
    key: KEY,
    state: "to_send",
    accountExternalId: "wa-general",
    on: "2026-11-10",
    askedOn: null,
    amountCents: -450n,
    payee: null,
    note: null,
    categoryId: null,
    ...overrides,
  };
}

/** A Wallet record as the plugin reads it back. */
function wire(id: string, amount: string, day: string, note: string | null) {
  return {
    id,
    accountId: "wa-general",
    amount: { value: Number(amount), currencyCode: "EUR" },
    recordDate: day,
    category: null,
    labels: [],
    recordType: "expense",
    recordState: "cleared",
    note,
    counterParty: null,
    transfer: null,
  };
}

/**
 * Wallet behind the plugin served in-process (rewrite plan R5c): it remembers what it was asked —
 * a look by marker, a create, an edit of the payee — and answers as it is told. `create` answers
 * the id of the record, `null` for an answer with none, or the failure to give.
 */
function fakeClient(
  options: {
    existing?: { id: string; amountCents: bigint; note: string | null }[];
    create?: () => Promise<{ id: string | null } | "refuse" | "down">;
    patchOk?: boolean;
  } = {},
) {
  const calls: string[] = [];
  const looked: string[] = [];
  const created: {
    accountId: string;
    amountCents: bigint;
    on: string;
    note: string;
    categoryId: string | null;
  }[] = [];
  const client = servedSource(async (input, init) => {
    const url = new URL(String(input));
    const method = init?.method ?? "GET";
    if (method === "GET") {
      calls.push("look");
      looked.push(url.searchParams.getAll("recordDate")[0].replace("eq.", ""));
      const day = looked.at(-1) as string;
      const found = (options.existing ?? []).map((one) =>
        wire(one.id, (Number(one.amountCents) / 100).toFixed(2), day, one.note),
      );
      return Response.json({ records: found });
    }
    if (method === "POST") {
      calls.push("create");
      const [sent] = parseJsonPreservingNumbers(String(init?.body)) as Record<string, string>[];
      created.push({
        accountId: sent.accountId,
        amountCents: parseCents(sent.amount),
        on: sent.recordDate,
        note: sent.note,
        categoryId: sent.categoryId ?? null,
      });
      const answer = options.create ? await options.create() : { id: "wr-new" };
      if (answer === "refuse") return Response.json({ error: "bad request" }, { status: 400 });
      if (answer === "down") throw new TypeError("fetch failed");
      return Response.json({ records: answer.id === null ? [] : [{ id: answer.id }] });
    }
    calls.push("patch");
    return Response.json({ results: [{ inputIndex: 0, success: options.patchOk !== false, record: null }] });
  });
  return { calls, looked, created, client };
}

function deps(category: { id: string; externalId: string } | null = null) {
  const log: string[] = [];
  const settled: Parameters<SendDeps["settle"]>[1][] = [];
  const handed: SendDeps = {
    categoryFor: async () => category,
    markNotSent: async (id, askedOn) => {
      log.push(askedOn === undefined ? `not_sent:${id}` : `asked:${id}:${askedOn}`);
    },
    settle: async (id, sent) => {
      log.push(`settled:${id}`);
      settled.push(sent);
      return true;
    },
  };
  return { log, settled, handed };
}

describe("a failure that is about one movement only", () => {
  it("is the plugin saying the source refused the request", () => {
    expect(isMovementRefusal(new PluginCallError("refused"))).toBe(true);
  });

  it("is not the network, the token, a limit or a failure of the provider", () => {
    expect(isMovementRefusal(new PluginCallError("provider_down"))).toBe(false);
    expect(isMovementRefusal(new PluginCallError("plugin_down"))).toBe(false);
    expect(isMovementRefusal(new PluginCallError("auth"))).toBe(false);
    expect(isMovementRefusal(new PluginCallError("rate_limited"))).toBe(false);
    expect(isMovementRefusal(new PluginCallError("invalid_data"))).toBe(false);
    expect(isMovementRefusal(new Error("a bug"))).toBe(false);
  });
});

describe("sending the manual movements", () => {
  it("marks the movement before it asks, creates one record with the marker, and settles it", async () => {
    const wallet = fakeClient();
    const { log, settled, handed } = deps({ id: "row-9", externalId: "wc-bar" });
    const outcome = await sendManualMovements(
      wallet.client,
      [movement({ note: "lunch", categoryId: "c" })],
      handed,
    );

    expect(outcome).toEqual({ counts: { sent: 1, notSent: 0 }, failure: undefined });
    expect(wallet.calls).toEqual(["create"]);
    expect(wallet.created[0]).toEqual({
      accountId: "wa-general",
      amountCents: -450n,
      on: "2026-11-10",
      note: `lunch\n${sendMarker(KEY)}`,
      categoryId: "wc-bar",
    });
    expect(log).toEqual(["asked:tx-1:2026-11-10", "settled:tx-1"]);
    expect(settled[0]).toEqual({ externalId: "wr-new", sourceCategoryId: "row-9", payeeSent: true });
  });

  it("sends a movement with no matching category of the source with none", async () => {
    const wallet = fakeClient();
    const { settled, handed } = deps(null);
    await sendManualMovements(wallet.client, [movement({ categoryId: "c" })], handed);
    expect(wallet.created[0].categoryId).toBeNull();
    expect(settled[0].sourceCategoryId).toBeNull();
  });

  it("gives the payee with an edit, and says when the source did not take it", async () => {
    const taken = fakeClient();
    const first = deps();
    await sendManualMovements(taken.client, [movement({ payee: "Corner bar" })], first.handed);
    expect(taken.calls).toEqual(["create", "patch"]);
    expect(first.settled[0].payeeSent).toBe(true);

    const refused = fakeClient({ patchOk: false });
    const second = deps();
    const outcome = await sendManualMovements(
      refused.client,
      [movement({ payee: "Corner bar" })],
      second.handed,
    );
    expect(outcome.counts).toEqual({ sent: 1, notSent: 0 });
    expect(second.settled[0].payeeSent).toBe(false);
  });

  it("asks once for the same key: a movement asked for before is looked for, and taken when it is there", async () => {
    const wallet = fakeClient({ existing: [{ id: "wr-there", amountCents: -450n, note: sendMarker(KEY) }] });
    const { settled, handed } = deps();
    const outcome = await sendManualMovements(wallet.client, [movement({ state: "not_sent" })], handed);

    expect(wallet.calls).toEqual(["look"]);
    expect(wallet.created).toHaveLength(0);
    expect(settled[0].externalId).toBe("wr-there");
    expect(outcome.counts).toEqual({ sent: 1, notSent: 0 });
  });

  it("looks on the day the first request named, whatever day the movement has now", async () => {
    const wallet = fakeClient({ existing: [{ id: "wr-there", amountCents: -450n, note: sendMarker(KEY) }] });
    const { handed } = deps();
    await sendManualMovements(
      wallet.client,
      [movement({ state: "not_sent", on: "2026-11-12", askedOn: "2026-11-10" })],
      handed,
    );
    expect(wallet.looked).toEqual(["2026-11-10"]);
    expect(wallet.created).toHaveLength(0);
  });

  it("asks again for a movement asked for before that is not there", async () => {
    const wallet = fakeClient();
    const { handed } = deps();
    await sendManualMovements(wallet.client, [movement({ state: "not_sent" })], handed);
    expect(wallet.calls).toEqual(["look", "create"]);
  });

  it("leaves a movement not sent when the answer carries no id: the record may be there", async () => {
    const wallet = fakeClient({ create: async () => ({ id: null }) });
    const { log, handed } = deps();
    const outcome = await sendManualMovements(wallet.client, [movement()], handed);
    expect(outcome).toEqual({ counts: { sent: 0, notSent: 1 }, failure: undefined });
    expect(log).toEqual(["asked:tx-1:2026-11-10"]);
  });

  it("goes on to the next movement after a refusal of one, and fails nothing", async () => {
    let asked = 0;
    const wallet = fakeClient({
      create: async () => {
        asked += 1;
        if (asked === 1) return "refuse";
        return { id: "wr-second" };
      },
    });
    const { log, handed } = deps();
    const outcome = await sendManualMovements(
      wallet.client,
      [movement(), movement({ id: "tx-2", key: "0198a1c2-7d3e-7a4b-9c5d-2e6f7a8b9c0e" })],
      handed,
    );
    expect(outcome).toEqual({ counts: { sent: 1, notSent: 1 }, failure: undefined });
    expect(log).toEqual(["asked:tx-1:2026-11-10", "not_sent:tx-1", "asked:tx-2:2026-11-10", "settled:tx-2"]);
  });

  it("stops at a failure of the connection, and hands it back", async () => {
    const wallet = fakeClient({ create: async () => "down" });
    const { handed } = deps();
    const outcome = await sendManualMovements(wallet.client, [movement(), movement({ id: "tx-2" })], handed);
    expect(outcome.counts).toEqual({ sent: 0, notSent: 1 });
    expect(outcome.failure).toMatchObject({ code: "provider_down" });
    expect(wallet.calls).toEqual(["create"]);
  });
});
