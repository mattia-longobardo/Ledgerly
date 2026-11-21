"use client";

// The small forms of the Connection tab: the service's web address, and «Confirm zero» on a reading
// that read nothing.
import { useTranslations } from "next-intl";
import { useId, useState, useTransition } from "react";
import { Button } from "@ledgerly/ui/button";
import { Field } from "@ledgerly/ui/field";
import { Input } from "@ledgerly/ui/input";
import { useRouter } from "@ledgerly/ui/router";
import { notify } from "@ledgerly/ui/toast";
import { confirmZero, updateServiceUrl } from "../calls";
import { ConfirmAction, useInvestmentResult } from "./dialog-kit";

export function ServiceUrlForm({ accountId, url }: { accountId: string; url: string | null }) {
  const text = useTranslations("investments");
  const id = useId();
  const [pending, startTransition] = useTransition();
  const router = useRouter();
  const { error, clear, report } = useInvestmentResult();
  return (
    <form
      className="flex flex-col gap-2"
      onSubmit={(event) => {
        event.preventDefault();
        const value = String(new FormData(event.currentTarget).get("url") ?? "");
        clear();
        startTransition(async () => {
          if (!report(await updateServiceUrl(accountId, value))) return;
          notify(text("toasts.urlSaved"));
          router.refresh();
        });
      }}
    >
      <Field label={text("settings.url")} htmlFor={`${id}-url`} hint={text("manualForm.urlHint")}>
        <Input
          id={`${id}-url`}
          name="url"
          type="url"
          inputMode="url"
          maxLength={500}
          defaultValue={url ?? ""}
        />
      </Field>
      {error && (
        <p role="alert" className="text-sm text-neg">
          {error}
        </p>
      )}
      <Button type="submit" size="sm" disabled={pending} className="self-start">
        {text("actions.saveUrl")}
      </Button>
    </form>
  );
}

export function ConfirmZeroButton({
  accountId,
  readingId,
  dateLabel,
}: {
  accountId: string;
  readingId: string;
  dateLabel: string;
}) {
  const text = useTranslations("investments");
  const router = useRouter();
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button size="xs" variant="secondary" onClick={() => setOpen(true)}>
        {text("actions.confirmZero")}
      </Button>
      {open && (
        <ConfirmAction
          onClose={() => setOpen(false)}
          title={text("confirm.zeroTitle")}
          description={text("confirm.zeroDescription", { date: dateLabel })}
          confirm={text("actions.confirmZero")}
          onConfirm={async () => {
            const result = await confirmZero(accountId, readingId);
            notify(
              result.ok ? text("toasts.zeroConfirmed") : text("errors.failed"),
              result.ok ? "success" : "error",
            );
            if (result.ok) router.refresh();
            return result.ok;
          }}
        />
      )}
    </>
  );
}
