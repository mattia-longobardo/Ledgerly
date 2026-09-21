"use client";

import { useTranslations } from "next-intl";
import { type FormEvent, useState, useTransition } from "react";
import { updateNameAction } from "@/modules/users/actions";
import type { Role } from "@/platform/context";
import { MAX_NAME_LENGTH } from "@/platform/auth/name-policy";
import { Avatar } from "@/ui/avatar";
import { Button } from "@/ui/button";
import { CardFooter } from "@/ui/card";
import { Field } from "@/ui/field";
import { Input } from "@/ui/input";
import { notify } from "@/ui/toast";

export function NameForm({
  name,
  email,
  role,
  sso,
}: {
  name: string;
  email: string;
  role: Role;
  sso: boolean;
}) {
  const t = useTranslations("settings.account");
  const common = useTranslations("common");
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const value = String(new FormData(event.currentTarget).get("name"));
    startTransition(async () => {
      try {
        const result = await updateNameAction(value);
        if (!result.ok) {
          setError(result.error === "sso" ? t("errors.sso") : t("errors.invalid", { max: MAX_NAME_LENGTH }));
          return;
        }
        setError(null);
        notify(t("saved"));
      } catch {
        setError(t("errors.failed"));
      }
    });
  }

  return (
    <form onSubmit={onSubmit} className="grid grid-cols-1 gap-x-4 gap-y-3 sm:grid-cols-2">
      {error && (
        <p role="alert" className="text-sm text-neg sm:col-span-2">
          {error}
        </p>
      )}
      <div className="sm:col-span-2">
        <Avatar name={name} size={40} decorative />
      </div>
      <Field label={t("name")} htmlFor="name">
        <Input
          id="name"
          name="name"
          defaultValue={name}
          readOnly={sso}
          maxLength={MAX_NAME_LENGTH}
          required
        />
      </Field>
      <Field label={t("email")} htmlFor="email">
        <Input id="email" value={email} readOnly />
      </Field>
      <CardFooter>
        <span className="text-sm text-muted">
          {t.rich("role", {
            role: t(`roles.${role}`),
            strong: (chunks) => <span className="font-medium text-fg">{chunks}</span>,
          })}
        </span>
        {sso ? (
          <span className="text-sm text-muted">{t("ssoNote")}</span>
        ) : (
          <Button type="submit" variant="primary" size="sm" disabled={pending}>
            {common("save")}
          </Button>
        )}
      </CardFooter>
    </form>
  );
}
