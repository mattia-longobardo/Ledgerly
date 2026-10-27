"use client";

import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { type FormEvent, useId, useState } from "react";
import { type TwoFactorErrorKey, twoFactorErrorKey } from "@/modules/users/two-factor";
import { RecoveryCodes } from "@/modules/users/ui/recovery-codes";
import { TwoFactorSetup } from "@/modules/users/ui/two-factor-setup";
import { authClient } from "@/platform/auth/client";
import type { TwoFactorPolicy } from "@/platform/auth/two-factor-policy";
import { Badge } from "@/ui/badge";
import { Button } from "@/ui/button";
import { Field } from "@/ui/field";
import { Input } from "@/ui/input";
import { Modal } from "@/ui/modal";
import { notify } from "@/ui/toast";

type Dialog = "setup" | "codes" | "disable" | null;

/**
 * Settings › Security › Two-factor authentication, for a password account (docs/auth-design.md D2):
 * set it up, get new recovery codes, or turn it off — the last two with the password again.
 */
export function TwoFactorCard({
  enabled,
  policy,
  account,
}: {
  enabled: boolean;
  policy: TwoFactorPolicy;
  account: string;
}) {
  const t = useTranslations("settings.twoFactor");
  const tf = useTranslations("auth.twoFactor");
  const id = useId();
  const router = useRouter();
  const [dialog, setDialog] = useState<Dialog>(null);
  const [codes, setCodes] = useState<string[] | null>(null);
  const [error, setError] = useState<TwoFactorErrorKey | null>(null);
  const [pending, setPending] = useState(false);

  function close() {
    setDialog(null);
    setCodes(null);
    setError(null);
  }

  async function withPassword(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const password = String(new FormData(event.currentTarget).get("password") ?? "");
    setPending(true);
    try {
      if (dialog === "codes") {
        const { data, error: failed } = await authClient.twoFactor.generateBackupCodes({ password });
        if (failed || !data) return setError(twoFactorErrorKey(failed));
        setError(null);
        setCodes(data.backupCodes);
        return;
      }
      const { error: failed } = await authClient.twoFactor.disable({ password });
      if (failed) return setError(twoFactorErrorKey(failed));
      close();
      notify(t("disabled"), "success");
      router.refresh();
    } catch {
      setError("generic");
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="flex flex-col gap-3 p-4">
      <div className="flex flex-wrap items-center gap-2">
        <Badge tone={enabled ? "pos" : "neutral"}>{enabled ? t("on") : t("off")}</Badge>
        <span className="text-sm text-muted">{enabled ? t("onHint") : t("offHint")}</span>
      </div>
      <div className="flex flex-wrap gap-2">
        {enabled ? (
          <>
            <Button size="sm" onClick={() => setDialog("codes")}>
              {t("newCodes")}
            </Button>
            <Button size="sm" variant="danger" onClick={() => setDialog("disable")}>
              {t("disable")}
            </Button>
          </>
        ) : (
          <Button size="sm" variant="primary" onClick={() => setDialog("setup")}>
            {t("enable")}
          </Button>
        )}
      </div>

      <Modal
        open={dialog === "setup"}
        onOpenChange={(next) => !next && close()}
        title={t("enable")}
        width={440}
      >
        <TwoFactorSetup
          account={account}
          onDone={() => {
            close();
            notify(t("enabled"), "success");
            router.refresh();
          }}
        />
      </Modal>

      <Modal
        open={dialog === "codes" || dialog === "disable"}
        onOpenChange={(next) => !next && close()}
        title={dialog === "disable" ? t("disableTitle") : t("newCodes")}
        description={
          dialog === "disable"
            ? policy === "required"
              ? t("disableRequired")
              : t("disableWarning")
            : codes
              ? tf("setup.codesHint")
              : t("newCodesWarning")
        }
        width={440}
      >
        {codes ? (
          <div className="flex flex-col gap-3">
            <RecoveryCodes codes={codes} account={account} />
            <div className="flex justify-end">
              <Button variant="primary" onClick={close}>
                {t("done")}
              </Button>
            </div>
          </div>
        ) : (
          <form onSubmit={withPassword} className="flex flex-col gap-3">
            {error && (
              <p role="alert" className="rounded-lg bg-neg-bg px-3 py-2 text-sm text-neg">
                {tf(`errors.${error}`)}
              </p>
            )}
            <Field label={tf("setup.password")} htmlFor={`${id}-password`}>
              <Input
                id={`${id}-password`}
                name="password"
                type="password"
                autoComplete="current-password"
                required
              />
            </Field>
            <div className="flex justify-end gap-2">
              <Button onClick={close} disabled={pending}>
                {t("cancel")}
              </Button>
              <Button type="submit" variant={dialog === "disable" ? "danger" : "primary"} disabled={pending}>
                {dialog === "disable" ? t("disable") : t("generate")}
              </Button>
            </div>
          </form>
        )}
      </Modal>
    </div>
  );
}
