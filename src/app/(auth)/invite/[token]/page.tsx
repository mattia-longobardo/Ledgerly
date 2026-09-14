import type { Metadata } from "next";
import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { findInvitation } from "@/platform/auth/invitations";
import { AuthCard } from "../../auth-card";
import { InviteForm } from "./invite-form";

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getTranslations("auth.invite"))("title") };
}

export default async function InvitePage({ params, searchParams }: PageProps<"/invite/[token]">) {
  const { token } = await params;
  const { error } = await searchParams;
  const t = await getTranslations("auth");
  const invitation = await findInvitation(token);
  if (!invitation) {
    return (
      <AuthCard title={t("invite.title")}>
        <p role="alert" className="text-neg">
          {t("invite.invalid")}
        </p>
        <Link
          href="/sign-in"
          className="focus-ring rounded-[2px] text-sm font-medium text-accent hover:underline"
        >
          {t("forgot.back")}
        </Link>
      </AuthCard>
    );
  }
  return (
    <AuthCard title={t("invite.title")} description={t("invite.description", { email: invitation.email })}>
      {/* Set by /invite/[token]/complete when the Authentik account's email is not the invited one. */}
      <InviteForm token={token} initialError={error === "email_mismatch" ? "email_mismatch" : null} />
    </AuthCard>
  );
}
