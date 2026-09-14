"use client";

import { unstable_rethrow } from "next/navigation";
import { useTranslations } from "next-intl";
import { type FormEvent, useState, useTransition } from "react";
import { MAX_NAME_LENGTH } from "@/platform/auth/name-policy";
import {
  isPasswordLengthValid,
  MAX_PASSWORD_LENGTH,
  MIN_PASSWORD_LENGTH,
} from "@/platform/auth/password-policy";
import { Button } from "@/ui/button";
import { Field } from "@/ui/field";
import { Input } from "@/ui/input";
import { acceptInviteAction } from "../../actions";
import { startAuthentikSignIn } from "../../authentik";

const ERROR_KEY = {
  invalid: "invite.invalid",
  email_taken: "invite.emailTaken",
  email_mismatch: "invite.emailMismatch",
  name: "invite.nameInvalid",
  weak_password: "reset.hint",
  mismatch: "reset.mismatch",
  oidc: "errors.oidc",
  failed: "invite.failed",
} as const;

const PASSWORD_BOUNDS = { min: MIN_PASSWORD_LENGTH, max: MAX_PASSWORD_LENGTH };
const NAME_BOUNDS = { max: MAX_NAME_LENGTH };

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
    const input = {
      name: String(form.get("name")),
      password: String(form.get("password")),
      confirm: String(form.get("confirm")),
    };
    if (input.password !== input.confirm) return setError("mismatch");
    if (!isPasswordLengthValid(input.password)) return setError("weak_password");
    startTransition(async () => {
      try {
        const result = await acceptInviteAction(token, input);
        if (result) setError(result.error);
      } catch (thrown) {
        // On success the action redirects, which reaches here as a rejection Next.js must handle.
        unstable_rethrow(thrown);
        setError("failed");
      }
    });
  }

  return (
    <div className="flex flex-col gap-4">
      {error && (
        <p role="alert" className="text-sm text-neg">
          {t(ERROR_KEY[error], error === "name" ? NAME_BOUNDS : PASSWORD_BOUNDS)}
        </p>
      )}
      <form onSubmit={onSubmit} className="flex flex-col gap-3">
        <Field label={t("invite.name")} htmlFor="name">
          <Input id="name" name="name" autoComplete="name" maxLength={MAX_NAME_LENGTH} required />
        </Field>
        <Field label={t("signIn.password")} htmlFor="password" hint={t("reset.hint", PASSWORD_BOUNDS)}>
          <Input id="password" name="password" type="password" autoComplete="new-password" required />
        </Field>
        <Field label={t("reset.confirm")} htmlFor="confirm">
          <Input id="confirm" name="confirm" type="password" autoComplete="new-password" required />
        </Field>
        <Button type="submit" variant="primary" disabled={pending} className="w-full">
          {t("invite.submit")}
        </Button>
      </form>
      {/* The completion route applies the invitation only if Authentik signs in the invited address. */}
      <Button
        onClick={async () => {
          if (!(await startAuthentikSignIn(`/invite/${encodeURIComponent(token)}/complete`)))
            setError("oidc");
        }}
        className="w-full"
      >
        {t("invite.authentik")}
      </Button>
    </div>
  );
}
