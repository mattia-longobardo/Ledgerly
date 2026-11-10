"use client";

import { useTranslations } from "next-intl";
import { type FormEvent, useRef, useState, useTransition } from "react";
import { updateNameAction } from "@/modules/users/actions";
import type { Role } from "@/platform/context";
import { MAX_NAME_LENGTH } from "@/platform/auth/name-policy";
import { Avatar } from "@/ui/avatar";
import { CardFooter } from "@/ui/card";
import { Field } from "@/ui/field";
import { Input } from "@/ui/input";
import { notify } from "@/ui/toast";
import { useUnsavedForm } from "@/ui/unsaved-changes";

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
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const formRef = useRef<HTMLFormElement>(null);
  const unsaved = useUnsavedForm(formRef, pending);

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
        unsaved.saved();
        notify(t("saved"));
      } catch {
        setError(t("errors.failed"));
      }
    });
  }

  return (
    <form ref={formRef} onSubmit={onSubmit} className="grid grid-cols-1 gap-x-4 gap-y-3 sm:grid-cols-2">
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
        {sso && <span className="text-sm text-muted">{t("ssoNote")}</span>}
      </CardFooter>
    </form>
  );
}
