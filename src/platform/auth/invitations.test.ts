import { describe, expect, it } from "vitest";
import { hashToken, newToken } from "./invitations";

describe("invitation tokens", () => {
  it("are long, URL-safe and unique", () => {
    const a = newToken();
    expect(a).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(newToken()).not.toBe(a);
  });

  it("are stored only as a SHA-256 hash", () => {
    expect(hashToken("abc")).toBe("ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
  });
});
