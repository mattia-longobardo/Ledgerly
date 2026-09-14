"use client";

import Link from "next/link";
import { useTranslations } from "next-intl";
import { type FormEvent, useState } from "react";
import { authClient } from "@/platform/auth/client";
import { Button } from "@/ui/button";
import { Field } from "@/ui/field";
import { Input } from "@/ui/input";

export function ForgotForm() {
  const t = useTranslations("auth");
  const [pending, setPending] = useState(false);
  const [sent, setSent] = useState(false);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const email = String(new FormData(event.currentTarget).get("email"));
    setPending(true);
    await authClient
      .requestPasswordReset({ email, redirectTo: "/reset-password" })
      .finally(() => setPending(false));
    setSent(true); // same answer whether or not the address exists
  }

  return sent ? (
    <p role="status" className="text-muted">
      {t("forgot.sent")}
    </p>
  ) : (
    <form onSubmit={onSubmit} className="flex flex-col gap-3">
      <Field label={t("signIn.email")} htmlFor="email">
        <Input id="email" name="email" type="email" autoComplete="email" required />
      </Field>
      <Button type="submit" variant="primary" disabled={pending} className="w-full">
        {t("forgot.submit")}
      </Button>
      <Link
        href="/sign-in"
        className="focus-ring rounded-[2px] text-sm font-medium text-accent hover:underline"
      >
        {t("forgot.back")}
      </Link>
    </form>
  );
}
