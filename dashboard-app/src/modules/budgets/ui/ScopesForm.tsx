"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { setScopesAction } from "@/app/actions/budgets";
import { ErrorInline } from "@/components/ui/ErrorInline";
import type { ScopeLike } from "../domain/scopes";
import type { OptionRow } from "./load-budgets";

export interface ScopesFormProps {
  budgetId: string;
  scopes: readonly ScopeLike[];
  accounts: readonly OptionRow[];
  categories: readonly OptionRow[];
  labels: readonly OptionRow[];
  funds: readonly OptionRow[];
}

const GROUP: readonly { kind: ScopeLike["kind"]; title: string }[] = [
  { kind: "account", title: "Accounts" },
  { kind: "category", title: "Categories" },
  { kind: "label", title: "Labels" },
  { kind: "fund", title: "Funds" },
];

function key(scope: ScopeLike): string {
  return `${scope.kind}:${scope.refId}`;
}

/**
 * A budget's usage is derived from whichever expenses match these scopes
 * (R6-3); a `fund` scope is accepted here but never matches a transaction —
 * `scopeMatches` in the domain always returns false for it — so it exists
 * only as a label a budget can carry, not a working filter.
 */
export function ScopesForm({ budgetId, scopes, accounts, categories, labels, funds }: ScopesFormProps) {
  const router = useRouter();
  const [selected, setSelected] = useState<Set<string>>(new Set(scopes.map(key)));
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const optionsByKind: Record<ScopeLike["kind"], readonly OptionRow[]> = {
    account: accounts,
    category: categories,
    label: labels,
    fund: funds,
  };

  function toggle(scope: ScopeLike) {
    setSelected((current) => {
      const next = new Set(current);
      const k = key(scope);
      if (next.has(k)) next.delete(k);
      else next.add(k);
      return next;
    });
  }

  function submit() {
    const next: ScopeLike[] = [];
    for (const group of GROUP) {
      for (const option of optionsByKind[group.kind]) {
        if (selected.has(`${group.kind}:${option.id}`)) next.push({ kind: group.kind, refId: option.id });
      }
    }
    setError(null);
    startTransition(async () => {
      const data = new FormData();
      data.set("budgetId", budgetId);
      data.set("scopes", JSON.stringify(next));
      const result = await setScopesAction(data);
      if (!result.ok) {
        setError(result.error);
        return;
      }
      router.refresh();
    });
  }

  const hasAnyOption = GROUP.some((group) => optionsByKind[group.kind].length > 0);
  if (!hasAnyOption) {
    return <p className="text-body-sm text-fg-muted">No accounts, categories, labels or funds are available to scope this budget to yet.</p>;
  }

  return (
    <div className="flex flex-col gap-4">
      {error && <ErrorInline message={error} />}
      {GROUP.map((group) =>
        optionsByKind[group.kind].length === 0 ? null : (
          <fieldset key={group.kind} className="flex flex-col gap-1.5">
            <legend className="text-caption tracking-wide text-fg-muted uppercase">{group.title}</legend>
            <div className="flex flex-col gap-1">
              {optionsByKind[group.kind].map((option) => {
                const scope: ScopeLike = { kind: group.kind, refId: option.id };
                const checked = selected.has(key(scope));
                return (
                  <label key={option.id} className="flex min-h-11 items-center gap-2 text-body-sm text-fg">
                    <input type="checkbox" checked={checked} onChange={() => toggle(scope)} className="size-4" />
                    {option.name}
                  </label>
                );
              })}
            </div>
          </fieldset>
        ),
      )}
      <button
        type="button"
        onClick={submit}
        disabled={pending}
        className="inline-flex min-h-11 items-center justify-center rounded-md bg-accent px-4 text-body-sm font-medium text-accent-contrast disabled:opacity-40"
      >
        {pending ? "Saving…" : "Save scopes"}
      </button>
    </div>
  );
}
