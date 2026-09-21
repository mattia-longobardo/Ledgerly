"use client";

import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useState, useTransition } from "react";
import type { DocumentState } from "@/modules/imports/rules";
import { Button } from "@/ui/button";
import { Modal } from "@/ui/modal";
import { notify } from "@/ui/toast";
import {
  type ActionResult,
  applyPayslipAction,
  deletePayslipDocumentAction,
  fillWithLlmAction,
  rejectPayslipAction,
  retryPayslipAction,
  verifyPayslipAction,
} from "../actions";

/**
 * What a person can do with a payslip in its state (spec §7.8): verify it — failed checks only
 * after saying so —, apply it, discard it, read it again, delete it while nothing was applied.
 */
export function ReviewActions({
  documentId,
  state,
  blocking,
  llm,
}: {
  documentId: string;
  state: DocumentState;
  blocking: boolean;
  /** The OpenAI fallback is configured and some value it may fill is still blank. */
  llm: boolean;
}) {
  const t = useTranslations("payroll");
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [confirm, setConfirm] = useState<"verify" | "delete" | null>(null);
  const [error, setError] = useState<string | null>(null);

  function run(action: () => Promise<ActionResult>, toast: string, then?: () => void) {
    startTransition(async () => {
      const result = await action();
      setConfirm(null);
      if (!result.ok) {
        setError(t(`errors.${result.error}` as never));
        return;
      }
      setError(null);
      notify(toast);
      if (then) then();
      else router.refresh();
    });
  }

  const verify = (acknowledge: boolean) =>
    run(() => verifyPayslipAction(documentId, acknowledge), t("review.toasts.verified"));
  const canRetry = ["needs_review", "needs_ocr", "verified", "failed", "rejected"].includes(state);
  const canReject = ["needs_review", "needs_ocr", "verified", "failed"].includes(state);
  const canDelete = ["needs_review", "needs_ocr", "verified", "failed", "rejected"].includes(state);

  return (
    <div className="flex flex-col items-end gap-1">
      <div className="flex flex-wrap justify-end gap-2">
        {canDelete && (
          <Button variant="ghost" onClick={() => setConfirm("delete")} disabled={pending}>
            {t("review.actions.delete")}
          </Button>
        )}
        {llm && state === "needs_review" && (
          <Button
            onClick={() =>
              startTransition(async () => {
                const result = await fillWithLlmAction(documentId);
                if (!result.ok) {
                  setError(t(`errors.${result.error}` as never));
                  return;
                }
                setError(null);
                notify(t("review.toasts.llm", { filled: result.filled }));
                router.refresh();
              })
            }
            disabled={pending}
          >
            {t("review.actions.llm")}
          </Button>
        )}
        {canRetry && (
          <Button onClick={() => run(() => retryPayslipAction(documentId), t("review.toasts.retried"))} disabled={pending}>
            {t("review.actions.retry")}
          </Button>
        )}
        {canReject && (
          <Button
            variant="danger"
            onClick={() => run(() => rejectPayslipAction(documentId), t("review.toasts.rejected"))}
            disabled={pending}
          >
            {t("review.actions.reject")}
          </Button>
        )}
        {state === "needs_review" && (
          <Button variant="primary" onClick={() => (blocking ? setConfirm("verify") : verify(false))} disabled={pending}>
            {t("review.actions.verify")}
          </Button>
        )}
        {state === "verified" && (
          <Button
            variant="primary"
            onClick={() => run(() => applyPayslipAction(documentId), t("review.toasts.applied"))}
            disabled={pending}
          >
            {t("review.actions.apply")}
          </Button>
        )}
      </div>
      {error && (
        <p role="alert" className="text-sm text-neg">
          {error}
        </p>
      )}
      <Modal
        open={confirm === "verify"}
        onOpenChange={(open) => setConfirm(open ? "verify" : null)}
        title={t("review.actions.verifyAnywayTitle")}
        description={t("review.actions.verifyAnywayDescription")}
        footer={
          <>
            <Button onClick={() => setConfirm(null)}>{t("review.actions.cancel")}</Button>
            <Button variant="primary" onClick={() => verify(true)} disabled={pending}>
              {t("review.actions.verifyAnyway")}
            </Button>
          </>
        }
      >
        {null}
      </Modal>
      <Modal
        open={confirm === "delete"}
        onOpenChange={(open) => setConfirm(open ? "delete" : null)}
        title={t("review.actions.deleteTitle")}
        description={t("review.actions.deleteDescription")}
        footer={
          <>
            <Button onClick={() => setConfirm(null)}>{t("review.actions.cancel")}</Button>
            <Button
              variant="danger"
              onClick={() =>
                run(() => deletePayslipDocumentAction(documentId), t("review.toasts.deleted"), () =>
                  router.push("/payroll"),
                )
              }
              disabled={pending}
            >
              {t("review.actions.delete")}
            </Button>
          </>
        }
      >
        {null}
      </Modal>
    </div>
  );
}
