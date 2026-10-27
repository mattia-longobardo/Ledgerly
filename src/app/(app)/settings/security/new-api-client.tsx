"use client";

import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { type FormEvent, useId, useState, useTransition } from "react";
import { TOKEN_SCOPES } from "@/platform/tokens/rules";
import { Button } from "@/ui/button";
import { Field } from "@/ui/field";
import { Checkbox, Input } from "@/ui/input";
import { Modal } from "@/ui/modal";
import { notify } from "@/ui/toast";
import { type ApiClientMinted, createApiClientAction } from "./actions";

/**
 * "New client" (docs/auth-design.md D3): what replaces "New token". The secret exists outside the
 * person's clipboard only while this dialog is open; the plugin keeps a hash of it.
 */
export function NewApiClient() {
  const t = useTranslations("settings.apiClients");
  const scopesT = useTranslations("settings.tokens");
  const id = useId();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [minted, setMinted] = useState<ApiClientMinted | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function close() {
    setOpen(false);
    setMinted(null);
    setError(null);
  }

  function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    const scopes = TOKEN_SCOPES.filter((scope) => data.get(scope) === "on");
    startTransition(async () => {
      const result = await createApiClientAction({ name: String(data.get("name") ?? ""), scopes });
      if (!result.ok) {
        setError(t(`errors.${result.error}`));
        return;
      }
      setError(null);
      setMinted(result.client);
      router.refresh();
    });
  }

  async function copy(value: string) {
    try {
      await navigator.clipboard.writeText(value);
      notify(t("copied"), "success");
    } catch {
      notify(scopesT("copyFailed"), "error");
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
        width={520}
      >
        {minted ? (
          <div className="flex flex-col gap-3">
            {(
              [
                ["clientId", minted.clientId],
                ["clientSecret", minted.clientSecret],
                ["tokenEndpoint", minted.tokenEndpoint],
                ["resource", minted.resource],
              ] as const
            ).map(([key, value]) => (
              <div key={key} className="flex flex-col gap-1">
                <span className="text-sm font-medium">{t(`minted.${key}`)}</span>
                <div className="flex items-start gap-2">
                  <code
                    data-testid={`minted-${key}`}
                    className="min-w-0 flex-1 rounded-ctl border border-border bg-hover px-2.5 py-2 font-mono text-sm break-all"
                  >
                    {value}
                  </code>
                  <Button size="sm" onClick={() => copy(value)}>
                    {scopesT("copy")}
                  </Button>
                </div>
              </div>
            ))}
            <p className="text-sm text-muted">{t("mintedHint")}</p>
            <div className="flex justify-end">
              <Button variant="primary" onClick={close}>
                {scopesT("done")}
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
                  label={`${scopesT(`scopes.${scope}`)} — ${scopesT(`scopeHints.${scope}`)}`}
                  defaultChecked={scope === "read"}
                />
              ))}
            </fieldset>
            <div className="flex justify-end gap-2">
              <Button onClick={close} disabled={pending}>
                {scopesT("cancel")}
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
