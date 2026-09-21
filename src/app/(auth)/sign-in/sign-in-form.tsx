"use client";

import { KeyRound } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { type FormEvent, useState } from "react";
import { authClient } from "@/platform/auth/client";
import { Button } from "@/ui/button";
import { Field } from "@/ui/field";
import { Input } from "@/ui/input";
import { startAuthentikSignIn } from "../authentik";
import { type SignInErrorKey, signInErrorKey } from "./errors";

export function SignInForm({ initialError }: { initialError: SignInErrorKey | null }) {
  const t = useTranslations("auth");
  const common = useTranslations("common");
  const router = useRouter();
  const [error, setError] = useState<SignInErrorKey | null>(initialError);
  const [pending, setPending] = useState(false);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    setPending(true);
    let result;
    try {
      result = await authClient.signIn.email({
        email: String(form.get("email")),
        password: String(form.get("password")),
      });
    } catch {
      setError("generic");
      return;
    } finally {
      setPending(false);
    }
    if (result.error) {
      setError(signInErrorKey(result.error.code ?? "generic"));
      return;
    }
    router.push("/");
    router.refresh();
  }

  return (
    <div className="flex flex-col gap-4">
      {error && (
        <p role="alert" className="rounded-lg bg-neg-bg px-3 py-2 text-sm text-neg">
          {t(`errors.${error}`)}
        </p>
      )}
      <Button
        variant="primary"
        size="lg"
        className="w-full"
        icon={<KeyRound aria-hidden className="size-4" />}
        onClick={async () => {
          if (!(await startAuthentikSignIn("/"))) setError("oidc");
        }}
      >
        {t("signIn.authentik")}
      </Button>
      <div className="flex items-center gap-3 text-sm text-faint">
        <span className="h-px flex-1 bg-border" />
        <span>{common("or")}</span>
        <span className="h-px flex-1 bg-border" />
      </div>
      <form onSubmit={onSubmit} className="flex flex-col gap-3">
        <Field label={t("signIn.email")} htmlFor="email">
          <Input id="email" name="email" type="email" autoComplete="email" required />
        </Field>
        <Field label={t("signIn.password")} htmlFor="password">
          <Input id="password" name="password" type="password" autoComplete="current-password" required />
        </Field>
        <Button type="submit" disabled={pending} className="w-full">
          {t("signIn.submit")}
        </Button>
        <Link
          href="/forgot-password"
          className="focus-ring inline-flex min-h-6 items-center rounded-[2px] text-sm font-medium text-accent hover:underline"
        >
          {t("signIn.forgot")}
        </Link>
      </form>
    </div>
  );
}
