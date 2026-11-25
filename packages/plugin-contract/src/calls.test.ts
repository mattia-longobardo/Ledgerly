import { describe, expect, it } from "vitest";
import { authStartResponseSchema } from "./calls";

describe("authStartResponseSchema", () => {
  it("takes an https address only from a plugin", () => {
    expect(authStartResponseSchema.safeParse({ url: "https://bank.example/login?x=1" }).success).toBe(true);
    expect(authStartResponseSchema.safeParse({ url: "javascript:alert(1)" }).success).toBe(false);
    expect(authStartResponseSchema.safeParse({ url: "http://bank.example/login" }).success).toBe(false);
  });
});
