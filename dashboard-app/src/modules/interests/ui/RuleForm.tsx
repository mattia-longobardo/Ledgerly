"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { createInterestRuleAction } from "@/app/actions/interests";
import { ErrorInline } from "@/components/ui/ErrorInline";
import type { EligibleAccount } from "./load-interests";

export interface RuleFormProps {
  accounts: readonly EligibleAccount[];
}

const FIELD = "min-h-11 w-full rounded-md border border-border bg-surface px-3 text-body text-fg";
const LABEL = "text-caption tracking-wide text-fg-muted uppercase";

/**
 * The create-rule affordance for `/finance/interests` (Ruling P3-17): the
 * spec's page map has no separate "new rule" route, so this form renders on
 * the list page itself, and `createInterestRuleAction` is its one caller.
 *
 * A new rule's posting mode is never set from here — `createInterestRule`
 * defaults it to `analyze_only`, and this form has no field that could turn
 * that off. Posting to a real account is a decision this page never makes
 * silently.
 */
export function RuleForm({ accounts }: RuleFormProps) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  if (accounts.length === 0) {
    return <p className="text-body-sm text-fg-muted">Add an account before creating an interest rule.</p>;
  }

  return (
    <form
      action={(formData) => {
        setError(null);
        startTransition(async () => {
          const result = await createInterestRuleAction(formData);
          if (!result.ok) {
            setError(result.error);
            return;
          }
          router.push(`/finance/interests/rules/${result.data.id}`);
        });
      }}
      className="flex flex-col gap-4"
    >
      {error !== null && <ErrorInline message={error} />}

      <label className="flex flex-col gap-1.5">
        <span className={LABEL}>Account</span>
        <select name="accountId" defaultValue={accounts[0]!.id} className={FIELD}>
          {accounts.map((a) => (
            <option key={a.id} value={a.id}>
              {a.name}
            </option>
          ))}
        </select>
      </label>

      <label className="flex flex-col gap-1.5">
        <span className={LABEL}>Annual rate (e.g. 0.0225 for 2.25%)</span>
        <input name="annualRate" defaultValue="0.0225" inputMode="decimal" autoComplete="off" className={FIELD} />
      </label>

      <label className="flex flex-col gap-1.5">
        <span className={LABEL}>Tax rate (e.g. 0.26 for 26%)</span>
        <input name="taxRate" defaultValue="0.26" inputMode="decimal" autoComplete="off" className={FIELD} />
      </label>

      <label className="flex flex-col gap-1.5">
        <span className={LABEL}>Effective from</span>
        <input type="date" name="effectiveFrom" className={FIELD} />
      </label>

      <button
        type="submit"
        disabled={pending}
        className="inline-flex min-h-11 items-center justify-center rounded-md bg-accent px-4 text-body-sm font-medium text-accent-contrast disabled:opacity-40"
      >
        {pending ? "Creating…" : "Create rule"}
      </button>
    </form>
  );
}
