import { describe, expect, it } from "vitest";
import { fromAppOrigin } from "./same-origin";

const APP = "https://dash.example.test";
const call = (method: string, headers: Record<string, string>) =>
  fromAppOrigin(new Headers(headers), method, APP);

describe("fromAppOrigin", () => {
  it("lets in a read and a write of the app's own origin", () => {
    expect(call("GET", {})).toBe(true);
    expect(call("GET", { "sec-fetch-site": "same-origin" })).toBe(true);
    expect(call("PATCH", { origin: APP, "sec-fetch-site": "same-origin" })).toBe(true);
    expect(call("POST", { origin: APP })).toBe(true);
  });

  it("refuses a write that does not name its origin", () => {
    for (const method of ["POST", "PUT", "PATCH", "DELETE"]) expect(call(method, {}), method).toBe(false);
  });

  it("refuses another origin, a sibling site and a null origin, for a read too", () => {
    for (const method of ["GET", "PATCH"]) {
      expect(call(method, { origin: "https://evil.example" }), method).toBe(false);
      expect(call(method, { origin: "http://dash.example.test" }), method).toBe(false);
      expect(call(method, { origin: "null" }), method).toBe(false);
      expect(call(method, { "sec-fetch-site": "cross-site" }), method).toBe(false);
      expect(call(method, { "sec-fetch-site": "same-site" }), method).toBe(false);
      expect(call(method, { origin: APP, "sec-fetch-site": "cross-site" }), method).toBe(false);
    }
  });
});
