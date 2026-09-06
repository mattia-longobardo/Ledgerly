"use client";

import { useRouter } from "next/navigation";
import { useMemo, useState, useTransition } from "react";
import { createFundAction, updateFundAction } from "@/app/actions/funds";
import { ErrorInline } from "@/components/ui/ErrorInline";
import { SheetForm, type SheetFormStep } from "@/components/ui/SheetForm";
import type { Fund, FundKind, FundStatus } from "../application/ports";
import type { FundAccountOption } from "./load-funds";

const FIELD = "min-h-11 w-full rounded-md border border-border bg-surface px-3 text-body text-fg";
const LABEL = "text-caption tracking-wide text-fg-muted uppercase";

export function FundForm({
  open,
  onOpenChange,
  accounts,
  fund,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  accounts: readonly FundAccountOption[];
  fund?: Fund;
}) {
  const router = useRouter();
  const editing = fund !== undefined;
  const [name, setName] = useState(fund?.name ?? "");
  const [slug, setSlug] = useState(fund?.slug ?? "");
  const [kind, setKind] = useState<FundKind>(fund?.kind ?? "investment");
  const [currency, setCurrency] = useState(fund?.currency ?? "EUR");
  const [accountId, setAccountId] = useState(fund?.accountId ?? "");
  const [status, setStatus] = useState<FundStatus>(fund?.status ?? "active");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const matchingAccounts = useMemo(
    () => accounts.filter((account) => account.currency === currency.toUpperCase()),
    [accounts, currency],
  );

  function submit() {
    setError(null);
    startTransition(async () => {
      const data = new FormData();
      data.set("name", name);
      data.set("kind", kind);
      data.set("accountId", accountId);
      if (fund) {
        data.set("id", fund.id);
        data.set("version", String(fund.version));
        data.set("status", status);
      } else {
        data.set("slug", slug);
        data.set("currency", currency.toUpperCase());
      }
      const result = fund ? await updateFundAction(data) : await createFundAction(data);
      if (!result.ok) {
        setError(result.error);
        return;
      }
      onOpenChange(false);
      router.refresh();
    });
  }

  const step: SheetFormStep = {
    id: "details",
    title: "Details",
    valid: name.trim() !== "" && (editing || slug.trim() !== "") && currency.trim().length === 3,
    content: (
      <div className="flex flex-col gap-4">
        {error && <ErrorInline message={error} />}
        <label className="flex flex-col gap-1.5">
          <span className={LABEL}>Name</span>
          <input value={name} onChange={(event) => setName(event.target.value)} autoComplete="off" className={FIELD} />
        </label>
        {!editing && (
          <label className="flex flex-col gap-1.5">
            <span className={LABEL}>Slug</span>
            <input value={slug} onChange={(event) => setSlug(event.target.value.toLowerCase())} autoComplete="off" pattern="[a-z0-9-]{2,40}" placeholder="retirement-fund" className={`${FIELD} num`} />
          </label>
        )}
        <label className="flex flex-col gap-1.5">
          <span className={LABEL}>Kind</span>
          <select value={kind} onChange={(event) => setKind(event.target.value as FundKind)} className={FIELD}>
            <option value="pension">Pension</option>
            <option value="investment">Investment</option>
            <option value="savings">Savings</option>
            <option value="other">Other</option>
          </select>
        </label>
        <label className="flex flex-col gap-1.5">
          <span className={LABEL}>Currency</span>
          <input value={currency} onChange={(event) => { setCurrency(event.target.value.toUpperCase()); setAccountId(""); }} disabled={editing} maxLength={3} className={`${FIELD} num uppercase disabled:opacity-60`} />
        </label>
        <label className="flex flex-col gap-1.5">
          <span className={LABEL}>Valuation account</span>
          <select value={accountId} onChange={(event) => setAccountId(event.target.value)} className={FIELD}>
            <option value="">No linked account</option>
            {matchingAccounts.map((account) => <option key={account.id} value={account.id}>{account.name} · {account.currency}</option>)}
          </select>
          {matchingAccounts.length === 0 && <span className="text-body-sm text-fg-muted">No active {currency.toUpperCase()} accounts are available.</span>}
        </label>
        {editing && (
          <label className="flex flex-col gap-1.5">
            <span className={LABEL}>Status</span>
            <select value={status} onChange={(event) => setStatus(event.target.value as FundStatus)} className={FIELD}>
              <option value="active">Active</option>
              <option value="archived">Archived</option>
            </select>
          </label>
        )}
      </div>
    ),
  };

  return <SheetForm open={open} onOpenChange={onOpenChange} title={editing ? "Edit fund" : "New fund"} steps={[step]} onSubmit={submit} submitLabel={editing ? "Save" : "Create fund"} submitting={pending} />;
}

export function FundFormTrigger({
  accounts,
  fund,
  label = fund ? "Edit fund" : "New fund",
  className,
}: {
  accounts: readonly FundAccountOption[];
  fund?: Fund;
  label?: string;
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  return <>
    <button type="button" onClick={() => setOpen(true)} className={className ?? "inline-flex min-h-11 items-center rounded-md bg-accent px-4 text-body-sm font-medium text-accent-contrast"}>{label}</button>
    <FundForm open={open} onOpenChange={setOpen} accounts={accounts} fund={fund} />
  </>;
}
