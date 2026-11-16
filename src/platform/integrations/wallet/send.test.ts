import { describe, expect, it } from "vitest";
import { WalletError } from "./client";
import {
  isMovementRefusal,
  type MovementToSend,
  noteWithMarker,
  type SendDeps,
  sendManualMovements,
  sendMarker,
  splitSendMarker,
} from "./send";

// The manual movements written to the source (rewrite plan N3.1): one movement here is one record
// there, whatever is lost on the way.

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

/** A client that remembers what it was asked, and answers as it is told. */
function fakeClient(
  options: {
    existing?: { id: string; amountCents: bigint; note: string | null }[];
    create?: () => Promise<{ id: string | null }>;
    patchOk?: boolean;
  } = {},
) {
  const calls: string[] = [];
  const looked: string[] = [];
  const created: Parameters<Parameters<typeof sendManualMovements>[0]["createRecord"]>[0][] = [];
  return {
    calls,
    looked,
    created,
    client: {
      async recordsWithNote(query: { on: string }) {
        calls.push("look");
        looked.push(query.on);
        return options.existing ?? [];
      },
      async createRecord(input: (typeof created)[number]) {
        calls.push("create");
        created.push(input);
        return options.create ? options.create() : { id: "wr-new" };
      },
      async patchRecord() {
        calls.push("patch");
        return options.patchOk === false
          ? ({ ok: false, error: "refused" } as const)
          : ({ ok: true, record: null } as const);
      },
    },
  };
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

describe("the marker of a movement written to the source", () => {
  it("goes on a line of its own after the person's note, and alone when there is none", () => {
    expect(noteWithMarker("lunch", KEY)).toBe(`lunch\n${sendMarker(KEY)}`);
    expect(noteWithMarker("  ", KEY)).toBe(sendMarker(KEY));
    expect(noteWithMarker(null, KEY)).toBe(sendMarker(KEY));
  });

  it("is taken off a note read back, with the key it carried", () => {
    expect(splitSendMarker(noteWithMarker("lunch", KEY))).toEqual({ note: "lunch", key: KEY });
    expect(splitSendMarker(sendMarker(KEY))).toEqual({ note: null, key: KEY });
  });

  it("leaves a note of the person's own alone", () => {
    expect(splitSendMarker("lunch")).toEqual({ note: "lunch", key: null });
    expect(splitSendMarker(null)).toEqual({ note: null, key: null });
    expect(splitSendMarker(`${sendMarker(KEY)} and then some`)).toEqual({
      note: `${sendMarker(KEY)} and then some`,
      key: null,
    });
  });
});

describe("a failure that is about one movement only", () => {
  it("is an answer that refuses the request, or one nobody can read", () => {
    expect(isMovementRefusal(new WalletError("http", "bad request", 400))).toBe(true);
    expect(isMovementRefusal(new WalletError("http", "unprocessable", 422))).toBe(true);
    expect(isMovementRefusal(new WalletError("payload", "not JSON"))).toBe(true);
  });

  it("is not the network, the token, a limit or a failure of the provider", () => {
    expect(isMovementRefusal(new WalletError("network", "down"))).toBe(false);
    expect(isMovementRefusal(new WalletError("timeout", "slow"))).toBe(false);
    expect(isMovementRefusal(new WalletError("token_rejected", "no", 401))).toBe(false);
    expect(isMovementRefusal(new WalletError("http", "slow down", 429))).toBe(false);
    expect(isMovementRefusal(new WalletError("http", "broken", 503))).toBe(false);
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
        if (asked === 1) throw new WalletError("http", "bad request", 400);
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
    const down = new WalletError("network", "down");
    const wallet = fakeClient({
      create: async () => {
        throw down;
      },
    });
    const { handed } = deps();
    const outcome = await sendManualMovements(wallet.client, [movement(), movement({ id: "tx-2" })], handed);
    expect(outcome.counts).toEqual({ sent: 0, notSent: 1 });
    expect(outcome.failure).toBe(down);
    expect(wallet.calls).toEqual(["create"]);
  });
});
