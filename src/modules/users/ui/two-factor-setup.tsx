"use client";

import { useTranslations } from "next-intl";
import { type FormEvent, useId, useState } from "react";
import { authClient } from "@/platform/auth/client";
import { Button } from "@/ui/button";
import { Field } from "@/ui/field";
import { Checkbox, Input } from "@/ui/input";
import { QrCode } from "@/ui/qr-code";
import { normalizeTotp, totpSecretOf, type TwoFactorErrorKey, twoFactorErrorKey } from "../two-factor";
import { RecoveryCodes } from "./recovery-codes";

type Enrollment = { totpURI: string; backupCodes: string[] };

/**
 * TOTP setup, in two steps (docs/auth-design.md D2): the password, which Better Auth asks before it
 * creates a secret; then the QR code, the recovery codes and one code from the app. TOTP is on only
 * after that code: a secret nobody has scanned never locks anyone out. Used by the forced setup
 * page and by Settings › Security.
 */
export function TwoFactorSetup({ account, onDone }: { account: string; onDone: () => void }) {
  const t = useTranslations("auth.twoFactor");
  const id = useId();
  const [enrollment, setEnrollment] = useState<Enrollment | null>(null);
  const [error, setError] = useState<TwoFactorErrorKey | null>(null);
  const [pending, setPending] = useState(false);

  async function call<T>(
    request: () => Promise<{ data: T | null; error: { code?: string; status?: number } | null }>,
  ) {
    setPending(true);
    try {
      const result = await request();
      if (result.error || !result.data) {
        setError(twoFactorErrorKey(result.error));
        return null;
      }
      setError(null);
      return result.data;
    } catch {
      setError("generic");
      return null;
    } finally {
      setPending(false);
    }
  }

  async function onPassword(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const password = String(new FormData(event.currentTarget).get("password") ?? "");
    const data = await call(() => authClient.twoFactor.enable({ password }));
    if (data && "totpURI" in data && data.totpURI && data.backupCodes) {
      setEnrollment({ totpURI: data.totpURI, backupCodes: data.backupCodes });
    }
  }

  async function onVerify(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const code = normalizeTotp(String(new FormData(event.currentTarget).get("code") ?? ""));
    if (await call(() => authClient.twoFactor.verifyTotp({ code }))) onDone();
  }

  const alert = error && (
    <p role="alert" className="rounded-lg bg-neg-bg px-3 py-2 text-sm text-neg">
      {t(`errors.${error}`)}
    </p>
  );

  if (!enrollment) {
    return (
      <form onSubmit={onPassword} className="flex flex-col gap-3">
        {alert}
        <p className="text-sm text-muted">{t("setup.passwordIntro")}</p>
        <Field label={t("setup.password")} htmlFor={`${id}-password`}>
          <Input
            id={`${id}-password`}
            name="password"
            type="password"
            autoComplete="current-password"
            required
          />
        </Field>
        <Button type="submit" variant="primary" disabled={pending} className="w-full">
          {t("setup.continue")}
        </Button>
      </form>
    );
  }

  const secret = totpSecretOf(enrollment.totpURI);
  return (
    <form onSubmit={onVerify} className="flex flex-col gap-4">
      {alert}
      <div className="flex flex-col gap-2">
        <h2 className="text-sm font-semibold">{t("setup.scanTitle")}</h2>
        <p className="text-sm text-muted">{t("setup.scanHint")}</p>
        <div className="self-center">
          <QrCode value={enrollment.totpURI} label={t("setup.qrLabel")} />
        </div>
        {secret && (
          <p className="text-sm text-muted">
            {t("setup.manual")}{" "}
            <code data-testid="totp-secret" className="font-mono break-all text-fg">
              {secret}
            </code>
          </p>
        )}
      </div>
      <div className="flex flex-col gap-2">
        <h2 className="text-sm font-semibold">{t("setup.codesTitle")}</h2>
        <p className="text-sm text-muted">{t("setup.codesHint")}</p>
        <RecoveryCodes codes={enrollment.backupCodes} account={account} />
        <Checkbox name="saved" label={t("setup.saved")} required />
      </div>
      <Field label={t("setup.code")} htmlFor={`${id}-code`} hint={t("setup.codeHint")}>
        <Input
          id={`${id}-code`}
          name="code"
          inputMode="numeric"
          autoComplete="one-time-code"
          pattern="[0-9 \-]{6,8}"
          maxLength={8}
          required
        />
      </Field>
      <Button type="submit" variant="primary" disabled={pending} className="w-full">
        {t("setup.confirm")}
      </Button>
    </form>
  );
}
