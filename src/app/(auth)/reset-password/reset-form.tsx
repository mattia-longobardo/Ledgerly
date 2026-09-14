"use client";

import { useRouter } from "next/navigation";
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

const PASSWORD_BOUNDS = { min: MIN_PASSWORD_LENGTH, max: MAX_PASSWORD_LENGTH };

export function ResetForm({ token }: { token: string }) {
  const t = useTranslations("auth.reset");
  const router = useRouter();
  const [error, setError] = useState<"mismatch" | "hint" | "invalid" | null>(null);
  const [pending, setPending] = useState(false);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const newPassword = String(form.get("password"));
    if (newPassword !== String(form.get("confirm"))) return setError("mismatch");
    if (!isPasswordLengthValid(newPassword)) return setError("hint");
    setPending(true);
    const result = await authClient.resetPassword({ newPassword, token }).finally(() => setPending(false));
    if (result.error) return setError("invalid");
    router.push("/sign-in");
  }

  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-3">
      {error && (
        <p role="alert" className="text-sm text-neg">
          {t(error, PASSWORD_BOUNDS)}
        </p>
      )}
      <Field label={t("newPassword")} htmlFor="password" hint={t("hint", PASSWORD_BOUNDS)}>
        <Input id="password" name="password" type="password" autoComplete="new-password" required />
      </Field>
      <Field label={t("confirm")} htmlFor="confirm">
        <Input id="confirm" name="confirm" type="password" autoComplete="new-password" required />
      </Field>
      <Button type="submit" variant="primary" disabled={pending} className="w-full">
        {t("submit")}
      </Button>
    </form>
  );
}
