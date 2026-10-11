"use client";

import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { type FormEvent, useId, useState, useTransition } from "react";
import type { DocumentState } from "@/modules/imports/rules";
import { Button } from "@/ui/button";
import { Field } from "@/ui/field";
import { Input } from "@/ui/input";
import { Modal } from "@/ui/modal";
import { notify } from "@/ui/toast";
import {
  type ActionResult,
  applyPayslipAction,
  deletePayslipDocumentAction,
  fillWithLlmAction,
  rejectPayslipAction,
  renamePayslipAction,
  reopenPayslipAction,
  retryPayslipAction,
  verifyPayslipAction,
} from "../actions";

type Failed = { ok: false; error: string };

/**
 * What a person can do with a payslip in its state (spec §7.8): verify it — failed checks only
 * after saying so —, apply it, discard it, read it again, rename it, reopen an applied one to change
 * it, delete it — an applied one leaves the register first.
 */
export function ReviewActions({
  documentId,
  fileName,
  state,
  blocking,
  llm,
}: {
  documentId: string;
  fileName: string;
  state: DocumentState;
  blocking: boolean;
  /** The OpenAI fallback is configured and some value it may fill is still blank. */
  llm: boolean;
}) {
  const t = useTranslations("payroll");
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [confirm, setConfirm] = useState<"verify" | "delete" | "reopen" | "rename" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const nameId = useId();

  function run<R extends { ok: true }>(
    action: () => Promise<R | Failed>,
    toast: string | ((result: R) => string),
    then?: () => void,
  ) {
    startTransition(async () => {
      const result = await action();
      setConfirm(null);
      if (!result.ok) {
        setError(t(`errors.${result.error}` as never));
        return;
      }
      setError(null);
      notify(typeof toast === "string" ? toast : toast(result));
      if (then) then();
      else router.refresh();
    });
  }

  function rename(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const name = String(new FormData(event.currentTarget).get("name") ?? "");
    run((): Promise<ActionResult> => renamePayslipAction(documentId, name), t("review.toasts.renamed"));
  }

  const verify = (acknowledge: boolean) =>
    run(() => verifyPayslipAction(documentId, acknowledge), t("review.toasts.verified"));
  const canRetry = ["needs_review", "needs_ocr", "verified", "failed", "rejected"].includes(state);
  const canReject = ["needs_review", "needs_ocr", "verified", "failed"].includes(state);
  const canDelete = ["needs_review", "needs_ocr", "verified", "failed", "rejected", "applied"].includes(state);
  const applied = state === "applied";

  return (
    <div className="flex flex-col items-end gap-1">
      <div className="flex flex-wrap justify-end gap-2">
        <Button variant="ghost" onClick={() => setConfirm("rename")} disabled={pending}>
          {t("review.actions.rename")}
        </Button>
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
        {applied && (
          <Button onClick={() => setConfirm("reopen")} disabled={pending}>
            {t("review.actions.reopen")}
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
        description={t(applied ? "review.actions.deleteAppliedDescription" : "review.actions.deleteDescription")}
        footer={
          <>
            <Button onClick={() => setConfirm(null)}>{t("review.actions.cancel")}</Button>
            <Button
              variant="danger"
              onClick={() =>
                run(
                  () => deletePayslipDocumentAction(documentId),
                  (result) =>
                    t(
                      result.restored
                        ? "review.toasts.deletedRestored"
                        : result.unapplied
                          ? "review.toasts.deletedUnapplied"
                          : "review.toasts.deleted",
                    ),
                  () => router.push("/payroll"),
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
      <Modal
        open={confirm === "reopen"}
        onOpenChange={(open) => setConfirm(open ? "reopen" : null)}
        title={t("review.actions.reopenTitle")}
        description={t("review.actions.reopenDescription")}
        footer={
          <>
            <Button onClick={() => setConfirm(null)}>{t("review.actions.cancel")}</Button>
            <Button
              variant="primary"
              onClick={() =>
                run(
                  () => reopenPayslipAction(documentId),
                  (result) => t(result.restored ? "review.toasts.reopenedRestored" : "review.toasts.reopened"),
                )
              }
              disabled={pending}
            >
              {t("review.actions.reopen")}
            </Button>
          </>
        }
      >
        {null}
      </Modal>
      <Modal
        open={confirm === "rename"}
        onOpenChange={(open) => setConfirm(open ? "rename" : null)}
        title={t("review.actions.renameTitle")}
        description={t("review.actions.renameDescription")}
      >
        <form onSubmit={rename} className="flex flex-col gap-4">
          <Field label={t("review.actions.name")} htmlFor={nameId}>
            <Input id={nameId} name="name" defaultValue={fileName} maxLength={200} required autoFocus />
          </Field>
          <div className="flex items-center justify-end gap-2">
            <Button type="button" onClick={() => setConfirm(null)}>
              {t("review.actions.cancel")}
            </Button>
            <Button type="submit" variant="primary" disabled={pending}>
              {t("review.actions.save")}
            </Button>
          </div>
        </form>
      </Modal>
    </div>
  );
}
