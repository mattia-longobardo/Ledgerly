"use client";

import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { type FormEvent, useId, useState, useTransition } from "react";
import { ENCRYPTIONS, type Encryption, type MailPolicy } from "@/platform/settings/smtp";
import { Button } from "@/ui/button";
import { Field } from "@/ui/field";
import { Checkbox, Input, Select } from "@/ui/input";
import { notify } from "@/ui/toast";
import { removeSmtpAction, saveSmtpAction, sendTestEmailAction } from "./actions";

export interface SmtpCardProps {
  host: string;
  port: number;
  encryption: Encryption;
  user: string;
  passwordHint: string;
  from: string;
  policy: MailPolicy;
  /** false while the values still come from `.env.homelab` (plan F8 §3.4.3). */
  saved: boolean;
}

/** Admin › Server › Outgoing email (spec §9.4, design row 885). */
export function SmtpCard({ host, port, encryption, user, passwordHint, from, policy, saved }: SmtpCardProps) {
  const t = useTranslations("settings.smtp");
  const id = useId();
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  const [tested, setTested] = useState<{ message: string; ok: boolean } | null>(null);
  // Controlled only so the warning under "Invitations & resets" can appear the moment it is
  // switched off, before anything is saved: that switch is the one that can lock a person out.
  const [invitations, setInvitations] = useState(policy.invitations);

  function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const data = new FormData(form);
    startTransition(async () => {
      const result = await saveSmtpAction({
        host: String(data.get("host") ?? ""),
        port: Number(data.get("port") ?? 0),
        encryption: String(data.get("encryption") ?? "none") as Encryption,
        user: String(data.get("user") ?? ""),
        password: String(data.get("password") ?? ""),
        from: String(data.get("from") ?? ""),
        invitations: data.get("invitations") === "on",
        syncAlerts: data.get("syncAlerts") === "on",
        monthlySummary: data.get("monthlySummary") === "on",
      });
      if (!result.ok) {
        setError(t(`errors.${result.error}`));
        return;
      }
      setError(null);
      setTested(null);
      (form.elements.namedItem("password") as HTMLInputElement).value = "";
      notify(t("saved"));
      router.refresh();
    });
  }

  function onRemove() {
    startTransition(async () => {
      await removeSmtpAction();
      setTested(null);
      notify(t("removed"));
      router.refresh();
    });
  }

  /** Tries what is *saved*, not what is typed: the password never leaves the server. */
  function onTest() {
    setSending(true);
    startTransition(async () => {
      const result = await sendTestEmailAction();
      setSending(false);
      setTested({
        message:
          result.outcome === "ok"
            ? t("test.ok", { to: result.to })
            : result.outcome === "failed"
              ? t("test.failed", { reason: result.reason })
              : t("test.noAddress"),
        ok: result.outcome === "ok",
      });
    });
  }

  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-3.5" noValidate>
      {!saved && (
        <p className="text-sm text-muted" data-testid="smtp-source">
          {t("fromEnv")}
        </p>
      )}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 sm:gap-x-4">
        <Field label={t("host")} htmlFor={`${id}-host`}>
          <Input id={`${id}-host`} name="host" defaultValue={host} autoComplete="off" required />
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label={t("port")} htmlFor={`${id}-port`}>
            <Input
              id={`${id}-port`}
              name="port"
              type="number"
              inputMode="numeric"
              min={1}
              max={65535}
              defaultValue={port}
              required
            />
          </Field>
          <Field label={t("encryption")} htmlFor={`${id}-encryption`}>
            <Select id={`${id}-encryption`} name="encryption" defaultValue={encryption}>
              {ENCRYPTIONS.map((value) => (
                <option key={value} value={value}>
                  {t(`encryptions.${value}`)}
                </option>
              ))}
            </Select>
          </Field>
        </div>
        <Field label={t("user")} htmlFor={`${id}-user`}>
          <Input id={`${id}-user`} name="user" defaultValue={user} autoComplete="off" />
        </Field>
        <Field
          label={t("password")}
          htmlFor={`${id}-password`}
          hint={passwordHint ? t("passwordKeep") : undefined}
        >
          <Input
            id={`${id}-password`}
            name="password"
            type="password"
            autoComplete="off"
            placeholder={passwordHint ? `•••• ${passwordHint}` : undefined}
          />
        </Field>
        <div className="sm:col-span-2">
          <Field label={t("from")} htmlFor={`${id}-from`}>
            <Input id={`${id}-from`} name="from" defaultValue={from} autoComplete="off" required />
          </Field>
        </div>
      </div>
      {error && (
        <p role="alert" className="text-sm text-neg">
          {error}
        </p>
      )}
      {tested && (
        <p
          role="status"
          data-testid="smtp-test-result"
          className={tested.ok ? "text-sm text-pos" : "text-sm text-neg"}
        >
          {tested.message}
        </p>
      )}
      <div className="flex flex-col gap-3 border-t border-border pt-3">
        <fieldset className="flex flex-col gap-1.5">
          <legend className="pb-1 text-sm font-medium">{t("policy")}</legend>
          <div className="flex flex-wrap gap-x-4 gap-y-1">
            <Checkbox
              name="invitations"
              label={t("invitations")}
              checked={invitations}
              onChange={(event) => setInvitations(event.currentTarget.checked)}
            />
            <Checkbox name="syncAlerts" label={t("syncAlerts")} defaultChecked={policy.syncAlerts} />
            <Checkbox
              name="monthlySummary"
              label={t("monthlySummary")}
              defaultChecked={policy.monthlySummary}
            />
          </div>
          {!invitations && <p className="text-sm text-warn">{t("invitationsWarning")}</p>}
        </fieldset>
        <div className="flex flex-wrap justify-end gap-2">
          {saved && (
            <Button variant="danger" size="sm" onClick={onRemove} disabled={pending} className="mr-auto">
              {t("remove")}
            </Button>
          )}
          <Button size="sm" onClick={onTest} disabled={pending}>
            {sending ? t("test.running") : t("test.action")}
          </Button>
          <Button type="submit" size="sm" variant="primary" disabled={pending}>
            {t("save")}
          </Button>
        </div>
      </div>
    </form>
  );
}
