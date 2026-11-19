import type { Metadata } from "next";
import { headers } from "next/headers";
import { getTranslations } from "next-intl/server";
import { getAuth, hasPasswordAccount, hasSsoAccount } from "@ledgerly/domain/platform/auth";
import { readEnv } from "@ledgerly/domain/platform/env";
import { requireSession } from "@/platform/auth/session";
import { SecurityScreen } from "./security-screen";
import { SignInMethod } from "./sign-in-method";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("settings");
  return { title: `${t("tabs.security")} · ${t("title")}` };
}

/**
 * The screen reads the person, the Client APIs, the connected apps and the sessions from `/api/v1`.
 * The rest is still the server's until the contract carries it: which session is this browser's,
 * the sign-in methods with the identity provider's address, and the instance's second-factor policy.
 */
export default async function SecurityPage() {
  const ctx = await requireSession();
  const [current, hasPassword, sso] = await Promise.all([
    (await getAuth()).api.getSession({ headers: await headers() }),
    hasPasswordAccount(ctx.userId),
    hasSsoAccount(ctx.userId),
  ]);
  return (
    <SecurityScreen
      signIn={<SignInMethod sso={sso} password={hasPassword} />}
      currentSessionId={current?.session.id ?? null}
      hasPassword={hasPassword}
      policy={readEnv().TWO_FACTOR_POLICY}
    />
  );
}
