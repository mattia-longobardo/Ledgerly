"use client";

import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { type FormEvent, useId, useState, useTransition } from "react";
import { Button } from "@/ui/button";
import { Field } from "@/ui/field";
import { Input } from "@/ui/input";
import { notify } from "@/ui/toast";
import type { LlmProbeResult } from "@/platform/settings/llm-probe";
import { removeLlmFallbackAction, saveLlmFallbackAction, testLlmFallbackAction } from "./actions";

/**
 * The OpenAI fallback (spec D12, D18): the model and the API key. The key is write-only — the page
 * shows its last four characters, and an empty field keeps the stored one.
 */
export function LlmCard({ current }: { current: { model: string; keyHint: string } | null }) {
  const t = useTranslations("settings.llm");
  const id = useId();
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [tested, setTested] = useState<{ message: string; ok: boolean } | null>(null);
  const [testing, setTesting] = useState(false);

  function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const data = new FormData(form);
    startTransition(async () => {
      const result = await saveLlmFallbackAction(
        String(data.get("model") ?? ""),
        String(data.get("apiKey") ?? ""),
      );
      if (!result.ok) {
        setError(t(`errors.${result.error}`));
        return;
      }
      setError(null);
      setTested(null);
      (form.elements.namedItem("apiKey") as HTMLInputElement).value = "";
      notify(t("saved"));
      router.refresh();
    });
  }

  function onRemove() {
    startTransition(async () => {
      await removeLlmFallbackAction();
      setTested(null);
      notify(t("removed"));
      router.refresh();
    });
  }

  /**
   * Tries what is *saved*, not what is typed: the key never leaves the server, so the check is a
   * Server Action, and its verdict is a message key — never the key, never OpenAI's own words.
   */
  function onTest() {
    setTesting(true);
    startTransition(async () => {
      const result: LlmProbeResult = await testLlmFallbackAction();
      setTesting(false);
      setTested({
        message:
          result.outcome === "ok" ? t("test.ok", { model: result.model }) : t(`test.${result.outcome}`),
        ok: result.outcome === "ok",
      });
    });
  }

  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-3" noValidate>
      <p className="text-sm text-muted" data-testid="llm-status">
        {current ? t("configured", { model: current.model, hint: current.keyHint }) : t("notConfigured")}
      </p>
      <Field label={t("model")} htmlFor={`${id}-model`} hint={t("modelHint")}>
        <Input
          id={`${id}-model`}
          name="model"
          defaultValue={current?.model ?? ""}
          autoComplete="off"
          required
        />
      </Field>
      <Field label={t("apiKey")} htmlFor={`${id}-key`} hint={current ? t("apiKeyKeep") : undefined}>
        <Input
          id={`${id}-key`}
          name="apiKey"
          type="password"
          autoComplete="off"
          placeholder={current ? `•••• ${current.keyHint}` : "sk-…"}
        />
      </Field>
      {error && (
        <p role="alert" className="text-sm text-neg">
          {error}
        </p>
      )}
      {tested && (
        <p
          role="status"
          data-testid="llm-test-result"
          className={tested.ok ? "text-sm text-pos" : "text-sm text-neg"}
        >
          {tested.message}
        </p>
      )}
      <div className="flex justify-end gap-2">
        <Button onClick={onTest} disabled={pending || !current} className="mr-auto">
          {testing ? t("test.running") : t("test.action")}
        </Button>
        {current && (
          <Button variant="danger" onClick={onRemove} disabled={pending}>
            {t("remove")}
          </Button>
        )}
        <Button type="submit" variant="primary" disabled={pending}>
          {t("save")}
        </Button>
      </div>
    </form>
  );
}
