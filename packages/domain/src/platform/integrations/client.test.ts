// The browser's entry gives the client the server's own rules (PERS-559): one implementation, no copy.
import { describe, expect, it } from "vitest";
import * as client from "./client";
import {
  DEFAULT_SYNC_SCHEDULE,
  clock,
  codeKey,
  daysToExpiry,
  historyOf,
  isPluginProvider,
  isRunningNow,
  isSyncErrorCode,
  relativeNext,
  relativePast,
} from "./index";

describe("the browser's entry of integrations", () => {
  it("is the server entry's names, name by name", () => {
    expect({ ...client }).toEqual({
      DEFAULT_SYNC_SCHEDULE,
      clock,
      codeKey,
      daysToExpiry,
      historyOf,
      isPluginProvider,
      isRunningNow,
      isSyncErrorCode,
      relativeNext,
      relativePast,
    });
  });
});
