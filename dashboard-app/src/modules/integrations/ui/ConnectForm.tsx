"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { ErrorInline } from "@/components/ui/ErrorInline";
import { Toast } from "@/components/ui/Toast";
import { connectIntegrationAction } from "@/app/actions/integrations";
import type { CredentialField } from "@/platform/integrations/types";
import { FIELD, LABEL, PRIMARY } from "./styles";

export interface ConnectFormProps {
  provider: string;
  fields: readonly CredentialField[];
  connected: boolean;
}

/**
 * The credential form.
 *
 * It renders EMPTY every time, including for a connection that already has a
 * credential: a stored secret is never sent to the browser, so there is nothing
 * to prefill and nothing that could leak into the HTML. Submitting replaces
 * whatever is stored.
 */
export function ConnectForm({ provider, fields, connected }: ConnectFormProps) {
  const router = useRouter();
  const [values, setValues] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function submit() {
    setError(null);
    startTransition(async () => {
      const data = new FormData();
      data.append("provider", provider);
      for (const field of fields) data.append(`credentials.${field.name}`, values[field.name] ?? "");
      const result = await connectIntegrationAction(data);
      if (!result.ok) {
        setError(result.error);
        return;
      }
      // A stored-but-failing credential is a success with bad news, so the
      // message is the provider's own either way.
      setValues({});
      setToast(result.data.message);
      router.refresh();
    });
  }

  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        submit();
      }}
      className="flex flex-col gap-3"
    >
      {error !== null && <ErrorInline message={error} />}
      {fields.map((field) => (
        <label key={field.name} className="flex flex-col gap-1.5">
          <span className={LABEL}>{field.label}</span>
          <input
            type={field.secret ? "password" : "text"}
            value={values[field.name] ?? ""}
            onChange={(event) => setValues((v) => ({ ...v, [field.name]: event.target.value }))}
            autoComplete="off"
            placeholder={field.placeholder}
            className={FIELD}
          />
        </label>
      ))}
      <button type="submit" disabled={pending} className={PRIMARY}>
        {connected ? "Replace credentials" : "Connect"}
      </button>
      <Toast
        open={toast !== null}
        message={toast ?? ""}
        onOpenChange={(open) => {
          if (!open) setToast(null);
        }}
      />
    </form>
  );
}
