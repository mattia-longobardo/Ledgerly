"use client";

import { Check, Pencil } from "lucide-react";
import { useTranslations } from "next-intl";
import { type FormEvent, useState, useTransition } from "react";
import { Badge } from "@/ui/badge";
import { Button, IconButton } from "@/ui/button";
import { cn } from "@/ui/cn";
import { Input } from "@/ui/input";
import { type Highlight, PdfViewer } from "@/ui/pdf-viewer";
import { notify } from "@/ui/toast";
import type { FieldGroup, FieldName } from "../fields";
import { decideFieldAction } from "../actions";
import type { FieldView } from "./present";

/** Below this confidence a value is amber: check it against the document (design). */
const LOW_CONFIDENCE = 0.75;

const ORIGIN_TONE = { printed: "neutral", derived: "accent", inferred: "warn" } as const;
const VERIFICATION_TONE = { unverified: "neutral", confirmed: "pos", corrected: "accent" } as const;

/**
 * The review of spec §7.8: every value with where it came from, beside the document. Choosing a
 * value draws its box on the PDF — a derived one, the boxes of what it is made of. Printed and
 * inferred values are confirmed or corrected; derived ones follow.
 */
export function ReviewWorkspace({
  documentId,
  fileName,
  originalUrl,
  groups,
  editable,
}: {
  documentId: string;
  fileName: string;
  originalUrl: string | null;
  groups: { group: FieldGroup; fields: FieldView[] }[];
  editable: boolean;
}) {
  const t = useTranslations("payroll");
  const [selected, setSelected] = useState<FieldName | null>(null);
  const byField = new Map(groups.flatMap((group) => group.fields.map((field) => [field.field, field] as const)));
  const current = selected ? byField.get(selected) : undefined;
  const sources = current ? (current.bbox ? [current] : current.derivedFrom.flatMap((name) => byField.get(name) ?? [])) : [];
  const highlights: Highlight[] = sources.flatMap((field) =>
    field.bbox && field.page ? [{ page: field.page, bbox: field.bbox }] : [],
  );
  const low = groups.some((group) => group.fields.some((field) => field.value !== "—" && field.confidence < LOW_CONFIDENCE));

  return (
    <div className="grid items-start gap-4 @5xl:grid-cols-[minmax(0,5fr)_minmax(0,7fr)]">
      <div className="flex min-w-0 flex-col gap-3">
        {low && <p className="rounded-card border border-warn/40 bg-warn-bg px-3 py-2 text-sm text-warn">{t("review.lowConfidence")}</p>}
        {groups.map((group) => (
          <section key={group.group} className="overflow-hidden rounded-card border border-border bg-card">
            <h2 className="border-b border-border px-4 py-2 font-semibold">{t(`review.groups.${group.group}`)}</h2>
            <ul className="divide-y divide-border">
              {group.fields.map((field) => (
                <FieldRow
                  key={field.field}
                  documentId={documentId}
                  field={field}
                  editable={editable}
                  selected={selected === field.field}
                  onSelect={() => setSelected(field.field)}
                  sourceNames={field.derivedFrom.map((name) => t(`fields.${name}`)).join(", ")}
                />
              ))}
            </ul>
          </section>
        ))}
      </div>
      <div className="min-w-0 @5xl:sticky @5xl:top-4">
        {originalUrl ? (
          <PdfViewer
            url={originalUrl}
            fileName={fileName}
            highlights={highlights}
            labels={{
              page: (page, pages) => t("review.viewer.page", { page, pages }),
              previous: t("review.viewer.previous"),
              next: t("review.viewer.next"),
              zoomIn: t("review.viewer.zoomIn"),
              zoomOut: t("review.viewer.zoomOut"),
              open: t("review.viewer.open"),
              loading: t("review.viewer.loading"),
              failed: t("review.viewer.failed"),
            }}
          />
        ) : (
          <p className="rounded-card border border-border bg-card p-4 text-sm text-muted">{t("review.viewer.deleted")}</p>
        )}
      </div>
    </div>
  );
}

function FieldRow({
  documentId,
  field,
  editable,
  selected,
  onSelect,
  sourceNames,
}: {
  documentId: string;
  field: FieldView;
  editable: boolean;
  selected: boolean;
  onSelect: () => void;
  sourceNames: string;
}) {
  const t = useTranslations("payroll");
  const [editing, setEditing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const low = field.value !== "—" && field.confidence < LOW_CONFIDENCE;
  const decidable = editable && !field.derived;

  function decide(typed: string | null) {
    startTransition(async () => {
      const result = await decideFieldAction(documentId, field.field, typed);
      if (!result.ok) {
        setError(t(`errors.${result.error}` as never));
        return;
      }
      setError(null);
      setEditing(false);
      notify(t("review.toasts.saved"));
    });
  }

  function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    decide(String(new FormData(event.currentTarget).get("value") ?? ""));
  }

  return (
    <li
      data-field={field.field}
      className={cn("flex flex-col gap-1 px-4 py-2", selected && "bg-sel", low && !selected && "bg-warn-bg/50")}
    >
      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={onSelect}
          aria-pressed={selected}
          title={field.bbox || field.derivedFrom.length > 0 ? t("review.show") : t("review.noBox")}
          className="focus-ring inline-flex min-h-6 min-w-0 flex-1 items-center truncate rounded-[3px] text-left font-medium"
        >
          {t(`fields.${field.field}`)}
        </button>
        {!editing && (
          <span className={cn("shrink-0 text-right tabular-nums", low && "font-medium text-warn")}>{field.value}</span>
        )}
        {decidable && !editing && (
          <span className="flex shrink-0 gap-0.5">
            {field.verification === "unverified" && (
              <IconButton label={t("review.confirm")} onClick={() => decide(null)} disabled={pending}>
                <Check size={14} />
              </IconButton>
            )}
            <IconButton label={t("review.correct")} onClick={() => setEditing(true)} disabled={pending}>
              <Pencil size={14} />
            </IconButton>
          </span>
        )}
      </div>
      {editing && (
        <form onSubmit={onSubmit} className="flex items-center gap-2">
          <Input
            name="value"
            aria-label={t(`fields.${field.field}`)}
            defaultValue={field.input}
            type={field.unit === "date" ? "date" : "text"}
            inputMode={field.unit === "eur" || field.unit === "hours" ? "decimal" : undefined}
            numeric={field.unit === "eur" || field.unit === "hours"}
            className="min-w-0 flex-1"
            autoFocus
          />
          <Button type="submit" size="sm" variant="primary" disabled={pending}>
            {t("review.save")}
          </Button>
          <Button size="sm" onClick={() => setEditing(false)}>
            {t("review.cancel")}
          </Button>
        </form>
      )}
      <div className="flex flex-wrap items-center gap-1.5 text-xs text-muted">
        <Badge tone={ORIGIN_TONE[field.origin]}>{t(`review.origins.${field.origin}`)}</Badge>
        {!field.derived && (
          <Badge tone={VERIFICATION_TONE[field.verification]}>{t(`review.verification.${field.verification}`)}</Badge>
        )}
        {field.original !== null && <span>{t("review.originalValue", { value: field.original })}</span>}
        {field.value === "—" && field.origin === "printed" && <span>{t("review.blank")}</span>}
        {field.derived && sourceNames && <span className="truncate">{t("review.derivedFrom", { fields: sourceNames })}</span>}
        {!field.derived && field.sourceLabel && field.value !== "—" && <span className="truncate">{field.sourceLabel}</span>}
      </div>
      {error && (
        <p role="alert" className="text-sm text-neg">
          {error}
        </p>
      )}
    </li>
  );
}
