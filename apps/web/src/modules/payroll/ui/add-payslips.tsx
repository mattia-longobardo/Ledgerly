"use client";

import { FileUp } from "lucide-react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { type DragEvent, useId, useState, useTransition } from "react";
import { Button } from "@/ui/button";
import { cn } from "@/ui/cn";
import { Modal } from "@/ui/modal";
import { notify } from "@/ui/toast";
import { uploadPayslipsAction } from "../actions";

/**
 * "Add payslip" (spec §7.8 D13: one, in the topbar): PDFs chosen or dropped, uploaded together.
 * One new payslip opens its review, which follows the reading as it happens; several go back to
 * the register, which does the same.
 */
export function AddPayslips({ label, size = "sm" }: { label: string; size?: "sm" | "md" }) {
  const t = useTranslations("payroll");
  const router = useRouter();
  const id = useId();
  const [open, setOpen] = useState(false);
  const [files, setFiles] = useState<File[]>([]);
  const [over, setOver] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function reset(next: boolean) {
    setOpen(next);
    setFiles([]);
    setError(null);
  }

  function onDrop(event: DragEvent<HTMLLabelElement>) {
    event.preventDefault();
    setOver(false);
    setFiles([...event.dataTransfer.files]);
  }

  function onSubmit() {
    const data = new FormData();
    for (const file of files) data.append("files", file);
    startTransition(async () => {
      const result = await uploadPayslipsAction(data);
      if (!result.ok) {
        setError(t(`errors.${result.error}` as never));
        return;
      }
      const added = result.uploaded.filter((one) => !one.duplicate);
      const duplicates = result.uploaded.length - added.length;
      if (added.length > 0) notify(t("upload.uploaded", { count: added.length }));
      if (duplicates > 0) notify(t("upload.duplicates", { count: duplicates }));
      for (const refused of result.refused) {
        notify(t("upload.refused", { name: refused.name, error: t(`errors.${refused.error}` as never) }), "error");
      }
      reset(false);
      if (result.uploaded.length === 1) router.push(`/payroll/${result.uploaded[0].id}`);
      else router.refresh();
    });
  }

  return (
    <>
      <Button variant="primary" size={size} onClick={() => reset(true)}>
        {label}
      </Button>
      <Modal
        open={open}
        onOpenChange={reset}
        title={t("upload.title")}
        description={t("upload.description")}
        width={520}
        footer={
          <>
            <Button onClick={() => reset(false)}>{t("upload.cancel")}</Button>
            <Button variant="primary" onClick={onSubmit} disabled={pending || files.length === 0}>
              {t("upload.submit")}
            </Button>
          </>
        }
      >
        <label
          htmlFor={`${id}-files`}
          onDragOver={(event) => {
            event.preventDefault();
            setOver(true);
          }}
          onDragLeave={() => setOver(false)}
          onDrop={onDrop}
          className={cn(
            "flex cursor-pointer flex-col items-center gap-2 rounded-card border border-dashed border-border px-4 py-8 text-center hover:bg-hover",
            over && "border-accent bg-soft",
          )}
        >
          <FileUp size={20} className="text-muted" aria-hidden />
          <span className="font-medium text-accent">{t("upload.choose")}</span>
          <span className="text-sm text-muted">{t("upload.drop")}</span>
          <input
            id={`${id}-files`}
            name="files"
            type="file"
            accept="application/pdf,.pdf"
            multiple
            className="sr-only"
            onChange={(event) => setFiles([...(event.currentTarget.files ?? [])])}
          />
        </label>
        {files.length > 0 && (
          <div className="flex flex-col gap-1 text-sm">
            <span className="font-medium">{t("upload.selected", { count: files.length })}</span>
            <ul className="max-h-32 overflow-auto text-muted">
              {files.map((file) => (
                <li key={`${file.name}-${file.size}`} className="truncate">
                  {file.name}
                </li>
              ))}
            </ul>
          </div>
        )}
        {error && (
          <p role="alert" className="text-sm text-neg">
            {error}
          </p>
        )}
      </Modal>
    </>
  );
}
