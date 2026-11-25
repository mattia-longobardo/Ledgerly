"use client";

// «Learn from your history» (decision 14A): the CSV export of the app used before, read by the server as
// labels the automatic categories learn from. No movement is written; the screen only shows the counts.
import { useTranslations } from "next-intl";
import { type FormEvent, useId, useState, useTransition } from "react";
import { Button } from "@ledgerly/ui/button";
import { Field } from "@ledgerly/ui/field";
import { Input } from "@ledgerly/ui/input";
import { SettingsSection } from "@ledgerly/ui/section";
import { type HistoryImported, importHistory } from "@/modules/transactions";

/** The refusals with a sentence of their own; any other reads the generic one. */
const ERRORS = ["columns", "too_large", "too_many_rows", "noFile"] as const;

/** The counts that are not labels, in the order the result lists them. */
const LEFT_OUT = ["unmapped", "duplicates", "transfers", "unknown", "unreadable"] as const;

export function HistoryImport() {
  const text = useTranslations("settings.categories.history");
  const id = useId();
  const [file, setFile] = useState<File | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<HistoryImported | null>(null);
  const [pending, startTransition] = useTransition();

  function errorText(code: string): string {
    const known = ERRORS.find((one) => one === code);
    return known === undefined ? text("errors.failed") : text(`errors.${known}`);
  }

  function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (file === null) {
      setError(errorText("noFile"));
      return;
    }
    startTransition(async () => {
      setError(null);
      setResult(null);
      try {
        const answer = await importHistory(file);
        if (answer.ok) setResult(answer.result);
        else setError(errorText(answer.error));
      } catch {
        setError(errorText("failed"));
      }
    });
  }

  return (
    <SettingsSection title={text("title")} description={text("description")}>
      <form onSubmit={onSubmit} noValidate className="flex flex-col gap-3">
        <Field label={text("file")} htmlFor={`${id}-file`} hint={text("fileHint")}>
          <Input
            id={`${id}-file`}
            name="file"
            type="file"
            accept=".csv,text/csv,text/plain"
            onChange={(event) => {
              setFile(event.target.files?.[0] ?? null);
              setError(null);
            }}
          />
        </Field>
        {error && (
          <p role="alert" className="text-sm text-neg">
            {error}
          </p>
        )}
        <div className="flex justify-end">
          <Button type="submit" variant="primary" disabled={pending}>
            {pending ? text("importing") : text("import")}
          </Button>
        </div>
      </form>
      {result && <HistoryResult result={result} />}
    </SettingsSection>
  );
}

/** What the import learnt, and only the reasons that left rows out. */
function HistoryResult({ result }: { result: HistoryImported }) {
  const text = useTranslations("settings.categories.history");
  return (
    <div role="status" data-testid="history-result" className="flex flex-col gap-1.5 text-sm">
      <p className="font-medium">{text("result.imported", { count: result.imported })}</p>
      <ul className="flex flex-col gap-0.5 text-muted">
        {LEFT_OUT.filter((key) => result[key] > 0).map((key) => (
          <li key={key}>{text(`result.${key}`, { count: result[key] })}</li>
        ))}
      </ul>
      <p className="text-muted">{text("result.noMovements")}</p>
    </div>
  );
}
