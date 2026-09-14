"use client";

import { useTranslations } from "next-intl";
import { type FormEvent, useState } from "react";
import { authClient } from "@/platform/auth/client";
import {
  isPasswordLengthValid,
  MAX_PASSWORD_LENGTH,
  MIN_PASSWORD_LENGTH,
} from "@/platform/auth/password-policy";
import { Button } from "@/ui/button";
import { Field } from "@/ui/field";
import { Input } from "@/ui/input";
import { notify } from "@/ui/toast";

const PASSWORD_BOUNDS = { min: MIN_PASSWORD_LENGTH, max: MAX_PASSWORD_LENGTH };

export function PasswordForm() {
  const t = useTranslations("settings.password");
  const auth = useTranslations("auth.reset");
  const [error, setError] = useState<string | null>(null);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const formElement = event.currentTarget;
    const form = new FormData(formElement);
    const newPassword = String(form.get("new"));
    if (newPassword !== String(form.get("confirm"))) return setError(auth("mismatch"));
    if (!isPasswordLengthValid(newPassword)) return setError(auth("hint", PASSWORD_BOUNDS));
    const result = await authClient.changePassword({
      currentPassword: String(form.get("current")),
      newPassword,
      revokeOtherSessions: true,
    });
    if (result.error) return setError(t("failed"));
    setError(null);
    formElement.reset();
    notify(t("changed"));
  }

  return (
    <form onSubmit={onSubmit} className="grid grid-cols-1 gap-x-4 gap-y-3 sm:grid-cols-2">
      {error && (
        <p role="alert" className="text-sm text-neg sm:col-span-2">
          {error}
        </p>
      )}
      <Field label={t("current")} htmlFor="current">
        <Input id="current" name="current" type="password" autoComplete="current-password" required />
      </Field>
      <div className="max-sm:hidden" />
      <Field label={t("new")} htmlFor="new" hint={auth("hint", PASSWORD_BOUNDS)}>
        <Input id="new" name="new" type="password" autoComplete="new-password" required />
      </Field>
      <Field label={t("confirm")} htmlFor="confirm">
        <Input id="confirm" name="confirm" type="password" autoComplete="new-password" required />
      </Field>
      <div className="flex justify-end sm:col-span-2">
        <Button type="submit" variant="primary" size="sm">
          {t("submit")}
        </Button>
      </div>
    </form>
  );
}
