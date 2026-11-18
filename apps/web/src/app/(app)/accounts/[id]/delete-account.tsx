"use client";

import type { Route } from "next";
import { useRouter } from "next/navigation";
import { useLocale, useTranslations } from "next-intl";
import { useState, useTransition } from "react";
import { type CivilDate, isCivilDate } from "@ledgerly/domain/shared/dates";
import { formatDate, type UiLocale } from "@ledgerly/domain/platform/format";
import { Button } from "@/ui/button";
import { Select } from "@/ui/input";
import { Modal } from "@/ui/modal";
import { notify } from "@/ui/toast";
import type { Dependent } from "./delete";
import { accountDependentsAction, deleteAccountAction, moveDependentAction } from "./delete-actions";

interface Loaded {
  dependents: Dependent[];
  targets: { id: string; name: string }[];
}

/**
 * Account › Settings › Danger zone, "Delete account" (PERS-419). The button deletes, always, and
 * never archives in secret: the dialog first lists what rests on the account, each thing with
 * "Move to…", and the deletion is offered only when nothing is left. An account of a source says
 * that it leaves the accounts the source brings here, and how it comes back.
 */
export function DeleteAccount({
  accountId,
  name,
  source,
}: {
  accountId: string;
  name: string;
  /** The name of the source the account comes from; `null` for an account kept by hand. */
  source: string | null;
}) {
  const t = useTranslations("accounts.settings.danger");
  const locale = useLocale() as UiLocale;
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [loaded, setLoaded] = useState<Loaded | null>(null);
  const [targets, setTargets] = useState<Record<string, string>>({});
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const keyOf = (one: Dependent) => `${one.kind}:${one.id}`;

  function messageFor(code: string): string {
    if (code === "not_synced") return t("errors.notSynced");
    if (code === "conflict") return t("errors.conflict");
    if (code === "account_taken") return t("errors.accountTaken");
    if (code === "invalid_account") return t("errors.invalidAccount");
    if (code === "in_use") return t("errors.inUse");
    return t("errors.failed");
  }

  function load() {
    startTransition(async () => {
      const result = await accountDependentsAction(accountId);
      if (!result.ok) {
        setError(messageFor(result.error));
        return;
      }
      setError(null);
      setLoaded({ dependents: result.dependents, targets: result.targets });
    });
  }

  function onOpen() {
    setOpen(true);
    setLoaded(null);
    setErrors({});
    setError(null);
    load();
  }

  /** What a thing is, in words: one branch per kind so the catalogue keys stay literal. */
  function describe(one: Dependent): string {
    const label = one.label ?? "";
    if (one.kind === "pocket") return t("dependents.pocket", { name: label });
    if (one.kind === "interestRule") {
      const since = isCivilDate(label) ? formatDate(label as CivilDate, "long", locale) : label;
      return t("dependents.interestRule", { since });
    }
    if (one.kind === "budgetLimit") {
      return one.label === null
        ? t("dependents.budgetAccount")
        : t("dependents.budgetLimit", { name: label });
    }
    if (one.kind === "subscription") return t("dependents.subscription", { name: label });
    if (one.kind === "fund") return t("dependents.fund", { name: label });
    return t("dependents.fundSource", { name: label });
  }

  function onMove(one: Dependent) {
    const key = keyOf(one);
    const to = targets[key] ?? "";
    if (to === "") {
      setErrors((before) => ({ ...before, [key]: t("errors.chooseTarget") }));
      return;
    }
    startTransition(async () => {
      const result = await moveDependentAction({ accountId, kind: one.kind, id: one.id, to });
      if (!result.ok) {
        setErrors((before) => ({ ...before, [key]: messageFor(result.error) }));
        return;
      }
      setErrors((before) => Object.fromEntries(Object.entries(before).filter(([one]) => one !== key)));
      notify(t("movedToast", { what: describe(one) }));
      load();
    });
  }

  function onDelete() {
    startTransition(async () => {
      const result = await deleteAccountAction(accountId);
      if (!result.ok) {
        setError(messageFor(result.error));
        if (result.error === "in_use") load();
        return;
      }
      setOpen(false);
      notify(t("deletedToast", { name }), "error");
      router.push("/accounts" as Route);
    });
  }

  const left = loaded?.dependents ?? [];
  const ready = loaded !== null && left.length === 0;

  return (
    <>
      <Button variant="danger" size="sm" onClick={onOpen} disabled={pending}>
        {t("remove")}
      </Button>
      <Modal
        open={open}
        onOpenChange={setOpen}
        title={t("confirmTitle", { name })}
        width={520}
        footer={
          <div className="flex justify-end gap-2">
            <Button onClick={() => setOpen(false)} disabled={pending}>
              {t("cancel")}
            </Button>
            <Button variant="danger" onClick={onDelete} disabled={pending || !ready}>
              {t("confirm")}
            </Button>
          </div>
        }
      >
        <div className="flex flex-col gap-3 text-sm">
          <p className="text-muted">{t("confirmBody", { name })}</p>
          {source !== null && <p className="text-muted">{t("sourceNote", { source })}</p>}
          {error && (
            <p role="alert" className="text-neg">
              {error}
            </p>
          )}
          {loaded === null && !error && <p className="text-muted">{t("loading")}</p>}
          {left.length > 0 && (
            <div className="flex flex-col gap-2">
              <p className="font-medium">{t("dependents.title", { count: left.length })}</p>
              <ul className="flex flex-col gap-3">
                {left.map((one) => {
                  const key = keyOf(one);
                  const id = `move-${key.replace(/[^a-zA-Z0-9-]/g, "-")}`;
                  return (
                    <li key={key} className="flex flex-col gap-1">
                      <label htmlFor={id} className="min-w-0 truncate">
                        {describe(one)}
                      </label>
                      <div className="flex flex-wrap items-center gap-2">
                        <Select
                          id={id}
                          className="min-w-0 flex-1"
                          value={targets[key] ?? ""}
                          onChange={(event) => {
                            const value = event.target.value;
                            setTargets((before) => ({ ...before, [key]: value }));
                          }}
                          disabled={pending}
                        >
                          <option value="">{t("dependents.choose")}</option>
                          {loaded?.targets.map((target) => (
                            <option key={target.id} value={target.id}>
                              {target.name}
                            </option>
                          ))}
                        </Select>
                        <Button size="sm" onClick={() => onMove(one)} disabled={pending}>
                          {t("dependents.move")}
                        </Button>
                      </div>
                      {errors[key] && (
                        <p role="alert" className="text-neg">
                          {errors[key]}
                        </p>
                      )}
                    </li>
                  );
                })}
              </ul>
            </div>
          )}
        </div>
      </Modal>
    </>
  );
}
