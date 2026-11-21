"use client";

// The sync of a connected service (§4.3, §5): «Sync now» and «Verify» (a minute apart at least, which
// the server enforces, SEC-09), the key's replacement, the disconnection and «Revoked».
import { useTranslations } from "next-intl";
import { type FormEvent, useId, useState, useTransition } from "react";
import { Button } from "@ledgerly/ui/button";
import { FormDialog } from "@ledgerly/ui/form-dialog";
import { useRouter } from "@ledgerly/ui/router";
import { notify } from "@ledgerly/ui/toast";
import { confirmKeyRevoked, disconnectProvider, replaceKey, syncNow, verifyKey } from "../calls";
import { clearKeys, type ConnectableProvider, KeyFields, keysOf } from "./connect";
import { ConfirmAction, FORM_GRID, Opener, useInvestmentResult, useOutcome } from "./dialog-kit";

export function SyncNowButton({ accountId }: { accountId: string }) {
  const text = useTranslations("investments");
  const router = useRouter();
  const outcome = useOutcome();
  const [pending, startTransition] = useTransition();
  return (
    <Button
      size="sm"
      variant="primary"
      disabled={pending}
      onClick={() =>
        startTransition(async () => {
          outcome(await syncNow(accountId), text("toasts.synced"));
          router.refresh();
        })
      }
    >
      {text("sync.now")}
    </Button>
  );
}

export function SyncButtons({ accountId }: { accountId: string }) {
  const text = useTranslations("investments");
  const router = useRouter();
  const outcome = useOutcome();
  const [pending, startTransition] = useTransition();
  return (
    <span className="flex flex-wrap gap-2">
      <SyncNowButton accountId={accountId} />
      <Button
        size="sm"
        disabled={pending}
        onClick={() =>
          startTransition(async () => {
            outcome(await verifyKey(accountId), text("toasts.verified"));
            router.refresh();
          })
        }
      >
        {text("sync.verify")}
      </Button>
    </span>
  );
}

export function ReplaceKeyButton({
  accountId,
  provider,
}: {
  accountId: string;
  provider: ConnectableProvider;
}) {
  const text = useTranslations("investments");
  return (
    <Opener label={text("sync.replace")}>
      {(close) => <ReplaceKeyDialog onClose={close} accountId={accountId} provider={provider} />}
    </Opener>
  );
}

export function ReplaceKeyDialog({
  onClose,
  accountId,
  provider,
}: {
  onClose: () => void;
  accountId: string;
  provider: ConnectableProvider;
}) {
  const text = useTranslations("investments");
  const id = useId();
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const { error, report } = useInvestmentResult();
  function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const keys = keysOf(provider, form);
    startTransition(async () => {
      const result = await replaceKey(accountId, keys);
      clearKeys(provider, form);
      if (!report(result)) return;
      notify(text("toasts.keyReplaced"));
      onClose();
      router.refresh();
    });
  }
  return (
    <FormDialog
      onClose={onClose}
      width={460}
      className={FORM_GRID}
      title={text("sync.replaceTitle", { name: provider.name })}
      description={text("sync.replaceDescription")}
      onSubmit={onSubmit}
      error={error}
      pending={pending}
      cancelLabel={text("form.cancel")}
      submitLabel={text("connect.submit")}
    >
      <KeyFields provider={provider} id={id} />
    </FormDialog>
  );
}

/** «Disconnect»: asks first; the service becomes manual and keeps its history. */
export function DisconnectDialog({
  onClose,
  accountId,
  name,
}: {
  onClose: () => void;
  accountId: string;
  name: string;
}) {
  const text = useTranslations("investments");
  const router = useRouter();
  return (
    <ConfirmAction
      onClose={onClose}
      title={text("confirm.disconnectTitle", { name })}
      description={text("confirm.disconnectDescription")}
      confirm={text("sync.disconnect")}
      onConfirm={async () => {
        const result = await disconnectProvider(accountId);
        notify(
          result.ok ? text("toasts.disconnected", { name }) : text("errors.failed"),
          result.ok ? "success" : "error",
        );
        if (result.ok) router.refresh();
        return result.ok;
      }}
    />
  );
}

export function DisconnectButton({ accountId, name }: { accountId: string; name: string }) {
  const text = useTranslations("investments");
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button size="sm" variant="danger" onClick={() => setOpen(true)}>
        {text("sync.disconnect")}
      </Button>
      {open && <DisconnectDialog onClose={() => setOpen(false)} accountId={accountId} name={name} />}
    </>
  );
}

export function ConfirmRevokedButton({ accountId }: { accountId: string }) {
  const text = useTranslations("investments");
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  return (
    <Button
      size="sm"
      disabled={pending}
      onClick={() =>
        startTransition(async () => {
          const result = await confirmKeyRevoked(accountId);
          notify(result.ok ? text("toasts.revoked") : text("errors.failed"), result.ok ? "success" : "error");
          router.refresh();
        })
      }
    >
      {text("sync.revokedConfirm")}
    </Button>
  );
}
