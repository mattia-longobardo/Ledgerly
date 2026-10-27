import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { redirect } from "next/navigation";
import { TRUST_DEVICE_DAYS } from "@/platform/auth/auth";
import { signedInDestination } from "@/platform/auth/session";
import { AuthCard } from "../../auth-card";
import { ChallengeForm } from "./challenge-form";

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getTranslations("auth.twoFactor.challenge"))("title") };
}

/**
 * The second step of a password sign-in for an account with TOTP (docs/auth-design.md D2). The
 * pending sign-in lives in Better Auth's signed `two_factor` cookie, 10 minutes, single use.
 */
export default async function TwoFactorChallengePage() {
  const destination = await signedInDestination();
  if (destination) redirect(destination);
  const t = await getTranslations("auth.twoFactor.challenge");
  return (
    <AuthCard title={t("title")} description={t("description")}>
      <ChallengeForm trustDays={TRUST_DEVICE_DAYS} />
    </AuthCard>
  );
}
