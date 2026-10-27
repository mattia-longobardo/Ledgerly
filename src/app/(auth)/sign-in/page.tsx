import type { Metadata, Route } from "next";
import { getTranslations } from "next-intl/server";
import { redirect } from "next/navigation";
import { authorizeContinuation } from "@/platform/auth/oauth";
import { signedInDestination } from "@/platform/auth/session";
import { AuthCard } from "../auth-card";
import { signInErrorKey } from "./errors";
import { SignInForm } from "./sign-in-form";

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getTranslations("auth.signIn"))("title") };
}

export default async function SignInPage({ searchParams }: PageProps<"/sign-in">) {
  const params = await searchParams;
  // Sent here by the OAuth authorize endpoint (D3): once signed in, the request carries on there.
  const next = authorizeContinuation(params) ?? "/";
  const destination = await signedInDestination();
  if (destination) redirect(destination === "/" ? (next as Route) : destination);
  const error = typeof params.error === "string" ? params.error : undefined;
  const t = await getTranslations("auth.signIn");
  return (
    <AuthCard title={t("title")} description={t("description")}>
      <SignInForm initialError={signInErrorKey(error)} next={next} />
    </AuthCard>
  );
}
