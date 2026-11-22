import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { onboardingPending, requireSession } from "@/platform/auth/session";
import { WelcomeScreen } from "./welcome-screen";

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getTranslations("welcome"))("title") };
}

/** The first start (rewrite plan R5a): only while it is ahead of the person; then the app. */
export default async function WelcomePage() {
  const ctx = await requireSession();
  if (!(await onboardingPending())) redirect("/");
  return <WelcomeScreen admin={ctx.role === "admin"} />;
}
