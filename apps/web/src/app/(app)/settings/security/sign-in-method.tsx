"use client";

import { useTranslations } from "next-intl";
import type { ReactNode } from "react";
import { buttonClassName } from "@ledgerly/ui/button";
import { PasswordForm } from "./password-form";

const strong = (chunks: ReactNode) => <span className="font-medium text-fg">{chunks}</span>;

/** Settings › Security › Sign-in: how the account signs in, and the password change when it has one. */
export function SignInMethod({
  sso,
  password,
  identityProvider,
}: {
  sso: boolean;
  password: boolean;
  /** The origin of the instance's identity provider, as `GET /security/sign-in` answers it. */
  identityProvider: string | null;
}) {
  const t = useTranslations("settings");
  const provider = identityProvider === null ? null : new URL(identityProvider);
  const method = sso && password ? "both" : sso ? "sso" : "password";
  return (
    <>
      <p className="text-sm text-muted">
        {t.rich("signIn.method", { method: t(`signIn.methods.${method}`), strong })}
      </p>
      {sso && (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-border p-3 text-sm">
          <div>
            <div className="text-base font-medium">
              {t("signIn.linkedTo", { host: provider?.host ?? "Authentik" })}
            </div>
            <div className="mt-0.5 text-muted">{t("signIn.ssoDetail")}</div>
          </div>
          {provider && (
            <a
              href={provider.origin}
              target="_blank"
              rel="noopener noreferrer"
              className={buttonClassName("secondary", "sm")}
            >
              {t("signIn.manage")}
            </a>
          )}
        </div>
      )}
      {password ? <PasswordForm /> : <p className="text-sm text-muted">{t("password.ssoOnly")}</p>}
    </>
  );
}
