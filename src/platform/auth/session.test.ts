import { beforeEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_PREFERENCES } from "@/modules/users/rules";
import {
  ctxFrom,
  getOptionalCtx,
  getOptionalPreferences,
  requireAdmin,
  requireSession,
  requireTwoFactorSetup,
  signedInDestination,
} from "./session";

const getSession = vi.hoisted(() => vi.fn());
const hasPasswordAccount = vi.hoisted(() => vi.fn(async () => false));
const env = vi.hoisted(() => ({ TWO_FACTOR_POLICY: "required" as "required" | "optional" }));

vi.mock("./accounts", () => ({ hasPasswordAccount }));
vi.mock("@/platform/env", () => ({ readEnv: () => env }));

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

describe("the TOTP setup gate", () => {
  beforeEach(() => {
    getSession.mockReset();
    hasPasswordAccount.mockReset();
    env.TWO_FACTOR_POLICY = "required";
  });

  const passwordUser = {
    user: { id: "u1", role: "user", email: "u1@example.test", twoFactorEnabled: false },
  };

  it("sends a password account without TOTP to the setup, not into the app", async () => {
    getSession.mockResolvedValue(passwordUser);
    hasPasswordAccount.mockResolvedValue(true);
    await expect(requireSession()).rejects.toMatchObject({
      digest: expect.stringMatching(/^NEXT_REDIRECT;.*;\/sign-in\/two-factor\/setup;/),
    });
    expect(await getOptionalCtx()).toBeNull();
    expect(await signedInDestination()).toBe("/sign-in/two-factor/setup");
    expect(await requireTwoFactorSetup()).toMatchObject({ email: "u1@example.test" });
    // The language of the setup page still follows the person's preferences.
    expect(await getOptionalPreferences()).not.toBeNull();
  });

  it("lets in an account with TOTP, without looking up its accounts", async () => {
    getSession.mockResolvedValue({ user: { ...passwordUser.user, twoFactorEnabled: true } });
    expect((await requireSession()).userId).toBe("u1");
    expect(hasPasswordAccount).not.toHaveBeenCalled();
    await expect(requireTwoFactorSetup()).rejects.toMatchObject({
      digest: expect.stringMatching(/^NEXT_REDIRECT;.*;\/;/),
    });
  });

  it("lets in an Authentik-only account: its second factor is Authentik's", async () => {
    getSession.mockResolvedValue(passwordUser);
    hasPasswordAccount.mockResolvedValue(false);
    expect((await requireSession()).userId).toBe("u1");
    expect(await signedInDestination()).toBe("/");
  });

  it("lets in a password account without TOTP when the policy is optional", async () => {
    env.TWO_FACTOR_POLICY = "optional";
    getSession.mockResolvedValue(passwordUser);
    hasPasswordAccount.mockResolvedValue(true);
    expect((await requireSession()).userId).toBe("u1");
  });

  it("sends an anonymous visitor from the setup page to /sign-in", async () => {
    getSession.mockResolvedValue(null);
    expect(await signedInDestination()).toBeNull();
    await expect(requireTwoFactorSetup()).rejects.toMatchObject({
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
