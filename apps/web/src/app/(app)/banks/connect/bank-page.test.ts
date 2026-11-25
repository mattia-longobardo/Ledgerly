import { describe, expect, it } from "vitest";
import { isBankPage } from "./bank-page";

describe("isBankPage", () => {
  it("opens an https address only", () => {
    expect(isBankPage("https://bank.example/login?x=1")).toBe(true);
    expect(isBankPage("javascript:alert(1)")).toBe(false);
    expect(isBankPage("http://bank.example/login")).toBe(false);
    expect(isBankPage("data:text/html,x")).toBe(false);
    expect(isBankPage("not a url")).toBe(false);
  });
});
