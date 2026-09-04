import { describe, expect, it } from "vitest";
import { InvalidInputError } from "../application/errors";
import { toApiError } from "./routes";

describe("expenses toApiError", () => {
  it("maps InvalidInputError to 422 validation_failed, matching the accounts and interests modules", () => {
    const issues = [{ path: ["note"], message: "bad" }];
    const err = new InvalidInputError("bad input", issues);
    const apiErr = toApiError(err);
    expect(apiErr.status).toBe(422);
    expect(apiErr.code).toBe("validation_failed");
    expect(apiErr.message).toBe("bad input");
    expect(apiErr.details).toBe(issues);
  });
});
