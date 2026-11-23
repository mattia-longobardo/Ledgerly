import { describe, expect, it } from "vitest";
import type { PriceSource } from "@domain/modules/instruments";
import type { Fetch } from "./client";
import { pluginPriceSource } from "./prices";

const PLUGIN = { id: "prices", url: "http://plugin.test:8787", secret: "0123456789abcdef0123456789abcdef" };
const REQUEST = {
  listings: [{ key: "k1", ticker: "AAA", mic: "XMIL", currency: "EUR" }],
  from: "2026-11-12",
  to: "2026-11-22",
} as Parameters<ReturnType<typeof pluginPriceSource>["closes"]>[0];

function answering(status: number, body: unknown) {
  const seen: string[] = [];
  const fetchFn: Fetch = async (input) => {
    seen.push(String(input));
    return new Response(JSON.stringify(body), { status });
  };
  return { seen, fetchFn };
}

describe("the prices plugin as a source", () => {
  it("posts the markets to /prices and answers the closes the contract allows", async () => {
    const answer = { bars: [{ key: "k1", on: "2026-11-20", close: "10.5", currency: "EUR" }], errors: [] };
    const { seen, fetchFn } = answering(200, answer);
    // The adapter has the shape of the port of `instruments`: the compiler checks it here.
    const source: PriceSource = pluginPriceSource(PLUGIN, fetchFn);
    expect(source.id).toBe("prices");
    expect(await source.closes(REQUEST)).toEqual(answer);
    expect(seen).toEqual(["http://plugin.test:8787/prices"]);
  });

  it("refuses a close of zero: an answer outside the contract is invalid_data", async () => {
    const { fetchFn } = answering(200, {
      bars: [{ key: "k1", on: "2026-11-20", close: "0", currency: "EUR" }],
      errors: [],
    });
    await expect(pluginPriceSource(PLUGIN, fetchFn).closes(REQUEST)).rejects.toMatchObject({
      code: "invalid_data",
    });
  });
});
