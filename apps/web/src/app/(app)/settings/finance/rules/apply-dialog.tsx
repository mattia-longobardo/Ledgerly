"use client";

import { useTranslations } from "next-intl";
import { useEffect, useState } from "react";
import { applyRuleAction, type PreviewView, previewSavedRuleAction } from "@/modules/transactions";
import { Button } from "@ledgerly/ui/button";
import { Modal } from "@ledgerly/ui/modal";
import type { RuleView } from "./rule-lines";

/** The movements a preview names: date, payee and amount, already formatted. */
export function MovementList({ rows }: { rows: PreviewView["rows"] }) {
  return (
    <ul className="flex max-h-48 flex-col overflow-y-auto text-sm">
      {rows.map((row) => (
        <li key={row.id} className="flex items-center gap-3 border-b border-border py-1 last:border-0">
          <span className="w-24 shrink-0 text-muted">{row.date}</span>
          <span className="min-w-0 flex-1 truncate">{row.payee}</span>
          <span className="shrink-0 tabular-nums">{row.amount}</span>
        </li>
      ))}
    </ul>
  );
}

/** The preview of a saved rule; `null` while it loads. */
function useSavedPreview(ruleId: string) {
  const [preview, setPreview] = useState<PreviewView | null | "error">(null);
  useEffect(() => {
    let live = true;
    previewSavedRuleAction(ruleId)
      .then((answer) => live && setPreview(answer ?? "error"))
      .catch(() => live && setPreview("error"));
    return () => {
      live = false;
    };
  }, [ruleId]);
  return preview;
}

/** What else changes when the movements move between macros (§4.6). */
function RetypedEffect({ retyped }: { retyped: NonNullable<PreviewView["retyped"]> }) {
  const text = useTranslations("settings.rules");
  const values = { count: retyped.count, amount: retyped.amount, year: retyped.year };
  return (
    <p>
      {retyped.from === null
        ? text("apply.effectJoin", values)
        : text("apply.effect", {
            ...values,
            from: text(retyped.from === "expense" ? "fromExpense" : "fromIncome"),
          })}
    </p>
  );
}

function ApplySummary({
  preview,
  categoryName,
}: {
  preview: PreviewView | null | "error";
  categoryName: (id: string | null) => string;
}) {
  const text = useTranslations("settings.rules");
  if (preview === null) return <p className="text-muted">{text("preview.busy")}</p>;
  if (preview === "error") return <p className="text-muted">{text("preview.error")}</p>;
  if (preview.changes === 0) return <p>{text("apply.nothing")}</p>;
  return (
    <>
      <p>
        {text("apply.body", { count: preview.changes, category: categoryName(preview.categoryId ?? null) })}
      </p>
      {preview.retyped && <RetypedEffect retyped={preview.retyped} />}
    </>
  );
}

function ApplyRows({ preview }: { preview: PreviewView }) {
  const text = useTranslations("settings.rules");
  const [shown, setShown] = useState(false);
  return (
    <>
      {preview.kept > 0 && <p className="text-muted">{text("apply.kept", { count: preview.kept })}</p>}
      {preview.rows.length > 0 && (
        <>
          <Button
            size="xs"
            variant="ghost"
            className="self-start"
            aria-expanded={shown}
            onClick={() => setShown(!shown)}
          >
            {shown ? text("apply.hide") : text("apply.show", { count: preview.changes })}
          </Button>
          {shown && <MovementList rows={preview.rows} />}
        </>
      )}
    </>
  );
}

function ApplyFooter({
  ready,
  saving,
  onClose,
  onApply,
}: {
  ready: boolean;
  saving: boolean;
  onClose: () => void;
  onApply: () => void;
}) {
  const text = useTranslations("settings.rules");
  return (
    <>
      <Button size="sm" onClick={onClose} disabled={saving}>
        {text("cancel")}
      </Button>
      <Button
        size="sm"
        variant="primary"
        onClick={onApply}
        disabled={!ready || saving}
        aria-busy={saving || undefined}
      >
        {text("apply.confirm")}
      </Button>
    </>
  );
}

/** "Apply to existing transactions…" (§4.6): what changes, then all or nothing, with "Undo". */
export function ApplyDialog({
  rule,
  categoryName,
  onClose,
  onApplied,
}: {
  rule: Pick<RuleView, "id" | "name">;
  categoryName: (id: string | null) => string;
  onClose: () => void;
  onApplied: (result: { count: number; undoId: string | null }) => void;
}) {
  const text = useTranslations("settings.rules");
  const preview = useSavedPreview(rule.id);
  const [saving, setSaving] = useState(false);
  const [failed, setFailed] = useState(false);

  function apply() {
    if (saving) return;
    setSaving(true);
    setFailed(false);
    applyRuleAction(rule.id)
      .then((result) => (result.ok ? onApplied(result) : setFailed(true)))
      .catch(() => setFailed(true))
      .finally(() => setSaving(false));
  }

  const ready = preview !== null && preview !== "error";
  return (
    <Modal
      open
      width={460}
      onOpenChange={(open) => !open && !saving && onClose()}
      title={text("apply.title", { name: rule.name })}
      footer={
        <ApplyFooter ready={ready && preview.changes > 0} saving={saving} onClose={onClose} onApply={apply} />
      }
    >
      <div
        className="flex flex-col gap-2"
        data-testid="rule-apply"
        aria-live="polite"
        aria-busy={preview === null || undefined}
      >
        {failed && (
          <p role="alert" className="text-sm text-neg">
            {text("apply.failed")}
          </p>
        )}
        <ApplySummary preview={preview} categoryName={categoryName} />
        {ready && <ApplyRows preview={preview} />}
      </div>
    </Modal>
  );
}
