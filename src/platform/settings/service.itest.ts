import { eq } from "drizzle-orm";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { sessions, users } from "@/platform/auth/schema";
import type { Ctx } from "@/platform/context";
import { getDb } from "@/platform/db/client";
import { closeDatabase, resetDatabase } from "../../../test/db";
import { createTestUser } from "../../../test/users";
import { mailAllowed, mailPolicy, oidcConfig, settingsStamp, SMTP_TRANSPORT, smtpConfig } from "./config";
import { appSettings } from "./schema";
import {
  oidcView,
  removeOidc,
  removeSmtp,
  saveOidc,
  saveSmtp,
  sendTestEmail,
  SettingsError,
  smtpView,
  testOidc,
} from "./service";

function contextFor(userId: string, role: "admin" | "user" = "admin"): Ctx {
  return { userId, role, locale: "en", timeZone: "Europe/Rome", numberFormat: "it-IT" };
}

async function adminContext(): Promise<Ctx> {
  const person = await createTestUser();
  await getDb().update(users).set({ role: "admin" }).where(eq(users.id, person.id));
  return contextFor(person.id);
}

const OIDC = {
  issuer: "https://auth.example/application/o/ledgerly/",
  clientId: "ledgerly",
  clientSecret: "the-client-secret-1234",
  adminGroup: "ledgerly-admins",
};

const SMTP = {
  host: "smtp.example",
  port: 465,
  encryption: "ssl" as const,
  user: "ledgerly@example",
  password: "the-mail-password-5678",
  from: "Ledgerly <ledgerly@example>",
  invitations: true,
  syncAlerts: true,
  monthlySummary: true,
};

/** A session row of the given user, to prove what a changed issuer does to it. */
async function giveSession(userId: string, token: string): Promise<void> {
  await getDb()
    .insert(sessions)
    .values({ userId, token, expiresAt: new Date(Date.now() + 3_600_000) });
}

async function sessionCount(): Promise<number> {
  return (await getDb().select({ id: sessions.id }).from(sessions)).length;
}

beforeEach(resetDatabase);
afterAll(closeDatabase);

describe("the identity provider's settings", () => {
  it("falls back to the environment while nothing is saved", async () => {
    const ctx = await adminContext();
    const view = await oidcView(ctx);
    expect(view.saved).toBe(false);
    expect(view.issuer).toBe("http://127.0.0.1:9/");
    expect(await settingsStamp("oidc.provider")).toBeNull();
  });

  it("saves the secret sealed and only ever shows its last four characters", async () => {
    const ctx = await adminContext();
    await saveOidc(ctx, OIDC);
    const view = await oidcView(ctx);
    expect(view).toMatchObject({
      issuer: OIDC.issuer,
      clientId: "ledgerly",
      saved: true,
      secretHint: "1234",
    });
    const [row] = await getDb().select().from(appSettings).where(eq(appSettings.key, "oidc.provider"));
    expect(JSON.stringify(row.value)).not.toContain(OIDC.clientSecret);
    expect(row.sealed!.toString("utf8")).not.toContain(OIDC.clientSecret);
    expect((await oidcConfig()).clientSecret).toBe(OIDC.clientSecret);
  });

  it("keeps the sealed secret when the field is left empty", async () => {
    const ctx = await adminContext();
    await saveOidc(ctx, OIDC);
    await saveOidc(ctx, { ...OIDC, clientSecret: "", adminGroup: "other-admins" });
    const config = await oidcConfig();
    expect(config.clientSecret).toBe(OIDC.clientSecret);
    expect(config.adminGroup).toBe("other-admins");
  });

  it("refuses an empty secret on the very first save: there is nothing to keep", async () => {
    const ctx = await adminContext();
    await expect(saveOidc(ctx, { ...OIDC, clientSecret: "" })).rejects.toBeInstanceOf(SettingsError);
  });

  it("refuses anyone who is not an admin", async () => {
    const person = await createTestUser();
    await expect(saveOidc(contextFor(person.id, "user"), OIDC)).rejects.toMatchObject({
      code: "forbidden",
    });
  });

  it("signs everyone out when the issuer changes, and leaves sessions alone when it does not", async () => {
    const ctx = await adminContext();
    await saveOidc(ctx, OIDC);
    await giveSession(ctx.userId, "token-one");
    expect(await saveOidc(ctx, { ...OIDC, clientId: "renamed" })).toEqual({ signedEveryoneOut: false });
    expect(await sessionCount()).toBe(1);

    const moved = await saveOidc(ctx, { ...OIDC, issuer: "https://auth.other/application/o/ledgerly/" });
    expect(moved).toEqual({ signedEveryoneOut: true });
    expect(await sessionCount()).toBe(0);
  });

  it("records the last check under its own key, leaving the provider's own row untouched", async () => {
    const ctx = await adminContext();
    await saveOidc(ctx, OIDC);
    const before = await settingsStamp("oidc.provider");
    const unreachable = (async () => {
      throw new Error("no network here");
    }) as unknown as typeof fetch;
    const result = await testOidc(ctx, { fetch: unreachable });
    expect(result.outcome).toBe("unreachable");
    expect(await settingsStamp("oidc.provider")).toBe(before);
    expect((await oidcView(ctx)).lastCheck?.outcome).toBe("unreachable");
  });

  it("goes back to the environment once removed", async () => {
    const ctx = await adminContext();
    await saveOidc(ctx, OIDC);
    await removeOidc(ctx);
    expect((await oidcView(ctx)).saved).toBe(false);
  });
});

describe("the outgoing mail settings", () => {
  it("falls back to the environment while nothing is saved, with every switch on", async () => {
    const ctx = await adminContext();
    expect(await smtpView(ctx)).toMatchObject({ host: "127.0.0.1", port: 9, saved: false });
    expect(await mailPolicy()).toEqual({ invitations: true, syncAlerts: true, monthlySummary: true });
  });

  it("saves the password sealed and shows only its last four characters", async () => {
    const ctx = await adminContext();
    await saveSmtp(ctx, SMTP);
    expect(await smtpView(ctx)).toMatchObject({ host: "smtp.example", passwordHint: "5678", saved: true });
    const [row] = await getDb().select().from(appSettings).where(eq(appSettings.key, SMTP_TRANSPORT));
    expect(JSON.stringify(row.value)).not.toContain(SMTP.password);
    expect((await smtpConfig()).password).toBe(SMTP.password);
  });

  it("turns each switch into what the application may send", async () => {
    const ctx = await adminContext();
    await saveSmtp(ctx, { ...SMTP, invitations: false, monthlySummary: false });
    expect(await mailPolicy()).toEqual({ invitations: false, syncAlerts: true, monthlySummary: false });
    expect(await mailAllowed("invitations")).toBe(false);
    expect(await mailAllowed("syncAlerts")).toBe(true);
  });

  it("refuses a username with no encryption", async () => {
    const ctx = await adminContext();
    await expect(saveSmtp(ctx, { ...SMTP, encryption: "none" })).rejects.toMatchObject({
      code: "invalid",
    });
  });

  it("sends the test email to the admin who asked, and reports the transport's code when it fails", async () => {
    const ctx = await adminContext();
    const sent: string[] = [];
    const ok = await sendTestEmail(ctx, {
      sendMail: async (mail) => {
        sent.push(mail.to);
      },
    });
    expect(ok.outcome).toBe("ok");
    expect(sent).toHaveLength(1);

    const failed = await sendTestEmail(ctx, {
      sendMail: async () => {
        throw Object.assign(new Error("connect ECONNREFUSED 10.0.0.1:465"), { code: "ECONNREFUSED" });
      },
    });
    expect(failed).toEqual({ outcome: "failed", reason: "ECONNREFUSED" });
  });

  it("goes back to the environment once removed", async () => {
    const ctx = await adminContext();
    await saveSmtp(ctx, SMTP);
    await removeSmtp(ctx);
    expect((await smtpView(ctx)).saved).toBe(false);
  });
});
