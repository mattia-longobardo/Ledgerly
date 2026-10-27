"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { type FormEvent, useId, useState } from "react";
import { normalizeTotp, type TwoFactorErrorKey, twoFactorErrorKey } from "@/modules/users/two-factor";
import { authClient } from "@/platform/auth/client";
import { Button } from "@/ui/button";
import { Field } from "@/ui/field";
import { Checkbox, Input } from "@/ui/input";

/** A code from the authenticator app, or one of the recovery codes when the phone is gone. */
export function ChallengeForm({ trustDays }: { trustDays: number }) {
  const t = useTranslations("auth.twoFactor");
  const id = useId();
  const router = useRouter();
  const [mode, setMode] = useState<"totp" | "backup">("totp");
  const [error, setError] = useState<TwoFactorErrorKey | null>(null);
  const [pending, setPending] = useState(false);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const raw = String(form.get("code") ?? "");
    const trustDevice = form.get("trust") === "on";
    setPending(true);
    let result;
    try {
      result =
        mode === "totp"
          ? await authClient.twoFactor.verifyTotp({ code: normalizeTotp(raw), trustDevice })
          : await authClient.twoFactor.verifyBackupCode({ code: raw.trim(), trustDevice });
    } catch {
      setError("generic");
      return;
    } finally {
      setPending(false);
    }
    if (result.error) {
      setError(twoFactorErrorKey(result.error));
      return;
    }
    router.push("/");
    router.refresh();
  }

  const restart = error === "expired" || error === "tooManyAttempts";
  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-3">
      {error && (
        <p role="alert" className="rounded-lg bg-neg-bg px-3 py-2 text-sm text-neg">
          {t(`errors.${error}`)}
        </p>
      )}
      {mode === "totp" ? (
        <Field label={t("challenge.code")} htmlFor={`${id}-code`} hint={t("challenge.codeHint")}>
          <Input
            key="totp"
            id={`${id}-code`}
            name="code"
            inputMode="numeric"
            autoComplete="one-time-code"
            pattern="[0-9 \-]{6,8}"
            maxLength={8}
            autoFocus
            required
          />
        </Field>
      ) : (
        <Field label={t("challenge.recoveryCode")} htmlFor={`${id}-code`} hint={t("challenge.recoveryHint")}>
          <Input
            key="backup"
            id={`${id}-code`}
            name="code"
            autoComplete="off"
            maxLength={16}
            autoFocus
            required
          />
        </Field>
      )}
      <Checkbox name="trust" label={t("challenge.trust", { days: trustDays })} />
      <Button type="submit" variant="primary" disabled={pending || restart} className="w-full">
        {t("challenge.submit")}
      </Button>
      <button
        type="button"
        className="focus-ring inline-flex min-h-6 items-center self-start rounded-[2px] text-sm font-medium text-accent hover:underline"
        onClick={() => {
          setMode(mode === "totp" ? "backup" : "totp");
          setError(null);
        }}
      >
        {mode === "totp" ? t("challenge.useRecovery") : t("challenge.useApp")}
      </button>
      <Link
        href="/sign-in"
        className="focus-ring inline-flex min-h-6 items-center self-start rounded-[2px] text-sm font-medium text-accent hover:underline"
      >
        {t("challenge.back")}
      </Link>
    </form>
  );
}
