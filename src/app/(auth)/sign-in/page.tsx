import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { redirect } from "next/navigation";
import { getOptionalCtx } from "@/platform/auth/session";
import { AuthCard } from "../auth-card";
import { signInErrorKey } from "./errors";
import { SignInForm } from "./sign-in-form";

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getTranslations("auth.signIn"))("title") };
}

export default async function SignInPage({ searchParams }: PageProps<"/sign-in">) {
  if (await getOptionalCtx()) redirect("/");
  const { error } = await searchParams;
  const t = await getTranslations("auth.signIn");
  return (
    <AuthCard title={t("title")} description={t("description")}>
      <SignInForm initialError={signInErrorKey(error)} />
    </AuthCard>
  );
}
