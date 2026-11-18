"use client";

import { useTranslations } from "next-intl";
import { useState } from "react";
import { Button } from "@/ui/button";
import { Modal } from "@/ui/modal";
import { type DialogOptions, SubscriptionDialog, type SubscriptionDraft } from "./subscription-dialog";

export interface SuggestionView {
  key: string;
  name: string;
  detail: string;
  draft: SubscriptionDraft;
}

/**
 * "Suggest from recurring payments" (spec §7.5, plan F3 §3.6.8): the detected patterns no
 * subscription covers, each opening the dialog already filled in. Saving it is accepting it.
 */
export function SuggestionsButton({
  suggestions,
  options,
}: {
  suggestions: readonly SuggestionView[];
  options: DialogOptions;
}) {
  const t = useTranslations("subscriptions");
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState<SubscriptionDraft | null>(null);
  return (
    <>
      <Button size="sm" onClick={() => setOpen(true)}>
        {t("suggest")}
        {suggestions.length > 0 && (
          <span className="rounded-full bg-soft px-1.5 text-xs text-accent tabular-nums">
            {suggestions.length}
          </span>
        )}
      </Button>
      <Modal
        open={open}
        onOpenChange={setOpen}
        title={t("suggestions.title")}
        description={t("suggestions.description")}
        width={520}
      >
        {suggestions.length === 0 ? (
          <p className="text-muted">{t("suggestions.empty")}</p>
        ) : (
          <ul className="flex flex-col divide-y divide-border">
            {suggestions.map((suggestion) => (
              <li key={suggestion.key} className="flex items-center justify-between gap-3 py-2">
                <span className="flex min-w-0 flex-col">
                  <span className="truncate font-medium">{suggestion.name}</span>
                  <span className="truncate text-sm text-muted tabular-nums">{suggestion.detail}</span>
                </span>
                <Button
                  size="xs"
                  variant="primary"
                  aria-label={`${t("suggestions.add")}: ${suggestion.name}`}
                  onClick={() => {
                    setOpen(false);
                    setDraft(suggestion.draft);
                  }}
                >
                  {t("suggestions.add")}
                </Button>
              </li>
            ))}
          </ul>
        )}
      </Modal>
      {draft && <SubscriptionDialog draft={draft} options={options} onClose={() => setDraft(null)} />}
    </>
  );
}
