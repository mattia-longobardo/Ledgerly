"use client";

import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { type FormEvent, useId, useState, useTransition } from "react";
import { type ExpiryChoice, TOKEN_SCOPES } from "@/platform/tokens/rules";
import { Button } from "@/ui/button";
import { Field } from "@/ui/field";
import { Checkbox, Input, Select } from "@/ui/input";
import { Modal } from "@/ui/modal";
import { notify } from "@/ui/toast";
import { createTokenAction } from "./actions";

const EXPIRY_OPTIONS = ["30", "90", "365", "never"] as const;

function expiryOf(value: string): ExpiryChoice {
  return value === "never" ? null : (Number(value) as 30 | 90 | 365);
}

/**
 * "New token" (design row 853): the button under the section's description, the form it opens, and
 * the one moment the value exists outside the person's own clipboard. Once this dialog closes the
 * token is gone — only the prefix survives, in the table (spec §5.3).
 */
export function NewToken() {
  const t = useTranslations("settings.tokens");
  const id = useId();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [minted, setMinted] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [pending, startTransition] = useTransition();

  function close() {
    setOpen(false);
    setMinted(null);
    setError(null);
    setCopied(false);
  }

  function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    const scopes = TOKEN_SCOPES.filter((scope) => data.get(scope) === "on");
    startTransition(async () => {
      const result = await createTokenAction({
        name: String(data.get("name") ?? ""),
        scopes,
        expiresInDays: expiryOf(String(data.get("expiry") ?? "never")),
      });
      if (!result.ok) {
        setError(t(`errors.${result.error}`));
        return;
      }
      setError(null);
      setMinted(result.token);
      router.refresh();
    });
  }

  async function onCopy() {
    if (!minted) return;
    try {
      await navigator.clipboard.writeText(minted);
      setCopied(true);
    } catch {
      // A browser that refuses the clipboard is not a failure worth a dialog: the value is on
      // screen and can be selected by hand.
      notify(t("copyFailed"), "error");
    }
  }

  return (
    <>
      <Button variant="primary" onClick={() => setOpen(true)}>
        {t("new")}
      </Button>
      <Modal
        open={open}
        onOpenChange={(next) => !next && close()}
        title={minted ? t("mintedTitle") : t("new")}
        description={minted ? t("mintedWarning") : undefined}
        width={460}
      >
        {minted ? (
          <div className="flex flex-col gap-3">
            <code
              data-testid="minted-token"
              className="rounded-ctl border border-border bg-hover px-2.5 py-2 font-mono text-sm break-all"
            >
              {minted}
            </code>
            <div className="flex justify-end gap-2">
              <Button onClick={onCopy}>{copied ? t("copied") : t("copy")}</Button>
              <Button variant="primary" onClick={close}>
                {t("done")}
              </Button>
            </div>
          </div>
        ) : (
          <form onSubmit={onSubmit} className="flex flex-col gap-4" noValidate>
            <Field
              label={t("columns.name")}
              htmlFor={`${id}-name`}
              hint={t("nameHint")}
              error={error ?? undefined}
            >
              <Input id={`${id}-name`} name="name" maxLength={60} autoComplete="off" required />
            </Field>
            <fieldset className="flex flex-col gap-1.5">
              <legend className="pb-1 text-sm font-medium">{t("columns.scopes")}</legend>
              {TOKEN_SCOPES.map((scope) => (
                <Checkbox
                  key={scope}
                  name={scope}
                  label={`${t(`scopes.${scope}`)} — ${t(`scopeHints.${scope}`)}`}
                  defaultChecked={scope === "read"}
                />
              ))}
            </fieldset>
            <Field label={t("columns.expires")} htmlFor={`${id}-expiry`}>
              <Select id={`${id}-expiry`} name="expiry" defaultValue="90">
                {EXPIRY_OPTIONS.map((option) => (
                  <option key={option} value={option}>
                    {t(`expiry.${option}`)}
                  </option>
                ))}
              </Select>
            </Field>
            <div className="flex justify-end gap-2">
              <Button onClick={close} disabled={pending}>
                {t("cancel")}
              </Button>
              <Button type="submit" variant="primary" disabled={pending}>
                {t("create")}
              </Button>
            </div>
          </form>
        )}
      </Modal>
    </>
  );
}
