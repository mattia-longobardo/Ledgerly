import { describe, expect, it } from "vitest";
import { ApiError, toErrorBody } from "./errors";

describe("ApiError", () => {
  it("serialises to the stable envelope", () => {
    const body = toErrorBody(new ApiError(404, "not_found", "Account not found"), "req-1");
    expect(body).toEqual({ error: { code: "not_found", message: "Account not found", requestId: "req-1" } });
  });
});
