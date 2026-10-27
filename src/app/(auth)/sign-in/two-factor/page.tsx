import type { Metadata, Route } from "next";
import { getTranslations } from "next-intl/server";
import { redirect } from "next/navigation";
import { TRUST_DEVICE_DAYS } from "@/platform/auth/auth";
import { safeNext } from "@/platform/auth/oauth";
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
export default async function TwoFactorChallengePage({ searchParams }: PageProps<"/sign-in/two-factor">) {
  const raw = (await searchParams).next;
  const next = safeNext(typeof raw === "string" ? raw : null);
  const destination = await signedInDestination();
  if (destination) redirect(destination === "/" ? (next as Route) : destination);
  const t = await getTranslations("auth.twoFactor.challenge");
  return (
    <AuthCard title={t("title")} description={t("description")}>
      <ChallengeForm trustDays={TRUST_DEVICE_DAYS} next={next} />
    </AuthCard>
  );
}
