"use client";

import { useTranslations } from "next-intl";
import { type FormEvent, useState, useTransition } from "react";
import { authClient } from "@/platform/auth/client";
import { OIDC_PROVIDER_ID } from "@/platform/auth/provider";
import { Button } from "@/ui/button";
import { Field } from "@/ui/field";
import { Input } from "@/ui/input";
import { acceptInviteAction } from "../../actions";

const ERROR_KEY = {
  invalid: "invite.invalid",
  email_taken: "invite.emailTaken",
  email_mismatch: "invite.emailMismatch",
  weak_password: "reset.hint",
  mismatch: "reset.mismatch",
} as const;

export function InviteForm({
  token,
  initialError,
}: {
  token: string;
  initialError: "email_mismatch" | null;
}) {
  const t = useTranslations("auth");
  const [error, setError] = useState<keyof typeof ERROR_KEY | null>(initialError);
  const [pending, startTransition] = useTransition();

  function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    startTransition(async () => {
      const result = await acceptInviteAction(token, {
        name: String(form.get("name")),
        password: String(form.get("password")),
        confirm: String(form.get("confirm")),
      });
      if (result) setError(result.error);
    });
  }

  return (
    <div className="flex flex-col gap-4">
      {error && (
        <p role="alert" className="text-sm text-neg">
          {t(ERROR_KEY[error])}
        </p>
      )}
      <form onSubmit={onSubmit} className="flex flex-col gap-3">
        <Field label={t("invite.name")} htmlFor="name">
          <Input id="name" name="name" autoComplete="name" required />
        </Field>
        <Field label={t("signIn.password")} htmlFor="password" hint={t("reset.hint")}>
          <Input id="password" name="password" type="password" autoComplete="new-password" required />
        </Field>
        <Field label={t("reset.confirm")} htmlFor="confirm">
          <Input id="confirm" name="confirm" type="password" autoComplete="new-password" required />
        </Field>
        <Button type="submit" variant="primary" disabled={pending} className="w-full">
          {t("invite.submit")}
        </Button>
      </form>
      {/* The completion route applies the invitation to whichever user Authentik signs in. */}
      <Button
        onClick={() =>
          authClient.signIn.social({
            provider: OIDC_PROVIDER_ID,
            callbackURL: `/invite/${token}/complete`,
            errorCallbackURL: "/sign-in?error=oidc",
          })
        }
        className="w-full"
      >
        {t("invite.authentik")}
      </Button>
    </div>
  );
}
