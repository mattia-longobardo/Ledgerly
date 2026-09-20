import { describe, expect, it } from "vitest";
import { createWalletClient, WalletError } from "./client";

interface Call {
  url: string;
  method: string;
  body: string | null;
  contentType: string | null;
}

/** A client on a fake `fetch` that records method and body, answering from a list. */
function client(answers: { status?: number; body: string }[]) {
  const calls: Call[] = [];
  const wallet = createWalletClient("synthetic-token", {
    baseUrl: "https://wallet.test/api",
    jitter: () => 0,
    sleep: async () => undefined,
    fetch: async (input, init) => {
      calls.push({
        url: String(input),
        method: init?.method ?? "GET",
        body: typeof init?.body === "string" ? init.body : null,
        contentType: new Headers(init?.headers).get("content-type"),
      });
      const answer = answers[Math.min(calls.length - 1, answers.length - 1)];
      return new Response(answer.body, { status: answer.status ?? 200 });
    },
  });
  return { wallet, calls };
}

const record = (id: string, value: number, note: string) => ({
  id,
  accountId: "wa-saving",
  amount: { value, currencyCode: "EUR" },
  category: null,
  counterParty: null,
  labels: [],
  note,
  recordDate: "2026-02-01",
  recordState: "Cleared",
  recordType: "Income",
  transfer: null,
});

describe("recordsWithNote (F4)", () => {
  it("asks for one account, one day and a note that contains the marker", async () => {
    const { wallet, calls } = client([
      { body: JSON.stringify({ records: [record("wr-9", 31, "ledgerly-interest:e-1 net")] }) },
    ]);
    const found = await wallet.recordsWithNote({
      accountId: "wa-saving",
      on: "2026-02-01",
      marker: "ledgerly-interest:e-1",
    });
    expect(found).toEqual([{ id: "wr-9", amountCents: 3_100n, note: "ledgerly-interest:e-1 net" }]);
    const url = new URL(calls[0].url);
    expect(url.pathname).toBe("/api/records");
    expect(url.searchParams.get("accountId")).toBe("eq.wa-saving");
    expect(url.searchParams.get("recordDate")).toBe("eq.2026-02-01");
    expect(url.searchParams.get("note")).toBe("contains.ledgerly-interest:e-1");
    expect(calls[0].method).toBe("GET");
  });
});

describe("createRecord (F4)", () => {
  it("posts one record with the exact decimal amount and reads the id back, wrapped or bare", async () => {
    for (const answer of [
      JSON.stringify({ records: [{ id: "wr-new" }] }),
      JSON.stringify([{ id: "wr-new", extra: true }]),
    ]) {
      const { wallet, calls } = client([{ status: 201, body: answer }]);
      const created = await wallet.createRecord({
        accountId: "wa-saving",
        amountCents: 3_107n,
        on: "2026-02-01",
        note: 'ledgerly-interest:e-1 "Jan"',
      });
      expect(created).toEqual({ id: "wr-new" });
      expect(calls).toHaveLength(1);
      expect(calls[0]).toMatchObject({ method: "POST", contentType: "application/json" });
      expect(calls[0].body).toBe(
        '[{"accountId":"wa-saving","amount":31.07,"recordDate":"2026-02-01","note":"ledgerly-interest:e-1 \\"Jan\\""}]',
      );
    }
  });

  it("files the record under the provider's own category id when it is given one (F4)", async () => {
    const { wallet, calls } = client([
      { status: 201, body: JSON.stringify({ records: [{ id: "wr-new" }] }) },
    ]);
    await wallet.createRecord({
      accountId: "wa-saving",
      amountCents: 3_107n,
      on: "2026-02-01",
      note: "ledgerly-interest:e-1",
      categoryId: "wc-interest",
    });
    expect(calls[0].body).toBe(
      '[{"accountId":"wa-saving","amount":31.07,"recordDate":"2026-02-01","note":"ledgerly-interest:e-1","categoryId":"wc-interest"}]',
    );
  });

  it("leaves the field out entirely when there is no category, rather than sending a null", async () => {
    for (const categoryId of [undefined, null]) {
      const { wallet, calls } = client([
        { status: 201, body: JSON.stringify({ records: [{ id: "wr-new" }] }) },
      ]);
      await wallet.createRecord({
        accountId: "wa-saving",
        amountCents: 1n,
        on: "2026-02-01",
        note: "x",
        categoryId,
      });
      expect(calls[0].body).not.toContain("categoryId");
    }
  });

  it("never tries a write twice, even on an answer a read would retry", async () => {
    const { wallet, calls } = client([{ status: 503, body: "{}" }]);
    await expect(
      wallet.createRecord({ accountId: "wa-saving", amountCents: 1n, on: "2026-02-01", note: "x" }),
    ).rejects.toBeInstanceOf(WalletError);
    expect(calls).toHaveLength(1);
  });

  it("fails as a payload error on a success it cannot read, so the caller can call it unsure", async () => {
    const { wallet } = client([{ status: 200, body: JSON.stringify({ ok: true }) }]);
    await expect(
      wallet.createRecord({ accountId: "wa-saving", amountCents: 1n, on: "2026-02-01", note: "x" }),
    ).rejects.toMatchObject({ kind: "payload" });
  });
});
