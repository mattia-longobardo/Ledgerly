import { getTranslations } from "next-intl/server";
import { redirect } from "next/navigation";
import { getOptionalCtx } from "@/platform/auth/session";
import { AuthCard } from "../auth-card";
import { signInErrorKey } from "./errors";
import { SignInForm } from "./sign-in-form";

export default async function SignInPage({ searchParams }: PageProps<"/sign-in">) {
  if (await getOptionalCtx()) redirect("/");
  const { error } = await searchParams;
  // Better Auth appends its own `error` to the error callback URL (`?error=oidc&error=<code>`),
  // so ours is the first value.
  const code = Array.isArray(error) ? error[0] : error;
  const t = await getTranslations("auth.signIn");
  return (
    <AuthCard title={t("title")} description={t("description")}>
      <SignInForm initialError={signInErrorKey(code)} />
    </AuthCard>
  );
}
