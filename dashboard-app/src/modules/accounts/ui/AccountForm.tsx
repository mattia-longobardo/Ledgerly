"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import {
  createAccountAction,
  updateAccountAction,
} from "@/app/actions/accounts";
import { ErrorInline } from "@/components/ui/ErrorInline";
import { SheetForm, type SheetFormStep } from "@/components/ui/SheetForm";
import { cn } from "@/components/ui/cn";
import type { AccountOrigin, AccountType } from "../domain/account";
import { ACCOUNT_TYPE_OPTIONS } from "./labels";

export interface AccountFormGroupOption {
  id: string;
  name: string;
}

export interface AccountFormAccount {
  id: string;
  version: number;
  name: string;
  type: AccountType;
  currency: string;
  groupId: string | null;
  includeInNetWorth: boolean;
  notes: string | null;
  origin: AccountOrigin;
}

export interface AccountFormProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  groups: readonly AccountFormGroupOption[];
  /** Absent means "create"; present means "edit" and carries the account's current version. */
  account?: AccountFormAccount;
  /** Called after a successful save, with the created or edited account's id. */
  onSaved?: (accountId: string) => void;
}

const FIELD =
  "min-h-11 w-full rounded-md border border-border bg-surface px-3 text-body text-fg";
const LABEL = "text-caption tracking-wide text-fg-muted uppercase";

export function AccountForm({
  open,
  onOpenChange,
  groups,
  account,
  onSaved,
}: AccountFormProps) {
  const router = useRouter();
  const editing = account !== undefined;
  const synced = account?.origin === "synced";

  const [name, setName] = useState(account?.name ?? "");
  const [type, setType] = useState<AccountType>(account?.type ?? "checking");
  const [currency, setCurrency] = useState(account?.currency ?? "EUR");
  const [groupId, setGroupId] = useState(account?.groupId ?? "");
  const [includeInNetWorth, setIncludeInNetWorth] = useState(
    account?.includeInNetWorth ?? true,
  );
  const [notes, setNotes] = useState(account?.notes ?? "");
  const [openingAsOf, setOpeningAsOf] = useState("");
  const [openingBalance, setOpeningBalance] = useState("");

  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const valid = name.trim() !== "";

  function submit() {
    setError(null);
    startTransition(async () => {
      const formData = new FormData();
      formData.set("name", name);
      formData.set("groupId", groupId);
      formData.set("includeInNetWorth", includeInNetWorth ? "true" : "false");
      formData.set("notes", notes);
      // Omitted entirely for a synced account being edited: the use case
      // refuses the patch outright the moment either field is present, even
      // unchanged, because the provider owns them for that account.
      if (!synced) {
        formData.set("type", type);
        formData.set("currency", currency);
      }

      let result;
      if (account !== undefined) {
        formData.set("id", account.id);
        formData.set("version", String(account.version));
        result = await updateAccountAction(formData);
      } else {
        if (openingAsOf !== "") formData.set("openingBalanceAsOf", openingAsOf);
        if (openingBalance !== "")
          formData.set("openingBalance", openingBalance);
        result = await createAccountAction(formData);
      }

      if (!result.ok) {
        setError(result.error);
        return;
      }
      onOpenChange(false);
      router.refresh();
      onSaved?.(result.data.id);
    });
  }

  const step: SheetFormStep = {
    id: "details",
    title: "Details",
    valid,
    content: (
      <div className="flex flex-col gap-4">
        {error !== null && <ErrorInline message={error} />}

        <label className="flex flex-col gap-1.5">
          <span className={LABEL}>Name</span>
          <input
            value={name}
            onChange={(event) => setName(event.target.value)}
            autoComplete="off"
            placeholder="Revolut"
            className={FIELD}
          />
        </label>

        <label className="flex flex-col gap-1.5">
          <span className={LABEL}>Type</span>
          <select
            value={type}
            onChange={(event) => setType(event.target.value as AccountType)}
            disabled={synced}
            className={cn(FIELD, synced && "opacity-60")}
          >
            {ACCOUNT_TYPE_OPTIONS.map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
          {synced && (
            <span className="text-body-sm text-fg-muted">
              Type is managed by Budget Makers Wallet for a synced account.
            </span>
          )}
        </label>

        <label className="flex flex-col gap-1.5">
          <span className={LABEL}>Currency</span>
          <input
            value={currency}
            onChange={(event) => setCurrency(event.target.value.toUpperCase())}
            maxLength={3}
            disabled={synced}
            autoComplete="off"
            className={cn(FIELD, "num uppercase", synced && "opacity-60")}
          />
        </label>

        <label className="flex flex-col gap-1.5">
          <span className={LABEL}>Group</span>
          <select
            value={groupId}
            onChange={(event) => setGroupId(event.target.value)}
            className={FIELD}
          >
            <option value="">No group</option>
            {groups.map((group) => (
              <option key={group.id} value={group.id}>
                {group.name}
              </option>
            ))}
          </select>
        </label>

        <label className="flex min-h-11 items-center gap-3">
          <input
            type="checkbox"
            checked={includeInNetWorth}
            onChange={(event) => setIncludeInNetWorth(event.target.checked)}
            className="size-5 accent-accent"
          />
          <span className="text-body text-fg">Include in net worth</span>
        </label>

        <label className="flex flex-col gap-1.5">
          <span className={LABEL}>Notes (optional)</span>
          <textarea
            value={notes}
            onChange={(event) => setNotes(event.target.value)}
            rows={3}
            maxLength={2000}
            className={cn(FIELD, "min-h-20 py-2")}
          />
        </label>

        {!editing && (
          <div className="flex flex-col gap-3 hairline-t pt-4">
            <span className={LABEL}>Opening balance (optional)</span>
            <div className="flex gap-2">
              <input
                type="date"
                value={openingAsOf}
                onChange={(event) => setOpeningAsOf(event.target.value)}
                aria-label="Opening balance date"
                className={cn(FIELD, "num flex-1")}
              />
              <input
                value={openingBalance}
                onChange={(event) => setOpeningBalance(event.target.value)}
                inputMode="decimal"
                autoComplete="off"
                placeholder="0,00"
                aria-label="Opening balance amount"
                className={cn(FIELD, "num flex-1")}
              />
            </div>
          </div>
        )}
      </div>
    ),
  };

  return (
    <SheetForm
      open={open}
      onOpenChange={onOpenChange}
      title={editing ? "Edit account" : "Add account"}
      steps={[step]}
      onSubmit={submit}
      submitLabel={editing ? "Save" : "Create"}
      submitting={pending}
    />
  );
}
