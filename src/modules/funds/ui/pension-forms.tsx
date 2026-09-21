"use client";

import { Check, FileUp, Pencil, Trash2 } from "lucide-react";
import { useTranslations } from "next-intl";
import { useRouter } from "next/navigation";
import { type DragEvent, type FormEvent, useId, useState, useTransition } from "react";
import { Badge } from "@/ui/badge";
import { Button, IconButton } from "@/ui/button";
import { cn } from "@/ui/cn";
import { Field } from "@/ui/field";
import { Input, Select } from "@/ui/input";
import { Modal } from "@/ui/modal";
import { type Highlight, PdfViewer } from "@/ui/pdf-viewer";
import { notify } from "@/ui/toast";
import {
  type ActionResult,
  addVoluntaryAction,
  applyCometaDocumentAction,
  clearDecisionAction,
  decideDifferenceAction,
  decidePositionFieldAction,
  deleteCometaDocumentAction,
  deleteOperationAction,
  deleteContributionRuleAction,
  retryCometaDocumentAction,
  saveContributionRuleAction,
  saveToleranceAction,
  setReceivesPayrollAction,
  uploadCometaDocumentsAction,
} from "../pension/actions";
import { updateFundAction } from "../actions";
import { KindField } from "./fund-forms";

const KNOWN = [
  "invalid",
  "not_found",
  "linked",
  "empty",
  "too_large",
  "too_many",
  "unsupported_format",
  "invalid_state",
  "no_table",
  "missing_columns",
  "bad_value",
  "binary_xls",
  "storage_failed",
];

function useResult() {
  const t = useTranslations("funds.pension");
  const [error, setError] = useState<string | null>(null);
  return {
    error,
    setError,
    ok(result: ActionResult): boolean {
      if (result.ok) {
        setError(null);
        return true;
      }
      setError(t(`errors.${KNOWN.includes(result.error) ? result.error : "failed"}` as "errors.failed"));
      return false;
    },
  };
}

function ErrorLine({ error }: { error: string | null }) {
  return error ? (
    <p role="alert" className="col-span-full text-sm text-neg">
      {error}
    </p>
  ) : null;
}

/**
 * "Import statement" (design): the Cometa files. What each one is comes from its content (spec
 * §9.3) — the summary PDF or the operations export — and each is read as soon as it lands.
 */
export function ImportCometaButton({
  fundId,
  label,
  size = "sm",
}: {
  fundId: string;
  label: string;
  size?: "sm" | "md";
}) {
  const t = useTranslations("funds.pension.import");
  const router = useRouter();
  const id = useId();
  const [open, setOpen] = useState(false);
  const [files, setFiles] = useState<File[]>([]);
  const [over, setOver] = useState(false);
  const { error, setError, ok } = useResult();
  const [pending, startTransition] = useTransition();

  function reset(next: boolean) {
    setOpen(next);
    setFiles([]);
    setError(null);
  }

  function onSubmit() {
    const data = new FormData();
    for (const file of files) data.append("files", file);
    startTransition(async () => {
      const result = await uploadCometaDocumentsAction(fundId, data);
      if (!result.ok) {
        ok(result);
        return;
      }
      const added = result.uploaded.filter((one) => !one.duplicate);
      if (added.length > 0) notify(t("uploaded", { count: added.length }));
      if (result.uploaded.length > added.length) {
        notify(t("duplicates", { count: result.uploaded.length - added.length }));
      }
      for (const refused of result.refused) notify(t("refused", { name: refused.name }), "error");
      reset(false);
      if (added.length === 1) router.push(`/funds/${fundId}/documents/${added[0].id}`);
      else router.refresh();
    });
  }

  return (
    <>
      <Button size={size} onClick={() => reset(true)}>
        {label}
      </Button>
      <Modal
        open={open}
        onOpenChange={reset}
        title={t("title")}
        description={t("description")}
        width={520}
        footer={
          <>
            <Button onClick={() => reset(false)}>{t("cancel")}</Button>
            <Button variant="primary" onClick={onSubmit} disabled={pending || files.length === 0}>
              {t("submit")}
            </Button>
          </>
        }
      >
        <label
          htmlFor={`${id}-files`}
          onDragOver={(event: DragEvent<HTMLLabelElement>) => {
            event.preventDefault();
            setOver(true);
          }}
          onDragLeave={() => setOver(false)}
          onDrop={(event: DragEvent<HTMLLabelElement>) => {
            event.preventDefault();
            setOver(false);
            setFiles([...event.dataTransfer.files]);
          }}
          className={cn(
            "flex cursor-pointer flex-col items-center gap-2 rounded-card border border-dashed border-border px-4 py-8 text-center hover:bg-hover",
            over && "border-accent bg-soft",
          )}
        >
          <FileUp size={20} className="text-muted" aria-hidden />
          <span className="font-medium text-accent">{t("choose")}</span>
          <span className="text-sm text-muted">{t("drop")}</span>
          <input
            id={`${id}-files`}
            name="files"
            type="file"
            accept="application/pdf,.pdf,.xls,.xlsx,text/html"
            multiple
            className="sr-only"
            onChange={(event) => setFiles([...(event.currentTarget.files ?? [])])}
          />
        </label>
        {files.length > 0 && (
          <ul className="max-h-32 overflow-auto text-sm text-muted">
            {files.map((file) => (
              <li key={`${file.name}-${file.size}`} className="truncate">
                {file.name}
              </li>
            ))}
          </ul>
        )}
        <ErrorLine error={error} />
      </Modal>
    </>
  );
}

/** "Apply" on a reviewed document (spec §9.3 step 5). */
export function ApplyDocumentButton({
  fundId,
  documentId,
  kind,
  label,
  toast,
}: {
  fundId: string;
  documentId: string;
  kind: "cometa_operations" | "cometa_position";
  label: string;
  toast: string;
}) {
  const router = useRouter();
  const { error, ok } = useResult();
  const [pending, startTransition] = useTransition();
  return (
    <span className="flex flex-col gap-1">
      <Button
        variant="primary"
        disabled={pending}
        onClick={() =>
          startTransition(async () => {
            if (ok(await applyCometaDocumentAction(fundId, documentId, kind))) {
              notify(toast);
              router.push(`/funds/${fundId}`);
            }
          })
        }
      >
        {label}
      </Button>
      <ErrorLine error={error} />
    </span>
  );
}

export function DocumentActions({
  fundId,
  documentId,
  canDelete,
  labels,
}: {
  fundId: string;
  documentId: string;
  canDelete: boolean;
  labels: { retry: string; delete: string; deleted: string };
}) {
  const router = useRouter();
  const { error, ok } = useResult();
  const [pending, startTransition] = useTransition();
  return (
    <span className="flex flex-wrap items-center gap-2">
      <Button
        size="sm"
        disabled={pending}
        onClick={() =>
          startTransition(async () => {
            if (ok(await retryCometaDocumentAction(fundId, documentId))) router.refresh();
          })
        }
      >
        {labels.retry}
      </Button>
      {canDelete && (
        <Button
          size="sm"
          variant="danger"
          disabled={pending}
          onClick={() =>
            startTransition(async () => {
              if (ok(await deleteCometaDocumentAction(fundId, documentId))) {
                notify(labels.deleted);
                router.push(`/funds/${fundId}`);
              }
            })
          }
        >
          {labels.delete}
        </Button>
      )}
      <ErrorLine error={error} />
    </span>
  );
}

export interface PositionFieldView {
  field: string;
  label: string;
  value: string;
  input: string;
  unit: "eur" | "date";
  page: number | null;
  bbox: [number, number, number, number] | null;
  verification: "unverified" | "confirmed" | "corrected";
  original: string | null;
  sourceLabel: string | null;
}

/**
 * The review of a statement (spec §9.3 step 4, plan F6 §3.6.10): every value beside the page it
 * was read from, confirmed or corrected — the printed value stays under the correction.
 */
export function PositionReview({
  fundId,
  documentId,
  fileName,
  originalUrl,
  fields,
  editable,
}: {
  fundId: string;
  documentId: string;
  fileName: string;
  originalUrl: string | null;
  fields: PositionFieldView[];
  editable: boolean;
}) {
  const t = useTranslations("funds.pension.review");
  const [selected, setSelected] = useState<string | null>(null);
  const current = fields.find((field) => field.field === selected);
  const highlights: Highlight[] =
    current?.bbox && current.page ? [{ page: current.page, bbox: current.bbox }] : [];

  return (
    <div className="grid items-start gap-4 @5xl:grid-cols-[minmax(0,5fr)_minmax(0,7fr)]">
      <section className="overflow-hidden rounded-card border border-border bg-card">
        <h2 className="border-b border-border px-4 py-2 font-semibold">{t("values")}</h2>
        <ul className="divide-y divide-border">
          {fields.map((field) => (
            <PositionFieldRow
              key={field.field}
              fundId={fundId}
              documentId={documentId}
              field={field}
              editable={editable}
              selected={selected === field.field}
              onSelect={() => setSelected(field.field)}
            />
          ))}
        </ul>
      </section>
      <div className="min-w-0 @5xl:sticky @5xl:top-4">
        {originalUrl ? (
          <PdfViewer
            url={originalUrl}
            fileName={fileName}
            highlights={highlights}
            labels={{
              page: (page, pages) => t("viewer.page", { page, pages }),
              previous: t("viewer.previous"),
              next: t("viewer.next"),
              zoomIn: t("viewer.zoomIn"),
              zoomOut: t("viewer.zoomOut"),
              open: t("viewer.open"),
              loading: t("viewer.loading"),
              failed: t("viewer.failed"),
            }}
          />
        ) : (
          <p className="rounded-card border border-border bg-card p-4 text-sm text-muted">
            {t("viewer.deleted")}
          </p>
        )}
      </div>
    </div>
  );
}

const VERIFICATION_TONE = { unverified: "neutral", confirmed: "pos", corrected: "accent" } as const;

function PositionFieldRow({
  fundId,
  documentId,
  field,
  editable,
  selected,
  onSelect,
}: {
  fundId: string;
  documentId: string;
  field: PositionFieldView;
  editable: boolean;
  selected: boolean;
  onSelect: () => void;
}) {
  const t = useTranslations("funds.pension.review");
  const [editing, setEditing] = useState(false);
  const { error, ok } = useResult();
  const [pending, startTransition] = useTransition();

  function decide(typed: string | null) {
    startTransition(async () => {
      if (ok(await decidePositionFieldAction(fundId, documentId, field.field, typed))) {
        setEditing(false);
        notify(t("saved"));
      }
    });
  }

  return (
    <li className={cn("flex flex-col gap-1 px-4 py-2", selected && "bg-sel")}>
      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={onSelect}
          aria-pressed={selected}
          className="focus-ring inline-flex min-h-6 min-w-0 flex-1 items-center truncate rounded-[3px] text-left font-medium"
        >
          {field.label}
        </button>
        {!editing && <span className="shrink-0 text-right tabular-nums">{field.value}</span>}
        {editable && !editing && (
          <span className="flex shrink-0 gap-0.5">
            {field.verification === "unverified" && (
              <IconButton label={t("confirm")} onClick={() => decide(null)} disabled={pending}>
                <Check size={14} />
              </IconButton>
            )}
            <IconButton label={t("correct")} onClick={() => setEditing(true)} disabled={pending}>
              <Pencil size={14} />
            </IconButton>
          </span>
        )}
      </div>
      {editing && (
        <form
          onSubmit={(event: FormEvent<HTMLFormElement>) => {
            event.preventDefault();
            decide(String(new FormData(event.currentTarget).get("value") ?? ""));
          }}
          className="flex items-center gap-2"
        >
          <Input
            name="value"
            aria-label={field.label}
            defaultValue={field.input}
            type={field.unit === "date" ? "date" : "text"}
            inputMode={field.unit === "eur" ? "decimal" : undefined}
            numeric={field.unit === "eur"}
            className="min-w-0 flex-1"
            autoFocus
          />
          <Button type="submit" size="sm" variant="primary" disabled={pending}>
            {t("save")}
          </Button>
          <Button size="sm" onClick={() => setEditing(false)}>
            {t("cancel")}
          </Button>
        </form>
      )}
      <div className="flex flex-wrap items-center gap-1.5 text-xs text-muted">
        <Badge tone={VERIFICATION_TONE[field.verification]}>{t(`verification.${field.verification}`)}</Badge>
        {field.original !== null && <span>{t("originalValue", { value: field.original })}</span>}
        {field.sourceLabel && <span className="truncate">{field.sourceLabel}</span>}
      </div>
      <ErrorLine error={error} />
    </li>
  );
}

export interface DifferenceTarget {
  year: number;
  quarter: number;
  component: string;
  componentLabel: string;
  differenceCents: string;
  accruedCents: string | null;
  creditedCents: string | null;
  competenceIds: string[];
  operationIds: string[];
  difference: string;
}

/**
 * "Accept this difference" (GC §11.9): a person's word, with the note that explains it. No amount
 * is ever invented to make the two sides meet.
 */
export function AcceptDifferenceButton({
  fundId,
  target,
  label,
}: {
  fundId: string;
  target: DifferenceTarget;
  label: string;
}) {
  const t = useTranslations("funds.pension.reconciliation");
  const router = useRouter();
  const id = useId();
  const [open, setOpen] = useState(false);
  const { error, setError, ok } = useResult();
  const [pending, startTransition] = useTransition();

  function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const note = String(new FormData(event.currentTarget).get("note") ?? "");
    startTransition(async () => {
      if (ok(await decideDifferenceAction(fundId, { ...target, note }))) {
        setOpen(false);
        notify(t("accepted"));
        router.refresh();
      }
    });
  }

  return (
    <>
      <Button
        size="xs"
        variant="ghost"
        onClick={() => {
          setError(null);
          setOpen(true);
        }}
      >
        {label}
      </Button>
      <Modal
        open={open}
        onOpenChange={setOpen}
        title={t("accept.title", { component: target.componentLabel })}
        description={t("accept.description", { difference: target.difference })}
        width={520}
      >
        <form onSubmit={onSubmit} className="flex flex-col gap-3">
          <Field label={t("accept.note")} htmlFor={`${id}-note`}>
            <Input id={`${id}-note`} name="note" required maxLength={500} autoFocus />
          </Field>
          <ErrorLine error={error} />
          <div className="flex justify-end gap-2">
            <Button onClick={() => setOpen(false)}>{t("accept.cancel")}</Button>
            <Button type="submit" variant="primary" disabled={pending}>
              {t("accept.submit")}
            </Button>
          </div>
        </form>
      </Modal>
    </>
  );
}

export function ClearDecisionButton({
  fundId,
  year,
  quarter,
  component,
  label,
}: {
  fundId: string;
  year: number;
  quarter: number;
  component: string;
  label: string;
}) {
  const router = useRouter();
  const { ok } = useResult();
  const [pending, startTransition] = useTransition();
  return (
    <Button
      size="xs"
      variant="ghost"
      disabled={pending}
      onClick={() =>
        startTransition(async () => {
          if (ok(await clearDecisionAction(fundId, year, quarter, component))) router.refresh();
        })
      }
    >
      {label}
    </Button>
  );
}

/** "Add a voluntary contribution" (design; GC §3.1). */
export function AddVoluntaryButton({
  fundId,
  today,
  movements,
  label,
}: {
  fundId: string;
  today: string;
  /** The outgoing movements it can be tied to, as a PAC deposit is (design). */
  movements: readonly { id: string; label: string }[];
  label: string;
}) {
  const t = useTranslations("funds.pension.voluntary");
  const router = useRouter();
  const id = useId();
  const [open, setOpen] = useState(false);
  const { error, setError, ok } = useResult();
  const [pending, startTransition] = useTransition();

  function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    const text = (key: string) => String(data.get(key) ?? "").trim();
    startTransition(async () => {
      if (
        ok(
          await addVoluntaryAction(fundId, {
            on: text("on"),
            amount: text("amount"),
            fee: text("fee"),
            note: text("note"),
            transactionId: text("transaction"),
          }),
        )
      ) {
        setOpen(false);
        notify(t("added"));
        router.refresh();
      }
    });
  }

  return (
    <>
      <Button
        size="sm"
        onClick={() => {
          setError(null);
          setOpen(true);
        }}
      >
        {label}
      </Button>
      <Modal open={open} onOpenChange={setOpen} title={t("title")} description={t("description")} width={520}>
        <form onSubmit={onSubmit} className="grid grid-cols-2 gap-3">
          <Field label={t("date")} htmlFor={`${id}-on`}>
            <Input id={`${id}-on`} name="on" type="date" required defaultValue={today} />
          </Field>
          <Field label={t("amount")} htmlFor={`${id}-amount`}>
            <Input id={`${id}-amount`} name="amount" inputMode="decimal" numeric required />
          </Field>
          <Field label={t("fee")} htmlFor={`${id}-fee`}>
            <Input id={`${id}-fee`} name="fee" inputMode="decimal" numeric />
          </Field>
          <Field label={t("movement")} htmlFor={`${id}-transaction`}>
            <Select id={`${id}-transaction`} name="transaction" defaultValue="">
              <option value="">{t("noMovement")}</option>
              {movements.map((movement) => (
                <option key={movement.id} value={movement.id}>
                  {movement.label}
                </option>
              ))}
            </Select>
          </Field>
          <div className="col-span-2">
            <Field label={t("note")} htmlFor={`${id}-note`}>
              <Input id={`${id}-note`} name="note" maxLength={200} />
            </Field>
          </div>
          <ErrorLine error={error} />
          <div className="col-span-2 flex justify-end gap-2">
            <Button onClick={() => setOpen(false)}>{t("cancel")}</Button>
            <Button type="submit" variant="primary" disabled={pending}>
              {t("submit")}
            </Button>
          </div>
        </form>
      </Modal>
    </>
  );
}

export function DeleteOperationButton({
  fundId,
  operationId,
  label,
  toast,
}: {
  fundId: string;
  operationId: string;
  label: string;
  toast: string;
}) {
  const router = useRouter();
  const { ok } = useResult();
  const [pending, startTransition] = useTransition();
  return (
    <IconButton
      label={label}
      disabled={pending}
      onClick={() =>
        startTransition(async () => {
          if (ok(await deleteOperationAction(fundId, operationId))) {
            notify(toast);
            router.refresh();
          }
        })
      }
    >
      <Trash2 size={14} />
    </IconButton>
  );
}

/** Settings › Employer transfers: the deadline is the rule's; only the tolerance is a setting. */
export function ToleranceForm({ fundId, days }: { fundId: string; days: number }) {
  const t = useTranslations("funds.pension.settings");
  const id = useId();
  const { error, ok } = useResult();
  const [pending, startTransition] = useTransition();
  return (
    <form
      onSubmit={(event: FormEvent<HTMLFormElement>) => {
        event.preventDefault();
        const value = String(new FormData(event.currentTarget).get("days") ?? "");
        startTransition(async () => {
          if (ok(await saveToleranceAction(fundId, value))) notify(t("saved"));
        });
      }}
      className="flex flex-col gap-3"
    >
      <Field label={t("tolerance")} htmlFor={`${id}-days`} hint={t("toleranceHint")}>
        <Input id={`${id}-days`} name="days" type="number" min={0} max={120} defaultValue={String(days)} />
      </Field>
      <ErrorLine error={error} />
      <div>
        <Button type="submit" variant="primary" size="sm" disabled={pending}>
          {t("save")}
        </Button>
      </div>
    </form>
  );
}

/** Settings › Contribution rule (GC §3.2): what the contract says, recorded with its source. */
export function ContributionRuleForm({ fundId, today }: { fundId: string; today: string }) {
  const t = useTranslations("funds.pension.settings");
  const id = useId();
  const router = useRouter();
  const { error, ok } = useResult();
  const [pending, startTransition] = useTransition();
  return (
    <form
      onSubmit={(event: FormEvent<HTMLFormElement>) => {
        event.preventDefault();
        const form = event.currentTarget;
        const data = new FormData(form);
        const text = (key: string) => String(data.get(key) ?? "").trim();
        startTransition(async () => {
          if (
            ok(
              await saveContributionRuleAction(fundId, {
                validFrom: text("validFrom"),
                validTo: text("validTo"),
                ccnl: text("ccnl"),
                base: text("base"),
                workerPct: text("workerPct"),
                employerPct: text("employerPct"),
                tfrPct: text("tfrPct"),
                source: text("source"),
                verifiedOn: text("verifiedOn"),
              }),
            )
          ) {
            form.reset();
            notify(t("ruleAdded"));
            router.refresh();
          }
        });
      }}
      className="grid grid-cols-2 gap-3"
    >
      <Field label={t("validFrom")} htmlFor={`${id}-from`}>
        <Input id={`${id}-from`} name="validFrom" type="date" required defaultValue={today} />
      </Field>
      <Field label={t("validTo")} htmlFor={`${id}-to`}>
        <Input id={`${id}-to`} name="validTo" type="date" />
      </Field>
      <Field label={t("ccnl")} htmlFor={`${id}-ccnl`}>
        <Input id={`${id}-ccnl`} name="ccnl" maxLength={120} />
      </Field>
      <Field label={t("base")} htmlFor={`${id}-base`}>
        <Input id={`${id}-base`} name="base" maxLength={200} />
      </Field>
      <Field label={t("workerPct")} htmlFor={`${id}-worker`}>
        <Input id={`${id}-worker`} name="workerPct" inputMode="decimal" numeric />
      </Field>
      <Field label={t("employerPct")} htmlFor={`${id}-employer`}>
        <Input id={`${id}-employer`} name="employerPct" inputMode="decimal" numeric />
      </Field>
      <Field label={t("tfrPct")} htmlFor={`${id}-tfr`}>
        <Input id={`${id}-tfr`} name="tfrPct" inputMode="decimal" numeric />
      </Field>
      <Field label={t("verifiedOn")} htmlFor={`${id}-verified`}>
        <Input id={`${id}-verified`} name="verifiedOn" type="date" />
      </Field>
      <div className="col-span-2">
        <Field label={t("source")} htmlFor={`${id}-source`} hint={t("sourceHint")}>
          <Input id={`${id}-source`} name="source" maxLength={300} />
        </Field>
      </div>
      <ErrorLine error={error} />
      <div className="col-span-2">
        <Button type="submit" variant="primary" size="sm" disabled={pending}>
          {t("saveRule")}
        </Button>
      </div>
    </form>
  );
}

export function DeleteRuleButton({
  fundId,
  ruleId,
  label,
}: {
  fundId: string;
  ruleId: string;
  label: string;
}) {
  const router = useRouter();
  const { ok } = useResult();
  const [pending, startTransition] = useTransition();
  return (
    <IconButton
      label={label}
      disabled={pending}
      onClick={() =>
        startTransition(async () => {
          if (ok(await deleteContributionRuleAction(fundId, ruleId))) router.refresh();
        })
      }
    >
      <Trash2 size={14} />
    </IconButton>
  );
}

/** Settings › "This fund takes the payslips' contributions" (plan F6 §3.6.2). */
export function ReceivesPayrollButton({
  fundId,
  label,
  toast,
}: {
  fundId: string;
  label: string;
  toast: string;
}) {
  const router = useRouter();
  const { error, ok } = useResult();
  const [pending, startTransition] = useTransition();
  return (
    <span className="flex flex-col gap-1">
      <Button
        size="sm"
        disabled={pending}
        onClick={() =>
          startTransition(async () => {
            if (ok(await setReceivesPayrollAction(fundId))) {
              notify(toast);
              router.refresh();
            }
          })
        }
      >
        {label}
      </Button>
      <ErrorLine error={error} />
    </span>
  );
}

/** Settings › General for a pension fund: the PAC's plan fields have no place here. */
export function PensionSettingsForm({
  fundId,
  draft,
}: {
  fundId: string;
  draft: { name: string; provider: string; compartment: string; startOn: string };
}) {
  const t = useTranslations("funds.pension.settings");
  const id = useId();
  const { error, ok } = useResult();
  const [pending, startTransition] = useTransition();
  return (
    <form
      onSubmit={(event: FormEvent<HTMLFormElement>) => {
        event.preventDefault();
        const data = new FormData(event.currentTarget);
        const text = (key: string) => String(data.get(key) ?? "").trim();
        startTransition(async () => {
          if (
            ok(
              await updateFundAction(fundId, {
                name: text("name"),
                provider: text("provider"),
                isin: "",
                compartment: text("compartment"),
                debitAccountId: "",
                debitDay: "",
                ter: "",
                startOn: text("startOn"),
                monthly: "",
                fee: "",
              }),
            )
          ) {
            notify(t("saved"));
          }
        });
      }}
      className="grid grid-cols-2 gap-3"
    >
      <div className="col-span-2">
        <Field label={t("name")} htmlFor={`${id}-name`}>
          <Input id={`${id}-name`} name="name" required maxLength={80} defaultValue={draft.name} />
        </Field>
      </div>
      <Field label={t("provider")} htmlFor={`${id}-provider`}>
        <Input id={`${id}-provider`} name="provider" maxLength={80} defaultValue={draft.provider} />
      </Field>
      <Field label={t("compartment")} htmlFor={`${id}-compartment`}>
        <Input id={`${id}-compartment`} name="compartment" maxLength={80} defaultValue={draft.compartment} />
      </Field>
      <KindField kind="pension" />
      <Field label={t("start")} htmlFor={`${id}-start`}>
        <Input id={`${id}-start`} name="startOn" type="date" required defaultValue={draft.startOn} />
      </Field>
      <ErrorLine error={error} />
      <div className="col-span-2">
        <Button type="submit" variant="primary" size="sm" disabled={pending}>
          {t("save")}
        </Button>
      </div>
    </form>
  );
}
