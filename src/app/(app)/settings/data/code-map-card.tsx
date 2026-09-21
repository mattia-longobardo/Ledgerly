"use client";

import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { type FormEvent, useState, useTransition } from "react";
import { resetCodeAction, setCodeRoleAction } from "@/modules/payroll/actions";
import { CODE_ROLES } from "@/modules/payroll/rules";
import { Badge } from "@/ui/badge";
import { Button } from "@/ui/button";
import { Input, Select } from "@/ui/input";
import { notify } from "@/ui/toast";

interface Entry {
  code: string;
  role: string;
  note: string | null;
  seeded: boolean;
}

/**
 * Settings › Data › the payslip code map (spec §7.8, §7.10): what each body code means. A change
 * applies to the payslips read after it; the ones already imported are read again from their page.
 */
export function CodeMapCard({ entries }: { entries: Entry[] }) {
  const t = useTranslations("settings.codeMap");
  const roles = useTranslations("payroll.roles");
  const errors = useTranslations("payroll.errors");
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function run(action: () => Promise<{ ok: true } | { ok: false; error: string }>) {
    startTransition(async () => {
      const result = await action();
      if (!result.ok) {
        setError(errors(result.error as never));
        return;
      }
      setError(null);
      notify(t("saved"));
      router.refresh();
    });
  }

  function onSave(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    run(() =>
      setCodeRoleAction(
        String(data.get("code") ?? ""),
        String(data.get("role") ?? ""),
        String(data.get("note") ?? ""),
      ),
    );
  }

  function onAdd(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const data = new FormData(form);
    run(async () => {
      const result = await setCodeRoleAction(
        String(data.get("code") ?? ""),
        String(data.get("role") ?? ""),
        "",
      );
      if (result.ok) form.reset();
      return result;
    });
  }

  const roleOptions = CODE_ROLES.map((role) => (
    <option key={role} value={role}>
      {roles(role)}
    </option>
  ));

  return (
    <div className="flex flex-col">
      <div className="grid grid-cols-[80px_minmax(0,1fr)_minmax(0,1fr)_auto] gap-2 border-b border-border px-4 py-2 text-sm text-muted max-md:hidden">
        <span>{t("code")}</span>
        <span>{t("role")}</span>
        <span>{t("note")}</span>
        <span />
      </div>
      <ul className="max-h-[420px] divide-y divide-border overflow-auto" data-testid="code-map">
        {entries.map((entry) => (
          <li key={entry.code} data-code={entry.code}>
            {/* Keyed by what is stored: a reset or a save elsewhere redraws the row with it. */}
            <form
              key={`${entry.role}|${entry.note ?? ""}`}
              onSubmit={onSave}
              className="grid grid-cols-[80px_minmax(0,1fr)_minmax(0,1fr)_auto] items-center gap-2 px-4 py-1.5 max-md:grid-cols-2"
            >
              <input type="hidden" name="code" value={entry.code} />
              <span className="flex items-center gap-1.5 font-medium tabular-nums">
                {entry.code}
                {!entry.seeded && <Badge tone="accent">{t("custom")}</Badge>}
              </span>
              <Select name="role" defaultValue={entry.role} aria-label={`${t("role")} ${entry.code}`}>
                {roleOptions}
              </Select>
              <Input
                name="note"
                defaultValue={entry.note ?? ""}
                maxLength={200}
                aria-label={`${t("note")} ${entry.code}`}
              />
              <span className="flex gap-1">
                <Button type="submit" size="xs" disabled={pending}>
                  {t("save")}
                </Button>
                <Button
                  size="xs"
                  variant="ghost"
                  disabled={pending}
                  onClick={() => run(() => resetCodeAction(entry.code))}
                >
                  {entry.seeded ? t("reset") : t("remove")}
                </Button>
              </span>
            </form>
          </li>
        ))}
      </ul>
      <form onSubmit={onAdd} className="flex flex-wrap items-end gap-2 border-t border-border px-4 py-3">
        <label className="flex flex-col gap-1 text-sm">
          <span className="text-muted">{t("addCode")}</span>
          <Input name="code" inputMode="numeric" pattern="[0-9]{1,6}" required className="w-24" />
        </label>
        <label className="flex min-w-48 flex-1 flex-col gap-1 text-sm">
          <span className="text-muted">{t("role")}</span>
          <Select name="role" defaultValue="statistical">
            {roleOptions}
          </Select>
        </label>
        <Button type="submit" variant="primary" size="sm" disabled={pending}>
          {t("add")}
        </Button>
      </form>
      {error && (
        <p role="alert" className="px-4 pb-3 text-sm text-neg">
          {error}
        </p>
      )}
    </div>
  );
}
