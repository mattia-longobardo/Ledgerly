"use client";

// «Import CSV» of an account «a mano» (rewrite plan R5c, decision ST-8): a file, the map of its
// columns, then what the import wrote. The server reads the file and decides each row; this dialog
// shows its answers and formats them.
import { useTranslations } from "next-intl";
import { type FormEvent, useEffect, useId, useState, useTransition } from "react";
import { csv } from "@ledgerly/api-contract/transactions";
import { Button } from "@ledgerly/ui/button";
import { Field } from "@ledgerly/ui/field";
import { Checkbox, Input } from "@ledgerly/ui/input";
import { Modal } from "@ledgerly/ui/modal";
import { type CsvImported, type CsvMap, type CsvPreview, importCsv, previewCsv } from "../csv-calls";
import { type CsvText, MapFields, PreviewTable, reasonText } from "./csv-map";
import type { CardFormat } from "./net-worth-card";

/** The codes the dialog has a sentence for; any other is `failed`. */
const ERRORS = [
  "account_not_manual",
  "account_unavailable",
  "too_large",
  "too_many_rows",
  "empty",
  "unreadable",
  "invalid",
] as const;
/** The refused rows the summary lists; the count says the rest. */
const MAX_LISTED = 50;
/** How long the map rests before the first rows are read again with it. */
const REREAD_MS = 300;

type Step =
  { kind: "file" } | { kind: "map"; file: File; preview: CsvPreview } | { kind: "done"; result: CsvImported };

interface Target {
  accountId: string;
  accountName: string;
  currency: string;
  format: CardFormat;
}

function errorText(text: CsvText, code: string): string {
  const known = ERRORS.find((one) => one === code);
  return known === undefined ? text("errors.failed") : text(`errors.${known}`);
}

/** The map the dialog starts from: the account's, the file's proposal, or only the date. */
function startingMap(preview: CsvPreview): CsvMap {
  return (
    preview.savedMap ??
    preview.proposedMap ?? {
      columns: { date: 0, amount: null, debit: null, credit: null, payee: null, note: null, category: null },
      delimiter: preview.delimiter,
      decimalSeparator: ",",
      dateFormat: "DD/MM/YYYY",
      skipRows: 0,
      header: true,
    }
  );
}

/** The button of an account's header, and its dialog. */
export function CsvImportButton(target: Target) {
  const text = useTranslations("accounts.csv");
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button size="sm" onClick={() => setOpen(true)}>
        {text("open")}
      </Button>
      {open && <CsvImportDialog target={target} onClose={() => setOpen(false)} />}
    </>
  );
}

function CsvImportDialog({ target, onClose }: { target: Target; onClose: () => void }) {
  const text = useTranslations("accounts.csv");
  const [step, setStep] = useState<Step>({ kind: "file" });
  return (
    <Modal
      open
      onOpenChange={(next) => !next && onClose()}
      title={text("title")}
      description={text("description", { account: target.accountName })}
      width={680}
    >
      {step.kind === "file" && (
        <FileStep
          accountId={target.accountId}
          onRead={(file, preview) => setStep({ kind: "map", file, preview })}
          onClose={onClose}
        />
      )}
      {step.kind === "map" && (
        <MapStep
          target={target}
          file={step.file}
          preview={step.preview}
          onBack={() => setStep({ kind: "file" })}
          onDone={(result) => setStep({ kind: "done", result })}
        />
      )}
      {step.kind === "done" && <DoneStep result={step.result} onClose={onClose} />}
    </Modal>
  );
}

function FileStep({
  accountId,
  onRead,
  onClose,
}: {
  accountId: string;
  onRead: (file: File, preview: CsvPreview) => void;
  onClose: () => void;
}) {
  const text = useTranslations("accounts.csv");
  const id = useId();
  const [file, setFile] = useState<File | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (file === null) {
      setError(text("errors.noFile"));
      return;
    }
    startTransition(async () => {
      const read = await previewCsv(accountId, file);
      if (read.ok) onRead(file, read.preview);
      else setError(errorText(text, read.error));
    });
  }

  return (
    <form onSubmit={onSubmit} noValidate className="flex flex-col gap-3">
      <Field label={text("file")} htmlFor={`${id}-file`} hint={text("fileHint")} error={error ?? undefined}>
        <Input
          id={`${id}-file`}
          name="file"
          type="file"
          onChange={(event) => setFile(event.target.files?.[0] ?? null)}
          accept=".csv,text/csv,text/plain"
        />
      </Field>
      {error && (
        <p role="alert" className="text-sm text-neg">
          {error}
        </p>
      )}
      <div className="flex justify-end gap-2">
        <Button onClick={onClose}>{text("cancel")}</Button>
        <Button type="submit" variant="primary" disabled={pending}>
          {text("read")}
        </Button>
      </div>
    </form>
  );
}

/**
 * The map the person chooses, from the one the preview read the rows with, and the first rows of the
 * file, read again by the server with each new map.
 */
function useMap(accountId: string, file: File, preview: CsvPreview, onError: (error: string) => void) {
  const text = useTranslations("accounts.csv");
  const [first] = useState(() => startingMap(preview));
  const [map, setMap] = useState(first);
  const [rows, setRows] = useState(preview.rows);
  useEffect(() => {
    if (map === first || !csv.csvMapSchema.safeParse(map).success) return;
    let current = true;
    const timer = setTimeout(async () => {
      const read = await previewCsv(accountId, file, map);
      if (!current) return;
      if (read.ok) setRows(read.preview.rows);
      else onError(errorText(text, read.error));
    }, REREAD_MS);
    return () => {
      current = false;
      clearTimeout(timer);
    };
  }, [map, first, file, accountId, text, onError]);
  return { map, setMap, rows };
}

function MapStep({
  target,
  file,
  preview,
  onBack,
  onDone,
}: {
  target: Target;
  file: File;
  preview: CsvPreview;
  onBack: () => void;
  onDone: (result: CsvImported) => void;
}) {
  const text = useTranslations("accounts.csv");
  const [save, setSave] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const { map, setMap, rows } = useMap(target.accountId, file, preview, setError);

  function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!csv.csvMapSchema.safeParse(map).success) {
      setError(text("errors.map"));
      return;
    }
    startTransition(async () => {
      const done = await importCsv(target.accountId, file, map, save);
      if (done.ok) onDone(done.result);
      else setError(errorText(text, done.error));
    });
  }

  const origin = preview.savedMap ? "mapSaved" : preview.proposedMap ? "mapProposed" : "mapNone";
  return (
    <form onSubmit={onSubmit} noValidate className="flex min-h-0 flex-col gap-4 overflow-y-auto">
      <p className="text-sm text-muted">
        {text("summary", { name: file.name, rows: preview.rowCount, delimiter: map.delimiter })} ·{" "}
        {text(origin)}
      </p>
      <MapFields columns={preview.columns} map={map} onChange={setMap} />
      <Checkbox checked={save} onChange={(event) => setSave(event.target.checked)} label={text("save")} />
      <PreviewTable rows={rows} currency={target.currency} format={target.format} />
      {error && (
        <p role="alert" className="text-sm text-neg">
          {error}
        </p>
      )}
      <div className="sticky bottom-0 flex flex-wrap justify-end gap-2 bg-card pt-2">
        <Button onClick={onBack}>{text("back")}</Button>
        <Button type="submit" variant="primary" disabled={pending}>
          {text("import")}
        </Button>
      </div>
    </form>
  );
}

function DoneStep({ result, onClose }: { result: CsvImported; onClose: () => void }) {
  const text = useTranslations("accounts.csv");
  const titleId = useId();
  const listed = result.refused.slice(0, MAX_LISTED);
  return (
    <div className="flex flex-col gap-3">
      <p role="status" className="flex flex-col gap-1 text-sm">
        <span className="font-medium">{text("done", { count: result.created })}</span>
        <span className="text-muted">{text("duplicates", { count: result.duplicates })}</span>
      </p>
      {result.refused.length > 0 && (
        <section className="flex flex-col gap-1.5" aria-labelledby={titleId}>
          <h3 id={titleId} className="text-sm font-medium">
            {text("refusedTitle", { count: result.refused.length })}
          </h3>
          <ul className="flex max-h-60 flex-col gap-0.5 overflow-y-auto text-sm text-muted">
            {listed.map((one) => (
              <li key={one.row}>
                {text("refusedRow", { row: one.row, reason: reasonText(text, one.reason) })}
              </li>
            ))}
          </ul>
          {result.refused.length > listed.length && (
            <p className="text-sm text-faint">
              {text("more", { count: result.refused.length - listed.length })}
            </p>
          )}
        </section>
      )}
      <div className="flex justify-end">
        <Button variant="primary" onClick={onClose}>
          {text("close")}
        </Button>
      </div>
    </div>
  );
}
