import { beforeEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_PREFERENCES } from "@/modules/users/rules";
import { ctxFrom, getOptionalPreferences, requireAdmin, requireSession } from "./session";

const getSession = vi.hoisted(() => vi.fn());

vi.mock("./auth", () => ({ getAuth: () => ({ api: { getSession } }) }));
vi.mock("next/headers", () => ({ headers: async () => new Headers() }));
vi.mock("@/modules/users/service", () => ({
  getPreferences: async () => ({ ...DEFAULT_PREFERENCES, theme: "system" }),
}));

describe("ctxFrom", () => {
  it("builds the request context from the user and their preferences", () => {
    const ctx = ctxFrom({ id: "u1", role: "admin" }, { ...DEFAULT_PREFERENCES, locale: "it" });
    expect(ctx).toEqual({
      userId: "u1",
      role: "admin",
      locale: "it",
      timeZone: "Europe/Rome",
      numberFormat: { format: "it-IT", decimalSeparator: null, currencyPosition: null },
    });
  });

  it("carries the formatting overrides, so no formatter has to read them back", () => {
    const ctx = ctxFrom(
      { id: "u1" },
      { ...DEFAULT_PREFERENCES, numberFormat: "en-US", decimalSeparator: ",", currencyPosition: "after" },
    );
    expect(ctx.numberFormat).toEqual({
      format: "en-US",
      decimalSeparator: ",",
      currencyPosition: "after",
    });
  });

  it("treats any role other than admin as user", () => {
    expect(ctxFrom({ id: "u1", role: null }, DEFAULT_PREFERENCES).role).toBe("user");
    expect(ctxFrom({ id: "u1", role: "superuser" }, DEFAULT_PREFERENCES).role).toBe("user");
  });
});

describe("requireSession", () => {
  beforeEach(() => getSession.mockReset());

  it("gives least privilege to a missing or unknown stored role", async () => {
    for (const role of [null, undefined, "", "Admin", "superuser"]) {
      getSession.mockResolvedValueOnce({ user: { id: "u1", role } });
      expect((await requireSession()).role).toBe("user");
    }
  });

  it("keeps the admin role of an admin", async () => {
    getSession.mockResolvedValueOnce({ user: { id: "u1", role: "admin" } });
    expect(await requireSession()).toMatchObject({ userId: "u1", role: "admin" });
  });

  it("redirects an anonymous visitor to /sign-in", async () => {
    getSession.mockResolvedValueOnce(null);
    await expect(requireSession()).rejects.toMatchObject({
      digest: expect.stringMatching(/^NEXT_REDIRECT;.*;\/sign-in;/),
    });
  });
});

describe("getOptionalPreferences", () => {
  beforeEach(() => getSession.mockReset());

  it("gives the signed-in user's saved preferences, and null to an anonymous visitor", async () => {
    getSession.mockResolvedValueOnce({ user: { id: "u1", role: "user" } });
    expect(await getOptionalPreferences()).toEqual({ ...DEFAULT_PREFERENCES, theme: "system" });
    getSession.mockResolvedValueOnce(null);
    expect(await getOptionalPreferences()).toBeNull();
  });
});

describe("requireAdmin", () => {
  beforeEach(() => getSession.mockReset());

  it("answers 404 to a signed-in non-admin", async () => {
    getSession.mockResolvedValueOnce({ user: { id: "u1", role: "user" } });
    await expect(requireAdmin()).rejects.toMatchObject({ digest: "NEXT_HTTP_ERROR_FALLBACK;404" });
  });

  it("returns the context of an admin", async () => {
    getSession.mockResolvedValueOnce({ user: { id: "u1", role: "admin" } });
    expect((await requireAdmin()).role).toBe("admin");
  });
});
