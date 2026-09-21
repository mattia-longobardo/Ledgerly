"use client";

import { useTranslations } from "next-intl";
import { type FormEvent, useId, useState, useTransition } from "react";
import type { Role } from "@/platform/context";
import { Button } from "@/ui/button";
import { Field } from "@/ui/field";
import { Input, Select } from "@/ui/input";
import { Modal } from "@/ui/modal";
import { notify } from "@/ui/toast";
import { invitePersonAction } from "../actions";

/**
 * "Invite user" (design row 873): the button the design puts under the section's description, with
 * the dialog it opens. Its own component because it shares nothing with the table — the invitation
 * appears there on the next render, like every other change to the list.
 */
export function InvitePerson() {
  const t = useTranslations("settings.people");
  const id = useId();
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    startTransition(async () => {
      const result = await invitePersonAction(
        String(data.get("email") ?? ""),
        String(data.get("role") ?? "user") as Role,
      );
      if (!result.ok) {
        setError(t(`errors.${result.error}`));
        return;
      }
      setError(null);
      setOpen(false);
      // "Sent", "held back by the switch" and "refused by the mail server" are three different
      // facts: the invitation is a row in all three, and a link nobody was told about has to be
      // handed over some other way (plan F8 §3.4.6).
      notify(t(`invitation.${result.outcome}`), result.outcome === "sent" ? "success" : "error");
    });
  }

  return (
    <>
      <Button variant="primary" onClick={() => setOpen(true)}>
        {t("invite")}
      </Button>
      <Modal open={open} onOpenChange={setOpen} title={t("invite")} width={420}>
        <form onSubmit={onSubmit} className="flex flex-col gap-4" noValidate>
          <Field
            label={t("columns.email")}
            htmlFor={`${id}-email`}
            hint={t("inviteHint")}
            error={error ?? undefined}
          >
            <Input id={`${id}-email`} name="email" type="email" autoComplete="off" required />
          </Field>
          <Field label={t("columns.role")} htmlFor={`${id}-role`}>
            <Select id={`${id}-role`} name="role" defaultValue="user">
              <option value="user">{t("roles.user")}</option>
              <option value="admin">{t("roles.admin")}</option>
            </Select>
          </Field>
          <div className="flex justify-end gap-2">
            <Button onClick={() => setOpen(false)} disabled={pending}>
              {t("cancel")}
            </Button>
            <Button type="submit" variant="primary" disabled={pending}>
              {t("sendInvitation")}
            </Button>
          </div>
        </form>
      </Modal>
    </>
  );
}
