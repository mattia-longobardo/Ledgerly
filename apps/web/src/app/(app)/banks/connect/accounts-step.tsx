"use client";

import type { Route } from "next";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { type FormEvent, useState, useTransition } from "react";
import { Button } from "@/ui/button";
import { Card } from "@/ui/card";
import { Field } from "@/ui/field";
import { Input, Select } from "@/ui/input";
import { Modal } from "@/ui/modal";
import { ProgressBar } from "@/ui/progress-bar";
import type { AccountDecision } from "@ledgerly/plugin-host";
import { cancelBankConnectionAction, importBankAccountsAction } from "./actions";

/** An account the bank exposes and the person has not chosen anything for yet. */
export interface AccountToChoose {
  providerAccountId: string;
  /** What the legend says: the bank's name of it, the masked number, the currency. */
  legend: string;
  currency: string;
  defaultName: string;
  defaultType: string;
  /**
   * The open account here with the same IBAN (H39): "Create a new account" is not offered. Kept by
   * hand, it is the default target; tied to another source, the account is not imported.
   */
  ibanOwner?: { id: string; name: string; manual: boolean } | null;
}

export interface AccountsStepProps {
  connectionId: string;
  bank: string;
  accounts: AccountToChoose[];
  /** The accounts of this bank already tied here (a renewed access): shown, not asked about. */
  linked: { legend: string; account: string }[];
  /** The person's own accounts a bank's account may be tied to. */
  existing: { id: string; name: string; currency: string }[];
  /**
   * The person's accounts that come from another source and may be the same account (ux/n4-account-switch.md
   * §2.1): choosing one imports nothing now; the outcome leads to the check of the switch.
   */
  sameAs?: { id: string; name: string; currency: string; source: string }[];
  types: { value: string; label: string }[];
  /** Whether "Cancel" closes the access (a first access) or only leaves the page (a renewal). */
  cancellable: boolean;
}

const SETTINGS: Route = "/settings/integrations";
const NEW = "new";
const SKIP = "skip";
const SAME = "same:";

/** Where an account starts (§2.4.2 of the N4 specification): never on a new account with an IBAN already here. */
function startOf(
  account: AccountToChoose,
  existing: AccountsStepProps["existing"],
  sameAs: NonNullable<AccountsStepProps["sameAs"]>,
): string {
  const owner = account.ibanOwner;
  if (!owner) return NEW;
  if (!owner.manual && sameAs.some((one) => one.id === owner.id && one.currency === account.currency)) {
    return `${SAME}${owner.id}`;
  }
  const usable = existing.some((one) => one.id === owner.id && one.currency === account.currency);
  return owner.manual && usable ? owner.id : SKIP;
}

interface Choice {
  target: string;
  name: string;
  type: string;
}

/**
 * Step 2 of "Connect a bank" (ux/n1-plugin-bank.md §6.4): what each account of the bank is here.
 * Every account starts on a valid choice, so the step closes with one press — a bank gives its
 * full history only in the first minutes after the access. The import and the first reading run
 * in the same request; the page waits for them and then shows the outcome.
 */
export function AccountsStep({
  connectionId,
  bank,
  accounts,
  linked,
  existing,
  sameAs = [],
  types,
  cancellable,
}: AccountsStepProps) {
  const t = useTranslations("banks.connect");
  const common = useTranslations("common");
  const router = useRouter();
  const [choices, setChoices] = useState<Record<string, Choice>>(() =>
    Object.fromEntries(
      accounts.map((account) => [
        account.providerAccountId,
        { target: startOf(account, existing, sameAs), name: account.defaultName, type: account.defaultType },
      ]),
    ),
  );
  const [failed, setFailed] = useState(false);
  const [ibanRefused, setIbanRefused] = useState(false);
  const [cancelling, setCancelling] = useState(false);
  const [reading, startReading] = useTransition();
  const [leaving, startLeaving] = useTransition();

  const set = (id: string, patch: Partial<Choice>) =>
    setChoices((current) => ({ ...current, [id]: { ...current[id], ...patch } }));

  const isSame = (target: string) => target.startsWith(SAME);
  const imported = accounts.filter((account) => {
    const target = choices[account.providerAccountId].target;
    return target !== SKIP && !isSame(target);
  });
  const toSwitch = accounts.flatMap((account) => {
    const target = choices[account.providerAccountId].target;
    return isSame(target)
      ? [{ bankAccountId: account.providerAccountId, accountId: target.slice(SAME.length) }]
      : [];
  });
  const taken = new Map<string, number>();
  for (const account of accounts) {
    const target = choices[account.providerAccountId].target;
    if (target !== NEW && target !== SKIP) taken.set(target, (taken.get(target) ?? 0) + 1);
  }
  const problems = new Map<string, "duplicate" | "name">();
  for (const account of accounts) {
    const choice = choices[account.providerAccountId];
    if (choice.target === NEW && choice.name.trim() === "") problems.set(account.providerAccountId, "name");
    if ((taken.get(choice.target) ?? 0) > 1) problems.set(account.providerAccountId, "duplicate");
  }
  const nothing = imported.length + linked.length + toSwitch.length === 0;
  const switchList = toSwitch.map((one) => `${one.bankAccountId}.${one.accountId}`).join(",");

  function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (nothing || problems.size > 0) {
      const first = accounts.find((account) => problems.has(account.providerAccountId));
      if (first) document.getElementById(`target-${first.providerAccountId}`)?.focus();
      return;
    }
    setFailed(false);
    setIbanRefused(false);
    startReading(async () => {
      let ok = false;
      try {
        // Only "the same account as…": nothing is imported now, the check of the switch comes next.
        if (imported.length + linked.length === 0) {
          const first = toSwitch[0];
          router.push(
            `/accounts/${first.accountId}/switch?step=check&t=${connectionId}:${first.bankAccountId}` as Route,
          );
          return;
        }
        const decisions: AccountDecision[] = accounts.map((account) => {
          const choice = choices[account.providerAccountId];
          const { providerAccountId, currency } = account;
          if (choice.target === SKIP || isSame(choice.target))
            return { providerAccountId, target: { kind: "skip" } };
          if (choice.target === NEW) {
            return {
              providerAccountId,
              currency,
              target: { kind: "new", name: choice.name.trim(), type: choice.type },
            };
          }
          return { providerAccountId, currency, target: { kind: "existing", accountId: choice.target } };
        });
        const result = await importBankAccountsAction(connectionId, decisions);
        ok = result.ok;
        if (!result.ok && result.error === "iban_exists") setIbanRefused(true);
      } catch {
        ok = false;
      }
      if (ok) {
        router.push(
          `/banks/connect?step=done&c=${connectionId}${switchList ? `&same=${encodeURIComponent(switchList)}` : ""}` as Route,
        );
      } else setFailed(true);
    });
  }

  function cancel() {
    if (!cancellable) {
      router.push(SETTINGS);
      return;
    }
    startLeaving(async () => {
      try {
        await cancelBankConnectionAction(connectionId);
      } finally {
        router.push(SETTINGS);
      }
    });
  }

  if (reading) {
    return (
      <Card className="flex flex-col gap-3.5">
        <div role="status" className="flex flex-col gap-3">
          <h1 tabIndex={-1} className="text-xl font-semibold">
            {t("sync.heading", { bank })}
          </h1>
          <ProgressBar value={0} dashed label={t("sync.progress")} />
          <p className="text-muted">{t("sync.wait")}</p>
        </div>
      </Card>
    );
  }

  return (
    <Card>
      <form onSubmit={onSubmit} className="flex flex-col gap-3.5" noValidate>
        <div>
          <h1 tabIndex={-1} className="text-xl font-semibold">
            {t("accounts.heading", { bank })}
          </h1>
          <p className="mt-1 text-muted">{t("accounts.count", { count: accounts.length + linked.length })}</p>
        </div>

        {failed && (
          <p role="alert" className="rounded-ctl bg-neg-bg px-3 py-2 text-sm text-neg">
            {ibanRefused ? t("accounts.failedIban") : t("accounts.failed")}
          </p>
        )}

        {linked.length > 0 && (
          <ul className="flex flex-col gap-1.5">
            {linked.map((one) => (
              <li key={one.legend} className="rounded-card border border-border p-3 break-words">
                <div className="font-medium">{one.legend}</div>
                <div className="text-sm text-muted">{t("accounts.linked", { account: one.account })}</div>
              </li>
            ))}
          </ul>
        )}

        {accounts.map((account) => {
          const id = account.providerAccountId;
          const choice = choices[id];
          const problem = problems.get(id);
          const chosen = existing.find((one) => one.id === choice.target);
          const offered = existing.filter((one) => one.currency === account.currency);
          const same = sameAs.filter((one) => one.currency === account.currency);
          const owner = account.ibanOwner ?? null;
          return (
            <fieldset key={id} className="flex flex-col gap-3 rounded-card border border-border p-3">
              <legend className="px-1 font-medium break-words">{account.legend}</legend>
              <Field
                label={t("accounts.target")}
                htmlFor={`target-${id}`}
                error={problem === "duplicate" ? t("accounts.duplicate") : undefined}
              >
                <Select
                  id={`target-${id}`}
                  value={choice.target}
                  onChange={(event) => set(id, { target: event.currentTarget.value })}
                >
                  <option value={NEW} disabled={owner !== null}>
                    {t("accounts.new")}
                  </option>
                  {offered.length > 0 && (
                    <optgroup label={t("accounts.existingGroup")}>
                      {offered.map((one) => (
                        <option key={one.id} value={one.id}>
                          {t("accounts.existing", { account: one.name })}
                        </option>
                      ))}
                    </optgroup>
                  )}
                  {same.length > 0 && (
                    <optgroup label={t("accounts.sameGroup")}>
                      {same.map((one) => (
                        <option key={one.id} value={`${SAME}${one.id}`}>
                          {t("accounts.same", { account: one.name, source: one.source })}
                        </option>
                      ))}
                    </optgroup>
                  )}
                  <option value={SKIP}>{t("accounts.skip")}</option>
                </Select>
              </Field>
              {owner !== null && (
                <p role="status" className="rounded-ctl bg-warn-bg px-3 py-2 text-sm text-warn">
                  {t(owner.manual ? "accounts.ibanExists" : "accounts.ibanExistsSource", {
                    account: owner.name,
                  })}
                </p>
              )}
              {choice.target === NEW && (
                <div className="grid grid-cols-1 gap-3 min-[480px]:grid-cols-2">
                  <Field
                    label={t("accounts.name")}
                    htmlFor={`name-${id}`}
                    error={problem === "name" ? t("accounts.nameRequired") : undefined}
                  >
                    <Input
                      id={`name-${id}`}
                      value={choice.name}
                      maxLength={80}
                      required
                      onChange={(event) => set(id, { name: event.currentTarget.value })}
                    />
                  </Field>
                  <Field label={t("accounts.type")} htmlFor={`type-${id}`}>
                    <Select
                      id={`type-${id}`}
                      value={choice.type}
                      onChange={(event) => set(id, { type: event.currentTarget.value })}
                    >
                      {types.map((type) => (
                        <option key={type.value} value={type.value}>
                          {type.label}
                        </option>
                      ))}
                    </Select>
                  </Field>
                </div>
              )}
              {isSame(choice.target) && (
                <p className="text-sm text-muted">
                  {t("accounts.sameNote", {
                    source: sameAs.find((one) => `${SAME}${one.id}` === choice.target)?.source ?? "",
                  })}
                </p>
              )}
              {chosen && (
                <p className="text-sm text-muted">{t("accounts.existingNote", { account: chosen.name })}</p>
              )}
            </fieldset>
          );
        })}

        <p className="rounded-ctl bg-warn-bg px-3 py-2 text-sm text-warn">{t("accounts.hurry")}</p>
        {nothing && (
          <p role="alert" className="text-sm text-neg">
            {t("accounts.none")}
          </p>
        )}

        <div className="flex justify-end gap-2 max-[480px]:flex-col-reverse">
          <Button disabled={leaving} onClick={() => (cancellable ? setCancelling(true) : cancel())}>
            {common("cancel")}
          </Button>
          <Button type="submit" variant="primary" disabled={nothing || leaving}>
            {imported.length === 0 && toSwitch.length > 0
              ? t("accounts.continue")
              : t("accounts.submit", { count: imported.length })}
          </Button>
        </div>
      </form>

      <Modal
        open={cancelling}
        onOpenChange={(open) => !open && setCancelling(false)}
        title={t("cancel.title")}
        description={t("cancel.description", { bank })}
        width={420}
        footer={
          <>
            <Button size="sm" onClick={() => setCancelling(false)}>
              {t("cancel.back")}
            </Button>
            <Button variant="danger" size="sm" disabled={leaving} onClick={cancel}>
              {t("cancel.confirm")}
            </Button>
          </>
        }
      >
        <span />
      </Modal>
    </Card>
  );
}
