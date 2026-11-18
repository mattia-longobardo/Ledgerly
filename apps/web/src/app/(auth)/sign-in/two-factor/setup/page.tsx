import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { requireTwoFactorSetup } from "@/platform/auth/session";
import { AuthCard } from "../../../auth-card";
import { SetupFlow } from "./setup-flow";

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getTranslations("auth.twoFactor.setup"))("title") };
}

/**
 * Where a password account without TOTP lands after signing in while TWO_FACTOR_POLICY=required
 * (docs/auth-design.md D2). Nothing else opens until the setup is confirmed.
 */
export default async function TwoFactorSetupPage() {
  const { email } = await requireTwoFactorSetup();
  const t = await getTranslations("auth.twoFactor.setup");
  return (
    <AuthCard title={t("title")} description={t("description")}>
      <SetupFlow account={email} />
    </AuthCard>
  );
}
