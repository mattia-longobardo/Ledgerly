"use client";

import { dismissMerge } from "@/modules/transactions";
import { useTranslations } from "next-intl";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { Button } from "@ledgerly/ui/button";
import { Modal } from "@ledgerly/ui/modal";
import { notify } from "@ledgerly/ui/toast";

/** One of the two categories of a proposal, as the row and the dialog show it. */
export interface MergeSide {
  id: string;
  name: string;
  color: string;
  usage: number;
  /** Whether the category is a group with sub-categories of its own. */
  hasChildren: boolean;
  /** Whether it may stay: a sub-category cannot take the sub-categories of a group. */
  canKeepOther: boolean;
}

interface MergeProposalRow {
  first: MergeSide;
  second: MergeSide;
  sumsBudgets: boolean;
}

function Name({ side }: { side: MergeSide }) {
  const t = useTranslations("settings.categories.merge");
  return (
    <span className="flex min-w-0 items-center gap-1.5">
      <span aria-hidden className="size-2 shrink-0 rounded-xs" style={{ background: side.color }} />
      <span className="min-w-0 break-words">{t("pair", { name: side.name, count: side.usage })}</span>
    </span>
  );
}

/**
 * The proposals to merge two categories that look the same (decision S2b;
 * ux/n3-categories-manual.md §6): one row for each, "They are different" and "Merge…". The dialog
 * says every effect before it does anything: a merge moves movements, sub-categories and budgets
 * together and has no "Undo".
 */
export function MergeProposals({
  proposals,
  merge,
}: {
  proposals: readonly MergeProposalRow[];
  merge: (
    keepId: string,
    dropId: string,
  ) => Promise<{ ok: true; moved: number } | { ok: false; error: string }>;
}) {
  const t = useTranslations("settings.categories.merge");
  const router = useRouter();
  const [open, setOpen] = useState<MergeProposalRow | null>(null);
  const [keepId, setKeepId] = useState("");
  const [saving, setSaving] = useState(false);
  const [failed, setFailed] = useState(false);

  function onDismiss(proposal: MergeProposalRow) {
    const pair = [proposal.first.id, proposal.second.id] as const;
    dismissMerge(...pair, true)
      .then((result) => {
        if (!result.ok) return;
        router.refresh();
        notify(t("dismissed"), "success", {
          label: t("undo"),
          onClick: () => {
            dismissMerge(...pair, false)
              .then(() => router.refresh())
              .catch(() => undefined);
          },
        });
      })
      .catch(() => undefined);
  }

  function start(proposal: MergeProposalRow) {
    const { first, second } = proposal;
    // The name that stays by default: the one with more movements, where it may stay.
    const preferred = first.usage >= second.usage ? first : second;
    const other = preferred === first ? second : first;
    setKeepId(preferred.canKeepOther ? preferred.id : other.id);
    setFailed(false);
    setOpen(proposal);
  }

  function onMerge() {
    if (!open || saving) return;
    const drop = open.first.id === keepId ? open.second : open.first;
    setSaving(true);
    setFailed(false);
    merge(keepId, drop.id)
      .then((result) => {
        if (!result.ok) {
          setFailed(true);
          return;
        }
        setOpen(null);
        notify(t("done", { count: result.moved }));
        router.refresh();
      })
      .catch(() => setFailed(true))
      .finally(() => setSaving(false));
  }

  const keep = open && (open.first.id === keepId ? open.first : open.second);
  const drop = open && (open.first.id === keepId ? open.second : open.first);

  return (
    <>
      <ul className="flex flex-col divide-y divide-border">
        {proposals.map((proposal) => (
          <li
            key={`${proposal.first.id}|${proposal.second.id}`}
            data-testid="merge-proposal"
            className="flex flex-col gap-2 px-4 py-3"
          >
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm">
              <Name side={proposal.first} />
              <span className="text-muted">{t("and")}</span>
              <Name side={proposal.second} />
            </div>
            <p className="text-sm text-muted">{t("same")}</p>
            <div className="flex flex-wrap justify-end gap-2">
              <Button size="sm" onClick={() => onDismiss(proposal)}>
                {t("dismiss")}
              </Button>
              <Button size="sm" variant="primary" onClick={() => start(proposal)}>
                {t("open")}
              </Button>
            </div>
          </li>
        ))}
      </ul>
      <Modal
        open={open !== null}
        onOpenChange={(next) => !next && !saving && setOpen(null)}
        title={t("dialog.title")}
        footer={
          <div className="flex w-full justify-end gap-2 max-sm:flex-col-reverse">
            <Button size="sm" onClick={() => setOpen(null)} disabled={saving}>
              {t("cancel")}
            </Button>
            <Button size="sm" variant="primary" onClick={onMerge} disabled={saving}>
              {t("dialog.confirm")}
            </Button>
          </div>
        }
      >
        {open && keep && drop && (
          <div className="flex flex-col gap-3">
            {failed && (
              <p role="alert" className="text-sm text-neg">
                {t("failed")}
              </p>
            )}
            <fieldset className="flex flex-col gap-1.5">
              <legend className="pb-1 text-sm font-medium">{t("dialog.keep")}</legend>
              {[open.first, open.second].map((side) => {
                const other = side === open.first ? open.second : open.first;
                return (
                  <label key={side.id} className="flex min-h-6 items-center gap-2 text-sm">
                    <input
                      type="radio"
                      name="keep"
                      className="focus-ring size-3.5 accent-primary"
                      checked={keepId === side.id}
                      disabled={saving || !side.canKeepOther}
                      onChange={() => setKeepId(side.id)}
                    />
                    <Name side={side} />
                    <span className="sr-only">{other.name}</span>
                  </label>
                );
              })}
            </fieldset>
            <div className="flex flex-col gap-1 text-sm text-muted">
              <p>
                {t("dialog.moves", { count: drop.usage, from: drop.name, to: keep.name })}{" "}
                {t("dialog.archived", { from: drop.name })}
              </p>
              {open.sumsBudgets && <p>{t("dialog.budgets")}</p>}
              {drop.hasChildren && <p>{t("dialog.children", { from: drop.name, to: keep.name })}</p>}
            </div>
          </div>
        )}
      </Modal>
    </>
  );
}
