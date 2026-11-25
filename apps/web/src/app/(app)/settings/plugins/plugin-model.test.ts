import { describe, expect, it } from "vitest";
import { alerts, canDeactivate, isOn, primaryOf, statusOf } from "./plugin-model";

describe("the model of a plugin (H56, PERS-615 §2)", () => {
  it("says the health of a connected plugin, and the state of any other", () => {
    expect(statusOf({ pluginState: "connected", health: "error" })).toBe("error");
    expect(statusOf({ pluginState: "connected", health: null })).toBe("up_to_date");
    expect(statusOf({ pluginState: "needs_cleanup", health: null })).toBe("needs_cleanup");
    expect(statusOf({ pluginState: "not_active", health: null })).toBe("not_active");
  });

  it("has one main action per state, and none while up to date or reading", () => {
    expect(primaryOf("not_active")).toBe("activate");
    expect(primaryOf("not_connected")).toBe("connect");
    expect(primaryOf("disconnected")).toBe("reconnect");
    expect(primaryOf("needs_cleanup")).toBe("fix");
    expect(primaryOf("up_to_date")).toBeNull();
    expect(primaryOf("reading")).toBeNull();
    for (const status of ["late", "on_demand", "error", "action_needed"] as const)
      expect(primaryOf(status)).toBe("connection");
  });

  it("puts an alert on the page only for an error or an action needed", () => {
    expect(alerts("error")).toBe(true);
    expect(alerts("action_needed")).toBe(true);
    expect(alerts("late")).toBe(false);
    expect(alerts("needs_cleanup")).toBe(false);
  });

  it("offers «Deactivate» to every plugin but one that is off with nothing left", () => {
    expect(canDeactivate({ pluginState: "not_active" })).toBe(false);
    expect(canDeactivate({ pluginState: "needs_cleanup" })).toBe(true);
    expect(isOn({ pluginState: "needs_cleanup" })).toBe(false);
    expect(isOn({ pluginState: "disconnected" })).toBe(true);
  });
});
