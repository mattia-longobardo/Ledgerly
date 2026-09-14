"use client";

import { useTranslations } from "next-intl";
import { type FormEvent, useTransition } from "react";
import { updateNameAction } from "@/modules/users/actions";
import { Button } from "@/ui/button";
import { Field } from "@/ui/field";
import { Input } from "@/ui/input";
import { notify } from "@/ui/toast";

export function NameForm({ name, email, sso }: { name: string; email: string; sso: boolean }) {
  const t = useTranslations("settings.account");
  const common = useTranslations("common");
  const [pending, startTransition] = useTransition();

  function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const value = String(new FormData(event.currentTarget).get("name"));
    startTransition(async () => {
      await updateNameAction(value);
      notify(t("saved"));
    });
  }

  return (
    <form onSubmit={onSubmit} className="grid grid-cols-1 gap-x-4 gap-y-3 sm:grid-cols-2">
      <Field label={t("name")} htmlFor="name">
        <Input id="name" name="name" defaultValue={name} readOnly={sso} required />
      </Field>
      <Field label={t("email")} htmlFor="email">
        <Input id="email" value={email} readOnly />
      </Field>
      {sso ? (
        <p className="text-sm text-muted sm:col-span-2">{t("ssoNote")}</p>
      ) : (
        <div className="flex justify-end sm:col-span-2">
          <Button type="submit" variant="primary" size="sm" disabled={pending}>
            {common("save")}
          </Button>
        </div>
      )}
    </form>
  );
}
