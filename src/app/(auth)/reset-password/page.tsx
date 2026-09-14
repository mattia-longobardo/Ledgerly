import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { AuthCard } from "../auth-card";
import { ResetForm } from "./reset-form";

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getTranslations("auth.reset"))("title") };
}

export default async function ResetPasswordPage({ searchParams }: PageProps<"/reset-password">) {
  const { token, error } = await searchParams;
  const t = await getTranslations("auth.reset");
  const valid = typeof token === "string" && !error;
  return (
    <AuthCard title={t("title")}>
      {valid ? (
        <ResetForm token={token} />
      ) : (
        <p role="alert" className="text-neg">
          {t("invalid")}
        </p>
      )}
    </AuthCard>
  );
}
