import { beforeEach, describe, expect, it } from "vitest";
import { MAX_PER_WINDOW, resetRateLimits, takeSlot, WINDOW_MS } from "./rate-limit";

const NOW = 1_800_000_000_000;

beforeEach(resetRateLimits);

describe("takeSlot", () => {
  it("allows a token up to the window's allowance and then stops it", () => {
    for (let i = 0; i < MAX_PER_WINDOW; i += 1) {
      expect(takeSlot("t", NOW).allowed, `call ${i}`).toBe(true);
    }
    const refused = takeSlot("t", NOW);
    expect(refused.allowed).toBe(false);
    expect(refused.remaining).toBe(0);
    expect(refused.retryAfter).toBe(WINDOW_MS / 1000);
  });

  it("counts down what is left", () => {
    expect(takeSlot("t", NOW).remaining).toBe(MAX_PER_WINDOW - 1);
    expect(takeSlot("t", NOW).remaining).toBe(MAX_PER_WINDOW - 2);
  });

  it("gives every token a window of its own", () => {
    for (let i = 0; i < MAX_PER_WINDOW; i += 1) takeSlot("noisy", NOW);
    expect(takeSlot("noisy", NOW).allowed).toBe(false);
    expect(takeSlot("quiet", NOW).allowed).toBe(true);
  });

  it("opens a fresh window once the old one has run out", () => {
    for (let i = 0; i < MAX_PER_WINDOW; i += 1) takeSlot("t", NOW);
    expect(takeSlot("t", NOW + WINDOW_MS - 1).allowed).toBe(false);
    expect(takeSlot("t", NOW + WINDOW_MS).allowed).toBe(true);
  });

  it("rounds the wait up, so a caller that obeys it is never a millisecond early", () => {
    takeSlot("t", NOW);
    for (let i = 1; i < MAX_PER_WINDOW; i += 1) takeSlot("t", NOW);
    expect(takeSlot("t", NOW + 1).retryAfter).toBe(WINDOW_MS / 1000);
  });
});
