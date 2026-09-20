"use client";

import { useTranslations } from "next-intl";
import { useTransition } from "react";
import { Button } from "@/ui/button";
import { cn } from "@/ui/cn";
import { notify } from "@/ui/toast";
import { markPostedAction, postEntryAction } from "../actions";
import { CATEGORY_NOT_LINKED, type PostingState } from "../rules";

const TONE: Record<PostingState, string> = {
  none: "bg-hover text-muted",
  claimed: "bg-warn-bg text-warn",
  posted: "bg-pos-bg text-pos",
  indeterminate: "bg-warn-bg text-warn",
};

/**
 * Where a settlement's Wallet posting stands (spec §7.6), and the only ways to move it by hand:
 * "Post now" from not posted, "Retry" or "Mark as posted" from unsure. Nothing here repeats a
 * posting by itself.
 */
export function PostingCell({
  ruleId,
  entryId,
  posting,
  error,
}: {
  ruleId: string;
  entryId: string;
  posting: PostingState;
  error: string | null;
}) {
  const t = useTranslations("interests.detail.posting");
  const [pending, startTransition] = useTransition();
  // The one "error" that is not a failure: the record is in Wallet, filed under no category
  // because the rule's category has no Wallet counterpart (spec §7.6).
  const uncategorised = posting === "posted" && error === CATEGORY_NOT_LINKED;

  function run(
    action: () => Promise<{ ok: true; state: string } | { ok: false; error: string }>,
    marked = false,
  ) {
    startTransition(async () => {
      const result = await action();
      if (!result.ok) return notify(t("toasts.none"), "error");
      const state = result.state as PostingState;
      notify(
        marked ? t("toasts.marked") : t(`toasts.${state === "claimed" ? "indeterminate" : state}`),
        state === "posted" ? "success" : "error",
      );
    });
  }

  return (
    <span className="flex flex-wrap items-center gap-1.5">
      <span
        title={
          posting === "indeterminate"
            ? `${t("unsureHint")}${error ? ` (${error})` : ""}`
            : uncategorised
              ? t("categoryNotLinkedHint")
              : (error ?? undefined)
        }
        className={cn("rounded-full px-2 py-0.5 text-xs font-medium whitespace-nowrap", TONE[posting])}
      >
        {t(`states.${posting}`)}
      </span>
      {uncategorised && (
        <span
          title={t("categoryNotLinkedHint")}
          className="rounded-full bg-warn-bg px-2 py-0.5 text-xs font-medium whitespace-nowrap text-warn"
        >
          {t("categoryNotLinked")}
        </span>
      )}
      {posting === "none" && (
        <Button
          size="xs"
          variant="ghost"
          disabled={pending}
          onClick={() => run(() => postEntryAction(ruleId, entryId, false))}
        >
          {t("postNow")}
        </Button>
      )}
      {posting === "indeterminate" && (
        <>
          <Button
            size="xs"
            variant="ghost"
            disabled={pending}
            onClick={() => run(() => postEntryAction(ruleId, entryId, true))}
          >
            {t("retry")}
          </Button>
          <Button
            size="xs"
            variant="ghost"
            disabled={pending}
            onClick={() => run(() => markPostedAction(ruleId, entryId), true)}
          >
            {t("markPosted")}
          </Button>
        </>
      )}
    </span>
  );
}
