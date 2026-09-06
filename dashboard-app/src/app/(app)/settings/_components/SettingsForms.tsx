"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { ErrorInline } from "@/components/ui/ErrorInline";
import { Toast } from "@/components/ui/Toast";
import { clearLlmApiKey, setHoursPerDay, setLlmSettings } from "@/app/actions/settings";

const FIELD =
  "num min-h-11 w-full min-w-0 rounded-md border border-border bg-surface px-3 text-body text-fg";
/**
 * Amounts, hour counts and months are all short. `w-full` keeps the mobile
 * behaviour (the cap is never reached inside a 360 px gutter) while stopping
 * the field from stretching across a desktop column. `w-full` also pins the
 * used width of `input[type=month]`, whose native control otherwise reports a
 * wide intrinsic size on some mobile browsers.
 */
const FIELD_NARROW = `${FIELD} max-w-48`;
const LABEL = "text-caption tracking-wide text-fg-muted uppercase";
const PRIMARY =
  "inline-flex min-h-11 self-start items-center justify-center gap-2 rounded-md bg-accent px-4 text-body-sm font-medium text-accent-contrast transition-colors hover:bg-accent-hover disabled:opacity-40";
const SECONDARY =
  "inline-flex min-h-11 self-start items-center justify-center rounded-md border border-border bg-surface px-4 text-body-sm font-medium text-fg transition-colors hover:bg-surface-hover disabled:opacity-40";

function Spinner() {
  return (
    <span
      aria-hidden
      className="size-4 animate-spin rounded-full border-2 border-accent-contrast/40 border-t-accent-contrast"
    />
  );
}

export function HoursPerDayForm({ hoursPerDay }: { hoursPerDay: number }) {
  const router = useRouter();
  const [value, setValue] = useState(String(hoursPerDay));
  const [error, setError] = useState<string | null>(null);
  const [toast, setToast] = useState(false);
  const [pending, startTransition] = useTransition();

  return (
    <>
      <form
        onSubmit={(event) => {
          event.preventDefault();
          setError(null);
          startTransition(async () => {
            const result = await setHoursPerDay(value.replace(",", "."));
            if (result.ok) {
              setToast(true);
              router.refresh();
            } else {
              setError(result.error);
            }
          });
        }}
        className="flex flex-col gap-3"
      >
        {error !== null && <ErrorInline message={error} />}
        <label className="flex flex-col gap-1.5">
          <span className={LABEL}>Hours per day</span>
          <input
            value={value}
            onChange={(event) => setValue(event.target.value)}
            inputMode="decimal"
            autoComplete="off"
            className={FIELD_NARROW}
          />
          <span className="text-body-sm text-fg-muted">
            Payslips state ferie and ROL in hours; days are hours ÷ this number.
          </span>
        </label>
        <button type="submit" disabled={pending} className={SECONDARY}>
          Save
        </button>
      </form>
      <Toast
        open={toast}
        message="Hours per day saved"
        duration={4000}
        onOpenChange={setToast}
      />
    </>
  );
}

/**
 * Structurally identical to `LlmConfigStatus`, restated rather than imported so
 * this client module never so much as name-imports from a file that reaches
 * `@/lib/env` or `@/lib/db`. Note what is NOT here: the key itself.
 */
export interface LlmFormProps {
  baseUrl: string;
  model: string;
  hasKey: boolean;
  keySource: "settings" | "env" | null;
  hasStoredKey: boolean;
}

const KEY_STATUS: Record<string, string> = {
  settings: "Configured here",
  env: "Configured in the environment",
};

/**
 * The API key is write-only in this form: the server never sends its value
 * down, so the field always starts empty and an empty field means "keep the
 * stored key" — saving a new model cannot wipe the credential. Removing one is
 * the separate button below.
 */
export function LlmForm(props: LlmFormProps) {
  const router = useRouter();
  const [baseUrl, setBaseUrl] = useState(props.baseUrl);
  const [model, setModel] = useState(props.model);
  const [apiKey, setApiKey] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  return (
    <div className="flex flex-col gap-4">
      {error !== null && <ErrorInline message={error} />}

      <form
        onSubmit={(event) => {
          event.preventDefault();
          setError(null);
          startTransition(async () => {
            const result = await setLlmSettings({ baseUrl, model, apiKey });
            if (result.ok) {
              setApiKey("");
              setToast("Payslip AI settings saved");
              router.refresh();
            } else {
              setError(result.error);
            }
          });
        }}
        className="flex flex-col gap-3"
      >
        <label className="flex flex-col gap-1.5">
          <span className={LABEL}>Base URL</span>
          <input
            value={baseUrl}
            onChange={(event) => setBaseUrl(event.target.value)}
            inputMode="url"
            autoComplete="off"
            spellCheck={false}
            placeholder="https://api.openai.com/v1"
            className={FIELD}
          />
          <span className="text-body-sm text-fg-muted">
            Any OpenAI-compatible endpoint. Plain http:// is accepted only for a host on your own
            network.
          </span>
        </label>

        <label className="flex flex-col gap-1.5">
          <span className={LABEL}>Model</span>
          <input
            value={model}
            onChange={(event) => setModel(event.target.value)}
            autoComplete="off"
            spellCheck={false}
            placeholder="gpt-4.1-mini"
            className={FIELD}
          />
        </label>

        <label className="flex flex-col gap-1.5">
          <span className={LABEL}>API key</span>
          <input
            type="password"
            value={apiKey}
            onChange={(event) => setApiKey(event.target.value)}
            autoComplete="new-password"
            spellCheck={false}
            placeholder={props.hasKey ? "Leave blank to keep the current key" : "sk-…"}
            className={FIELD}
          />
          <span className="text-body-sm text-fg-muted">
            {props.hasKey
              ? `${KEY_STATUS[props.keySource ?? ""] ?? "Configured"}. The stored key is never sent back to this page; type a new one to replace it.`
              : "Without a key the payslip parser falls back to its deterministic rules alone."}
          </span>
        </label>

        <button type="submit" disabled={pending} className={PRIMARY}>
          {pending && <Spinner />}
          Save
        </button>
      </form>

      {props.hasStoredKey && (
        <form
          onSubmit={(event) => {
            event.preventDefault();
            setError(null);
            startTransition(async () => {
              const result = await clearLlmApiKey();
              if (result.ok) {
                setToast("Stored key removed");
                router.refresh();
              } else {
                setError(result.error);
              }
            });
          }}
          className="hairline-t pt-4"
        >
          <button type="submit" disabled={pending} className={SECONDARY}>
            Remove stored key
          </button>
        </form>
      )}

      <Toast
        open={toast !== null}
        message={toast ?? ""}
        duration={4000}
        onOpenChange={(open) => {
          if (!open) setToast(null);
        }}
      />
    </div>
  );
}
