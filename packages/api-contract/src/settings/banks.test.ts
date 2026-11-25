import { describe, expect, it } from "vitest";
import { renewBankAccess, startBankAccess } from "./banks";

describe("the bank's page of /banks/access and /connections/{id}/renew", () => {
  it("is an https address only", () => {
    for (const route of [startBankAccess, renewBankAccess]) {
      expect(route.response.safeParse({ url: "https://bank.example/login" }).success).toBe(true);
      expect(route.response.safeParse({ url: "javascript:alert(1)" }).success).toBe(false);
      expect(route.response.safeParse({ url: "http://bank.example/login" }).success).toBe(false);
    }
  });
});
