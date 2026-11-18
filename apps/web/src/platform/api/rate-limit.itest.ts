import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { closeDatabase, resetDatabase } from "../../../../../test/db";
import { MAX_PER_WINDOW, resetRateLimits, takeSlot, WINDOW_MS } from "./rate-limit";

const NOW = 1_800_000_000_000;
const at = (ms: number) => new Date(ms);

beforeEach(async () => {
  await resetDatabase();
  await resetRateLimits();
});
afterAll(closeDatabase);

describe("takeSlot", () => {
  it("allows a token up to the window's allowance and then stops it", async () => {
    for (let i = 0; i < MAX_PER_WINDOW; i += 1) {
      expect((await takeSlot("t", at(NOW))).allowed, `call ${i}`).toBe(true);
    }
    const refused = await takeSlot("t", at(NOW));
    expect(refused.allowed).toBe(false);
    expect(refused.remaining).toBe(0);
    expect(refused.retryAfter).toBe(WINDOW_MS / 1000);
  });

  it("counts down what is left", async () => {
    expect((await takeSlot("t", at(NOW))).remaining).toBe(MAX_PER_WINDOW - 1);
    expect((await takeSlot("t", at(NOW))).remaining).toBe(MAX_PER_WINDOW - 2);
  });

  it("gives every token a window of its own", async () => {
    for (let i = 0; i < MAX_PER_WINDOW; i += 1) await takeSlot("noisy", at(NOW));
    expect((await takeSlot("noisy", at(NOW))).allowed).toBe(false);
    expect((await takeSlot("quiet", at(NOW))).allowed).toBe(true);
  });

  it("opens a fresh window once the old one has run out", async () => {
    for (let i = 0; i < MAX_PER_WINDOW; i += 1) await takeSlot("t", at(NOW));
    expect((await takeSlot("t", at(NOW + WINDOW_MS - 1))).allowed).toBe(false);
    expect((await takeSlot("t", at(NOW + WINDOW_MS))).allowed).toBe(true);
  });

  it("rounds the wait up, so a caller that obeys it is never a millisecond early", async () => {
    await takeSlot("t", at(NOW));
    for (let i = 1; i < MAX_PER_WINDOW; i += 1) await takeSlot("t", at(NOW));
    expect((await takeSlot("t", at(NOW + 1))).retryAfter).toBe(WINDOW_MS / 1000);
  });

  it("is one window for every process: two callers at once never pass the allowance", async () => {
    const verdicts = await Promise.all(
      Array.from({ length: MAX_PER_WINDOW + 10 }, () => takeSlot("shared", at(NOW))),
    );
    expect(verdicts.filter((verdict) => verdict.allowed)).toHaveLength(MAX_PER_WINDOW);
  });
});
